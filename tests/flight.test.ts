import { describe, expect, it } from 'vitest';
import { AIRCRAFT, type AircraftId } from '../src/data/aircraft';
import { AIRFIELDS, WEATHER_PRESETS } from '../src/data/mission';
import {
  createAircraft,
  neutralControls,
  type Aircraft,
  type Controls,
} from '../src/entities/aircraft';
import type { SimEvent } from '../src/systems/events';
import { engineThrust, maxLevelSpeed, stepAircraft, type FlightEnv } from '../src/systems/flight';
import { atmosphere, STANDARD_WEATHER } from '../src/world/atmosphere';
import { DEG, createRng } from '../src/world/math';
import { iso, visualHeight } from '../src/world/projection';
import { runwayWorld } from '../src/world/terrain';

const DT = 1 / 60;
const env = (): FlightEnv & { events: SimEvent[] } => ({
  weather: STANDARD_WEATHER,
  events: [],
  rng: createRng(1),
});
const ids = Object.keys(AIRCRAFT) as AircraftId[];
const airborne = (type: AircraftId, z = 5000, speed = 250) =>
  createAircraft(1, type, 'blue', 'callsign.player', { x: 3_000, y: 20_000, z }, 0, speed);
function fly(
  a: Aircraft,
  seconds: number,
  c: Partial<Controls> | ((a: Aircraft) => Partial<Controls>),
  e = env(),
) {
  for (let i = 0; i < seconds / DT && a.alive; i++)
    stepAircraft(a, { ...neutralControls(0.8), ...(typeof c === 'function' ? c(a) : c) }, e, DT);
  return e;
}

describe('atmosphere', () => {
  it('matches ISA at sea level and the tropopause', () => {
    const sl = atmosphere(0);
    expect(sl.density).toBeCloseTo(1.225, 3);
    expect(sl.temperature).toBeCloseTo(288.15, 2);
    const t = atmosphere(11_000);
    expect(t.temperature).toBeCloseTo(216.65, 1);
    expect(t.density).toBeCloseTo(0.3639, 3);
  });
  it('makes hot air thinner and reduces thrust', () => {
    const hot = WEATHER_PRESETS.hot;
    expect(atmosphere(0, hot).density).toBeLessThan(atmosphere(0).density * 0.95);
    const spec = AIRCRAFT['MiG-35'];
    expect(engineThrust(spec, atmosphere(0, hot), 0, 1, true).thrust).toBeLessThan(
      engineThrust(spec, atmosphere(0), 0, 1, true).thrust,
    );
  });
});

describe('projection', () => {
  it('keeps ground positions 1:1 and compresses altitude for display only', () => {
    expect(iso(120, 40, 0)).toEqual({ x: 80, y: 80 });
    expect(iso(120, 40, 1000).x).toBe(80);
    expect(visualHeight(10_000)).toBeLessThan(400);
    expect(visualHeight(2000)).toBeGreaterThan(visualHeight(1000));
  });
});

describe('flight model', () => {
  it.each(ids)('%s reaches its reference top speeds within 8%%', (id) => {
    const s = AIRCRAFT[id];
    const mass = s.emptyMass + 100 + s.internalFuel * 0.5;
    const sl = maxLevelSpeed(s, mass, 0, STANDARD_WEATHER) * 3.6;
    const alt = maxLevelSpeed(s, mass, s.reference.altitude, STANDARD_WEATHER) * 3.6;
    expect(Math.abs(sl / s.reference.seaLevelSpeed - 1)).toBeLessThan(0.08);
    expect(Math.abs(alt / s.reference.altitudeSpeed - 1)).toBeLessThan(0.08);
  });

  it.each(ids)('%s takes off with afterburner within the runway', (id) => {
    const home = AIRFIELDS.blue;
    const p = runwayWorld(home, -home.length / 2 + 150, 0);
    const a = createAircraft(
      1,
      id,
      'blue',
      'callsign.player',
      { ...p, z: home.elevation },
      home.heading,
      0,
    );
    fly(a, 40, (x) => ({ throttle: 1, afterburner: true, pitch: x.speed > 75 ? 0.8 : 0 }));
    expect(a.alive).toBe(true);
    expect(a.onGround).toBe(false);
    expect(a.pos.x - p.x).toBeLessThan(home.length);
  });

  it('burns several times more fuel with afterburner', () => {
    const dry = airborne('F-16');
    const wet = airborne('F-16');
    fly(dry, 10, { throttle: 1 });
    fly(wet, 10, { throttle: 1, afterburner: true });
    const burnDry = AIRCRAFT['F-16'].internalFuel - dry.fuel;
    const burnWet = AIRCRAFT['F-16'].internalFuel - wet.fuel;
    expect(burnWet).toBeGreaterThan(burnDry * 2.5);
  });

  it('never exceeds the FCS G limit and bleeds energy in a hard turn', () => {
    const a = airborne('MiG-35', 3000, 280);
    let peak = 0;
    fly(a, 8, (x) => {
      peak = Math.max(peak, x.load);
      return { roll: 1, pitch: 1, throttle: 1 };
    });
    expect(peak).toBeLessThanOrEqual(AIRCRAFT['MiG-35'].gLimit + 1e-6);
    expect(peak).toBeGreaterThan(7);
    expect(a.speed).toBeLessThan(280);
  });

  it('loses pilot consciousness under sustained high G', () => {
    const a = airborne('F-16', 3000, 300);
    const e = env();
    let gloc = -1;
    for (let i = 0; i < 40 / DT && gloc < 0; i++) {
      // Keep speed artificially so the turn can be held at the limit.
      a.speed = 300;
      stepAircraft(a, { ...neutralControls(1), roll: 1, pitch: 1, afterburner: true }, e, DT);
      if (a.pilot.gloc > 0) gloc = i * DT;
    }
    expect(gloc).toBeGreaterThan(5);
    expect(gloc).toBeLessThan(25);
  });

  it('stalls when speed runs out in a vertical climb and can recover', () => {
    const a = airborne('MiG-35', 4000, 220);
    const e = fly(a, 30, (x) =>
      x.regime === 'spin'
        ? { roll: -x.spinDirection, pitch: -1, throttle: 0.3 }
        : x.regime === 'stall'
          ? { throttle: 1 }
          : x.gamma < 85 * DEG && x.speed > 60
            ? { pitch: 1, throttle: 0.3 }
            : { throttle: 0.3 },
    );
    const keys = e.events.flatMap((ev) => (ev.type === 'message' ? [ev.msg.key] : []));
    expect(keys.some((k) => k === 'msg.stall' || k === 'msg.spin')).toBe(true);
    expect(a.alive).toBe(true);
    expect(a.regime).toBe('normal');
  });

  it('lands on the runway with gear down and crashes without it', () => {
    const home = AIRFIELDS.blue;
    for (const gear of [true, false]) {
      const p = runwayWorld(home, -home.length / 2 + 200, 0);
      const a = createAircraft(
        1,
        'F-16',
        'blue',
        'callsign.player',
        { ...p, z: home.elevation + 3 },
        home.heading,
        80,
      );
      Object.assign(a, {
        gearDown: gear,
        gearPos: gear ? 1 : 0,
        gamma: -1.2 * DEG,
        flaps: 2,
        flapPos: 1,
      });
      fly(a, 5, { throttle: 0.2, wheelBrake: true });
      expect(a.alive).toBe(gear);
      if (gear) expect(a.onGround).toBe(true);
    }
  });
});

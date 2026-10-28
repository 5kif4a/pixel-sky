import { describe, expect, it } from 'vitest';
import { GUNS } from '../src/data/weapons';
import { createAircraft, integrity, neutralControls } from '../src/entities/aircraft';
import { Battle, idleInput } from '../src/systems/battle';
import { blastAircraft, damageEffects, shellHit } from '../src/systems/damage';
import type { SimEvent } from '../src/systems/events';
import { stepAircraft } from '../src/systems/flight';
import { canLock, fuseEntry, launchMissile } from '../src/systems/weapons';
import { STANDARD_WEATHER } from '../src/world/atmosphere';
import { createRng, segmentClosest } from '../src/world/math';

const target = () =>
  createAircraft(2, 'MiG-35', 'red', 'callsign.red1', { x: 32_000, y: 26_000, z: 5000 }, 0, 250);
const module = (a: ReturnType<typeof target>, id: string) =>
  a.modules.find((m) => m.spec.id === id)!;

describe('hits and damage', () => {
  it('detects fast shells crossing a target between steps, with altitude', () => {
    const a = { x: 0, y: 0, z: 80 },
      b = { x: 100, y: 0, z: 80 };
    expect(segmentClosest(a, b, { x: 50, y: 0, z: 80 }).distance).toBe(0);
    expect(segmentClosest(a, b, { x: 50, y: 0, z: 0 }).distance).toBe(80);
  });

  it('damages the module a 30 mm shell passes through and misses above the aircraft', () => {
    const events: SimEvent[] = [];
    const a = target();
    // Shell crossing the left engine from the side.
    const engine = module(a, 'engine-l');
    const p = { x: a.pos.x + engine.spec.pos[0], y: a.pos.y - 20, z: a.pos.z };
    const hit = shellHit(
      a,
      p,
      { ...p, y: a.pos.y + 20 },
      GUNS['GSh-30-1'],
      900,
      events,
      createRng(1),
    );
    expect(hit).toBeDefined();
    expect(integrity(engine)).toBeLessThan(0.5);
    const b = target();
    const high = { ...p, z: a.pos.z + 30 };
    expect(
      shellHit(b, high, { ...high, y: b.pos.y + 20 }, GUNS['GSh-30-1'], 900, events, createRng(1)),
    ).toBeUndefined();
  });

  it('reduces thrust with engine damage and makes a damaged wing roll the aircraft', () => {
    const a = target();
    module(a, 'engine-l').hp = 0;
    module(a, 'wing-r').hp *= 0.3;
    const fx = damageEffects(a);
    expect(fx.thrust).toEqual([0, 1]);
    expect(fx.rollAsymmetry).toBeGreaterThan(0);
    const before = a.bank;
    const events: SimEvent[] = [];
    for (let i = 0; i < 30; i++)
      stepAircraft(
        a,
        { ...neutralControls(0.8), roll: 0 },
        { weather: STANDARD_WEATHER, events, rng: createRng(2) },
        1 / 60,
      );
    expect(a.bank).not.toBe(before);
  });

  it('warhead damage falls off with distance', () => {
    const near = target(),
      far = target();
    const events: SimEvent[] = [];
    blastAircraft(near, { ...near.pos, z: near.pos.z + 6 }, 9.4, events, createRng(3));
    blastAircraft(far, { ...far.pos, z: far.pos.z + 25 }, 9.4, events, createRng(3));
    const lost = (a: ReturnType<typeof target>) =>
      a.modules.reduce((s, m) => s + (m.spec.hp - m.hp), 0);
    expect(lost(near)).toBeGreaterThan(lost(far) * 3);
  });

  it('loses the aircraft when a wing is destroyed', () => {
    const a = target();
    const events: SimEvent[] = [];
    shellHit(
      a,
      { ...a.pos, y: a.pos.y - 30 },
      { ...a.pos, y: a.pos.y + 30 },
      GUNS['GSh-30-1'],
      900,
      events,
      createRng(1),
    );
    const wing = module(a, 'wing-l');
    wing.hp = 1;
    blastAircraft(a, { ...a.pos, y: a.pos.y - 4 }, 5, events, createRng(4));
    expect(wing.hp).toBe(0);
    expect(a.alive).toBe(false);
    expect(events.some((e) => e.type === 'destroyed')).toBe(true);
  });

  it('fires the proximity fuse on entering the fuse radius', () => {
    const p = fuseEntry({ x: -100, y: 0, z: 0 }, { x: 100, y: 0, z: 0 }, { x: 0, y: 0, z: 0 }, 8)!;
    expect(p.x).toBeCloseTo(-8);
    expect(
      fuseEntry({ x: -100, y: 20, z: 0 }, { x: 100, y: 20, z: 0 }, { x: 0, y: 0, z: 0 }, 8),
    ).toBeUndefined();
  });
});

describe('battle rules', () => {
  it('runs out of gun ammunition', () => {
    const b = new Battle({ player: 'MiG-35', start: 'air' });
    for (let i = 0; i < 60 * 8; i++) b.step(1 / 60, { ...idleInput(0.9), gun: true });
    expect(b.player.gunAmmo).toBe(0);
  });

  it('wins when every enemy fighter is shot down', () => {
    const b = new Battle({ player: 'F-16', start: 'air' });
    b.step(1 / 60, idleInput(0.8));
    expect(b.result).toBe('active');
    b.aircraft.slice(1).forEach((a) => (a.alive = false));
    b.step(1 / 60, idleInput(0.8));
    expect(b.result).toBe('victory');
  });

  it('declares defeat when the player crashes', () => {
    const b = new Battle({ player: 'MiG-35', start: 'air' });
    Object.assign(b.player, { gamma: -1.2, speed: 300 });
    b.player.pos.z = b.player.pos.z - 2900;
    for (let i = 0; i < 60 * 20 && b.result === 'active'; i++)
      b.step(1 / 60, { ...idleInput(0.8), controls: { ...neutralControls(0.8), pitch: -1 } });
    expect(b.result).toBe('defeat');
  });
});

describe('close-in IR missiles', () => {
  /** Player and a target `deg` off the nose at `range`, over the sea at 3 km. */
  function setup(deg: number, range: number) {
    const b = new Battle({ player: 'MiG-35', start: 'air' });
    const p = b.player;
    Object.assign(p, { heading: 0, gamma: 0, speed: 250, pos: { x: 8_000, y: 20_000, z: 3000 } });
    const t = b.aircraft[1];
    const a = (deg * Math.PI) / 180;
    // The target flies away from the player: its hot tail faces the seeker.
    Object.assign(t, {
      heading: a,
      gamma: 0,
      speed: 230,
      pos: { x: p.pos.x + Math.cos(a) * range, y: p.pos.y + Math.sin(a) * range, z: 3000 },
    });
    b.aircraft.slice(2).forEach((o) => (o.alive = false));
    // No pilot in the target: it flies straight, no flares.
    b.ai.delete(t.id);
    return { b, p, t };
  }

  it('locks off-boresight within the seeker gimbal, not beyond it', () => {
    expect(canLock(setup(50, 3000).p, setup(50, 3000).t)).toBe(true);
    const wide = setup(70, 3000);
    expect(canLock(wide.p, wide.t)).toBe(false);
  });

  it('a helmet-cued shot 50° off the nose hits a non-manoeuvring target', () => {
    const { b, p, t } = setup(50, 3000);
    launchMissile(b, p, t);
    for (let i = 0; i < 60 * 12 && t.alive; i++) b.step(1 / 60, idleInput(0.9));
    expect(t.modules.some((m) => m.hp < m.spec.hp)).toBe(true);
  });
});

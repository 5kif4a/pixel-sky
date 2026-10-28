import { describe, expect, it } from 'vitest';
import { instructor } from '../src/ai/instructor';
import { createAircraft, neutralControls, type Aircraft } from '../src/entities/aircraft';
import type { SimEvent } from '../src/systems/events';
import { stepAircraft } from '../src/systems/flight';
import { STANDARD_WEATHER } from '../src/world/atmosphere';
import { angleDiff, createRng, DEG } from '../src/world/math';

const DT = 1 / 60;
const jet = () =>
  createAircraft(1, 'MiG-35', 'blue', 'callsign.player', { x: 3_000, y: 20_000, z: 5000 }, 0, 250);
function follow(a: Aircraft, heading: number, gamma: number, seconds: number) {
  const env = { weather: STANDARD_WEATHER, events: [] as SimEvent[], rng: createRng(1) };
  for (let i = 0; i < seconds / DT && a.alive; i++)
    stepAircraft(a, { ...neutralControls(1), ...instructor(a, heading, gamma) }, env, DT);
}

describe('mouse-aim instructor', () => {
  it('turns onto a new heading and holds level flight', () => {
    const a = jet();
    follow(a, 90 * DEG, 0, 25);
    expect(a.alive).toBe(true);
    expect(a.regime).toBe('normal');
    expect(Math.abs(angleDiff(a.heading, 90 * DEG))).toBeLessThan(5 * DEG);
    expect(Math.abs(a.pos.z - 5000)).toBeLessThan(400);
  });

  it('reverses course without stalling or blacking out the pilot', () => {
    const a = jet();
    follow(a, 180 * DEG, 0, 40);
    expect(a.regime).toBe('normal');
    expect(a.pilot.gloc).toBe(0);
    expect(Math.abs(angleDiff(a.heading, 180 * DEG))).toBeLessThan(5 * DEG);
  });

  it('climbs at the wanted flight path angle', () => {
    const a = jet();
    follow(a, 0, 20 * DEG, 8);
    expect(Math.abs(a.gamma - 20 * DEG)).toBeLessThan(4 * DEG);
    expect(Math.abs(angleDiff(a.heading, 0))).toBeLessThan(3 * DEG);
  });
});

import { describe, it, expect } from 'vitest';
import { iso, segmentDistance, steer, bombImpact, angleDiff } from '../src/sim';

describe('world simulation', () => {
  it('projects altitude vertically without changing the ground position', () => {
    expect(iso(120, 40, 30)).toEqual({ x: 80, y: 50 });
    expect(iso(120, 40, 0)).toEqual({ x: 80, y: 80 });
  });
  it('detects fast projectiles crossing a target between frames', () => {
    expect(
      segmentDistance({ x: 0, y: 0, z: 80 }, { x: 100, y: 0, z: 80 }, { x: 50, y: 0, z: 80 }),
    ).toBe(0);
    expect(
      segmentDistance({ x: 0, y: 0, z: 80 }, { x: 100, y: 0, z: 80 }, { x: 50, y: 0, z: 0 }),
    ).toBe(80);
  });
  it('handles a stationary projectile and clamps to segment endpoints', () => {
    expect(segmentDistance({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 0 }, { x: 3, y: 4, z: 0 })).toBe(
      5,
    );
    expect(
      segmentDistance({ x: 0, y: 0, z: 0 }, { x: 10, y: 0, z: 0 }, { x: 15, y: 0, z: 0 }),
    ).toBe(5);
  });
  it('takes the short turn across the angle wrap and limits turn speed', () => {
    const a = Math.PI - 0.05,
      b = -Math.PI + 0.05;
    expect(angleDiff(a, b)).toBeCloseTo(0.1);
    expect(steer(a, b, 0.02) - a).toBeCloseTo(0.02);
  });
  it('predicts bomb travel using fall time and forward velocity', () => {
    expect(bombImpact({ x: 100, y: 100, z: 180 }, 0, 150)).toEqual({ x: 400, y: 100, z: 0 });
    expect(bombImpact({ x: 100, y: 100, z: 0 }, 0, 150)).toEqual({ x: 100, y: 100, z: 0 });
  });
});

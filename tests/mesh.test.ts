import { describe, expect, it } from 'vitest';
import { AIRCRAFT } from '../src/data/aircraft';
import { aircraftMesh } from '../src/render/mesh';
import { cross, dot, sub } from '../src/world/math';

describe.each(['MiG-35', 'F-16', 'Mirage 2000'] as const)('%s low-poly mesh', (id) => {
  const mesh = aircraftMesh(id)!;

  it('stays within the low-poly triangle budget', () => {
    const airframe = mesh.tris.filter((t) => !t.store && !t.gear).length;
    expect(airframe).toBeGreaterThanOrEqual(500);
    expect(airframe).toBeLessThanOrEqual(1500);
    // Full loadout and gear down.
    expect(mesh.tris.length).toBeLessThanOrEqual(1800);
  });

  it('matches the real length and span', () => {
    const xs = mesh.verts.map((v) => v.x),
      ys = mesh.verts.map((v) => v.y);
    expect(Math.max(...xs) - Math.min(...xs)).toBeCloseTo(AIRCRAFT[id].length, 0);
    expect(Math.max(...ys) - Math.min(...ys)).toBeCloseTo(AIRCRAFT[id].span, 0);
  });

  it('is symmetric about the centreline (except off-centre probes)', () => {
    const near = (a: number, b: number) => Math.abs(a - b) < 1e-6;
    const probe = new Set(
      mesh.tris.filter((t) => t.mat === 'probe').flatMap((t) => [t.a, t.b, t.c]),
    );
    const verts = mesh.verts.filter((_, i) => !probe.has(i));
    for (const v of verts)
      expect(verts.some((w) => near(w.x, v.x) && near(w.y, -v.y) && near(w.z, v.z))).toBe(true);
  });

  it('has outward-facing triangles (positive enclosed volume)', () => {
    let volume = 0;
    for (const t of mesh.tris) {
      const [a, b, c] = [mesh.verts[t.a], mesh.verts[t.b], mesh.verts[t.c]];
      volume += dot(a, cross(b, c)) / 6;
      // Stored normals agree with the winding.
      expect(dot(t.n, cross(sub(b, a), sub(c, a)))).toBeGreaterThan(0);
    }
    // Inward-wound parts would subtract their volume; a fighter airframe is tens of m³.
    expect(volume).toBeGreaterThan(15);
    expect(volume).toBeLessThan(90);
  });

  it('tags every store so it can be hidden after release', () => {
    const spec = AIRCRAFT[id];
    const ids = new Set(mesh.tris.filter((t) => t.store).map((t) => t.store!.index));
    expect(ids.size).toBe(spec.missileCount);
  });
});

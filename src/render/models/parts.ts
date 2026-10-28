import type { MeshBuilder } from '../meshBuilder';
import { AIRCRAFT, type AircraftId } from '../../data/aircraft';
import { addScaled, cross, dot, normalize, type Vec3 } from '../../world/math';

/** Dark openings flush with the airframe skin; the cannon itself is internal. */
export function cannonPorts(b: MeshBuilder, id: AircraftId) {
  for (const [x, y, z] of AIRCRAFT[id].gunMuzzles) {
    let surface: { point: Vec3; normal: Vec3; distance: number } | undefined;
    for (const t of b.tris) {
      if (t.store || t.gear || t.under || t.decal || Math.abs(t.n.z) < 0.1) continue;
      const a = b.verts[t.a],
        p = b.verts[t.b],
        q = b.verts[t.c];
      const determinant = (p.y - q.y) * (a.x - q.x) + (q.x - p.x) * (a.y - q.y);
      if (Math.abs(determinant) < 1e-9) continue;
      const u = ((p.y - q.y) * (x - q.x) + (q.x - p.x) * (y - q.y)) / determinant;
      const v = ((q.y - a.y) * (x - q.x) + (a.x - q.x) * (y - q.y)) / determinant;
      if (u < 0 || v < 0 || u + v > 1) continue;
      const height = a.z * u + p.z * v + q.z * (1 - u - v);
      const distance = Math.abs(height - z);
      if (!surface || distance < surface.distance)
        surface = { point: { x, y, z: height }, normal: t.n, distance };
    }
    if (!surface) continue;
    const n = surface.normal;
    const forward = normalize(addScaled({ x: 1, y: 0, z: 0 }, n, -dot(n, { x: 1, y: 0, z: 0 })));
    const across = normalize(cross(n, forward));
    const center = addScaled(surface.point, n, 0.002);
    const centerIndex = b.vert(center);
    const ring = Array.from({ length: 8 }, (_, i) => {
      const angle = (i * Math.PI) / 4;
      return b.vert(
        addScaled(
          addScaled(center, forward, Math.cos(angle) * 0.14),
          across,
          Math.sin(angle) * 0.045,
        ),
      );
    });
    const start = b.tris.length;
    for (let i = 0; i < ring.length; i++)
      b.tri(centerIndex, ring[i], ring[(i + 1) % ring.length], 'intake');
    for (let i = start; i < b.tris.length; i++) b.tris[i].decal = true;
  }
}

/** Parts shared by the aircraft models: wing chords, stores and pylons (body axes, metres). */
export type P3 = [x: number, y: number, z: number];
export interface Chord {
  le: P3;
  te: P3;
  /** Relative airfoil thickness. */
  t: number;
}

/** Chord at fraction k from root to tip, on the given side (−1 left, +1 right). */
export const between = (root: Chord, tip: Chord, k: number, side: number) => {
  const p = (a: P3, c: P3) => ({
    x: a[0] + (c[0] - a[0]) * k,
    y: (a[1] + (c[1] - a[1]) * k) * side,
    z: a[2] + (c[2] - a[2]) * k,
  });
  return { le: p(root.le, tip.le), te: p(root.te, tip.te), t: root.t + (tip.t - root.t) * k };
};

export interface StoreShape {
  length: number;
  radius: number;
  /** Half span of the cruciform tail fins. */
  fin: number;
}

/** Missile centred at (x, y, z): seeker head, body, cruciform tail. */
export function missile(b: MeshBuilder, x: number, y: number, z: number, s: StoreShape) {
  const { length: len, radius: r } = s;
  b.revolve(
    { x: x + len / 2, y, z },
    [
      [0, 0, 'seeker'],
      [-0.28, r, 'seeker'],
      [-0.4, r, 'missile'],
      [-len, r, 'missile'],
      [-len, 0, 'missile'],
    ],
    6,
  );
  tail(b, x - len / 2, y, z, s.fin, 0.05, 0.45, 'missile');
}

function tail(
  b: MeshBuilder,
  back: number,
  y: number,
  z: number,
  s: number,
  from: number,
  to: number,
  mat: 'missile',
) {
  for (const [dy, dz] of [
    [1, 0],
    [0, 1],
  ] as const)
    b.card(
      [
        { x: back + to, y: y - dy * s, z: z - dz * s },
        { x: back + to, y: y + dy * s, z: z + dz * s },
        { x: back + from, y: y + dy * s, z: z + dz * s },
        { x: back + from, y: y - dy * s, z: z - dz * s },
      ],
      mat,
    );
}

/**
 * Pylon under a wing at span station y, from `bottom` up to the wing's mean plane. It spans
 * 20–70 % of the local chord, where the airfoil is thick enough to hide its top; near the
 * leading edge the wing thins to nothing and a pylon would poke through.
 */
export function pylon(
  b: MeshBuilder,
  root: Chord,
  tip: Chord,
  y: number,
  side: number,
  bottom: number,
) {
  const c = between(root, tip, (y - root.le[1]) / (tip.le[1] - root.le[1]), side);
  const chord = c.le.x - c.te.x;
  b.box(
    { x: c.le.x - 0.7 * chord, y: y * side - 0.05, z: bottom },
    { x: c.le.x - 0.2 * chord, y: y * side + 0.05, z: c.le.z },
    'pylon',
  );
}

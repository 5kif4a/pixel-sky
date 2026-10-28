import type { AircraftId } from '../data/aircraft';
import type { Side } from '../data/mission';
import type { Vec3 } from '../world/math';
import type { Mat, Mesh, Tri } from './meshBuilder';
import { buildF16 } from './models/f16';
import { buildMig35 } from './models/mig35';
import { buildMirage2000 } from './models/mirage2000';

const BUILDERS: Record<AircraftId, () => Mesh> = {
  'MiG-35': buildMig35,
  'F-16': buildF16,
  'Mirage 2000': buildMirage2000,
};
const cache = new Map<AircraftId, Mesh>();

/** Low-poly mesh of an aircraft, built once. */
export function aircraftMesh(id: AircraftId): Mesh {
  const hit = cache.get(id);
  if (hit) return hit;
  const mesh = BUILDERS[id]();
  cache.set(id, mesh);
  return mesh;
}

const BASE: Record<Exclude<Mat, 'accent'>, number> = {
  skin: 0xd3d7d8,
  camo: 0xa9b0b4,
  belly: 0xc8cdcf,
  radome: 0x5f666b,
  trim: 0x3d4347,
  star: 0xc8322c,
  decalWhite: 0xeef0ee,
  decalBlue: 0x23408e,
  canopy: 0x1b252c,
  intake: 0x121517,
  nozzle: 0x3b3e41,
  nozzleIn: 0x231a15,
  missile: 0xe6e8e4,
  seeker: 0x4a5257,
  pylon: 0xb9bec0,
  probe: 0x9aa0a3,
  tyre: 0x232628,
  strut: 0xc9cdcf,
  wall: 0xb3bcc0,
  roof: 0x75828a,
  doorway: 0x161a1d,
};
const ACCENT: Record<Side, number> = { blue: 0x2f86b0, red: 0xc4432f };

export const meshColor = (mesh: Mesh, mat: Mat, side: Side) =>
  mesh.paint?.[mat] ?? (mat === 'accent' ? ACCENT[side] : BASE[mat]);

/** Depth bias of decals, metres: larger than the facets they lie on. */
const DECAL_BIAS = 0.35;

/**
 * Depth bias of everything hanging under the wing, metres. Painter's sorting by triangle
 * centre lets small pylon facets win over the big wing facets; seen from above they go
 * behind the wing, seen from below in front of it.
 */
const UNDER_BIAS = 3;

export interface MeshTri {
  pts: { x: number; y: number }[];
  /** Depth of each corner towards the viewer, for renderers with a depth buffer. */
  z: number[];
  color: number;
  depth: number;
}

/**
 * Projects the visible triangles of a mesh, sorted far → near (painter's algorithm), with
 * flat stepped lighting for the low-poly look. `viewDir` points towards the viewer.
 */
export function projectMesh(
  mesh: Mesh,
  axes: { forward: Vec3; right: Vec3; up: Vec3 },
  project: (d: Vec3) => { x: number; y: number },
  viewDir: Vec3,
  lightDir: Vec3,
  color: (t: Tri, light: number) => number,
  visible: (t: Tri) => boolean = () => true,
): MeshTri[] {
  const { forward: F, right: R, up: U } = axes;
  const rot = (p: Vec3): Vec3 => ({
    x: F.x * p.x + R.x * p.y + U.x * p.z,
    y: F.y * p.x + R.y * p.y + U.y * p.z,
    z: F.z * p.x + R.z * p.y + U.z * p.z,
  });
  const world = mesh.verts.map(rot);
  const screen = world.map(project);
  const out: MeshTri[] = [];
  const depthOf = (p: Vec3) => p.x * viewDir.x + p.y * viewDir.y + p.z * viewDir.z;
  const under = depthOf(U) > 0 ? -UNDER_BIAS : UNDER_BIAS;
  for (const t of mesh.tris) {
    if (!visible(t)) continue;
    const n = rot(t.n);
    if (n.x * viewDir.x + n.y * viewDir.y + n.z * viewDir.z <= 0) continue;
    const a = world[t.a],
      b = world[t.b],
      c = world[t.c];
    const lit = Math.max(0, n.x * lightDir.x + n.y * lightDir.y + n.z * lightDir.z);
    // Few light steps, darker undersides: crisp facets rather than smooth gradients.
    const light = Math.round((0.5 + 0.62 * lit - (n.z < -0.4 ? 0.08 : 0)) * 10) / 10;
    const z = [depthOf(a), depthOf(b), depthOf(c)];
    out.push({
      pts: [screen[t.a], screen[t.b], screen[t.c]],
      z,
      color: color(t, light),
      // Decals sort in front of the large facet they lie on.
      depth: (z[0] + z[1] + z[2]) / 3 + (t.decal ? DECAL_BIAS : 0) + (t.under ? under : 0),
    });
  }
  return out.sort((p, q) => p.depth - q.depth);
}

/** Whether a triangle is shown for the current loadout and gear position. */
export const storeShown = (t: Tri, missiles: number, gearDown = true) =>
  (!t.gear || gearDown) && (!t.store || t.store.index < missiles);

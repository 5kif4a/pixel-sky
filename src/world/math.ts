export type Vec3 = { x: number; y: number; z: number };

export const G = 9.80665;
export const DEG = Math.PI / 180;

export const vec = (x = 0, y = 0, z = 0): Vec3 => ({ x, y, z });
export const copy = (a: Vec3): Vec3 => ({ x: a.x, y: a.y, z: a.z });
export const add = (a: Vec3, b: Vec3): Vec3 => ({ x: a.x + b.x, y: a.y + b.y, z: a.z + b.z });
export const sub = (a: Vec3, b: Vec3): Vec3 => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
export const scale = (a: Vec3, k: number): Vec3 => ({ x: a.x * k, y: a.y * k, z: a.z * k });
export const addScaled = (a: Vec3, b: Vec3, k: number): Vec3 => ({
  x: a.x + b.x * k,
  y: a.y + b.y * k,
  z: a.z + b.z * k,
});
export const dot = (a: Vec3, b: Vec3) => a.x * b.x + a.y * b.y + a.z * b.z;
export const cross = (a: Vec3, b: Vec3): Vec3 => ({
  x: a.y * b.z - a.z * b.y,
  y: a.z * b.x - a.x * b.z,
  z: a.x * b.y - a.y * b.x,
});
export const length = (a: Vec3) => Math.hypot(a.x, a.y, a.z);
export const distance = (a: Vec3, b: Vec3) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
export const groundDistance = (a: Vec3, b: Vec3) => Math.hypot(a.x - b.x, a.y - b.y);
export function normalize(a: Vec3): Vec3 {
  const l = length(a);
  return l > 1e-9 ? scale(a, 1 / l) : vec(1, 0, 0);
}

export const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(max, v));
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
export const smoothstep = (t: number) => {
  const c = clamp(t, 0, 1);
  return c * c * (3 - 2 * c);
};
export const approach = (value: number, target: number, rate: number) =>
  value < target ? Math.min(target, value + rate) : Math.max(target, value - rate);

export function wrapAngle(a: number) {
  return Math.atan2(Math.sin(a), Math.cos(a));
}
export function angleDiff(from: number, to: number) {
  return wrapAngle(to - from);
}
export function angleBetween(a: Vec3, b: Vec3) {
  const d = dot(a, b) / Math.max(1e-9, length(a) * length(b));
  return Math.acos(clamp(d, -1, 1));
}

/** Closest approach of point p to segment a→b; t is the position along the segment (0..1). */
export function segmentClosest(a: Vec3, b: Vec3, p: Vec3) {
  const dx = b.x - a.x,
    dy = b.y - a.y,
    dz = b.z - a.z;
  const len = dx * dx + dy * dy + dz * dz;
  const t =
    len === 0 ? 0 : clamp(((p.x - a.x) * dx + (p.y - a.y) * dy + (p.z - a.z) * dz) / len, 0, 1);
  return {
    t,
    distance: Math.hypot(p.x - a.x - dx * t, p.y - a.y - dy * t, p.z - a.z - dz * t),
  };
}

/** Piecewise-linear lookup in a table sorted by the first column. */
export function interpolate(table: readonly (readonly [number, number])[], x: number) {
  if (x <= table[0][0]) return table[0][1];
  for (let i = 1; i < table.length; i++)
    if (x <= table[i][0]) {
      const [x0, y0] = table[i - 1],
        [x1, y1] = table[i];
      return lerp(y0, y1, (x - x0) / (x1 - x0));
    }
  return table[table.length - 1][1];
}

/** Small deterministic generator so battles and tests are reproducible. */
export function createRng(seed: number) {
  let s = (Math.imul(seed ^ 0x9e3779b9, 2654435761) ^ (seed >>> 15)) >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return (s >>> 0) / 4294967296;
  };
}
export type Rng = () => number;
export const gaussian = (rng: Rng) =>
  Math.sqrt(-2 * Math.log(Math.max(1e-9, rng()))) * Math.cos(2 * Math.PI * rng());

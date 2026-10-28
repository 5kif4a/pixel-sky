import { AIRFIELDS, CITY, MAP_SIZE, RIDGE, type Airfield } from '../data/mission';
import { clamp, lerp, smoothstep, type Vec3 } from './math';

/** Height grid spacing; heights between nodes are interpolated bilinearly. */
export const GRID_STEP = 200;
const GRID_N = MAP_SIZE / GRID_STEP + 1;
export const MAX_ELEVATION = 2_700;

function hash(ix: number, iy: number, seed: number) {
  let h = Math.imul(ix, 374761393) + Math.imul(iy, 668265263) + Math.imul(seed, 982451653);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}
export const cellHash = hash;

function valueNoise(x: number, y: number, seed: number) {
  const ix = Math.floor(x),
    iy = Math.floor(y);
  const fx = x - ix,
    fy = y - iy;
  const u = fx * fx * (3 - 2 * fx),
    v = fy * fy * (3 - 2 * fy);
  const a = hash(ix, iy, seed),
    b = hash(ix + 1, iy, seed),
    c = hash(ix, iy + 1, seed),
    d = hash(ix + 1, iy + 1, seed);
  return lerp(lerp(a, b, u), lerp(c, d, u), v);
}
function fbm(x: number, y: number, octaves: number, seed: number) {
  let sum = 0,
    amp = 0.5,
    norm = 0;
  for (let o = 0; o < octaves; o++) {
    sum += valueNoise(x, y, seed + o * 31) * amp;
    norm += amp;
    amp *= 0.5;
    x *= 2.03;
    y *= 2.03;
  }
  return sum / norm;
}
function ridged(x: number, y: number, octaves: number, seed: number) {
  let sum = 0,
    amp = 0.55,
    norm = 0;
  for (let o = 0; o < octaves; o++) {
    const n = 1 - Math.abs(valueNoise(x, y, seed + o * 17) * 2 - 1);
    sum += n * n * amp;
    norm += amp;
    amp *= 0.5;
    x *= 2.1;
    y *= 2.1;
  }
  return sum / norm;
}

/** Coastline x position (km) for a given y (km); the sea lies to the west of it. */
export function coastline(yKm: number) {
  return 29 + 1.2 * Math.sin(yKm / 5.2) + 0.6 * Math.sin(yKm / 2.1 + 1);
}
export const cityCentre = () => ({
  x: (coastline(CITY.y) + CITY.inland) * 1000,
  y: CITY.y * 1000,
  radius: CITY.radius * 1000,
});

/** Position in runway axes: along the take-off course and to the right of it. */
export function runwayLocal(a: Airfield, x: number, y: number) {
  const dx = x - a.x,
    dy = y - a.y;
  const c = Math.cos(a.heading),
    s = Math.sin(a.heading);
  return { along: dx * c + dy * s, across: -dx * s + dy * c };
}
export function runwayWorld(a: Airfield, along: number, across: number) {
  const c = Math.cos(a.heading),
    s = Math.sin(a.heading);
  return { x: a.x + along * c - across * s, y: a.y + along * s + across * c };
}
function airfieldOutside(a: Airfield, x: number, y: number) {
  const p = runwayLocal(a, x, y);
  const halfLength = a.length / 2 + 500;
  const minAcross = Math.min(-a.width, a.apronOffset - a.apronDepth) - 300;
  const maxAcross = Math.max(a.width, a.apronOffset + a.apronDepth) + 300;
  const dx = Math.max(0, Math.abs(p.along) - halfLength);
  const dy = Math.max(0, minAcross - p.across, p.across - maxAcross);
  return Math.hypot(dx, dy);
}

function rawHeight(x: number, y: number) {
  const kx = x / 1000,
    ky = y / 1000;
  const d = kx - coastline(ky);
  const n = fbm(kx / 6, ky / 6, 4, 11);
  if (d < 0) return -15 - 90 * smoothstep(-d / 10) + (n - 0.5) * 16;
  const hills = Math.pow(fbm(kx / 2.5, ky / 2.5, 3, 5), 2) * 260 * smoothstep(d / 6);
  const rx = RIDGE.to.x - RIDGE.from.x,
    ry = RIDGE.to.y - RIDGE.from.y;
  const t = clamp(
    ((kx - RIDGE.from.x) * rx + (ky - RIDGE.from.y) * ry) / (rx * rx + ry * ry),
    0,
    1,
  );
  const ridgeDist = Math.hypot(kx - RIDGE.from.x - rx * t, ky - RIDGE.from.y - ry * t);
  const mask = Math.exp(-((ridgeDist / RIDGE.width) ** 2));
  // Coastal sierra: up to about 1.6 km.
  const mountains = mask * (250 + 1350 * ridged(kx / 4, ky / 4, 4, 3));
  let h = Math.max(2 + d * 0.6, 4 + d * 7 + (n - 0.5) * 70 + hills + mountains);
  h *= smoothstep(d / 1.2) * 0.9 + 0.1;
  const city = cityCentre();
  const cityW = 1 - smoothstep((Math.hypot(x - city.x, y - city.y) - city.radius) / 1500);
  if (cityW > 0) h = lerp(h, Math.min(h, 6 + d * 4), cityW);
  for (const a of Object.values(AIRFIELDS)) {
    const w = 1 - smoothstep(airfieldOutside(a, x, y) / 1800);
    if (w > 0) h = lerp(h, a.elevation, w);
  }
  return h;
}

let grid: Float32Array | undefined;
function heights() {
  if (!grid) {
    grid = new Float32Array(GRID_N * GRID_N);
    for (let j = 0; j < GRID_N; j++)
      for (let i = 0; i < GRID_N; i++)
        grid[j * GRID_N + i] = rawHeight(i * GRID_STEP, j * GRID_STEP);
  }
  return grid;
}

/** Terrain elevation (negative below sea level), metres. */
export function terrainHeight(x: number, y: number) {
  const g = heights();
  const gx = clamp(x / GRID_STEP, 0, GRID_N - 1.0001),
    gy = clamp(y / GRID_STEP, 0, GRID_N - 1.0001);
  const ix = Math.floor(gx),
    iy = Math.floor(gy);
  const fx = gx - ix,
    fy = gy - iy;
  const i = iy * GRID_N + ix;
  return lerp(lerp(g[i], g[i + 1], fx), lerp(g[i + GRID_N], g[i + GRID_N + 1], fx), fy);
}
/** Height of the surface something can stand on or crash into: water is flat at 0. */
export const groundHeight = (x: number, y: number) => Math.max(0, terrainHeight(x, y));

export type SurfaceKind = 'water' | 'runway' | 'apron' | 'ground' | 'city';
export interface Surface {
  kind: SurfaceKind;
  height: number;
  airfield?: Airfield;
}
export function surfaceAt(x: number, y: number): Surface {
  for (const a of Object.values(AIRFIELDS)) {
    const p = runwayLocal(a, x, y);
    if (Math.abs(p.along) <= a.length / 2 && Math.abs(p.across) <= a.width / 2)
      return { kind: 'runway', height: a.elevation, airfield: a };
    if (
      Math.abs(p.along) <= a.apronLength / 2 &&
      Math.abs(p.across - a.apronOffset) <= a.apronDepth / 2
    )
      return { kind: 'apron', height: a.elevation, airfield: a };
  }
  const h = terrainHeight(x, y);
  if (h <= 0) return { kind: 'water', height: 0 };
  const c = cityCentre();
  if (Math.hypot(x - c.x, y - c.y) < c.radius) return { kind: 'city', height: h };
  return { kind: 'ground', height: h };
}

export const BLOCK = 120;
export interface Building {
  x: number;
  y: number;
  width: number;
  depth: number;
  height: number;
  base: number;
}
/** City building on a 120 m block grid, deterministic. */
export function buildingAt(ix: number, iy: number): Building | undefined {
  if (ix % 5 === 0 || iy % 4 === 0) return;
  const c = cityCentre();
  const cx = ix * BLOCK + BLOCK / 2,
    cy = iy * BLOCK + BLOCK / 2;
  const r = Math.hypot(cx - c.x, cy - c.y) / c.radius;
  if (r > 1 || hash(ix, iy, 77) < 0.25 + r * 0.3) return;
  const base = terrainHeight(cx, cy);
  if (base <= 1) return;
  const width = 50 + hash(ix, iy, 78) * 40,
    depth = 50 + hash(ix, iy, 79) * 40;
  return {
    x: cx - width / 2,
    y: cy - depth / 2,
    width,
    depth,
    height: 6 + Math.pow(hash(ix, iy, 80), 2) * 30 * (1 - r * 0.7),
    base,
  };
}
/** Highest obstacle at a point: terrain, water or a city building. */
export function obstacleHeight(x: number, y: number) {
  const ground = groundHeight(x, y);
  const b = buildingAt(Math.floor(x / BLOCK), Math.floor(y / BLOCK));
  if (b && x >= b.x && x <= b.x + b.width && y >= b.y && y <= b.y + b.depth)
    return Math.max(ground, b.base + b.height);
  return ground;
}

/** True when terrain hides b from a (sampled every 400 m). */
export function terrainBlocks(a: Vec3, b: Vec3) {
  const d = Math.hypot(b.x - a.x, b.y - a.y);
  const steps = Math.min(150, Math.ceil(d / 400));
  for (let i = 1; i < steps; i++) {
    const t = i / steps;
    if (terrainHeight(lerp(a.x, b.x, t), lerp(a.y, b.y, t)) > lerp(a.z, b.z, t)) return true;
  }
  return false;
}

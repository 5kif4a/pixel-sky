import Phaser from 'phaser';
import { AIRFIELDS, MAP_SIZE, type Airfield } from '../data/mission';
import { iso, visualHeight } from '../world/projection';
import {
  BLOCK,
  MAX_ELEVATION,
  buildingAt,
  cellHash,
  cityCentre,
  runwayWorld,
  terrainHeight,
} from '../world/terrain';
import { box, mix, polygon, shade } from './draw';

const CELL_SIZES = [25, 50, 100, 200, 400, 800];
const MAX_CELLS = 2600;
/** Towards the sun, world axes (x east, y south, z up). */
const LIGHT = (() => {
  const l = [-0.55, -0.35, 0.76];
  const n = Math.hypot(...l);
  return l.map((v) => v / n);
})();

/**
 * Mediterranean coast colours by elevation, slope and land use: turquoise shallows, sand,
 * dry olive scrub and ochre fields, bare rock on the sierra, a whitewashed town.
 */
export function groundColor(x: number, y: number, h: number, slope: number) {
  if (h <= 0) return mix(0x1b4f78, 0x3a93a8, Math.max(0, 1 + h / 45));
  if (h < 6) return 0xd8c58e;
  const city = cityCentre();
  if (Math.hypot(x - city.x, y - city.y) < city.radius)
    return cellHash(Math.floor(x / BLOCK), Math.floor(y / BLOCK), 5) > 0.5 ? 0xc9bfa6 : 0xb98a62;
  if (h > 1300 || slope > 0.6) return mix(0x8c7a60, 0xa49d8e, Math.min(1, (h - 1300) / 700));
  // Patchwork of olive groves and dry fields, greener in the valleys.
  const patch = cellHash(Math.floor(x / 900), Math.floor(y / 900), 9);
  const base = patch > 0.62 ? 0x6f7b45 : patch > 0.3 ? 0x9c9a5c : 0xb69d66;
  return mix(base, 0x8a7a58, Math.min(1, h / 1400));
}

interface Corner {
  x: number;
  y: number;
  h: number;
}

/**
 * Low-poly terrain: the visible part of the heightfield as a continuous triangle mesh, two
 * flat-shaded triangles per cell, drawn back to front. The cell size grows with the view so
 * the triangle count stays bounded.
 */
export class TerrainRenderer {
  private corners = new Map<number, Corner>();

  draw(g: Phaser.GameObjects.Graphics, view: Phaser.Geom.Rectangle) {
    g.clear();
    const hmax = visualHeight(MAX_ELEVATION);
    const area = view.width * (view.height + hmax);
    const cs = CELL_SIZES.find((s) => area / (s * s) <= MAX_CELLS) ?? 800;
    const uMin = Math.floor((view.x - cs * 2) / cs),
      uMax = Math.ceil((view.right + cs * 2) / cs);
    const wMin = Math.floor((2 * view.y) / cs) - 2,
      wMax = Math.ceil((2 * (view.bottom + hmax)) / cs) + 2;
    this.corners.clear();
    for (let s = wMin; s <= wMax; s++)
      for (let d = uMin; d <= uMax; d++) {
        if ((s + d) & 1) continue;
        this.cell(g, (s + d) / 2, (s - d) / 2, cs, view);
      }
    for (const a of Object.values(AIRFIELDS)) this.airfield(g, a);
    this.buildings(g, view, cs);
  }

  /** Grid corner with its elevation; off the map the sea continues. */
  private corner(i: number, j: number, cs: number): Corner {
    const key = i * 1_000_003 + j;
    const hit = this.corners.get(key);
    if (hit) return hit;
    const x = i * cs,
      y = j * cs;
    const outside = x < 0 || y < 0 || x > MAP_SIZE || y > MAP_SIZE;
    const c = { x, y, h: outside ? -80 : terrainHeight(x, y) };
    this.corners.set(key, c);
    return c;
  }

  private cell(
    g: Phaser.GameObjects.Graphics,
    i: number,
    j: number,
    cs: number,
    view: Phaser.Geom.Rectangle,
  ) {
    const a = this.corner(i, j, cs),
      b = this.corner(i + 1, j, cs),
      c = this.corner(i + 1, j + 1, cs),
      d = this.corner(i, j + 1, cs);
    const at = (p: Corner) => iso(p.x, p.y, Math.max(0, p.h));
    const pa = at(a),
      pb = at(b),
      pc = at(c),
      pd = at(d);
    const top = Math.min(pa.y, pb.y, pc.y, pd.y),
      bottom = Math.max(pa.y, pb.y, pc.y, pd.y);
    if (bottom < view.y || top > view.bottom || pd.x > view.right || pb.x < view.x) return;
    // Split along the diagonal that follows the terrain better.
    const alongAC = Math.abs(a.h - c.h) <= Math.abs(b.h - d.h);
    const tris: [Corner, Corner, Corner, typeof pa, typeof pa, typeof pa][] = alongAC
      ? [
          [a, b, c, pa, pb, pc],
          [a, c, d, pa, pc, pd],
        ]
      : [
          [a, b, d, pa, pb, pd],
          [b, c, d, pb, pc, pd],
        ];
    for (const [p, q, r, sp, sq, sr] of tris) {
      const h = (p.h + q.h + r.h) / 3;
      const mx = (p.x + q.x + r.x) / 3,
        my = (p.y + q.y + r.y) / 3;
      let color: number;
      if (Math.max(p.h, q.h, r.h) <= 0) {
        // Sea: flat, with a faint facet pattern instead of waves.
        color = shade(
          groundColor(mx, my, h, 0),
          0.96 + cellHash(i * 2 + (sp === pa ? 0 : 1), j, 11) * 0.06,
        );
      } else {
        // Facet normal from the real (unflattened) heights, for the stepped light.
        const z = (v: Corner) => Math.max(0, v.h);
        const ux = q.x - p.x,
          uy = q.y - p.y,
          uz = z(q) - z(p);
        const vx = r.x - p.x,
          vy = r.y - p.y,
          vz = z(r) - z(p);
        let nx = uy * vz - uz * vy,
          ny = uz * vx - ux * vz,
          nz = ux * vy - uy * vx;
        if (nz < 0) {
          nx = -nx;
          ny = -ny;
          nz = -nz;
        }
        const n = Math.hypot(nx, ny, nz) || 1;
        const slope = Math.hypot(nx, ny) / nz;
        const lit = (nx * LIGHT[0] + ny * LIGHT[1] + nz * LIGHT[2]) / n;
        const k = Math.round((0.62 + 0.45 * Math.max(0, lit)) * 20) / 20;
        color = shade(groundColor(mx, my, h, slope), k);
      }
      polygon(g, [sp, sq, sr], color);
    }
  }

  private airfield(g: Phaser.GameObjects.Graphics, a: Airfield) {
    const rect = (along0: number, along1: number, across0: number, across1: number) =>
      [
        runwayWorld(a, along0, across0),
        runwayWorld(a, along1, across0),
        runwayWorld(a, along1, across1),
        runwayWorld(a, along0, across1),
      ].map((p) => iso(p.x, p.y, a.elevation));
    const half = a.length / 2,
      w = a.width / 2;
    polygon(g, rect(-half - 60, half + 60, -w - 12, w + 12), 0x8d8a78);
    polygon(g, rect(-half, half, -w, w), 0x4a4d4c);
    const ap = a.apronOffset,
      ad = a.apronDepth / 2,
      al = a.apronLength / 2;
    polygon(g, rect(-al, al, ap - ad, ap + ad), 0x6b6c66);
    polygon(g, rect(-40, 40, Math.min(ap, 0), Math.max(ap, 0)), 0x6b6c66);
    for (let s = -half + 120; s < half - 120; s += 90)
      polygon(g, rect(s, s + 45, -0.6, 0.6), 0xe3e3d6);
    for (const end of [-half + 8, half - 38])
      for (let k = -w + 4; k < w - 4; k += 6) polygon(g, rect(end, end + 30, k, k + 3), 0xe3e3d6);
    const mark = runwayWorld(a, -half - 120, 0);
    const p = iso(mark.x, mark.y, a.elevation);
    g.lineStyle(2, a.side === 'blue' ? 0x2a8fb2 : 0xd0533c, 0.9);
    g.strokeCircle(p.x, p.y, 14);
  }

  /** Whitewashed coastal town: low boxes with terracotta and pale roofs. */
  private buildings(g: Phaser.GameObjects.Graphics, view: Phaser.Geom.Rectangle, cs: number) {
    if (cs > 200) return;
    const c = cityCentre();
    const c0 = iso(c.x, c.y);
    if (
      c0.x + c.radius * 2 < view.x ||
      c0.x - c.radius * 2 > view.right ||
      c0.y + c.radius < view.y ||
      c0.y - c.radius > view.bottom
    )
      return;
    const i0 = Math.floor((c.x - c.radius) / BLOCK),
      i1 = Math.ceil((c.x + c.radius) / BLOCK);
    const j0 = Math.floor((c.y - c.radius) / BLOCK),
      j1 = Math.ceil((c.y + c.radius) / BLOCK);
    for (let s = i0 + j0; s <= i1 + j1; s++)
      for (let i = Math.max(i0, s - j1); i <= Math.min(i1, s - j0); i++) {
        const b = buildingAt(i, s - i);
        if (!b) continue;
        const p = iso(b.x, b.y, b.base);
        if (
          p.x < view.x - 150 ||
          p.x > view.right + 150 ||
          p.y < view.y - 50 ||
          p.y > view.bottom + 150
        )
          continue;
        box(
          g,
          b.x,
          b.y,
          b.width,
          b.depth,
          b.base,
          b.height,
          [0xe8e2d3, 0xd9cdb4, 0xc98b61][(i * 7 + s) % 3],
        );
      }
  }
}

import Phaser from 'phaser';
import { iso } from '../world/projection';

export type Point = { x: number; y: number };

export function shade(color: number, k: number) {
  const r = Math.min(255, Math.max(0, Math.round(((color >> 16) & 255) * k)));
  const g = Math.min(255, Math.max(0, Math.round(((color >> 8) & 255) * k)));
  const b = Math.min(255, Math.max(0, Math.round((color & 255) * k)));
  return (r << 16) | (g << 8) | b;
}
export function mix(a: number, b: number, t: number) {
  const c = (s: number) =>
    Math.round(((a >> s) & 255) + (((b >> s) & 255) - ((a >> s) & 255)) * t) << s;
  return c(16) | c(8) | c(0);
}

export function polygon(g: Phaser.GameObjects.Graphics, pts: Point[], color: number, alpha = 1) {
  g.fillStyle(color, alpha);
  g.fillPoints(pts, true);
}

/**
 * Iso box standing on the ground at elevation `base`. Height is drawn 1:1 (local objects),
 * while the base elevation goes through the compressed altitude projection.
 */
export function box(
  g: Phaser.GameObjects.Graphics,
  x: number,
  y: number,
  w: number,
  d: number,
  base: number,
  h: number,
  color: number,
) {
  const a = iso(x, y, base),
    b = iso(x + w, y, base),
    c = iso(x + w, y + d, base),
    e = iso(x, y + d, base);
  const up = (p: Point) => ({ x: p.x, y: p.y - h });
  polygon(g, [e, c, up(c), up(e)], shade(color, 0.72));
  polygon(g, [b, c, up(c), up(b)], shade(color, 0.56));
  polygon(g, [up(a), up(b), up(c), up(e)], color);
}

/**
 * Minimal triangle rasteriser for the hangar's low-resolution buffer. Canvas 2D paths are
 * antialiased, which leaves hairline seams between facets; filling pixel centres gives the
 * same crisp edges as the WebGL battle view. With a depth buffer (`z` per corner, larger is
 * nearer) overlapping parts resolve per pixel, independent of drawing order.
 */
export function fillTriangle(
  img: ImageData,
  p: readonly { x: number; y: number }[],
  color: number,
  depth?: { z: readonly number[]; buffer: Float32Array },
  /** Below 1: blended over what is drawn, depth-tested but not written (see-through). */
  alpha = 1,
) {
  const { width: w, height: h } = img;
  const px = new Uint32Array(img.data.buffer);
  const [a, b, c] = p;
  const area = (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
  if (Math.abs(area) < 1e-6) return;
  const s = area > 0 ? 1 : -1;
  const x0 = Math.max(0, Math.floor(Math.min(a.x, b.x, c.x))),
    x1 = Math.min(w - 1, Math.ceil(Math.max(a.x, b.x, c.x))),
    y0 = Math.max(0, Math.floor(Math.min(a.y, b.y, c.y))),
    y1 = Math.min(h - 1, Math.ceil(Math.max(a.y, b.y, c.y)));
  // Canvas pixels are RGBA bytes: little-endian 0xAABBGGRR.
  const abgr = 0xff000000 | ((color & 0xff) << 16) | (color & 0xff00) | ((color >> 16) & 0xff);
  const edge = (p: { x: number; y: number }, q: { x: number; y: number }, x: number, y: number) =>
    ((q.x - p.x) * (y - p.y) - (q.y - p.y) * (x - p.x)) * s;
  for (let y = y0; y <= y1; y++) {
    const cy = y + 0.5;
    for (let x = x0; x <= x1; x++) {
      const cx = x + 0.5;
      const w0 = edge(b, c, cx, cy),
        w1 = edge(c, a, cx, cy),
        w2 = edge(a, b, cx, cy);
      if (w0 < 0 || w1 < 0 || w2 < 0) continue;
      const i = y * w + x;
      if (depth) {
        const z = (w0 * depth.z[0] + w1 * depth.z[1] + w2 * depth.z[2]) / (area * s);
        if (z < depth.buffer[i]) continue;
        if (alpha >= 1) depth.buffer[i] = z;
      }
      if (alpha >= 1) px[i] = abgr;
      else {
        const o = px[i];
        const mix = (shift: number) =>
          Math.round(((o >>> shift) & 0xff) * (1 - alpha) + ((abgr >>> shift) & 0xff) * alpha) <<
          shift;
        px[i] = (0xff000000 | mix(16) | mix(8) | mix(0)) >>> 0;
      }
    }
  }
}

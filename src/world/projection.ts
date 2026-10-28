/**
 * Isometric projection. Horizontal distances are 1:1 (1 world metre ≈ 1 px before camera
 * zoom). Altitude is compressed logarithmically for display only — otherwise an aircraft at
 * 5 km would be drawn 5000 px away from its shadow. The simulation never uses these values.
 */
const HEIGHT_SCALE = 80;
const HEIGHT_KNEE = 120;

export function visualHeight(z: number) {
  return z <= 0 ? z * 0.3 : HEIGHT_SCALE * Math.log1p(z / HEIGHT_KNEE);
}

export function iso(x: number, y: number, z = 0) {
  return { x: x - y, y: (x + y) * 0.5 - visualHeight(z) };
}

/** Screen offset of a small world-space vector (used for aircraft shapes, 1:1 in height). */
export function isoOffset(dx: number, dy: number, dz: number) {
  return { x: dx - dy, y: (dx + dy) * 0.5 - dz };
}

/** Inverse projection of a screen point onto the ground plane at a given elevation. */
export function groundFromScreen(sx: number, sy: number, z = 0) {
  const w = sy + visualHeight(z);
  return { x: w + sx / 2, y: w - sx / 2 };
}

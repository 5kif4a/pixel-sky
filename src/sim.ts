export type Vec = { x: number; y: number; z: number };
export type Model = 'F-16' | 'MiG-35';
export const SPECS = {
  'F-16': { speed: 175, turn: 1.65, hp: 100 },
  'MiG-35': { speed: 163, turn: 1.43, hp: 125 },
};
export const WORLD = 2304;
export function iso(x: number, y: number, z = 0) {
  return { x: x - y, y: (x + y) * 0.5 - z };
}
export function distance(a: Vec, b: Vec) {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}
export function angleDiff(a: number, b: number) {
  return Math.atan2(Math.sin(b - a), Math.cos(b - a));
}
export function steer(a: number, b: number, max: number) {
  return a + Math.max(-max, Math.min(max, angleDiff(a, b)));
}
export function segmentDistance(a: Vec, b: Vec, p: Vec) {
  const dx = b.x - a.x,
    dy = b.y - a.y,
    dz = b.z - a.z;
  const len = dx * dx + dy * dy + dz * dz;
  const t =
    len === 0
      ? 0
      : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy + (p.z - a.z) * dz) / len));
  return Math.hypot(p.x - a.x - dx * t, p.y - a.y - dy * t, p.z - a.z - dz * t);
}
export function bombImpact(p: Vec, heading: number, speed: number) {
  const time = Math.sqrt((2 * Math.max(0, p.z)) / 90);
  return {
    x: p.x + Math.cos(heading) * speed * time,
    y: p.y + Math.sin(heading) * speed * time,
    z: 0,
  };
}

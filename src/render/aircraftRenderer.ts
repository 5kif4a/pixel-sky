import Phaser from 'phaser';
import { bodyAxes, type Aircraft, type Axes } from '../entities/aircraft';
import { groundHeight } from '../world/terrain';
import { iso, isoOffset } from '../world/projection';
import { polygon, shade, type Point } from './draw';
import { aircraftMesh, meshColor, projectMesh, storeShown } from './mesh';

/** Towards the viewer of the isometric battle view, and towards the sun. */
const ISO_VIEW = normalize({ x: 1, y: 1, z: 1 });
const SUN = normalize({ x: -0.6, y: -0.25, z: 0.9 });
import { normalize } from '../world/math';

type Project = (u: number, v: number, w: number) => Point;

function outline(project: Project, coords: number[], mirrorV = false) {
  const pts: Point[] = [];
  for (let i = 0; i < coords.length; i += 2)
    pts.push(project(coords[i], mirrorV ? -coords[i + 1] : coords[i + 1], 0));
  return pts;
}

/** Low-poly aircraft: flat-shaded triangles sorted far to near. */
function drawMesh(
  g: Phaser.GameObjects.Graphics,
  a: Aircraft,
  axes: Axes,
  project: (dx: number, dy: number, dz: number) => Point,
) {
  const mesh = aircraftMesh(a.spec.id);
  const tris = projectMesh(
    mesh,
    axes,
    (d) => project(d.x, d.y, d.z),
    ISO_VIEW,
    SUN,
    (t, k) => shade(a.alive ? meshColor(mesh, t.mat, a.side) : 0x4a4d4b, k),
    (t) => storeShown(t, a.missiles, a.gearPos > 0.5),
  );
  for (const t of tris) {
    g.fillStyle(t.color);
    g.fillTriangle(t.pts[0].x, t.pts[0].y, t.pts[1].x, t.pts[1].y, t.pts[2].x, t.pts[2].y);
  }
}

/** Draws the aircraft 1:1, rotated by heading, pitch and bank. */
export function drawAircraft(
  g: Phaser.GameObjects.Graphics,
  a: Aircraft,
  time: number,
  zoom: number,
) {
  const axes: Axes = bodyAxes(a);
  const sil = a.spec.silhouette;
  const center = iso(a.pos.x, a.pos.y, a.pos.z);
  const project = (dx: number, dy: number, dz: number) => {
    const o = isoOffset(dx, dy, dz);
    return { x: center.x + o.x, y: center.y + o.y };
  };
  const body: Project = (u, v, w) =>
    project(
      axes.forward.x * u + axes.right.x * v + axes.up.x * w,
      axes.forward.y * u + axes.right.y * v + axes.up.y * w,
      axes.forward.z * u + axes.right.z * v + axes.up.z * w,
    );

  // Shadow: the outline flattened onto the ground below.
  const ground = groundHeight(a.pos.x, a.pos.y);
  const sc = iso(a.pos.x, a.pos.y, ground);
  const flat: Project = (u, v) => {
    const o = isoOffset(
      axes.forward.x * u + axes.right.x * v,
      axes.forward.y * u + axes.right.y * v,
      0,
    );
    return { x: sc.x + o.x, y: sc.y + o.y };
  };
  const shadowAlpha = Math.max(0.12, 0.4 - (a.pos.z - ground) / 6000);
  polygon(g, outline(flat, sil.fuselage), 0x0d1d22, shadowAlpha);
  polygon(g, outline(flat, sil.wing), 0x0d1d22, shadowAlpha);
  polygon(g, outline(flat, sil.wing, true), 0x0d1d22, shadowAlpha);

  if (!a.alive && !a.falling) {
    polygon(g, outline(body, sil.fuselage), 0x262b2b);
    return;
  }
  drawMesh(g, a, axes, project);
  // Engine glow and afterburner plume.
  for (let i = 0; i < sil.nozzles.length; i += 2) {
    const u = sil.nozzles[i],
      v = sil.nozzles[i + 1];
    const len = a.afterburner ? 4 + Math.sin(time * 40 + i) * 1.2 : a.throttle > 0.5 ? 1.2 : 0;
    if (len <= 0 || !a.alive) continue;
    const p0 = body(u, v - 0.35, 0),
      p1 = body(u - len, v, 0),
      p2 = body(u, v + 0.35, 0);
    polygon(g, [p0, p1, p2], a.afterburner ? 0xffb35c : 0xffd79a, 0.9);
  }
  // Navigation light on the wingtip: red left, green right.
  const tip = sil.wing.length - 4;
  const l = body(sil.wing[tip], sil.wing[tip + 1], 0.12),
    r = body(sil.wing[tip], -sil.wing[tip + 1], 0.12);
  // One game pixel whatever the zoom, not one world metre (which grows with zoom).
  const dot = 1 / zoom;
  g.fillStyle(0xff5040);
  g.fillRect(l.x - dot / 2, l.y - dot / 2, dot, dot);
  g.fillStyle(0x7dff8a);
  g.fillRect(r.x - dot / 2, r.y - dot / 2, dot, dot);
}

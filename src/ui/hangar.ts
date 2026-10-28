import { AIRCRAFT, type AircraftId } from '../data/aircraft';
import { GUNS, MISSILES } from '../data/weapons';
import { MISSION_WEATHER } from '../data/mission';
import { windAxes, type Axes } from '../entities/aircraft';
import { pixelSize } from '../game/config';
import { t } from '../i18n';
import { shade } from '../render/draw';
import { aircraftMesh, meshColor, projectMesh, type MeshTri } from '../render/mesh';
import type { Mesh } from '../render/meshBuilder';
import { fillTriangle } from '../render/raster';
import { liftCoefficient } from '../systems/flight';
import { atmosphere } from '../world/atmosphere';
import { G, clamp, cross, dot, normalize, sub, type Vec3 } from '../world/math';

const DEG = Math.PI / 180;
/** Towards the sun: high, on the camera's side of the aircraft by default. */
const SUN = normalize({ x: 0.55, y: 0.35, z: 0.75 });
const IDENTITY: Axes = {
  forward: { x: 1, y: 0, z: 0 },
  right: { x: 0, y: 1, z: 0 },
  up: { x: 0, y: 0, z: 1 },
};
/** Orbit centre: the middle of the parked aircraft, a little above the ground. */
const CENTRE = { x: 1, y: 0, z: 1.8 };

type Point = { x: number; y: number };
interface Camera {
  view: Vec3;
  right: Vec3;
  up: Vec3;
}
/** Orthographic camera; `view` points from the scene towards the viewer. */
function camera(azimuth: number, elevation: number): Camera {
  const view = {
    x: Math.cos(elevation) * Math.cos(azimuth),
    y: Math.cos(elevation) * Math.sin(azimuth),
    z: Math.sin(elevation),
  };
  const back = { x: -view.x, y: -view.y, z: -view.z };
  const right = normalize(cross(back, { x: 0, y: 0, z: 1 }));
  return { view, right, up: cross(right, back) };
}

/** Aircraft triangles; `project` maps offsets from the body origin (world axes) to the screen. */
function aircraftTris(
  id: AircraftId,
  axes: Axes,
  project: (d: Vec3) => Point,
  view: Vec3,
  showGear: boolean,
): MeshTri[] {
  const mesh = aircraftMesh(id);
  return projectMesh(
    mesh,
    axes,
    project,
    view,
    SUN,
    (tr, k) => shade(meshColor(mesh, tr.mat, 'blue'), k),
    (tr) => showGear || !tr.gear,
  );
}

/** Height of the body origin above the ground when standing on its wheels. */
function restHeight(id: AircraftId) {
  return -Math.min(...aircraftMesh(id).verts.map((v) => v.z));
}

/**
 * Main menu scene: the selected aircraft parked on the open apron, in the
 * sun. Drag orbits the camera round the aircraft, the wheel zooms. Rendered in software at
 * the game's pixel size with a depth buffer; shadows are projected onto the ground.
 */
export class HangarView {
  private buffer = document.createElement('canvas');
  private shadow = document.createElement('canvas');
  private aircraft: AircraftId = 'MiG-35';
  private azimuth = 35 * DEG;
  private elevation = 16 * DEG;
  private zoom = 1;
  private drag?: { x: number; y: number };
  private idle = 0;
  private running = false;
  private icons = new Map<AircraftId, string>();

  constructor(
    private canvas: HTMLCanvasElement,
    private specs: HTMLElement,
  ) {
    canvas.addEventListener('pointerdown', (e) => {
      this.drag = { x: e.clientX, y: e.clientY };
      canvas.setPointerCapture(e.pointerId);
    });
    canvas.addEventListener('pointermove', (e) => {
      if (!this.drag) return;
      const dx = e.clientX - this.drag.x,
        dy = e.clientY - this.drag.y;
      this.drag.x = e.clientX;
      this.drag.y = e.clientY;
      this.azimuth -= dx * 0.008;
      this.elevation = clamp(this.elevation + dy * 0.006, 3 * DEG, 80 * DEG);
      this.idle = 0;
    });
    const stop = () => (this.drag = undefined);
    canvas.addEventListener('pointerup', stop);
    canvas.addEventListener('pointercancel', stop);
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    canvas.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault();
        this.zoom = clamp(this.zoom * (e.deltaY > 0 ? 0.9 : 1.1), 0.55, 3);
        this.idle = 0;
      },
      { passive: false },
    );
  }

  show(id: AircraftId) {
    this.aircraft = id;
    this.renderSpecs();
    if (this.running) return;
    this.running = true;
    let last = performance.now();
    const loop = (now: number) => {
      if (!this.running) return;
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      this.idle += dt;
      // Slow orbit while nobody touches the camera.
      if (!this.drag && this.idle > 4) this.azimuth += dt * 0.06;
      this.draw();
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  }

  hide() {
    this.running = false;
  }

  /** Card icon: the aircraft in flight, isometric from the front-right, as a data URL. */
  icon(id: AircraftId) {
    const hit = this.icons.get(id);
    if (hit) return hit;
    const w = 112,
      h = 64;
    const cam = camera(35 * DEG, 28 * DEG);
    const raw = aircraftTris(
      id,
      IDENTITY,
      (d) => ({ x: dot(d, cam.right), y: -dot(d, cam.up) }),
      cam.view,
      false,
    );
    const xs = raw.flatMap((tr) => tr.pts.map((p) => p.x)),
      ys = raw.flatMap((tr) => tr.pts.map((p) => p.y));
    const x0 = Math.min(...xs),
      x1 = Math.max(...xs),
      y0 = Math.min(...ys),
      y1 = Math.max(...ys);
    const k = Math.min((w * 0.94) / (x1 - x0), (h * 0.94) / (y1 - y0));
    const ox = (w - (x1 - x0) * k) / 2 - x0 * k,
      oy = (h - (y1 - y0) * k) / 2 - y0 * k;
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    const ctx = c.getContext('2d')!;
    const img = ctx.createImageData(w, h);
    const buffer = new Float32Array(w * h).fill(-Infinity);
    for (const tr of raw)
      fillTriangle(
        img,
        tr.pts.map((p) => ({ x: p.x * k + ox, y: p.y * k + oy })),
        tr.color,
        { z: tr.z, buffer },
      );
    ctx.putImageData(img, 0, 0);
    const url = c.toDataURL();
    this.icons.set(id, url);
    return url;
  }

  renderSpecs() {
    const s = AIRCRAFT[this.aircraft];
    const gun = GUNS[s.gun];
    const kn = (n: number) => (n / 1000).toFixed(1);
    const loaded =
      s.emptyMass +
      100 +
      s.internalFuel +
      s.gunRounds * gun.roundMass +
      s.missileCount * MISSILES[s.missile].mass;
    // Instantaneous level turn at a common speed/altitude, using the flight model's limits.
    const speed = 900 / 3.6;
    const air = atmosphere(3000, MISSION_WEATHER);
    const lift =
      0.5 * air.density * speed ** 2 * s.wingArea * liftCoefficient(s, s.fcsAlphaLimit * DEG, 0);
    const load = Math.max(1, Math.min(s.gLimit, lift / (loaded * G)));
    const turnRate = (G * Math.sqrt(load ** 2 - 1)) / speed / DEG;
    const detail = (text: string) => `<small class="spec-detail">${text}</small>`;
    const rows: [string, string][] = [
      [
        t('spec.maxSpeed'),
        `${s.reference.seaLevelSpeed} / ${s.reference.altitudeSpeed} ${t('spec.kmh')}`,
      ],
      [t('spec.massLoaded'), `${Math.round(loaded).toLocaleString()} ${t('hud.kg')}`],
      [
        t('spec.engineType'),
        `${s.engineCount}× ${s.engineType}` +
          detail(
            t('spec.engineThrust', {
              dry: kn(s.dryThrust * s.engineCount),
              ab: kn(s.afterburnerThrust * s.engineCount),
            }),
          ),
      ],
      [
        t('spec.turnRate'),
        `${turnRate.toFixed(1)} ${t('spec.degPerSecond')}` + detail(t('spec.turnConditions')),
      ],
      [
        t('spec.gun'),
        `${t('weapon.' + s.gun)} · ${gun.caliber} ${t('spec.mm')}` +
          detail(t('spec.rounds', { count: s.gunRounds })),
      ],
      [t('spec.airToAirMissiles'), `${s.missileCount}× ${t('weapon.' + s.missile)}`],
      [t('spec.flares'), `${s.flares}${s.flarePower > 1 ? ' · ' + t('spec.flaresLarge') : ''}`],
    ];
    this.specs.innerHTML =
      `<div class="hangar-title">${t('aircraft.' + s.id)}</div>` +
      rows.map(([k, v]) => `<div><span>${k}</span><b>${v}</b></div>`).join('');
  }

  private draw() {
    const pixel = pixelSize();
    const cw = this.canvas.clientWidth,
      ch = this.canvas.clientHeight;
    if (!cw || !ch) return;
    if (this.canvas.width !== cw || this.canvas.height !== ch) {
      this.canvas.width = cw;
      this.canvas.height = ch;
    }
    const w = Math.ceil(cw / pixel),
      h = Math.ceil(ch / pixel);
    for (const c of [this.buffer, this.shadow])
      if (c.width !== w || c.height !== h) {
        c.width = w;
        c.height = h;
      }
    const ctx = this.buffer.getContext('2d', { willReadFrequently: true })!;
    const id = this.aircraft;
    const cam = camera(this.azimuth, this.elevation);
    const plane = { x: 0, y: 0, z: restHeight(id) };
    const axes = windAxes(0, 0, 0);
    const scale = (h / 26) * this.zoom;
    const cx = w / 2,
      cy = h * 0.55;
    const project = (p: Vec3): Point => {
      const d = sub(p, CENTRE);
      return { x: cx + dot(d, cam.right) * scale, y: cy - dot(d, cam.up) * scale };
    };
    const fromPlane = (d: Vec3) =>
      project({ x: plane.x + d.x, y: plane.y + d.y, z: plane.z + d.z });
    const path = (pts: Vec3[]) => {
      ctx.beginPath();
      pts.forEach((p, i) => {
        const q = project(p);
        if (i) ctx.lineTo(q.x, q.y);
        else ctx.moveTo(q.x, q.y);
      });
    };
    const flat = (x0: number, y0: number, x1: number, y1: number) => [
      { x: x0, y: y0, z: 0 },
      { x: x1, y: y0, z: 0 },
      { x: x1, y: y1, z: 0 },
      { x: x0, y: y1, z: 0 },
    ];

    // Sky, then the ground as a backdrop: nothing stands below it.
    const sky = ctx.createLinearGradient(0, 0, 0, h);
    sky.addColorStop(0, '#5f93b8');
    sky.addColorStop(1, '#c9dbe2');
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, w, h);
    // Grass in bands fading into haze with distance: an orthographic camera has no
    // horizon, so the far bands stand in for it when the camera is low.
    const bands: [number, string][] = [
      [900, '#b7cdd2'],
      [520, '#9fb8a8'],
      [330, '#86a37a'],
      [200, '#76955a'],
      [120, '#6f8f4e'],
    ];
    for (const [r, color] of bands) {
      ctx.fillStyle = color;
      path(flat(-r, -r, r, r));
      ctx.fill();
    }
    ctx.fillStyle = '#9a9c96';
    const apronHalf = 60;
    path(flat(-apronHalf, -apronHalf, apronHalf, apronHalf));
    ctx.fill();
    // Concrete slabs, joints every 7.5 m.
    ctx.strokeStyle = 'rgba(60,62,58,0.35)';
    ctx.lineWidth = 1;
    for (let x = -apronHalf; x <= apronHalf; x += 7.5) {
      path([
        { x, y: -apronHalf, z: 0 },
        { x, y: apronHalf, z: 0 },
      ]);
      ctx.stroke();
    }
    for (let y = -apronHalf; y <= apronHalf; y += 7.5) {
      path([
        { x: -apronHalf, y, z: 0 },
        { x: apronHalf, y, z: 0 },
      ]);
      ctx.stroke();
    }
    // Yellow taxi line across the apron and a stop bar ahead of the nose wheel.
    ctx.fillStyle = '#d8b63c';
    path(flat(-apronHalf, -0.15, apronHalf, 0.15));
    ctx.fill();
    path(flat(6.2, -2.5, 6.6, 2.5));
    ctx.fill();

    // Shadows: triangles flattened onto the ground along the sun, drawn opaque on their own
    // layer and laid over the ground once, so overlapping triangles do not darken.
    const sh = this.shadow.getContext('2d')!;
    sh.clearRect(0, 0, w, h);
    sh.fillStyle = '#000';
    const toGround = (p: Vec3) =>
      project({ x: p.x - (SUN.x * p.z) / SUN.z, y: p.y - (SUN.y * p.z) / SUN.z, z: 0 });
    const body = (v: Vec3) => ({
      x: plane.x + axes.forward.x * v.x + axes.right.x * v.y + axes.up.x * v.z,
      y: plane.y + axes.forward.y * v.x + axes.right.y * v.y + axes.up.y * v.z,
      z: plane.z + axes.forward.z * v.x + axes.right.z * v.y + axes.up.z * v.z,
    });
    const castShadow = (m: Mesh, place: (v: Vec3) => Vec3) => {
      const pts = m.verts.map((v) => toGround(place(v)));
      for (const tr of m.tris) {
        sh.beginPath();
        sh.moveTo(pts[tr.a].x, pts[tr.a].y);
        sh.lineTo(pts[tr.b].x, pts[tr.b].y);
        sh.lineTo(pts[tr.c].x, pts[tr.c].y);
        sh.fill();
      }
    };
    castShadow(aircraftMesh(id), body);
    ctx.globalAlpha = 0.34;
    ctx.drawImage(this.shadow, 0, 0);
    ctx.globalAlpha = 1;

    // Aircraft facets through a depth buffer; the apron remains open from every angle.
    const img = ctx.getImageData(0, 0, w, h);
    const buffer = new Float32Array(w * h).fill(-Infinity);
    const depthOf = (p: Vec3) => dot(sub(p, CENTRE), cam.view);
    const fill = (tris: MeshTri[], offset: number, alpha = 1) => {
      for (const tr of tris)
        fillTriangle(img, tr.pts, tr.color, { z: tr.z.map((z) => z + offset), buffer }, alpha);
    };
    fill(aircraftTris(id, axes, fromPlane, cam.view, true), depthOf(plane));
    ctx.putImageData(img, 0, 0);
    const out = this.canvas.getContext('2d')!;
    out.imageSmoothingEnabled = false;
    out.drawImage(this.buffer, 0, 0, w * pixel, h * pixel);
  }
}

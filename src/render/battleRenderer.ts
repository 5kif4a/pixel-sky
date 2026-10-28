import Phaser from 'phaser';
import { AIRFIELDS, MAP_SIZE, type Airfield } from '../data/mission';
import { bodyAxes, bodyToWorld, type Aircraft } from '../entities/aircraft';
import type { Particles } from '../effects/particles';
import type { Battle } from '../systems/battle';
import { addScaled, clamp, cross, dot, normalize, sub, type Vec3 } from '../world/math';
import {
  BLOCK,
  buildingAt,
  cellHash,
  cityCentre,
  groundHeight,
  runwayWorld,
  terrainHeight,
} from '../world/terrain';
import { ChaseCamera } from './chaseCamera';
import { mix, shade } from './draw';
import { aircraftMesh, meshColor, storeShown } from './mesh';
import { fillTriangle } from './raster';
import { groundColor } from './terrainRenderer';

const SUN = normalize({ x: -0.6, y: -0.25, z: 0.9 });
const HAZE = 0xb4d0db;
const abgr = (c: number) =>
  (0xff000000 | ((c & 255) << 16) | (c & 0xff00) | ((c >> 16) & 255)) >>> 0;

/** Pixel-resolution perspective rasterizer. Reciprocal depth keeps all geometry occluded correctly. */
export class BattleRenderer {
  readonly camera = new ChaseCamera();
  private texture: Phaser.Textures.CanvasTexture;
  private image: Phaser.GameObjects.Image;
  private frame!: ImageData;
  private depth = new Float32Array(0);
  private terrain = new Map<string, Vec3>();

  constructor(scene: Phaser.Scene) {
    this.texture = scene.textures.createCanvas('battle-perspective', 1, 1)!;
    this.texture.setFilter(Phaser.Textures.FilterMode.NEAREST);
    this.image = scene.add.image(0, 0, this.texture).setOrigin(0).setDepth(0);
  }

  resize(width: number, height: number) {
    this.camera.resize(width, height);
    if (this.frame?.width === width && this.frame.height === height) return;
    this.texture.setSize(width, height);
    this.image.setDisplaySize(width, height);
    this.frame = this.texture.context.createImageData(width, height);
    this.depth = new Float32Array(width * height);
  }

  private triangle(vertices: Vec3[], color: number, alpha = 1, fog = true) {
    const camera = this.camera;
    let points = vertices.map((v) => camera.cameraPoint(v));
    if (points.every((p) => p.z < camera.near)) return;
    // Clip triangles crossing the eye plane instead of dropping terrain under the camera.
    const clipped: Vec3[] = [];
    for (let i = 0; i < points.length; i++) {
      const a = points[i],
        b = points[(i + 1) % points.length];
      const inside = a.z >= camera.near;
      if (inside) clipped.push(a);
      if (inside !== b.z >= camera.near) {
        const k = (camera.near - a.z) / (b.z - a.z);
        clipped.push({ x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k, z: camera.near });
      }
    }
    points = clipped;
    if (points.length < 3) return;
    const projected = points.map((p) => camera.projectCamera(p));
    if (
      projected.every((p) => p.x < 0) ||
      projected.every((p) => p.x > camera.width) ||
      projected.every((p) => p.y < 0) ||
      projected.every((p) => p.y > camera.height)
    )
      return;
    const distance = points.reduce((n, p) => n + p.z, 0) / points.length;
    const tint = fog ? mix(color, HAZE, clamp((distance - 3000) / 42000, 0, 0.96)) : color;
    for (let i = 1; i < points.length - 1; i++) {
      const indices = [0, i, i + 1];
      fillTriangle(
        this.frame,
        indices.map((j) => projected[j]),
        tint,
        { z: indices.map((j) => 1 / points[j].z), buffer: this.depth },
        alpha,
      );
    }
  }

  private quad(a: Vec3, b: Vec3, c: Vec3, d: Vec3, color: number) {
    this.triangle([a, b, c], color);
    this.triangle([a, c, d], color);
  }

  private corner(x: number, y: number) {
    const key = `${x},${y}`;
    let p = this.terrain.get(key);
    if (!p) {
      const outside = x < 0 || y < 0 || x > MAP_SIZE || y > MAP_SIZE;
      p = { x, y, z: outside ? 0 : Math.max(0, terrainHeight(x, y)) };
      this.terrain.set(key, p);
    }
    return p;
  }

  private landscape(player: Aircraft) {
    const { x: px, y: py } = player.pos;
    // The sea continues to a distant horizon beyond the test map.
    const r = 180000;
    this.quad(
      { x: px - r, y: py - r, z: -1 },
      { x: px + r, y: py - r, z: -1 },
      { x: px + r, y: py + r, z: -1 },
      { x: px - r, y: py + r, z: -1 },
      0x286582,
    );
    if (this.terrain.size > 20000) this.terrain.clear();
    const step = 1000;
    const x0 = Math.floor(px / step) * step,
      y0 = Math.floor(py / step) * step;
    for (let x = x0 - 28000; x < x0 + 28000; x += step) {
      for (let y = y0 - 28000; y < y0 + 28000; y += step) {
        const mid = { x: x + step / 2, y: y + step / 2, z: 0 };
        const cp = this.camera.cameraPoint(mid);
        if (
          cp.z < -2000 ||
          Math.abs(cp.x) >
            Math.max(2000, (cp.z * this.camera.width) / (2 * this.camera.focal) + 2500)
        )
          continue;
        const a = this.corner(x, y),
          b = this.corner(x + step, y);
        const c = this.corner(x + step, y + step),
          d = this.corner(x, y + step);
        const height = (a.z + b.z + c.z + d.z) / 4;
        const normal = normalize(cross(sub(b, a), sub(d, a)));
        const color =
          height > 0
            ? shade(
                groundColor(mid.x, mid.y, height, Math.hypot(normal.x, normal.y)),
                0.6 + Math.max(0, dot(normal, SUN)) * 0.5,
              )
            : mix(0x245e80, 0x286582, cellHash(x / step, y / step, 16) * 0.6);
        this.triangle([a, b, c], color);
        this.triangle([a, c, d], shade(color, height > 0 ? 0.96 : 1));
      }
    }
    for (const field of Object.values(AIRFIELDS)) this.airfield(field);
    const city = cityCentre();
    if (Math.hypot(px - city.x, py - city.y) < 14000) {
      for (
        let x = Math.floor((city.x - city.radius) / BLOCK);
        x <= (city.x + city.radius) / BLOCK;
        x++
      ) {
        for (
          let y = Math.floor((city.y - city.radius) / BLOCK);
          y <= (city.y + city.radius) / BLOCK;
          y++
        ) {
          const b = buildingAt(x, y);
          if (b) this.box(b.x, b.y, b.width, b.depth, b.base, b.height);
        }
      }
    }
  }

  private box(x: number, y: number, width: number, length: number, base: number, height: number) {
    const a = { x, y, z: base },
      b = { x: x + width, y, z: base };
    const c = { x: x + width, y: y + length, z: base },
      d = { x, y: y + length, z: base };
    const top = [a, b, c, d].map((p) => ({ ...p, z: base + height }));
    this.quad(...(top as [Vec3, Vec3, Vec3, Vec3]), 0xcab99a);
    const bottom = [a, b, c, d];
    for (let i = 0; i < 4; i++)
      this.quad(
        bottom[i],
        bottom[(i + 1) % 4],
        top[(i + 1) % 4],
        top[i],
        i % 2 ? 0xb9b5a3 : 0xd7ceba,
      );
  }

  private airfield(field: Airfield) {
    const rect = (s0: number, s1: number, t0: number, t1: number, color: number, height = 0.25) => {
      const points = [
        [s0, t0],
        [s1, t0],
        [s1, t1],
        [s0, t1],
      ].map(([s, t]) => ({ ...runwayWorld(field, s, t), z: field.elevation + height }));
      this.quad(...(points as [Vec3, Vec3, Vec3, Vec3]), color);
    };
    rect(-field.length / 2, field.length / 2, -field.width / 2, field.width / 2, 0x494d4b);
    rect(
      -field.apronLength / 2,
      field.apronLength / 2,
      field.apronOffset - field.apronDepth / 2,
      field.apronOffset + field.apronDepth / 2,
      0x6b6c66,
    );
    for (let s = -field.length / 2 + 100; s < field.length / 2 - 100; s += 100)
      rect(s, s + 45, -0.9, 0.9, 0xe3e3d6, 0.3);
  }

  private aircraft(a: Aircraft) {
    if (!a.alive && !a.falling) return;
    const mesh = aircraftMesh(a.spec.id),
      axes = bodyAxes(a);
    const rotate = (p: Vec3): Vec3 => ({
      x: axes.forward.x * p.x + axes.right.x * p.y + axes.up.x * p.z,
      y: axes.forward.y * p.x + axes.right.y * p.y + axes.up.y * p.z,
      z: axes.forward.z * p.x + axes.right.z * p.y + axes.up.z * p.z,
    });
    const points = mesh.verts.map((v) => {
      const p = rotate(v);
      return { x: a.pos.x + p.x, y: a.pos.y + p.y, z: a.pos.z + p.z };
    });
    const towardCamera = sub(this.camera.pos, a.pos);
    for (const t of mesh.tris) {
      if (!storeShown(t, a.missiles, a.gearPos > 0.5)) continue;
      const n = rotate(t.n);
      if (dot(n, towardCamera) <= 0) continue;
      const light = Math.round((0.5 + Math.max(0, dot(n, SUN)) * 0.62) * 10) / 10;
      const verts = [points[t.a], points[t.b], points[t.c]];
      // Lift surface markings very slightly off their host facets to avoid z-fighting.
      this.triangle(
        t.decal ? verts.map((p) => addScaled(p, n, 0.015)) : verts,
        shade(a.alive ? meshColor(mesh, t.mat, a.side) : 0x454946, light),
      );
    }
    if (a.alive && a.afterburner) {
      for (let i = 0; i < a.spec.silhouette.nozzles.length; i += 2) {
        const p = bodyToWorld(a, axes, [
          a.spec.silhouette.nozzles[i] - 1,
          a.spec.silhouette.nozzles[i + 1],
          0,
        ]);
        this.billboard(p, 0.8, 0xffb04f, 0.9);
      }
    }
    // A small ground shadow preserves the height cue on the runway and during low passes.
    const ground = groundHeight(a.pos.x, a.pos.y);
    if (a.pos.z - ground < 300) {
      const pos = { ...a.pos, z: ground + 0.1 };
      const f = { ...axes.forward, z: 0 },
        r = { ...axes.right, z: 0 };
      const at = (u: number, v: number) => addScaled(addScaled(pos, f, u), r, v);
      this.triangle([at(8, 0), at(-4, -6), at(-4, 6)], 0x263a3e, 0.3, false);
    }
  }

  private billboard(pos: Vec3, size: number, color: number, alpha = 1) {
    const c = this.camera;
    const depth = c.cameraPoint(pos).z;
    if (depth < c.near) return;
    const radius = Math.max(size, (depth / c.focal) * 0.6);
    const at = (u: number, v: number) =>
      addScaled(addScaled(pos, c.right, radius * u), c.up, radius * v);
    this.triangle([at(-1, -1), at(1, -1), at(1, 1)], color, alpha);
    this.triangle([at(-1, -1), at(1, 1), at(-1, 1)], color, alpha);
  }

  private trail(a: Vec3, b: Vec3, color: number, width: number) {
    const camera = this.camera;
    let ca = camera.cameraPoint(a),
      cb = camera.cameraPoint(b);
    if (ca.z < camera.near && cb.z < camera.near) return;
    if (ca.z < camera.near || cb.z < camera.near) {
      const k = (camera.near - ca.z) / (cb.z - ca.z);
      const cut = { x: ca.x + (cb.x - ca.x) * k, y: ca.y + (cb.y - ca.y) * k, z: camera.near };
      if (ca.z < camera.near) ca = cut;
      else cb = cut;
    }
    const p = camera.projectCamera(ca),
      q = camera.projectCamera(cb);
    const length = Math.hypot(q.x - p.x, q.y - p.y);
    const nx = (-(q.y - p.y) / Math.max(1, length)) * width,
      ny = ((q.x - p.x) / Math.max(1, length)) * width;
    const vertices = [
      { x: p.x + nx, y: p.y + ny },
      { x: q.x + nx, y: q.y + ny },
      { x: q.x - nx, y: q.y - ny },
      { x: p.x - nx, y: p.y - ny },
    ];
    for (const ids of [
      [0, 1, 2],
      [0, 2, 3],
    ])
      fillTriangle(
        this.frame,
        ids.map((i) => vertices[i]),
        color,
        { z: ids.map((i) => 1 / (i === 0 || i === 3 ? ca.z : cb.z)), buffer: this.depth },
      );
  }

  draw(battle: Battle, particles: Particles) {
    const pixels = new Uint32Array(this.frame.data.buffer);
    for (let y = 0; y < this.frame.height; y++) {
      const z = this.camera.ray(this.frame.width / 2, y).z;
      const color = mix(HAZE, 0x477ea9, clamp(z * 1.2, 0, 1));
      pixels.fill(abgr(color), y * this.frame.width, (y + 1) * this.frame.width);
    }
    this.depth.fill(-Infinity);
    this.landscape(battle.player);
    for (const a of battle.aircraft) this.aircraft(a);
    for (const s of battle.shells)
      if (s.tracer)
        this.trail(s.prev, s.pos, s.ownerId === battle.player.id ? 0xf4ffb0 : 0xffa080, 0.5);
    for (const m of battle.missiles)
      if (m.alive) {
        this.trail(
          addScaled(m.pos, m.vel, -0.025),
          m.pos,
          m.target === battle.player ? 0xff7650 : 0xe8eee8,
          0.8,
        );
      }
    for (const f of battle.flares) this.billboard(f.pos, f.size, 0xfff0b0, Math.min(1, f.life));
    particles.forEach((p) =>
      this.billboard(p, p.size / 2, p.color, p.alpha * Math.min(1, (p.life / p.max) * 1.5)),
    );
    this.texture.context.putImageData(this.frame, 0, 0);
    this.texture.refresh();
  }
}

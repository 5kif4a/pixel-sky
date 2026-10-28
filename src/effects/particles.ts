import Phaser from 'phaser';
import type { Vec3 } from '../world/math';
import { iso } from '../world/projection';

interface Particle {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  life: number;
  max: number;
  size: number;
  grow: number;
  color: number;
  alpha: number;
}

const LIMIT = 1400;

/** Visual-only particles: smoke, fire, sparks, splashes. Not part of the simulation. */
export class Particles {
  private list: Particle[] = [];

  forEach(draw: (particle: Readonly<Particle>) => void) {
    this.list.forEach(draw);
  }

  clear() {
    this.list = [];
  }

  spawn(p: Vec3, o: Partial<Particle> & { life: number; size: number; color: number }) {
    if (this.list.length >= LIMIT) this.list.shift();
    this.list.push({
      x: p.x,
      y: p.y,
      z: p.z,
      vx: 0,
      vy: 0,
      vz: 0,
      grow: 0,
      alpha: 1,
      max: o.life,
      ...o,
    });
  }

  smoke(p: Vec3, dark: boolean, size = 4) {
    this.spawn(p, {
      life: 3 + Math.random() * 2,
      size,
      grow: 2.5,
      vz: 3,
      color: dark ? 0x30383a : 0x9aa4a3,
      alpha: 0.7,
    });
  }

  explosion(p: Vec3, size: number) {
    this.spawn(p, { life: 0.25, size: size * 1.4, grow: size * 2, color: 0xfff1c0 });
    for (let i = 0; i < 14; i++) {
      const a = Math.random() * Math.PI * 2,
        s = Math.random() * size * 1.6;
      this.spawn(p, {
        life: 0.5 + Math.random() * 0.7,
        size: size * (0.25 + Math.random() * 0.35),
        grow: size * 0.4,
        vx: Math.cos(a) * s,
        vy: Math.sin(a) * s,
        vz: Math.random() * s,
        color: i % 3 ? 0xff9b4a : 0xffd27a,
      });
    }
    for (let i = 0; i < 8; i++)
      this.spawn(p, {
        life: 3 + Math.random() * 3,
        size: size * 0.5,
        grow: size * 0.5,
        vx: (Math.random() - 0.5) * 8,
        vy: (Math.random() - 0.5) * 8,
        vz: 4 + Math.random() * 6,
        color: 0x2f3537,
        alpha: 0.75,
      });
  }

  sparks(p: Vec3) {
    for (let i = 0; i < 5; i++)
      this.spawn(p, {
        life: 0.25 + Math.random() * 0.25,
        size: 1.6,
        vx: (Math.random() - 0.5) * 60,
        vy: (Math.random() - 0.5) * 60,
        vz: (Math.random() - 0.3) * 40,
        color: 0xffe28a,
      });
  }

  splash(p: Vec3, water: boolean) {
    this.spawn(p, {
      life: 0.9,
      size: 3,
      grow: 6,
      vz: 8,
      color: water ? 0xd5ecee : 0x8b8466,
      alpha: 0.75,
    });
  }

  update(dt: number) {
    for (const p of this.list) {
      p.life -= dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.z += p.vz * dt;
      p.vx *= 1 - dt * 1.5;
      p.vy *= 1 - dt * 1.5;
      p.size += p.grow * dt;
    }
    this.list = this.list.filter((p) => p.life > 0);
  }

  draw(g: Phaser.GameObjects.Graphics, view: Phaser.Geom.Rectangle) {
    for (const p of this.list) {
      const s = iso(p.x, p.y, p.z);
      if (s.x < view.x - 50 || s.x > view.right + 50 || s.y < view.y - 50 || s.y > view.bottom + 50)
        continue;
      g.fillStyle(p.color, p.alpha * Math.min(1, (p.life / p.max) * 1.5));
      const r = Math.max(1, p.size);
      g.fillRect(Math.round(s.x - r / 2), Math.round(s.y - r / 2), Math.round(r), Math.round(r));
    }
  }
}

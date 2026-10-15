import Phaser from 'phaser';
import './style.css';
import {
  iso,
  angleDiff,
  steer,
  distance,
  segmentDistance,
  bombImpact,
  SPECS,
  WORLD,
  type Vec,
  type Model,
} from './sim';

type Aircraft = Vec & {
  heading: number;
  speed: number;
  hp: number;
  model: Model;
  enemy: boolean;
  cooldown: number;
  missiles: number;
  bombs: number;
  flares: number;
  gun: number;
};
type Projectile = Vec & {
  heading: number;
  speed: number;
  vz: number;
  life: number;
  kind: 'gun' | 'missile' | 'bomb';
  enemy: boolean;
  target?: Aircraft;
  distracted: boolean;
};
type Ground = Vec & { hp: number; name: string };
type Spark = Vec & { life: number; max: number; size: number; color: number };
const $ = (id: string) => document.getElementById(id)!;
const clamp = Phaser.Math.Clamp;
const held = new Set<string>();
let chosen: Model = 'F-16';

class Battle extends Phaser.Scene {
  player!: Aircraft;
  enemies: Aircraft[] = [];
  ground: Ground[] = [];
  shots: Projectile[] = [];
  sparks: Spark[] = [];
  ink!: Phaser.GameObjects.Graphics;
  landscape!: Phaser.GameObjects.Graphics;
  follow!: Phaser.GameObjects.Zone;
  keys = new Set<string>();
  activeBattle = false;
  paused = false;
  finished = false;
  accumulator = 0;
  elapsed = 0;
  notice = 0;
  lock = 0;
  selected?: Aircraft;
  repair = 0;
  radar = $('radar') as HTMLCanvasElement;
  create() {
    this.cameras.main.setBackgroundColor('#263f45');
    this.landscape = this.add.graphics();
    this.drawMap();
    this.ink = this.add.graphics().setDepth(10000);
    this.follow = this.add.zone(0, 1000, 1, 1);
    this.cameras.main.startFollow(this.follow, true, 0.09, 0.09);
    this.cameras.main.setZoom(1.15);
    const down = (event: KeyboardEvent) => {
      if (['Tab', 'Space', 'ArrowUp', 'ArrowDown', 'Escape'].includes(event.code))
        event.preventDefault();
      held.add(event.code);
      if (event.repeat) return;
      if (event.code === 'Escape') this.togglePause();
      if (event.code === 'KeyR' && this.activeBattle) this.start();
      this.keys.add(event.code);
    };
    const up = (event: KeyboardEvent) => held.delete(event.code);
    const blur = () => {
      held.clear();
      if (this.activeBattle && !this.finished && !this.paused) this.togglePause();
    };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    window.addEventListener('blur', blur);
    this.events.once('shutdown', () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
      window.removeEventListener('blur', blur);
    });
    this.input.on('pointerdown', (p: Phaser.Input.Pointer) => {
      if (!this.activeBattle || this.paused || this.finished) return;
      const near = this.enemies.find(
        (e) =>
          e.hp > 0 &&
          Phaser.Math.Distance.Between(
            p.worldX,
            p.worldY,
            iso(e.x, e.y, e.z).x,
            iso(e.x, e.y, e.z).y,
          ) < 45,
      );
      if (near) {
        this.selected = near;
        this.lock = 0;
      } else this.keys.add('KeyF');
    });
    $('start').onclick = () => this.start();
    $('pause').onclick = () => this.togglePause();
    document.querySelectorAll<HTMLButtonElement>('[data-plane]').forEach(
      (b) =>
        (b.onclick = () => {
          chosen = b.dataset.plane as Model;
          document
            .querySelectorAll('[data-plane]')
            .forEach((el) => el.classList.toggle('selected', el === b));
        }),
    );
    this.reset();
    this.follow.setPosition(iso(1150, 1050).x, iso(1150, 1050).y - 160);
  }
  reset() {
    const make = (model: Model, x: number, y: number, enemy: boolean): Aircraft => ({
      model,
      x,
      y,
      z: 125,
      heading: enemy ? Math.PI : 0,
      speed: SPECS[model].speed,
      hp: SPECS[model].hp,
      enemy,
      cooldown: enemy ? 7 : 0,
      missiles: 6,
      bombs: 8,
      flares: 12,
      gun: 0,
    });
    this.player = make(chosen, 450, 1550, false);
    const opponent: Model = chosen === 'F-16' ? 'MiG-35' : 'F-16';
    this.enemies = [make(opponent, 1400, 1200, true), make(opponent, 1750, 1650, true)];
    this.ground = [
      { x: 1770, y: 600, z: 0, hp: 100, name: 'КОМАНДНЫЙ ПУНКТ' },
      { x: 1880, y: 720, z: 0, hp: 100, name: 'АНГАР A' },
      { x: 1990, y: 720, z: 0, hp: 100, name: 'АНГАР B' },
    ];
    this.shots = [];
    this.sparks = [];
    this.selected = this.enemies[0];
    this.lock = 0;
    this.elapsed = 0;
    this.finished = false;
    this.paused = false;
    this.repair = 0;
    this.accumulator = 0;
    held.clear();
    this.keys.clear();
  }
  start() {
    this.reset();
    this.activeBattle = true;
    $('overlay').hidden = true;
    $('hud').hidden = false;
    $('pause').textContent = 'Ⅱ ПАУЗА';
    this.message('ВЫЛЕТ РАЗРЕШЁН · Tab — цель, F — ракета', 6);
    const p = iso(this.player.x, this.player.y, this.player.z);
    this.follow.setPosition(p.x, p.y);
    this.cameras.main.centerOn(p.x, p.y);
  }
  togglePause() {
    if (!this.activeBattle || this.finished) return;
    this.paused = !this.paused;
    held.clear();
    this.keys.clear();
    this.accumulator = 0;
    $('pause').textContent = this.paused ? '▶ ПРОДОЛЖИТЬ' : 'Ⅱ ПАУЗА';
    this.message(
      this.paused ? 'ПАУЗА · Esc — продолжить' : 'ВЫЛЕТ ПРОДОЛЖАЕТСЯ',
      this.paused ? 1e8 : 2,
    );
  }
  message(text: string, seconds = 3) {
    $('message').textContent = text;
    this.notice = seconds;
  }
  polygon(g: Phaser.GameObjects.Graphics, points: number[], color: number, alpha = 1) {
    g.fillStyle(color, alpha);
    g.fillPoints(
      Array.from({ length: points.length / 2 }, (_, i) => ({
        x: Math.round(points[i * 2]),
        y: Math.round(points[i * 2 + 1]),
      })),
      true,
    );
  }
  tile(g: Phaser.GameObjects.Graphics, x: number, y: number, size: number, color: number) {
    const a = iso(x, y),
      b = iso(x + size, y),
      c = iso(x + size, y + size),
      d = iso(x, y + size);
    this.polygon(g, [a.x, a.y, b.x, b.y, c.x, c.y, d.x, d.y], color);
  }
  box(
    g: Phaser.GameObjects.Graphics,
    x: number,
    y: number,
    w: number,
    d: number,
    h: number,
    color: number,
  ) {
    const a = iso(x, y),
      b = iso(x + w, y),
      c = iso(x + w, y + d),
      e = iso(x, y + d);
    this.polygon(
      g,
      [e.x, e.y, c.x, c.y, c.x, c.y - h, e.x, e.y - h],
      Phaser.Display.Color.IntegerToColor(color).darken(23).color,
    );
    this.polygon(
      g,
      [b.x, b.y, c.x, c.y, c.x, c.y - h, b.x, b.y - h],
      Phaser.Display.Color.IntegerToColor(color).darken(38).color,
    );
    this.polygon(g, [a.x, a.y - h, b.x, b.y - h, c.x, c.y - h, e.x, e.y - h], color);
  }
  drawMap() {
    const g = this.landscape;
    let seed = 47;
    const rand = () => {
      seed = (seed * 16807) % 2147483647;
      return seed / 2147483647;
    };
    for (let sum = 0; sum < 72; sum++)
      for (let x = 0; x < 36; x++) {
        const y = sum - x;
        if (y < 0 || y >= 36) continue;
        const sea = x < 5 + Math.sin(y * 0.3) * 2;
        const shore = x < 6 + Math.sin(y * 0.3) * 2;
        const colors = sea
          ? [0x294d60, 0x2c5263, 0x305667]
          : shore
            ? [0x9a9b73, 0x93916c]
            : [0x536953, 0x576e57, 0x5a7058, 0x50664f];
        this.tile(g, x * 64, y * 64, 64, colors[Math.floor(rand() * colors.length)]);
        if (sea && rand() > 0.55) {
          const p = iso(x * 64 + 20, y * 64 + 20);
          g.lineStyle(1, 0x6e9c9e, 0.35);
          g.lineBetween(p.x, p.y, p.x + 18, p.y - 2);
        }
        if (!shore && !sea && y > 17 && y < 27 && x > 12 && x < 22) {
          if (x % 4 === 0 || y % 4 === 0) this.tile(g, x * 64, y * 64, 64, 0x606c65);
          else if (rand() > 0.18) {
            const h = 15 + rand() * 45;
            this.box(
              g,
              x * 64 + 8,
              y * 64 + 8,
              30 + rand() * 16,
              32,
              h,
              [0x93a39a, 0xb0ac94, 0x82958e][Math.floor(rand() * 3)],
            );
          }
        } else if (!sea && !shore && y < 6 && x > 9) {
          const p = iso(x * 64 + 32, y * 64 + 32);
          const h = 50 + rand() * 110;
          this.polygon(g, [p.x - 64, p.y + 26, p.x, p.y - h, p.x + 58, p.y + 26], 0x6e7d75);
          this.polygon(g, [p.x, p.y - h, p.x + 58, p.y + 26, p.x + 4, p.y + 18], 0x4a605a);
          if (h > 120)
            this.polygon(
              g,
              [p.x - 13, p.y - h + 34, p.x, p.y - h, p.x + 16, p.y - h + 37, p.x + 3, p.y - h + 26],
              0xc0c8b6,
            );
        } else if (
          !sea &&
          !shore &&
          rand() > 0.83 &&
          !(x > 24 && y < 15) &&
          !(x < 12 && y > 20 && y < 28)
        ) {
          const p = iso(x * 64 + 30, y * 64 + 30);
          g.fillStyle(0x344f45, 0.5);
          g.fillEllipse(p.x + 6, p.y + 6, 23, 10);
          g.fillStyle(0x253f37);
          g.fillRect(p.x - 1, p.y - 3, 3, 14);
          this.polygon(g, [p.x - 13, p.y, p.x, p.y - 28, p.x + 13, p.y], 0x334e3f);
          this.polygon(g, [p.x, p.y - 28, p.x + 13, p.y, p.x, p.y - 2], 0x3d5b43);
        }
      }
    this.airfield(g, 350, 1490, false);
    this.airfield(g, 1650, 660, true);
    for (let i = 0; i < 7; i++) {
      this.box(g, 1150 + i * 38, 1100, 20, 12, 9, 0x6f7456);
      const p = iso(1160 + i * 38, 1106, 10);
      g.lineStyle(3, 0x344338);
      g.lineBetween(p.x, p.y, p.x + 15, p.y - 5);
    }
  }
  airfield(g: Phaser.GameObjects.Graphics, x: number, y: number, enemy: boolean) {
    const p = [iso(x, y), iso(x + 460, y), iso(x + 460, y + 64), iso(x, y + 64)];
    this.polygon(
      g,
      p.flatMap((v) => [v.x, v.y]),
      0x3c4848,
    );
    g.lineStyle(2, 0xc3c7ad, 0.7);
    for (let i = 15; i < 450; i += 40) {
      const a = iso(x + i, y + 32),
        b = iso(x + i + 20, y + 32);
      g.lineBetween(a.x, a.y, b.x, b.y);
    }
    for (let i = 0; i < 3; i++)
      this.box(g, x + 40 + i * 100, y + 100, 65, 45, 22, enemy ? 0x8d8273 : 0x869d91);
    const s = iso(x - 20, y - 20);
    g.lineStyle(3, enemy ? 0xff8e74 : 0x9de2d0);
    g.strokeCircle(s.x, s.y, 10);
  }
  update(_time: number, delta: number) {
    if (this.activeBattle && !this.paused && !this.finished) {
      this.accumulator += Math.min(delta / 1000, 0.1);
      while (this.accumulator >= 1 / 60) {
        this.step(1 / 60);
        this.accumulator -= 1 / 60;
        if (this.finished) break;
      }
    }
    if (this.activeBattle) {
      const p = iso(this.player.x, this.player.y, this.player.z);
      this.follow.setPosition(p.x, p.y);
      this.hud();
    }
    this.draw();
  }
  step(dt: number) {
    this.elapsed += dt;
    this.notice -= dt;
    if (this.notice <= 0) $('message').textContent = '';
    const p = this.player;
    const turn = Number(held.has('KeyD')) - Number(held.has('KeyA'));
    p.heading += turn * SPECS[p.model].turn * dt * (0.8 + 0.2 * (p.speed / 170));
    p.speed = clamp(
      p.speed + (Number(held.has('KeyW')) - Number(held.has('KeyS'))) * 75 * dt,
      85,
      held.has('ShiftLeft') || held.has('ShiftRight') ? 260 : SPECS[p.model].speed + 35,
    );
    if (held.has('ShiftLeft') || held.has('ShiftRight')) p.speed = Math.min(260, p.speed + 65 * dt);
    p.z = clamp(p.z + (Number(held.has('KeyE')) - Number(held.has('KeyQ'))) * 70 * dt, 25, 260);
    if (this.keys.delete('Tab')) {
      const living = this.enemies.filter((e) => e.hp > 0);
      this.selected = living[(living.indexOf(this.selected!) + 1) % living.length];
      this.lock = 0;
    }
    if (this.selected && this.selected.hp <= 0) this.selected = undefined;
    const canLock =
      this.selected &&
      this.selected.hp > 0 &&
      distance(p, this.selected) < 1000 &&
      Math.abs(angleDiff(p.heading, Math.atan2(this.selected.y - p.y, this.selected.x - p.x))) <
        0.8;
    this.lock = canLock ? Math.min(1, this.lock + dt / 1.1) : 0;
    if (this.keys.delete('KeyF')) {
      if (p.missiles > 0 && p.cooldown <= 0 && this.lock >= 1 && this.selected) {
        this.fire(p, 'missile', this.selected);
        p.missiles--;
        p.cooldown = 0.6;
        this.message('РАКЕТА ВОЗДУХ–ВОЗДУХ · ПУСК');
      } else
        this.message(
          p.missiles === 0
            ? 'РАКЕТЫ ИЗРАСХОДОВАНЫ'
            : 'НУЖЕН ЗАХВАТ · поверните к цели, дальность < 10 км',
          2,
        );
    }
    if (this.keys.delete('KeyB') && p.bombs > 0) {
      this.fire(p, 'bomb');
      p.bombs--;
      this.message('БОМБА СБРОШЕНА', 1.5);
    }
    if (this.keys.delete('KeyC') && p.flares > 0) {
      p.flares--;
      for (let i = 0; i < 9; i++)
        this.sparks.push({
          ...p,
          x: p.x + (Math.random() - 0.5) * 70,
          y: p.y + (Math.random() - 0.5) * 70,
          life: 1.8,
          max: 1.8,
          size: 4,
          color: 0xffd38d,
        });
      for (const m of this.shots)
        if (m.kind === 'missile' && m.target === p && distance(m, p) < 650) {
          m.target = undefined;
          m.distracted = true;
        }
      this.message('ЛТЦ ОТСТРЕЛЕНЫ', 1);
    }
    for (const a of [p, ...this.enemies]) {
      if (a.hp <= 0) continue;
      a.cooldown -= dt;
      a.gun -= dt;
      if (a.enemy) {
        const d = distance(a, p);
        const intercept = {
          x: p.x + Math.cos(p.heading) * p.speed * 0.8,
          y: p.y + Math.sin(p.heading) * p.speed * 0.8,
        };
        const desired = Math.atan2(intercept.y - a.y, intercept.x - a.x);
        a.heading = steer(a.heading, desired, SPECS[a.model].turn * 0.72 * dt);
        a.z += clamp(p.z - a.z, -30 * dt, 30 * dt);
        const aligned = Math.abs(angleDiff(a.heading, desired)) < 0.22;
        if (aligned && d < 950 && d > 180 && a.cooldown < 0 && a.missiles > 0) {
          this.fire(a, 'missile', p);
          a.cooldown = 10;
          a.missiles--;
        }
        if (aligned && d < 420 && a.gun <= 0) {
          this.fire(a, 'gun');
          a.gun = 0.22;
        }
      } else if (held.has('Space') && a.gun <= 0) {
        this.fire(a, 'gun');
        a.gun = 0.085;
      }
      a.x += Math.cos(a.heading) * a.speed * dt;
      a.y += Math.sin(a.heading) * a.speed * dt;
      if (a.x < 50 || a.y < 50 || a.x > WORLD - 50 || a.y > WORLD - 50) {
        a.x = clamp(a.x, 50, WORLD - 50);
        a.y = clamp(a.y, 50, WORLD - 50);
        a.heading = steer(a.heading, Math.atan2(WORLD / 2 - a.y, WORLD / 2 - a.x), 3 * dt);
        if (!a.enemy && this.notice <= 0) this.message('ГРАНИЦА СЕКТОРА · развернитесь', 2);
      }
    }
    for (const s of this.shots) {
      const old = { x: s.x, y: s.y, z: s.z };
      s.life -= dt;
      if (s.kind === 'missile' && s.target && s.target.hp > 0) {
        const t = s.target;
        const desired = Math.atan2(t.y - s.y, t.x - s.x);
        s.heading = steer(s.heading, desired, 1.65 * dt);
        s.z += clamp(t.z - s.z, -100 * dt, 100 * dt);
      }
      s.x += Math.cos(s.heading) * s.speed * dt;
      s.y += Math.sin(s.heading) * s.speed * dt;
      if (s.kind === 'bomb') {
        s.vz -= 90 * dt;
        s.z += s.vz * dt;
        if (s.z <= 0) {
          this.explode(s, 55);
          for (const target of this.ground)
            if (target.hp > 0 && distance({ ...s, z: 0 }, target) < 115) {
              target.hp = 0;
              this.explode(target, 55);
              this.message('ОБЪЕКТ УНИЧТОЖЕН · ' + target.name);
            }
          s.life = 0;
        }
      } else if (s.life > 0)
        for (const a of s.enemy ? [p] : this.enemies) {
          if (a.hp > 0 && segmentDistance(old, s, a) < (s.kind === 'missile' ? 27 : 21)) {
            a.hp = Math.max(0, a.hp - (s.kind === 'missile' ? 58 : 9));
            s.life = 0;
            this.explode(s, s.kind === 'missile' ? 25 : 8);
            if (a.hp <= 0) {
              this.explode(a, 55);
              if (a.enemy) this.message('ПЕРЕХВАТЧИК УНИЧТОЖЕН');
            }
            break;
          }
        }
    }
    this.shots = this.shots.filter((s) => s.life > 0);
    for (const s of this.sparks) {
      s.life -= dt;
      s.z += dt * 8;
    }
    this.sparks = this.sparks.filter((s) => s.life > 0);
    if (distance({ ...p, z: 0 }, { x: 530, y: 1522, z: 0 }) < 235 && p.z < 100 && p.speed < 150) {
      this.repair += dt;
      if (this.repair >= 2) {
        p.hp = SPECS[p.model].hp;
        p.missiles = 6;
        p.bombs = 8;
        p.flares = 12;
        this.repair = 0;
        this.message('БАЗА · РЕМОНТ И БОЕКОМПЛЕКТ ВОССТАНОВЛЕНЫ', 3);
      }
    } else this.repair = 0;
    if (p.hp <= 0) this.end(false);
    else if (this.ground.every((t) => t.hp <= 0)) this.end(true);
  }
  fire(a: Aircraft, kind: Projectile['kind'], target?: Aircraft) {
    if (this.shots.length >= 180) return;
    this.shots.push({
      x: a.x + Math.cos(a.heading) * 22,
      y: a.y + Math.sin(a.heading) * 22,
      z: a.z,
      heading: a.heading,
      speed: kind === 'gun' ? 760 : kind === 'missile' ? 360 : a.speed,
      vz: 0,
      life: kind === 'gun' ? 1.1 : kind === 'missile' ? 6 : 10,
      kind,
      enemy: a.enemy,
      target,
      distracted: false,
    });
  }
  explode(p: Vec, size: number) {
    for (let i = 0; i < 9; i++)
      this.sparks.push({
        ...p,
        x: p.x + (Math.random() - 0.5) * size,
        y: p.y + (Math.random() - 0.5) * size,
        life: 0.3 + Math.random() * 0.6,
        max: 0.9,
        size: 4 + Math.random() * size * 0.35,
        color: i % 2 ? 0xffb369 : 0xffe5a4,
      });
    if (size > 20) this.cameras.main.shake(120, 0.002);
  }
  end(win: boolean) {
    this.finished = true;
    held.clear();
    this.message(
      win
        ? 'МИССИЯ ВЫПОЛНЕНА · АЭРОДРОМ УНИЧТОЖЕН · R — новый вылет'
        : 'САМОЛЁТ ПОТЕРЯН · R — новый вылет',
      1e8,
    );
  }
  drawAircraft(a: Aircraft) {
    const g = this.ink;
    const p = iso(a.x, a.y, a.z),
      shadow = iso(a.x, a.y);
    g.fillStyle(0x10282b, 0.35);
    g.fillEllipse(shadow.x + 12, shadow.y + 6, 36, 14);
    if (a.hp <= 0) {
      g.fillStyle(0x252c2b, 0.8);
      g.fillRect(p.x - 8, p.y - 4, 16, 8);
      return;
    }
    const c = Math.cos(a.heading),
      s = Math.sin(a.heading);
    const transform = (u: number, v: number, h = 0) =>
      iso(a.x + c * u - s * v, a.y + s * u + c * v, a.z + h);
    const shape = (coords: number[], color: number) =>
      this.polygon(
        g,
        coords.flatMap((_, i) =>
          i % 2
            ? []
            : (() => {
                const v = transform(coords[i], coords[i + 1]);
                return [v.x, v.y];
              })(),
        ),
        color,
      );
    const flame = transform(-27, 0);
    g.fillStyle(0xffb15c, 0.9);
    g.fillRect(flame.x - 4, flame.y - 2, held.has('ShiftLeft') && !a.enemy ? 12 : 6, 4);
    const color = a.enemy ? 0xc4a9a1 : 0xbcd5cd;
    if (a.model === 'MiG-35') {
      shape([-20, -7, -11, -10, 1, -5, 18, -3, 30, 0, 18, 3, 1, 5, -11, 10, -20, 7], color);
      shape(
        [5, -5, -15, -25, -21, -25, -15, -4, -15, 4, -21, 25, -15, 25, 5, 5],
        a.enemy ? 0x8d8382 : 0x849f9a,
      );
      shape([-13, -6, -25, -14, -26, -6, -18, 0, -26, 6, -25, 14, -13, 6], color);
      shape([-15, -5, -22, -9, -23, -3, -15, 0], 0x687e80);
      shape([-15, 5, -22, 9, -23, 3, -15, 0], 0x687e80);
    } else {
      shape([-23, -4, -5, -5, 17, -3, 31, 0, 17, 3, -5, 5, -23, 4], color);
      shape(
        [5, -4, -13, -25, -18, -25, -13, -3, -13, 3, -18, 25, -13, 25, 5, 4],
        a.enemy ? 0x9b8b88 : 0x8daaa5,
      );
      shape([-15, -3, -25, -13, -28, -12, -24, 0, -28, 12, -25, 13, -15, 3], color);
    }
    shape([17, 0, 8, -3, 2, -3, 0, 0, 4, 3, 10, 3], 0x244855);
    shape([-16, 0, -24, -2, -22, -6, -13, 0], 0x607e7d);
    const wing = transform(-12, -21);
    g.fillStyle(a.enemy ? 0xff9b83 : 0xcfff90);
    g.fillRect(wing.x - 1, wing.y - 1, 3, 3);
    if (a === this.selected && a.hp > 0) {
      g.lineStyle(1, this.lock >= 1 ? 0xd9f879 : 0xff9a80, 0.9);
      const r = 30;
      for (const [dx, dy] of [
        [-1, -1],
        [1, -1],
        [-1, 1],
        [1, 1],
      ]) {
        g.lineBetween(p.x + dx * r, p.y + dy * 20, p.x + dx * (r - 8), p.y + dy * 20);
        g.lineBetween(p.x + dx * r, p.y + dy * 20, p.x + dx * r, p.y + dy * 12);
      }
    }
  }
  draw() {
    const g = this.ink;
    g.clear();
    for (const t of this.ground) {
      this.box(g, t.x - 23, t.y - 20, 46, 40, t.hp > 0 ? 25 : 4, t.hp > 0 ? 0xa69a83 : 0x393f38);
      const p = iso(t.x, t.y, 34);
      g.lineStyle(1, t.hp > 0 ? 0xff947b : 0x667468);
      g.strokeRect(p.x - 7, p.y - 7, 14, 14);
      if (t.hp <= 0) {
        g.fillStyle(0x283534, 0.5);
        g.fillCircle(p.x, p.y - 12, 15);
      }
    }
    const p = this.player;
    if (this.activeBattle && p.hp > 0) {
      const impact = bombImpact(p, p.heading, p.speed);
      const b = iso(impact.x, impact.y);
      g.lineStyle(1, 0xe1edac, 0.8);
      g.strokeCircle(b.x, b.y, 13);
      g.lineBetween(b.x - 20, b.y, b.x + 20, b.y);
      g.lineBetween(b.x, b.y - 14, b.x, b.y + 14);
    }
    for (const a of [p, ...this.enemies].sort((a, b) => a.x + a.y - (b.x + b.y)))
      this.drawAircraft(a);
    for (const s of this.shots) {
      const p = iso(s.x, s.y, s.z);
      const tail = iso(
        s.x - Math.cos(s.heading) * (s.kind === 'gun' ? 16 : 28),
        s.y - Math.sin(s.heading) * (s.kind === 'gun' ? 16 : 28),
        s.z,
      );
      g.lineStyle(
        s.kind === 'missile' ? 2 : 1,
        s.kind === 'bomb' ? 0x202e30 : s.enemy ? 0xff9a77 : 0xe6f9af,
        0.9,
      );
      g.lineBetween(p.x, p.y, tail.x, tail.y);
      if (s.kind === 'missile') {
        g.fillStyle(0xffbe7c);
        g.fillRect(tail.x - 2, tail.y - 2, 4, 4);
      }
      if (s.kind === 'bomb') {
        g.fillStyle(0x222e31);
        g.fillRect(p.x - 2, p.y - 2, 5, 7);
      }
    }
    for (const s of this.sparks) {
      const p = iso(s.x, s.y, s.z);
      const size = s.size * (0.4 + s.life / s.max);
      g.fillStyle(s.color, Math.min(1, s.life / s.max));
      g.fillRect(p.x - size / 2, p.y - size / 2, size, size);
    }
  }
  hud() {
    const p = this.player;
    $('plane-name').textContent = p.model;
    $('speed').textContent = String(Math.round(p.speed * 4));
    $('altitude').textContent = String(Math.round(p.z * 10));
    const hp = Math.round((100 * p.hp) / SPECS[p.model].hp);
    $('health').textContent = String(hp);
    $('health-bar').style.width = hp + '%';
    $('missiles').textContent = String(p.missiles);
    $('bombs').textContent = String(p.bombs);
    $('flares').textContent = String(p.flares);
    const threat = this.shots.some((s) => s.kind === 'missile' && s.target === p && s.life > 0);
    $('status').textContent = threat
      ? '⚠ РАКЕТА! МАНЁВР + C — ЛТЦ'
      : this.repair > 0
        ? 'БАЗА · ОБСЛУЖИВАНИЕ'
        : p.z < 50
          ? 'МАЛАЯ ВЫСОТА'
          : held.has('ShiftLeft')
            ? 'ФОРСАЖ'
            : 'СИСТЕМЫ В НОРМЕ';
    $('status').style.color = threat ? '#ff947b' : '#d9f879';
    const t = this.selected;
    $('target').textContent =
      t && t.hp > 0
        ? `${t.model} · ${(distance(p, t) / 100).toFixed(1)} КМ · ${this.lock >= 1 ? 'ЗАХВАТ · F — ПУСК' : this.lock > 0 ? 'ЗАХВАТ ' + Math.round(this.lock * 100) + '%' : 'ВНЕ КОНУСА ЗАХВАТА'}`
        : 'НЕТ ВОЗДУШНЫХ ЦЕЛЕЙ · АТАКУЙТЕ БАЗУ';
    const ctx = this.radar.getContext('2d')!;
    ctx.clearRect(0, 0, 190, 160);
    ctx.fillStyle = '#142b32';
    ctx.fillRect(0, 0, 190, 160);
    ctx.strokeStyle = '#29464a';
    ctx.lineWidth = 1;
    for (let i = 0; i < 5; i++) {
      ctx.beginPath();
      ctx.moveTo(i * 47.5, 0);
      ctx.lineTo(i * 47.5, 160);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(0, i * 40);
      ctx.lineTo(190, i * 40);
      ctx.stroke();
    }
    const dot = (v: Vec, color: string, r: number) => {
      ctx.fillStyle = color;
      ctx.fillRect((v.x / WORLD) * 180 + 5 - r, (v.y / WORLD) * 150 + 5 - r, r * 2, r * 2);
    };
    dot({ x: 530, y: 1522, z: 0 }, '#85c9c1', 4);
    for (const b of this.ground) if (b.hp > 0) dot(b, '#ff9a80', 3);
    for (const e of this.enemies) if (e.hp > 0) dot(e, '#ff9a80', 3);
    dot(p, '#d9f879', 3);
    const x = (p.x / WORLD) * 180 + 5,
      y = (p.y / WORLD) * 150 + 5;
    ctx.strokeStyle = '#d9f879';
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + Math.cos(p.heading) * 12, y + Math.sin(p.heading) * 12);
    ctx.stroke();
  }
}

const game = new Phaser.Game({
  type: Phaser.AUTO,
  parent: 'game',
  backgroundColor: '#263f45',
  pixelArt: true,
  antialias: false,
  scale: { mode: Phaser.Scale.RESIZE, width: window.innerWidth, height: window.innerHeight },
  scene: Battle,
  render: { roundPixels: true },
  fps: { target: 60 },
});
if (import.meta.env.DEV) Object.assign(window, { pixelSky: game });

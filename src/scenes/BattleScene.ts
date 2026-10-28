import Phaser from 'phaser';
import { BattleAudio } from '../audio/battleAudio';
import { bodyAxes, bodyToWorld, integrity, type Aircraft } from '../entities/aircraft';
import { instructor } from '../ai/instructor';
import { Particles } from '../effects/particles';
import { t, tr } from '../i18n';
import { MAX_CATCH_UP, SIM_STEP } from '../game/config';
import { BattleRenderer } from '../render/battleRenderer';
import { Battle, type BattleOptions, type PlayerInput, type WeaponSlot } from '../systems/battle';
import type { SimEvent } from '../systems/events';
import { gunBore, gunLead } from '../systems/weapons';
import { Hud } from '../ui/hud';
import { addScaled, clamp, DEG, distance, normalize, sub, type Vec3 } from '../world/math';

const PREVENT = new Set([
  'Tab',
  'Space',
  'Enter',
  'NumpadEnter',
  'ArrowUp',
  'ArrowDown',
  'ArrowLeft',
  'ArrowRight',
  'AltLeft',
  'AltRight',
]);

export class BattleScene extends Phaser.Scene {
  readonly audio = new BattleAudio();
  battle?: Battle;
  options?: BattleOptions;
  paused = false;
  onState?: (state: 'running' | 'paused' | 'finished') => void;

  private world!: Phaser.GameObjects.Graphics;
  private battleView!: BattleRenderer;
  private particles = new Particles();
  private hud = new Hud();
  private held = new Set<string>();
  private pressed = new Set<string>();
  private throttle = 0;
  private assist = true;
  private mouseAim = true;
  private aimDirection?: Vec3;
  private holdAltitude?: number;
  private userZoom = 1;
  private accumulator = 0;
  private markers = new Map<string, HTMLDivElement>();
  private smokeTimer = 0;

  constructor() {
    super('battle');
  }
  private freeLook() {
    return this.held.has('KeyC') || this.held.has('AltLeft') || this.held.has('AltRight');
  }
  private targetLook() {
    return this.held.has('KeyT') && !!this.battle?.selected?.alive;
  }
  private looking() {
    return this.freeLook() || this.targetLook();
  }

  create() {
    this.cameras.main.setBackgroundColor('#8cb5cb');
    this.battleView = new BattleRenderer(this);
    this.world = this.add.graphics().setDepth(10);
    const down = (e: KeyboardEvent) => {
      if (this.battle && !this.paused && !e.repeat) this.audio.unlock();
      if (this.battle && (PREVENT.has(e.code) || (e.ctrlKey && this.flying()))) e.preventDefault();
      this.held.add(e.code);
      if (e.repeat) return;
      if (e.code === 'Escape') return this.togglePause();
      if (e.code === 'KeyN' && this.battle && (this.paused || this.battle.result !== 'active'))
        return this.startBattle(this.options!);
      this.pressed.add(e.code);
    };
    const up = (e: KeyboardEvent) => {
      this.held.delete(e.code);
      if (e.code === 'KeyC' || e.code === 'AltLeft' || e.code === 'AltRight' || e.code === 'KeyT') {
        if (!this.looking()) this.battleView.camera.returnToChase();
      }
    };
    const blur = () => {
      this.held.clear();
      if (this.battle && !this.paused && this.battle.result === 'active') this.togglePause();
    };
    const wheel = (e: WheelEvent) => {
      if (!this.battle || this.paused) return;
      this.userZoom = clamp(this.userZoom * (e.deltaY > 0 ? 0.9 : 1.1), 0.55, 1.8);
    };
    const move = (e: PointerEvent) => {
      if (!this.battle || this.paused) return;
      if (this.freeLook()) {
        this.battleView.camera.lookYaw += e.movementX * 0.005;
        this.battleView.camera.lookPitch = clamp(
          this.battleView.camera.lookPitch - e.movementY * 0.004,
          -1.2,
          1.2,
        );
      } else if (!this.targetLook() && e.target === this.game.canvas) {
        const rect = this.game.canvas.getBoundingClientRect();
        const x = clamp(
          ((e.clientX - rect.left) * this.scale.width) / rect.width,
          0,
          this.scale.width,
        );
        const y = clamp(
          ((e.clientY - rect.top) * this.scale.height) / rect.height,
          0,
          this.scale.height,
        );
        const camera = this.battleView.camera;
        const point = addScaled(camera.pos, camera.ray(x, y), 8000);
        this.aimDirection = normalize(sub(point, this.battle.player.pos));
      }
    };
    const unload = (e: BeforeUnloadEvent) => {
      if (!this.flying()) return;
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    window.addEventListener('blur', blur);
    window.addEventListener('wheel', wheel, { passive: true });
    window.addEventListener('pointermove', move);
    window.addEventListener('beforeunload', unload);
    this.input.mouse?.disableContextMenu();
    this.input.on('pointerdown', (p: Phaser.Input.Pointer) => {
      if (this.battle && !this.paused) this.audio.unlock();
      if (p.button === 2) this.pressed.add('MouseRight');
      else if (p.button === 0) this.held.add('MouseLeft');
    });
    this.input.on('pointerup', (p: Phaser.Input.Pointer) => {
      if (p.button === 0) this.held.delete('MouseLeft');
    });
    this.events.once('shutdown', () => {
      this.audio.destroy();
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
      window.removeEventListener('blur', blur);
      window.removeEventListener('wheel', wheel);
      window.removeEventListener('pointermove', move);
      window.removeEventListener('beforeunload', unload);
    });
  }

  startBattle(options: BattleOptions) {
    this.audio.unlock();
    this.audio.reset();
    this.options = options;
    this.battle = new Battle(options);
    this.paused = false;
    this.accumulator = 0;
    this.held.clear();
    this.pressed.clear();
    this.particles.clear();
    this.hud.reset();
    this.throttle = this.battle.player.throttle;
    this.holdAltitude = undefined;
    this.aimDirection = undefined;
    this.userZoom = 1;
    this.battleView.camera.reset();
    this.updateCamera(0);
    for (const m of this.markers.values()) m.remove();
    this.markers.clear();
    this.hud.message(t(options.start === 'runway' ? 'msg.startRunway' : 'msg.startAir'), false, 6);
    this.hud.message(t('msg.cameraControls'), false, 10);
    this.onState?.('running');
  }

  togglePause() {
    if (!this.battle || this.battle.result !== 'active') return;
    this.paused = !this.paused;
    this.audio.setPaused(this.paused);
    this.held.clear();
    this.pressed.clear();
    this.accumulator = 0;
    this.onState?.(this.paused ? 'paused' : 'running');
  }

  private flying() {
    return !!this.battle && !this.paused && this.battle.result === 'active';
  }
  private cursor() {
    if (!this.aimDirection || !this.battle) return undefined;
    return this.battleView.camera.project(
      addScaled(this.battle.player.pos, this.aimDirection, 8000),
    );
  }

  private instructorActive() {
    const p = this.battle?.player;
    return !!p && this.mouseAim && p.alive && !p.onGround && p.telemetry.agl > 15;
  }

  private readInput(dt: number): PlayerInput {
    const h = (code: string) => this.held.has(code);
    const take = (code: string) => this.pressed.delete(code);
    const up = Number(h('ShiftLeft') || h('ShiftRight') || h('KeyR'));
    const down = Number(h('ControlLeft') || h('ControlRight') || h('KeyF'));
    this.throttle = clamp(this.throttle + (up - down) * 0.5 * dt, 0, 1.1);
    if (take('KeyH')) {
      this.assist = !this.assist;
      this.hud.message(t(this.assist ? 'msg.assistOn' : 'msg.assistOff'));
    }
    if (take('KeyK')) {
      this.mouseAim = !this.mouseAim;
      this.holdAltitude = undefined;
      this.hud.message(t(this.mouseAim ? 'msg.mouseAimOn' : 'msg.mouseAimOff'));
    }
    const weapon: WeaponSlot | undefined = take('Digit1') ? 'missile' : undefined;
    const keyRoll = Number(h('KeyD') || h('ArrowRight')) - Number(h('KeyA') || h('ArrowLeft'));
    const keyPitch = Number(h('KeyS') || h('ArrowDown')) - Number(h('KeyW') || h('ArrowUp'));
    let roll = keyRoll,
      pitch = keyPitch;
    const aimed = this.instructorActive();
    // Keyboard stick overrides mouse aim completely, including during free look.
    // A held S commands continuous positive load rather than a fixed climb angle.
    const manual = !aimed || this.looking() || keyPitch !== 0 || keyRoll !== 0;
    if (!manual) {
      const p = this.battle!.player,
        direction = this.aimDirection;
      let heading = p.heading,
        gamma = 0;
      if (direction) {
        heading = Math.atan2(direction.y, direction.x);
        gamma = Math.atan2(direction.z, Math.hypot(direction.x, direction.y));
      }
      if (!direction) {
        this.holdAltitude ??= p.pos.z;
        gamma = clamp(Math.atan2(this.holdAltitude - p.pos.z, p.speed * 8), -10 * DEG, 10 * DEG);
      } else this.holdAltitude = undefined;
      const floor = 120 + p.speed;
      if (p.telemetry.agl < floor)
        gamma = Math.max(gamma, (1 - p.telemetry.agl / floor) * 20 * DEG);
      const c = instructor(p, heading, gamma, direction ? 'nose' : 'flightPath');
      pitch = c.pitch;
      roll = c.roll;
    } else {
      this.holdAltitude = undefined;
      // Only a deliberate, conscious keyboard manoeuvre cancels mouse aim. Free look
      // and G-LOC preserve the player's world direction for when control resumes.
      if ((keyPitch !== 0 || keyRoll !== 0) && this.battle!.player.pilot.gloc <= 0)
        this.aimDirection = undefined;
    }
    return {
      controls: {
        roll,
        pitch,
        manual,
        noseAim: !manual && !!this.aimDirection,
        yaw: Number(h('KeyE')) - Number(h('KeyQ')),
        throttle: Math.min(1, this.throttle),
        afterburner: this.throttle > 1,
        airbrake: h('KeyX'),
        wheelBrake: h('KeyB'),
        levelAssist: this.assist && !aimed && !this.looking() && keyPitch === 0 && keyRoll === 0,
      },
      gun: h('Space') || h('MouseLeft'),
      fire: take('Enter') || take('NumpadEnter') || take('MouseRight'),
      flare: take('KeyV'),
      gear: take('KeyG'),
      flaps: take('KeyZ'),
      nextTarget: take('Tab'),
      weapon,
    };
  }

  update(_time: number, delta: number) {
    const dt = Math.min(delta / 1000, 0.1),
      b = this.battle;
    if (b && !this.paused) {
      this.accumulator = Math.min(this.accumulator + dt, MAX_CATCH_UP);
      while (this.accumulator >= SIM_STEP) {
        b.step(SIM_STEP, this.readInput(SIM_STEP));
        this.accumulator -= SIM_STEP;
        this.handleEvents(b.drainEvents());
      }
      if (b.result !== 'active') this.onState?.('finished');
      this.particles.update(dt);
      this.spawnTrails(b, dt);
    }
    this.updateCamera(this.paused ? 0 : dt);
    if (b && !this.paused) this.audio.update(b);
    this.draw();
    if (b) this.hud.update(b, dt, this.assist, this.paused, this.mouseAim);
  }

  private handleEvents(events: SimEvent[]) {
    const b = this.battle!;
    for (const e of events) {
      this.audio.handle(e, b.player, this.battleView.camera);
      if (e.type === 'gun') {
        const aircraft = b.aircraft.find((a) => a.id === e.aircraftId);
        if (aircraft) {
          const axes = bodyAxes(aircraft);
          for (const muzzle of aircraft.spec.gunMuzzles)
            this.particles.spawn(bodyToWorld(aircraft, axes, muzzle), {
              life: 0.055,
              size: 0.45,
              grow: 0,
              color: 0xffd780,
            });
        }
      }
      if (e.type === 'message') {
        if (e.aircraftId === undefined || e.aircraftId === b.player.id)
          this.hud.message(tr(e.msg), e.warning);
      } else if (e.type === 'explosion') this.particles.explosion(e.pos, e.size * 0.5);
      else if (e.type === 'hit') this.particles.sparks(e.pos);
      else if (e.type === 'impact') this.particles.splash(e.pos, e.water);
      else if (e.type === 'destroyed' && e.aircraftId !== b.player.id) {
        const a = b.aircraft.find((x) => x.id === e.aircraftId)!;
        this.hud.message(
          t('msg.shotDown', {
            callsign: '@' + a.callsign,
            type: '@aircraft.' + a.spec.id,
            cause: e.cause,
          }),
          false,
          6,
        );
      }
    }
  }

  private spawnTrails(b: Battle, dt: number) {
    this.smokeTimer -= dt;
    if (this.smokeTimer > 0) return;
    this.smokeTimer = 0.05;
    for (const a of b.aircraft) {
      if (!a.alive && !a.falling) continue;
      const axes = bodyAxes(a);
      for (const m of a.modules) {
        const k = integrity(m),
          burning = m.fire > 0 || (!a.alive && m.spec.kind === 'fuel');
        if (
          !burning &&
          !(m.spec.kind === 'engine' && k < 0.5) &&
          !(m.spec.kind === 'fuel' && k < 0.9)
        )
          continue;
        const p = bodyToWorld(a, axes, m.spec.pos);
        if (burning) {
          this.particles.spawn(p, { life: 0.4, size: 3, grow: 3, color: 0xff9b4a });
          this.particles.smoke(p, true, 4);
        } else this.particles.smoke(p, m.spec.kind === 'engine', m.spec.kind === 'engine' ? 3 : 2);
      }
    }
    for (const m of b.missiles)
      if (m.alive && m.time < m.spec.burnTime) this.particles.smoke(m.pos, false, 2.5);
  }

  private updateCamera(dt: number) {
    this.battleView.resize(this.scale.width, this.scale.height);
    if (this.battle)
      this.battleView.camera.update(
        this.battle.player,
        this.battle.selected,
        this.targetLook(),
        this.freeLook(),
        this.userZoom,
        dt,
      );
  }

  private draw() {
    const g = this.world,
      b = this.battle;
    g.clear();
    if (!b) return;
    this.battleView.draw(b, this.particles);
    this.drawSights(g, b, b.player);
    this.updateMarkers(b);
  }

  private drawSights(g: Phaser.GameObjects.Graphics, b: Battle, p: Aircraft) {
    const camera = this.battleView.camera,
      bore = gunBore(p);
    // Both aiming marks use the same origin and sight distance: no muzzle/camera
    // parallax can leave a visible gap once the nose reaches the commanded direction.
    const cross = camera.project(addScaled(p.pos, bore.direction, 8000));
    if (cross.depth > camera.near) {
      g.lineStyle(1, 0xd9f879, 0.9);
      g.strokeCircle(cross.x, cross.y, 6);
      g.lineBetween(cross.x - 10, cross.y, cross.x - 3, cross.y);
      g.lineBetween(cross.x + 3, cross.y, cross.x + 10, cross.y);
      g.lineBetween(cross.x, cross.y - 10, cross.x, cross.y - 3);
    }
    const cursor = this.cursor();
    if (cursor && this.instructorActive() && !this.looking()) {
      g.lineStyle(1, 0xffffff, 0.7);
      g.strokeCircle(cursor.x, cursor.y, 5);
    }
    const target = b.selected;
    if (!target) return;
    const c = camera.project(target.pos);
    if (c.depth < camera.near) return;
    g.lineStyle(1, b.lock >= 1 ? 0xd9f879 : 0xffd27a, 0.95);
    const r = 12;
    for (const [dx, dy] of [
      [-1, -1],
      [1, -1],
      [-1, 1],
      [1, 1],
    ]) {
      g.lineBetween(c.x + dx * r, c.y + dy * r, c.x + dx * (r - 4), c.y + dy * r);
      g.lineBetween(c.x + dx * r, c.y + dy * r, c.x + dx * r, c.y + dy * (r - 4));
    }
    if (b.lock > 0) {
      g.beginPath();
      g.arc(c.x, c.y, 17, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * b.lock);
      g.strokePath();
      if (b.inRange) g.strokeCircle(c.x, c.y, 21);
    }
    if (p.alive && distance(p.pos, target.pos) < 2000) {
      const pip = camera.project(gunLead(p, target).point);
      if (pip.depth > camera.near) {
        g.lineStyle(1, 0xd9f879, 0.9);
        g.strokeCircle(pip.x, pip.y, 4);
      }
    }
  }

  private updateMarkers(b: Battle) {
    const layer = document.getElementById('markers')!;
    const wanted = new Map<string, { text: string; cls: string; pos: Vec3 }>();
    const p = b.player;
    for (const e of b.detected())
      wanted.set('a' + e.id, {
        text:
          t('aircraft.' + e.spec.id) +
          ' ' +
          (distance(e.pos, p.pos) / 1000).toFixed(1) +
          ' ' +
          t('hud.km') +
          (e === b.selected && b.inRange ? ' · ' + t('hud.shoot') : ''),
        cls: e === b.selected ? (b.lock >= 1 ? 'locked' : 'selected') : '',
        pos: e.pos,
      });
    for (const m of b.missiles)
      if (m.alive && m.target === p)
        wanted.set('m' + m.id, {
          text: t('hud.missileMarker', { range: (distance(m.pos, p.pos) / 1000).toFixed(1) }),
          cls: 'threat',
          pos: m.pos,
        });
    for (const [key, el] of this.markers)
      if (!wanted.has(key)) {
        el.remove();
        this.markers.delete(key);
      }
    const rect = this.game.canvas.getBoundingClientRect(),
      w = rect.width,
      h = rect.height;
    const camera = this.battleView.camera;
    for (const [key, m] of wanted) {
      let el = this.markers.get(key);
      if (!el) {
        el = document.createElement('div');
        layer.appendChild(el);
        this.markers.set(key, el);
      }
      const point = camera.cameraPoint(m.pos),
        projected = camera.project(m.pos);
      let dx = ((projected.x - camera.width / 2) / camera.width) * w;
      let dy = ((projected.y - camera.height / 2) / camera.height) * h;
      const off = point.z < camera.near || Math.abs(dx) > w / 2 - 70 || Math.abs(dy) > h / 2 - 60;
      if (point.z < camera.near && Math.hypot(dx, dy) < 1) {
        dx = w;
        dy = h * 0.2;
      }
      const k = off
        ? Math.min((w * 0.28) / Math.max(1, Math.abs(dx)), (h * 0.35) / Math.max(1, Math.abs(dy)))
        : 1;
      const angle = Math.atan2(dy, dx);
      el.className = 'marker ' + m.cls + (off ? ' edge' : '');
      el.innerHTML =
        (off ? '<i style="transform: rotate(' + angle.toFixed(2) + 'rad)">➤</i>' : '') +
        '<span>' +
        m.text +
        '</span>';
      el.style.left = rect.left + w / 2 + dx * k + 'px';
      el.style.top = rect.top + h / 2 + dy * k + 'px';
    }
  }
}

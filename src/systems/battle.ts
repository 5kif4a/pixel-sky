import { createAi, thinkFighter, type AiState } from '../ai/fighter';
import type { AircraftId } from '../data/aircraft';
import {
  AIRFIELDS,
  AI_COMBAT,
  DETECTION_RANGE,
  ENEMY_PATROL,
  PLAYER_AIR_START,
  STANDARD_WEATHER_ID,
  WEATHER_PRESETS,
} from '../data/mission';
import {
  createAircraft,
  neutralControls,
  serviceAircraft,
  type Aircraft,
  type Controls,
} from '../entities/aircraft';
import type { Weather } from '../world/atmosphere';
import { createRng, distance, type Rng } from '../world/math';
import { runwayWorld, surfaceAt, terrainBlocks } from '../world/terrain';
import { damageEffects } from './damage';
import { msg, type Key, type Msg } from '../i18n';
import type { SimEvent } from './events';
import { stepAircraft, type FlightEnv } from './flight';
import {
  canLock,
  missileOf,
  dropFlares,
  fireGun,
  launchMissile,
  stepFlares,
  stepMissiles,
  stepShells,
  type Flare,
  type Missile,
  type Shell,
  type WeaponWorld,
} from './weapons';

export type WeaponSlot = 'missile';
export type StartMode = 'runway' | 'air';

export interface PlayerInput {
  controls: Controls;
  gun: boolean;
  /** One-shot commands for this step. */
  fire?: boolean;
  flare?: boolean;
  gear?: boolean;
  flaps?: boolean;
  nextTarget?: boolean;
  weapon?: WeaponSlot;
}
export const idleInput = (throttle = 0.8): PlayerInput => ({
  controls: neutralControls(throttle),
  gun: false,
});

export interface BattleOptions {
  player: AircraftId;
  start: StartMode;
  weather?: Weather;
  seed?: number;
}

export const SERVICE_TIME = 15;
const LOCK_TIME = 1;

export class Battle implements WeaponWorld {
  aircraft: Aircraft[] = [];
  shells: Shell[] = [];
  missiles: Missile[] = [];
  flares: Flare[] = [];
  events: SimEvent[] = [];
  rng: Rng;
  weather: Weather;
  time = 0;
  result: 'active' | 'victory' | 'defeat' = 'active';
  player: Aircraft;
  ai = new Map<number, AiState>();
  selected?: Aircraft;
  lock = 0;
  /** Locked and close enough for the missile to get there with energy left. */
  inRange = false;
  weapon: WeaponSlot = 'missile';
  private lostTimer = 0;
  private env: FlightEnv;

  constructor(options: BattleOptions) {
    this.rng = createRng(options.seed ?? 20261017);
    this.weather = options.weather ?? WEATHER_PRESETS[STANDARD_WEATHER_ID];
    this.env = { weather: this.weather, events: this.events, rng: this.rng };
    const home = AIRFIELDS.blue;
    if (options.start === 'runway') {
      const p = runwayWorld(home, -home.length / 2 + 150, 0);
      this.player = createAircraft(
        1,
        options.player,
        'blue',
        'callsign.player',
        { ...p, z: home.elevation },
        home.heading,
        0,
      );
    } else {
      const p = PLAYER_AIR_START;
      const heading = Math.atan2(ENEMY_PATROL.y - p.y, ENEMY_PATROL.x - p.x);
      this.player = createAircraft(
        1,
        options.player,
        'blue',
        'callsign.player',
        { x: p.x, y: p.y, z: p.altitude },
        heading,
        230,
      );
    }
    this.player.serviceTime = SERVICE_TIME;
    this.aircraft.push(this.player);
    const enemyType: AircraftId = options.player === 'MiG-35' ? 'F-16' : 'MiG-35';
    const enemyPos = {
      x: ENEMY_PATROL.x,
      y: ENEMY_PATROL.y + 2000,
      z: ENEMY_PATROL.altitude,
    };
    const enemy = createAircraft(
      10,
      enemyType,
      'red',
      'callsign.red1',
      enemyPos,
      Math.atan2(this.player.pos.y - enemyPos.y, this.player.pos.x - enemyPos.x),
      230,
    );
    this.aircraft.push(enemy);
    this.ai.set(enemy.id, createAi(this.rng));
  }

  /** Enemies the player can currently see (range and terrain masking). */
  detected(observer: Aircraft = this.player) {
    return this.aircraft.filter(
      (a) =>
        a.side !== observer.side &&
        a.alive &&
        distance(a.pos, observer.pos) < DETECTION_RANGE &&
        !terrainBlocks(observer.pos, a.pos),
    );
  }

  private say(key: Key, params?: Msg['params'], warning = false) {
    this.events.push({
      type: 'message',
      msg: msg(key, params),
      aircraftId: this.player.id,
      warning,
    });
  }

  private playerCommands(input: PlayerInput, dt: number) {
    const p = this.player;
    if (!p.alive) return;
    if (input.weapon) this.weapon = input.weapon;
    if (input.gear) {
      if (p.onGround) this.say('msg.gearOnGround');
      else if (!damageEffects(p).gearWorks) this.say('msg.gearBroken', undefined, true);
      else {
        p.gearDown = !p.gearDown;
        this.say(p.gearDown ? 'msg.gearDown' : 'msg.gearUp');
      }
    }
    if (input.flaps) {
      if (!p.spec.hasFlaps) this.say('msg.noFlaps');
      else if (p.flapsBroken) this.say('msg.flapsBroken', undefined, true);
      else {
        p.flaps = ((p.flaps + 1) % 3) as 0 | 1 | 2;
        this.say(`msg.flaps${p.flaps}`);
      }
    }
    const visible = this.detected();
    if (this.selected && !visible.includes(this.selected)) this.selected = undefined;
    if (input.nextTarget || !this.selected) {
      const sorted = visible.sort((a, b) => distance(a.pos, p.pos) - distance(b.pos, p.pos));
      const next = input.nextTarget
        ? sorted[(sorted.indexOf(this.selected!) + 1) % Math.max(1, sorted.length)]
        : sorted[0];
      if (next !== this.selected) this.lock = 0;
      this.selected = next;
    }
    const lockable =
      this.weapon === 'missile' && this.selected && !p.onGround && canLock(p, this.selected);
    this.lock = lockable ? Math.min(1, this.lock + dt / LOCK_TIME) : 0;
    const range = this.selected ? distance(this.selected.pos, p.pos) : Infinity;
    this.inRange = this.lock >= 1 && range > 400 && range < missileOf(p).lockRange * 0.7;
    if (input.fire && !p.onGround && p.pilot.gloc <= 0) {
      if (p.missiles <= 0) this.say('msg.missilesOut');
      else if (this.lock < 1 || !this.selected) this.say('msg.noLock');
      else if (p.missileCooldown <= 0) {
        launchMissile(this, p, this.selected);
        this.say('msg.launch', { weapon: '@weapon.' + p.spec.missile });
      }
    }
    if (input.flare && !dropFlares(this, p) && p.flares <= 0) this.say('msg.flaresOut');
  }

  step(dt: number, input: PlayerInput) {
    this.time += dt;
    const p = this.player;
    this.playerCommands(input, dt);

    for (const a of this.aircraft) {
      a.missileCooldown = Math.max(0, a.missileCooldown - dt);
      if (a === p) {
        stepAircraft(a, input.controls, this.env, dt);
        const canShoot = a.alive && !a.onGround && a.pilot.gloc <= 0 && damageEffects(a).gunWorks;
        if (input.gun && canShoot) {
          const before = a.gunAmmo;
          fireGun(this, a, dt, this.selected);
          if (before > 0 && a.gunAmmo === 0) this.say('msg.ammoOut', undefined, true);
        } else a.gunAccumulator = 0;
        continue;
      }
      const ai = this.ai.get(a.id);
      if (!ai || !a.alive) {
        stepAircraft(a, neutralControls(0), this.env, dt);
        continue;
      }
      const out = thinkFighter(ai, a, this.aircraft, this.missiles, dt, this.rng);
      stepAircraft(a, out.controls, this.env, dt);
      if (!a.alive) continue;
      if (out.fireGun && a.pilot.gloc <= 0) fireGun(this, a, dt, ai.target);
      else a.gunAccumulator = 0;
      if (out.fireMissile && a.missiles > 0 && a.pilot.gloc <= 0 && !a.onGround) {
        launchMissile(this, a, out.fireMissile);
        a.missileCooldown = AI_COMBAT.missileCooldown;
        if (out.fireMissile === p) this.say('msg.missileWarning', undefined, true);
      }
      if (out.flare) dropFlares(this, a);
    }

    stepShells(this, dt);
    stepMissiles(this, dt);
    stepFlares(this, dt);
    this.service(dt);
    this.updateResult(dt);
  }

  private service(dt: number) {
    const p = this.player;
    const surface = surfaceAt(p.pos.x, p.pos.y);
    const atHome = surface.airfield?.side === p.side;
    if (!(p.alive && p.onGround && atHome && p.speed < 1 && p.throttle < 0.2)) {
      if (p.serviceTime > 0 && p.serviceTime < SERVICE_TIME) {
        this.say('msg.serviceInterrupted');
        p.serviceTime = 0;
      } else if (p.speed >= 1 || !p.onGround) p.serviceTime = 0;
      return;
    }
    if (p.serviceTime >= SERVICE_TIME) return;
    if (p.serviceTime === 0) this.say('msg.serviceStart');
    p.serviceTime += dt;
    if (p.serviceTime >= SERVICE_TIME) {
      serviceAircraft(p);
      this.say('msg.serviceDone');
    }
  }

  private updateResult(dt: number) {
    if (this.result !== 'active') return;
    // Air superiority sortie: won when every enemy fighter is down.
    if (this.aircraft.every((a) => a.side === this.player.side || !a.alive)) {
      this.result = 'victory';
      this.say('msg.victory');
      return;
    }
    if (!this.player.alive) {
      this.lostTimer += dt;
      if (!this.player.falling || this.lostTimer > 8) {
        this.result = 'defeat';
        this.say('msg.defeat', { cause: this.player.cause }, true);
      }
    }
  }

  drainEvents() {
    return this.events.splice(0);
  }
}

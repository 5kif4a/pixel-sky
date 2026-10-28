import { AIRCRAFT, type AircraftId, type AircraftSpec, type ModuleSpec } from '../data/aircraft';
import type { Side } from '../data/mission';
import { GUNS, MISSILES } from '../data/weapons';
import { msg, type Key, type Msg } from '../i18n';
import { add, scale, vec, type Vec3 } from '../world/math';

export interface ModuleState {
  spec: ModuleSpec;
  hp: number;
  /** Remaining burn time, s; 0 when not burning. */
  fire: number;
}

export type FlightRegime = 'normal' | 'stall' | 'spin';

/** Pilot inputs (from keyboard or AI). Ranges: roll/pitch/yaw −1..1, throttle 0..1. */
export interface Controls {
  roll: number;
  pitch: number;
  /** Direct stick: roll commands angular rate and pitch commands normal load, without attitude hold. */
  manual?: boolean;
  /** Faster bank capture for mouse pointing, with the same physical roll inertia. */
  noseAim?: boolean;
  /** Rudder: +1 nose right (tail left). */
  yaw: number;
  throttle: number;
  afterburner: boolean;
  airbrake: boolean;
  wheelBrake: boolean;
  /** Without pitch input the flight path slowly returns to level. */
  levelAssist: boolean;
}
export const neutralControls = (throttle = 0.8): Controls => ({
  roll: 0,
  pitch: 0,
  yaw: 0,
  throttle,
  afterburner: false,
  airbrake: false,
  wheelBrake: false,
  levelAssist: false,
});

/** Values derived each step, kept for the HUD, AI and tests. */
export interface Telemetry {
  mach: number;
  ias: number;
  thrust: number;
  drag: number;
  fuelFlow: number;
  agl: number;
  verticalSpeed: number;
  maxLoad: number;
  stallSpeed: number;
  overG: boolean;
  overspeed: boolean;
}

export interface Aircraft {
  id: number;
  spec: AircraftSpec;
  side: Side;
  /** Translation key of the callsign. */
  callsign: Key;
  pos: Vec3;
  prevPos: Vec3;
  /** True airspeed, m/s. */
  speed: number;
  /** Course of the velocity vector, rad (0 = east, π/2 = south). */
  heading: number;
  /** Flight-path angle, rad. */
  gamma: number;
  bank: number;
  alpha: number;
  /** Normal load factor, g. */
  load: number;
  throttle: number;
  afterburner: boolean;
  /** Commanded flap setting: 0 up, 1 take-off, 2 landing. */
  flaps: 0 | 1 | 2;
  flapPos: number;
  flapsBroken: boolean;
  gearDown: boolean;
  gearPos: number;
  airbrakePos: number;
  wheelBrake: boolean;
  pitchInput: number;
  /** Actual roll angular velocity, rad/s, with finite acceleration and damping. */
  rollVelocity: number;
  yawInput: number;
  fuel: number;
  gunAmmo: number;
  missiles: number;
  flares: number;
  onGround: boolean;
  regime: FlightRegime;
  spinDirection: number;
  recovery: number;
  pilot: { stress: number; negativeStress: number; gloc: number };
  modules: ModuleState[];
  alive: boolean;
  /** Destroyed but still falling. */
  falling: boolean;
  cause: Msg;
  gunAccumulator: number;
  missileCooldown: number;
  serviceTime: number;
  telemetry: Telemetry;
}

export function createAircraft(
  id: number,
  type: AircraftId,
  side: Side,
  callsign: Key,
  pos: Vec3,
  heading: number,
  speed: number,
): Aircraft {
  const spec = AIRCRAFT[type];
  const airborne = speed > 1;
  return {
    id,
    spec,
    side,
    callsign,
    pos: { ...pos },
    prevPos: { ...pos },
    speed,
    heading,
    gamma: 0,
    bank: 0,
    alpha: 0,
    load: 1,
    throttle: airborne ? 0.85 : 0,
    afterburner: false,
    flaps: airborne || !spec.hasFlaps ? 0 : 1,
    flapPos: airborne || !spec.hasFlaps ? 0 : 0.5,
    flapsBroken: false,
    gearDown: !airborne,
    gearPos: airborne ? 0 : 1,
    airbrakePos: 0,
    wheelBrake: false,
    pitchInput: 0,
    rollVelocity: 0,
    yawInput: 0,
    fuel: spec.internalFuel,
    gunAmmo: spec.gunRounds,
    missiles: spec.missileCount,
    flares: spec.flares,
    onGround: !airborne,
    regime: 'normal',
    spinDirection: 1,
    recovery: 0,
    pilot: { stress: 0, negativeStress: 0, gloc: 0 },
    modules: spec.modules.map((m) => ({ spec: m, hp: m.hp, fire: 0 })),
    alive: true,
    falling: false,
    cause: msg('cause.crashGround'),
    gunAccumulator: 0,
    missileCooldown: 0,
    serviceTime: 0,
    telemetry: {
      mach: 0,
      ias: speed,
      thrust: 0,
      drag: 0,
      fuelFlow: 0,
      agl: 0,
      verticalSpeed: 0,
      maxLoad: spec.gLimit,
      stallSpeed: 0,
      overG: false,
      overspeed: false,
    },
  };
}

/** Restores fuel, ammunition and all modules (ground service). */
export function serviceAircraft(a: Aircraft) {
  a.rollVelocity = 0;
  a.yawInput = 0;
  const s = a.spec;
  a.fuel = s.internalFuel;
  a.gunAmmo = s.gunRounds;
  a.missiles = s.missileCount;
  a.flares = s.flares;
  a.flapsBroken = false;
  for (const m of a.modules) {
    m.hp = m.spec.hp;
    m.fire = 0;
  }
  a.pilot = { stress: 0, negativeStress: 0, gloc: 0 };
}

export function aircraftMass(a: Aircraft) {
  const s = a.spec;
  return (
    s.emptyMass +
    100 +
    a.fuel +
    a.gunAmmo * GUNS[s.gun].roundMass +
    a.missiles * MISSILES[s.missile].mass
  );
}

export function velocity(a: Aircraft): Vec3 {
  const c = Math.cos(a.gamma);
  return vec(
    a.speed * c * Math.cos(a.heading),
    a.speed * c * Math.sin(a.heading),
    a.speed * Math.sin(a.gamma),
  );
}

export interface Axes {
  forward: Vec3;
  right: Vec3;
  up: Vec3;
}
/** Wind axes (velocity frame) rotated by bank. */
export function windAxes(heading: number, gamma: number, bank: number): Axes {
  const cg = Math.cos(gamma),
    sg = Math.sin(gamma),
    ch = Math.cos(heading),
    sh = Math.sin(heading);
  const forward = vec(cg * ch, cg * sh, sg);
  const up0 = vec(-sg * ch, -sg * sh, cg);
  const right0 = vec(-sh, ch, 0);
  const cb = Math.cos(bank),
    sb = Math.sin(bank);
  return {
    forward,
    right: add(scale(right0, cb), scale(up0, -sb)),
    up: add(scale(up0, cb), scale(right0, sb)),
  };
}
/** Body axes: the nose is raised above the flight path by the angle of attack. */
export function bodyAxes(a: Aircraft): Axes {
  const w = windAxes(a.heading, a.gamma, a.bank);
  const ca = Math.cos(a.alpha),
    sa = Math.sin(a.alpha);
  return {
    forward: add(scale(w.forward, ca), scale(w.up, sa)),
    right: w.right,
    up: add(scale(w.up, ca), scale(w.forward, -sa)),
  };
}
export function bodyToWorld(a: Aircraft, axes: Axes, p: readonly [number, number, number]) {
  return {
    x: a.pos.x + axes.forward.x * p[0] + axes.right.x * p[1] + axes.up.x * p[2],
    y: a.pos.y + axes.forward.y * p[0] + axes.right.y * p[1] + axes.up.y * p[2],
    z: a.pos.z + axes.forward.z * p[0] + axes.right.z * p[1] + axes.up.z * p[2],
  };
}

export const integrity = (m: ModuleState) => Math.max(0, m.hp / m.spec.hp);
export const modulesOf = (a: Aircraft, kind: ModuleState['spec']['kind']) =>
  a.modules.filter((m) => m.spec.kind === kind);

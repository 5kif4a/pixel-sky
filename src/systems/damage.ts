import {
  bodyAxes,
  bodyToWorld,
  integrity,
  type Aircraft,
  type ModuleState,
} from '../entities/aircraft';
import {
  fragmentChance,
  fragmentDamage,
  shellDamage,
  shellSplashRadius,
  type GunSpec,
} from '../data/weapons';
import { distance, segmentClosest, type Rng, type Vec3 } from '../world/math';
import { msg, type Key, type Msg } from '../i18n';
import type { EventSink } from './events';

/** How the current damage changes the aircraft; consumed by the flight model. */
export interface DamageEffects {
  /** Thrust factor of each engine, 0 = dead. */
  thrust: number[];
  lift: number;
  /** Uncommanded roll rate from asymmetric wing damage, rad/s (+ = to the right). */
  rollAsymmetry: number;
  rollAuthority: number;
  pitchAuthority: number;
  extraDrag: number;
  /** Fuel leak, kg/s. */
  leak: number;
  gearWorks: boolean;
  gunWorks: boolean;
  /** Reduction of the pilot's G tolerance from wounds, g. */
  gPenalty: number;
}

const part = (a: Aircraft, id: string) => a.modules.find((m) => m.spec.id === id);
const health = (m: ModuleState | undefined) => (m ? integrity(m) : 1);

export function damageEffects(a: Aircraft): DamageEffects {
  const engines = a.modules.filter((m) => m.spec.kind === 'engine');
  const left = health(part(a, 'wing-l')),
    right = health(part(a, 'wing-r'));
  const liftL = 0.35 + 0.65 * left,
    liftR = 0.35 + 0.65 * right;
  const controls = health(part(a, 'controls'));
  const tail = health(part(a, 'tail'));
  let extraDrag = 0,
    leak = 0;
  for (const m of a.modules) {
    const lost = 1 - integrity(m);
    if (m.spec.kind === 'wing' || m.spec.kind === 'tail' || m.spec.kind === 'airframe')
      extraDrag += lost * 0.004;
    if (m.spec.kind === 'fuel') leak += lost * 2.5;
  }
  return {
    thrust: engines.map((m) => (m.hp <= 0 ? 0 : Math.min(1, 0.35 + integrity(m) * 0.75))),
    lift: (liftL + liftR) / 2,
    rollAsymmetry: (liftL - liftR) * 1.4,
    rollAuthority: (0.25 + 0.75 * controls) * Math.sqrt(Math.min(liftL, liftR)),
    pitchAuthority: (0.3 + 0.7 * tail) * (0.4 + 0.6 * controls),
    extraDrag,
    leak,
    gearWorks: health(part(a, 'gear')) > 0.4,
    gunWorks: health(part(a, 'gun')) > 0.25,
    gPenalty: (1 - health(part(a, 'pilot'))) * 2.5,
  };
}

/** Marks the aircraft as lost. Exploding aircraft disappear, others fall as wrecks. */
export function loseAircraft(a: Aircraft, cause: Msg, explode: boolean, events: EventSink) {
  if (!a.alive) return;
  a.alive = false;
  a.cause = cause;
  a.falling = !explode && !a.onGround;
  a.spinDirection = a.bank >= 0 ? 1 : -1;
  events.push({ type: 'destroyed', aircraftId: a.id, cause });
  if (explode || a.onGround) events.push({ type: 'explosion', pos: { ...a.pos }, size: 28 });
}

function moduleDestroyed(a: Aircraft, m: ModuleState, events: EventSink, rng: Rng) {
  const name = '@module.' + m.spec.id;
  const say = (key: Key) =>
    events.push({
      type: 'message',
      msg: msg(key, { module: name }),
      aircraftId: a.id,
      warning: true,
    });
  switch (m.spec.kind) {
    case 'pilot':
      return loseAircraft(a, msg('cause.pilotKilled'), false, events);
    case 'wing':
      return loseAircraft(a, msg('cause.wingDestroyed', { module: name }), false, events);
    case 'tail':
      return loseAircraft(a, msg('cause.tailDestroyed'), false, events);
    case 'controls':
      return loseAircraft(a, msg('cause.controlsFailed'), false, events);
    case 'airframe':
      return loseAircraft(a, msg('cause.airframeFailed'), true, events);
    case 'fuel':
      if (m.fire > 0 || rng() < 0.3)
        return loseAircraft(a, msg('cause.tankExploded'), true, events);
      return say('msg.tankLeak');
    case 'ammo':
      if (rng() < 0.35) return loseAircraft(a, msg('cause.ammoDetonated'), true, events);
      return say('msg.ammoDamaged');
    case 'engine':
      return say('msg.engineFailed');
    case 'gun':
      return say('msg.gunDisabled');
    case 'gear':
      return say('msg.gearDamaged');
  }
}

export function applyDamage(
  a: Aircraft,
  m: ModuleState,
  dp: number,
  events: EventSink,
  rng: Rng,
  canIgnite = true,
) {
  if ((!a.alive && !a.falling) || dp <= 0 || m.hp <= 0) return;
  const before = m.hp;
  m.hp = Math.max(0, m.hp - dp * m.spec.armor);
  const flammable = m.spec.kind === 'engine' || m.spec.kind === 'fuel';
  if (canIgnite && flammable && m.fire <= 0 && rng() < 0.1 + (0.5 * dp) / m.spec.hp) {
    m.fire = 8 + rng() * 18;
    if (a.alive)
      events.push({
        type: 'message',
        msg: msg('msg.fire', { module: '@module.' + m.spec.id }),
        aircraftId: a.id,
        warning: true,
      });
  }
  if (before > 0 && m.hp <= 0 && a.alive) moduleDestroyed(a, m, events, rng);
}

/** Fires burn their module and heat neighbours until they go out. */
export function updateFires(a: Aircraft, dt: number, events: EventSink, rng: Rng) {
  for (const m of a.modules) {
    if (m.fire <= 0) continue;
    m.fire -= dt;
    applyDamage(a, m, 7 * dt, events, rng, false);
    for (const n of a.modules)
      if (n !== m && Math.hypot(...n.spec.pos.map((v, i) => v - m.spec.pos[i])) < 2.5)
        applyDamage(a, n, 2 * dt, events, rng, false);
    if (m.fire <= 0 && a.alive)
      events.push({
        type: 'message',
        msg: msg('msg.fireOut', { module: '@module.' + m.spec.id }),
        aircraftId: a.id,
      });
  }
}

export function modulePositions(a: Aircraft) {
  const axes = bodyAxes(a);
  return a.modules.map((m) => bodyToWorld(a, axes, m.spec.pos));
}

/**
 * Resolves a shell crossing the aircraft along segment p0→p1 (already in the aircraft's
 * moving frame). The first module takes kinetic and explosive damage, modules further along
 * the path take reduced kinetic damage, nearby modules take splash. Returns the impact point.
 */
export function shellHit(
  a: Aircraft,
  p0: Vec3,
  p1: Vec3,
  gun: GunSpec,
  relativeSpeed: number,
  events: EventSink,
  rng: Rng,
): Vec3 | undefined {
  const positions = modulePositions(a);
  const hits: { m: ModuleState; t: number; p: Vec3 }[] = [];
  a.modules.forEach((m, i) => {
    const c = segmentClosest(p0, p1, positions[i]);
    if (c.distance <= m.spec.radius) hits.push({ m, t: c.t, p: positions[i] });
  });
  if (!hits.length) return;
  hits.sort((x, y) => x.t - y.t);
  const t = hits[0].t;
  const impact = {
    x: p0.x + (p1.x - p0.x) * t,
    y: p0.y + (p1.y - p0.y) * t,
    z: p0.z + (p1.z - p0.z) * t,
  };
  const kinetic = ((0.5 * gun.shellMass * relativeSpeed ** 2) / 1000) * 0.15;
  applyDamage(a, hits[0].m, shellDamage(gun, relativeSpeed), events, rng);
  hits.slice(1).forEach((h, i) => applyDamage(a, h.m, kinetic * 0.5 ** (i + 1), events, rng));
  const splash = shellSplashRadius(gun);
  a.modules.forEach((m, i) => {
    if (m === hits[0].m) return;
    const d = Math.max(0, distance(impact, positions[i]) - m.spec.radius);
    if (d < splash) applyDamage(a, m, gun.explosiveMass * 1000 * (1 - d / splash), events, rng);
  });
  events.push({ type: 'hit', pos: impact, aircraftId: a.id });
  return impact;
}

/** Warhead or bomb blast: every module takes damage falling off with distance. */
export function blastAircraft(
  a: Aircraft,
  point: Vec3,
  explosiveKg: number,
  events: EventSink,
  rng: Rng,
) {
  if (!a.alive && !a.falling) return;
  if (distance(a.pos, point) > 60 + a.spec.length) return;
  const positions = modulePositions(a);
  a.modules.forEach((m, i) => {
    const d = Math.max(0, distance(point, positions[i]) - m.spec.radius);
    const hit = rng() < fragmentChance(d);
    const dp = fragmentDamage(explosiveKg, d) * (hit ? 0.3 + 1.4 * rng() : 0.15);
    if (dp > 1) applyDamage(a, m, dp, events, rng);
  });
}

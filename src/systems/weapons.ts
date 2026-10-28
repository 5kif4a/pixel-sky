import { bodyAxes, bodyToWorld, velocity, type Aircraft } from '../entities/aircraft';
import { GUNS, MISSILES, shellDamage, type GunSpec, type MissileSpec } from '../data/weapons';
import { atmosphere, SEA_LEVEL_DENSITY, type Weather } from '../world/atmosphere';
import {
  G,
  add,
  addScaled,
  angleBetween,
  clamp,
  copy,
  cross,
  distance,
  dot,
  gaussian,
  length,
  normalize,
  scale,
  segmentClosest,
  sub,
  vec,
  type Rng,
  type Vec3,
} from '../world/math';
import { groundHeight, obstacleHeight, terrainBlocks, terrainHeight } from '../world/terrain';
import { blastAircraft, shellHit } from './damage';
import { msg } from '../i18n';
import type { EventSink } from './events';

export interface Shell {
  pos: Vec3;
  prev: Vec3;
  vel: Vec3;
  life: number;
  ownerId: number;
  gun: GunSpec;
  tracer: boolean;
}
export interface Missile {
  id: number;
  pos: Vec3;
  prev: Vec3;
  vel: Vec3;
  time: number;
  ownerId: number;
  spec: MissileSpec;
  target?: Aircraft;
  /** Flare the seeker switched to. */
  decoy?: Vec3;
  alive: boolean;
}
export interface Flare {
  pos: Vec3;
  vel: Vec3;
  life: number;
  /** Relative size of the flare (large-calibre ones are bigger and burn longer). */
  size: number;
}
export interface WeaponWorld {
  aircraft: Aircraft[];
  shells: Shell[];
  missiles: Missile[];
  flares: Flare[];
  events: EventSink;
  rng: Rng;
  weather: Weather;
}

const MAX_SHELLS = 1500;
const gunOf = (a: Aircraft) => GUNS[a.spec.gun] as GunSpec;
export const missileOf = (a: Aircraft) => MISSILES[a.spec.missile] as MissileSpec;

/** Muzzle position and bore line of the aircraft's gun. */
export function gunBore(a: Aircraft, outlet = 0) {
  const axes = bodyAxes(a);
  const muzzle = a.spec.gunMuzzles[outlet % a.spec.gunMuzzles.length];
  return {
    origin: bodyToWorld(a, axes, muzzle),
    direction: axes.forward,
  };
}

/**
 * Lead point for the gun: where the target will be when a shell arrives, raised by the
 * gravity drop. Shell speed is reduced to an average to account for drag.
 */
export function gunLead(a: Aircraft, target: Aircraft) {
  const gun = gunOf(a);
  const shooterVel = velocity(a);
  const targetVel = velocity(target);
  const bore = gunBore(a);
  let t = distance(bore.origin, target.pos) / (gun.muzzleVelocity + a.speed);
  for (let i = 0; i < 4; i++) {
    const avgSpeed = (gun.muzzleVelocity + dot(shooterVel, bore.direction)) * (1 - 0.18 * t);
    const future = addScaled(target.pos, targetVel, t);
    t = distance(bore.origin, future) / Math.max(200, avgSpeed);
  }
  const point = addScaled(target.pos, targetVel, t);
  point.z += 0.5 * G * t * t;
  // The shells inherit the shooter's velocity; aim compensates for it.
  return { point: addScaled(point, shooterVel, -t), time: t };
}

export function fireGun(w: WeaponWorld, a: Aircraft, dt: number, assistTarget?: Aircraft) {
  const gun = gunOf(a);
  a.gunAccumulator += (gun.rpm / 60) * dt;
  const bore = gunBore(a);
  let aim = bore.direction;
  if (assistTarget?.alive && distance(a.pos, assistTarget.pos) < 1600) {
    // Small convergence assist: keeps iso aiming playable, only within 2.5° of the bore.
    const lead = normalize(sub(gunLead(a, assistTarget).point, bore.origin));
    if (angleBetween(lead, bore.direction) < 0.044) aim = lead;
  }
  const base = velocity(a);
  const ammoBefore = a.gunAmmo;
  while (a.gunAccumulator >= 1) {
    a.gunAccumulator -= 1;
    if (a.gunAmmo <= 0 || w.shells.length >= MAX_SHELLS) continue;
    a.gunAmmo--;
    const dir = normalize({
      x: aim.x + gaussian(w.rng) * gun.dispersion,
      y: aim.y + gaussian(w.rng) * gun.dispersion,
      z: aim.z + gaussian(w.rng) * gun.dispersion,
    });
    const muzzle = gunBore(a, (a.spec.gunRounds - a.gunAmmo - 1) % a.spec.gunMuzzles.length);
    const origin = addScaled(muzzle.origin, dir, w.rng() * gun.muzzleVelocity * dt);
    w.shells.push({
      pos: origin,
      prev: copy(origin),
      vel: addScaled(base, dir, gun.muzzleVelocity),
      life: gun.lifetime,
      ownerId: a.id,
      gun,
      tracer: a.gunAmmo % 3 === 0,
    });
  }
  if (a.gunAmmo < ammoBefore)
    w.events.push({ type: 'gun', pos: copy(bore.origin), aircraftId: a.id });
}

export function stepShells(w: WeaponWorld, dt: number) {
  const air = atmosphere(1000, w.weather);
  for (const s of w.shells) {
    s.prev = copy(s.pos);
    const v = length(s.vel);
    const rho = air.density / SEA_LEVEL_DENSITY;
    s.vel = addScaled(s.vel, s.vel, -s.gun.dragK * v * rho * dt);
    s.vel.z -= G * dt;
    s.pos = addScaled(s.pos, s.vel, dt);
    s.life -= dt;
    for (const a of w.aircraft) {
      if (a.id === s.ownerId || (!a.alive && !a.falling)) continue;
      // Work in the target's frame: shift the segment start by the target's own motion.
      const p0 = add(s.prev, sub(a.pos, a.prevPos));
      if (segmentClosest(p0, s.pos, a.pos).distance > a.spec.length * 0.6) continue;
      const rel = length(sub(s.vel, velocity(a)));
      if (shellHit(a, p0, s.pos, s.gun, rel, w.events, w.rng)) {
        s.life = 0;
        break;
      }
    }
    if (s.life <= 0) continue;
    const ground = terrainHeight(s.pos.x, s.pos.y);
    if (s.pos.z <= Math.max(0, ground)) {
      s.life = 0;
      w.events.push({ type: 'impact', pos: copy(s.pos), water: ground <= 0 });
    }
  }
  w.shells = w.shells.filter((s) => s.life > 0);
}

/** IR lock: target in the seeker cone, in range (aspect and afterburner matter), not masked. */
export function canLock(a: Aircraft, target: Aircraft) {
  if (!target.alive || a.missiles <= 0) return false;
  const spec = missileOf(a);
  const toTarget = sub(target.pos, a.pos);
  const range = length(toTarget);
  // Off-boresight: the seeker is cued by the helmet sight anywhere within its gimbal limit.
  if (angleBetween(bodyAxes(a).forward, toTarget) > spec.gimbal) return false;
  // Rear aspect sees the hot nozzle: compare target heading with line of sight.
  const tail = angleBetween(velocity(target), toTarget);
  const aspect =
    0.45 + 0.55 * clamp(1 - tail / Math.PI, 0, 1) ** 0.5 * (tail < Math.PI / 2 ? 1 : 0.6);
  const heat = target.afterburner ? 1.5 : target.throttle < 0.3 ? 0.75 : 1;
  if (range > spec.lockRange * aspect * heat) return false;
  return !terrainBlocks(a.pos, target.pos);
}

export function launchMissile(w: WeaponWorld, a: Aircraft, target: Aircraft) {
  const spec = missileOf(a);
  const axes = bodyAxes(a);
  a.missiles--;
  a.missileCooldown = 1;
  const pos = addScaled(addScaled(a.pos, axes.up, -1.2), axes.right, a.missiles % 2 ? 2 : -2);
  w.events.push({ type: 'missileLaunch', pos: copy(pos), aircraftId: a.id });
  w.missiles.push({
    id: w.missiles.length + Math.floor(w.rng() * 1e6),
    pos,
    prev: copy(pos),
    vel: addScaled(velocity(a), axes.forward, 25),
    time: 0,
    ownerId: a.id,
    spec,
    target,
    alive: true,
  });
}

function detonateMissile(w: WeaponWorld, m: Missile, at: Vec3) {
  m.alive = false;
  w.events.push({ type: 'explosion', pos: copy(at), size: 14 });
  for (const a of w.aircraft) blastAircraft(a, at, m.spec.warhead, w.events, w.rng);
}

/**
 * Proximity fuse: the point where segment p0→p1 first enters the fuse sphere around the
 * target (the fuse fires on entry, not at the closest approach).
 */
export function fuseEntry(p0: Vec3, p1: Vec3, target: Vec3, radius: number): Vec3 | undefined {
  const d = sub(p1, p0);
  const f = sub(p0, target);
  const a = dot(d, d);
  const c = dot(f, f) - radius * radius;
  if (c <= 0) return copy(p0);
  if (a === 0) return;
  const b = 2 * dot(f, d);
  const disc = b * b - 4 * a * c;
  if (disc < 0) return;
  const t = (-b - Math.sqrt(disc)) / (2 * a);
  if (t < 0 || t > 1) return;
  return addScaled(p0, d, t);
}

export function stepMissiles(w: WeaponWorld, dt: number) {
  for (const m of w.missiles) {
    if (!m.alive) continue;
    m.prev = copy(m.pos);
    m.time += dt;
    const air = atmosphere(m.pos.z, w.weather);
    const rho = air.density / SEA_LEVEL_DENSITY;
    const speed = length(m.vel);
    const dir = normalize(m.vel);
    const t = m.target;
    if (t && (!t.alive || angleBetween(dir, sub(t.pos, m.pos)) > m.spec.gimbal))
      m.target = undefined;
    const aimPos = m.target ? m.target.pos : m.decoy;
    const aimVel = m.target ? velocity(m.target) : vec(0, 0, -15);
    let accel = vec();
    if (aimPos) {
      // Proportional navigation with gravity compensation.
      const r = sub(aimPos, m.pos);
      const vr = sub(aimVel, m.vel);
      const omega = scale(cross(r, vr), 1 / Math.max(1, dot(r, r)));
      accel = scale(cross(omega, m.vel), m.spec.navigation);
      accel = add(accel, vec(0, 0, G));
      const limit = m.spec.maxG * G * clamp(rho * 2.2, 0.25, 1);
      const a = length(accel);
      if (a > limit) accel = scale(accel, limit / a);
    }
    const thrust = m.time < m.spec.burnTime ? m.spec.thrustAccel : 0;
    const dragAcc = m.spec.dragK * rho * speed * speed + length(accel) * 0.08;
    m.vel = addScaled(m.vel, add(accel, scale(dir, thrust - dragAcc)), dt);
    m.vel.z -= G * dt;
    m.pos = addScaled(m.pos, m.vel, dt);
    if (m.target) {
      const entry = fuseEntry(
        add(m.prev, sub(m.target.pos, m.target.prevPos)),
        m.pos,
        m.target.pos,
        m.spec.fuse,
      );
      if (entry) {
        detonateMissile(w, m, entry);
        continue;
      }
    }
    if (m.pos.z <= obstacleHeight(m.pos.x, m.pos.y)) {
      m.alive = false;
      w.events.push({ type: 'explosion', pos: copy(m.pos), size: 12 });
      continue;
    }
    if (m.time > m.spec.lifetime || (m.time > m.spec.burnTime && length(m.vel) < m.spec.minSpeed)) {
      m.alive = false;
      w.events.push({ type: 'explosion', pos: copy(m.pos), size: 6 });
    }
  }
  w.missiles = w.missiles.filter((m) => m.alive);
}

/** Flare salvo: each missile chasing this aircraft may switch to the flare. */
export function dropFlares(w: WeaponWorld, a: Aircraft) {
  if (a.flares <= 0) return false;
  a.flares--;
  w.events.push({ type: 'flare', pos: copy(a.pos), aircraftId: a.id });
  const v = velocity(a);
  const power = a.spec.flarePower;
  for (let i = 0; i < 2; i++)
    w.flares.push({
      pos: copy(a.pos),
      vel: { x: v.x * 0.4 + (w.rng() - 0.5) * 30, y: v.y * 0.4 + (w.rng() - 0.5) * 30, z: -10 },
      life: 4 * Math.sqrt(power),
      size: power,
    });
  for (const m of w.missiles) {
    if (m.target !== a) continue;
    const range = distance(m.pos, a.pos);
    if (range > 4000) continue;
    const rear = angleBetween(velocity(a), sub(a.pos, m.pos)) < Math.PI / 2;
    const chance = Math.min(
      0.9,
      m.spec.flareSusceptibility *
        power *
        (a.afterburner ? 0.45 : 1) *
        (rear ? 0.85 : 1.15) *
        (range < 600 ? 0.6 : 1),
    );
    if (w.rng() < chance) {
      m.target = undefined;
      m.decoy = copy(a.pos);
    }
  }
  return true;
}

export function stepFlares(w: WeaponWorld, dt: number) {
  for (const f of w.flares) {
    f.vel.z -= G * 0.3 * dt;
    f.pos = addScaled(f.pos, f.vel, dt);
    f.life -= dt;
  }
  w.flares = w.flares.filter((f) => f.life > 0);
  for (const m of w.missiles)
    if (m.decoy) {
      m.decoy.z -= 15 * dt;
    }
}

import { neutralControls, velocity, type Aircraft, type Controls } from '../entities/aircraft';
import { AI_COMBAT, AIRFIELDS, DETECTION_RANGE, ENEMY_PATROL } from '../data/mission';
import {
  DEG,
  addScaled,
  angleBetween,
  angleDiff,
  clamp,
  distance,
  sub,
  type Rng,
  type Vec3,
} from '../world/math';
import { groundHeight, terrainBlocks } from '../world/terrain';
import { damageEffects } from '../systems/damage';
import { canLock, gunBore, gunLead, missileOf, type Missile } from '../systems/weapons';
import { instructor } from './instructor';

export type AiMode = 'patrol' | 'intercept' | 'attack' | 'evade' | 'rtb';

export interface AiState {
  mode: AiMode;
  target?: Aircraft;
  threat?: Missile;
  decisionTimer: number;
  orbit: number;
  lockTime: number;
  /** Seconds since the current target was first seen: the pilot needs time to react. */
  contactTime: number;
  /** Aim error of this pilot, radians (skill). */
  aimError: number;
}

export interface AiOutput {
  controls: Controls;
  fireGun: boolean;
  fireMissile?: Aircraft;
  flare: boolean;
}

export const createAi = (rng: Rng): AiState => ({
  mode: 'patrol',
  decisionTimer: rng() * 0.2,
  orbit: rng() * Math.PI * 2,
  lockTime: 0,
  contactTime: 0,
  aimError: 0.006 + rng() * 0.006,
});

/** Decisions run at 5 Hz; steering runs every step. */
function decide(ai: AiState, a: Aircraft, aircraft: Aircraft[], missiles: Missile[]) {
  ai.threat = missiles
    .filter((m) => m.alive && m.target === a && distance(m.pos, a.pos) < 6000)
    .sort((x, y) => distance(x.pos, a.pos) - distance(y.pos, a.pos))[0];
  const visible = aircraft.filter(
    (o) =>
      o.side !== a.side &&
      o.alive &&
      distance(o.pos, a.pos) < DETECTION_RANGE &&
      !terrainBlocks(a.pos, o.pos),
  );
  if (!ai.target?.alive || !visible.includes(ai.target)) {
    ai.target = visible.sort((x, y) => distance(x.pos, a.pos) - distance(y.pos, a.pos))[0];
    ai.contactTime = 0;
    ai.lockTime = 0;
  }
  if (ai.threat) ai.mode = 'evade';
  else if (a.fuel < a.spec.internalFuel * 0.15) ai.mode = 'rtb';
  else if (!ai.target) ai.mode = 'patrol';
  else ai.mode = distance(ai.target.pos, a.pos) < 12_000 ? 'attack' : 'intercept';
}

function steer(a: Aircraft, point: Vec3, altitude: number) {
  const to = sub(point, a.pos);
  const err = angleDiff(a.heading, Math.atan2(to.y, to.x));
  const wantGamma = clamp(
    Math.atan2(altitude - a.pos.z, Math.hypot(to.x, to.y)),
    -35 * DEG,
    35 * DEG,
  );
  return instructor(a, a.heading + err, wantGamma);
}

/** Pulls up when the flight path will meet the ground within ~8 s. */
function terrainGuard(a: Aircraft, c: Controls) {
  const v = velocity(a);
  for (const t of [2, 4, 6, 8]) {
    const p = addScaled(a.pos, v, t);
    if (p.z - groundHeight(p.x, p.y) < 250 + a.speed * 0.6) {
      Object.assign(c, instructor(a, a.heading, 20 * DEG));
      return true;
    }
  }
  return false;
}

export function thinkFighter(
  ai: AiState,
  a: Aircraft,
  aircraft: Aircraft[],
  missiles: Missile[],
  dt: number,
  rng: Rng,
): AiOutput {
  ai.decisionTimer -= dt;
  if (ai.decisionTimer <= 0) {
    ai.decisionTimer = 0.2;
    decide(ai, a, aircraft, missiles);
  }
  const c = neutralControls(0.8);
  const out: AiOutput = { controls: c, fireGun: false, flare: false };
  const t = ai.target;
  if (t && distance(a.pos, t.pos) < 5000) ai.contactTime += dt;
  else ai.contactTime = 0;
  if (ai.mode !== 'attack') ai.lockTime = 0;
  switch (ai.mode) {
    case 'patrol': {
      ai.orbit += (a.speed / ENEMY_PATROL.radius) * dt;
      const p = {
        x: ENEMY_PATROL.x + Math.cos(ai.orbit + 0.6) * ENEMY_PATROL.radius,
        y: ENEMY_PATROL.y + Math.sin(ai.orbit + 0.6) * ENEMY_PATROL.radius,
        z: ENEMY_PATROL.altitude,
      };
      Object.assign(c, steer(a, p, ENEMY_PATROL.altitude), { throttle: 0.75 });
      break;
    }
    case 'intercept': {
      const p = addScaled(t!.pos, velocity(t!), 10);
      Object.assign(c, steer(a, p, t!.pos.z + 300), { throttle: 1 });
      c.afterburner = distance(a.pos, t!.pos) > 15_000 && a.fuel > a.spec.internalFuel * 0.4;
      break;
    }
    case 'attack': {
      const range = distance(a.pos, t!.pos);
      const lead = range < 1800 ? gunLead(a, t!).point : addScaled(t!.pos, velocity(t!), 1.5);
      Object.assign(c, steer(a, lead, lead.z), { throttle: 1 });
      c.afterburner = a.speed < 240 && a.fuel > a.spec.internalFuel * 0.25;
      const bore = gunBore(a);
      const off = angleBetween(bore.direction, sub(lead, bore.origin));
      out.fireGun =
        range < 1000 && off < 0.03 + ai.aimError && a.gunAmmo > 0 && damageEffects(a).gunWorks;
      const toTarget = sub(t!.pos, a.pos);
      const firingPosition =
        range > AI_COMBAT.missileMinRange &&
        range < Math.min(AI_COMBAT.missileMaxRange, missileOf(a).lockRange * 0.5) &&
        angleBetween(velocity(t!), toTarget) < AI_COMBAT.missileRearConeDegrees * DEG &&
        angleBetween(bore.direction, toTarget) < AI_COMBAT.missileAimConeDegrees * DEG &&
        canLock(a, t!);
      if (firingPosition) ai.lockTime += dt;
      else ai.lockTime = 0;
      const ownInFlight = missiles.some((m) => m.alive && m.ownerId === a.id);
      const targetUnderAttack = missiles.some((m) => m.alive && m.target === t);
      if (
        ai.contactTime > AI_COMBAT.missileContactDelay &&
        ai.lockTime > AI_COMBAT.missileLockTime &&
        !ownInFlight &&
        !targetUnderAttack &&
        a.missileCooldown <= 0
      ) {
        out.fireMissile = t;
        ai.lockTime = 0;
      }
      break;
    }
    case 'evade': {
      const m = ai.threat!;
      const bearing = Math.atan2(m.pos.y - a.pos.y, m.pos.x - a.pos.x);
      // Beam the missile: fly perpendicular to its approach and dive towards the ground.
      const side = angleDiff(a.heading, bearing) > 0 ? -1 : 1;
      const heading = bearing + side * Math.PI * 0.5;
      const p = {
        x: a.pos.x + Math.cos(heading) * 3000,
        y: a.pos.y + Math.sin(heading) * 3000,
        z: 0,
      };
      const floor = groundHeight(a.pos.x, a.pos.y) + 700;
      Object.assign(c, steer(a, p, Math.max(floor, a.pos.z - 1500)), { throttle: 0.6 });
      out.flare = distance(m.pos, a.pos) < 3500 && rng() < dt * 2.5;
      break;
    }
    case 'rtb': {
      const base = AIRFIELDS[a.side];
      const p = { x: base.x, y: base.y, z: base.elevation + 3000 };
      Object.assign(c, steer(a, p, p.z), { throttle: 0.7 });
      break;
    }
  }
  if (terrainGuard(a, c)) {
    out.fireGun = false;
    out.fireMissile = undefined;
    ai.lockTime = 0;
  }
  if (a.regime !== 'normal') {
    // Spin recovery drill: opposite roll, nose down, idle.
    c.roll = -a.spinDirection;
    c.pitch = -1;
    c.throttle = 0.3;
  }
  // Keep the aim error visible as a slight wander of the controls.
  c.roll = clamp(c.roll + (rng() - 0.5) * ai.aimError * 4, -1, 1);
  return out;
}

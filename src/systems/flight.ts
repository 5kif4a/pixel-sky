import type { AircraftSpec } from '../data/aircraft';
import { HANDLING } from '../data/handling';
import {
  aircraftMass,
  integrity,
  velocity,
  type Aircraft,
  type Controls,
} from '../entities/aircraft';
import { atmosphere, SEA_LEVEL_DENSITY, type Air, type Weather } from '../world/atmosphere';
import {
  DEG,
  G,
  addScaled,
  angleDiff,
  approach,
  clamp,
  interpolate,
  wrapAngle,
  type Rng,
} from '../world/math';
import { obstacleHeight, surfaceAt, type Surface } from '../world/terrain';
import {
  applyDamage,
  damageEffects,
  loseAircraft,
  updateFires,
  type DamageEffects,
} from './damage';
import { msg, type Msg } from '../i18n';
import type { EventSink } from './events';

export interface FlightEnv {
  weather: Weather;
  events: EventSink;
  rng: Rng;
}

const IDLE = 0.06;
/** Pilot G tolerance with an anti-G suit before vision starts to suffer. */
export const G_TOLERANCE = 5.5;
/** Bank target range for the instructor only; direct stick can roll through any angle. */
const INSTRUCTOR_BANK = HANDLING.instructorBankDegrees * DEG;

/** Installed thrust and fuel flow of one engine. */
export function engineThrust(
  spec: AircraftSpec,
  air: Air,
  mach: number,
  throttle: number,
  afterburner: boolean,
  ias = 0,
) {
  const lapse = Math.pow(air.density / SEA_LEVEL_DENSITY, 0.75);
  // Inlet efficiency falls past Mach 2.2; the engine control holds the airframe IAS limit.
  const inletLimit =
    (mach > 2.2 ? Math.max(0, 1 - (mach - 2.2) * 1.5) : 1) *
    clamp(1 - (ias - spec.maxIas) / 25, 0, 1);
  if (afterburner) {
    const thrust = spec.afterburnerThrust * lapse * (1 + 0.6 * mach) * inletLimit;
    return { thrust, fuelFlow: thrust * spec.tsfcAfterburner };
  }
  const thrust = spec.dryThrust * lapse * (1 + 0.2 * mach) * inletLimit * Math.max(IDLE, throttle);
  return { thrust, fuelFlow: Math.max(0.08, thrust * spec.tsfcDry) };
}

const liftSlope = (spec: AircraftSpec) => spec.clMax / (spec.alphaStall * DEG);

export function liftCoefficient(spec: AircraftSpec, alpha: number, flapPos: number, factor = 1) {
  const stall = spec.alphaStall * DEG;
  const slope = liftSlope(spec);
  let cl =
    alpha <= stall
      ? slope * alpha
      : Math.max(spec.clMax * 0.55, spec.clMax - (alpha - stall) * slope * 0.8);
  cl = Math.max(cl, -spec.clMax * 0.6);
  return (cl + spec.flapLift * flapPos) * factor;
}
export function alphaForLift(spec: AircraftSpec, cl: number, flapPos: number, factor = 1) {
  return (cl / factor - spec.flapLift * flapPos) / liftSlope(spec);
}

export interface DragConfig {
  gearPos: number;
  flapPos: number;
  airbrakePos: number;
  stores: number;
  extraDrag: number;
}
export function dragCoefficient(spec: AircraftSpec, mach: number, cl: number, c: DragConfig) {
  const aspect = (spec.span * spec.span) / spec.wingArea;
  const k = (1 / (Math.PI * spec.oswald * aspect)) * (mach > 1 ? 1 + 0.5 * (mach - 1) : 1);
  return (
    interpolate(spec.dragTable, mach) +
    c.extraDrag +
    k * cl * cl +
    spec.gearDrag * c.gearPos +
    spec.flapDrag * c.flapPos +
    spec.airbrakeDrag * c.airbrakePos +
    spec.storeDrag * c.stores
  );
}

/** Thrust minus drag in steady level flight (clean, given mass), N. Used for tuning and tests. */
export function levelExcessThrust(
  spec: AircraftSpec,
  mass: number,
  altitude: number,
  speed: number,
  weather: Weather,
  afterburner = true,
) {
  const air = atmosphere(altitude, weather);
  const mach = speed / air.speedOfSound;
  const q = 0.5 * air.density * speed * speed;
  const cl = (mass * G) / (q * spec.wingArea);
  const cd = dragCoefficient(spec, mach, cl, {
    gearPos: 0,
    flapPos: 0,
    airbrakePos: 0,
    stores: 0,
    extraDrag: 0,
  });
  const ias = speed * Math.sqrt(air.density / SEA_LEVEL_DENSITY);
  const thrust = engineThrust(spec, air, mach, 1, afterburner, ias).thrust * spec.engineCount;
  return thrust - q * spec.wingArea * cd;
}

/** Highest speed where level flight is still possible, found by scanning down from Mach 3. */
export function maxLevelSpeed(
  spec: AircraftSpec,
  mass: number,
  altitude: number,
  weather: Weather,
) {
  for (let v = 1000; v > 50; v -= 1)
    if (levelExcessThrust(spec, mass, altitude, v, weather) >= 0) return v;
  return 0;
}

export function updatePilot(a: Aircraft, fx: DamageEffects, dt: number, events: EventSink) {
  const p = a.pilot;
  const n = a.onGround ? 1 : a.load;
  const tolerance = G_TOLERANCE - fx.gPenalty;
  if (n > tolerance) p.stress = Math.min(1.2, p.stress + 0.1 * ((n - tolerance) / 3.5) ** 2 * dt);
  else p.stress = Math.max(0, p.stress - (n < tolerance - 1 ? 0.12 : 0.05) * dt);
  if (n < -2) p.negativeStress = Math.min(1.2, p.negativeStress + 0.15 * (-n - 2) ** 2 * dt);
  else p.negativeStress = Math.max(0, p.negativeStress - 0.15 * dt);
  if (p.gloc > 0) {
    p.gloc -= dt;
    if (p.gloc <= 0)
      events.push({ type: 'message', msg: msg('msg.pilotConscious'), aircraftId: a.id });
  } else if (p.stress >= 1 || p.negativeStress >= 1) {
    p.gloc = 6;
    events.push({
      type: 'message',
      msg: msg(p.stress >= 1 ? 'msg.gloc' : 'msg.redout'),
      aircraftId: a.id,
      warning: true,
    });
  }
}

const say = (env: FlightEnv, a: Aircraft, m: Msg, warning = false) =>
  env.events.push({ type: 'message', msg: m, aircraftId: a.id, warning });

function enterStall(a: Aircraft, c: Controls, fx: DamageEffects, env: FlightEnv) {
  const spin =
    Math.abs(c.roll) > 0.5 ||
    Math.abs(a.bank) > 35 * DEG ||
    Math.abs(fx.rollAsymmetry) > 0.3 ||
    env.rng() < 0.2;
  a.regime = spin ? 'spin' : 'stall';
  a.spinDirection = Math.sign(c.roll || a.bank || fx.rollAsymmetry || 1);
  a.recovery = 0;
  say(env, a, msg(spin ? 'msg.spin' : 'msg.stall'), true);
}

function stepAir(
  a: Aircraft,
  c: Controls,
  fx: DamageEffects,
  air: Air,
  thrust: number,
  mass: number,
  env: FlightEnv,
  dt: number,
) {
  const s = a.spec;
  const weight = mass * G;
  const q = 0.5 * air.density * a.speed * a.speed;
  const qS = Math.max(1, q * s.wingArea);
  const mach = a.speed / air.speedOfSound;
  const clStall = liftCoefficient(s, s.alphaStall * DEG, a.flapPos, fx.lift);
  const clLimit = liftCoefficient(s, s.fcsAlphaLimit * DEG, a.flapPos, fx.lift);
  const nAero = (qS * clLimit) / weight;
  const nMax = Math.min(s.gLimit * fx.pitchAuthority, nAero);
  const nMin = -Math.min(s.gLimitNegative * fx.pitchAuthority, nAero * 0.6);
  const nStall = (qS * clStall) / weight;
  let n = 1;

  if (a.regime === 'spin') {
    a.rollVelocity = 0;
    const recovering = Math.sign(c.roll) === -a.spinDirection && c.pitch < -0.3;
    a.recovery = recovering ? a.recovery + dt : Math.max(0, a.recovery - dt * 0.5);
    a.heading = wrapAngle(a.heading + a.spinDirection * 1.7 * dt);
    a.bank = a.spinDirection * 55 * DEG;
    a.gamma = approach(a.gamma, -70 * DEG, dt * 0.8);
    a.speed = approach(a.speed, 75, 15 * dt);
    a.alpha = (s.alphaStall + 15) * DEG;
    a.load = 1.3;
    if (a.recovery >= 2.5 && fx.pitchAuthority > 0.5) {
      a.regime = 'stall';
      a.bank = 0;
      a.recovery = 0;
      say(env, a, msg('msg.spinStopped'));
    }
    a.pos = addScaled(a.pos, velocity(a), dt);
    return { drag: qS * 1.2, nMax };
  }

  if (a.regime === 'stall') {
    a.rollVelocity = 0;
    n = clamp(nStall * 0.7, -0.3, 1);
    a.bank = approach(a.bank, 0, dt * 0.6);
    a.alpha = (s.alphaStall + 6) * DEG;
    if (Math.abs(c.roll) > 0.5 && nStall < 0.6) {
      a.regime = 'spin';
      a.spinDirection = Math.sign(c.roll);
      say(env, a, msg('msg.spin'), true);
    } else if (nStall > 1.4 && Math.abs(a.pitchInput) < 0.3) {
      a.regime = 'normal';
      say(env, a, msg('msg.controlRestored'));
    }
  } else {
    const pMax = s.rollRate * DEG * fx.rollAuthority * clamp(q / 12000, 0.15, 1);
    const err = angleDiff(a.bank, c.roll * INSTRUCTOR_BANK);
    const captureGain = c.noseAim ? HANDLING.noseBankCaptureGain : HANDLING.bankCaptureGain;
    const rateDamping = c.noseAim ? HANDLING.noseBankRateDamping : HANDLING.bankRateDamping;
    const wantedRate =
      (c.manual
        ? clamp(c.roll, -1, 1) * pMax
        : clamp(err * captureGain - a.rollVelocity * rateDamping, -pMax, pMax)) +
      fx.rollAsymmetry * clamp(q / 20000, 0, 1.5);
    const rateStep = (wantedRate - a.rollVelocity) * (1 - Math.exp(-dt / HANDLING.rollTime));
    const acceleration = pMax / HANDLING.rollAccelerationTime;
    a.rollVelocity += clamp(rateStep, -acceleration * dt, acceleration * dt);
    a.bank = wrapAngle(a.bank + a.rollVelocity * dt);
    const cb = Math.cos(a.bank);
    // Hold the flight path, or with the assist ease it back to level (time constant 4 s).
    const easeToLevel =
      c.levelAssist && Math.abs(a.pitchInput) < 0.05 && Math.abs(a.gamma) < 60 * DEG
        ? (-a.gamma * Math.max(a.speed, 60)) / (G * 4)
        : 0;
    const hold =
      (Math.cos(a.gamma) + easeToLevel) / (Math.abs(cb) < 0.17 ? 0.17 * Math.sign(cb || 1) : cb);
    // Direct stick keeps pulling relative to the airframe through the top of a loop.
    // Altitude hold would command negative lift when inverted and undo the manoeuvre.
    const nHold = clamp(c.manual && !c.levelAssist ? 1 : hold, nMin, nMax);
    const u = a.pitchInput;
    n = clamp(u >= 0 ? nHold + u * (nMax - nHold) : nHold + u * (nHold - nMin), nMin, nMax);
    // Lift builds with the aircraft's response instead of jumping to a new load.
    const loadRate =
      Math.abs(n) > Math.abs(a.load) ? HANDLING.loadBuildRate : HANDLING.loadReleaseRate;
    n = clamp(approach(a.load, n, loadRate * dt), nMin, nMax);
    const cl = (n * weight) / qS;
    a.alpha = clamp(alphaForLift(s, cl, a.flapPos, fx.lift), -15 * DEG, s.fcsAlphaLimit * DEG);
    if (nStall < 0.45) enterStall(a, c, fx, env);
  }

  const cl = (n * weight) / qS;
  const yaw = a.regime === 'normal' ? a.yawInput : 0;
  const cd = dragCoefficient(s, mach, cl, {
    gearPos: a.gearPos,
    flapPos: a.flapPos,
    airbrakePos: a.airbrakePos,
    stores: a.missiles,
    // Sideslip from the rudder costs energy.
    extraDrag: fx.extraDrag + 0.03 * Math.abs(yaw),
  });
  const drag = q * s.wingArea * cd;
  const dv = (thrust * Math.cos(a.alpha) - drag) / mass - G * Math.sin(a.gamma);
  a.speed = Math.max(5, a.speed + dv * dt);
  const v = Math.max(a.speed, 20);
  const dGamma = clamp((G / v) * (n * Math.cos(a.bank) - Math.cos(a.gamma)), -2, 2);
  const dHeading = clamp(
    ((G / v) * n * Math.sin(a.bank)) / Math.max(0.1, Math.cos(a.gamma)),
    -2,
    2,
  );
  // Rudder: a few degrees per second of flat turn, weaker at low dynamic pressure.
  const rudder = yaw * 7 * DEG * fx.pitchAuthority * clamp(q / 15000, 0.2, 1);
  a.gamma += dGamma * dt;
  // A stalled wing cannot hold the nose up: weathervaning drops it towards the airflow.
  if (a.regime === 'stall') a.gamma -= dt * 0.9 * clamp(1.2 - nStall, 0.25, 1);
  a.heading = wrapAngle(a.heading + (dHeading + rudder) * dt);
  if (Math.abs(a.gamma) > Math.PI / 2) {
    // Passing the vertical: continue over the top with reversed course, now inverted.
    a.gamma = Math.sign(a.gamma) * Math.PI - a.gamma;
    a.heading = wrapAngle(a.heading + Math.PI);
    a.bank = wrapAngle(a.bank + Math.PI);
  }
  a.load = n;
  a.pos = addScaled(a.pos, velocity(a), dt);
  return { drag, nMax };
}

function stepGround(
  a: Aircraft,
  c: Controls,
  fx: DamageEffects,
  air: Air,
  thrust: number,
  mass: number,
  env: FlightEnv,
  dt: number,
) {
  const s = a.spec;
  const weight = mass * G;
  const q = 0.5 * air.density * a.speed * a.speed;
  const mach = a.speed / air.speedOfSound;
  a.gamma = 0;
  a.bank = 0;
  a.rollVelocity = 0;
  a.alpha = Math.max(0, a.pitchInput) * 12 * DEG * clamp(a.speed / 40, 0, 1);
  const cl = liftCoefficient(s, a.alpha, a.flapPos, fx.lift);
  const lift = q * s.wingArea * cl;
  const drag =
    q *
    s.wingArea *
    dragCoefficient(s, mach, cl, {
      gearPos: a.gearPos,
      flapPos: a.flapPos,
      airbrakePos: a.airbrakePos,
      stores: a.missiles,
      extraDrag: fx.extraDrag,
    });
  const gearOk = a.gearPos > 0.95 && fx.gearWorks;
  const mu = !gearOk ? 0.45 : c.wheelBrake ? 0.32 : 0.025;
  const friction = mu * Math.max(0, weight - lift);
  const push = thrust - drag;
  if (a.speed < 0.05 && push <= friction) a.speed = 0;
  else a.speed = Math.max(0, a.speed + ((push - friction) / mass) * dt);
  const steerRate =
    a.speed < 40 ? Math.min(0.5, 6 / Math.max(a.speed, 1)) * Math.min(1, a.speed / 2) : 0.06;
  // Nosewheel steering follows the rudder pedals.
  a.heading = wrapAngle(a.heading + (c.yaw || c.roll) * steerRate * dt);
  a.pos.x += Math.cos(a.heading) * a.speed * dt;
  a.pos.y += Math.sin(a.heading) * a.speed * dt;
  const surface = surfaceAt(a.pos.x, a.pos.y);
  a.pos.z = surface.height;
  a.load = 1;
  if (surface.kind === 'water') return loseAircraft(a, msg('cause.rollOffSea'), true, env.events);
  if (surface.kind !== 'runway' && surface.kind !== 'apron' && a.speed > 15)
    return loseAircraft(a, msg('cause.rollOffRunway'), true, env.events);
  if (lift > weight * 1.02 && a.pitchInput > 0.2) {
    a.onGround = false;
    a.gamma = 3 * DEG;
    a.pos.z += 0.5;
    say(env, a, msg('msg.liftoff'));
  }
}

function touchdown(a: Aircraft, surface: Surface, obstacle: number, env: FlightEnv) {
  const sink = -a.speed * Math.sin(a.gamma);
  const paved = surface.kind === 'runway' || surface.kind === 'apron';
  const gear = a.modules.find((m) => m.spec.kind === 'gear');
  const gearOk = a.gearPos > 0.95 && (!gear || integrity(gear) > 0.4);
  const aligned =
    !surface.airfield ||
    Math.abs(Math.sin(a.heading - surface.airfield.heading)) < Math.sin(15 * DEG);
  if (
    paved &&
    gearOk &&
    aligned &&
    obstacle <= surface.height + 0.01 &&
    sink < 6 &&
    Math.abs(a.bank) < 15 * DEG &&
    a.regime === 'normal'
  ) {
    a.onGround = true;
    a.pos.z = surface.height;
    a.gamma = 0;
    a.bank = 0;
    a.alpha = 0;
    if (sink > 3.5 && gear) {
      applyDamage(a, gear, gear.spec.hp * 0.6, env.events, env.rng, false);
      say(env, a, msg('msg.hardLanding', { v: sink.toFixed(1) }), true);
    } else say(env, a, msg('msg.touchdown', { v: sink.toFixed(1) }));
    return;
  }
  const cause =
    surface.kind === 'water'
      ? msg('cause.crashSea')
      : obstacle > surface.height + 0.01
        ? msg('cause.crashBuilding')
        : paved && !gearOk
          ? msg('cause.gearUpLanding')
          : paved && sink >= 6
            ? msg('cause.runwayImpact', { v: sink.toFixed(1) })
            : msg('cause.crashGround');
  loseAircraft(a, cause, true, env.events);
}

function stepWreck(a: Aircraft, env: FlightEnv, dt: number) {
  // Keep momentum at the moment of destruction; tumbling no longer steers the wreck.
  const v = velocity(a);
  const air = atmosphere(a.pos.z, env.weather);
  const terminalSpeed = 150;
  const dragRate = (G * (air.density / SEA_LEVEL_DENSITY) * a.speed) / terminalSpeed ** 2;
  const damping = Math.exp(-dragRate * dt);
  v.x *= damping;
  v.y *= damping;
  v.z = v.z * damping - G * dt;
  a.pos.x += v.x * dt;
  a.pos.y += v.y * dt;
  a.pos.z += v.z * dt;
  a.speed = Math.hypot(v.x, v.y, v.z);
  a.gamma = Math.atan2(v.z, Math.hypot(v.x, v.y));
  a.bank = wrapAngle(a.bank + a.spinDirection * 2 * dt);
  a.alpha = 0;
  a.load = 0;
  a.throttle = 0;
  a.afterburner = false;
  updateFires(a, dt, env.events, env.rng);
  const ground = obstacleHeight(a.pos.x, a.pos.y);
  if (a.pos.z <= ground) {
    a.falling = false;
    a.pos.z = ground;
    a.speed = 0;
    env.events.push({ type: 'explosion', pos: { ...a.pos }, size: 26 });
  }
  a.telemetry.agl = Math.max(0, a.pos.z - ground);
  a.telemetry.verticalSpeed = a.falling ? v.z : 0;
  a.telemetry.ias = a.speed * Math.sqrt(air.density / SEA_LEVEL_DENSITY);
  a.telemetry.mach = a.speed / air.speedOfSound;
  a.telemetry.thrust = 0;
  a.telemetry.fuelFlow = 0;
}

/** Advances one aircraft by dt seconds. */
export function stepAircraft(a: Aircraft, input: Controls, env: FlightEnv, dt: number) {
  a.prevPos = { ...a.pos };
  if (!a.alive) {
    if (a.falling) stepWreck(a, env, dt);
    return;
  }
  const s = a.spec;
  const fx = damageEffects(a);
  const conscious = a.pilot.gloc <= 0;
  const c: Controls = conscious
    ? input
    : { ...input, manual: true, levelAssist: false, roll: 0, pitch: 0, yaw: 0 };

  if (fx.gearWorks) a.gearPos = approach(a.gearPos, a.gearDown ? 1 : 0, dt / 4);
  a.flapPos = approach(a.flapPos, a.flapsBroken || !s.hasFlaps ? 0 : a.flaps / 2, dt * 0.4);
  a.airbrakePos = approach(a.airbrakePos, c.airbrake ? 1 : 0, dt / 1.2);
  a.wheelBrake = c.wheelBrake;
  a.throttle = approach(a.throttle, clamp(c.throttle, 0, 1), dt * 0.7);
  const pitchStep =
    (clamp(c.pitch, -1, 1) - a.pitchInput) * (1 - Math.exp(-dt / HANDLING.pitchTime));
  a.pitchInput += clamp(pitchStep, -HANDLING.pitchSlew * dt, HANDLING.pitchSlew * dt);
  a.yawInput += (clamp(c.yaw, -1, 1) - a.yawInput) * (1 - Math.exp(-dt / HANDLING.yawTime));

  const air = atmosphere(a.pos.z, env.weather);
  const mach = a.speed / air.speedOfSound;
  const iasNow = a.speed * Math.sqrt(air.density / SEA_LEVEL_DENSITY);
  const mass = aircraftMass(a);
  const hasFuel = a.fuel > 0;
  a.afterburner = c.afterburner && hasFuel && a.throttle > 0.97 && fx.thrust.some((t) => t > 0);
  let thrust = 0,
    fuelFlow = 0;
  if (hasFuel)
    for (const factor of fx.thrust) {
      if (factor <= 0) continue;
      const e = engineThrust(s, air, mach, a.throttle, a.afterburner, iasNow);
      thrust += e.thrust * factor;
      fuelFlow += e.fuelFlow * factor;
    }

  let drag = 0,
    nMax = s.gLimit;
  if (a.onGround) stepGround(a, c, fx, air, thrust, mass, env, dt);
  else {
    const r = stepAir(a, c, fx, air, thrust, mass, env, dt);
    drag = r.drag;
    nMax = r.nMax;
    const obstacle = obstacleHeight(a.pos.x, a.pos.y);
    if (a.pos.z <= obstacle) touchdown(a, surfaceAt(a.pos.x, a.pos.y), obstacle, env);
  }
  if (!a.alive) return;

  const hadFuel = a.fuel > 0;
  a.fuel = Math.max(0, a.fuel - (fuelFlow + fx.leak) * dt);
  if (hadFuel && a.fuel <= 0) say(env, a, msg('msg.fuelOut'), true);

  const ias = a.speed * Math.sqrt(air.density / SEA_LEVEL_DENSITY);
  const gear = a.modules.find((m) => m.spec.kind === 'gear');
  // Take-off flaps tolerate a quarter more speed than landing flaps.
  const flapLimit = s.flapSpeedLimit * (a.flaps === 1 ? 1.25 : 1);
  const overspeed =
    !a.onGround &&
    ((a.gearPos > 0.3 && ias > s.gearSpeedLimit) || (a.flapPos > 0.1 && ias > flapLimit));
  if (!a.onGround && a.gearPos > 0.3 && ias > s.gearSpeedLimit && gear)
    applyDamage(a, gear, 60 * dt * (ias / s.gearSpeedLimit), env.events, env.rng, false);
  if (!a.onGround && a.flapPos > 0.1 && ias > flapLimit && !a.flapsBroken) {
    a.flapsBroken = true;
    a.flaps = 0;
    say(env, a, msg('msg.flapsTorn'), true);
  }
  const airframe = a.modules.find((m) => m.spec.kind === 'airframe');
  const flutter = !a.onGround && ias > s.maxIas * 1.08;
  if (flutter && airframe)
    applyDamage(a, airframe, (ias / s.maxIas - 1.08) * 900 * dt, env.events, env.rng, false);
  const wings = a.modules.filter((m) => m.spec.kind === 'wing');
  const ultimate = s.gLimit * 1.5 * (0.35 + 0.65 * Math.min(...wings.map(integrity)));
  const overG = Math.abs(a.load) > ultimate;
  if (overG)
    for (const w of wings)
      applyDamage(a, w, (Math.abs(a.load) - ultimate) * 60 * dt, env.events, env.rng, false);

  updateFires(a, dt, env.events, env.rng);
  updatePilot(a, fx, dt, env.events);

  const t = a.telemetry;
  t.mach = mach;
  t.ias = ias;
  t.thrust = thrust;
  t.drag = drag;
  t.fuelFlow = fuelFlow + fx.leak;
  t.agl = a.pos.z - obstacleHeight(a.pos.x, a.pos.y);
  t.verticalSpeed = a.onGround ? 0 : a.speed * Math.sin(a.gamma);
  t.maxLoad = nMax;
  t.stallSpeed = Math.sqrt(
    (2 * mass * G) /
      (air.density * s.wingArea * liftCoefficient(s, s.fcsAlphaLimit * DEG, a.flapPos, fx.lift)),
  );
  t.overG = overG;
  t.overspeed = overspeed || flutter;
}

import { bodyAxes, type Aircraft } from '../entities/aircraft';
import { HANDLING } from '../data/handling';
import { angleDiff, clamp, DEG, G } from '../world/math';

/** Bank angle for the instructor's full roll command; direct keyboard stick uses roll rate. */
const MAX_BANK = HANDLING.instructorBankDegrees * DEG;

/**
 * Mouse-aim "instructor": turns a wanted heading and flight path angle into stick inputs,
 * the way a pilot would. It banks so the lift vector points at the wanted direction, then
 * pulls in proportion to the remaining error. It only commands roll and pitch, so the
 * aircraft keeps its real limits (G, stall, FCS); it also eases off before the pilot
 * blacks out.
 */
export function instructor(
  a: Aircraft,
  heading: number,
  gamma: number,
  aim: 'flightPath' | 'nose' = 'flightPath',
) {
  // Request a heading/climb rate, then turn it into a coordinated bank and load.
  // This stays continuous around the aim point: no switch from 80° bank to wings level.
  const forward = aim === 'nose' ? bodyAxes(a).forward : undefined;
  const currentHeading = forward ? Math.atan2(forward.y, forward.x) : a.heading;
  const currentGamma = forward ? Math.atan2(forward.z, Math.hypot(forward.x, forward.y)) : a.gamma;
  // Flight-path hold and weapon/mouse pointing have different references: with AoA,
  // the nose points above (and, in a bank, beside) the direction of travel.
  const lateral = angleDiff(currentHeading, heading) * Math.cos(currentGamma);
  const vertical = gamma - currentGamma;
  // Far from the nose, ask for an energetic manoeuvre; ease back continuously
  // as the aircraft catches the cursor, without changing the airframe's inertia.
  const deflection = clamp(
    Math.hypot(lateral, vertical) /
      ((aim === 'nose'
        ? HANDLING.noseAimFullDeflectionDegrees
        : HANDLING.aimFullDeflectionDegrees) *
        DEG),
    0,
    1,
  );
  const urgency = deflection * deflection * (3 - 2 * deflection);
  const timeScale = aim === 'nose' ? HANDLING.noseAimTimeScale : 1;
  const turnTime =
    (HANDLING.aimTurnTime + (HANDLING.aimHardTurnTime - HANDLING.aimTurnTime) * urgency) *
    timeScale;
  const pitchTime =
    (HANDLING.aimPitchTime + (HANDLING.aimHardPitchTime - HANDLING.aimPitchTime) * urgency) *
    timeScale;
  const speed = Math.max(60, a.speed);
  const available = Math.max(0.5, Math.min(a.spec.gLimit, a.telemetry.maxLoad));
  const wantedLoad =
    HANDLING.aimGentleLoad + (HANDLING.aimHardLoad - HANDLING.aimGentleLoad) * urgency;
  const comfort = Math.min(
    available,
    wantedLoad - clamp(a.pilot.stress, 0, 1) * (wantedLoad - 2.7),
  );
  const weightUp = Math.cos(a.gamma);
  const sideLoad = (speed * lateral) / (G * turnTime);
  const bankLimit = Math.min(MAX_BANK, Math.acos(clamp(weightUp / Math.max(1, comfort), 0, 1)));
  const bank = clamp(Math.atan2(sideLoad, Math.max(0.5, weightUp)), -bankLimit, bankLimit);
  const cb = Math.cos(a.bank);
  const liftUp = Math.abs(cb) < 0.17 ? 0.17 * Math.sign(cb || 1) : cb;
  const minLoad = -a.spec.gLimitNegative;
  const hold = clamp(weightUp / liftUp, minLoad, available);
  const climbRate = (G * (a.load * cb - weightUp)) / speed;
  const noseBankRate = aim === 'nose' ? -a.alpha * Math.sin(a.bank) * a.rollVelocity : 0;
  const climbError = vertical - (climbRate + noseBankRate) * 0.6;
  const demand = clamp((weightUp + (speed * climbError) / (G * pitchTime)) / liftUp, -1.2, comfort);
  const delta = demand - hold;
  return {
    roll: bank / MAX_BANK,
    pitch: clamp(delta / Math.max(0.25, delta >= 0 ? available - hold : hold - minLoad), -0.5, 1),
  };
}

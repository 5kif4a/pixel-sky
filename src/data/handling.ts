/** Game handling response, shared by mouse instructor, direct stick and AI. */
export const HANDLING = {
  instructorBankDegrees: 85,
  aimFullDeflectionDegrees: 35,
  aimTurnTime: 3.2,
  aimHardTurnTime: 1,
  aimPitchTime: 2.8,
  aimHardPitchTime: 1,
  aimGentleLoad: 5.2,
  aimHardLoad: 8.2,
  noseAimTimeScale: 0.35,
  noseAimFullDeflectionDegrees: 20,
  noseBankCaptureGain: 5.5,
  noseBankRateDamping: 1.2,
  rollTime: 0.28,
  /** Seconds to build up to the aircraft's maximum roll rate. */
  rollAccelerationTime: 0.5,
  bankCaptureGain: 2.8,
  bankRateDamping: 0.65,
  pitchTime: 0.26,
  /** Full stick travel per second; reversing through neutral takes longer. */
  pitchSlew: 1.4,
  yawTime: 0.25,
  loadBuildRate: 4.5,
  loadReleaseRate: 6,
} as const;

/**
 * Weapon data. Figures are rounded open-source values; guidance, fusing and damage are game
 * abstractions and do not reproduce the real systems.
 */
export interface GunSpec {
  caliber: number;
  barrels: number;
  /** Combined rate of fire, rounds per minute. */
  rpm: number;
  muzzleVelocity: number;
  shellMass: number;
  /** Explosive filler of the HE shell, kg. */
  explosiveMass: number;
  /** Mass of a complete round including case and link, kg (for aircraft weight). */
  roundMass: number;
  /** Sea-level drag factor: deceleration = k · v² · ρ/ρ₀. */
  dragK: number;
  /** Standard deviation of dispersion, radians. */
  dispersion: number;
  /** Self-destruct time, s. */
  lifetime: number;
}
export interface MissileSpec {
  mass: number;
  warhead: number;
  burnTime: number;
  /** Motor acceleration, m/s². */
  thrustAccel: number;
  dragK: number;
  maxG: number;
  /** Seeker gimbal limit, radians. */
  gimbal: number;
  /** Rear-aspect lock range against a non-afterburning fighter, m. */
  lockRange: number;
  fuse: number;
  lifetime: number;
  minSpeed: number;
  navigation: number;
  /** Base chance that a flare salvo decoys the seeker. */
  flareSusceptibility: number;
}

const k = (mass: number, caliber: number, cd: number) =>
  (0.5 * 1.225 * cd * Math.PI * (caliber / 2000) ** 2) / mass;

export const GUNS = {
  'GSh-30-1': {
    caliber: 30,
    barrels: 1,
    rpm: 1650,
    muzzleVelocity: 860,
    shellMass: 0.39,
    explosiveMass: 0.0485,
    roundMass: 0.83,
    dragK: k(0.39, 30, 0.32),
    dispersion: 0.0022,
    lifetime: 3.5,
  },
  M61A1: {
    caliber: 20,
    barrels: 6,
    rpm: 6000,
    muzzleVelocity: 1030,
    shellMass: 0.1,
    explosiveMass: 0.011,
    roundMass: 0.26,
    dragK: k(0.1, 20, 0.3),
    dispersion: 0.003,
    lifetime: 3,
  },
  'DEFA 554': {
    caliber: 30,
    barrels: 2,
    rpm: 3600,
    muzzleVelocity: 815,
    shellMass: 0.275,
    explosiveMass: 0.035,
    roundMass: 0.5,
    dragK: k(0.275, 30, 0.32),
    dispersion: 0.0025,
    lifetime: 3.5,
  },
} satisfies Record<string, GunSpec>;

export const MISSILES = {
  'R-73': {
    mass: 105,
    warhead: 7.4,
    burnTime: 4.5,
    thrustAccel: 210,
    dragK: 1.7e-4,
    maxG: 40,
    gimbal: 60 * (Math.PI / 180),
    lockRange: 10_000,
    fuse: 8,
    lifetime: 25,
    minSpeed: 230,
    navigation: 4,
    flareSusceptibility: 0.4,
  },
  'AIM-9M': {
    mass: 86,
    warhead: 9.4,
    burnTime: 5,
    thrustAccel: 190,
    dragK: 1.6e-4,
    maxG: 35,
    gimbal: 40 * (Math.PI / 180),
    lockRange: 9_000,
    fuse: 9,
    lifetime: 25,
    minSpeed: 230,
    navigation: 4,
    flareSusceptibility: 0.35,
  },
  'Magic II': {
    mass: 89,
    warhead: 12.5,
    burnTime: 4,
    thrustAccel: 215,
    dragK: 1.8e-4,
    maxG: 45,
    gimbal: 50 * (Math.PI / 180),
    lockRange: 8_000,
    fuse: 8,
    lifetime: 22,
    minSpeed: 230,
    navigation: 4,
    flareSusceptibility: 0.42,
  },
} satisfies Record<string, MissileSpec>;

export type GunId = keyof typeof GUNS;
export type MissileId = keyof typeof MISSILES;

/** Damage points of a shell hit: kinetic energy plus explosive filler. */
export function shellDamage(gun: GunSpec, relativeSpeed: number) {
  return ((0.5 * gun.shellMass * relativeSpeed ** 2) / 1000) * 0.15 + gun.explosiveMass * 2000;
}
/** Expected fragment damage to an aircraft module at distance d (m) from its edge. */
export function fragmentDamage(explosiveKg: number, d: number) {
  return (explosiveKg * 63) / Math.pow(Math.max(1, d), 1.25);
}
/** Chance that fragments reach a module at distance d; otherwise only blast overpressure. */
export function fragmentChance(d: number) {
  return Math.min(1, Math.max(0.2, 6 / Math.max(1, d)));
}
/** Radius of the HE splash of a gun shell. */
export function shellSplashRadius(gun: GunSpec) {
  return 1.6 * Math.cbrt(gun.explosiveMass / 0.05);
}

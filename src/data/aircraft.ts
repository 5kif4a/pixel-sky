import type { GunId, MissileId } from './weapons';

export type AircraftId = 'MiG-35' | 'F-16' | 'Mirage 2000';

export type ModuleKind =
  'pilot' | 'engine' | 'fuel' | 'wing' | 'tail' | 'controls' | 'gun' | 'ammo' | 'gear' | 'airframe';

/** Damageable part. Position in body axes: forward, right, up (metres from the CG). */
export interface ModuleSpec {
  id: string;
  kind: ModuleKind;
  pos: readonly [number, number, number];
  radius: number;
  hp: number;
  /** −1 left, +1 right, 0 centre: wing asymmetry and engine index. */
  side: -1 | 0 | 1;
  /** Share of incoming damage that gets through (armoured seat, canopy), 1 = none. */
  armor: number;
}

/** Top-view outline in body axes [forward, right, ...] and fin profiles [forward, up, ...]. */
export interface Silhouette {
  fuselage: number[];
  wing: number[];
  tailplane?: number[];
  fins: { right: number; profile: number[] }[];
  canopy: number[];
  nozzles: number[];
}

export interface AircraftSpec {
  id: AircraftId;
  length: number;
  span: number;
  wingArea: number;
  emptyMass: number;
  internalFuel: number;
  engineCount: number;
  /** Engine and radar designations, shown in the hangar (radars are simulated from stage 4). */
  engineType: string;
  radar: string;
  /** Sea-level static thrust per engine, N. */
  dryThrust: number;
  afterburnerThrust: number;
  /** Thrust-specific fuel consumption, kg/(N·s). */
  tsfcDry: number;
  tsfcAfterburner: number;
  /** Zero-lift drag coefficient against Mach number (tuned to the reference speeds). */
  dragTable: readonly (readonly [number, number])[];
  oswald: number;
  clMax: number;
  alphaStall: number;
  /** Angle of attack the fly-by-wire limiter holds, degrees. */
  fcsAlphaLimit: number;
  hasFlaps: boolean;
  /** Extra lift coefficient with landing flaps. */
  flapLift: number;
  flapDrag: number;
  gearDrag: number;
  airbrakeDrag: number;
  storeDrag: number;
  gLimit: number;
  gLimitNegative: number;
  /** Maximum roll rate, deg/s. */
  rollRate: number;
  /** Indicated airspeed limits, m/s. The engine limiter holds maxIas, above it flutter. */
  maxIas: number;
  gearSpeedLimit: number;
  flapSpeedLimit: number;
  gun: GunId;
  gunRounds: number;
  /** Muzzle outlets in body axes (forward, right, up), metres from the CG. */
  gunMuzzles: readonly (readonly [number, number, number])[];
  missile: MissileId;
  missileCount: number;
  flares: number;
  /**
   * Decoy strength of one flare relative to a standard 1×1×8" cartridge: large-calibre
   * flares burn longer and brighter and pull seekers away more often.
   */
  flarePower: number;
  modules: ModuleSpec[];
  silhouette: Silhouette;
  /** Open-source reference figures the model is tuned against. */
  reference: {
    seaLevelSpeed: number;
    altitudeSpeed: number;
    altitude: number;
    sources: string[];
  };
}

const m = (
  id: string,
  kind: ModuleKind,
  pos: [number, number, number],
  radius: number,
  hp: number,
  side: -1 | 0 | 1 = 0,
): ModuleSpec => ({ id, kind, pos, radius, hp, side, armor: kind === 'pilot' ? 0.6 : 1 });

/** Builds a closed outline from the left half (nose → tail) by mirroring it. */
const mirror = (left: number[]) => {
  const out = [...left];
  for (let i = left.length - 2; i >= 0; i -= 2)
    if (left[i + 1] !== 0) out.push(left[i], -left[i + 1]);
  return out;
};

function twinEngineModules(
  engineU: number,
  engineV: number,
  wingU: number,
  wingV: number,
): ModuleSpec[] {
  return [
    m('engine-l', 'engine', [engineU, -engineV, 0], 0.9, 140, -1),
    m('engine-r', 'engine', [engineU, engineV, 0], 0.9, 140, 1),
    m('wing-l', 'wing', [wingU, -wingV, 0], 1.7, 260, -1),
    m('wing-r', 'wing', [wingU, wingV, 0], 1.7, 260, 1),
    m('fuel-l', 'fuel', [wingU + 0.4, -wingV + 1.2, 0], 0.9, 120, -1),
    m('fuel-r', 'fuel', [wingU + 0.4, wingV - 1.2, 0], 0.9, 120, 1),
  ];
}

export const AIRCRAFT: Record<AircraftId, AircraftSpec> = {
  'MiG-35': {
    id: 'MiG-35',
    length: 17.3,
    span: 12,
    wingArea: 42,
    emptyMass: 11_000,
    internalFuel: 4_500,
    engineCount: 2,
    engineType: 'RD-33MK',
    radar: 'Zhuk-AE (AESA)',
    dryThrust: 53_000,
    afterburnerThrust: 88_300,
    tsfcDry: 2.15e-5,
    tsfcAfterburner: 5.4e-5,
    dragTable: [
      [0, 0.021],
      [0.8, 0.021],
      [1.0, 0.048],
      [1.2, 0.056],
      [1.6, 0.049],
      [2.4, 0.0441],
    ],
    oswald: 0.8,
    clMax: 1.75,
    alphaStall: 30,
    fcsAlphaLimit: 26,
    hasFlaps: true,
    flapLift: 0.35,
    flapDrag: 0.03,
    gearDrag: 0.022,
    airbrakeDrag: 0.05,
    storeDrag: 0.0015,
    gLimit: 9,
    gLimitNegative: 3,
    rollRate: 220,
    maxIas: 403,
    gearSpeedLimit: 140,
    flapSpeedLimit: 120,
    gun: 'GSh-30-1',
    gunRounds: 100,
    gunMuzzles: [[1.1, -1.45, 0.08]],
    missile: 'R-73',
    missileCount: 4,
    // Large-calibre (50 mm) cartridges: fewer, but each one decoys better.
    flares: 60,
    flarePower: 1.45,
    modules: [
      m('pilot', 'pilot', [4.4, 0, 0.8], 0.55, 60),
      m('controls', 'controls', [1.5, 0, 0.2], 0.6, 90),
      m('fuel-c', 'fuel', [0, 0, 0.4], 1.2, 140),
      m('gun', 'gun', [0.75, -1.45, 0], 0.4, 80),
      m('ammo', 'ammo', [1.2, -0.9, -0.1], 0.4, 50),
      m('gear', 'gear', [0.4, 0, -0.9], 0.8, 80),
      m('tail', 'tail', [-4.6, 0, 1.2], 1.5, 180),
      m('airframe', 'airframe', [-1, 0, 0], 2.2, 420),
      ...twinEngineModules(-4.0, 0.85, -2.0, 4.0),
    ],
    silhouette: {
      fuselage: mirror([
        9, 0, 8, -0.39, 6.7, -0.51, 5.95, -0.6, 4.4, -0.96, 2.6, -1.3, 0.74, -1.67, -4.1, -1.7,
        -5.9, -1.35,
      ]),
      wing: [0.74, -1.67, -2.8, -6, -3.95, -6, -3.3, -1.67],
      tailplane: [-4.08, -1.86, -6.24, -3.75, -7.3, -3.7, -6.15, -1.86],
      fins: [
        { right: -1.64, profile: [-2.92, 0.2, -5.29, 2.83, -5.85, 2.83, -5.56, 0.2] },
        { right: 1.64, profile: [-2.92, 0.2, -5.29, 2.83, -5.85, 2.83, -5.56, 0.2] },
      ],
      canopy: mirror([6, 0, 5, -0.46, 3.1, -0.46]),
      nozzles: [-5.87, -0.85, -5.87, 0.85],
    },
    reference: {
      seaLevelSpeed: 1450,
      altitudeSpeed: 2400,
      altitude: 11_000,
      sources: [
        'https://en.wikipedia.org/wiki/Mikoyan_MiG-35',
        'https://www.globalsecurity.org/military/world/russia/mig-35-specs.htm',
        'https://www.airforce-technology.com/projects/mig35/',
      ],
    },
  },
  'F-16': {
    id: 'F-16',
    length: 15.06,
    span: 9.96,
    wingArea: 27.87,
    // Late F-16C: AN/APG-83 SABR AESA radar, F110-GE-132 (the most powerful F-16 engine).
    emptyMass: 9_100,
    internalFuel: 3_175,
    engineCount: 1,
    engineType: 'F110-GE-132',
    radar: 'AN/APG-83 SABR (AESA)',
    dryThrust: 84_500,
    afterburnerThrust: 144_600,
    tsfcDry: 2.1e-5,
    tsfcAfterburner: 5.3e-5,
    dragTable: [
      [0, 0.02],
      [0.8, 0.02],
      [1.0, 0.044],
      [1.2, 0.052],
      [1.6, 0.0635],
      [2.4, 0.0648],
    ],
    oswald: 0.82,
    clMax: 1.85,
    alphaStall: 32,
    fcsAlphaLimit: 25,
    hasFlaps: true,
    flapLift: 0.25,
    flapDrag: 0.025,
    gearDrag: 0.02,
    airbrakeDrag: 0.06,
    storeDrag: 0.0015,
    gLimit: 9,
    gLimitNegative: 3,
    rollRate: 280,
    maxIas: 408,
    gearSpeedLimit: 150,
    flapSpeedLimit: 125,
    gun: 'M61A1',
    gunRounds: 512,
    gunMuzzles: [[1.2, -1.2, 0.08]],
    missile: 'AIM-9M',
    missileCount: 4,
    flares: 120,
    flarePower: 1,
    modules: [
      m('pilot', 'pilot', [4.0, 0, 0.8], 0.55, 60),
      m('controls', 'controls', [1, 0, 0.1], 0.6, 90),
      m('fuel-c', 'fuel', [-0.5, 0, 0.3], 1.1, 140),
      m('gun', 'gun', [0.85, -1.2, 0], 0.4, 80),
      m('ammo', 'ammo', [0.8, 0, 0.1], 0.5, 50),
      m('gear', 'gear', [0.3, 0, -0.8], 0.7, 80),
      m('tail', 'tail', [-5.2, 0, 2.0], 1.4, 180),
      m('airframe', 'airframe', [-0.5, 0, 0], 2, 380),
      m('engine', 'engine', [-3.8, 0, 0], 1, 160),
      m('wing-l', 'wing', [-1.3, -3.1, 0], 1.5, 240, -1),
      m('wing-r', 'wing', [-1.3, 3.1, 0], 1.5, 240, 1),
      m('fuel-l', 'fuel', [-0.7, -2.0, 0], 0.8, 110, -1),
      m('fuel-r', 'fuel', [-0.7, 2.0, 0], 0.8, 110, 1),
    ],
    silhouette: {
      fuselage: mirror([
        7.8, 0, 7.2, -0.2, 6.08, -0.45, 5.44, -0.6, 4.4, -0.72, 2.56, -1.12, 0.84, -1.4, -2.54,
        -1.38, -4.16, -1.12, -5.0, -1.15, -6.8, -1.15, -6.8, -0.45,
      ]),
      wing: [0.84, -1.4, -1.6, -4.7, -2.54, -4.7, -2.54, -1.4],
      tailplane: [-4.16, -1.11, -5.71, -2.89, -6.4, -2.89, -6.72, -1.15],
      fins: [{ right: 0, profile: [-3.42, 0.86, -6.04, 3.39, -7.09, 3.39, -6.1, 0.86] }],
      canopy: mirror([5.44, 0, 4.4, -0.41, 1.91, -0.3]),
      nozzles: [-6.72, 0],
    },
    reference: {
      seaLevelSpeed: 1470,
      altitudeSpeed: 2177,
      altitude: 12_000,
      sources: [
        'https://www.af.mil/About-Us/Fact-Sheets/Display/Article/104505/f-16-fighting-falcon/',
        'https://www.globalsecurity.org/military/systems/aircraft/f-16-specs.htm',
      ],
    },
  },
  'Mirage 2000': {
    id: 'Mirage 2000',
    length: 14.36,
    span: 9.13,
    wingArea: 41,
    emptyMass: 7_500,
    internalFuel: 3_040,
    engineCount: 1,
    engineType: 'M53-P2',
    radar: 'RDY',
    dryThrust: 64_300,
    afterburnerThrust: 95_100,
    tsfcDry: 2.2e-5,
    tsfcAfterburner: 5.8e-5,
    dragTable: [
      [0, 0.021],
      [0.75, 0.021],
      [0.95, 0.054],
      [1.15, 0.056],
      [1.4, 0.0468],
      [1.6, 0.0351],
      [2.4, 0.0257],
    ],
    oswald: 0.72,
    clMax: 1.6,
    alphaStall: 34,
    fcsAlphaLimit: 29,
    hasFlaps: false,
    flapLift: 0,
    flapDrag: 0,
    gearDrag: 0.022,
    airbrakeDrag: 0.035,
    storeDrag: 0.0015,
    gLimit: 9,
    gLimitNegative: 3.2,
    rollRate: 270,
    maxIas: 360,
    gearSpeedLimit: 140,
    flapSpeedLimit: 999,
    gun: 'DEFA 554',
    gunRounds: 250,
    gunMuzzles: [
      [2.0, -0.95, -0.65],
      [2.0, 0.95, -0.65],
    ],
    missile: 'Magic II',
    missileCount: 4,
    flares: 80,
    flarePower: 1,
    modules: [
      m('pilot', 'pilot', [3.9, 0, 0.3], 0.55, 60),
      m('controls', 'controls', [1, 0, 0], 0.6, 90),
      m('fuel-c', 'fuel', [0, 0, 0.1], 1.1, 130),
      m('gun', 'gun', [1.6, 0, -0.75], 0.5, 90),
      m('ammo', 'ammo', [0.6, 0, -0.6], 0.5, 50),
      m('gear', 'gear', [-0.5, 0, -0.8], 0.7, 80),
      m('tail', 'tail', [-4.6, 0, 1.6], 1.3, 160),
      m('airframe', 'airframe', [-1, 0, 0], 2, 360),
      m('engine', 'engine', [-4.2, 0, 0], 1, 150),
      m('wing-l', 'wing', [-2.8, -2.6, -0.55], 1.8, 260, -1),
      m('wing-r', 'wing', [-2.8, 2.6, -0.55], 1.8, 260, 1),
      m('fuel-l', 'fuel', [-1.6, -1.8, -0.5], 0.9, 110, -1),
      m('fuel-r', 'fuel', [-1.6, 1.8, -0.5], 0.9, 110, 1),
    ],
    silhouette: {
      fuselage: mirror([
        7.6, 0, 6.6, -0.24, 5.6, -0.5, 4.03, -0.58, 3.32, -1.02, 2.6, -1.15, 1.0, -1.1, -1.5, -1.0,
        -4.6, -0.88, -5.85, -0.63, -6.68, -0.52,
      ]),
      wing: [2.69, -1.0, -3.55, -4.56, -4.47, -4.56, -4.56, -1.0],
      fins: [{ right: 0, profile: [-1.68, 0.55, -5.6, 2.94, -6.3, 2.94, -5.25, 0.55] }],
      canopy: mirror([5.08, 0, 4.03, -0.43, 2.6, -0.45]),
      nozzles: [-6.68, 0],
    },
    reference: {
      seaLevelSpeed: 1110,
      altitudeSpeed: 2336,
      altitude: 11_000,
      sources: [
        'https://en.wikipedia.org/wiki/Dassault_Mirage_2000',
        'https://man.fas.org/dod-101/sys/ac/row/mirage-2000.htm',
      ],
    },
  },
};

import { DEG } from '../../world/math';
import { MeshBuilder, type Mat, type Mesh, type Section, type SectionPoint } from '../meshBuilder';
import { between, cannonPorts, missile, pylon, type Chord } from './parts';

/**
 * F-16C low-poly model, measured off the Block 52 three-view in src/assets (f16c50-1.gif;
 * model-preview.html shows the overlay): 15.06 m pitot to nozzle, 9.96 m span over the
 * wingtip missiles. Body axes: x forward (radome tip at x = 7.8), y right, z up; the wing
 * plane is z = 0. The planform matches `silhouette` in data/aircraft.ts.
 */

const ANGLES = [0, 22, 48, 72, 90, 100, 115, 132, 150, 165, 175, 180];
/** Elliptic section: 12 points from the top (0°) to the bottom (180°). */
const ellipse = (zc: number, hw: number, hh: number): SectionPoint[] =>
  ANGLES.map((a) => [Math.sin(a * DEG) * hw, zc + Math.cos(a * DEG) * hh]);

/*
 * Section points, right half: 0 top centre (canopy, spine), 1 shoulder, 2 canopy sill,
 * 3 upper body, 4 chine (wing-body blend and wing root edge), 5 under the chine, 6 lower
 * side, 7–10 chin intake and belly, 11 bottom centre.
 */
const SECTIONS: Section[] = [
  // Slim radome, slightly drooped.
  { x: 7.8, half: [[0, -0.21]] },
  { x: 7.2, half: ellipse(-0.14, 0.2, 0.19) },
  { x: 6.6, half: ellipse(-0.06, 0.34, 0.31) },
  { x: 6.08, half: ellipse(0, 0.45, 0.37) },
  {
    // Windscreen base.
    x: 5.44,
    half: [
      [0, 0.54],
      [0.25, 0.52],
      [0.44, 0.3],
      [0.52, 0.14],
      [0.6, 0],
      [0.55, -0.1],
      [0.5, -0.24],
      [0.44, -0.33],
      [0.35, -0.4],
      [0.22, -0.44],
      [0.08, -0.45],
      [0, -0.45],
    ],
  },
  {
    // Windscreen rising into the bubble.
    x: 4.9,
    half: [
      [0, 0.95],
      [0.28, 0.86],
      [0.43, 0.48],
      [0.54, 0.25],
      [0.66, 0],
      [0.6, -0.09],
      [0.53, -0.27],
      [0.46, -0.38],
      [0.37, -0.46],
      [0.23, -0.5],
      [0.09, -0.51],
      [0, -0.51],
    ],
  },
  {
    // Tall frameless bubble canopy; the wing-body blend starts to spread.
    x: 4.4,
    half: [
      [0, 1.12],
      [0.3, 1.0],
      [0.42, 0.6],
      [0.55, 0.35],
      [0.72, 0],
      [0.66, -0.08],
      [0.56, -0.3],
      [0.48, -0.42],
      [0.38, -0.5],
      [0.24, -0.55],
      [0.1, -0.57],
      [0, -0.57],
    ],
  },
  {
    // Top of the bubble, above the pilot's head.
    x: 3.95,
    half: [
      [0, 1.22],
      [0.31, 1.07],
      [0.43, 0.6],
      [0.56, 0.36],
      [0.8, 0],
      [0.73, -0.08],
      [0.57, -0.3],
      [0.48, -0.43],
      [0.38, -0.52],
      [0.24, -0.57],
      [0.1, -0.59],
      [0, -0.6],
    ],
  },
  {
    // Just ahead of the chin intake: its lower part is still the nose underside.
    x: 3.7,
    half: [
      [0, 1.2],
      [0.31, 1.06],
      [0.43, 0.6],
      [0.56, 0.36],
      [0.86, 0],
      [0.78, -0.08],
      [0.57, -0.3],
      [0.48, -0.43],
      [0.38, -0.52],
      [0.24, -0.57],
      [0.1, -0.59],
      [0, -0.6],
    ],
  },
  {
    // Chin intake lip: a wide "smile" under the cockpit.
    x: 3.62,
    half: [
      [0, 1.2],
      [0.31, 1.06],
      [0.43, 0.6],
      [0.56, 0.36],
      [0.88, 0],
      [0.79, -0.08],
      [0.57, -0.3],
      [0.48, -0.36],
      [0.48, -0.84],
      [0.3, -0.92],
      [0.1, -0.95],
      [0, -0.95],
    ],
  },
  {
    x: 3.0,
    half: [
      [0, 1.17],
      [0.31, 1.03],
      [0.44, 0.61],
      [0.58, 0.36],
      [1.0, 0],
      [0.9, -0.08],
      [0.59, -0.29],
      [0.49, -0.38],
      [0.49, -0.85],
      [0.31, -0.925],
      [0.1, -0.95],
      [0, -0.95],
    ],
  },
  {
    // The bubble tapers down into the dorsal spine.
    x: 2.56,
    half: [
      [0, 1.08],
      [0.32, 0.98],
      [0.45, 0.62],
      [0.6, 0.36],
      [1.12, 0],
      [1.0, -0.08],
      [0.6, -0.28],
      [0.5, -0.4],
      [0.5, -0.86],
      [0.32, -0.93],
      [0.1, -0.95],
      [0, -0.95],
    ],
  },
  {
    // Canopy aft end.
    x: 1.9,
    half: [
      [0, 0.86],
      [0.31, 0.83],
      [0.47, 0.62],
      [0.64, 0.38],
      [1.22, 0],
      [1.1, -0.08],
      [0.63, -0.29],
      [0.53, -0.42],
      [0.52, -0.87],
      [0.34, -0.935],
      [0.11, -0.95],
      [0, -0.95],
    ],
  },
  {
    // Wing root leading edge.
    x: 0.84,
    half: [
      [0, 0.82],
      [0.3, 0.79],
      [0.5, 0.6],
      [0.7, 0.4],
      [1.4, 0],
      [1.25, -0.08],
      [0.68, -0.3],
      [0.58, -0.45],
      [0.56, -0.88],
      [0.36, -0.94],
      [0.12, -0.95],
      [0, -0.95],
    ],
  },
  {
    x: -1.0,
    half: [
      [0, 0.84],
      [0.3, 0.81],
      [0.52, 0.62],
      [0.72, 0.42],
      [1.42, 0.02],
      [1.28, -0.08],
      [0.7, -0.3],
      [0.62, -0.45],
      [0.6, -0.86],
      [0.4, -0.94],
      [0.12, -0.95],
      [0, -0.95],
    ],
  },
  {
    // Wing root trailing edge; the blended chine runs on to the stabilisers.
    x: -2.54,
    half: [
      [0, 0.87],
      [0.28, 0.84],
      [0.5, 0.64],
      [0.72, 0.45],
      [1.38, 0.03],
      [1.25, -0.08],
      [0.72, -0.3],
      [0.66, -0.45],
      [0.62, -0.8],
      [0.42, -0.9],
      [0.12, -0.92],
      [0, -0.92],
    ],
  },
  {
    x: -4.16,
    half: [
      [0, 0.9],
      [0.25, 0.87],
      [0.45, 0.66],
      [0.7, 0.5],
      [1.12, 0.04],
      [1.0, -0.08],
      [0.7, -0.3],
      [0.66, -0.45],
      [0.6, -0.72],
      [0.4, -0.8],
      [0.12, -0.82],
      [0, -0.82],
    ],
  },
  {
    x: -5.4,
    half: [
      [0, 0.9],
      [0.2, 0.86],
      [0.38, 0.66],
      [0.6, 0.5],
      [1.0, 0.05],
      [0.9, -0.08],
      [0.66, -0.28],
      [0.62, -0.42],
      [0.55, -0.6],
      [0.38, -0.66],
      [0.12, -0.68],
      [0, -0.68],
    ],
  },
  // Engine bay closes round the nozzle (radius 0.56).
  { x: -5.8, half: ellipse(0.03, 0.58, 0.59) },
  { x: -5.82, half: [[0, 0]] },
];

/** Materials by the stations a strip runs between: radome, canopy, intake mouth. */
function fuselageMat(strip: number, seg: number): Mat {
  const front = SECTIONS[strip].x,
    back = SECTIONS[strip + 1].x;
  if (back >= 6.08) return 'radome';
  if (front <= 5.44 && back >= 1.9 && seg <= 1) return 'canopy';
  // Between the nose underside and the lip: the intake mouth.
  if (front === 3.7 && back === 3.62 && seg >= 7 && seg <= 10) return 'intake';
  return seg >= 8 ? 'belly' : 'skin';
}

const WING_ROOT: Chord = { le: [0.84, 1.4, 0], te: [-2.54, 1.4, 0], t: 0.04 };
const WING_TIP: Chord = { le: [-1.6, 4.7, 0], te: [-2.54, 4.7, 0], t: 0.04 };

const AIM9 = { length: 2.87, radius: 0.064, fin: 0.2 };
/** Under-wing stations; the first missile pair rides the wingtip rails. */
const TIP_MISSILE: [x: number, y: number, z: number] = [-1.6, 4.9, 0];
const PYLON_MISSILE: [x: number, y: number, z: number] = [-1.5, 3.95, -0.32];

/** Dark grey scheme with the gold-tinted canopy of US Air Force F-16s; white gear legs. */
const PAINT: Partial<Record<Mat, number>> = {
  skin: 0x646c73,
  belly: 0x6f777e,
  radome: 0x5c646b,
  canopy: 0x4b4529,
  pylon: 0x5f676e,
  strut: 0xc9cdcf,
};

export function buildF16(): Mesh {
  const b = new MeshBuilder();
  b.loft(SECTIONS, fuselageMat);
  b.revolve(
    { x: 8.34, y: 0, z: -0.21 },
    [
      [0, 0, 'nozzle'],
      [-0.6, 0.035, 'nozzle'],
      [-0.6, 0, 'nozzle'],
    ],
    4,
  );
  // Drag chute housing under the fin root, over the nozzle.
  b.revolve(
    { x: -4.85, y: 0, z: 0.72 },
    [
      [0, 0, 'skin'],
      [-0.35, 0.21, 'skin'],
      [-1.35, 0.21, 'skin'],
      [-1.45, 0.13, 'skin'],
      [-1.45, 0, 'skin'],
    ],
    8,
  );

  // Single fin on a low, nearly level spine: 47° leading edge, its tip past the nozzle.
  b.plate(
    [0, 0.5, 1].map((k) => ({
      le: { x: -3.42 + (-6.04 + 3.42) * k, y: 0, z: 0.86 + (3.39 - 0.86) * k },
      te: { x: -6.1 + (-7.09 + 6.1) * k, y: 0, z: 0.86 + (3.39 - 0.86) * k },
      t: 0.05,
    })),
    { x: 0, y: 1, z: 0 },
  );

  // Engine nozzle, dark inside.
  b.revolve(
    { x: -5.77, y: 0, z: 0.03 },
    [
      [0, 0.56, 'nozzle'],
      [-0.5, 0.52, 'nozzle'],
      [-0.95, 0.47, 'nozzle'],
    ],
    16,
  );
  b.disc({ x: -6.72, y: 0, z: 0.03 }, 0.47, 16, -1, 'nozzleIn');

  for (const side of [-1, 1]) {
    // Cropped delta-ish wing, 40° leading edge, unswept trailing edge, no dihedral.
    b.plate(
      [0, 0.35, 0.7, 1].map((k) => between(WING_ROOT, WING_TIP, k, side)),
      { x: 0, y: 0, z: 1 },
    );
    // Wingtip launch rail.
    b.box(
      { x: -3.08, y: side > 0 ? 4.7 : -4.84, z: -0.05 },
      { x: -0.44, y: side > 0 ? 4.84 : -4.7, z: 0.05 },
      'pylon',
    );

    // Stabiliser actuator and split speed brake fairing beside the nozzle: a thick
    // lenticular strake rather than a box, so it fairs into the chine.
    b.plate(
      [
        {
          le: { x: -4.6, y: 0.5 * side, z: 0.01 },
          te: { x: -6.85, y: 0.5 * side, z: 0.01 },
          t: 0.13,
        },
        {
          le: { x: -5.0, y: 1.15 * side, z: 0.01 },
          te: { x: -6.8, y: 1.15 * side, z: 0.01 },
          t: 0.1,
        },
      ],
      { x: 0, y: 0, z: 1 },
    );
    // All-moving stabiliser, 10° anhedral.
    const stabZ = -(2.89 - 1.11) * Math.tan(10 * DEG);
    b.plate(
      [0, 0.5, 1].map((k) =>
        between(
          { le: [-4.16, 1.11, 0], te: [-6.72, 1.15, 0], t: 0.05 },
          { le: [-5.71, 2.89, stabZ], te: [-6.4, 2.89, stabZ], t: 0.04 },
          k,
          side,
        ),
      ),
      { x: 0, y: 0, z: 1 },
    );

    // Ventral fin under the rear fuselage, canted 15° outwards.
    const cant = 15 * DEG,
      depth = 0.57;
    b.plate(
      [0, 1].map((k) => {
        const y = (0.62 + Math.sin(cant) * depth * k) * side,
          z = -0.75 - Math.cos(cant) * depth * k;
        return {
          le: { x: -2.43 + (-2.84 + 2.43) * k, y, z },
          te: { x: -3.9 + (-3.87 + 3.9) * k, y, z },
          t: 0.06,
        };
      }),
      { x: 0, y: Math.cos(cant) * side, z: Math.sin(cant) },
    );
  }

  // Stores in left/right pairs: even indices on the left, odd on the right.
  b.under = true;
  [-1, 1].forEach((side, s) => {
    b.store = { slot: 'missile', index: s };
    missile(b, TIP_MISSILE[0], TIP_MISSILE[1] * side, TIP_MISSILE[2], AIM9);
    b.store = undefined;
    pylon(b, WING_ROOT, WING_TIP, PYLON_MISSILE[1], side, PYLON_MISSILE[2] + 0.05);
    b.store = { slot: 'missile', index: 2 + s };
    missile(b, PYLON_MISSILE[0], PYLON_MISSILE[1] * side, PYLON_MISSILE[2], AIM9);
  });
  b.store = undefined;

  // Landing gear, ground at z = −1.49 (height 4.88 m to the fin tip): nose wheel behind
  // the intake, main wheels under the fuselage.
  b.gear = true;
  b.box({ x: 3.26, y: -0.05, z: -1.26 }, { x: 3.4, y: 0.05, z: -0.9 }, 'strut');
  b.wheel({ x: 3.33, y: 0, z: -1.26 }, 0.23, 0.15, 8, 'tyre');
  for (const side of [-1, 1]) {
    b.box(
      { x: -0.8, y: side > 0 ? 0.98 : -1.08, z: -1.15 },
      { x: -0.6, y: side > 0 ? 1.08 : -0.98, z: -0.8 },
      'strut',
    );
    b.wheel({ x: -0.7, y: 1.2 * side, z: -1.15 }, 0.34, 0.2, 8, 'tyre');
  }
  b.gear = false;
  b.under = false;
  cannonPorts(b, 'F-16');
  return { ...b.build(), paint: PAINT };
}

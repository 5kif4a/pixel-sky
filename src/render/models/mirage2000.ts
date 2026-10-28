import { DEG, type Vec3 } from '../../world/math';
import {
  FLAT_AIRFOIL,
  MeshBuilder,
  type Mat,
  type Mesh,
  type Section,
  type SectionPoint,
} from '../meshBuilder';
import { between, cannonPorts, missile, pylon, type Chord } from './parts';

/**
 * Mirage 2000-5 low-poly model, measured off the three-view in src/assets
 * (dassault-mirage-2000.gif; model-preview.html?id=Mirage 2000 shows the overlay): 14.3 m
 * radome to nozzle, 9.13 m span. Body axes: x forward (radome tip at x = 7.6), y right,
 * z up from the engine axis; the low-set delta wing is at z ≈ −0.5.
 */

const ANGLES = [0, 22, 48, 72, 90, 100, 115, 132, 150, 165, 175, 180];
const ellipse = (zc: number, hw: number, hh: number): SectionPoint[] =>
  ANGLES.map((a) => [Math.sin(a * DEG) * hw, zc + Math.cos(a * DEG) * hh]);

/*
 * Section points, right half: 0 top centre (canopy, spine), 1 shoulder, 2 canopy sill,
 * 3 upper side (top of the intake), 4 intake outer side and then the wing root, 5 under it,
 * 6 lower side, 7–10 belly, 11 bottom centre.
 */
const SECTIONS: Section[] = [
  // Long pointed radome, drooped below the engine axis.
  { x: 7.6, half: [[0, -0.59]] },
  { x: 6.6, half: ellipse(-0.5, 0.24, 0.22) },
  { x: 5.6, half: ellipse(-0.43, 0.5, 0.41) },
  {
    // Windscreen base.
    x: 5.08,
    half: [
      [0, 0.13],
      [0.25, 0.08],
      [0.42, -0.1],
      [0.52, -0.28],
      [0.55, -0.42],
      [0.54, -0.5],
      [0.5, -0.61],
      [0.41, -0.71],
      [0.28, -0.8],
      [0.14, -0.85],
      [0.05, -0.86],
      [0, -0.86],
    ],
  },
  {
    // Bubble canopy over the cockpit.
    x: 4.03,
    half: [
      [0, 0.67],
      [0.3, 0.5],
      [0.43, 0.05],
      [0.55, -0.2],
      [0.58, -0.42],
      [0.56, -0.52],
      [0.52, -0.63],
      [0.43, -0.74],
      [0.3, -0.82],
      [0.15, -0.87],
      [0.05, -0.88],
      [0, -0.88],
    ],
  },
  {
    // Just ahead of the intakes: their ring still lies on the fuselage side.
    x: 3.42,
    half: [
      [0, 0.67],
      [0.3, 0.52],
      [0.44, 0.08],
      [0.56, -0.15],
      [0.6, -0.38],
      [0.58, -0.55],
      [0.54, -0.66],
      [0.45, -0.76],
      [0.31, -0.83],
      [0.15, -0.87],
      [0.05, -0.88],
      [0, -0.88],
    ],
  },
  {
    // Half-round side intakes with shock cones, centred at y ±0.69, z −0.38.
    x: 3.32,
    half: [
      [0, 0.67],
      [0.3, 0.52],
      [0.44, 0.08],
      [0.56, 0],
      [1.02, -0.32],
      [0.96, -0.6],
      [0.62, -0.74],
      [0.45, -0.78],
      [0.31, -0.84],
      [0.15, -0.87],
      [0.05, -0.88],
      [0, -0.88],
    ],
  },
  {
    // Canopy aft end; the wing root leading edge is just behind.
    x: 2.6,
    half: [
      [0, 0.63],
      [0.3, 0.52],
      [0.45, 0.15],
      [0.58, -0.02],
      [1.15, -0.45],
      [1.0, -0.62],
      [0.64, -0.76],
      [0.47, -0.8],
      [0.32, -0.84],
      [0.15, -0.87],
      [0.05, -0.88],
      [0, -0.88],
    ],
  },
  {
    x: 1.0,
    half: [
      [0, 0.58],
      [0.3, 0.55],
      [0.48, 0.3],
      [0.62, 0],
      [1.1, -0.5],
      [0.95, -0.64],
      [0.66, -0.76],
      [0.5, -0.8],
      [0.34, -0.83],
      [0.16, -0.85],
      [0.05, -0.86],
      [0, -0.86],
    ],
  },
  {
    x: -1.5,
    half: [
      [0, 0.57],
      [0.32, 0.55],
      [0.55, 0.35],
      [0.75, 0.05],
      [1.0, -0.5],
      [0.9, -0.64],
      [0.68, -0.77],
      [0.5, -0.82],
      [0.34, -0.84],
      [0.16, -0.85],
      [0.05, -0.86],
      [0, -0.86],
    ],
  },
  {
    x: -3.5,
    half: [
      [0, 0.6],
      [0.32, 0.57],
      [0.6, 0.38],
      [0.82, 0.05],
      [0.92, -0.48],
      [0.84, -0.62],
      [0.66, -0.76],
      [0.5, -0.82],
      [0.34, -0.84],
      [0.16, -0.85],
      [0.05, -0.86],
      [0, -0.86],
    ],
  },
  {
    // Wing root trailing edge.
    x: -4.6,
    half: [
      [0, 0.6],
      [0.3, 0.57],
      [0.58, 0.4],
      [0.8, 0.05],
      [0.88, -0.45],
      [0.8, -0.6],
      [0.62, -0.74],
      [0.48, -0.8],
      [0.32, -0.82],
      [0.16, -0.83],
      [0.05, -0.84],
      [0, -0.84],
    ],
  },
  // Engine bay round the M53 nozzle.
  { x: -5.85, half: ellipse(0, 0.63, 0.62) },
  { x: -5.87, half: [[0, 0]] },
];

/** Materials by the stations a strip runs between: radome, canopy, intake mouth. */
function fuselageMat(strip: number, seg: number): Mat {
  const front = SECTIONS[strip].x,
    back = SECTIONS[strip + 1].x;
  if (back >= 5.6) return 'radome';
  if (front <= 5.08 && back >= 2.6 && seg <= 1) return 'canopy';
  if (front === 3.42 && back === 3.32 && seg >= 3 && seg <= 5) return 'intake';
  return seg >= 7 ? 'belly' : 'skin';
}

const WING_ROOT: Chord = { le: [2.69, 1.0, -0.5], te: [-4.56, 1.0, -0.5], t: 0.035 };
/** Slight anhedral, about 2°: more makes the facets fold visibly along the span. */
const WING_TIP: Chord = { le: [-3.55, 4.56, -0.62], te: [-4.47, 4.56, -0.62], t: 0.035 };

const MAGIC = { length: 2.75, radius: 0.08, fin: 0.2 };
const MISSILES: [x: number, y: number, z: number][] = [
  [-2.8, 3.6, -0.85],
  [-2.0, 2.75, -0.82],
];

/** French air force two-tone blue-grey: light base, darker soft patches on top. */
const PAINT: Partial<Record<Mat, number>> = {
  skin: 0xb3c3cf,
  camo: 0x91a5b4,
  belly: 0xc4ced4,
  radome: 0x9ea3a5,
  canopy: 0x1d2a33,
  pylon: 0xa9b9c5,
  strut: 0xc9cdcf,
};
/** Patch pattern; whole facets take one tone, undersides stay plain. */
function camo(c: Vec3, n: Vec3): Mat {
  if (n.z < -0.35) return 'belly';
  const k =
    Math.sin(0.9 * c.x + 0.55 * c.y) +
    Math.sin(0.5 * c.x - 1.1 * c.y + 2.3) +
    0.6 * Math.sin(1.6 * c.z + 0.7 * c.x - 0.4 * c.y + 1);
  return k > 0.5 ? 'camo' : 'skin';
}

export function buildMirage2000(): Mesh {
  const b = new MeshBuilder();
  b.loft(SECTIONS, fuselageMat);
  // Fixed refuelling probe on the right of the windscreen.
  b.rod({ x: 5.15, y: 0.32, z: 0.05 }, { x: 6.05, y: 0.5, z: 0.5 }, 0.035, 'probe');
  b.rod({ x: 6.05, y: 0.5, z: 0.5 }, { x: 6.35, y: 0.52, z: 0.5 }, 0.035, 'probe');

  // Fin with the long curved dorsal fillet of the Mirage.
  b.plate(
    [
      [0.55, -1.68, -5.25],
      [1.05, -2.94, -5.4],
      [2.14, -4.45, -5.9],
      [2.94, -5.6, -6.3],
    ].map(([z, le, te]) => ({ le: { x: le, y: 0, z }, te: { x: te, y: 0, z }, t: 0.05 })),
    { x: 0, y: 1, z: 0 },
  );

  // M53 nozzle, dark inside.
  b.revolve(
    { x: -5.85, y: 0, z: 0 },
    [
      [0, 0.6, 'nozzle'],
      [-0.4, 0.57, 'nozzle'],
      [-0.83, 0.52, 'nozzle'],
    ],
    16,
  );
  b.disc({ x: -6.68, y: 0, z: 0 }, 0.52, 16, -1, 'nozzleIn');

  for (const side of [-1, 1]) {
    // Shock cone in the intake.
    b.revolve(
      { x: 3.7, y: 0.69 * side, z: -0.38 },
      [
        [0, 0, 'intake'],
        [-0.38, 0.16, 'nozzle'],
        [-0.42, 0, 'nozzle'],
      ],
      6,
    );
    // Small fixed strake on the intake, ahead of the wing root.
    b.plate(
      [
        {
          le: { x: 1.9, y: 1.0 * side, z: -0.28 },
          te: { x: 1.35, y: 1.0 * side, z: -0.28 },
          t: 0.06,
        },
        {
          le: { x: 1.5, y: 1.22 * side, z: -0.28 },
          te: { x: 1.35, y: 1.22 * side, z: -0.28 },
          t: 0.06,
        },
      ],
      { x: 0, y: 0, z: 1 },
    );
    // Tailless delta: 58° leading edge, slight anhedral, elevons along the trailing edge.
    b.plate(
      [0, 0.3, 0.5, 0.72, 1].map((k) => between(WING_ROOT, WING_TIP, k, side)),
      { x: 0, y: 0, z: 1 },
      undefined,
      FLAT_AIRFOIL,
    );
    // French roundel on the upper wing: blue, white, red rings.
    const centre = { x: -2.6, y: 3.2 * side, z: -0.5 };
    b.ring(centre, 0, 0.13, 10, 1, 'decalBlue');
    b.ring(centre, 0.13, 0.25, 10, 1, 'decalWhite');
    b.ring(centre, 0.25, 0.36, 10, 1, 'star');
  }

  // Stores in left/right pairs: even indices on the left, odd on the right.
  b.under = true;
  MISSILES.forEach(([x, y, z], i) =>
    [-1, 1].forEach((side, s) => {
      b.store = undefined;
      pylon(b, WING_ROOT, WING_TIP, y, side, z + 0.06);
      b.store = { slot: 'missile', index: i * 2 + s };
      missile(b, x, y * side, z, MAGIC);
    }),
  );
  b.store = undefined;

  // Tall landing gear, ground at z = −2.26 (height 5.2 m to the fin tip): twin nose
  // wheels, main wheels outboard under the wings.
  b.gear = true;
  b.box({ x: 3.93, y: -0.05, z: -2.04 }, { x: 4.07, y: 0.05, z: -0.85 }, 'strut');
  for (const y of [-0.16, 0.16]) b.wheel({ x: 4.0, y, z: -2.04 }, 0.22, 0.14, 8, 'tyre');
  for (const side of [-1, 1]) {
    b.box(
      { x: -1.6, y: side > 0 ? 1.55 : -1.67, z: -1.88 },
      { x: -1.4, y: side > 0 ? 1.67 : -1.55, z: -0.7 },
      'strut',
    );
    b.wheel({ x: -1.5, y: 1.8 * side, z: -1.88 }, 0.38, 0.22, 8, 'tyre');
  }
  b.gear = false;
  b.under = false;
  b.paint(camo);
  cannonPorts(b, 'Mirage 2000');
  return { ...b.build(), paint: PAINT };
}

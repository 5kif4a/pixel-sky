import { DEG } from '../../world/math';
import { MeshBuilder, type Mat, type Mesh, type Section, type SectionPoint } from '../meshBuilder';
import { between, cannonPorts, missile, pylon, type Chord } from './parts';

/**
 * MiG-35 (Fulcrum-F) low-poly model, measured off the three-view drawing in src/assets
 * (see model-preview.html for the overlay): 17.3 m from pitot to stabiliser tips, 12 m span.
 * Body axes: x forward (radome tip at x = 9), y right, z up; the wing plane is z = 0.
 * The planform matches `silhouette` in data/aircraft.ts (shadow, engine glow).
 */

/** Round section: 12 points from the top (0°) to the bottom (180°), chine point at 90°. */
const ANGLES = [0, 22, 48, 72, 90, 100, 115, 132, 150, 165, 175, 180];
const tube = (zc: number, r: number): SectionPoint[] =>
  ANGLES.map((a) => [Math.sin(a * DEG) * r, zc + Math.cos(a * DEG) * r]);
/** Round section with its top three points replaced (windscreen, canopy). */
const topped = (zc: number, r: number, top: SectionPoint[], chine: SectionPoint) => {
  const s = tube(zc, r);
  s.splice(0, top.length, ...top);
  s[4] = chine;
  return s;
};

/*
 * Section points, right half: 0 top centre (canopy, dorsal spine), 1 shoulder, 2 canopy sill,
 * 3 upper body, 4 chine (LERX and wing root edge), 5 under the chine, 6–10 intake and engine
 * nacelle (outer top, outer bottom, bottom, inner bottom, inner top), 11 tunnel between the
 * nacelles on the centreline.
 */
const SECTIONS: Section[] = [
  // Long, slightly drooped radome.
  { x: 9.0, half: [[0, -0.05]] },
  { x: 8.3, half: tube(-0.04, 0.26) },
  { x: 7.5, half: tube(-0.02, 0.42) },
  { x: 6.6, half: tube(0, 0.51) },
  {
    // Windscreen base; the LERX starts here.
    x: 5.95,
    half: topped(
      0.01,
      0.55,
      [
        [0, 0.82],
        [0.27, 0.76],
        [0.45, 0.52],
      ],
      [0.6, 0],
    ),
  },
  {
    // Canopy: a tall bubble, about 1 m above the nose tube.
    x: 5.05,
    half: [
      [0, 1.47],
      [0.33, 1.33],
      [0.46, 0.72],
      [0.55, 0.35],
      [0.84, 0],
      [0.74, -0.07],
      [0.53, -0.2],
      [0.45, -0.38],
      [0.32, -0.48],
      [0.17, -0.54],
      [0.06, -0.56],
      [0, -0.57],
    ],
  },
  {
    x: 3.8,
    half: [
      [0, 1.47],
      [0.34, 1.33],
      [0.47, 0.72],
      [0.58, 0.38],
      [1.06, 0],
      [0.98, -0.07],
      [0.55, -0.2],
      [0.46, -0.39],
      [0.33, -0.5],
      [0.17, -0.55],
      [0.06, -0.57],
      [0, -0.58],
    ],
  },
  {
    // Just ahead of the intakes: the nacelle is still folded into the nose tube.
    x: 3.2,
    half: [
      [0, 1.36],
      [0.34, 1.25],
      [0.48, 0.72],
      [0.6, 0.4],
      [1.18, 0],
      [1.1, -0.06],
      [0.56, -0.2],
      [0.47, -0.39],
      [0.34, -0.5],
      [0.18, -0.55],
      [0.06, -0.57],
      [0, -0.58],
    ],
  },
  {
    // Intake lips under the LERX, strongly raked: the lower lip is 0.7 m further aft.
    x: 3.1,
    half: [
      [0, 1.34],
      [0.34, 1.24],
      [0.48, 0.72],
      [0.6, 0.4],
      [1.2, 0],
      [1.08, -0.07],
      [1.04, -0.13, -0.05],
      [1.03, -0.72, -0.62],
      [0.71, -0.8, -0.72],
      [0.4, -0.74, -0.62],
      [0.38, -0.38, -0.3],
      [0, -0.58],
    ],
  },
  {
    // Canopy fairs into the MiG-35's large dorsal spine.
    x: 2.0,
    half: [
      [0, 1.12],
      [0.36, 1.06],
      [0.5, 0.7],
      [0.75, 0.38],
      [1.42, 0],
      [1.3, -0.07],
      [1.08, -0.14],
      [1.07, -0.8],
      [0.74, -0.86],
      [0.4, -0.8],
      [0.36, -0.38],
      [0, -0.5],
    ],
  },
  {
    // Wing root leading edge: the LERX meets the wing.
    x: 0.74,
    half: [
      [0, 0.97],
      [0.38, 0.92],
      [0.54, 0.64],
      [0.88, 0.34],
      [1.67, 0],
      [1.55, -0.08],
      [1.14, -0.16],
      [1.13, -0.86],
      [0.78, -0.94],
      [0.41, -0.86],
      [0.36, -0.4],
      [0, -0.46],
    ],
  },
  {
    x: -1.3,
    half: [
      [0, 0.66],
      [0.4, 0.64],
      [0.6, 0.5],
      [1.05, 0.32],
      [1.69, 0.02],
      [1.57, -0.08],
      [1.22, -0.18],
      [1.21, -0.96],
      [0.82, -1.05],
      [0.42, -0.94],
      [0.36, -0.42],
      [0, -0.42],
    ],
  },
  {
    // Wing root trailing edge; the tail booms rise to carry the fins.
    x: -3.3,
    half: [
      [0, 0.48],
      [0.4, 0.48],
      [0.62, 0.42],
      [1.25, 0.3],
      [1.72, 0.05],
      [1.58, -0.09],
      [1.3, -0.22],
      [1.28, -0.9],
      [0.86, -1.02],
      [0.44, -0.9],
      [0.37, -0.42],
      [0, -0.38],
    ],
  },
  {
    // Engines round out into separate tubes.
    x: -4.4,
    half: [
      [0, 0.36],
      [0.4, 0.36],
      [0.66, 0.3],
      [1.25, 0.26],
      [1.66, 0.02],
      [1.5, -0.12],
      [1.36, -0.32],
      [1.3, -0.68],
      [0.86, -0.9],
      [0.45, -0.75],
      [0.34, -0.4],
      [0, -0.3],
    ],
  },
  {
    // Nozzle station: engines of radius ~0.55 at y = ±0.85, z = −0.3.
    x: -5.1,
    half: [
      [0, 0.12],
      [0.38, 0.12],
      [0.66, 0.22],
      [1.06, 0.2],
      [1.42, -0.05],
      [1.42, -0.22],
      [1.38, -0.45],
      [1.22, -0.72],
      [0.85, -0.85],
      [0.5, -0.72],
      [0.33, -0.42],
      [0, -0.24],
    ],
  },
  { x: -5.15, half: [[0, -0.15]] },
];

const RADOME_STRIPS = 3;
/** Windscreen to the intake lips. */
const CANOPY_STRIPS = [4, 5, 6, 7];
/** Strip between the folded nacelle and the lips: the intake mouth. */
const INTAKE_STRIP = 7;

/*
 * Paint: the light grey MiG-35 demonstrator scheme. Dark grey radome, a dark anti-glare
 * panel ahead of the windscreen, dark fin tip caps, red stars on the upper wings only.
 */
function fuselageMat(strip: number, seg: number): Mat {
  if (strip < RADOME_STRIPS) return 'radome';
  if (strip === RADOME_STRIPS && seg <= 1) return 'trim';
  if (CANOPY_STRIPS.includes(strip) && seg <= 1) return 'canopy';
  if (strip === INTAKE_STRIP && seg >= 5 && seg <= 9) return 'intake';
  return seg >= 7 ? 'belly' : 'skin';
}

/** Missile stations under the wings, one entry per left/right pair. */
const MISSILES: [x: number, y: number, z: number][] = [
  [-2.3, 5.0, -0.4],
  [-2.0, 4.1, -0.38],
];

const WING_ROOT: Chord = { le: [0.74, 1.67, 0], te: [-3.3, 1.67, 0], t: 0.05 };
const WING_TIP: Chord = {
  le: [-2.8, 6, -(6 - 1.67) * Math.tan(2 * DEG)],
  te: [-3.95, 6, -(6 - 1.67) * Math.tan(2 * DEG)],
  t: 0.04,
};

const R73 = { length: 2.9, radius: 0.12, fin: 0.2 };

export function buildMig35(): Mesh {
  const b = new MeshBuilder();
  b.loft(SECTIONS, fuselageMat);
  // Pitot probe.
  b.revolve(
    { x: 10, y: 0, z: -0.05 },
    [
      [0, 0, 'nozzle'],
      [-1.05, 0.05, 'nozzle'],
      [-1.05, 0, 'nozzle'],
    ],
    4,
  );

  for (const side of [-1, 1]) {
    // Wing: ~40° leading edge sweep, 2° anhedral; spanwise strips help depth sorting.
    b.plate(
      // A strip from k 0.55 to 0.75 keeps the facets under the star small.
      [0, 0.3, 0.55, 0.75, 1].map((k) => between(WING_ROOT, WING_TIP, k, side)),
      { x: 0, y: 0, z: 1 },
    );

    // Red star on the upper wing, on the flat part of the airfoil two thirds out.
    b.star({ x: -2.6, y: 4.5 * side, z: -0.045 }, 0.42, 1, 'star');

    // Tail boom fairing carrying the stabiliser pivot, outboard of the engine.
    b.box(
      { x: -6.25, y: side > 0 ? 1.38 : -1.86, z: -0.16 },
      { x: -3.6, y: side > 0 ? 1.86 : -1.38, z: 0.2 },
      'skin',
    );

    // All-moving stabiliser, 3° anhedral, its trailing edge past the nozzles.
    const stabZ = -(3.75 - 1.86) * Math.tan(3 * DEG);
    b.plate(
      [0, 0.5, 1].map((k) =>
        between(
          { le: [-4.08, 1.86, 0], te: [-6.15, 1.86, 0], t: 0.05 },
          { le: [-6.24, 3.75, stabZ], te: [-7.3, 3.7, stabZ], t: 0.04 },
          k,
          side,
        ),
      ),
      { x: 0, y: 0, z: 1 },
    );

    // Fin on the boom, canted 6.5° outwards; no markings on the tail.
    const cant = 6.5 * DEG,
      height = 2.65;
    const fin = (k: number) => {
      const h = height * k;
      const y = (1.64 + Math.sin(cant) * h) * side,
        z = 0.2 + Math.cos(cant) * h;
      return {
        le: { x: -2.92 + (-5.29 + 2.92) * k, y, z },
        te: { x: -5.56 + (-5.85 + 5.56) * k, y, z },
        t: 0.05,
      };
    };
    b.plate(
      [fin(0), fin(0.45), fin(0.88), fin(1)],
      { x: 0, y: Math.cos(cant) * side, z: -Math.sin(cant) },
      (strip) => (strip === 2 ? 'trim' : 'skin'),
    );

    // Engine nozzle: short tapering tube out of the nacelle, dark inside.
    const nz = { x: -5.05, y: 0.85 * side, z: -0.3 };
    b.revolve(
      nz,
      [
        [0, 0.55, 'nozzle'],
        [-0.82, 0.49, 'nozzle'],
      ],
      12,
    );
    b.disc({ x: nz.x - 0.82, y: nz.y, z: nz.z }, 0.49, 12, -1, 'nozzleIn');
  }

  // Stores in left/right pairs: even indices on the left, odd on the right.
  b.under = true;
  MISSILES.forEach(([x, y, z], i) =>
    [-1, 1].forEach((side, s) => {
      // Launch rail pylon; it stays on the wing after the missile is fired.
      b.store = undefined;
      pylon(b, WING_ROOT, WING_TIP, y, side, z + 0.08);
      b.store = { slot: 'missile', index: i * 2 + s };
      missile(b, x, y * side, z, R73);
    }),
  );
  b.store = undefined;

  // Landing gear, ground at z = −1.9 (height 4.73 m to the fin tips): twin nose wheels
  // behind the radome, main wheels under the nacelles.
  b.gear = true;
  b.box({ x: 4.22, y: -0.05, z: -1.63 }, { x: 4.36, y: 0.05, z: -0.5 }, 'strut');
  for (const y of [-0.17, 0.17]) b.wheel({ x: 4.29, y, z: -1.63 }, 0.27, 0.16, 8, 'tyre');
  for (const side of [-1, 1]) {
    b.box(
      { x: -1.82, y: side > 0 ? 1.42 : -1.54, z: -1.48 },
      { x: -1.62, y: side > 0 ? 1.54 : -1.42, z: -0.85 },
      'strut',
    );
    b.wheel({ x: -1.72, y: 1.66 * side, z: -1.48 }, 0.42, 0.24, 8, 'tyre');
  }
  b.gear = false;
  b.under = false;
  cannonPorts(b, 'MiG-35');
  return b.build();
}

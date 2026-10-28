import { add, cross, dot, normalize, scale, sub, type Vec3 } from '../world/math';

/**
 * Low-poly aircraft meshes: flat-shaded triangles in body axes (x forward from the CG,
 * y right, z up), metres. Every triangle is wound counter-clockwise seen from outside, so the
 * renderer can cull back faces.
 */
export type Mat =
  | 'skin'
  | 'camo'
  | 'belly'
  | 'trim'
  | 'star'
  | 'decalWhite'
  | 'decalBlue'
  | 'radome'
  | 'canopy'
  | 'intake'
  | 'nozzle'
  | 'nozzleIn'
  | 'accent'
  | 'missile'
  | 'seeker'
  | 'pylon'
  /** Off-centre fittings (refuelling probe): the only parts allowed to break symmetry. */
  | 'probe'
  | 'tyre'
  | 'strut'
  | 'wall'
  | 'roof'
  | 'doorway';

export interface StoreTag {
  slot: 'missile';
  index: number;
}
export interface Tri {
  a: number;
  b: number;
  c: number;
  mat: Mat;
  /** Outward unit normal in body axes. */
  n: Vec3;
  /** Set for triangles of an external store; hidden once that store is used. */
  store?: StoreTag;
  /** Markings lying on a surface: drawn after the surfaces at the same depth. */
  decal?: boolean;
  /** Hangs under the wing (stores, pylons): layered below or above the wing as seen. */
  under?: boolean;
  /** Landing gear: shown only while the gear is down. */
  gear?: boolean;
}
export interface Mesh {
  verts: Vec3[];
  tris: Tri[];
  /** Colour scheme of this model, overriding the default material colours. */
  paint?: Partial<Record<Mat, number>>;
}

/** Point of a fuselage section, (y, z) for the right half; mirrored to the left. */
export type SectionPoint = [y: number, z: number, dx?: number];
export interface Section {
  x: number;
  /** Right half from the top centre (y = 0) round to the bottom centre (y = 0). */
  half: SectionPoint[];
}

/** Hexagonal airfoil: (chord fraction, height as a share of half thickness). */
export const AIRFOIL: readonly [number, number][] = [
  [0, 0],
  [0.25, 1],
  [0.65, 0.8],
  [1, 0],
  [0.65, -0.8],
  [0.25, -1],
];
/**
 * Flat-sided airfoil for wings with a long root chord (deltas): one flat facet from 12 to
 * 80 % of the chord on each side, so no ridge line runs diagonally across the wing.
 */
export const FLAT_AIRFOIL: readonly [number, number][] = [
  [0, 0],
  [0.12, 1],
  [0.8, 1],
  [1, 0],
  [0.8, -1],
  [0.12, -1],
];

export class MeshBuilder {
  verts: Vec3[] = [];
  tris: Tri[] = [];
  /** The store the next triangles belong to, and whether they hang under the wing. */
  store?: StoreTag;
  under = false;
  gear = false;

  vert(p: Vec3) {
    this.verts.push(p);
    return this.verts.length - 1;
  }

  tri(a: number, b: number, c: number, mat: Mat) {
    if (a === b || b === c || a === c) return;
    const [pa, pb, pc] = [this.verts[a], this.verts[b], this.verts[c]];
    const n = cross(sub(pb, pa), sub(pc, pa));
    if (Math.hypot(n.x, n.y, n.z) < 1e-9) return;
    this.tris.push({
      a,
      b,
      c,
      mat,
      n: normalize(n),
      store: this.store,
      under: this.under,
      gear: this.gear,
    });
  }

  /**
   * Turns every triangle added since `from` to face away from the centre of its vertices.
   * Valid for convex parts: wing panels, fins, tubes, store bodies.
   */
  orientConvex(from: number) {
    const ids = new Set<number>();
    for (let i = from; i < this.tris.length; i++) {
      const t = this.tris[i];
      ids.add(t.a).add(t.b).add(t.c);
    }
    let c = { x: 0, y: 0, z: 0 };
    for (const id of ids) c = add(c, this.verts[id]);
    c = scale(c, 1 / ids.size);
    for (let i = from; i < this.tris.length; i++) {
      const t = this.tris[i];
      const m = scale(add(add(this.verts[t.a], this.verts[t.b]), this.verts[t.c]), 1 / 3);
      if (dot(t.n, sub(m, c)) < 0) {
        [t.b, t.c] = [t.c, t.b];
        t.n = scale(t.n, -1);
      }
    }
  }

  /**
   * Fuselage loft through sections ordered nose to tail. All sections have the same number
   * of points, so the skin is one seamless surface; a section of a single point closes the
   * end as a cone. `mat(strip, segment)` picks the material of each quad, where segment 0
   * starts at the top centre and counts round the right half (it is mirrored on the left).
   */
  loft(sections: Section[], mat: (strip: number, segment: number) => Mat) {
    const k = Math.max(...sections.map((s) => s.half.length));
    const rings = sections.map((s) => {
      if (s.half.length === 1) {
        const [y, z, dx = 0] = s.half[0];
        return new Array<number>(2 * k - 2).fill(this.vert({ x: s.x + dx, y, z }));
      }
      const right = s.half.map(([y, z, dx = 0]) => this.vert({ x: s.x + dx, y, z }));
      const left = s.half
        .slice(1, -1)
        .reverse()
        .map(([y, z, dx = 0]) => this.vert({ x: s.x + dx, y: -y, z }));
      return [...right, ...left];
    });
    const n = 2 * k - 2;
    for (let s = 0; s + 1 < rings.length; s++) {
      const A = rings[s],
        B = rings[s + 1];
      for (let i = 0; i < n; i++) {
        const j = (i + 1) % n;
        // Mirrored segment index, so left and right halves share materials.
        const seg = i < k - 1 ? i : n - 1 - i;
        const m = mat(s, seg);
        this.tri(A[i], A[j], B[i], m);
        this.tri(A[j], B[j], B[i], m);
      }
    }
  }

  /**
   * Lifting surface: chord lines (leading and trailing edge points) from root to tip, a
   * hexagonal airfoil of the given relative thickness, `normal` across the thickness.
   * `mat(strip)` picks the material of each spanwise strip.
   */
  plate(
    chords: { le: Vec3; te: Vec3; t: number }[],
    normal: Vec3,
    mat: (strip: number) => Mat = () => 'skin',
    profile: readonly [chord: number, height: number][] = AIRFOIL,
  ) {
    const from = this.tris.length;
    const rings = chords.map(({ le, te, t }) => {
      const chord = sub(te, le);
      const len = Math.hypot(chord.x, chord.y, chord.z);
      return profile.map(([c, h]) =>
        this.vert(add(add(le, scale(chord, c)), scale(normal, (h * t * len) / 2))),
      );
    });
    const n = profile.length;
    for (let s = 0; s + 1 < rings.length; s++)
      for (let i = 0; i < n; i++) {
        const j = (i + 1) % n;
        this.tri(rings[s][i], rings[s][j], rings[s + 1][i], mat(s));
        this.tri(rings[s][j], rings[s + 1][j], rings[s + 1][i], mat(s));
      }
    // End caps. The root one keeps the open root from showing through above the fuselage.
    const tip = rings[rings.length - 1],
      root = rings[0];
    for (let i = 1; i + 1 < n; i++) {
      this.tri(tip[0], tip[i], tip[i + 1], mat(rings.length - 2));
      this.tri(root[0], root[i], root[i + 1], mat(0));
    }
    // Each strip of a panel is convex, the whole panel too (straight edges).
    this.orientConvex(from);
  }

  /**
   * Body of revolution along x: profile of (x, radius) from front to back, a radius of 0
   * closes the end. Centred at `c`, `sides` facets round.
   */
  revolve(
    c: Vec3,
    profile: [x: number, r: number, mat: Mat][],
    sides: number,
    phase = Math.PI / sides,
  ) {
    const rings = profile.map(([x, r]) => {
      if (r === 0) return new Array<number>(sides).fill(this.vert({ x: c.x + x, y: c.y, z: c.z }));
      return Array.from({ length: sides }, (_, i) => {
        const a = phase + (i / sides) * Math.PI * 2;
        return this.vert({ x: c.x + x, y: c.y + Math.cos(a) * r, z: c.z + Math.sin(a) * r });
      });
    });
    for (let s = 0; s + 1 < rings.length; s++) {
      const from = this.tris.length;
      for (let i = 0; i < sides; i++) {
        const j = (i + 1) % sides;
        const m = profile[s + 1][2];
        this.tri(rings[s][i], rings[s][j], rings[s + 1][i], m);
        this.tri(rings[s][j], rings[s + 1][j], rings[s + 1][i], m);
      }
      this.orientAxial(from, c);
    }
  }

  /** Flat end cap of a tube, facing `dir` (±1 along x). */
  disc(c: Vec3, r: number, sides: number, dir: 1 | -1, mat: Mat, phase = Math.PI / sides) {
    const centre = this.vert(c);
    const ring = Array.from({ length: sides }, (_, i) => {
      const a = phase + (i / sides) * Math.PI * 2;
      return this.vert({ x: c.x, y: c.y + Math.cos(a) * r, z: c.z + Math.sin(a) * r });
    });
    for (let i = 0; i < sides; i++) {
      const t0 = this.tris.length;
      this.tri(centre, ring[i], ring[(i + 1) % sides], mat);
      const t = this.tris[t0];
      if (t && t.n.x * dir < 0) {
        [t.b, t.c] = [t.c, t.b];
        t.n = scale(t.n, -1);
      }
    }
  }

  /** Box between two corners, axis aligned. */
  box(lo: Vec3, hi: Vec3, mat: Mat) {
    const from = this.tris.length;
    const v = [0, 1, 2, 3, 4, 5, 6, 7].map((i) =>
      this.vert({
        x: i & 1 ? hi.x : lo.x,
        y: i & 2 ? hi.y : lo.y,
        z: i & 4 ? hi.z : lo.z,
      }),
    );
    const faces = [
      [0, 1, 3, 2],
      [4, 5, 7, 6],
      [0, 1, 5, 4],
      [2, 3, 7, 6],
      [0, 2, 6, 4],
      [1, 3, 7, 5],
    ];
    for (const [a, b, c, d] of faces) {
      this.tri(v[a], v[b], v[c], mat);
      this.tri(v[a], v[c], v[d], mat);
    }
    this.orientConvex(from);
  }

  /** Wheel turning about the y axis: a short prism of `sides` facets, centred at `c`. */
  wheel(c: Vec3, r: number, width: number, sides: number, mat: Mat) {
    const from = this.tris.length;
    const ring = (y: number) =>
      Array.from({ length: sides }, (_, i) => {
        const a = ((i + 0.5) / sides) * Math.PI * 2;
        return this.vert({ x: c.x + Math.cos(a) * r, y, z: c.z + Math.sin(a) * r });
      });
    const l = ring(c.y - width / 2),
      rr = ring(c.y + width / 2);
    for (let i = 0; i < sides; i++) {
      const j = (i + 1) % sides;
      this.tri(l[i], l[j], rr[i], mat);
      this.tri(l[j], rr[j], rr[i], mat);
    }
    for (let i = 1; i + 1 < sides; i++) {
      this.tri(l[0], l[i], l[i + 1], mat);
      this.tri(rr[0], rr[i], rr[i + 1], mat);
    }
    this.orientConvex(from);
  }

  /**
   * Flat ring decal (a disc when r0 = 0) lying just above a surface, facing `up` (±z);
   * concentric rings make roundels.
   */
  ring(c: Vec3, r0: number, r1: number, sides: number, up: 1 | -1, mat: Mat) {
    const from = this.tris.length;
    const at = (r: number, i: number) => {
      const a = (i / sides) * Math.PI * 2;
      return this.vert({ x: c.x + Math.cos(a) * r, y: c.y + Math.sin(a) * r, z: c.z });
    };
    const centre = r0 > 0 ? undefined : this.vert(c);
    for (let i = 0; i < sides; i++) {
      const o0 = at(r1, i),
        o1 = at(r1, i + 1);
      if (centre !== undefined) this.tri(centre, o0, o1, mat);
      else {
        const i0 = at(r0, i),
          i1 = at(r0, i + 1);
        this.tri(i0, o0, o1, mat);
        this.tri(i0, o1, i1, mat);
      }
    }
    for (let i = from; i < this.tris.length; i++) {
      const t = this.tris[i];
      t.decal = true;
      if (t.n.z * up < 0) {
        [t.b, t.c] = [t.c, t.b];
        t.n = scale(t.n, -1);
      }
    }
  }

  /** Thin square rod between two points (probes, struts at an angle). */
  rod(a: Vec3, b: Vec3, r: number, mat: Mat) {
    const from = this.tris.length;
    const d = normalize(sub(b, a));
    const side = normalize(
      cross(d, Math.abs(d.z) < 0.9 ? { x: 0, y: 0, z: 1 } : { x: 0, y: 1, z: 0 }),
    );
    const up = cross(side, d);
    const corners = (p: Vec3) =>
      [
        [1, 1],
        [-1, 1],
        [-1, -1],
        [1, -1],
      ].map(([s, u]) => this.vert(add(p, add(scale(side, s * r), scale(up, u * r)))));
    const ra = corners(a),
      rb = corners(b);
    for (let i = 0; i < 4; i++) {
      const j = (i + 1) % 4;
      this.tri(ra[i], ra[j], rb[i], mat);
      this.tri(ra[j], rb[j], rb[i], mat);
    }
    this.tri(ra[0], ra[1], ra[2], mat);
    this.tri(ra[0], ra[2], ra[3], mat);
    this.tri(rb[0], rb[1], rb[2], mat);
    this.tri(rb[0], rb[2], rb[3], mat);
    this.orientConvex(from);
  }

  /** Thin flat quad visible from both sides (missile fins). */
  card(p: Vec3[], mat: Mat) {
    const [a, b, c, d] = p.map((q) => this.vert(q));
    this.tri(a, b, c, mat);
    this.tri(a, c, d, mat);
    this.tri(a, c, b, mat);
    this.tri(a, d, c, mat);
  }

  /** Faces of a body of revolution point away from its axis (x through `c`). */
  private orientAxial(from: number, c: Vec3) {
    for (let i = from; i < this.tris.length; i++) {
      const t = this.tris[i];
      const m = scale(add(add(this.verts[t.a], this.verts[t.b]), this.verts[t.c]), 1 / 3);
      const radial = { x: 0, y: m.y - c.y, z: m.z - c.z };
      if (dot(t.n, radial) < 0) {
        [t.b, t.c] = [t.c, t.b];
        t.n = scale(t.n, -1);
      }
    }
  }

  /**
   * Five-pointed star painted on a surface: flat triangles just above it, facing `up`
   * (±z). They are marked as decals so they sort in front of the larger facet below.
   */
  star(c: Vec3, r: number, up: 1 | -1, mat: Mat) {
    const from = this.tris.length;
    const centre = this.vert(c);
    const rim = Array.from({ length: 10 }, (_, i) => {
      const a = (i * Math.PI) / 5;
      const k = i % 2 ? r * 0.4 : r;
      return this.vert({ x: c.x + Math.cos(a) * k, y: c.y + Math.sin(a) * k, z: c.z });
    });
    for (let i = 0; i < 10; i++) this.tri(centre, rim[i], rim[(i + 1) % 10], mat);
    for (let i = from; i < this.tris.length; i++) {
      const t = this.tris[i];
      t.decal = true;
      if (t.n.z * up < 0) {
        [t.b, t.c] = [t.c, t.b];
        t.n = scale(t.n, -1);
      }
    }
  }

  /** Repaints the 'skin' triangles by their centre and normal (camouflage schemes). */
  paint(scheme: (c: Vec3, n: Vec3) => Mat) {
    for (const t of this.tris) {
      if (t.mat !== 'skin') continue;
      const c = scale(add(add(this.verts[t.a], this.verts[t.b]), this.verts[t.c]), 1 / 3);
      t.mat = scheme(c, t.n);
    }
  }

  build(): Mesh {
    return { verts: this.verts, tris: this.tris };
  }
}

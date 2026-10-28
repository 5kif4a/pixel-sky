import { integrity, type Aircraft, type ModuleState } from '../entities/aircraft';
import { aircraftMesh } from '../render/mesh';

/** Module state for the schematic: shape, colour and text all tell it apart. */
export type ModuleCondition = 'ok' | 'hurt' | 'crit' | 'dead' | 'fire';
export function condition(m: ModuleState): ModuleCondition {
  const k = integrity(m);
  return m.fire > 0 ? 'fire' : k <= 0 ? 'dead' : k < 0.4 ? 'crit' : k < 0.95 ? 'hurt' : 'ok';
}

const FILL: Record<ModuleCondition, string> = {
  ok: '#33525a',
  hurt: '#b99a3e',
  crit: '#c2503c',
  dead: '#1a2226',
  fire: '#ff7a2e',
};
const EDGE: Record<ModuleCondition, string> = {
  ok: '#7fa7a4',
  hurt: '#ffd27a',
  crit: '#ff8b74',
  dead: '#6d5e5a',
  fire: '#ffd0a0',
};

/** Modules drawn as airframe parts; the rest are drawn as discs at their positions. */
const PART_KINDS = new Set(['airframe', 'wing', 'tail', 'pilot']);

/**
 * Top view of the player's aircraft, nose up, built from its silhouette: fuselage, wings,
 * tail and canopy take the state of their modules, the other modules are discs where they
 * sit. The translucent outline comes from the actual aircraft mesh. Destroyed modules
 * are crossed out, burning ones get a dashed flickering edge.
 */
export class DamageSchematic {
  private planform?: {
    id: string;
    w: number;
    h: number;
    s: number;
    uMid: number;
    path: Path2D;
    mask: HTMLCanvasElement;
    edge: HTMLCanvasElement;
  };
  constructor(private canvas: HTMLCanvasElement) {}

  /** Use the actual model's top projection, omitting stores, pylons and landing gear. */
  private shape(a: Aircraft, w: number, h: number, dpr: number) {
    if (this.planform?.id === a.spec.id && this.planform.w === w && this.planform.h === h)
      return this.planform;
    const mesh = aircraftMesh(a.spec.id);
    const tris = mesh.tris.filter(
      (t) => !t.store && !t.gear && !t.under && !t.decal && t.n.z > 0.001,
    );
    const points = tris.flatMap((t) => [mesh.verts[t.a], mesh.verts[t.b], mesh.verts[t.c]]);
    const minU = Math.min(...points.map((p) => p.x)),
      maxU = Math.max(...points.map((p) => p.x));
    const minV = Math.min(...points.map((p) => p.y)),
      maxV = Math.max(...points.map((p) => p.y));
    const s = Math.min((h * 0.92) / (maxU - minU), (w * 0.92) / (maxV - minV));
    const uMid = (minU + maxU) / 2;
    const path = new Path2D();
    for (const t of tris) {
      [t.a, t.b, t.c].forEach((i, j) => {
        const p = mesh.verts[i],
          x = w / 2 + p.y * s,
          y = h / 2 - (p.x - uMid) * s;
        if (j === 0) path.moveTo(x, y);
        else path.lineTo(x, y);
      });
      path.closePath();
    }
    const mask = document.createElement('canvas'),
      edge = document.createElement('canvas');
    mask.width = edge.width = w;
    mask.height = edge.height = h;
    const maskCtx = mask.getContext('2d')!,
      edgeCtx = edge.getContext('2d')!;
    maskCtx.fillStyle = '#e8f5ff';
    maskCtx.fill(path);
    const r = Math.max(1, dpr);
    for (const [dx, dy] of [
      [-r, 0],
      [r, 0],
      [0, -r],
      [0, r],
    ])
      edgeCtx.drawImage(mask, dx, dy);
    edgeCtx.globalCompositeOperation = 'destination-out';
    edgeCtx.drawImage(mask, 0, 0);
    this.planform = { id: a.spec.id, w, h, s, uMid, path, mask, edge };
    return this.planform;
  }

  draw(a: Aircraft, time: number) {
    const c = this.canvas;
    const dpr = window.devicePixelRatio || 1;
    const w = Math.round(c.clientWidth * dpr),
      h = Math.round(c.clientHeight * dpr);
    if (!w || !h) return;
    if (c.width !== w || c.height !== h) {
      c.width = w;
      c.height = h;
    }
    const ctx = c.getContext('2d')!;
    ctx.clearRect(0, 0, w, h);
    const sil = a.spec.silhouette;
    // Tailless deltas (Mirage) have no stabiliser outline.
    const tailplane = sil.tailplane ?? [];
    const shape = this.shape(a, w, h, dpr);
    const { s, uMid } = shape;
    ctx.globalAlpha = 0.2;
    ctx.drawImage(shape.mask, 0, 0);
    ctx.globalAlpha = 0.8;
    ctx.drawImage(shape.edge, 0, 0);
    ctx.globalAlpha = 1;
    ctx.save();
    ctx.clip(shape.path);
    const at = (u: number, v: number) => ({ x: w / 2 + v * s, y: h / 2 - (u - uMid) * s });
    const byId = (id: string) => a.modules.find((m) => m.spec.id === id);
    const byKind = (kind: string) => a.modules.filter((m) => m.spec.kind === kind);
    const worst = (ms: (ModuleState | undefined)[]) => {
      const order: ModuleCondition[] = ['ok', 'hurt', 'crit', 'dead', 'fire'];
      return ms.reduce<ModuleCondition>((acc, m) => {
        const k = m ? condition(m) : 'ok';
        return order.indexOf(k) > order.indexOf(acc) ? k : acc;
      }, 'ok');
    };

    const style = (state: ModuleCondition) => {
      ctx.globalAlpha = state === 'ok' ? 0.2 : 0.7;
      ctx.fillStyle = FILL[state];
      ctx.strokeStyle = EDGE[state];
      ctx.lineWidth = 1.5 * dpr;
      ctx.setLineDash(state === 'fire' ? [4 * dpr, 3 * dpr] : []);
      ctx.lineDashOffset = state === 'fire' ? -time * 30 * dpr : 0;
      if (state === 'fire') ctx.fillStyle = Math.sin(time * 14) > 0 ? '#ff7a2e' : '#d9461c';
    };
    const polygon = (coords: number[], mirrorV: boolean, state: ModuleCondition) => {
      if (state === 'ok') return coords;
      ctx.beginPath();
      for (let i = 0; i < coords.length; i += 2) {
        const p = at(coords[i], mirrorV ? -coords[i + 1] : coords[i + 1]);
        if (i) ctx.lineTo(p.x, p.y);
        else ctx.moveTo(p.x, p.y);
      }
      ctx.closePath();
      style(state);
      ctx.fill();
      ctx.stroke();
      return coords;
    };
    const cross = (u: number, v: number, r: number) => {
      const p = at(u, v);
      const k = r * s * 0.6;
      ctx.setLineDash([]);
      ctx.strokeStyle = '#ff8b74';
      ctx.lineWidth = 2 * dpr;
      ctx.beginPath();
      ctx.moveTo(p.x - k, p.y - k);
      ctx.lineTo(p.x + k, p.y + k);
      ctx.moveTo(p.x + k, p.y - k);
      ctx.lineTo(p.x - k, p.y + k);
      ctx.stroke();
    };
    const centroid = (coords: number[], mirrorV: boolean) => {
      let u = 0,
        v = 0;
      for (let i = 0; i < coords.length; i += 2) {
        u += coords[i];
        v += mirrorV ? -coords[i + 1] : coords[i + 1];
      }
      const n = coords.length / 2;
      return { u: u / n, v: v / n };
    };

    // Wings and stabilisers under the fuselage, then the fuselage, fins and canopy.
    const tail = worst(byKind('tail'));
    for (const [mirrorV, id] of [
      [false, 'wing-l'],
      [true, 'wing-r'],
    ] as const) {
      const state = worst([byId(id)]);
      polygon(sil.wing, mirrorV, state);
      if (state === 'dead') {
        const c0 = centroid(sil.wing, mirrorV);
        cross(c0.u, c0.v, 1.6);
      }
    }
    if (tailplane.length) {
      polygon(tailplane, false, tail);
      polygon(tailplane, true, tail);
    }
    const airframe = worst(byKind('airframe'));
    polygon(sil.fuselage, false, airframe);
    for (const f of sil.fins) {
      // Fins seen from above: a thin strip along the fin root.
      const fu = f.profile.filter((_, i) => i % 2 === 0);
      const u0 = Math.max(...fu),
        u1 = Math.min(...fu);
      polygon(
        [u0, f.right - 0.12, u1, f.right - 0.12, u1, f.right + 0.12, u0, f.right + 0.12],
        false,
        tail,
      );
    }
    polygon(sil.canopy, false, worst(byKind('pilot')));
    if (tail === 'dead') cross(Math.min(...sil.fins.map((f) => f.profile[6])), 0, 1.4);

    // Internal modules are translucent compartments within the exact airframe mask.
    for (const m of a.modules) {
      if (PART_KINDS.has(m.spec.kind)) continue;
      const state = condition(m);
      if (state === 'ok') continue;
      const positions = m.spec.kind === 'gun' ? a.spec.gunMuzzles : [m.spec.pos];
      for (const position of positions) {
        const p = at(position[0], position[1]);
        ctx.beginPath();
        const rx = Math.max(2 * dpr, m.spec.radius * s * 0.65);
        const ry = rx * (m.spec.kind === 'engine' ? 2.8 : 1.3);
        ctx.roundRect(p.x - rx, p.y - ry, rx * 2, ry * 2, Math.min(rx, 3 * dpr));
        style(state);
        ctx.fill();
        ctx.stroke();
        if (state === 'dead') cross(position[0], position[1], m.spec.radius * 0.7);
      }
    }
    ctx.setLineDash([]);
    ctx.restore();
    ctx.globalAlpha = 1;
  }
}

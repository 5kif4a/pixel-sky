import mig35Url from '../assets/mikoyan--gurevich-mig-35-fulcrum-f-2.png';
import f16Url from '../assets/f16c50-1.gif';
import mirageUrl from '../assets/dassault-mirage-2000.gif';
import type { AircraftId } from '../data/aircraft';
import { aircraftMesh, meshColor, projectMesh } from '../render/mesh';
import { shade } from '../render/draw';
import { normalize, type Vec3 } from '../world/math';

/**
 * Dev page (model-preview.html?id=F-16): a low-poly mesh in top, side and front views over
 * its three-view drawing, plus an isometric view. Each view maps body metres to drawing
 * pixels, calibrated on the radome tip, the nozzles and the span.
 */
interface View {
  title: string;
  /** Body point → drawing pixel. */
  map: (p: Vec3) => { x: number; y: number };
  /** Towards the viewer, body axes. */
  toViewer: Vec3;
  /** Drawing region shown: x, y, width, height in drawing pixels. */
  crop: [number, number, number, number];
}

// F-16 top view is drawn at 45°: body axes along the drawing's diagonal from the nozzle.
const F16_TAIL = { x: 267, y: 1160 },
  F16_K = 0.0133;
const F16_U = { x: 0.7058, y: -0.7084 },
  F16_V = { x: 0.7084, y: 0.7058 };

const BLUEPRINTS: Partial<Record<AircraftId, { url: string; zoom: number; views: View[] }>> = {
  'MiG-35': {
    url: mig35Url,
    zoom: 4,
    views: [
      {
        // Lower plan view of the drawing, nose to the left.
        title: 'TOP',
        map: (p) => ({ x: 30 + (9 - p.x) / 0.0513, y: 307.5 - p.y / 0.0513 }),
        toViewer: { x: 0, y: 0, z: 1 },
        crop: [0, 185, 353, 245],
      },
      {
        // Bottom of the drawing, nose to the right, seen from the left.
        title: 'SIDE',
        map: (p) => ({ x: 325 - (9 - p.x) / 0.0519, y: 462 - p.z / 0.0519 }),
        toViewer: { x: 0, y: -1, z: 0 },
        crop: [0, 395, 353, 94],
      },
      {
        title: 'FRONT',
        map: (p) => ({ x: 240 - p.y / 0.0516, y: 132.5 - p.z / 0.0516 }),
        toViewer: { x: 1, y: 0, z: 0 },
        crop: [120, 70, 240, 90],
      },
    ],
  },
  'F-16': {
    url: f16Url,
    zoom: 1,
    views: [
      {
        title: 'TOP',
        map: (p) => {
          const along = (p.x + 6.72) / F16_K,
            across = p.y / F16_K;
          return {
            x: F16_TAIL.x + F16_U.x * along + F16_V.x * across,
            y: F16_TAIL.y + F16_U.y * along + F16_V.y * across,
          };
        },
        toViewer: { x: 0, y: 0, z: 1 },
        crop: [100, 360, 1000, 860],
      },
      {
        // Nose to the left: seen from the right.
        title: 'SIDE',
        map: (p) => ({ x: 73 + (7.8 - p.x) / 0.01357, y: 1500 - p.z / 0.01357 }),
        toViewer: { x: 0, y: 1, z: 0 },
        crop: [0, 1220, 1200, 420],
      },
      {
        title: 'FRONT',
        map: (p) => ({ x: 603 - p.y / 0.01376, y: 262 - p.z / 0.01376 }),
        toViewer: { x: 1, y: 0, z: 0 },
        crop: [220, 0, 780, 420],
      },
    ],
  },
};

BLUEPRINTS['Mirage 2000'] = {
  url: mirageUrl,
  zoom: 0.7,
  views: [
    {
      // Plan view drawn at its own scale (span 9.13 m), nose to the left.
      title: 'TOP',
      map: (p) => ({ x: 435 + (7.6 - p.x) / 0.00918, y: 1097 - p.y / 0.00918 }),
      toViewer: { x: 0, y: 0, z: 1 },
      crop: [400, 560, 1650, 1080],
    },
    {
      // Upper side view, nose to the left: seen from the right.
      title: 'SIDE',
      map: (p) => ({ x: 45 + (7.6 - p.x) / 0.0084, y: 455 - p.z / 0.0084 }),
      toViewer: { x: 0, y: 1, z: 0 },
      crop: [0, 60, 1800, 540],
    },
    {
      title: 'FRONT',
      map: (p) => ({ x: 1300 - p.y / 0.00861, y: 2300 - (p.z + 0.39) / 0.00861 }),
      toViewer: { x: 1, y: 0, z: 0 },
      crop: [700, 1950, 1200, 620],
    },
  ],
};

const id = (new URLSearchParams(location.search).get('id') ?? 'MiG-35') as AircraftId;
const blueprint = BLUEPRINTS[id] ?? BLUEPRINTS['MiG-35']!;
const VIEWS = blueprint.views;
const ZOOM = blueprint.zoom;
const axes = {
  forward: { x: 1, y: 0, z: 0 },
  right: { x: 0, y: 1, z: 0 },
  up: { x: 0, y: 0, z: 1 },
};
const LIGHT = normalize({ x: 0.4, y: -0.5, z: 0.8 });

const mesh = aircraftMesh(id)!;
const img = new Image();
img.src = blueprint.url;
const root = document.getElementById('views')!;
const opacity = document.getElementById('opacity') as HTMLInputElement;
const wire = document.getElementById('wire') as HTMLInputElement;
document.getElementById('count')!.textContent = `${mesh.tris.length} triangles`;

function fill(
  ctx: CanvasRenderingContext2D,
  tris: { pts: { x: number; y: number }[]; color: number }[],
) {
  for (const t of tris) {
    ctx.fillStyle = '#' + t.color.toString(16).padStart(6, '0');
    ctx.beginPath();
    ctx.moveTo(t.pts[0].x, t.pts[0].y);
    ctx.lineTo(t.pts[1].x, t.pts[1].y);
    ctx.lineTo(t.pts[2].x, t.pts[2].y);
    ctx.closePath();
    ctx.fill();
    if (wire.checked) {
      ctx.strokeStyle = 'rgba(255,60,40,0.7)';
      ctx.lineWidth = 0.5;
      ctx.stroke();
    }
  }
}

function render() {
  root.innerHTML = '';
  const alpha = Number(opacity.value) / 100;
  for (const v of VIEWS) {
    const [cx, cy, cw, ch] = v.crop;
    const canvas = document.createElement('canvas');
    canvas.width = cw * ZOOM;
    canvas.height = ch * ZOOM;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(img, cx, cy, cw, ch, 0, 0, canvas.width, canvas.height);
    const tris = projectMesh(
      mesh,
      axes,
      (p) => {
        const q = v.map(p);
        return { x: (q.x - cx) * ZOOM, y: (q.y - cy) * ZOOM };
      },
      v.toViewer,
      LIGHT,
      (t, k) => shade(meshColor(mesh, t.mat, 'blue'), k),
    );
    ctx.globalAlpha = alpha;
    fill(ctx, tris);
    ctx.globalAlpha = 1;
    const box = document.createElement('figure');
    box.innerHTML = `<figcaption>${v.title}</figcaption>`;
    box.appendChild(canvas);
    root.appendChild(box);
  }
  // Isometric view as in battle (camera from +x +y +z), larger scale.
  const iso = document.createElement('canvas');
  iso.width = 900;
  iso.height = 600;
  const ctx = iso.getContext('2d')!;
  ctx.fillStyle = '#2a2e31';
  ctx.fillRect(0, 0, iso.width, iso.height);
  const k = 34;
  const tris = projectMesh(
    mesh,
    { forward: { x: 1, y: -0.35, z: 0 }, right: { x: 0.35, y: 1, z: 0 }, up: { x: 0, y: 0, z: 1 } },
    (d) => ({ x: 450 + (d.x - d.y) * k, y: 300 + ((d.x + d.y) * 0.5 - d.z) * k }),
    normalize({ x: 1, y: 1, z: 1 }),
    normalize({ x: -0.6, y: -0.25, z: 0.9 }),
    (t, l) => shade(meshColor(mesh, t.mat, 'blue'), l),
  );
  fill(ctx, tris);
  const box = document.createElement('figure');
  box.innerHTML = '<figcaption>ISO</figcaption>';
  box.appendChild(iso);
  root.appendChild(box);
}

img.onload = render;
opacity.oninput = render;
wire.onchange = render;

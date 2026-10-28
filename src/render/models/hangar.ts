import { MeshBuilder, type Mesh } from '../meshBuilder';

/**
 * Menu scene hangar, world metres (z up): 30 m deep, 44 m wide, 11 m walls under a shallow
 * arched roof, the open door facing +x, about 33 m behind the parked aircraft's tail so the
 * aircraft can be seen from behind. The front wall face is at x = `front`.
 */
export const HANGAR = { front: -40, depth: 30, halfWidth: 22, wall: 11, rise: 4 };

export function buildHangar(): Mesh {
  const b = new MeshBuilder();
  const { front, depth, halfWidth: hw, wall, rise } = HANGAR;
  const back = front - depth;
  // Shell: walls as one box, the roof arch and gables on top.
  b.box({ x: back, y: -hw, z: 0 }, { x: front, y: hw, z: wall }, 'wall');
  const n = 8;
  const arch = Array.from({ length: n + 1 }, (_, i) => ({
    y: -hw + (2 * hw * i) / n,
    z: wall + rise * Math.sin((Math.PI * i) / n),
  }));
  const from = b.tris.length;
  for (let i = 0; i < n; i++) {
    const [p, q] = [arch[i], arch[i + 1]];
    const v = [
      b.vert({ x: back, y: p.y, z: p.z }),
      b.vert({ x: front, y: p.y, z: p.z }),
      b.vert({ x: front, y: q.y, z: q.z }),
      b.vert({ x: back, y: q.y, z: q.z }),
    ];
    b.tri(v[0], v[1], v[2], 'roof');
    b.tri(v[0], v[2], v[3], 'roof');
  }
  for (const x of [front, back]) {
    const c = b.vert({ x, y: 0, z: wall });
    for (let i = 0; i < n; i++)
      b.tri(
        c,
        b.vert({ x, y: arch[i].y, z: arch[i].z }),
        b.vert({ x, y: arch[i + 1].y, z: arch[i + 1].z }),
        'wall',
      );
  }
  // The roof and gables are one convex shape: orient them away from its centre.
  b.orientConvex(from);
  // Open door: a dark opening just in front of the wall, framed by piers and a lintel.
  const door = { half: 17, height: 9.5 };
  b.box(
    { x: front, y: -door.half, z: 0 },
    { x: front + 0.05, y: door.half, z: door.height },
    'doorway',
  );
  b.box({ x: front, y: -hw, z: 0 }, { x: front + 0.6, y: -door.half, z: wall }, 'wall');
  b.box({ x: front, y: door.half, z: 0 }, { x: front + 0.6, y: hw, z: wall }, 'wall');
  b.box(
    { x: front, y: -door.half, z: door.height },
    { x: front + 0.6, y: door.half, z: wall },
    'roof',
  );
  return b.build();
}

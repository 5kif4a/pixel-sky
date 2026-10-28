import { AIRFIELDS, MAP_SIZE } from '../data/mission';
import type { Battle } from '../systems/battle';
import { groundColor } from '../render/terrainRenderer';
import { terrainHeight } from '../world/terrain';

/** Map resolution, px; symbols are sized for it. */
const SIZE = 320;

/** 40×40 km sector map: terrain image rendered once, contacts drawn each update. */
export class Minimap {
  private background: HTMLCanvasElement;
  constructor(private canvas: HTMLCanvasElement) {
    this.background = document.createElement('canvas');
    this.background.width = this.background.height = SIZE;
    const ctx = this.background.getContext('2d')!;
    const img = ctx.createImageData(SIZE, SIZE);
    const step = MAP_SIZE / SIZE;
    for (let j = 0; j < SIZE; j++)
      for (let i = 0; i < SIZE; i++) {
        const x = (i + 0.5) * step,
          y = (j + 0.5) * step;
        const h = terrainHeight(x, y);
        const slope = Math.abs(terrainHeight(x + step, y) - h) / step;
        let c = groundColor(x, y, h, slope * 3);
        if (h > 0) {
          const shadeK = 0.8 + Math.min(0.3, (h - terrainHeight(x - step, y - step)) / 400);
          c =
            (Math.min(255, ((c >> 16) & 255) * shadeK) << 16) |
            (Math.min(255, ((c >> 8) & 255) * shadeK) << 8) |
            Math.min(255, (c & 255) * shadeK);
        }
        const o = (j * SIZE + i) * 4;
        img.data[o] = (c >> 16) & 255;
        img.data[o + 1] = (c >> 8) & 255;
        img.data[o + 2] = c & 255;
        img.data[o + 3] = 255;
      }
    ctx.putImageData(img, 0, 0);
  }

  draw(b: Battle) {
    const ctx = this.canvas.getContext('2d')!;
    const k = SIZE / MAP_SIZE;
    /** Symbol scale: they were drawn for a 200 px map. */
    const u = SIZE / 200;
    ctx.drawImage(this.background, 0, 0);
    // 5 km grid.
    ctx.strokeStyle = '#ffffff22';
    ctx.lineWidth = 1;
    const cell = 5000 * k;
    for (let i = 1; i * cell < SIZE; i++) {
      ctx.beginPath();
      ctx.moveTo(i * cell, 0);
      ctx.lineTo(i * cell, SIZE);
      ctx.moveTo(0, i * cell);
      ctx.lineTo(SIZE, i * cell);
      ctx.stroke();
    }
    for (const a of Object.values(AIRFIELDS)) {
      ctx.strokeStyle = a.side === 'blue' ? '#9de2d0' : '#ff8e74';
      ctx.lineWidth = 1.5 * u;
      ctx.beginPath();
      ctx.arc(a.x * k, a.y * k, 5 * u, 0, Math.PI * 2);
      ctx.stroke();
    }
    // Detected enemies with a short course line.
    for (const e of b.detected()) {
      const x = e.pos.x * k,
        y = e.pos.y * k;
      ctx.strokeStyle = ctx.fillStyle = e === b.selected ? '#ffd27a' : '#ff9a80';
      ctx.lineWidth = u;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + Math.cos(e.heading) * 9 * u, y + Math.sin(e.heading) * 9 * u);
      ctx.stroke();
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(Math.PI / 4);
      ctx.fillRect(-2.5 * u, -2.5 * u, 5 * u, 5 * u);
      ctx.restore();
    }
    // Missiles fired at the player.
    ctx.fillStyle = '#ff5a40';
    for (const m of b.missiles)
      if (m.alive && m.target === b.player)
        ctx.fillRect(m.pos.x * k - 1.5 * u, m.pos.y * k - 1.5 * u, 3 * u, 3 * u);
    const p = b.player;
    ctx.save();
    ctx.translate(p.pos.x * k, p.pos.y * k);
    ctx.rotate(p.heading);
    ctx.scale(u, u);
    ctx.fillStyle = p.alive ? '#d9f879' : '#777';
    ctx.beginPath();
    ctx.moveTo(6, 0);
    ctx.lineTo(-4, -4);
    ctx.lineTo(-2, 0);
    ctx.lineTo(-4, 4);
    ctx.fill();
    ctx.restore();
  }
}

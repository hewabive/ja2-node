// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-15. See LICENSE (SFI-SCLA).
// @src src/game/TileEngine/Radar_Screen.cc RenderRadarScreen, RadarRegionButtonCallback; RenderWorld.cc InitRenderParams

import { rgb565ToRgba } from '../../content/formats/rgb565.ts';
import { decodeSti } from '../../content/formats/sti.ts';
import type { SceneOptions } from '../../render/world/scene.ts';
import { fetchFile } from '../asset-browser/api.ts';

const RADAR_WIDTH = 88;
const RADAR_HEIGHT = 44;
const LEFT_X = -1580;
const RIGHT_X = 1600;
const TOP_Y = 860;
const BOTTOM_Y = 2400;
const SCALE_X = RADAR_WIDTH / (RIGHT_X - LEFT_X);
const SCALE_Y = RADAR_HEIGHT / (BOTTOM_Y - TOP_Y);

export function radarPathForMap(mapPath: string): string {
  return mapPath.replace(/(^|\/)maps\/([^/]+)\.dat$/, '$1radarmaps/$2.sti');
}

export class Radar {
  readonly #canvas: HTMLCanvasElement;
  readonly #ctx: CanvasRenderingContext2D;
  #image: ImageData | null = null;

  constructor(canvas: HTMLCanvasElement, onCenter: (cellX: number, cellY: number) => void) {
    this.#canvas = canvas;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('2D canvas is not available');
    this.#ctx = ctx;
    canvas.addEventListener('click', (e) => {
      const rect = canvas.getBoundingClientRect();
      const ax = (((e.clientX - rect.left) / rect.width) * RADAR_WIDTH) / SCALE_X + LEFT_X;
      const ay = (((e.clientY - rect.top) / rect.height) * RADAR_HEIGHT) / SCALE_Y + TOP_Y;
      const cellX = Math.round((ax / 2 + ay) / 2);
      const cellY = Math.round((ay - ax / 2) / 2);
      onCenter(Math.floor(cellX / 10) * 10 + 5, Math.floor(cellY / 10) * 10 + 5);
    });
  }

  async load(mapPath: string, available: ReadonlySet<string>): Promise<void> {
    const path = radarPathForMap(mapPath);
    this.#image = null;
    this.#canvas.hidden = true;
    if (!available.has(path)) return;
    const sti = decodeSti(await fetchFile(path));
    const rgba = new Uint8ClampedArray(RADAR_WIDTH * RADAR_HEIGHT * 4);
    if (sti.kind === 'rgb') {
      rgba.set(rgb565ToRgba(sti.pixels).subarray(0, rgba.length));
    } else {
      const frame = sti.subImages[0];
      if (!frame) return;
      for (let y = 0; y < Math.min(frame.height, RADAR_HEIGHT); y++) {
        for (let x = 0; x < Math.min(frame.width, RADAR_WIDTH); x++) {
          const index = frame.pixels[y * frame.width + x] ?? 0;
          rgba.set(
            [sti.palette[index * 3] ?? 0, sti.palette[index * 3 + 1] ?? 0, sti.palette[index * 3 + 2] ?? 0, 255],
            (y * RADAR_WIDTH + x) * 4,
          );
        }
      }
    }
    this.#image = new ImageData(rgba, RADAR_WIDTH, RADAR_HEIGHT);
    this.#canvas.hidden = false;
  }

  drawViewport(o: SceneOptions): void {
    if (!this.#image) return;
    const ctx = this.#ctx;
    ctx.putImageData(this.#image, 0, 0);
    const { centerX, centerY } = o.camera;
    const screenX = 2 * (centerX - centerY);
    const screenY = centerX + centerY - 10;
    const topLeftX = screenX - Math.floor(o.width / 2) - LEFT_X;
    const topLeftY = screenY - Math.floor(o.height / 2) - TOP_Y;
    const bottomRightX = screenX + Math.floor(o.width / 2) - LEFT_X;
    const bottomRightY = screenY + Math.floor(o.height / 2) - TOP_Y;
    const x1 = Math.max(0, Math.round((topLeftX + 30) * SCALE_X));
    const y1 = Math.max(0, Math.round((topLeftY + 50) * SCALE_Y));
    const x2 = Math.min(Math.round((bottomRightX + 20) * SCALE_X - 1), RADAR_WIDTH - 1);
    const y2 = Math.min(Math.round((bottomRightY + 70) * SCALE_Y - 1), RADAR_HEIGHT - 1);
    ctx.strokeStyle = 'rgb(0, 255, 0)';
    ctx.lineWidth = 1;
    ctx.strokeRect(x1 + 0.5, y1 + 0.5, Math.max(0, x2 - x1), Math.max(0, y2 - y1));
  }
}

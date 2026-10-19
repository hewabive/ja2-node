import { loadRadarPixels, RADAR_HEIGHT, RADAR_WIDTH, radarCellAt, radarViewportBox } from '../../app/world/radar.ts';
import type { Camera, Viewport } from '../../render/world/geometry.ts';

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
      const { cellX, cellY } = radarCellAt((e.clientX - rect.left) / rect.width, (e.clientY - rect.top) / rect.height);
      onCenter(cellX, cellY);
    });
  }

  async load(mapPath: string, available: ReadonlySet<string>): Promise<void> {
    this.#image = null;
    this.#canvas.hidden = true;
    const pixels = await loadRadarPixels(mapPath, available);
    if (!pixels) return;
    this.#image = new ImageData(pixels, RADAR_WIDTH, RADAR_HEIGHT);
    this.#canvas.hidden = false;
  }

  drawViewport(o: Viewport & { readonly camera: Camera }): void {
    if (!this.#image) return;
    const ctx = this.#ctx;
    ctx.putImageData(this.#image, 0, 0);
    const { x1, y1, x2, y2 } = radarViewportBox(o);
    ctx.strokeStyle = 'rgb(0, 255, 0)';
    ctx.lineWidth = 1;
    ctx.strokeRect(x1 + 0.5, y1 + 0.5, Math.max(0, x2 - x1), Math.max(0, y2 - y1));
  }
}

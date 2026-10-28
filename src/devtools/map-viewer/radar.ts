import { loadRadarPixels, RADAR_HEIGHT, RADAR_WIDTH, radarRenderCenter, radarViewportBox } from '../../app/world/radar.ts';
import { RestrictedScroll } from '../../content/world/render-bounds.ts';
import type { Camera, Viewport } from '../../render/world/geometry.ts';

export class Radar {
  readonly #canvas: HTMLCanvasElement;
  readonly #ctx: CanvasRenderingContext2D;
  #image: ImageData | null = null;
  #restrictedScrollId: number = RestrictedScroll.NONE;

  constructor(canvas: HTMLCanvasElement, viewport: () => Viewport, onCenter: (target: Camera) => void) {
    this.#canvas = canvas;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('2D canvas is not available');
    this.#ctx = ctx;
    canvas.addEventListener('click', (e) => {
      const rect = canvas.getBoundingClientRect();
      const x = Math.floor(((e.clientX - rect.left) / rect.width) * RADAR_WIDTH);
      const y = Math.floor(((e.clientY - rect.top) / rect.height) * RADAR_HEIGHT);
      onCenter(radarRenderCenter(this.#restrictedScrollId, x, y, viewport()));
    });
  }

  async load(mapPath: string, available: ReadonlySet<string>, restrictedScrollId: number): Promise<void> {
    this.#image = null;
    this.#canvas.hidden = true;
    this.#restrictedScrollId = restrictedScrollId;
    const pixels = await loadRadarPixels(mapPath, available);
    if (!pixels) return;
    this.#image = new ImageData(pixels, RADAR_WIDTH, RADAR_HEIGHT);
    this.#canvas.hidden = false;
  }

  drawViewport(o: Viewport & { readonly camera: Camera }): void {
    if (!this.#image) return;
    const ctx = this.#ctx;
    ctx.putImageData(this.#image, 0, 0);
    const { x1, y1, x2, y2 } = radarViewportBox(this.#restrictedScrollId, o);
    ctx.strokeStyle = 'rgb(0, 255, 0)';
    ctx.lineWidth = 1;
    ctx.strokeRect(x1 + 0.5, y1 + 0.5, Math.max(0, x2 - x1), Math.max(0, y2 - y1));
  }
}

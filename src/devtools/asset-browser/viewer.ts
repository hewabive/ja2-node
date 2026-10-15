import { framesBounds, type Picture } from '../../content/picture/picture.ts';
import { type AtlasRegion, TextureAtlas } from '../../render/atlas.ts';
import { createContext } from '../../render/gl.ts';
import { PaletteTexture } from '../../render/palettes.ts';
import { SpriteRenderer } from '../../render/sprite-renderer.ts';

export type ViewMode = 'grid' | 'anim';

export interface ViewState {
  mode: ViewMode;
  zoom: number;
  playing: boolean;
  fps: number;
  groupSize: number;
  group: number;
}

const GAP = 6;
const ANCHOR_AT_CSS_CROSSHAIR = { x: 0.5, y: 0.6 };

interface Cell {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

export class PictureViewer {
  readonly state: ViewState = { mode: 'grid', zoom: 2, playing: false, fps: 10, groupSize: 1, group: 0 };
  onFrameChange: ((index: number | null) => void) | null = null;
  onRender: ((quads: number) => void) | null = null;

  readonly #canvas: HTMLCanvasElement;
  readonly #stage: HTMLElement;
  readonly #renderer: SpriteRenderer;
  readonly #indexAtlas: TextureAtlas;
  readonly #rgbaAtlas: TextureAtlas;
  readonly #palettes: PaletteTexture;
  #picture: Picture | null = null;
  #regions: AtlasRegion[] = [];
  #cells: Cell[] = [];
  #gridOrigin: { x: number; y: number } | null = null;
  #tick = 0;
  #raf = 0;
  #last = 0;
  #acc = 0;

  constructor(canvas: HTMLCanvasElement, stage: HTMLElement) {
    this.#canvas = canvas;
    this.#stage = stage;
    const gl = createContext(canvas, { preserveDrawingBuffer: true });
    this.#renderer = new SpriteRenderer(gl);
    this.#indexAtlas = new TextureAtlas(gl, 'index');
    this.#rgbaAtlas = new TextureAtlas(gl, 'rgba');
    this.#palettes = new PaletteTexture(gl, 4);
    new ResizeObserver(() => this.render()).observe(stage);
  }

  get frameCount(): number {
    const p = this.#picture;
    return p ? (p.kind === 'indexed' ? p.frames.length : 1) : 0;
  }

  show(picture: Picture | null): void {
    this.#indexAtlas.clear();
    this.#rgbaAtlas.clear();
    this.#palettes.clear();
    this.#picture = picture;
    this.#regions = [];
    this.#tick = 0;
    if (picture?.kind === 'indexed') {
      this.#palettes.add(picture.palette);
      this.#regions = picture.frames.map((f) => this.#indexAtlas.add(f.width, f.height, f.pixels));
    } else if (picture?.kind === 'rgba') {
      this.#regions = [this.#rgbaAtlas.add(picture.width, picture.height, picture.pixels)];
    }
    this.render();
  }

  update(patch: Partial<ViewState>): void {
    Object.assign(this.state, patch);
    this.state.groupSize = Math.max(1, Math.floor(this.state.groupSize));
    this.state.group = Math.max(0, Math.min(Math.floor(this.state.group), Math.ceil(this.frameCount / this.state.groupSize) - 1));
    if (this.state.playing && this.state.mode === 'anim' && !this.#raf) {
      this.#last = performance.now();
      this.#raf = requestAnimationFrame(this.#loop);
    }
    this.render();
  }

  step(): void {
    this.#tick++;
    this.render();
  }

  hitTest(clientX: number, clientY: number): number | null {
    if (this.state.mode !== 'grid') return this.currentAnimFrame();
    const rect = this.#canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    const x = (clientX - rect.left) * dpr;
    const y = (clientY - rect.top) * dpr;
    const i = this.#cells.findIndex((c) => x >= c.x && y >= c.y && x < c.x + c.w && y < c.y + c.h);
    return i >= 0 ? i : null;
  }

  currentAnimFrame(): number | null {
    if (!this.#picture) return null;
    const { groupSize, group } = this.state;
    const i = group * groupSize + (this.#tick % groupSize);
    return i < this.frameCount ? i : null;
  }

  readonly #loop = (now: number): void => {
    if (!this.state.playing || this.state.mode !== 'anim') {
      this.#raf = 0;
      return;
    }
    this.#acc += now - this.#last;
    this.#last = now;
    const period = 1000 / Math.max(1, this.state.fps);
    if (this.#acc >= period) {
      this.#tick += Math.floor(this.#acc / period);
      this.#acc %= period;
      this.render();
    }
    this.#raf = requestAnimationFrame(this.#loop);
  };

  #layoutGrid(widthPx: number): { cells: Cell[]; height: number } {
    const p = this.#picture;
    if (!p) return { cells: [], height: 0 };
    const z = this.state.zoom;
    if (p.kind === 'rgba') return { cells: [{ x: GAP, y: GAP, w: p.width * z, h: p.height * z }], height: p.height * z + GAP * 2 };
    const b = framesBounds(p.frames);
    const cellW = b.maxX - b.minX;
    const cellH = b.maxY - b.minY;
    const maxW = Math.max(...p.frames.map((f) => f.width));
    const maxH = Math.max(...p.frames.map((f) => f.height));
    const aligned = cellW > 0 && cellH > 0 && cellW <= Math.min(640, maxW * 2) && cellH <= Math.min(480, maxH * 2);
    const cells: Cell[] = [];
    let x = GAP;
    let y = GAP;
    let rowH = 0;
    for (const f of p.frames) {
      const w = (aligned ? cellW : Math.max(f.width, 1)) * z;
      const h = (aligned ? cellH : Math.max(f.height, 1)) * z;
      if (x > GAP && x + w > widthPx - GAP) {
        x = GAP;
        y += rowH + GAP;
        rowH = 0;
      }
      cells.push({ x, y, w, h });
      x += w + GAP;
      rowH = Math.max(rowH, h);
    }
    this.#gridOrigin = aligned ? { x: -b.minX, y: -b.minY } : null;
    return { cells, height: y + rowH + GAP };
  }

  render(): void {
    const dpr = window.devicePixelRatio || 1;
    const stageW = Math.max(1, Math.floor(this.#stage.clientWidth * dpr));
    const stageH = Math.max(1, Math.floor(this.#stage.clientHeight * dpr));
    const p = this.#picture;
    const z = this.state.zoom;
    let height = stageH;
    if (this.state.mode === 'grid') {
      const layout = this.#layoutGrid(stageW);
      this.#cells = layout.cells;
      height = Math.max(stageH, layout.height);
    }
    if (this.#canvas.width !== stageW || this.#canvas.height !== height) {
      this.#canvas.width = stageW;
      this.#canvas.height = height;
      this.#canvas.style.width = `${stageW / dpr}px`;
      this.#canvas.style.height = `${height / dpr}px`;
    }
    const gl = this.#canvas.getContext('webgl2') as WebGL2RenderingContext;
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    this.#renderer.begin();
    if (p?.kind === 'rgba') {
      const r = this.#regions[0];
      if (r) {
        const x = this.state.mode === 'anim' ? Math.floor((stageW - r.width * z) / 2) : GAP;
        const y = this.state.mode === 'anim' ? Math.floor((stageH - r.height * z) / 2) : GAP;
        this.#renderer.draw(this.#rgbaAtlas, r, x, y, z);
      }
    } else if (p?.kind === 'indexed') {
      if (this.state.mode === 'grid') {
        p.frames.forEach((f, i) => {
          const c = this.#cells[i];
          const r = this.#regions[i];
          if (!c || !r) return;
          const o = this.#gridOrigin;
          const x = c.x + (o ? (f.offsetX + o.x) * z : 0);
          const y = c.y + (o ? (f.offsetY + o.y) * z : 0);
          this.#renderer.draw(this.#indexAtlas, r, x, y, z, 0);
        });
      } else {
        const i = this.currentAnimFrame();
        const f = i === null ? undefined : p.frames[i];
        const r = i === null ? undefined : this.#regions[i];
        if (f && r) {
          const ax = Math.floor(stageW * ANCHOR_AT_CSS_CROSSHAIR.x);
          const ay = Math.floor(stageH * ANCHOR_AT_CSS_CROSSHAIR.y);
          this.#renderer.draw(this.#indexAtlas, r, ax + f.offsetX * z, ay + f.offsetY * z, z, 0);
        }
        this.onFrameChange?.(i);
      }
    }
    this.#renderer.end(stageW, height, this.#palettes);
    this.onRender?.(this.#renderer.lastQuadCount);
  }
}

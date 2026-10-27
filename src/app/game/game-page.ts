import { createContext } from '../../render/gl.ts';
import { LogicalFramebuffer } from '../../render/ui-draw/logical-framebuffer.ts';
import { type UiDrawStats, UiRenderer } from '../../render/ui-draw/ui-renderer.ts';
import { type DrawItem, DrawList, sameDrawItems } from '../../ui/draw-list.ts';
import type { UiInputEvent } from '../../ui/input/events.ts';
import { type Resolution, resolveResolution, type ScaleSetting } from '../../ui/resolution.ts';
import type { UiRuntime } from '../../ui/runtime.ts';
import { ScreenHost } from '../../ui/screen.ts';
import { refusalOf } from '../../ui/screens/tactical/item-cursor.ts';
import type { ScreenGeometry } from '../../ui/services.ts';
import type { SessionClient } from '../net/session-client.ts';
import { DiagnosticsSampler } from './diagnostics.ts';
import { TimeSamples } from './time-samples.ts';
import { createUiHook, type UiHook } from './ui-hook.ts';

const CONTEXT_OPTIONS: WebGLContextAttributes = {
  alpha: false,
  antialias: false,
  depth: false,
  stencil: false,
  premultipliedAlpha: false,
  preserveDrawingBuffer: false,
};
const LONGEST_UNDRAWN_MS = 500;

interface DrawnFrame {
  readonly items: readonly DrawItem[];
  readonly world: number | null;
  readonly resolution: Resolution;
  readonly canvasWidth: number;
  readonly canvasHeight: number;
  readonly stats: UiDrawStats;
  readonly at: number;
}

function sameResolution(a: Resolution, b: Resolution): boolean {
  return (Object.keys(a) as (keyof Resolution)[]).every((key) => a[key] === b[key]);
}

export interface WorldLayer {
  render(width: number, height: number): number | null;
  present(target: WebGLFramebuffer, height: number): void;
}

export class GamePage {
  readonly stage: HTMLElement;
  readonly canvas: HTMLCanvasElement;
  readonly gl: WebGL2RenderingContext;
  readonly renderer: UiRenderer;
  readonly hook: UiHook;
  client: SessionClient | null = null;
  world: WorldLayer | null = null;
  frameListener: ((ms: number) => void) | null = null;
  readonly #fallbackHost = new ScreenHost();
  readonly #framebuffer: LogicalFramebuffer;
  readonly #list = new DrawList();
  readonly #frameTimes = new TimeSamples();
  readonly #diagnostics = new DiagnosticsSampler({
    overlay: () => this.#runtime?.diagnostics ?? null,
    client: () => this.client,
    reads: () => this.hook.reads,
    drawnFrames: () => this.hook.presentedFrames,
  });
  readonly #setting: ScaleSetting;
  #resolution: Resolution;
  #lastNow: number | null = null;
  #runtime: UiRuntime | null = null;
  #drawn: DrawnFrame | null = null;
  #placement = '';

  constructor(stage: HTMLElement, canvas: HTMLCanvasElement, setting: ScaleSetting) {
    this.stage = stage;
    this.canvas = canvas;
    this.#setting = setting;
    const gl = createContext(canvas, CONTEXT_OPTIONS);
    this.gl = gl;
    this.renderer = new UiRenderer(gl);
    this.#framebuffer = new LogicalFramebuffer(gl);
    this.#resolution = this.#resize();
    this.hook = createUiHook({
      widgets: () => this.#runtime?.describe() ?? [],
      capture: () => (this.#framebuffer.width > 0 ? this.#framebuffer.capture() : null),
      frameStats: () => this.#frameTimes.summary(),
      resetFrameStats: () => this.#frameTimes.reset(),
      skipPlayback: () => this.client?.skipToLatest(),
    });
  }

  get resolution(): Resolution {
    return this.#resolution;
  }

  get runtime(): UiRuntime | null {
    return this.#runtime;
  }

  get host(): ScreenHost {
    return this.#runtime?.host ?? this.#fallbackHost;
  }

  geometry(): ScreenGeometry {
    const r = this.#resolution;
    return { width: r.logicalWidth, height: r.logicalHeight, stdX: r.stdScreenX, stdY: r.stdScreenY };
  }

  attach(runtime: UiRuntime): void {
    this.#runtime = runtime;
  }

  input(event: UiInputEvent): void {
    if (this.#runtime) this.#runtime.input(event);
    else this.#fallbackHost.input(event);
  }

  pointerLeft(): void {
    this.#runtime?.pointerLeft();
  }

  #resize(): Resolution {
    const ratio = globalThis.devicePixelRatio || 1;
    const box = this.stage.getBoundingClientRect();
    const width = Math.max(1, Math.floor(box.width * ratio));
    const height = Math.max(1, Math.floor(box.height * ratio));
    const resolution = resolveResolution(width, height, this.#setting, ratio);
    this.#place(resolution, ratio);
    this.#framebuffer.resize(resolution.logicalWidth, resolution.logicalHeight);
    return resolution;
  }

  #place(r: Resolution, ratio: number): void {
    const canvas = this.canvas;
    if (canvas.width !== r.logicalWidth) canvas.width = r.logicalWidth;
    if (canvas.height !== r.logicalHeight) canvas.height = r.logicalHeight;
    const placement = [r.viewX, r.viewY, r.viewWidth, r.viewHeight].map((device) => `${device / ratio}px`);
    const key = placement.join(' ');
    if (key === this.#placement) return;
    this.#placement = key;
    const [left, top, width, height] = placement as [string, string, string, string];
    Object.assign(canvas.style, { left, top, width, height });
  }

  frame(now: number): void {
    const started = performance.now();
    const elapsed = this.#lastNow === null ? 0 : now - this.#lastNow;
    this.#lastNow = now;
    this.#resolution = this.#resize();
    this.client?.playFor(elapsed);
    this.#list.clear();
    if (this.#runtime) this.#runtime.frame(now, this.#list);
    else {
      this.#fallbackHost.update(now);
      this.#fallbackHost.render(this.#list);
    }
    const world = this.#renderWorld();
    const stats = this.#stillShown(started, world) ?? this.#draw(started, world);
    const ms = performance.now() - started;
    this.#frameTimes.add(ms);
    this.#diagnostics.frame(started, ms);
    this.#report(stats);
    this.frameListener?.(ms);
  }

  #renderWorld(): number | null {
    if (!this.world || !this.host.screen?.drawsWorld) return null;
    return this.world.render(this.#resolution.logicalWidth, this.#resolution.logicalHeight);
  }

  #stillShown(now: number, world: number | null): UiDrawStats | null {
    const drawn = this.#drawn;
    if (!drawn || now - drawn.at > LONGEST_UNDRAWN_MS) return null;
    if (drawn.world !== world) return null;
    if (drawn.stats.missingImages.length > 0 || drawn.stats.missingFonts.length > 0) return null;
    if (drawn.canvasWidth !== this.canvas.width || drawn.canvasHeight !== this.canvas.height) return null;
    if (!sameResolution(drawn.resolution, this.#resolution)) return null;
    return sameDrawItems(drawn.items, this.#list.items) ? drawn.stats : null;
  }

  #draw(now: number, world: number | null): UiDrawStats {
    const { logicalWidth, logicalHeight } = this.#resolution;
    this.#framebuffer.begin();
    if (world !== null && this.world) {
      this.world.present(this.#framebuffer.target, logicalHeight);
      this.#framebuffer.bind();
    }
    const stats = this.renderer.draw(this.#list.items, logicalWidth, logicalHeight);
    this.#framebuffer.present();
    this.hook.presentedFrames++;
    this.#drawn = {
      items: [...this.#list.items],
      world,
      resolution: this.#resolution,
      canvasWidth: this.canvas.width,
      canvasHeight: this.canvas.height,
      stats,
      at: now,
    };
    return stats;
  }

  #reportSession(hook: UiHook): void {
    const client = this.client;
    hook.lagTicks = client ? Math.max(0, client.latestTick - client.shownTick) : 0;
    hook.lastCommand = client?.lastCommand?.type ?? null;
    const reply = client?.lastReply ?? null;
    hook.lastResult = reply ? { ok: reply.ok, reason: reply.reason ?? null, refusal: refusalOf(reply.data) } : null;
  }

  #report(stats: UiHook['draw']): void {
    const r = this.#resolution;
    const hook = this.hook;
    hook.scale = r.scale;
    hook.origin = { x: r.stdScreenX, y: r.stdScreenY };
    hook.logical = { width: r.logicalWidth, height: r.logicalHeight };
    hook.screen = this.host.screen?.id ?? null;
    hook.modal = this.host.modal?.id ?? null;
    hook.cursor = this.#runtime?.cursorReport() ?? null;
    hook.draw = stats;
    this.#reportSession(hook);
    hook.frameCount++;
  }
}

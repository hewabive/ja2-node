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
  draw(target: WebGLFramebuffer, width: number, height: number): void;
}

export class GamePage {
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
  readonly #setting: ScaleSetting;
  #resolution: Resolution;
  #lastNow: number | null = null;
  #runtime: UiRuntime | null = null;
  #drawn: DrawnFrame | null = null;

  constructor(canvas: HTMLCanvasElement, setting: ScaleSetting) {
    this.canvas = canvas;
    this.#setting = setting;
    const gl = createContext(canvas, CONTEXT_OPTIONS);
    this.gl = gl;
    this.renderer = new UiRenderer(gl);
    this.#framebuffer = new LogicalFramebuffer(gl);
    this.#resolution = this.#resize();
    this.hook = createUiHook({
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
    const width = Math.max(1, Math.round(this.canvas.clientWidth * ratio));
    const height = Math.max(1, Math.round(this.canvas.clientHeight * ratio));
    if (this.canvas.width !== width) this.canvas.width = width;
    if (this.canvas.height !== height) this.canvas.height = height;
    const resolution = resolveResolution(width, height, this.#setting);
    this.#framebuffer.resize(resolution.logicalWidth, resolution.logicalHeight);
    return resolution;
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
    const stats = this.#stillShown(started) ?? this.#draw(started);
    const ms = performance.now() - started;
    this.#frameTimes.add(ms);
    this.#report(stats);
    this.frameListener?.(ms);
  }

  #stillShown(now: number): UiDrawStats | null {
    const drawn = this.#drawn;
    if (!drawn || now - drawn.at > LONGEST_UNDRAWN_MS) return null;
    if (this.world && this.host.screen?.drawsWorld) return null;
    if (drawn.stats.missingImages.length > 0 || drawn.stats.missingFonts.length > 0) return null;
    if (drawn.canvasWidth !== this.canvas.width || drawn.canvasHeight !== this.canvas.height) return null;
    if (!sameResolution(drawn.resolution, this.#resolution)) return null;
    return sameDrawItems(drawn.items, this.#list.items) ? drawn.stats : null;
  }

  #draw(now: number): UiDrawStats {
    const { logicalWidth, logicalHeight } = this.#resolution;
    this.#framebuffer.begin();
    if (this.world && this.host.screen?.drawsWorld) {
      this.world.draw(this.#framebuffer.target, logicalWidth, logicalHeight);
      this.#framebuffer.bind();
    }
    const stats = this.renderer.draw(this.#list.items, logicalWidth, logicalHeight);
    this.#framebuffer.present(this.#resolution, this.canvas.width, this.canvas.height);
    this.#drawn = {
      items: [...this.#list.items],
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
    hook.widgets = this.#runtime?.describe() ?? [];
    hook.cursor = this.#runtime?.cursorReport() ?? null;
    hook.draw = stats;
    this.#reportSession(hook);
    hook.frameCount++;
  }
}

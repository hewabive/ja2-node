import { createContext } from '../../render/gl.ts';
import { LogicalFramebuffer } from '../../render/ui-draw/logical-framebuffer.ts';
import { UiRenderer } from '../../render/ui-draw/ui-renderer.ts';
import { DrawList } from '../../ui/draw-list.ts';
import type { UiInputEvent } from '../../ui/input/events.ts';
import { type Resolution, resolveResolution, type ScaleSetting } from '../../ui/resolution.ts';
import type { UiRuntime } from '../../ui/runtime.ts';
import { ScreenHost } from '../../ui/screen.ts';
import type { ScreenGeometry } from '../../ui/services.ts';
import type { SessionClient } from '../net/session-client.ts';
import { createUiHook, type UiHook } from './ui-hook.ts';

const CONTEXT_OPTIONS: WebGLContextAttributes = {
  alpha: false,
  antialias: false,
  depth: false,
  stencil: false,
  premultipliedAlpha: false,
  preserveDrawingBuffer: false,
};

export class GamePage {
  readonly canvas: HTMLCanvasElement;
  readonly renderer: UiRenderer;
  readonly hook: UiHook;
  client: SessionClient | null = null;
  readonly #fallbackHost = new ScreenHost();
  readonly #framebuffer: LogicalFramebuffer;
  readonly #list = new DrawList();
  readonly #setting: ScaleSetting;
  #resolution: Resolution;
  #lastNow: number | null = null;
  #runtime: UiRuntime | null = null;

  constructor(canvas: HTMLCanvasElement, setting: ScaleSetting) {
    this.canvas = canvas;
    this.#setting = setting;
    const gl = createContext(canvas, CONTEXT_OPTIONS);
    this.renderer = new UiRenderer(gl);
    this.#framebuffer = new LogicalFramebuffer(gl);
    this.#resolution = this.#resize();
    this.hook = createUiHook(() => (this.#framebuffer.width > 0 ? this.#framebuffer.capture() : null));
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
    const { logicalWidth, logicalHeight } = this.#resolution;
    this.#framebuffer.begin();
    const stats = this.renderer.draw(this.#list.items, logicalWidth, logicalHeight);
    this.#framebuffer.present(this.#resolution, this.canvas.width, this.canvas.height);
    this.#report(stats);
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
    hook.frameCount++;
  }
}

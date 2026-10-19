import type { Resolution } from '../../ui/resolution.ts';

const RGBA_CHANNELS = 4;

export interface CapturedFrame {
  readonly width: number;
  readonly height: number;
  readonly rgba: Uint8Array;
}

export class LogicalFramebuffer {
  readonly #gl: WebGL2RenderingContext;
  readonly #framebuffer: WebGLFramebuffer;
  #renderbuffer: WebGLRenderbuffer | null = null;
  #width = 0;
  #height = 0;

  constructor(gl: WebGL2RenderingContext) {
    this.#gl = gl;
    this.#framebuffer = gl.createFramebuffer();
  }

  get width(): number {
    return this.#width;
  }

  get height(): number {
    return this.#height;
  }

  get target(): WebGLFramebuffer {
    return this.#framebuffer;
  }

  resize(width: number, height: number): void {
    if (width === this.#width && height === this.#height && this.#renderbuffer) return;
    const gl = this.#gl;
    if (this.#renderbuffer) gl.deleteRenderbuffer(this.#renderbuffer);
    const renderbuffer = gl.createRenderbuffer();
    gl.bindRenderbuffer(gl.RENDERBUFFER, renderbuffer);
    gl.renderbufferStorage(gl.RENDERBUFFER, gl.RGBA8, width, height);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.#framebuffer);
    gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.RENDERBUFFER, renderbuffer);
    if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) throw new Error('the logical framebuffer is incomplete');
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    this.#renderbuffer = renderbuffer;
    this.#width = width;
    this.#height = height;
  }

  begin(): void {
    const gl = this.#gl;
    this.bind();
    gl.disable(gl.SCISSOR_TEST);
    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
  }

  bind(): void {
    const gl = this.#gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.#framebuffer);
    gl.viewport(0, 0, this.#width, this.#height);
  }

  present(resolution: Resolution, canvasWidth: number, canvasHeight: number): void {
    const gl = this.#gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, canvasWidth, canvasHeight);
    gl.disable(gl.SCISSOR_TEST);
    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, this.#framebuffer);
    gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, null);
    const bottom = canvasHeight - resolution.viewY - resolution.viewHeight;
    gl.blitFramebuffer(
      0,
      0,
      this.#width,
      this.#height,
      resolution.viewX,
      bottom,
      resolution.viewX + resolution.viewWidth,
      bottom + resolution.viewHeight,
      gl.COLOR_BUFFER_BIT,
      gl.NEAREST,
    );
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, null);
  }

  capture(): CapturedFrame {
    const gl = this.#gl;
    const width = this.#width;
    const height = this.#height;
    const upsideDown = new Uint8Array(width * height * RGBA_CHANNELS);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.#framebuffer);
    gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, upsideDown);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    const rgba = new Uint8Array(upsideDown.length);
    const rowBytes = width * RGBA_CHANNELS;
    for (let y = 0; y < height; y++) rgba.set(upsideDown.subarray((height - 1 - y) * rowBytes, (height - y) * rowBytes), y * rowBytes);
    return { width, height, rgba };
  }
}

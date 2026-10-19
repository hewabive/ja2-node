const RGBA_CHANNELS = 4;

export interface WorldCapture {
  readonly width: number;
  readonly height: number;
  readonly rgba: Uint8Array;
}

export class WorldFramebuffer {
  readonly #gl: WebGL2RenderingContext;
  readonly #framebuffer: WebGLFramebuffer;
  #color: WebGLRenderbuffer | null = null;
  #depth: WebGLRenderbuffer | null = null;
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

  get framebuffer(): WebGLFramebuffer {
    return this.#framebuffer;
  }

  resize(width: number, height: number): void {
    if (width === this.#width && height === this.#height && this.#color) return;
    const gl = this.#gl;
    if (this.#color) gl.deleteRenderbuffer(this.#color);
    if (this.#depth) gl.deleteRenderbuffer(this.#depth);
    this.#color = this.#storage(gl.RGBA8, width, height);
    this.#depth = this.#storage(gl.DEPTH_COMPONENT24, width, height);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.#framebuffer);
    gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.RENDERBUFFER, this.#color);
    gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, this.#depth);
    if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) throw new Error('the world framebuffer is incomplete');
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    this.#width = width;
    this.#height = height;
  }

  #storage(format: number, width: number, height: number): WebGLRenderbuffer {
    const gl = this.#gl;
    const rb = gl.createRenderbuffer();
    gl.bindRenderbuffer(gl.RENDERBUFFER, rb);
    gl.renderbufferStorage(gl.RENDERBUFFER, format, width, height);
    return rb;
  }

  begin(): void {
    const gl = this.#gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.#framebuffer);
    gl.viewport(0, 0, this.#width, this.#height);
    gl.disable(gl.SCISSOR_TEST);
    gl.clearColor(0, 0, 0, 1);
    gl.clearDepth(0);
    gl.depthMask(true);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
  }

  present(target: WebGLFramebuffer | null, targetHeight: number, x: number, y: number, scale: number): void {
    const gl = this.#gl;
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, this.#framebuffer);
    gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, target);
    const bottom = targetHeight - y - this.#height * scale;
    gl.blitFramebuffer(
      0,
      0,
      this.#width,
      this.#height,
      x,
      bottom,
      x + this.#width * scale,
      bottom + this.#height * scale,
      gl.COLOR_BUFFER_BIT,
      gl.NEAREST,
    );
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, null);
    gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, null);
  }

  capture(): WorldCapture {
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

  dispose(): void {
    const gl = this.#gl;
    if (this.#color) gl.deleteRenderbuffer(this.#color);
    if (this.#depth) gl.deleteRenderbuffer(this.#depth);
    gl.deleteFramebuffer(this.#framebuffer);
  }
}

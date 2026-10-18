import { createContext, createProgram, uniform } from './gl.ts';

const VERTEX = `#version 300 es
out vec2 v_uv;
const vec2 CORNERS[3] = vec2[3](vec2(-1.0, -1.0), vec2(3.0, -1.0), vec2(-1.0, 3.0));
void main() {
  vec2 p = CORNERS[gl_VertexID];
  v_uv = vec2(p.x * 0.5 + 0.5, 0.5 - p.y * 0.5);
  gl_Position = vec4(p, 0.0, 1.0);
}`;

const FRAGMENT = `#version 300 es
precision highp float;
precision highp int;
precision highp usampler2D;
uniform usampler2D u_indices;
uniform sampler2D u_palette;
uniform ivec2 u_size;
in vec2 v_uv;
out vec4 o_color;
void main() {
  ivec2 p = clamp(ivec2(floor(v_uv * vec2(u_size))), ivec2(0), u_size - 1);
  uint index = texelFetch(u_indices, p, 0).r;
  o_color = vec4(texelFetch(u_palette, ivec2(int(index), 0), 0).rgb, 1.0);
}`;

const PALETTE_COLOURS = 256;
const PALETTE_BYTES = PALETTE_COLOURS * 3;
const TRIANGLE_VERTICES = 3;

export class IndexedFrameRenderer {
  readonly #gl: WebGL2RenderingContext;
  readonly #program: WebGLProgram;
  readonly #size: WebGLUniformLocation;
  readonly #indicesUnit: WebGLUniformLocation;
  readonly #paletteUnit: WebGLUniformLocation;
  readonly #palette: WebGLTexture;
  readonly #vao: WebGLVertexArrayObject;
  #indices: WebGLTexture | null = null;
  #width = 0;
  #height = 0;

  constructor(canvas: HTMLCanvasElement) {
    const gl = createContext(canvas, { alpha: false, premultipliedAlpha: false });
    this.#gl = gl;
    this.#program = createProgram(gl, VERTEX, FRAGMENT);
    this.#size = uniform(gl, this.#program, 'u_size');
    this.#indicesUnit = uniform(gl, this.#program, 'u_indices');
    this.#paletteUnit = uniform(gl, this.#program, 'u_palette');
    this.#vao = gl.createVertexArray();
    this.#palette = this.#texture();
    gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGB8, PALETTE_COLOURS, 1);
  }

  #texture(): WebGLTexture {
    const gl = this.#gl;
    const texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return texture;
  }

  #resize(width: number, height: number): void {
    if (width === this.#width && height === this.#height && this.#indices) return;
    const gl = this.#gl;
    if (this.#indices) gl.deleteTexture(this.#indices);
    this.#indices = this.#texture();
    gl.texStorage2D(gl.TEXTURE_2D, 1, gl.R8UI, width, height);
    this.#width = width;
    this.#height = height;
  }

  draw(width: number, height: number, indices: Uint8Array, palette: Uint8Array): void {
    if (indices.length !== width * height) throw new RangeError('index buffer does not match the frame size');
    if (palette.length !== PALETTE_BYTES) throw new RangeError('palette must have 256 RGB colours');
    const gl = this.#gl;
    this.#resize(width, height);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.#indices);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, width, height, gl.RED_INTEGER, gl.UNSIGNED_BYTE, indices);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.#palette);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, PALETTE_COLOURS, 1, gl.RGB, gl.UNSIGNED_BYTE, palette);
    gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight);
    gl.useProgram(this.#program);
    gl.uniform1i(this.#indicesUnit, 0);
    gl.uniform1i(this.#paletteUnit, 1);
    gl.uniform2i(this.#size, width, height);
    gl.bindVertexArray(this.#vao);
    gl.drawArrays(gl.TRIANGLES, 0, TRIANGLE_VERTICES);
    gl.bindVertexArray(null);
  }

  clear(): void {
    const gl = this.#gl;
    gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight);
    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
  }

  dispose(): void {
    const gl = this.#gl;
    if (this.#indices) gl.deleteTexture(this.#indices);
    gl.deleteTexture(this.#palette);
    gl.deleteProgram(this.#program);
    gl.deleteVertexArray(this.#vao);
    gl.getExtension('WEBGL_lose_context')?.loseContext();
  }
}

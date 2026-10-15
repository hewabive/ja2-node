import type { AtlasRegion, TextureAtlas } from './atlas.ts';
import { createProgram, uniform } from './gl.ts';
import type { PaletteTexture } from './palettes.ts';

const VERTEX = `#version 300 es
layout(location = 0) in vec4 a_dst;
layout(location = 1) in vec4 a_src;
layout(location = 2) in float a_row;
uniform vec2 u_viewport;
out vec2 v_src;
flat out int v_row;
const vec2 CORNERS[6] = vec2[6](vec2(0, 0), vec2(1, 0), vec2(0, 1), vec2(0, 1), vec2(1, 0), vec2(1, 1));
void main() {
  vec2 c = CORNERS[gl_VertexID];
  vec2 p = a_dst.xy + c * a_dst.zw;
  v_src = a_src.xy + c * a_src.zw;
  v_row = int(a_row);
  gl_Position = vec4(p / u_viewport * vec2(2.0, -2.0) + vec2(-1.0, 1.0), 0.0, 1.0);
}`;

const FRAGMENT_INDEXED = `#version 300 es
precision highp float;
precision highp int;
precision highp usampler2D;
uniform usampler2D u_atlas;
uniform sampler2D u_palette;
in vec2 v_src;
flat in int v_row;
out vec4 o_color;
void main() {
  uint index = texelFetch(u_atlas, ivec2(floor(v_src)), 0).r;
  if (index == 0u) discard;
  o_color = texelFetch(u_palette, ivec2(int(index), v_row), 0);
}`;

const FRAGMENT_RGBA = `#version 300 es
precision highp float;
uniform sampler2D u_atlas;
in vec2 v_src;
flat in int v_row;
out vec4 o_color;
void main() {
  vec4 c = texelFetch(u_atlas, ivec2(floor(v_src)), 0);
  if (c.a == 0.0) discard;
  o_color = vec4(c.rgb * c.a, c.a);
}`;

const FLOATS_PER_QUAD = 9;

interface Batch {
  readonly atlas: TextureAtlas;
  readonly page: number;
  readonly data: number[];
}

export class SpriteRenderer {
  readonly #gl: WebGL2RenderingContext;
  readonly #indexed: { program: WebGLProgram; viewport: WebGLUniformLocation; atlas: WebGLUniformLocation; palette: WebGLUniformLocation };
  readonly #rgba: { program: WebGLProgram; viewport: WebGLUniformLocation; atlas: WebGLUniformLocation };
  readonly #vao: WebGLVertexArrayObject;
  readonly #buffer: WebGLBuffer;
  #batches: Batch[] = [];
  #quads = 0;

  constructor(gl: WebGL2RenderingContext) {
    this.#gl = gl;
    const pi = createProgram(gl, VERTEX, FRAGMENT_INDEXED);
    this.#indexed = {
      program: pi,
      viewport: uniform(gl, pi, 'u_viewport'),
      atlas: uniform(gl, pi, 'u_atlas'),
      palette: uniform(gl, pi, 'u_palette'),
    };
    const pr = createProgram(gl, VERTEX, FRAGMENT_RGBA);
    this.#rgba = { program: pr, viewport: uniform(gl, pr, 'u_viewport'), atlas: uniform(gl, pr, 'u_atlas') };
    this.#vao = gl.createVertexArray();
    this.#buffer = gl.createBuffer();
    gl.bindVertexArray(this.#vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.#buffer);
    const stride = FLOATS_PER_QUAD * 4;
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 4, gl.FLOAT, false, stride, 0);
    gl.vertexAttribDivisor(0, 1);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 4, gl.FLOAT, false, stride, 16);
    gl.vertexAttribDivisor(1, 1);
    gl.enableVertexAttribArray(2);
    gl.vertexAttribPointer(2, 1, gl.FLOAT, false, stride, 32);
    gl.vertexAttribDivisor(2, 1);
    gl.bindVertexArray(null);
  }

  get lastQuadCount(): number {
    return this.#quads;
  }

  begin(): void {
    this.#batches = [];
  }

  draw(atlas: TextureAtlas, region: AtlasRegion, x: number, y: number, scale: number, paletteRow = 0): void {
    if (region.width === 0 || region.height === 0) return;
    let batch = this.#batches.at(-1);
    if (!batch || batch.atlas !== atlas || batch.page !== region.page) {
      batch = { atlas, page: region.page, data: [] };
      this.#batches.push(batch);
    }
    batch.data.push(x, y, region.width * scale, region.height * scale, region.x, region.y, region.width, region.height, paletteRow);
  }

  end(width: number, height: number, palettes: PaletteTexture | null): void {
    const gl = this.#gl;
    gl.viewport(0, 0, width, height);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.bindVertexArray(this.#vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.#buffer);
    this.#quads = 0;
    for (const b of this.#batches) {
      const indexed = b.atlas.format === 'index';
      const p = indexed ? this.#indexed : this.#rgba;
      gl.useProgram(p.program);
      gl.uniform2f(p.viewport, width, height);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, b.atlas.texture(b.page));
      gl.uniform1i(p.atlas, 0);
      if (indexed) {
        if (!palettes) throw new Error('indexed sprites need a palette texture');
        gl.activeTexture(gl.TEXTURE1);
        gl.bindTexture(gl.TEXTURE_2D, palettes.texture);
        gl.uniform1i(this.#indexed.palette, 1);
      }
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(b.data), gl.STREAM_DRAW);
      const n = b.data.length / FLOATS_PER_QUAD;
      gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, n);
      this.#quads += n;
    }
    gl.bindVertexArray(null);
    this.#batches = [];
  }
}

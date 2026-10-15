import type { AtlasRegion, TextureAtlas } from './atlas.ts';
import { createProgram, uniform } from './gl.ts';
import type { PaletteTexture } from './palettes.ts';

const VERTEX = `#version 300 es
layout(location = 0) in vec4 a_dst;
layout(location = 1) in vec4 a_src;
layout(location = 2) in vec2 a_rowDepth;
uniform vec2 u_viewport;
out vec2 v_src;
flat out int v_row;
const vec2 CORNERS[6] = vec2[6](vec2(0, 0), vec2(1, 0), vec2(0, 1), vec2(0, 1), vec2(1, 0), vec2(1, 1));
void main() {
  vec2 c = CORNERS[gl_VertexID];
  vec2 p = a_dst.xy + c * a_dst.zw;
  v_src = a_src.xy + c * a_src.zw;
  v_row = int(a_rowDepth.x);
  gl_Position = vec4(p / u_viewport * vec2(2.0, -2.0) + vec2(-1.0, 1.0), a_rowDepth.y * 2.0 - 1.0, 1.0);
}`;

const FRAGMENT_INDEXED = `#version 300 es
precision highp float;
precision highp int;
precision highp usampler2D;
uniform usampler2D u_atlas;
uniform sampler2D u_palette;
uniform float u_alpha;
uniform float u_shadowFactor;
uniform int u_indexFilter;
uniform float u_checkerScale;
in vec2 v_src;
flat in int v_row;
out vec4 o_color;
void main() {
  uint index = texelFetch(u_atlas, ivec2(floor(v_src)), 0).r;
  if (index == 0u) discard;
  if (u_indexFilter == 1 && index != 254u) discard;
  if (u_indexFilter == 2 && index == 254u) discard;
  if (u_checkerScale > 0.0) {
    ivec2 cell = ivec2(floor(gl_FragCoord.xy / u_checkerScale));
    if (((cell.x + cell.y) & 1) != 0) discard;
  }
  if (u_shadowFactor > 0.0) {
    o_color = vec4(vec3(u_shadowFactor), 1.0);
    return;
  }
  vec4 c = texelFetch(u_palette, ivec2(int(index), v_row), 0);
  o_color = vec4(c.rgb * u_alpha, u_alpha);
}`;

const FRAGMENT_RGBA = `#version 300 es
precision highp float;
uniform sampler2D u_atlas;
uniform float u_alpha;
in vec2 v_src;
flat in int v_row;
out vec4 o_color;
void main() {
  vec4 c = texelFetch(u_atlas, ivec2(floor(v_src)), 0);
  if (c.a == 0.0) discard;
  o_color = vec4(c.rgb * c.a * u_alpha, c.a * u_alpha);
}`;

const FLOATS_PER_QUAD = 10;
const MAX_DEPTH = 0xffff;

export const DepthMode = {
  NONE: 0,
  NEARER: 1,
  NEARER_OR_EQUAL: 2,
  NEARER_OR_EQUAL_NO_WRITE: 3,
  NEARER_NO_WRITE: 4,
  FARTHER_NO_WRITE: 5,
} as const;

export const IndexFilter = { ALL: 0, ONLY_SHADOW: 1, EXCEPT_SHADOW: 2 } as const;
export type IndexFilter = (typeof IndexFilter)[keyof typeof IndexFilter];
export type DepthMode = (typeof DepthMode)[keyof typeof DepthMode];

export interface DrawOptions {
  readonly scale?: number;
  readonly paletteRow?: number;
  readonly z?: number;
  readonly depthMode?: DepthMode;
  readonly alpha?: number;
  readonly srcX?: number;
  readonly srcWidth?: number;
  readonly shadowFactor?: number;
  readonly indexFilter?: IndexFilter;
  readonly checkerScale?: number;
  readonly palettes?: PaletteTexture;
}

interface Batch {
  readonly atlas: TextureAtlas;
  readonly page: number;
  readonly depthMode: DepthMode;
  readonly alpha: number;
  readonly shadowFactor: number;
  readonly indexFilter: IndexFilter;
  readonly checkerScale: number;
  readonly palettes: PaletteTexture | null;
  readonly data: number[];
}

interface Program {
  readonly program: WebGLProgram;
  readonly viewport: WebGLUniformLocation;
  readonly atlas: WebGLUniformLocation;
  readonly alpha: WebGLUniformLocation;
}

export class SpriteRenderer {
  readonly #gl: WebGL2RenderingContext;
  readonly #indexed: Program & {
    palette: WebGLUniformLocation;
    shadowFactor: WebGLUniformLocation;
    indexFilter: WebGLUniformLocation;
    checkerScale: WebGLUniformLocation;
  };
  readonly #rgba: Program;
  readonly #vao: WebGLVertexArrayObject;
  readonly #buffer: WebGLBuffer;
  #batches: Batch[] = [];
  #quads = 0;

  constructor(gl: WebGL2RenderingContext) {
    this.#gl = gl;
    const program = (fragment: string): Program => {
      const p = createProgram(gl, VERTEX, fragment);
      return { program: p, viewport: uniform(gl, p, 'u_viewport'), atlas: uniform(gl, p, 'u_atlas'), alpha: uniform(gl, p, 'u_alpha') };
    };
    const indexed = program(FRAGMENT_INDEXED);
    this.#indexed = {
      ...indexed,
      palette: uniform(gl, indexed.program, 'u_palette'),
      shadowFactor: uniform(gl, indexed.program, 'u_shadowFactor'),
      indexFilter: uniform(gl, indexed.program, 'u_indexFilter'),
      checkerScale: uniform(gl, indexed.program, 'u_checkerScale'),
    };
    this.#rgba = program(FRAGMENT_RGBA);
    this.#vao = gl.createVertexArray();
    this.#buffer = gl.createBuffer();
    gl.bindVertexArray(this.#vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.#buffer);
    const stride = FLOATS_PER_QUAD * 4;
    const attributes: [number, number, number][] = [
      [0, 4, 0],
      [1, 4, 16],
      [2, 2, 32],
    ];
    for (const [location, size, offset] of attributes) {
      gl.enableVertexAttribArray(location);
      gl.vertexAttribPointer(location, size, gl.FLOAT, false, stride, offset);
      gl.vertexAttribDivisor(location, 1);
    }
    gl.bindVertexArray(null);
  }

  get lastQuadCount(): number {
    return this.#quads;
  }

  begin(): void {
    this.#batches = [];
  }

  draw(atlas: TextureAtlas, region: AtlasRegion, x: number, y: number, scaleOrOptions: number | DrawOptions = 1, paletteRow = 0): void {
    const o: DrawOptions = typeof scaleOrOptions === 'number' ? { scale: scaleOrOptions, paletteRow } : scaleOrOptions;
    const scale = o.scale ?? 1;
    const srcX = o.srcX ?? 0;
    const srcWidth = o.srcWidth ?? region.width - srcX;
    if (srcWidth <= 0 || region.height === 0) return;
    const depthMode = o.depthMode ?? DepthMode.NONE;
    const alpha = o.alpha ?? 1;
    const shadowFactor = o.shadowFactor ?? 0;
    const indexFilter = o.indexFilter ?? IndexFilter.ALL;
    const checkerScale = o.checkerScale ?? 0;
    const palettes = o.palettes ?? null;
    let batch = this.#batches.at(-1);
    if (
      !batch ||
      batch.atlas !== atlas ||
      batch.page !== region.page ||
      batch.depthMode !== depthMode ||
      batch.alpha !== alpha ||
      batch.shadowFactor !== shadowFactor ||
      batch.indexFilter !== indexFilter ||
      batch.checkerScale !== checkerScale ||
      batch.palettes !== palettes
    ) {
      batch = { atlas, page: region.page, depthMode, alpha, shadowFactor, indexFilter, checkerScale, palettes, data: [] };
      this.#batches.push(batch);
    }
    const depth = Math.min(Math.max(o.z ?? 0, 0), MAX_DEPTH) / MAX_DEPTH;
    batch.data.push(
      x,
      y,
      srcWidth * scale,
      region.height * scale,
      region.x + srcX,
      region.y,
      srcWidth,
      region.height,
      o.paletteRow ?? 0,
      depth,
    );
  }

  #applyDepthMode(mode: DepthMode): void {
    const gl = this.#gl;
    if (mode === DepthMode.NONE) {
      gl.disable(gl.DEPTH_TEST);
      return;
    }
    gl.enable(gl.DEPTH_TEST);
    const func =
      mode === DepthMode.NEARER || mode === DepthMode.NEARER_NO_WRITE
        ? gl.GREATER
        : mode === DepthMode.FARTHER_NO_WRITE
          ? gl.LESS
          : gl.GEQUAL;
    gl.depthFunc(func);
    gl.depthMask(mode === DepthMode.NEARER || mode === DepthMode.NEARER_OR_EQUAL);
  }

  end(width: number, height: number, palettes: PaletteTexture | null): void {
    const gl = this.#gl;
    gl.viewport(0, 0, width, height);
    gl.enable(gl.BLEND);
    gl.bindVertexArray(this.#vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.#buffer);
    this.#quads = 0;
    for (const b of this.#batches) {
      const indexed = b.atlas.format === 'index';
      const p = indexed ? this.#indexed : this.#rgba;
      gl.useProgram(p.program);
      gl.uniform2f(p.viewport, width, height);
      gl.uniform1f(p.alpha, b.alpha);
      if (b.shadowFactor > 0) gl.blendFunc(gl.ZERO, gl.SRC_COLOR);
      else gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
      if (indexed) {
        gl.uniform1f(this.#indexed.shadowFactor, b.shadowFactor);
        gl.uniform1i(this.#indexed.indexFilter, b.indexFilter);
        gl.uniform1f(this.#indexed.checkerScale, b.checkerScale);
      }
      this.#applyDepthMode(b.depthMode);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, b.atlas.texture(b.page));
      gl.uniform1i(p.atlas, 0);
      if (indexed) {
        const palette = b.palettes ?? palettes;
        if (!palette) throw new Error('indexed sprites need a palette texture');
        gl.activeTexture(gl.TEXTURE1);
        gl.bindTexture(gl.TEXTURE_2D, palette.texture);
        gl.uniform1i(this.#indexed.palette, 1);
      }
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(b.data), gl.STREAM_DRAW);
      const n = b.data.length / FLOATS_PER_QUAD;
      gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, n);
      this.#quads += n;
    }
    gl.disable(gl.DEPTH_TEST);
    gl.depthMask(true);
    gl.bindVertexArray(null);
    this.#batches = [];
  }
}

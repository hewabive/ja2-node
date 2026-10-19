import { WORLD_COLS, WORLD_MAX, WORLD_ROWS } from '../../content/world/grid.ts';
import { SHADOW_FACTOR } from '../../content/world/shading.ts';
import { createProgram, uniform } from '../gl.ts';
import { DrawState, FLOATS_PER_INSTANCE, InstanceFlags, ShadeKey } from './instances.ts';

const INSTANCE_TEXTURE_WIDTH = 1024;
const TEXELS_PER_INSTANCE = FLOATS_PER_INSTANCE / 4;

const VERTEX = `#version 300 es
precision highp float;
precision highp int;
precision highp usampler2D;
precision highp sampler2D;
uniform sampler2D u_instances;
uniform vec2 u_viewport;
uniform vec2 u_offset;
uniform usampler2D u_shade;
uniform int u_natural;
out vec2 v_src;
out vec2 v_screen;
flat out int v_layer;
flat out int v_row;
flat out int v_flags;
flat out vec3 v_outline;
const vec2 CORNERS[6] = vec2[6](vec2(0, 0), vec2(1, 0), vec2(0, 1), vec2(0, 1), vec2(1, 0), vec2(1, 1));
vec4 instanceTexel(int t) {
  return texelFetch(u_instances, ivec2(t % ${INSTANCE_TEXTURE_WIDTH}, t / ${INSTANCE_TEXTURE_WIDTH}), 0);
}
void main() {
  int quad = gl_VertexID / 6;
  int base = quad * ${TEXELS_PER_INSTANCE};
  vec4 a_dst = instanceTexel(base);
  vec4 a_src = instanceTexel(base + 1);
  vec4 a_misc = instanceTexel(base + 2);
  vec2 c = CORNERS[gl_VertexID - quad * 6];
  vec2 p = a_dst.xy + u_offset + c * a_dst.zw;
  v_src = a_src.xy + c * a_dst.zw;
  v_screen = p;
  v_layer = int(a_src.z);
  int key = int(a_misc.y);
  int row = int(a_src.w);
  if (key >= ${ShadeKey.NATURAL}) {
    row += u_natural;
  } else if (key >= 0) {
    int cell = key % ${WORLD_MAX};
    uvec4 shade = texelFetch(u_shade, ivec2(cell % ${WORLD_COLS}, cell / ${WORLD_COLS}), 0);
    row += int(key >= ${ShadeKey.ROOF_BASE} ? shade.g : shade.r);
  }
  v_row = row;
  v_flags = int(a_misc.z);
  int rgb = int(a_misc.w);
  v_outline = vec3(float((rgb >> 16) & 255), float((rgb >> 8) & 255), float(rgb & 255)) / 255.0;
  vec2 lo = a_dst.xy + u_offset;
  vec2 hi = lo + a_dst.zw;
  if (hi.x <= 0.0 || hi.y <= 0.0 || lo.x >= u_viewport.x || lo.y >= u_viewport.y) {
    gl_Position = vec4(0.0, 0.0, 0.0, 0.0);
    return;
  }
  gl_Position = vec4(p / u_viewport * vec2(2.0, -2.0) + vec2(-1.0, 1.0), a_misc.x / 65535.0 * 2.0 - 1.0, 1.0);
}`;

const FRAGMENT = `#version 300 es
precision highp float;
precision highp int;
precision highp usampler2DArray;
uniform usampler2DArray u_atlas;
uniform sampler2D u_palette;
uniform float u_shadow;
in vec2 v_src;
in vec2 v_screen;
flat in int v_layer;
flat in int v_row;
flat in int v_flags;
flat in vec3 v_outline;
out vec4 o_color;
void main() {
  uint index = texelFetch(u_atlas, ivec3(ivec2(floor(v_src)), v_layer), 0).r;
  if (index == 0u) discard;
  bool outlinePixel = index == 254u;
  if ((v_flags & ${InstanceFlags.ONLY_SHADOW_INDEX}) != 0 && !outlinePixel) discard;
  if ((v_flags & ${InstanceFlags.EXCEPT_SHADOW_INDEX}) != 0 && outlinePixel) discard;
  if ((v_flags & ${InstanceFlags.DITHER}) != 0) {
    ivec2 px = ivec2(floor(v_screen));
    if (((px.x + px.y) & 1) != 0) discard;
  }
  if (u_shadow > 0.0) {
    o_color = vec4(vec3(u_shadow), 1.0);
    return;
  }
  if ((v_flags & ${InstanceFlags.OUTLINE_SHADOW_INDEX}) != 0 && outlinePixel) {
    o_color = vec4(v_outline, 1.0);
    return;
  }
  o_color = vec4(texelFetch(u_palette, ivec2(int(index), v_row), 0).rgb, 1.0);
}`;

const QUAD_VERTICES = 6;
const ATLAS_UNIT = 0;
const PALETTE_UNIT = 1;
const SHADE_UNIT = 2;
const INSTANCE_UNIT = 3;
const RGBA = 4;
const SHADE_CHANNELS = 2;

type BlendMode = 'none' | 'shadow' | 'translucent';

interface StateSpec {
  readonly func: number | null;
  readonly write: boolean;
  readonly blend: BlendMode;
}

const TRANSLUCENT_ALPHA = 0.5;

function stateSpecs(gl: WebGL2RenderingContext): Record<DrawState, StateSpec> {
  return {
    [DrawState.LAND]: { func: null, write: false, blend: 'none' },
    [DrawState.NEARER_OR_EQUAL_WRITE]: { func: gl.GEQUAL, write: true, blend: 'none' },
    [DrawState.NEARER_WRITE]: { func: gl.GREATER, write: true, blend: 'none' },
    [DrawState.SHADOW_WRITE]: { func: gl.GREATER, write: true, blend: 'shadow' },
    [DrawState.SHADOW_FLAT]: { func: null, write: false, blend: 'shadow' },
    [DrawState.NEARER_OR_EQUAL]: { func: gl.GEQUAL, write: false, blend: 'none' },
    [DrawState.NEARER_SHADOW]: { func: gl.GREATER, write: false, blend: 'shadow' },
    [DrawState.FARTHER]: { func: gl.LESS, write: false, blend: 'none' },
    [DrawState.FARTHER_OR_EQUAL]: { func: gl.LEQUAL, write: false, blend: 'none' },
    [DrawState.ALWAYS_WRITE]: { func: gl.ALWAYS, write: true, blend: 'none' },
    [DrawState.TRANSLUCENT]: { func: gl.GEQUAL, write: false, blend: 'translucent' },
  };
}

export class InstanceStream {
  readonly #gl: WebGL2RenderingContext;
  #texture: WebGLTexture | null = null;
  #rows = 0;
  #staging = new Float32Array(0);

  constructor(gl: WebGL2RenderingContext) {
    this.#gl = gl;
  }

  get texture(): WebGLTexture | null {
    return this.#texture;
  }

  upload(data: Float32Array, count: number): void {
    const gl = this.#gl;
    const texels = count * TEXELS_PER_INSTANCE;
    const rows = Math.max(1, Math.ceil(texels / INSTANCE_TEXTURE_WIDTH));
    if (!this.#texture || rows > this.#rows) {
      if (this.#texture) gl.deleteTexture(this.#texture);
      this.#rows = Math.max(rows, this.#rows * 2);
      this.#texture = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, this.#texture);
      gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA32F, INSTANCE_TEXTURE_WIDTH, this.#rows);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    }
    if (count === 0) return;
    const floats = rows * INSTANCE_TEXTURE_WIDTH * RGBA;
    if (this.#staging.length < floats) this.#staging = new Float32Array(Math.max(floats, this.#staging.length * 2));
    this.#staging.set(data.subarray(0, count * FLOATS_PER_INSTANCE));
    gl.bindTexture(gl.TEXTURE_2D, this.#texture);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, RGBA);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, INSTANCE_TEXTURE_WIDTH, rows, gl.RGBA, gl.FLOAT, this.#staging, 0);
  }

  dispose(): void {
    if (this.#texture) this.#gl.deleteTexture(this.#texture);
    this.#texture = null;
  }
}

export interface ProgramFrame {
  readonly viewport: { readonly width: number; readonly height: number };
  readonly offset: { readonly x: number; readonly y: number };
  readonly natural: number;
  readonly atlas: WebGLTexture;
  readonly palette: WebGLTexture;
  readonly shade: WebGLTexture;
}

export class WorldProgram {
  readonly #gl: WebGL2RenderingContext;
  readonly #program: WebGLProgram;
  readonly #specs: Record<DrawState, StateSpec>;
  readonly #viewport: WebGLUniformLocation;
  readonly #offset: WebGLUniformLocation;
  readonly #natural: WebGLUniformLocation;
  readonly #shadow: WebGLUniformLocation;
  readonly #vao: WebGLVertexArrayObject;
  #bound: InstanceStream | null = null;
  #drawCalls = 0;
  #instances = 0;
  #blend: BlendMode = 'none';

  constructor(gl: WebGL2RenderingContext) {
    this.#gl = gl;
    this.#program = createProgram(gl, VERTEX, FRAGMENT);
    this.#specs = stateSpecs(gl);
    this.#viewport = uniform(gl, this.#program, 'u_viewport');
    this.#offset = uniform(gl, this.#program, 'u_offset');
    this.#natural = uniform(gl, this.#program, 'u_natural');
    this.#shadow = uniform(gl, this.#program, 'u_shadow');
    gl.useProgram(this.#program);
    gl.uniform1i(uniform(gl, this.#program, 'u_atlas'), ATLAS_UNIT);
    gl.uniform1i(uniform(gl, this.#program, 'u_palette'), PALETTE_UNIT);
    gl.uniform1i(uniform(gl, this.#program, 'u_shade'), SHADE_UNIT);
    gl.uniform1i(uniform(gl, this.#program, 'u_instances'), INSTANCE_UNIT);
    this.#vao = gl.createVertexArray();
  }

  get drawCalls(): number {
    return this.#drawCalls;
  }

  get instances(): number {
    return this.#instances;
  }

  begin(f: ProgramFrame): void {
    const gl = this.#gl;
    this.#drawCalls = 0;
    this.#instances = 0;
    gl.useProgram(this.#program);
    gl.uniform2f(this.#viewport, f.viewport.width, f.viewport.height);
    gl.uniform2f(this.#offset, f.offset.x, f.offset.y);
    gl.uniform1i(this.#natural, f.natural);
    gl.uniform1f(this.#shadow, 0);
    this.#blend = 'none';
    gl.activeTexture(gl.TEXTURE0 + ATLAS_UNIT);
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, f.atlas);
    gl.activeTexture(gl.TEXTURE0 + PALETTE_UNIT);
    gl.bindTexture(gl.TEXTURE_2D, f.palette);
    gl.activeTexture(gl.TEXTURE0 + SHADE_UNIT);
    gl.bindTexture(gl.TEXTURE_2D, f.shade);
    gl.disable(gl.BLEND);
    gl.disable(gl.SCISSOR_TEST);
    gl.bindVertexArray(this.#vao);
    this.#bound = null;
  }

  #apply(state: DrawState): void {
    const gl = this.#gl;
    const s = this.#specs[state];
    if (s.func === null) gl.disable(gl.DEPTH_TEST);
    else {
      gl.enable(gl.DEPTH_TEST);
      gl.depthFunc(s.func);
    }
    gl.depthMask(s.write);
    if (s.blend !== this.#blend) this.#setBlend(s.blend);
  }

  #setBlend(mode: BlendMode): void {
    const gl = this.#gl;
    if ((mode === 'shadow') !== (this.#blend === 'shadow')) gl.uniform1f(this.#shadow, mode === 'shadow' ? SHADOW_FACTOR : 0);
    this.#blend = mode;
    if (mode === 'none') {
      gl.disable(gl.BLEND);
      return;
    }
    gl.enable(gl.BLEND);
    if (mode === 'shadow') gl.blendFunc(gl.ZERO, gl.SRC_COLOR);
    else {
      gl.blendColor(0, 0, 0, TRANSLUCENT_ALPHA);
      gl.blendFunc(gl.CONSTANT_ALPHA, gl.ONE_MINUS_CONSTANT_ALPHA);
    }
  }

  draw(stream: InstanceStream, state: DrawState, first: number, count: number): void {
    if (count <= 0 || !stream.texture) return;
    const gl = this.#gl;
    this.#apply(state);
    if (this.#bound !== stream) {
      gl.activeTexture(gl.TEXTURE0 + INSTANCE_UNIT);
      gl.bindTexture(gl.TEXTURE_2D, stream.texture);
      this.#bound = stream;
    }
    gl.drawArrays(gl.TRIANGLES, first * QUAD_VERTICES, count * QUAD_VERTICES);
    this.#drawCalls++;
    this.#instances += count;
  }

  end(): void {
    const gl = this.#gl;
    gl.bindVertexArray(null);
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.BLEND);
    gl.depthMask(true);
  }
}

export class ShadeTexture {
  readonly texture: WebGLTexture;
  readonly #gl: WebGL2RenderingContext;
  readonly #data = new Uint8Array(WORLD_MAX * SHADE_CHANNELS);

  constructor(gl: WebGL2RenderingContext) {
    this.#gl = gl;
    this.texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this.texture);
    gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RG8UI, WORLD_COLS, WORLD_ROWS);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  }

  upload(land: Uint8Array, roof: Uint8Array): void {
    for (let g = 0; g < WORLD_MAX; g++) {
      this.#data[g * SHADE_CHANNELS] = land[g] as number;
      this.#data[g * SHADE_CHANNELS + 1] = roof[g] as number;
    }
    const gl = this.#gl;
    gl.bindTexture(gl.TEXTURE_2D, this.texture);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, WORLD_COLS, WORLD_ROWS, gl.RG_INTEGER, gl.UNSIGNED_BYTE, this.#data);
  }

  dispose(): void {
    this.#gl.deleteTexture(this.texture);
  }
}

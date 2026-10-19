import type { Sti } from '../../content/formats/sti.ts';
import type { Area, AssetKey, DrawItem, FontId } from '../../ui/draw-list.ts';
import { createProgram, uniform } from '../gl.ts';
import { FLOATS_PER_INSTANCE, type UiBatch, type UiDrawPlan, UiDrawPlanner } from './ui-plan.ts';
import { UI_FRAGMENT, UI_VERTEX } from './ui-shader.ts';
import { UiTextures } from './ui-textures.ts';

const BYTES_PER_FLOAT = 4;
const ATTRIBUTE_VECTORS = 6;
const FLOATS_PER_VECTOR = 4;
const QUAD_VERTICES = 6;
const INDEX_UNIT = 0;
const RGB_UNIT = 1;
const PALETTE_UNIT = 2;

export interface UiDrawStats {
  readonly instances: number;
  readonly batches: number;
  readonly missingImages: readonly AssetKey[];
  readonly missingFonts: readonly FontId[];
  readonly multiplyAreas: readonly Area[];
}

export class UiRenderer {
  readonly textures: UiTextures;
  readonly #gl: WebGL2RenderingContext;
  readonly #program: WebGLProgram;
  readonly #viewport: WebGLUniformLocation;
  readonly #vao: WebGLVertexArrayObject;
  readonly #buffer: WebGLBuffer;
  readonly #emptyIndex: WebGLTexture;
  readonly #emptyRgb: WebGLTexture;
  readonly #planner = new UiDrawPlanner();
  #stats: UiDrawStats = { instances: 0, batches: 0, missingImages: [], missingFonts: [], multiplyAreas: [] };

  constructor(gl: WebGL2RenderingContext) {
    this.#gl = gl;
    this.textures = new UiTextures(gl);
    this.#program = createProgram(gl, UI_VERTEX, UI_FRAGMENT);
    this.#viewport = uniform(gl, this.#program, 'u_viewport');
    gl.useProgram(this.#program);
    gl.uniform1i(uniform(gl, this.#program, 'u_index'), INDEX_UNIT);
    gl.uniform1i(uniform(gl, this.#program, 'u_rgb'), RGB_UNIT);
    gl.uniform1i(uniform(gl, this.#program, 'u_palette'), PALETTE_UNIT);
    this.#vao = gl.createVertexArray();
    this.#buffer = gl.createBuffer();
    this.#emptyIndex = this.#emptyTexture(gl.R8UI);
    this.#emptyRgb = this.#emptyTexture(gl.RGB565);
  }

  get stats(): UiDrawStats {
    return this.#stats;
  }

  #emptyTexture(format: number): WebGLTexture {
    const gl = this.#gl;
    const texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texStorage2D(gl.TEXTURE_2D, 1, format, 1, 1);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    return texture;
  }

  addImage(key: AssetKey, sti: Sti): void {
    this.textures.addImage(key, sti);
  }

  addFont(id: FontId, sti: Sti): void {
    this.textures.addFont(id, sti);
  }

  #pointAttributes(firstInstance: number): void {
    const gl = this.#gl;
    const stride = FLOATS_PER_INSTANCE * BYTES_PER_FLOAT;
    for (let location = 0; location < ATTRIBUTE_VECTORS; location++) {
      const offset = (firstInstance * FLOATS_PER_INSTANCE + location * FLOATS_PER_VECTOR) * BYTES_PER_FLOAT;
      gl.enableVertexAttribArray(location);
      gl.vertexAttribPointer(location, FLOATS_PER_VECTOR, gl.FLOAT, false, stride, offset);
      gl.vertexAttribDivisor(location, 1);
    }
  }

  #bindBatch(batch: UiBatch, height: number): void {
    const gl = this.#gl;
    gl.activeTexture(gl.TEXTURE0 + INDEX_UNIT);
    gl.bindTexture(gl.TEXTURE_2D, batch.indexPage === null ? this.#emptyIndex : this.textures.atlas.texture(batch.indexPage));
    gl.activeTexture(gl.TEXTURE0 + RGB_UNIT);
    gl.bindTexture(gl.TEXTURE_2D, batch.rgb?.texture ?? this.#emptyRgb);
    if (batch.multiply) gl.blendFunc(gl.ZERO, gl.SRC_COLOR);
    else gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    if (batch.clip) {
      gl.enable(gl.SCISSOR_TEST);
      gl.scissor(batch.clip.x, height - batch.clip.y - batch.clip.height, batch.clip.width, batch.clip.height);
    } else {
      gl.disable(gl.SCISSOR_TEST);
    }
  }

  #execute(plan: UiDrawPlan, width: number, height: number): void {
    const gl = this.#gl;
    gl.viewport(0, 0, width, height);
    gl.disable(gl.DEPTH_TEST);
    gl.enable(gl.BLEND);
    gl.useProgram(this.#program);
    gl.uniform2f(this.#viewport, width, height);
    gl.activeTexture(gl.TEXTURE0 + PALETTE_UNIT);
    gl.bindTexture(gl.TEXTURE_2D, this.textures.palettes.texture);
    gl.bindVertexArray(this.#vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.#buffer);
    gl.bufferData(gl.ARRAY_BUFFER, plan.data, gl.STREAM_DRAW);
    for (const batch of plan.batches) {
      this.#bindBatch(batch, height);
      this.#pointAttributes(batch.first);
      gl.drawArraysInstanced(gl.TRIANGLES, 0, QUAD_VERTICES, batch.count);
    }
    gl.disable(gl.SCISSOR_TEST);
    gl.bindVertexArray(null);
  }

  draw(items: readonly DrawItem[], width: number, height: number): UiDrawStats {
    const textures = this.textures;
    const plan = this.#planner.plan(items, width, height, {
      image: (key) => textures.image(key),
      font: (id) => textures.font(id),
      paletteRow: (image, shade) => textures.paletteRow(image, shade),
    });
    if (plan.instances > 0) this.#execute(plan, width, height);
    this.#stats = {
      instances: plan.instances,
      batches: plan.batches.length,
      missingImages: [...plan.missingImages],
      missingFonts: [...plan.missingFonts],
      multiplyAreas: plan.multiplyAreas,
    };
    return this.#stats;
  }
}

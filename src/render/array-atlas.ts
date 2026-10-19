import { ShelfPacker } from './shelf-packer.ts';

const PREFERRED_LAYER_SIZE = 4096;
const INITIAL_LAYERS = 1;

export interface ArrayRegion {
  readonly layer: number;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

interface Upload {
  readonly region: ArrayRegion;
  readonly pixels: Uint8Array;
}

export class ArrayAtlas {
  readonly size: number;
  readonly #gl: WebGL2RenderingContext;
  readonly #packer: ShelfPacker;
  readonly #uploads: Upload[] = [];
  #texture: WebGLTexture | null = null;
  #capacity = 0;
  #uploaded = 0;

  constructor(gl: WebGL2RenderingContext, preferredSize = PREFERRED_LAYER_SIZE) {
    this.#gl = gl;
    this.size = Math.min(preferredSize, gl.getParameter(gl.MAX_TEXTURE_SIZE) as number);
    this.#packer = new ShelfPacker(this.size);
  }

  get layerCount(): number {
    return this.#packer.layers.length;
  }

  add(width: number, height: number, pixels: Uint8Array): ArrayRegion {
    const at = this.#packer.place(Math.max(width, 1), Math.max(height, 1));
    const region = { layer: at.layer, x: at.x, y: at.y, width, height };
    if (width > 0 && height > 0) this.#uploads.push({ region, pixels });
    return region;
  }

  texture(): WebGLTexture {
    const needed = Math.max(this.layerCount, INITIAL_LAYERS);
    if (!this.#texture || needed > this.#capacity) this.#allocate(Math.max(needed, this.#capacity * 2));
    this.#flush();
    return this.#texture as WebGLTexture;
  }

  #allocate(layers: number): void {
    const gl = this.#gl;
    if (this.#texture) gl.deleteTexture(this.#texture);
    const texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, texture);
    gl.texStorage3D(gl.TEXTURE_2D_ARRAY, 1, gl.R8UI, this.size, this.size, layers);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    this.#texture = texture;
    this.#capacity = layers;
    this.#uploaded = 0;
  }

  #flush(): void {
    if (this.#uploaded === this.#uploads.length) return;
    const gl = this.#gl;
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, this.#texture);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    for (let i = this.#uploaded; i < this.#uploads.length; i++) {
      const { region: r, pixels } = this.#uploads[i] as Upload;
      gl.texSubImage3D(gl.TEXTURE_2D_ARRAY, 0, r.x, r.y, r.layer, r.width, r.height, 1, gl.RED_INTEGER, gl.UNSIGNED_BYTE, pixels);
    }
    this.#uploaded = this.#uploads.length;
  }

  dispose(): void {
    if (this.#texture) this.#gl.deleteTexture(this.#texture);
    this.#texture = null;
    this.#capacity = 0;
    this.#uploaded = 0;
    this.#uploads.length = 0;
    this.#packer.clear();
  }
}

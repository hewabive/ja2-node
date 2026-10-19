const COLOURS = 256;
const RGB = 3;
const RGBA = 4;
const INITIAL_ROWS = 256;
const TRANSPARENT_INDEX = 0;

export class PaletteRows {
  readonly #gl: WebGL2RenderingContext;
  readonly #maxRows: number;
  #data = new Uint8Array(INITIAL_ROWS * COLOURS * RGBA);
  #rows = 0;
  #texture: WebGLTexture | null = null;
  #capacity = 0;
  #uploadedRows = 0;

  constructor(gl: WebGL2RenderingContext) {
    this.#gl = gl;
    this.#maxRows = gl.getParameter(gl.MAX_TEXTURE_SIZE) as number;
  }

  get rowCount(): number {
    return this.#rows;
  }

  add(rgb: Uint8Array): number {
    if (rgb.length !== COLOURS * RGB) throw new RangeError('a palette row needs 256 RGB colours');
    if (this.#rows >= this.#maxRows) throw new RangeError('the palette texture is full');
    this.#reserve(this.#rows + 1);
    const base = this.#rows * COLOURS * RGBA;
    for (let i = 0; i < COLOURS; i++) {
      this.#data[base + i * RGBA] = rgb[i * RGB] as number;
      this.#data[base + i * RGBA + 1] = rgb[i * RGB + 1] as number;
      this.#data[base + i * RGBA + 2] = rgb[i * RGB + 2] as number;
      this.#data[base + i * RGBA + 3] = i === TRANSPARENT_INDEX ? 0 : 255;
    }
    return this.#rows++;
  }

  #reserve(rows: number): void {
    const needed = rows * COLOURS * RGBA;
    if (needed <= this.#data.length) return;
    const grown = new Uint8Array(Math.max(needed, this.#data.length * 2));
    grown.set(this.#data);
    this.#data = grown;
  }

  texture(): WebGLTexture {
    const gl = this.#gl;
    const needed = Math.max(this.#rows, 1);
    if (!this.#texture || needed > this.#capacity) {
      if (this.#texture) gl.deleteTexture(this.#texture);
      this.#capacity = Math.min(this.#maxRows, Math.max(needed, this.#capacity * 2, INITIAL_ROWS));
      this.#texture = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, this.#texture);
      gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA8, COLOURS, this.#capacity);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      this.#uploadedRows = 0;
    }
    if (this.#uploadedRows < this.#rows) {
      gl.bindTexture(gl.TEXTURE_2D, this.#texture);
      gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
      const from = this.#uploadedRows;
      const count = this.#rows - from;
      const view = this.#data.subarray(from * COLOURS * RGBA, this.#rows * COLOURS * RGBA);
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, from, COLOURS, count, gl.RGBA, gl.UNSIGNED_BYTE, view);
      this.#uploadedRows = this.#rows;
    }
    return this.#texture;
  }

  dispose(): void {
    if (this.#texture) this.#gl.deleteTexture(this.#texture);
    this.#texture = null;
    this.#capacity = 0;
    this.#uploadedRows = 0;
    this.#rows = 0;
  }
}

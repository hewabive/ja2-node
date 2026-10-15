export class PaletteTexture {
  readonly maxRows: number;
  readonly texture: WebGLTexture;
  readonly #gl: WebGL2RenderingContext;
  #rows = 0;

  constructor(gl: WebGL2RenderingContext, maxRows = 1024) {
    this.#gl = gl;
    this.maxRows = maxRows;
    this.texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this.texture);
    gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA8, 256, maxRows);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  }

  add(rgb: Uint8Array): number {
    if (rgb.length !== 768) throw new RangeError('palette must have 256 RGB colours');
    if (this.#rows >= this.maxRows) throw new RangeError('palette texture is full');
    const rgba = new Uint8Array(256 * 4);
    for (let i = 0; i < 256; i++) {
      rgba[i * 4] = rgb[i * 3] as number;
      rgba[i * 4 + 1] = rgb[i * 3 + 1] as number;
      rgba[i * 4 + 2] = rgb[i * 3 + 2] as number;
      rgba[i * 4 + 3] = i === 0 ? 0 : 255;
    }
    const gl = this.#gl;
    gl.bindTexture(gl.TEXTURE_2D, this.texture);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, this.#rows, 256, 1, gl.RGBA, gl.UNSIGNED_BYTE, rgba);
    return this.#rows++;
  }

  clear(): void {
    this.#rows = 0;
  }
}

export type AtlasFormat = 'index' | 'rgba';

export interface AtlasRegion {
  readonly page: number;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

interface Page {
  readonly texture: WebGLTexture;
  shelfY: number;
  shelfH: number;
  cursorX: number;
}

const PAD = 1;

export class TextureAtlas {
  readonly format: AtlasFormat;
  readonly size: number;
  readonly #gl: WebGL2RenderingContext;
  readonly #pages: Page[] = [];

  constructor(gl: WebGL2RenderingContext, format: AtlasFormat, size = 2048) {
    this.#gl = gl;
    this.format = format;
    this.size = Math.min(size, gl.getParameter(gl.MAX_TEXTURE_SIZE) as number);
  }

  get pageCount(): number {
    return this.#pages.length;
  }

  texture(page: number): WebGLTexture {
    const p = this.#pages[page];
    if (!p) throw new RangeError(`no atlas page ${page}`);
    return p.texture;
  }

  #newPage(): Page {
    const gl = this.#gl;
    const texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, texture);
    if (this.format === 'index') {
      gl.texStorage2D(gl.TEXTURE_2D, 1, gl.R8UI, this.size, this.size);
    } else {
      gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA8, this.size, this.size);
    }
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    const page: Page = { texture, shelfY: 0, shelfH: 0, cursorX: 0 };
    this.#pages.push(page);
    return page;
  }

  #place(w: number, h: number): { page: number; x: number; y: number } {
    if (w + PAD > this.size || h + PAD > this.size) throw new RangeError(`image ${w}×${h} does not fit into ${this.size}² atlas`);
    for (let i = 0; i < this.#pages.length; i++) {
      const p = this.#pages[i] as Page;
      if (p.cursorX + w + PAD > this.size) {
        p.shelfY += p.shelfH;
        p.shelfH = 0;
        p.cursorX = 0;
      }
      if (p.shelfY + h + PAD <= this.size) {
        const at = { page: i, x: p.cursorX, y: p.shelfY };
        p.cursorX += w + PAD;
        p.shelfH = Math.max(p.shelfH, h + PAD);
        return at;
      }
    }
    this.#newPage();
    return this.#place(w, h);
  }

  add(width: number, height: number, pixels: Uint8Array): AtlasRegion {
    const at = this.#place(Math.max(width, 1), Math.max(height, 1));
    if (width > 0 && height > 0) {
      const gl = this.#gl;
      gl.bindTexture(gl.TEXTURE_2D, this.texture(at.page));
      gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
      if (this.format === 'index') {
        gl.texSubImage2D(gl.TEXTURE_2D, 0, at.x, at.y, width, height, gl.RED_INTEGER, gl.UNSIGNED_BYTE, pixels);
      } else {
        gl.texSubImage2D(gl.TEXTURE_2D, 0, at.x, at.y, width, height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
      }
    }
    return { page: at.page, x: at.x, y: at.y, width, height };
  }

  clear(): void {
    for (const p of this.#pages) this.#gl.deleteTexture(p.texture);
    this.#pages.length = 0;
  }
}

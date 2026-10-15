export class IndexedRaster {
  readonly width: number;
  readonly height: number;
  readonly pixels: Uint8Array;

  constructor(width: number, height: number) {
    this.width = width;
    this.height = height;
    this.pixels = new Uint8Array(width * height);
  }

  set(x: number, y: number, c: number): void {
    const xi = Math.round(x);
    const yi = Math.round(y);
    if (xi < 0 || yi < 0 || xi >= this.width || yi >= this.height) return;
    this.pixels[yi * this.width + xi] = c;
  }

  get(x: number, y: number): number {
    if (x < 0 || y < 0 || x >= this.width || y >= this.height) return 0;
    return this.pixels[y * this.width + x] ?? 0;
  }

  rect(x: number, y: number, w: number, h: number, c: number): void {
    for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) this.set(i, j, c);
  }

  frame(x: number, y: number, w: number, h: number, c: number): void {
    for (let i = x; i < x + w; i++) {
      this.set(i, y, c);
      this.set(i, y + h - 1, c);
    }
    for (let j = y; j < y + h; j++) {
      this.set(x, j, c);
      this.set(x + w - 1, j, c);
    }
  }

  ellipse(cx: number, cy: number, rx: number, ry: number, shade: (nx: number, ny: number) => number): void {
    for (let y = Math.floor(cy - ry); y <= Math.ceil(cy + ry); y++) {
      for (let x = Math.floor(cx - rx); x <= Math.ceil(cx + rx); x++) {
        const nx = (x - cx) / rx;
        const ny = (y - cy) / ry;
        if (nx * nx + ny * ny <= 1) this.set(x, y, shade(nx, ny));
      }
    }
  }

  line(x0: number, y0: number, x1: number, y1: number, c: number): void {
    const steps = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0), 1);
    for (let i = 0; i <= steps; i++) this.set(x0 + ((x1 - x0) * i) / steps, y0 + ((y1 - y0) * i) / steps, c);
  }

  outline(c: number): void {
    const src = this.pixels.slice();
    for (let y = 0; y < this.height; y++) {
      for (let x = 0; x < this.width; x++) {
        if (src[y * this.width + x] !== 0) continue;
        const near = [
          [1, 0],
          [-1, 0],
          [0, 1],
          [0, -1],
        ].some(([dx, dy]) => {
          const xx = x + (dx ?? 0);
          const yy = y + (dy ?? 0);
          return xx >= 0 && yy >= 0 && xx < this.width && yy < this.height && src[yy * this.width + xx] !== 0;
        });
        if (near) this.pixels[y * this.width + x] = c;
      }
    }
  }
}

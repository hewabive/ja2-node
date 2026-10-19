const PAD = 1;

export interface AtlasLayer {
  shelfY: number;
  shelfHeight: number;
  cursorX: number;
}

export interface Placement {
  readonly layer: number;
  readonly x: number;
  readonly y: number;
}

export class ShelfPacker {
  readonly size: number;
  readonly layers: AtlasLayer[] = [];

  constructor(size: number) {
    this.size = size;
  }

  place(width: number, height: number): Placement {
    if (width + PAD > this.size || height + PAD > this.size) {
      throw new RangeError(`image ${width}×${height} does not fit into a ${this.size}² atlas layer`);
    }
    for (let i = 0; i < this.layers.length; i++) {
      const at = this.#tryLayer(this.layers[i] as AtlasLayer, i, width, height);
      if (at) return at;
    }
    const fresh: AtlasLayer = { shelfY: 0, shelfHeight: 0, cursorX: 0 };
    this.layers.push(fresh);
    return this.#tryLayer(fresh, this.layers.length - 1, width, height) as Placement;
  }

  #tryLayer(l: AtlasLayer, index: number, width: number, height: number): Placement | null {
    if (l.cursorX + width + PAD > this.size) {
      if (l.shelfY + l.shelfHeight + height + PAD > this.size) return null;
      l.shelfY += l.shelfHeight;
      l.shelfHeight = 0;
      l.cursorX = 0;
    }
    if (l.shelfY + height + PAD > this.size) return null;
    const at = { layer: index, x: l.cursorX, y: l.shelfY };
    l.cursorX += width + PAD;
    l.shelfHeight = Math.max(l.shelfHeight, height + PAD);
    return at;
  }

  clear(): void {
    this.layers.length = 0;
  }
}

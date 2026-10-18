const GOLDEN = 0x9e3779b9;
const UINT32_RANGE = 0x1_0000_0000;

export function seedFromText(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 0x01000193) >>> 0;
  return h;
}

export class ClientRandom {
  #state: number;

  constructor(seed: number) {
    this.#state = seed >>> 0;
  }

  next(): number {
    this.#state = (this.#state + GOLDEN) >>> 0;
    let z = this.#state;
    z = Math.imul(z ^ (z >>> 16), 0x85ebca6b) >>> 0;
    z = Math.imul(z ^ (z >>> 13), 0xc2b2ae35) >>> 0;
    return (z ^ (z >>> 16)) >>> 0;
  }

  int(n: number): number {
    return n <= 0 ? 0 : Math.floor((this.next() / UINT32_RANGE) * n);
  }

  readonly rand = (n: number): number => this.int(n);
}

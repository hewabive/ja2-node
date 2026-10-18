const TWO_POW_16 = 0x10000;

function rotl(x: number, k: number): number {
  return (x << k) | (x >>> (32 - k));
}

export function scaleU32ToRange(x: number, n: number): number {
  const lo = (x & 0xffff) * n;
  const hi = (x >>> 16) * n;
  return Math.floor((hi + Math.floor(lo / TWO_POW_16)) / TWO_POW_16);
}

function splitmix32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x9e3779b9) >>> 0;
    let t = Math.imul(state ^ (state >>> 16), 0x21f0aaad);
    t = Math.imul(t ^ (t >>> 15), 0x735a2d97);
    return (t ^ (t >>> 15)) >>> 0;
  };
}

function checkRange(n: number): void {
  if (!Number.isInteger(n) || n < 0 || n > 0x1_0000_0000) {
    throw new RangeError(`random range must be an integer in [0, 2^32], got ${n}`);
  }
}

function checkRngWords(...words: readonly number[]): void {
  if (words.some((w) => !Number.isInteger(w))) throw new RangeError('xoshiro128** state must be four integers');
  if (words.every((w) => w >>> 0 === 0)) throw new RangeError('xoshiro128** state must not be all zero');
}

export interface RngState {
  readonly s: readonly [number, number, number, number];
}

export class Rng {
  #s0: number;
  #s1: number;
  #s2: number;
  #s3: number;

  private constructor(s0: number, s1: number, s2: number, s3: number) {
    checkRngWords(s0, s1, s2, s3);
    this.#s0 = s0 >>> 0;
    this.#s1 = s1 >>> 0;
    this.#s2 = s2 >>> 0;
    this.#s3 = s3 >>> 0;
  }

  static fromSeed(seed: number): Rng {
    const next = splitmix32(seed);
    return new Rng(next(), next(), next(), next());
  }

  static fromState(state: RngState): Rng {
    const [a, b, c, d] = state.s;
    return new Rng(a, b, c, d);
  }

  state(): RngState {
    return { s: [this.#s0, this.#s1, this.#s2, this.#s3] };
  }

  restore(state: RngState): void {
    const [a, b, c, d] = state.s;
    checkRngWords(a, b, c, d);
    this.#s0 = a >>> 0;
    this.#s1 = b >>> 0;
    this.#s2 = c >>> 0;
    this.#s3 = d >>> 0;
  }

  nextU32(): number {
    const s0 = this.#s0;
    const s1 = this.#s1;
    const result = Math.imul(rotl(Math.imul(s1, 5), 7), 9) >>> 0;
    const t = s1 << 9;
    let s2 = this.#s2 ^ s0;
    let s3 = this.#s3 ^ s1;
    this.#s1 = (s1 ^ s2) >>> 0;
    this.#s0 = (s0 ^ s3) >>> 0;
    s2 ^= t;
    s3 = rotl(s3, 11);
    this.#s2 = s2 >>> 0;
    this.#s3 = s3 >>> 0;
    return result;
  }

  int(n: number): number {
    checkRange(n);
    return n === 0 ? 0 : scaleU32ToRange(this.nextU32(), n);
  }

  chance(percent: number): boolean {
    return this.int(100) < percent;
  }

  coinToss(): boolean {
    return (this.nextU32() & 1) === 1;
  }
}

export const PRE_RANDOM_RING_SIZE = 256;

export interface PreRandomState {
  readonly ring: readonly number[];
  readonly index: number;
}

function checkPreRandomState(state: PreRandomState): void {
  if (state.ring.length !== PRE_RANDOM_RING_SIZE) {
    throw new RangeError(`PreRandom ring must have ${PRE_RANDOM_RING_SIZE} numbers`);
  }
  if (!Number.isInteger(state.index) || state.index < 0 || state.index >= PRE_RANDOM_RING_SIZE) {
    throw new RangeError(`PreRandom index out of range: ${state.index}`);
  }
}

export class PreRandom {
  readonly #ring: Uint32Array;
  #index: number;
  readonly #refill: Rng;

  private constructor(ring: Uint32Array, index: number, refill: Rng) {
    this.#ring = ring;
    this.#index = index;
    this.#refill = refill;
  }

  static create(refill: Rng): PreRandom {
    const ring = new Uint32Array(PRE_RANDOM_RING_SIZE);
    for (let i = 0; i < ring.length; i++) ring[i] = refill.nextU32();
    return new PreRandom(ring, 0, refill);
  }

  static fromState(state: PreRandomState, refill: Rng): PreRandom {
    checkPreRandomState(state);
    return new PreRandom(Uint32Array.from(state.ring), state.index, refill);
  }

  restore(state: PreRandomState): void {
    checkPreRandomState(state);
    this.#ring.set(state.ring);
    this.#index = state.index;
  }

  state(): PreRandomState {
    return { ring: Array.from(this.#ring), index: this.#index };
  }

  refillStream(): Rng {
    return this.#refill;
  }

  #take(): number {
    const index = this.#index;
    const value = this.#ring[index] ?? 0;
    this.#ring[index] = this.#refill.nextU32();
    this.#index = (index + 1) % PRE_RANDOM_RING_SIZE;
    return value;
  }

  int(n: number): number {
    checkRange(n);
    return n === 0 ? 0 : scaleU32ToRange(this.#take(), n);
  }

  chance(percent: number): boolean {
    return this.int(100) < percent;
  }
}

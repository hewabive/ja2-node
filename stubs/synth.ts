export type Wave = 'sine' | 'square' | 'saw' | 'triangle';

export interface Part {
  readonly at: number;
  readonly samples: Float32Array;
  readonly gain?: number;
}

const FNV_OFFSET = 0x811c9dc5;
const FNV_PRIME = 0x01000193;
const UINT32_RANGE = 0x1_0000_0000;
const TWO_PI = 2 * Math.PI;
const SQUARE_DUTY = 0.5;
const SILENT_PEAK = 1e-9;

export function seedOf(text: string): number {
  let hash = FNV_OFFSET;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, FNV_PRIME) >>> 0;
  }
  return hash === 0 ? 1 : hash;
}

export class StubRandom {
  #state: number;

  constructor(seed: string | number) {
    this.#state = (typeof seed === 'string' ? seedOf(seed) : seed >>> 0) || 1;
  }

  next(): number {
    let x = this.#state;
    x ^= x << 13;
    x >>>= 0;
    x ^= x >>> 17;
    x ^= x << 5;
    this.#state = x >>> 0;
    return this.#state / UINT32_RANGE;
  }

  signed(): number {
    return this.next() * 2 - 1;
  }

  range(min: number, max: number): number {
    return min + (max - min) * this.next();
  }

  pick<T>(items: readonly T[]): T {
    const item = items[Math.floor(this.next() * items.length)];
    if (item === undefined) throw new RangeError('cannot pick from an empty list');
    return item;
  }
}

export function frames(rate: number, seconds: number): number {
  return Math.max(1, Math.round(rate * seconds));
}

export function oscillator(wave: Wave, phase: number): number {
  const p = phase - Math.floor(phase);
  if (wave === 'sine') return Math.sin(TWO_PI * p);
  if (wave === 'square') return p < SQUARE_DUTY ? 1 : -1;
  if (wave === 'saw') return 2 * p - 1;
  return 1 - 4 * Math.abs(p - 0.5);
}

export function tone(rate: number, seconds: number, from: number, to: number, wave: Wave = 'sine'): Float32Array {
  const n = frames(rate, seconds);
  const out = new Float32Array(n);
  const glide = (to / from) ** (1 / n);
  let phase = 0;
  let frequency = from;
  for (let i = 0; i < n; i++) {
    out[i] = oscillator(wave, phase);
    phase += frequency / rate;
    frequency *= glide;
  }
  return out;
}

export function vibrato(rate: number, seconds: number, base: number, depth: number, speed: number, wave: Wave = 'sine'): Float32Array {
  const n = frames(rate, seconds);
  const out = new Float32Array(n);
  let phase = 0;
  for (let i = 0; i < n; i++) {
    out[i] = oscillator(wave, phase);
    phase += (base * (1 + depth * Math.sin((TWO_PI * speed * i) / rate))) / rate;
  }
  return out;
}

export function noise(rng: StubRandom, rate: number, seconds: number): Float32Array {
  const out = new Float32Array(frames(rate, seconds));
  for (let i = 0; i < out.length; i++) out[i] = rng.signed();
  return out;
}

export function crackle(rng: StubRandom, rate: number, seconds: number, density: number): Float32Array {
  const out = new Float32Array(frames(rate, seconds));
  for (let i = 0; i < out.length; i++) out[i] = rng.next() < density ? rng.signed() : 0;
  return out;
}

export function lowpass(x: Float32Array, rate: number, cutoff: number): Float32Array {
  const a = 1 - Math.exp((-TWO_PI * cutoff) / rate);
  const out = new Float32Array(x.length);
  let y = 0;
  for (let i = 0; i < x.length; i++) {
    y += a * ((x[i] ?? 0) - y);
    out[i] = y;
  }
  return out;
}

export function highpass(x: Float32Array, rate: number, cutoff: number): Float32Array {
  const out = lowpass(x, rate, cutoff);
  for (let i = 0; i < x.length; i++) out[i] = (x[i] ?? 0) - (out[i] ?? 0);
  return out;
}

export function bandpass(x: Float32Array, rate: number, centre: number, q: number): Float32Array {
  const w = (TWO_PI * centre) / rate;
  const alpha = Math.sin(w) / (2 * q);
  const a0 = 1 + alpha;
  const b0 = alpha / a0;
  const a1 = (-2 * Math.cos(w)) / a0;
  const a2 = (1 - alpha) / a0;
  const out = new Float32Array(x.length);
  let x1 = 0;
  let x2 = 0;
  let y1 = 0;
  let y2 = 0;
  for (let i = 0; i < x.length; i++) {
    const v = x[i] ?? 0;
    const y = b0 * v - b0 * x2 - a1 * y1 - a2 * y2;
    x2 = x1;
    x1 = v;
    y2 = y1;
    y1 = y;
    out[i] = y;
  }
  return out;
}

export function envelope(x: Float32Array, rate: number, attack: number, decay: number): Float32Array {
  const attackFrames = Math.max(1, Math.round(attack * rate));
  const fall = Math.exp(-1 / (decay * rate));
  const out = new Float32Array(x.length);
  let gain = 1;
  for (let i = 0; i < x.length; i++) {
    const v = x[i] ?? 0;
    if (i < attackFrames) {
      out[i] = (v * i) / attackFrames;
    } else {
      out[i] = v * gain;
      gain *= fall;
    }
  }
  return out;
}

export function fadeOut(x: Float32Array, rate: number, seconds: number): Float32Array {
  const n = Math.min(x.length, Math.round(seconds * rate));
  const out = Float32Array.from(x);
  for (let i = x.length - n; i < x.length; i++) out[i] = ((x[i] ?? 0) * (x.length - i)) / n;
  return out;
}

export function amplitude(x: Float32Array, rate: number, speed: number, depth: number): Float32Array {
  const out = new Float32Array(x.length);
  for (let i = 0; i < x.length; i++) out[i] = (x[i] ?? 0) * (1 - depth + depth * (0.5 + 0.5 * Math.sin((TWO_PI * speed * i) / rate)));
  return out;
}

export function scale(x: Float32Array, gain: number): Float32Array {
  const out = new Float32Array(x.length);
  for (let i = 0; i < x.length; i++) out[i] = (x[i] ?? 0) * gain;
  return out;
}

export function sequence(rate: number, parts: readonly Part[], minSeconds = 0): Float32Array {
  let length = frames(rate, minSeconds);
  for (const part of parts) length = Math.max(length, Math.round(part.at * rate) + part.samples.length);
  const out = new Float32Array(length);
  for (const part of parts) {
    const start = Math.round(part.at * rate);
    const gain = part.gain ?? 1;
    const samples = part.samples;
    for (let i = 0; i < samples.length; i++) out[start + i] = (out[start + i] ?? 0) + (samples[i] ?? 0) * gain;
  }
  return out;
}

export function mix(rate: number, ...layers: readonly (readonly [Float32Array, number])[]): Float32Array {
  return sequence(
    rate,
    layers.map(([samples, gain]) => ({ at: 0, samples, gain })),
  );
}

export function normalize(x: Float32Array, peak: number): Float32Array {
  let max = 0;
  for (let i = 0; i < x.length; i++) max = Math.max(max, Math.abs(x[i] ?? 0));
  if (max < SILENT_PEAK) return x;
  const out = new Float32Array(x.length);
  for (let i = 0; i < x.length; i++) out[i] = ((x[i] ?? 0) * peak) / max;
  return out;
}

export function formantVoice(rate: number, seconds: number, from: number, to: number, formant: number): Float32Array {
  const source = tone(rate, seconds, from, to, 'saw');
  const shaped = mix(rate, [bandpass(source, rate, formant, 4), 1], [bandpass(source, rate, formant * 2.4, 6), 0.5]);
  return fadeOut(envelope(shaped, rate, 0.02, seconds * 0.8), rate, 0.03);
}

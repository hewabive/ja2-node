import { describe, expect, it } from 'vitest';
import { PRE_RANDOM_RING_SIZE, PreRandom, Rng, scaleU32ToRange } from './rng.ts';

describe('Rng', () => {
  it('is deterministic per seed', () => {
    const a = Rng.fromSeed(42);
    const b = Rng.fromSeed(42);
    const xs = Array.from({ length: 100 }, () => a.nextU32());
    const ys = Array.from({ length: 100 }, () => b.nextU32());
    expect(xs).toEqual(ys);
    expect(new Set(xs).size).toBe(100);
    expect(Rng.fromSeed(43).nextU32()).not.toBe(xs[0]);
  });

  it('continues the same sequence from a saved state', () => {
    const a = Rng.fromSeed(7);
    for (let i = 0; i < 10; i++) a.nextU32();
    const b = Rng.fromState(JSON.parse(JSON.stringify(a.state())));
    for (let i = 0; i < 50; i++) expect(b.nextU32()).toBe(a.nextU32());
  });

  it('returns 0 for Random(0) and stays within [0, n)', () => {
    const r = Rng.fromSeed(1);
    expect(r.int(0)).toBe(0);
    for (let i = 0; i < 10_000; i++) {
      const v = r.int(6);
      expect(v >= 0 && v < 6 && Number.isInteger(v)).toBe(true);
    }
    expect(() => r.int(-1)).toThrow(RangeError);
    expect(() => r.int(1.5)).toThrow(RangeError);
  });

  it('is roughly uniform', () => {
    const r = Rng.fromSeed(2024);
    const counts = new Array<number>(10).fill(0);
    const n = 100_000;
    for (let i = 0; i < n; i++) {
      const v = r.int(10);
      counts[v] = (counts[v] ?? 0) + 1;
    }
    for (const c of counts) expect(Math.abs(c - n / 10)).toBeLessThan(n / 100);
    let hits = 0;
    for (let i = 0; i < n; i++) if (r.chance(30)) hits++;
    expect(Math.abs(hits / n - 0.3)).toBeLessThan(0.01);
  });

  it('scales exactly at the edges', () => {
    expect(scaleU32ToRange(0, 100)).toBe(0);
    expect(scaleU32ToRange(0xffffffff, 100)).toBe(99);
    expect(scaleU32ToRange(0xffffffff, 0x1_0000_0000)).toBe(0xffffffff);
    expect(scaleU32ToRange(0x80000000, 2)).toBe(1);
    expect(scaleU32ToRange(0x7fffffff, 2)).toBe(0);
  });
});

describe('PreRandom', () => {
  it('repeats rolls after loading even with a reseeded main generator', () => {
    const main = Rng.fromSeed(5);
    const pre = PreRandom.create(main);
    for (let i = 0; i < 37; i++) pre.int(100);
    const saved = JSON.parse(JSON.stringify(pre.state()));

    const first = Array.from({ length: PRE_RANDOM_RING_SIZE }, () => pre.int(100));
    const reloaded = PreRandom.fromState(saved, Rng.fromSeed(999));
    const second = Array.from({ length: PRE_RANDOM_RING_SIZE }, () => reloaded.int(100));
    expect(second).toEqual(first);
    const a = Array.from({ length: 20 }, () => pre.int(1000));
    const b = Array.from({ length: 20 }, () => reloaded.int(1000));
    expect(a).not.toEqual(b);
  });

  it('does not consume a ring number for PreRandom(0)', () => {
    const a = PreRandom.create(Rng.fromSeed(3));
    const b = PreRandom.create(Rng.fromSeed(3));
    expect(a.int(0)).toBe(0);
    expect(a.int(100)).toBe(b.int(100));
  });

  it('validates saved state', () => {
    const r = Rng.fromSeed(1);
    expect(() => PreRandom.fromState({ ring: [1, 2], index: 0 }, r)).toThrow(RangeError);
    const ring = new Array<number>(PRE_RANDOM_RING_SIZE).fill(0);
    expect(() => PreRandom.fromState({ ring, index: 256 }, r)).toThrow(RangeError);
  });
});

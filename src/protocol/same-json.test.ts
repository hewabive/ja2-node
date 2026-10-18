import { describe, expect, it } from 'vitest';
import { sameJson } from './same-json.ts';

const stringifiedEqual = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

function generator(seed: number) {
  let state = seed >>> 0;
  const next = () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 2 ** 32;
  };
  const pick = <T>(values: readonly T[]): T => values[Math.floor(next() * values.length)] as T;
  const scalars: readonly unknown[] = [
    0,
    -0,
    1,
    2,
    1.5,
    Number.NaN,
    Number.POSITIVE_INFINITY,
    null,
    undefined,
    true,
    false,
    '',
    'a',
    '1',
    () => 1,
  ];
  const keys = ['a', 'b', 'c', '0', '1'];
  const value = (depth: number): unknown => {
    const roll = next();
    if (depth <= 0 || roll < 0.5) return pick(scalars);
    if (roll < 0.75) return Array.from({ length: Math.floor(next() * 3) }, () => value(depth - 1));
    const o: Record<string, unknown> = {};
    for (const key of keys) if (next() < 0.5) o[key] = value(depth - 1);
    return o;
  };
  const variant = (v: unknown, depth: number): unknown => {
    if (next() < 0.3) return value(depth);
    if (Array.isArray(v)) return v.map((item) => variant(item, depth - 1));
    if (typeof v === 'object' && v !== null) {
      const entries = Object.entries(v).map(([k, item]) => [k, variant(item, depth - 1)] as const);
      if (next() < 0.2) entries.reverse();
      if (next() < 0.2) entries.push(['extra', next() < 0.5 ? undefined : 1]);
      return Object.fromEntries(entries);
    }
    return next() < 0.5 ? v : pick(scalars);
  };
  return { value, variant };
}

describe('sameJson', () => {
  it('agrees with comparing JSON.stringify output', () => {
    const g = generator(7);
    let equal = 0;
    for (let i = 0; i < 20_000; i++) {
      const a = g.value(4);
      const b = g.variant(a, 4);
      const expected = stringifiedEqual(a, b);
      if (expected) equal++;
      expect(sameJson(a, b), JSON.stringify([a, b])).toBe(expected);
    }
    expect(equal).toBeGreaterThan(1000);
  });

  it('follows the serializer on the edge cases', () => {
    expect(sameJson({ a: 1, b: undefined }, { a: 1 })).toBe(true);
    expect(sameJson({ a: 1, b: 2 }, { b: 2, a: 1 })).toBe(false);
    expect(sameJson([undefined], [null])).toBe(true);
    expect(sameJson([Number.NaN], [null])).toBe(true);
    expect(sameJson(0, -0)).toBe(true);
    expect(sameJson([], {})).toBe(false);
    expect(sameJson('1', 1)).toBe(false);
    expect(sameJson(new Map([[1, 2]]), {})).toBe(true);
    expect(sameJson({ toJSON: () => 'x' }, 'x')).toBe(true);
  });
});

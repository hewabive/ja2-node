import { PreRandom, Rng } from '../../src/core/rng.ts';
import type { StrategicState } from '../../src/sim/strategic/state.ts';

type Leaf = (value: object, copy: (value: unknown) => unknown) => unknown;

function walk(root: unknown, leaf: Leaf, known: Map<unknown, unknown>): unknown {
  const copy = (value: unknown): unknown => {
    if (typeof value === 'function') throw new Error('the state holds a function');
    if (typeof value !== 'object' || value === null) return value;
    if (known.has(value)) return known.get(value);
    const special = leaf(value, copy);
    if (special !== undefined) {
      known.set(value, special);
      return special;
    }
    if (value instanceof Map) {
      const out = new Map();
      known.set(value, out);
      for (const [k, v] of value) out.set(copy(k), copy(v));
      return out;
    }
    if (value instanceof Set) {
      const out = new Set();
      known.set(value, out);
      for (const v of value) out.add(copy(v));
      return out;
    }
    if (ArrayBuffer.isView(value)) {
      const out = (value as unknown as Uint8Array).slice();
      known.set(value, out);
      return out;
    }
    if (Array.isArray(value)) {
      const out: unknown[] = new Array(value.length);
      known.set(value, out);
      for (let i = 0; i < value.length; i++) if (i in value) out[i] = copy(value[i]);
      return out;
    }
    const proto = Object.getPrototypeOf(value);
    if (proto !== Object.prototype && proto !== null) throw new Error(`the state holds a ${proto.constructor.name} instance`);
    const out: Record<string, unknown> = {};
    known.set(value, out);
    for (const [k, v] of Object.entries(value)) out[k] = copy(v);
    return out;
  };
  return copy(root);
}

export function copyStrategicState(state: StrategicState): StrategicState {
  const rng = Rng.fromState(state.rng.state());
  const known = new Map<unknown, unknown>([
    [state.rng, rng],
    [state.pre, PreRandom.fromState(state.pre.state(), rng)],
  ]);
  const leaf: Leaf = (value) => {
    if (value instanceof Rng) return Rng.fromState(value.state());
    if (value instanceof PreRandom) throw new Error('a PreRandom stream other than state.pre');
    return undefined;
  };
  return walk(state, leaf, known) as StrategicState;
}

export function strategicSnapshot(state: StrategicState): unknown {
  const leaf: Leaf = (value) => {
    if (value instanceof Rng) return { rng: value.state() };
    if (value instanceof PreRandom) return { pre: value.state() };
    return undefined;
  };
  return walk(state, leaf, new Map());
}

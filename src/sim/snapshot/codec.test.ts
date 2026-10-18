import { describe, expect, it } from 'vitest';
import { PreRandom, Rng } from '../../core/rng.ts';
import { decodeBase64, encodeBase64 } from './base64.ts';
import { canonicalJson, decodeGraph, type EncodedGraph, encodeGraph, type Section } from './codec.ts';
import { contentIndex } from './refs.ts';
import { migrateSnapshot, SNAPSHOT_FORMAT, SNAPSHOT_VERSION } from './session.ts';
import { SNAPSHOT_CODECS } from './world.ts';

const NO_EXTERNALS = { classes: SNAPSHOT_CODECS, external: () => null };
const NO_RESOLVE = {
  classes: SNAPSHOT_CODECS,
  resolve: (key: string): object => {
    throw new Error(`unexpected external ${key}`);
  },
};

function roundTrip(sections: readonly Section[]): Map<string, unknown> {
  const encoded = encodeGraph(sections, NO_EXTERNALS);
  return decodeGraph(JSON.parse(canonicalJson(encoded)) as EncodedGraph, NO_RESOLVE);
}

function only(value: unknown): unknown {
  return roundTrip([['root', value]]).get('root');
}

class Unknown {
  readonly x = 1;
}

describe('the snapshot codec', () => {
  it('keeps numbers that JSON cannot hold, undefined fields and holes', () => {
    const sparse: unknown[] = [];
    sparse[3] = 'three';
    sparse[7] = undefined;
    const value = { nan: Number.NaN, inf: Number.POSITIVE_INFINITY, ninf: -Infinity, nzero: -0, f: Math.fround(0.1), u: undefined, sparse };
    const out = only(value) as typeof value;
    expect(out.nan).toBeNaN();
    expect(out.inf).toBe(Number.POSITIVE_INFINITY);
    expect(out.ninf).toBe(-Infinity);
    expect(Object.is(out.nzero, -0)).toBe(true);
    expect(out.f).toBe(Math.fround(0.1));
    expect('u' in out && out.u === undefined).toBe(true);
    expect(out.sparse).toHaveLength(8);
    expect(0 in out.sparse).toBe(false);
    expect(out.sparse[3]).toBe('three');
    expect(7 in out.sparse && out.sparse[7] === undefined).toBe(true);
  });

  it('writes typed arrays as tagged base64 and gives each its own buffer', () => {
    const arrays = [
      Int8Array.of(-1, 2),
      Uint8Array.of(0, 255),
      Uint8ClampedArray.of(9),
      Int16Array.of(-300, 300),
      Uint16Array.of(65535),
      Int32Array.of(-70000),
      Uint32Array.of(0xffffffff),
      Float32Array.of(1.5),
      Float64Array.of(Math.PI),
    ];
    const encoded = encodeGraph([['root', arrays]], NO_EXTERNALS);
    expect(canonicalJson(encoded)).toContain('{"$u8":"AP8="}');
    const out = decodeGraph(encoded, NO_RESOLVE).get('root') as typeof arrays;
    out.forEach((a, i) => {
      expect(a.constructor).toBe(arrays[i]?.constructor);
      expect(Array.from(a)).toEqual(Array.from(arrays[i] ?? []));
    });
    expect(new Set(out.map((a) => a.buffer)).size).toBe(out.length);
  });

  it('keeps map and set entries in insertion order, with object keys', () => {
    const key = { id: 1 };
    const map = new Map<unknown, unknown>([
      ['z', 1],
      [key, 'object'],
      ['a', 2],
    ]);
    const set = new Set([3, 1, 2]);
    const out = only({ map, set, key }) as { map: Map<unknown, unknown>; set: Set<number>; key: object };
    expect([...out.map.keys()].slice(0, 1)).toEqual(['z']);
    expect([...out.map.keys()][2]).toBe('a');
    expect(out.map.get(out.key)).toBe('object');
    expect([...out.set]).toEqual([3, 1, 2]);
  });

  it('writes a shared object once and links every reference to it, cycles included', () => {
    const shared = { n: 1 };
    const node: { self?: unknown; shared: object } = { shared };
    node.self = node;
    const bytes = new Uint8Array(4);
    const encoded = encodeGraph(
      [
        ['first', { a: shared, bytes }],
        ['second', [shared, node, bytes]],
      ],
      NO_EXTERNALS,
    );
    expect(canonicalJson(encoded)).toContain('{"$ref":"first/a"}');
    const out = decodeGraph(encoded, NO_RESOLVE);
    const first = out.get('first') as { a: object; bytes: Uint8Array };
    const [a, n, b] = out.get('second') as [object, { self: unknown; shared: object }, Uint8Array];
    expect(a).toBe(first.a);
    expect(n.self).toBe(n);
    expect(n.shared).toBe(first.a);
    expect(b).toBe(first.bytes);
  });

  it('keeps the key order of plain objects, so a restored object is a replica of the original', () => {
    const value = { b: 1, a: { d: 2, c: 3 }, 7: 'seven' };
    const encoded = canonicalJson(encodeGraph([['root', value]], NO_EXTERNALS));
    expect(encoded).toContain('{"7":"seven","b":1,"a":{"d":2,"c":3}}');
    const out = decodeGraph(JSON.parse(encoded) as EncodedGraph, NO_RESOLVE).get('root') as typeof value;
    expect(JSON.stringify(out)).toBe(JSON.stringify(value));
    expect(canonicalJson(encodeGraph([['root', out]], NO_EXTERNALS))).toBe(encoded);
  });

  it('restores the streams so they continue the same sequences, with the PreRandom refill linked', () => {
    const rng = Rng.fromSeed(3);
    const pre = PreRandom.create(rng);
    for (let i = 0; i < 40; i++) pre.int(10);
    const out = roundTrip([
      ['rng', rng],
      ['state', { pre, rng }],
    ]);
    const restored = out.get('state') as { pre: PreRandom; rng: Rng };
    expect(restored.rng).toBe(out.get('rng'));
    expect(restored.pre.refillStream()).toBe(restored.rng);
    const expected = Array.from({ length: 600 }, () => [pre.int(1000), rng.int(1000)]);
    expect(Array.from({ length: 600 }, () => [restored.pre.int(1000), restored.rng.int(1000)])).toEqual(expected);
  });

  it('writes content objects as keys and resolves them against the content', () => {
    const def = { tiles: [{ shape: Uint8Array.of(1) }] };
    const content = { files: { 'a/b.jsd': [def] }, table: new Map([[7, { name: 'seven' }]]) };
    const index = contentIndex({ content });
    const state = { def, tile: def.tiles[0], seven: content.table.get(7), own: { x: 1 } };
    const encoded = encodeGraph([['state', state]], { classes: SNAPSHOT_CODECS, external: (v) => index.keyOf(v) });
    expect(encoded.externals).toEqual(['content/files/a~1b.jsd/0', 'content/files/a~1b.jsd/0/tiles/0', 'content/table/0/1']);
    const fresh = structuredClone(content);
    const out = decodeGraph(encoded, { classes: SNAPSHOT_CODECS, resolve: (key) => contentIndex({ content: fresh }).resolve(key) }).get(
      'state',
    ) as typeof state;
    expect(out.def).toBe(fresh.files['a/b.jsd'][0]);
    expect(out.tile).toBe(fresh.files['a/b.jsd'][0]?.tiles[0]);
    expect(out.seven).toBe(fresh.table.get(7));
    expect(out.own).toEqual({ x: 1 });
  });

  it('fails loudly on state it cannot write', () => {
    expect(() => encodeGraph([['root', { hooks: { run: () => 1 } }]], NO_EXTERNALS)).toThrow(
      /function cannot be written at root\/hooks\/run/,
    );
    expect(() => encodeGraph([['root', { list: [new Unknown()] }]], NO_EXTERNALS)).toThrow(
      /Unknown instance cannot be written at root\/list\/0/,
    );
    expect(() => encodeGraph([['root', { at: new Date(0) }]], NO_EXTERNALS)).toThrow(/Date instance/);
    expect(() => encodeGraph([['root', { $ref: 1 }]], NO_EXTERNALS)).toThrow(/reserved/);
    expect(() => encodeGraph([['root', new Uint8Array(8).subarray(2)]], NO_EXTERNALS)).toThrow(/view into a larger buffer/);
    expect(() => encodeGraph([['root', Object.create(null)]], NO_EXTERNALS)).toThrow(/null-prototype/);
    expect(() => encodeGraph([['root', 1n]], NO_EXTERNALS)).toThrow(/bigint/);
  });

  it('fails loudly on a damaged graph', () => {
    const graph = (node: unknown): EncodedGraph => ({ externals: [], sections: [['root', node as never]] });
    expect(() => decodeGraph(graph({ $what: 1 }), NO_RESOLVE)).toThrow(/unknown snapshot tag/);
    expect(() => decodeGraph(graph([{ $ref: 'root/9' }]), NO_RESOLVE)).toThrow(/unresolved reference/);
    expect(() => decodeGraph(graph({ $x: 3 }), NO_RESOLVE)).toThrow(/unknown external/);
    expect(() => decodeGraph(graph(JSON.parse('{"__proto__": {"polluted": 1}}')), NO_RESOLVE)).toThrow(/prototype/);
    expect(() => contentIndex({ content: { items: [] } }).resolve('content/items/constructor')).toThrow(/does not resolve/);
    expect(() => contentIndex({ content: { items: [] } }).resolve('content/__proto__')).toThrow(/does not resolve/);
  });
});

describe('snapshot versions', () => {
  it('accepts the current version and refuses other files and newer versions', () => {
    const graph = { externals: [], sections: [] };
    const current = { format: SNAPSHOT_FORMAT, version: SNAPSHOT_VERSION, kind: 'tactical', mapPath: null, graph };
    expect(migrateSnapshot(current)).toEqual(current);
    expect(() => migrateSnapshot({ ...current, format: 'other' })).toThrow(/not a ja2-node snapshot/);
    expect(() => migrateSnapshot({ ...current, version: SNAPSHOT_VERSION + 1 })).toThrow(/newer/);
    expect(() => migrateSnapshot({ ...current, version: 0 })).toThrow(/no valid version/);
  });
});

describe('base64', () => {
  it('round-trips every length and refuses bad input', () => {
    for (let n = 0; n < 12; n++) {
      const bytes = Uint8Array.from({ length: n }, (_, i) => (i * 97 + n) & 255);
      const text = encodeBase64(bytes);
      expect(text.length % 4).toBe(0);
      expect(Array.from(decodeBase64(text))).toEqual(Array.from(bytes));
    }
    expect(encodeBase64(Uint8Array.of(0xfb, 0xff))).toBe('+/8=');
    expect(() => decodeBase64('abc')).toThrow(SyntaxError);
    expect(() => decodeBase64('ab!=')).toThrow(SyntaxError);
  });
});

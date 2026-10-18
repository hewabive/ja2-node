import { decodeBase64, encodeBase64 } from './base64.ts';

export type Json = null | boolean | number | string | readonly Json[] | { readonly [key: string]: Json };

export interface ClassCodec {
  readonly tag: string;
  matches(value: object): boolean;
  payload(value: object): unknown;
  revive(payload: unknown): object;
}

export interface EncodeOptions {
  readonly classes: readonly ClassCodec[];
  external(value: object): string | null;
}

export interface DecodeOptions {
  readonly classes: readonly ClassCodec[];
  resolve(key: string): object;
}

export type Section = readonly [name: string, value: unknown];

export interface EncodedGraph {
  readonly externals: readonly string[];
  readonly sections: readonly (readonly [string, Json])[];
}

export class SnapshotError extends Error {
  constructor(message: string, path: readonly string[] = []) {
    super(path.length > 0 ? `${message} at ${path.join('/')}` : message);
    this.name = 'SnapshotError';
  }
}

type TypedArray =
  | Int8Array
  | Uint8Array
  | Uint8ClampedArray
  | Int16Array
  | Uint16Array
  | Int32Array
  | Uint32Array
  | Float32Array
  | Float64Array;

interface TypedKind {
  readonly tag: string;
  readonly matches: (v: object) => boolean;
  readonly create: (buffer: ArrayBuffer) => TypedArray;
}

const TYPED: readonly TypedKind[] = [
  { tag: '$i8', matches: (v) => v instanceof Int8Array, create: (b) => new Int8Array(b) },
  { tag: '$u8', matches: (v) => v instanceof Uint8Array, create: (b) => new Uint8Array(b) },
  { tag: '$u8c', matches: (v) => v instanceof Uint8ClampedArray, create: (b) => new Uint8ClampedArray(b) },
  { tag: '$i16', matches: (v) => v instanceof Int16Array, create: (b) => new Int16Array(b) },
  { tag: '$u16', matches: (v) => v instanceof Uint16Array, create: (b) => new Uint16Array(b) },
  { tag: '$i32', matches: (v) => v instanceof Int32Array, create: (b) => new Int32Array(b) },
  { tag: '$u32', matches: (v) => v instanceof Uint32Array, create: (b) => new Uint32Array(b) },
  { tag: '$f32', matches: (v) => v instanceof Float32Array, create: (b) => new Float32Array(b) },
  { tag: '$f64', matches: (v) => v instanceof Float64Array, create: (b) => new Float64Array(b) },
];

const TYPED_BY_TAG = new Map(TYPED.map((k) => [k.tag, k]));
const LITTLE_ENDIAN = new Uint8Array(new Uint16Array([1]).buffer)[0] === 1;

const REF = '$ref';
const EXTERNAL = '$x';
const NUMBER = '$num';
const UNDEFINED = '$undefined';
const MAP = '$map';
const SET = '$set';
const SPARSE = '$sparse';
const SPARSE_ENTRIES = '$e';
const TAG_PREFIX = 36;

const SPECIAL_NUMBERS: Readonly<Record<string, number>> = {
  NaN: Number.NaN,
  Infinity: Number.POSITIVE_INFINITY,
  '-Infinity': -Infinity,
  '-0': -0,
};

function specialNumberName(n: number): string | null {
  if (Number.isNaN(n)) return 'NaN';
  if (n === Number.POSITIVE_INFINITY) return 'Infinity';
  if (n === Number.NEGATIVE_INFINITY) return '-Infinity';
  if (Object.is(n, -0)) return '-0';
  return null;
}

export function escapeSegment(segment: string): string {
  return segment.indexOf('~') < 0 && segment.indexOf('/') < 0 ? segment : segment.replace(/~/g, '~0').replace(/\//g, '~1');
}

export function unescapeSegment(segment: string): string {
  return segment.indexOf('~') < 0 ? segment : segment.replace(/~1/g, '/').replace(/~0/g, '~');
}

function isTypedArray(value: object): value is TypedArray {
  return ArrayBuffer.isView(value) && !(value instanceof DataView);
}

function isPlainObject(value: object): boolean {
  return Object.getPrototypeOf(value) === Object.prototype;
}

function typeName(value: object): string {
  const proto = Object.getPrototypeOf(value);
  return proto === null ? 'null-prototype object' : `${proto.constructor?.name ?? 'anonymous'} instance`;
}

function hasHoles(array: readonly unknown[]): boolean {
  for (let i = 0; i < array.length; i++) if (!(i in array)) return true;
  return false;
}

function typedBytes(value: TypedArray, path: readonly string[]): Uint8Array {
  if (value.byteOffset !== 0 || value.byteLength !== value.buffer.byteLength)
    throw new SnapshotError('a typed array view into a larger buffer cannot be written', path);
  if (!LITTLE_ENDIAN) throw new SnapshotError('snapshots need a little-endian host');
  return new Uint8Array(value.buffer, 0, value.byteLength);
}

interface PathNode {
  readonly parent: PathNode | null;
  readonly segment: string;
}

function pathOf(node: PathNode | null): string[] {
  const segments: string[] = [];
  for (let at = node; at; at = at.parent) segments.push(at.segment);
  return segments.reverse();
}

class Encoder {
  readonly #options: EncodeOptions;
  readonly #seen = new Map<object, PathNode>();
  readonly #externals: string[] = [];
  readonly #externalIndex = new Map<string, number>();
  #node: PathNode | null = null;

  constructor(options: EncodeOptions) {
    this.#options = options;
  }

  get externals(): readonly string[] {
    return this.#externals;
  }

  section(name: string, value: unknown): Json {
    return this.#child(escapeSegment(name), value);
  }

  #child(segment: string, value: unknown): Json {
    const parent = this.#node;
    this.#node = { parent, segment };
    const out = this.#value(value);
    this.#node = parent;
    return out;
  }

  #fail(message: string): never {
    throw new SnapshotError(message, pathOf(this.#node));
  }

  #value(value: unknown): Json {
    switch (typeof value) {
      case 'number': {
        const special = specialNumberName(value);
        return special === null ? value : { [NUMBER]: special };
      }
      case 'string':
      case 'boolean':
        return value;
      case 'undefined':
        return { [UNDEFINED]: true };
      case 'object':
        return value === null ? null : this.#object(value);
      case 'function':
        return this.#fail('a function cannot be written');
      default:
        return this.#fail(`a ${typeof value} cannot be written`);
    }
  }

  #object(value: object): Json {
    const first = this.#seen.get(value);
    if (first) return { [REF]: pathOf(first).join('/') };
    const key = this.#options.external(value);
    if (key !== null) return { [EXTERNAL]: this.#externalId(key) };
    if (this.#node) this.#seen.set(value, this.#node);
    if (isTypedArray(value)) return this.#typed(value);
    if (value instanceof Map) return this.#map(value);
    if (value instanceof Set) return { [SET]: [...value].map((v, i) => this.#child(String(i), v)) };
    if (Array.isArray(value)) return hasHoles(value) ? this.#sparse(value) : value.map((v, i) => this.#child(String(i), v));
    if (isPlainObject(value)) return this.#plain(value as Record<string, unknown>);
    return this.#instance(value);
  }

  #externalId(key: string): number {
    let id = this.#externalIndex.get(key);
    if (id === undefined) {
      id = this.#externals.length;
      this.#externals.push(key);
      this.#externalIndex.set(key, id);
    }
    return id;
  }

  #typed(value: TypedArray): Json {
    const kind = TYPED.find((k) => k.matches(value));
    if (!kind) return this.#fail(`a ${typeName(value)} cannot be written`);
    return { [kind.tag]: encodeBase64(typedBytes(value, pathOf(this.#node))) };
  }

  #map(value: Map<unknown, unknown>): Json {
    const entries: Json[] = [];
    const parent = this.#node;
    let i = 0;
    for (const [k, v] of value) {
      this.#node = { parent, segment: String(i++) };
      entries.push([this.#child('0', k), this.#child('1', v)]);
    }
    this.#node = parent;
    return { [MAP]: entries };
  }

  #sparse(value: readonly unknown[]): Json {
    const entries: Json[] = [];
    for (let i = 0; i < value.length; i++) if (i in value) entries.push([i, this.#child(String(i), value[i])]);
    return { [SPARSE]: value.length, [SPARSE_ENTRIES]: entries };
  }

  #plain(value: Record<string, unknown>): Json {
    const out: Record<string, Json> = {};
    for (const key of Object.keys(value).sort()) {
      if (key.charCodeAt(0) === TAG_PREFIX) this.#fail(`the key ${key} is reserved for snapshot tags`);
      out[key] = this.#child(escapeSegment(key), value[key]);
    }
    return out;
  }

  #instance(value: object): Json {
    const codec = this.#options.classes.find((c) => c.matches(value));
    if (!codec) return this.#fail(`a ${typeName(value)} cannot be written`);
    return { [codec.tag]: this.#value(codec.payload(value)) };
  }
}

export function encodeGraph(sections: readonly Section[], options: EncodeOptions): EncodedGraph {
  const names = new Set(sections.map(([name]) => name));
  if (names.size !== sections.length) throw new SnapshotError('section names must be unique');
  const encoder = new Encoder(options);
  const out = sections.map(([name, value]) => [name, encoder.section(name, value)] as const);
  return { externals: [...encoder.externals], sections: out };
}

interface TrieNode {
  path: string | null;
  readonly children: Map<string, TrieNode>;
}

function trieNode(): TrieNode {
  return { path: null, children: new Map() };
}

function tagOf(node: object): string | null {
  for (const key in node) return key.charCodeAt(0) === TAG_PREFIX ? key : null;
  return null;
}

function collectRefs(node: Json, into: Set<string>): void {
  if (typeof node !== 'object' || node === null) return;
  if (Array.isArray(node)) {
    for (const child of node) collectRefs(child, into);
    return;
  }
  const record = node as Record<string, Json>;
  if (tagOf(record) === REF) {
    into.add(record[REF] as string);
    return;
  }
  for (const key in record) collectRefs(record[key] as Json, into);
}

function refTrie(graph: EncodedGraph): TrieNode {
  const targets = new Set<string>();
  for (const [, node] of graph.sections) collectRefs(node, targets);
  const root = trieNode();
  for (const target of targets) {
    let at = root;
    for (const segment of target.split('/')) {
      let next = at.children.get(segment);
      if (!next) {
        next = trieNode();
        at.children.set(segment, next);
      }
      at = next;
    }
    at.path = target;
  }
  return root;
}

class Decoder {
  readonly #options: DecodeOptions;
  readonly #graph: EncodedGraph;
  readonly #objects = new Map<string, object>();
  readonly #externals = new Map<number, object>();

  constructor(options: DecodeOptions, graph: EncodedGraph) {
    this.#options = options;
    this.#graph = graph;
  }

  section(node: Json, trie: TrieNode | undefined): unknown {
    return this.#value(node, trie);
  }

  #register(trie: TrieNode | undefined, value: object): void {
    if (trie?.path) this.#objects.set(trie.path, value);
  }

  #value(node: Json, trie: TrieNode | undefined): unknown {
    if (typeof node !== 'object' || node === null) return node;
    if (Array.isArray(node)) {
      const out: unknown[] = [];
      this.#register(trie, out);
      for (let i = 0; i < node.length; i++) out.push(this.#value(node[i] as Json, trie?.children.get(String(i))));
      return out;
    }
    const record = node as Record<string, Json>;
    const tag = tagOf(record);
    if (tag === null) return this.#plain(record, trie);
    return this.#tagged(tag, record, trie);
  }

  #plain(record: Record<string, Json>, trie: TrieNode | undefined): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    this.#register(trie, out);
    for (const key in record) out[key] = this.#value(record[key] as Json, trie?.children.get(escapeSegment(key)));
    return out;
  }

  #tagged(tag: string, record: Record<string, Json>, trie: TrieNode | undefined): unknown {
    const body = record[tag] as Json;
    switch (tag) {
      case REF:
        return this.#reference(body as string);
      case EXTERNAL:
        return this.#external(body as number);
      case NUMBER:
        return this.#special(body as string);
      case UNDEFINED:
        return undefined;
      case MAP:
        return this.#map(body as readonly (readonly [Json, Json])[], trie);
      case SET:
        return this.#set(body as readonly Json[], trie);
      case SPARSE:
        return this.#sparse(body as number, record[SPARSE_ENTRIES] as readonly (readonly [number, Json])[], trie);
    }
    const typed = TYPED_BY_TAG.get(tag);
    if (typed) {
      const bytes = decodeBase64(body as string);
      const out = typed.create(bytes.buffer as ArrayBuffer);
      this.#register(trie, out);
      return out;
    }
    const codec = this.#options.classes.find((c) => c.tag === tag);
    if (!codec) throw new SnapshotError(`unknown snapshot tag ${tag}`);
    const out = codec.revive(this.#value(body, trie));
    this.#register(trie, out);
    return out;
  }

  #reference(path: string): object {
    const target = this.#objects.get(path);
    if (!target) throw new SnapshotError(`unresolved reference ${path}`);
    return target;
  }

  #external(id: number): object {
    let value = this.#externals.get(id);
    if (!value) {
      const key = this.#graph.externals[id];
      if (key === undefined) throw new SnapshotError(`unknown external ${id}`);
      value = this.#options.resolve(key);
      this.#externals.set(id, value);
    }
    return value;
  }

  #special(name: string): number {
    const value = SPECIAL_NUMBERS[name];
    if (value === undefined) throw new SnapshotError(`unknown number ${name}`);
    return value;
  }

  #map(entries: readonly (readonly [Json, Json])[], trie: TrieNode | undefined): Map<unknown, unknown> {
    const out = new Map<unknown, unknown>();
    this.#register(trie, out);
    entries.forEach(([k, v], i) => {
      const entry = trie?.children.get(String(i));
      out.set(this.#value(k, entry?.children.get('0')), this.#value(v, entry?.children.get('1')));
    });
    return out;
  }

  #set(values: readonly Json[], trie: TrieNode | undefined): Set<unknown> {
    const out = new Set<unknown>();
    this.#register(trie, out);
    values.forEach((v, i) => {
      out.add(this.#value(v, trie?.children.get(String(i))));
    });
    return out;
  }

  #sparse(length: number, entries: readonly (readonly [number, Json])[], trie: TrieNode | undefined): unknown[] {
    const out = new Array<unknown>(length);
    this.#register(trie, out);
    for (const [i, v] of entries) out[i] = this.#value(v, trie?.children.get(String(i)));
    return out;
  }
}

export function decodeGraph(graph: EncodedGraph, options: DecodeOptions): Map<string, unknown> {
  const trie = refTrie(graph);
  const decoder = new Decoder(options, graph);
  const out = new Map<string, unknown>();
  for (const [name, node] of graph.sections) out.set(name, decoder.section(node, trie.children.get(escapeSegment(name))));
  return out;
}

export function canonicalJson(value: unknown): string {
  return JSON.stringify(value);
}

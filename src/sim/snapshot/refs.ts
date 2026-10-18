import { escapeSegment, SnapshotError, unescapeSegment } from './codec.ts';

export type ContentRoots = Readonly<Record<string, object>>;

export type OpaqueKeys = Readonly<Record<string, readonly string[]>>;

export interface ContentIndex {
  keyOf(value: object): string | null;
  resolve(key: string): object;
}

const SEPARATOR = '/';
const MAP_KEY = '0';
const MAP_VALUE = '1';

const paths = new WeakMap<object, Map<object, string>>();

function indexRoot(root: object, opaqueKeys: readonly string[]): Map<object, string> {
  const cached = paths.get(root);
  if (cached) return cached;
  const found = new Map<object, string>();
  const opaque = new Set(opaqueKeys);
  const visit = (value: unknown, path: string, top: boolean): void => {
    if (typeof value !== 'object' || value === null || found.has(value)) return;
    found.set(value, path);
    if (ArrayBuffer.isView(value)) return;
    const at = (segment: string) => (path === '' ? segment : `${path}${SEPARATOR}${segment}`);
    if (value instanceof Map) {
      let i = 0;
      for (const [k, v] of value) {
        const entry = at(String(i++));
        visit(k, `${entry}${SEPARATOR}${MAP_KEY}`, false);
        visit(v, `${entry}${SEPARATOR}${MAP_VALUE}`, false);
      }
      return;
    }
    if (value instanceof Set) {
      let i = 0;
      for (const v of value) visit(v, at(String(i++)), false);
      return;
    }
    if (Array.isArray(value)) {
      for (let i = 0; i < value.length; i++) visit(value[i], at(String(i)), false);
      return;
    }
    for (const key of Object.keys(value)) {
      if (top && opaque.has(key)) continue;
      visit((value as Record<string, unknown>)[key], at(escapeSegment(key)), false);
    }
  };
  visit(root, '', true);
  paths.set(root, found);
  return found;
}

function step(value: unknown, segments: readonly string[], i: number): { value: unknown; next: number } {
  const segment = segments[i] as string;
  if (value instanceof Map) {
    const entry = [...value][Number(segment)];
    const part = segments[i + 1];
    if (!entry || (part !== MAP_KEY && part !== MAP_VALUE)) return { value: undefined, next: i + 2 };
    return { value: part === MAP_KEY ? entry[0] : entry[1], next: i + 2 };
  }
  if (value instanceof Set) return { value: [...value][Number(segment)], next: i + 1 };
  if (Array.isArray(value)) return { value: value[Number(segment)], next: i + 1 };
  if (typeof value === 'object' && value !== null)
    return { value: (value as Record<string, unknown>)[unescapeSegment(segment)], next: i + 1 };
  return { value: undefined, next: i + 1 };
}

interface MergedKeys {
  readonly names: readonly string[];
  readonly roots: readonly object[];
  readonly keys: Map<object, string>;
}

const mergedByFirstRoot = new WeakMap<object, MergedKeys[]>();

function sameRoots(merged: MergedKeys, names: readonly string[], roots: readonly object[]): boolean {
  return merged.names.length === names.length && merged.names.every((name, i) => name === names[i] && merged.roots[i] === roots[i]);
}

function mergedKeys(names: readonly string[], roots: readonly object[], opaque: OpaqueKeys): Map<object, string> {
  const first = roots[0];
  if (!first) return new Map();
  const known = mergedByFirstRoot.get(first) ?? [];
  const hit = known.find((m) => sameRoots(m, names, roots));
  if (hit) return hit.keys;
  const keys = new Map<object, string>();
  names.forEach((name, i) => {
    for (const [value, path] of indexRoot(roots[i] as object, opaque[name] ?? []))
      if (!keys.has(value)) keys.set(value, path === '' ? name : `${name}${SEPARATOR}${path}`);
  });
  known.push({ names, roots, keys });
  mergedByFirstRoot.set(first, known);
  return keys;
}

export function contentIndex(roots: ContentRoots, opaque: OpaqueKeys = {}): ContentIndex {
  const names = Object.keys(roots).sort();
  for (const name of names)
    if (name.includes(SEPARATOR)) throw new SnapshotError(`content root names cannot contain ${SEPARATOR}: ${name}`);
  const values = names.map((name) => roots[name] as object);
  const keys = mergedKeys(names, values, opaque);
  const resolved = new Map<string, object>();
  return {
    keyOf: (value) => keys.get(value) ?? null,
    resolve(key) {
      const known = resolved.get(key);
      if (known) return known;
      const segments = key.split(SEPARATOR);
      const at = names.indexOf(segments[0] as string);
      if (at < 0) throw new SnapshotError(`unknown content root in ${key}`);
      let value: unknown = values[at];
      for (let i = 1; i < segments.length; ) {
        const next = step(value, segments, i);
        value = next.value;
        i = next.next;
      }
      if (typeof value !== 'object' || value === null) throw new SnapshotError(`content key ${key} does not resolve to an object`);
      resolved.set(key, value);
      return value;
    },
  };
}

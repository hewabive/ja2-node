import { FormatError } from '../binary/errors.ts';
import { decodeObject, OBJECT_RECORD_BYTES, type ObjectRecord } from './object.ts';
import { SaveCursor } from './savegame-cursor.ts';

export type ScalarType = 'u8' | 'i8' | 'bool' | 'u16' | 'i16' | 'u32' | 'i32' | 'f32';

export type LayoutEntry =
  | { readonly kind: 'scalar'; readonly name: string; readonly type: ScalarType; readonly count: number }
  | { readonly kind: 'skip'; readonly name: string; readonly bytes: number; readonly linuxOnly: boolean }
  | { readonly kind: 'text'; readonly name: string; readonly chars: number; readonly wide: boolean }
  | { readonly kind: 'objects'; readonly name: string; readonly count: number }
  | { readonly kind: 'linuxVariant'; readonly vanilla: number; readonly linux: number; readonly name: string };

export type Layout = readonly LayoutEntry[];
type Value = number | boolean | string | readonly number[] | readonly boolean[] | readonly ObjectRecord[];

const SCALAR_BYTES: Readonly<Record<ScalarType, number>> = { u8: 1, i8: 1, bool: 1, u16: 2, i16: 2, u32: 4, i32: 4, f32: 4 };
const POINTER_BYTES = 4;

export const field = (name: string, type: ScalarType, count = 1): LayoutEntry => ({ kind: 'scalar', name, type, count });
export const skip = (bytes: number, name = ''): LayoutEntry => ({ kind: 'skip', name, bytes, linuxOnly: false });
export const pointer = (name: string): LayoutEntry => ({ kind: 'skip', name, bytes: POINTER_BYTES, linuxOnly: false });
export const linuxSkip = (bytes: number): LayoutEntry => ({ kind: 'skip', name: '', bytes, linuxOnly: true });
export const linuxPadding = (vanilla: number, linux: number): LayoutEntry => ({ kind: 'linuxVariant', name: '', vanilla, linux });
export const ascii = (name: string, chars: number): LayoutEntry => ({ kind: 'text', name, chars, wide: false });
export const wide = (name: string, chars: number): LayoutEntry => ({ kind: 'text', name, chars, wide: true });
export const objects = (name: string, count: number): LayoutEntry => ({ kind: 'objects', name, count });

export function entryBytes(e: LayoutEntry, linux: boolean): number {
  switch (e.kind) {
    case 'scalar':
      return SCALAR_BYTES[e.type] * e.count;
    case 'skip':
      return e.linuxOnly && !linux ? 0 : e.bytes;
    case 'text':
      return e.wide ? SaveCursor.wideBytes(e.chars, linux) : e.chars;
    case 'objects':
      return OBJECT_RECORD_BYTES * e.count;
    case 'linuxVariant':
      return linux ? e.linux : e.vanilla;
  }
}

export function layoutBytes(layout: Layout, linux: boolean): number {
  return layout.reduce((n, e) => n + entryBytes(e, linux), 0);
}

export function layoutOffsets(layout: Layout, linux: boolean): ReadonlyMap<string, number> {
  const offsets = new Map<string, number>();
  let at = 0;
  for (const e of layout) {
    if (e.name) offsets.set(e.name, at);
    at += entryBytes(e, linux);
  }
  return offsets;
}

function readScalar(c: SaveCursor, type: ScalarType): number | boolean {
  switch (type) {
    case 'u8':
      return c.u8();
    case 'i8':
      return c.i8();
    case 'bool':
      return c.bool();
    case 'u16':
      return c.u16();
    case 'i16':
      return c.i16();
    case 'u32':
      return c.u32();
    case 'i32':
      return c.i32();
    case 'f32':
      return c.f32();
  }
}

export class LayoutRecord {
  readonly #values: ReadonlyMap<string, Value>;
  readonly #what: string;

  constructor(values: ReadonlyMap<string, Value>, what: string) {
    this.#values = values;
    this.#what = what;
  }

  #get(name: string): Value {
    const v = this.#values.get(name);
    if (v === undefined) throw new FormatError(`${this.#what}: no field ${name}`);
    return v;
  }

  num(name: string): number {
    const v = this.#get(name);
    if (typeof v !== 'number') throw new FormatError(`${this.#what}: ${name} is not a number`);
    return v;
  }

  bool(name: string): boolean {
    const v = this.#get(name);
    if (typeof v !== 'boolean') throw new FormatError(`${this.#what}: ${name} is not a boolean`);
    return v;
  }

  str(name: string): string {
    const v = this.#get(name);
    if (typeof v !== 'string') throw new FormatError(`${this.#what}: ${name} is not a string`);
    return v;
  }

  nums(name: string): readonly number[] {
    const v = this.#get(name);
    if (!Array.isArray(v) || v.some((x) => typeof x !== 'number')) throw new FormatError(`${this.#what}: ${name} is not a number array`);
    return v as readonly number[];
  }

  bools(name: string): readonly boolean[] {
    const v = this.#get(name);
    if (!Array.isArray(v) || v.some((x) => typeof x !== 'boolean')) throw new FormatError(`${this.#what}: ${name} is not a boolean array`);
    return v as readonly boolean[];
  }

  objects(name: string): readonly ObjectRecord[] {
    const v = this.#get(name);
    if (!Array.isArray(v)) throw new FormatError(`${this.#what}: ${name} is not an object list`);
    return v as readonly ObjectRecord[];
  }
}

export function readLayout(c: SaveCursor, layout: Layout, linux: boolean, what: string): LayoutRecord {
  const start = c.pos;
  const values = new Map<string, Value>();
  for (const e of layout) {
    switch (e.kind) {
      case 'scalar':
        if (e.count === 1) values.set(e.name, readScalar(c, e.type));
        else values.set(e.name, Array.from({ length: e.count }, () => readScalar(c, e.type)) as number[] | boolean[]);
        break;
      case 'skip':
      case 'linuxVariant':
        c.skip(entryBytes(e, linux));
        break;
      case 'text':
        values.set(e.name, e.wide ? c.wideString(e.chars, linux) : c.ascii(e.chars));
        break;
      case 'objects': {
        const list: ObjectRecord[] = [];
        for (let i = 0; i < e.count; i++) list.push(decodeObject(c.bytes, c.pos + i * OBJECT_RECORD_BYTES));
        c.skip(OBJECT_RECORD_BYTES * e.count);
        values.set(e.name, list);
        break;
      }
    }
  }
  c.expectConsumed(start, layoutBytes(layout, linux), what);
  return new LayoutRecord(values, what);
}

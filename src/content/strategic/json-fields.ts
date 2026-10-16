import { FormatError } from '../binary/errors.ts';

export type JsonObject = Readonly<Record<string, unknown>>;

export function asObject(value: unknown, what: string): JsonObject {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new FormatError(`${what}: expected an object`);
  return value as JsonObject;
}

export function asArray(value: unknown, what: string): readonly unknown[] {
  if (!Array.isArray(value)) throw new FormatError(`${what}: expected an array`);
  return value;
}

export function asInt(value: unknown, what: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value)) throw new FormatError(`${what}: expected an integer`);
  return value;
}

export function asString(value: unknown, what: string): string {
  if (typeof value !== 'string') throw new FormatError(`${what}: expected a string`);
  return value;
}

export function asBool(value: unknown, what: string): boolean {
  if (typeof value !== 'boolean') throw new FormatError(`${what}: expected a boolean`);
  return value;
}

export function optionalBool(o: JsonObject, key: string, what: string): boolean {
  return o[key] === undefined ? false : asBool(o[key], `${what}.${key}`);
}

export function intArray(value: unknown, what: string, length?: number): number[] {
  const list = asArray(value, what).map((v, i) => asInt(v, `${what}[${i}]`));
  if (length !== undefined && list.length !== length) throw new FormatError(`${what}: expected ${length} values, got ${list.length}`);
  return list;
}

export function intArrayByDifficulty(o: JsonObject, key: string, what: string): readonly [number, number, number] {
  if (o[key] === undefined) return [0, 0, 0];
  const [easy, medium, hard] = intArray(o[key], `${what}.${key}`, 3) as [number, number, number];
  return [easy, medium, hard];
}

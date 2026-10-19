export class UnsuppliedFieldError extends Error {
  readonly field: string;

  constructor(field: string) {
    super(`a hint read ${field}, which the player view does not supply`);
    this.name = 'UnsuppliedFieldError';
    this.field = field;
  }
}

const RAW = Symbol('knowledge.raw');
const WRITTEN = Symbol('knowledge.written');

export interface GuardOptions {
  readonly strict: boolean;
}

export function guardFields<T extends object>(target: T, supplied: ReadonlySet<PropertyKey>, label: string, options: GuardOptions): T {
  if (!options.strict) return target;
  const written = new Set<PropertyKey>();
  return new Proxy(target, {
    get(obj, key, receiver) {
      if (key === RAW) return obj;
      if (key === WRITTEN) return written;
      if (typeof key === 'symbol' || supplied.has(key) || written.has(key)) return Reflect.get(obj, key, receiver);
      throw new UnsuppliedFieldError(`${label}.${String(key)}`);
    },
    set(obj, key, value, receiver) {
      written.add(key);
      return Reflect.set(obj, key, value, receiver);
    },
  });
}

export function rawObject<T extends object>(value: T): T {
  return ((value as Record<PropertyKey, unknown>)[RAW] as T | undefined) ?? value;
}

function writtenKeys(value: object): Set<PropertyKey> | null {
  return ((value as Record<PropertyKey, unknown>)[WRITTEN] as Set<PropertyKey> | undefined) ?? null;
}

export function unsupplied(label: string, options: GuardOptions): void {
  if (options.strict) throw new UnsuppliedFieldError(label);
}

export function withTemporaryFields<T extends object, R>(target: T, patch: Partial<T>, run: () => R): R {
  const raw = rawObject(target);
  const written = writtenKeys(target);
  const keys = Object.keys(patch) as (keyof T)[];
  const fresh = keys.filter((k) => written !== null && !written.has(k));
  const saved = keys.map((k) => [k, raw[k]] as const);
  Object.assign(target, patch);
  try {
    return run();
  } finally {
    for (const [k, v] of saved) raw[k] = v;
    for (const k of fresh) written?.delete(k);
  }
}

export function preservingFields<T extends object, R>(target: T, keys: readonly (keyof T)[], run: () => R): R {
  const raw = rawObject(target);
  const written = writtenKeys(target);
  const fresh = keys.filter((k) => written !== null && !written.has(k));
  const saved = keys.map((k) => [k, raw[k]] as const);
  try {
    return run();
  } finally {
    for (const [k, v] of saved) raw[k] = v;
    for (const k of fresh) written?.delete(k);
  }
}

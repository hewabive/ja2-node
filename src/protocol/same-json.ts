type JsonObject = Readonly<Record<string, unknown>>;

function omitted(value: unknown): boolean {
  return value === undefined || typeof value === 'function' || typeof value === 'symbol';
}

function asJsonValue(value: unknown): unknown {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  return omitted(value) ? undefined : value;
}

function asArrayItem(value: unknown): unknown {
  return omitted(value) ? null : value;
}

function hasToJson(value: unknown): boolean {
  return typeof value === 'object' && value !== null && typeof (value as { readonly toJSON?: unknown }).toJSON === 'function';
}

function sameArray(a: readonly unknown[], b: readonly unknown[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (!sameJson(asArrayItem(a[i]), asArrayItem(b[i]))) return false;
  return true;
}

function nextPresentKey(o: JsonObject, keys: readonly string[], from: number): number {
  let i = from;
  while (i < keys.length && omitted(o[keys[i] as string])) i++;
  return i;
}

function sameObject(a: JsonObject, b: JsonObject): boolean {
  const ka = Object.keys(a);
  const kb = Object.keys(b);
  let i = nextPresentKey(a, ka, 0);
  let j = nextPresentKey(b, kb, 0);
  while (i < ka.length && j < kb.length) {
    const key = ka[i] as string;
    if (key !== kb[j] || !sameJson(a[key], b[key])) return false;
    i = nextPresentKey(a, ka, i + 1);
    j = nextPresentKey(b, kb, j + 1);
  }
  return i === ka.length && j === kb.length;
}

export function sameJson(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  const x = asJsonValue(a);
  const y = asJsonValue(b);
  if (x === y) return true;
  if (hasToJson(x) || hasToJson(y)) return JSON.stringify(x) === JSON.stringify(y);
  if (typeof x !== 'object' || typeof y !== 'object' || x === null || y === null) return false;
  if (Array.isArray(x) || Array.isArray(y)) return Array.isArray(x) && Array.isArray(y) && sameArray(x, y);
  return sameObject(x as JsonObject, y as JsonObject);
}

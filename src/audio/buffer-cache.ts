export const SOUND_CACHE_ENTRIES = 128;

export class LruCache<V> {
  readonly capacity: number;
  readonly #entries = new Map<string, V>();

  constructor(capacity = SOUND_CACHE_ENTRIES) {
    this.capacity = capacity;
  }

  get size(): number {
    return this.#entries.size;
  }

  get(key: string): V | undefined {
    const value = this.#entries.get(key);
    if (value === undefined) return undefined;
    this.#entries.delete(key);
    this.#entries.set(key, value);
    return value;
  }

  has(key: string): boolean {
    return this.#entries.has(key);
  }

  set(key: string, value: V): void {
    this.#entries.delete(key);
    this.#entries.set(key, value);
    while (this.#entries.size > this.capacity) {
      const oldest = this.#entries.keys().next().value;
      if (oldest === undefined) break;
      this.#entries.delete(oldest);
    }
  }

  keys(): string[] {
    return [...this.#entries.keys()];
  }
}

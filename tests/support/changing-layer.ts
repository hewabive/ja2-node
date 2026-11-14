import { createHash } from 'node:crypto';
import type { VfsChangeListener, VfsLayer, VfsLayerEntry } from '../../src/content/vfs/vfs.ts';

export const CHANGING_FILE = 'tables/layout.json';

export function sha256Hex(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}

export class ChangingFile implements VfsLayer {
  readonly name = 'changing';
  readonly #versions: readonly Uint8Array<ArrayBuffer>[];
  readonly #listeners: VfsChangeListener[] = [];
  #version = 0;
  reads = 0;
  onRead: (() => void) | null = null;
  gate: Promise<void> | null = null;

  constructor(versions: readonly string[]) {
    this.#versions = versions.map((text) => new TextEncoder().encode(text));
  }

  *entries(): Iterable<VfsLayerEntry> {
    yield { path: CHANGING_FILE, size: this.#current().length };
  }

  stamp(): string {
    return `version ${this.#version}`;
  }

  onChange(listener: VfsChangeListener): void {
    this.#listeners.push(listener);
  }

  change(): void {
    this.#version++;
    for (const listener of this.#listeners) listener({ path: CHANGING_FILE, size: this.#current().length });
  }

  async read(_path: string, start: number, end: number): Promise<Uint8Array<ArrayBuffer>> {
    this.reads++;
    this.onRead?.();
    const bytes = this.#current();
    await this.gate;
    return bytes.slice(start, end);
  }

  #current(): Uint8Array<ArrayBuffer> {
    const bytes = this.#versions[this.#version];
    if (!bytes) throw new Error(`no version ${this.#version}`);
    return bytes;
  }
}

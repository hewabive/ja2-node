import { decodeEdtRecord, type EdtEncoding } from '../../content/formats/edt.ts';
import type { EdtLayouts } from '../../content/text/edt-layouts.ts';

export class EdtTextCache {
  readonly #layouts: EdtLayouts;
  readonly #encoding: EdtEncoding;
  readonly #files = new Map<string, Uint8Array>();

  constructor(layouts: EdtLayouts, encoding: EdtEncoding) {
    this.#layouts = layouts;
    this.#encoding = encoding;
  }

  has(file: string): boolean {
    return this.#files.has(file.toLowerCase());
  }

  add(file: string, bytes: Uint8Array): void {
    this.#files.set(file.toLowerCase(), bytes);
  }

  field(file: string, index: number): string | null {
    const bytes = this.#files.get(file.toLowerCase());
    const layout = this.#layouts.layoutOf(file);
    if (!bytes || !layout || !Number.isInteger(index) || index < 0) return null;
    const columns = layout.columns.length;
    const record = decodeEdtRecord(bytes, Math.floor(index / columns), layout.columns, this.#encoding);
    return record?.[index % columns] ?? null;
  }
}

import { createHash } from 'node:crypto';
import { decodeEdtRecord, decodeEdtRow, type EdtEncoding } from '../content/formats/edt.ts';
import type { TextKey } from '../content/narrative/dialogue-text.ts';
import { type DataVersion, displayLanguageOf, edtEncodingOf, STUB_DATA_VERSION, type UiLanguage } from '../content/text/data-version.ts';
import { EDT_LAYOUTS_PATH, type EdtLayout, EdtLayouts } from '../content/text/edt-layouts.ts';
import { loadTranslationLayout, loadUiStrings, type TranslationLayout, type UiStrings, uiString } from '../content/text/strings.ts';
import type { Vfs } from '../content/vfs/vfs.ts';
import { TEXT_KEYS } from './text-keys.ts';

export const STUB_TEXT_PREFIX = 'stubs/';
const ETAG_HEX_DIGITS = 16;

export interface TextServiceOptions {
  readonly vfs: Vfs;
  readonly dataVersion: DataVersion;
}

export interface EdtRecordText {
  readonly file: string;
  readonly row: number;
  readonly layout: readonly number[];
  readonly columns: readonly string[];
}

export type EdtLookup =
  | { readonly ok: true; readonly record: EdtRecordText }
  | { readonly ok: false; readonly error: 'noLayout' | 'notFound' | 'noRow' };

export interface LoadedUiStrings {
  readonly strings: UiStrings;
  readonly body: string;
  readonly etag: string;
}

export class TextService {
  readonly dataVersion: DataVersion;
  readonly encoding: EdtEncoding;
  readonly #vfs: Vfs;
  #layouts: Promise<EdtLayouts> | null = null;
  #translationLayout: Promise<TranslationLayout> | null = null;
  readonly #strings = new Map<UiLanguage, Promise<LoadedUiStrings>>();

  constructor(options: TextServiceOptions) {
    this.#vfs = options.vfs;
    this.dataVersion = options.dataVersion;
    this.encoding = edtEncodingOf(options.dataVersion);
  }

  get dataLanguage(): UiLanguage {
    return displayLanguageOf(this.dataVersion);
  }

  readonly #read = async (path: string): Promise<Uint8Array | null> => (this.#vfs.stat(path) ? this.#vfs.read(path) : null);

  #edtLayouts(): Promise<EdtLayouts> {
    this.#layouts ??= this.#read(EDT_LAYOUTS_PATH).then((bytes) =>
      EdtLayouts.parse(bytes ? JSON.parse(new TextDecoder().decode(bytes)) : { files: [] }),
    );
    return this.#layouts;
  }

  async layoutOf(file: string): Promise<EdtLayout | null> {
    return (await this.#edtLayouts()).layoutOf(file);
  }

  #sourcePath(path: string): string | null {
    if (this.#vfs.stat(path)) return path;
    const stub = `${STUB_TEXT_PREFIX}${path}`;
    return this.dataVersion === STUB_DATA_VERSION && this.#vfs.stat(stub) ? stub : null;
  }

  async #bytes(path: string): Promise<Uint8Array | null> {
    const source = this.#sourcePath(path);
    return source ? this.#vfs.read(source) : null;
  }

  async edtRecord(file: string, row: number): Promise<EdtLookup> {
    const layout = await this.layoutOf(file);
    if (!layout) return { ok: false, error: 'noLayout' };
    const bytes = await this.#bytes(layout.path);
    if (!bytes) return { ok: false, error: 'notFound' };
    const columns = decodeEdtRecord(bytes, row, layout.columns, this.encoding);
    if (!columns) return { ok: false, error: 'noRow' };
    return { ok: true, record: { file: layout.path, row, layout: layout.columns, columns } };
  }

  async text(key: TextKey): Promise<string | null> {
    const bytes = await this.#bytes(key.file);
    return bytes ? decodeEdtRow(bytes, key.row, key.width, this.encoding) : null;
  }

  #loadStrings(language: UiLanguage): Promise<LoadedUiStrings> {
    this.#translationLayout ??= loadTranslationLayout(this.#read);
    return this.#translationLayout.then(async (layout) => {
      const strings = await loadUiStrings(this.#read, language, layout);
      const body = JSON.stringify({ ...strings, keys: TEXT_KEYS });
      const digest = createHash('sha256').update(body).digest('hex').slice(0, ETAG_HEX_DIGITS);
      return { strings, body, etag: `"strings-${language}-${digest}"` };
    });
  }

  strings(language: UiLanguage): Promise<LoadedUiStrings> {
    const known = this.#strings.get(language);
    if (known) return known;
    const fresh = this.#loadStrings(language);
    this.#strings.set(language, fresh);
    fresh.catch(() => this.#strings.delete(language));
    return fresh;
  }

  async uiText(language: UiLanguage, table: string, index?: number): Promise<string | null> {
    return uiString((await this.strings(language)).strings, table, index);
  }
}

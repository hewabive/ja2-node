import { type FileHandle, open } from 'node:fs/promises';
import { basename } from 'node:path';
import {
  parseSlfEntries,
  parseSlfHeader,
  SLF_HEADER_BYTES,
  SlfEntryState,
  type SlfHeader,
  slfDirectoryRange,
  slfEntryPath,
} from '../content/formats/slf.ts';
import { type VfsLayer, type VfsLayerEntry, VfsNotFoundError } from '../content/vfs/vfs.ts';
import { readExactly } from './file-range.ts';

export class SlfFileLayer implements VfsLayer {
  readonly name: string;
  readonly filePath: string;
  readonly header: SlfHeader;
  readonly #archiveStamp: string;
  readonly #handle: FileHandle;
  readonly #entries: Map<string, { offset: number; length: number }>;

  private constructor(
    filePath: string,
    archiveStamp: string,
    handle: FileHandle,
    header: SlfHeader,
    entries: Map<string, { offset: number; length: number }>,
  ) {
    this.name = basename(filePath).toLowerCase();
    this.filePath = filePath;
    this.header = header;
    this.#archiveStamp = archiveStamp;
    this.#handle = handle;
    this.#entries = entries;
  }

  static async open(filePath: string): Promise<SlfFileLayer> {
    const handle = await open(filePath, 'r');
    try {
      const { size, mtimeMs } = await handle.stat();
      const header = parseSlfHeader(await readExactly(handle, 0, SLF_HEADER_BYTES));
      const dir = slfDirectoryRange(header, size);
      const list = parseSlfEntries(await readExactly(handle, dir.offset, dir.length), header.numEntries, size);
      const entries = new Map<string, { offset: number; length: number }>();
      for (const e of list) {
        if (e.state !== SlfEntryState.OK) continue;
        const path = slfEntryPath(header, e);
        if (!entries.has(path)) entries.set(path, { offset: e.offset, length: e.length });
      }
      return new SlfFileLayer(filePath, [filePath, size, mtimeMs].join('\t'), handle, header, entries);
    } catch (err) {
      await handle.close();
      throw new Error(`cannot open SLF ${filePath}: ${(err as Error).message}`, { cause: err });
    }
  }

  *entries(): Iterable<VfsLayerEntry> {
    for (const [path, e] of this.#entries) yield { path, size: e.length };
  }

  stamp(path: string): string | null {
    const e = this.#entries.get(path);
    return e ? [this.#archiveStamp, e.offset, e.length].join('\t') : null;
  }

  async read(path: string, start: number, end: number): Promise<Uint8Array<ArrayBuffer>> {
    const e = this.#entries.get(path);
    if (!e) throw new VfsNotFoundError(path);
    return readExactly(this.#handle, e.offset + start, end - start);
  }

  close(): Promise<void> {
    return this.#handle.close();
  }
}

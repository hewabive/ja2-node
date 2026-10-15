// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-15. See LICENSE (SFI-SCLA).
// @src rust/stracciatella/src/file_formats/slf.rs, rust/stracciatella/src/vfs/slf.rs

import { FormatError } from '../binary/errors.ts';
import { BinaryReader } from '../binary/reader.ts';
import { BinaryWriter } from '../binary/writer.ts';
import { joinVfsPath } from '../vfs/path.ts';

export const SLF_HEADER_BYTES = 532;
export const SLF_ENTRY_BYTES = 280;
const UNSORTED = 0xffff;
const LIBRARY_VERSION_2_0 = 0x0200;

export const SlfEntryState = {
  OK: 0x00,
  OLD: 0x01,
  DOES_NOT_EXIST: 0xfe,
  DELETED: 0xff,
} as const;

export interface SlfHeader {
  readonly libraryName: string;
  readonly libraryPath: string;
  readonly numEntries: number;
  readonly okEntries: number;
  readonly sort: number;
  readonly version: number;
  readonly containsSubdirectories: number;
}

export interface SlfEntry {
  readonly name: string;
  readonly offset: number;
  readonly length: number;
  readonly state: number;
  readonly fileTime: bigint;
}

export function parseSlfHeader(bytes: Uint8Array): SlfHeader {
  if (bytes.length < SLF_HEADER_BYTES) {
    throw new FormatError(`SLF header needs ${SLF_HEADER_BYTES} bytes, got ${bytes.length}`);
  }
  const r = new BinaryReader(bytes);
  const header: SlfHeader = {
    libraryName: r.fixedString(256),
    libraryPath: r.fixedString(256),
    numEntries: r.i32(),
    okEntries: r.i32(),
    sort: r.u16(),
    version: r.u16(),
    containsSubdirectories: r.u8(),
  };
  if (header.numEntries < 0) throw new FormatError(`bad SLF entry count ${header.numEntries}`);
  return header;
}

export function slfDirectoryRange(header: SlfHeader, fileSize: number): { offset: number; length: number } {
  const length = header.numEntries * SLF_ENTRY_BYTES;
  const offset = fileSize - length;
  if (offset < SLF_HEADER_BYTES) {
    throw new FormatError(`SLF directory (${header.numEntries} entries) does not fit into ${fileSize} bytes`);
  }
  return { offset, length };
}

export function parseSlfEntries(bytes: Uint8Array, count: number, fileSize: number): SlfEntry[] {
  if (bytes.length < count * SLF_ENTRY_BYTES) {
    throw new FormatError(`SLF directory needs ${count * SLF_ENTRY_BYTES} bytes, got ${bytes.length}`);
  }
  const r = new BinaryReader(bytes);
  const entries: SlfEntry[] = [];
  for (let i = 0; i < count; i++) {
    const name = r.fixedString(256);
    const offset = r.u32();
    const length = r.u32();
    const state = r.u8();
    r.skip(3);
    const fileTime = r.u64();
    r.skip(4);
    if (state === SlfEntryState.OK && offset + length > fileSize) {
      throw new FormatError(`SLF entry ${name} points outside the file`);
    }
    entries.push({ name, offset, length, state, fileTime });
  }
  return entries;
}

export function slfEntryPath(header: SlfHeader, entry: SlfEntry): string {
  return joinVfsPath(header.libraryPath, entry.name);
}

export function readSlf(bytes: Uint8Array): { header: SlfHeader; entries: SlfEntry[] } {
  const header = parseSlfHeader(bytes);
  const dir = slfDirectoryRange(header, bytes.length);
  const entries = parseSlfEntries(bytes.subarray(dir.offset, dir.offset + dir.length), header.numEntries, bytes.length);
  return { header, entries };
}

export interface SlfWriteInput {
  readonly libraryName: string;
  readonly libraryPath: string;
  readonly files: readonly { readonly name: string; readonly data: Uint8Array; readonly state?: number }[];
}

export function writeSlf(input: SlfWriteInput): Uint8Array {
  const w = new BinaryWriter(SLF_HEADER_BYTES + 1024);
  const ok = input.files.filter((f) => (f.state ?? SlfEntryState.OK) === SlfEntryState.OK).length;
  w.fixedString(256, input.libraryName)
    .fixedString(256, input.libraryPath)
    .i32(input.files.length)
    .i32(ok)
    .u16(UNSORTED)
    .u16(LIBRARY_VERSION_2_0)
    .u8(0)
    .zeros(7);
  const offsets: number[] = [];
  for (const f of input.files) {
    offsets.push(w.length);
    w.bytes(f.data);
  }
  input.files.forEach((f, i) => {
    w.fixedString(256, f.name)
      .u32(offsets[i] ?? 0)
      .u32(f.data.length)
      .u8(f.state ?? SlfEntryState.OK)
      .zeros(3)
      .u64(0n)
      .zeros(4);
  });
  return w.toBytes();
}

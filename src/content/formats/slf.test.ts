import { describe, expect, it } from 'vitest';
import { FormatError } from '../binary/errors.ts';
import { readSlf, SLF_ENTRY_BYTES, SLF_HEADER_BYTES, SlfEntryState, slfEntryPath, writeSlf } from './slf.ts';

const bytes = (s: string) => new TextEncoder().encode(s);

describe('SLF', () => {
  it('reads back what it wrote', () => {
    const slf = writeSlf({
      libraryName: 'test',
      libraryPath: 'ANIMS\\',
      files: [
        { name: 'S_MERC\\WALK.STI', data: bytes('walk') },
        { name: 'old.txt', data: bytes('gone'), state: SlfEntryState.DELETED },
      ],
    });
    expect(slf.length).toBe(SLF_HEADER_BYTES + 8 + 2 * SLF_ENTRY_BYTES);
    const { header, entries } = readSlf(slf);
    expect(header.libraryPath).toBe('ANIMS\\');
    expect(header.numEntries).toBe(2);
    expect(header.okEntries).toBe(1);
    const [walk, old] = entries;
    expect(walk && slfEntryPath(header, walk)).toBe('anims/s_merc/walk.sti');
    expect(walk && new TextDecoder().decode(slf.subarray(walk.offset, walk.offset + walk.length))).toBe('walk');
    expect(old?.state).toBe(SlfEntryState.DELETED);
  });

  it('rejects truncated files', () => {
    expect(() => readSlf(new Uint8Array(100))).toThrow(FormatError);
    const slf = writeSlf({ libraryName: 'x', libraryPath: '', files: [{ name: 'a', data: bytes('a') }] });
    expect(() => readSlf(slf.subarray(0, SLF_HEADER_BYTES + 10))).toThrow(FormatError);
  });
});

import { describe, expect, it } from 'vitest';
import {
  CIV_QUOTE_TEXT_SIZE,
  DIALOGUE_SIZE,
  decodeEdtRecord,
  decodeEdtRow,
  edtRecordWidth,
  edtRowCount,
  encodeEdtFile,
  encodeEdtRecords,
  utf32Length,
} from './edt.ts';

function rawRow(units: readonly number[], width = DIALOGUE_SIZE): Uint8Array {
  const out = new Uint8Array(width * 2);
  const v = new DataView(out.buffer);
  units.forEach((u, i) => {
    v.setUint16(i * 2, u, true);
  });
  return out;
}

describe('EDT rows', () => {
  it('subtract one from every unit above 33 and keep the others', () => {
    expect(decodeEdtRow(rawRow([0x49, 0x21, 0x22, 0x20, 0x62]), 0)).toBe('H!! a');
  });

  it('stop at the first NUL and force the last unit to NUL', () => {
    const full = rawRow(new Array<number>(DIALOGUE_SIZE).fill(0x42));
    expect(decodeEdtRow(full, 0)).toBe('A'.repeat(DIALOGUE_SIZE - 1));
    expect(decodeEdtRow(rawRow([0x42, 0, 0x42]), 0)).toBe('A');
  });

  it('address rows by width and report missing rows as null', () => {
    const file = encodeEdtFile(['first', 'second'], CIV_QUOTE_TEXT_SIZE);
    expect(edtRowCount(file, CIV_QUOTE_TEXT_SIZE)).toBe(2);
    expect(decodeEdtRow(file, 1, CIV_QUOTE_TEXT_SIZE)).toBe('second');
    expect(decodeEdtRow(file, 2, CIV_QUOTE_TEXT_SIZE)).toBeNull();
  });

  it('apply the English code point fix-ups', () => {
    expect(decodeEdtRow(rawRow([129, 131, 136]), 0, DIALOGUE_SIZE, 'english')).toBe('Çéç');
    expect(decodeEdtRow(rawRow([129]), 0, DIALOGUE_SIZE, 'other')).toBe('\u0080');
  });

  it('map the CP1252-read CP1251 range to Cyrillic in the Russian mode only', () => {
    expect(decodeEdtRow(rawRow([0xc1, 0xe0, 0x101]), 0, DIALOGUE_SIZE, 'russian')).toBe('АЯĀ');
    expect(decodeEdtRow(rawRow([0xc1]), 0, DIALOGUE_SIZE, 'english')).toBe('À');
  });

  it('leave the CP1251 letters Ё and ё and the sign № outside that range as their CP1252 characters', () => {
    const cp1251 = { YO: 0xa8, SMALL_YO: 0xb8, NUMERO: 0xb9 };
    const rot1 = (unit: number) => unit + 1;
    const row = rawRow([cp1251.YO, cp1251.SMALL_YO, cp1251.NUMERO].map(rot1));
    expect(decodeEdtRow(row, 0, DIALOGUE_SIZE, 'russian')).toBe('¨¸¹');
  });

  it('decode multi-column records column by column', () => {
    const columns = [8, 4, 6];
    const file = encodeEdtRecords(
      [
        ['name', 'id', 'info'],
        ['second', '', 'more'],
      ],
      columns,
    );
    expect(file.length).toBe(2 * edtRecordWidth(columns) * 2);
    expect(decodeEdtRecord(file, 0, columns)).toEqual(['name', 'id', 'info']);
    expect(decodeEdtRecord(file, 1, columns)).toEqual(['second', '', 'more']);
    expect(decodeEdtRecord(file, 2, columns)).toBeNull();
    expect(decodeEdtRecord(file, 0, [18])).toEqual(['name']);
  });

  it('count characters as UTF-32 code points', () => {
    expect(utf32Length('ab')).toBe(2);
    expect(utf32Length('\u{1f600}x')).toBe(2);
  });
});

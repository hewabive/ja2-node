import { describe, expect, it } from 'vitest';
import { BinaryReader } from './reader.ts';
import { BinaryWriter } from './writer.ts';

describe('BinaryWriter', () => {
  it('grows without losing data written across the buffer boundary', () => {
    const w = new BinaryWriter(4);
    w.u8(1).u16(0x0203).u32(0x04050607).i16(-2).i32(-3).u64(0x0102030405060708n);
    w.bytes(new Uint8Array(100).fill(9)).zeros(3).fixedString(8, 'abc');
    const r = new BinaryReader(w.toBytes());
    expect([r.u8(), r.u16(), r.u32(), r.i16(), r.i32()]).toEqual([1, 0x0203, 0x04050607, -2, -3]);
    expect(r.u64()).toBe(0x0102030405060708n);
    expect(r.bytesView(100).every((b) => b === 9)).toBe(true);
    expect([...r.bytesView(3)]).toEqual([0, 0, 0]);
    expect(r.fixedString(8)).toBe('abc');
    expect(r.remaining).toBe(0);
  });

  it('patches u32 values and validates input', () => {
    const w = new BinaryWriter().u32(0).u32(7);
    w.patchU32(0, 42);
    expect(new BinaryReader(w.toBytes()).u32()).toBe(42);
    expect(() => w.patchU32(8, 1)).toThrow(RangeError);
    expect(() => new BinaryWriter().fixedString(3, 'abc')).toThrow(RangeError);
  });
});

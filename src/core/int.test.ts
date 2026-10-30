import { describe, expect, it } from 'vitest';
import { clamp, i8, i16, i32, idiv, imod, u8, u16, u32, udiv } from './int.ts';

describe('fixed-width casts', () => {
  it('wrap like C', () => {
    expect(u8(256)).toBe(0);
    expect(u8(-1)).toBe(255);
    expect(i8(128)).toBe(-128);
    expect(i8(-129)).toBe(127);
    expect(u16(65536 + 5)).toBe(5);
    expect(i16(32768)).toBe(-32768);
    expect(u32(-1)).toBe(0xffffffff);
    expect(i32(0x80000000)).toBe(-0x80000000);
  });

  it('truncate fractions toward zero', () => {
    expect(i8(-3.9)).toBe(-3);
    expect(u8(3.9)).toBe(3);
  });
});

describe('idiv and imod', () => {
  it('truncate toward zero', () => {
    expect(idiv(7, 2)).toBe(3);
    expect(idiv(-7, 2)).toBe(-3);
    expect(idiv(7, -2)).toBe(-3);
    expect(imod(-7, 2)).toBe(-1);
    expect(imod(7, -2)).toBe(1);
  });

  it('udiv divides unsigned 32-bit values past the int32 range', () => {
    expect(udiv(0xffffffff, 1)).toBe(0xffffffff);
    expect(udiv(0xfffffff0, 0x10)).toBe(0x0fffffff);
    expect(idiv(0xffffffff, 1)).toBe(-1);
  });

  it('throw on division by zero', () => {
    expect(() => idiv(1, 0)).toThrow(RangeError);
    expect(() => udiv(1, 0)).toThrow(RangeError);
    expect(() => imod(1, 0)).toThrow(RangeError);
  });

  it('clamp', () => {
    expect(clamp(5, 0, 3)).toBe(3);
    expect(clamp(-5, 0, 3)).toBe(0);
    expect(clamp(2, 0, 3)).toBe(2);
  });
});

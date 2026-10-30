export function u8(x: number): number {
  return x & 0xff;
}

export function i8(x: number): number {
  return (x << 24) >> 24;
}

export function u16(x: number): number {
  return x & 0xffff;
}

export function i16(x: number): number {
  return (x << 16) >> 16;
}

export function u32(x: number): number {
  return x >>> 0;
}

export function i32(x: number): number {
  return x | 0;
}

export function idiv(a: number, b: number): number {
  if (b === 0) throw new RangeError('integer division by zero');
  return Math.trunc(a / b) | 0;
}

export function udiv(a: number, b: number): number {
  if (b === 0) throw new RangeError('integer division by zero');
  return Math.trunc(a / b) >>> 0;
}

export function imod(a: number, b: number): number {
  if (b === 0) throw new RangeError('integer modulo by zero');
  return (a % b) | 0;
}

export function clamp(x: number, lo: number, hi: number): number {
  return x < lo ? lo : x > hi ? hi : x;
}

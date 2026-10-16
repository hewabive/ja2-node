import { FormatError } from '../binary/errors.ts';

const UTF16_BYTES = 2;
const UTF32_BYTES = 4;
const MAX_CODE_POINT = 0x10ffff;
const REPLACEMENT_CHARACTER = 0xfffd;

export class SaveCursor {
  readonly bytes: Uint8Array;
  readonly #view: DataView;
  pos: number;

  constructor(bytes: Uint8Array, pos = 0) {
    this.bytes = bytes;
    this.#view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    this.pos = pos;
  }

  get remaining(): number {
    return this.bytes.length - this.pos;
  }

  #take(n: number): number {
    const at = this.pos;
    if (n < 0 || at + n > this.bytes.length) {
      throw new FormatError(`unexpected end of savegame data: need ${n} bytes at ${at}, have ${this.remaining}`);
    }
    this.pos = at + n;
    return at;
  }

  u8(): number {
    return this.#view.getUint8(this.#take(1));
  }

  i8(): number {
    return this.#view.getInt8(this.#take(1));
  }

  bool(): boolean {
    return this.u8() !== 0;
  }

  u16(): number {
    return this.#view.getUint16(this.#take(2), true);
  }

  i16(): number {
    return this.#view.getInt16(this.#take(2), true);
  }

  u32(): number {
    return this.#view.getUint32(this.#take(4), true);
  }

  i32(): number {
    return this.#view.getInt32(this.#take(4), true);
  }

  f32(): number {
    return this.#view.getFloat32(this.#take(4), true);
  }

  skip(n: number): void {
    this.#take(n);
  }

  view(n: number): Uint8Array {
    const at = this.#take(n);
    return this.bytes.subarray(at, at + n);
  }

  i8s(n: number): number[] {
    return Array.from({ length: n }, () => this.i8());
  }

  u8s(n: number): number[] {
    return Array.from({ length: n }, () => this.u8());
  }

  i16s(n: number): number[] {
    return Array.from({ length: n }, () => this.i16());
  }

  u16s(n: number): number[] {
    return Array.from({ length: n }, () => this.u16());
  }

  u32s(n: number): number[] {
    return Array.from({ length: n }, () => this.u32());
  }

  ascii(n: number): string {
    return String.fromCharCode(...untilZero(Array.from(this.view(n))));
  }

  utf16(chars: number): string {
    return String.fromCharCode(...untilZero(Array.from({ length: chars }, () => this.u16())));
  }

  utf32(chars: number): string {
    const codes = untilZero(Array.from({ length: chars }, () => this.u32()));
    return String.fromCodePoint(...codes.map((c) => (c > MAX_CODE_POINT ? REPLACEMENT_CHARACTER : c)));
  }

  wideString(chars: number, utf32: boolean): string {
    return utf32 ? this.utf32(chars) : this.utf16(chars);
  }

  static wideBytes(chars: number, utf32: boolean): number {
    return chars * (utf32 ? UTF32_BYTES : UTF16_BYTES);
  }

  expectConsumed(start: number, size: number, what: string): void {
    if (this.pos - start !== size) throw new FormatError(`${what}: consumed ${this.pos - start} bytes, expected ${size}`);
  }
}

function untilZero(codes: readonly number[]): number[] {
  const end = codes.indexOf(0);
  return end < 0 ? [...codes] : codes.slice(0, end);
}

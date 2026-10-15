import { FormatError } from './errors.ts';

export class BinaryReader {
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

  #need(n: number): number {
    const at = this.pos;
    if (at + n > this.bytes.length) {
      throw new FormatError(`unexpected end of data: need ${n} bytes at ${at}, have ${this.remaining}`);
    }
    this.pos = at + n;
    return at;
  }

  u8(): number {
    return this.#view.getUint8(this.#need(1));
  }

  u16(): number {
    return this.#view.getUint16(this.#need(2), true);
  }

  i16(): number {
    return this.#view.getInt16(this.#need(2), true);
  }

  u32(): number {
    return this.#view.getUint32(this.#need(4), true);
  }

  i32(): number {
    return this.#view.getInt32(this.#need(4), true);
  }

  u64(): bigint {
    return this.#view.getBigUint64(this.#need(8), true);
  }

  bytesView(n: number): Uint8Array {
    const at = this.#need(n);
    return this.bytes.subarray(at, at + n);
  }

  skip(n: number): void {
    this.#need(n);
  }

  fixedString(n: number): string {
    const raw = this.bytesView(n);
    let end = raw.indexOf(0);
    if (end < 0) end = n;
    let s = '';
    for (let i = 0; i < end; i++) s += String.fromCharCode(raw[i] ?? 0);
    return s;
  }
}

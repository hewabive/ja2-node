export class BinaryWriter {
  #buf: Uint8Array<ArrayBuffer>;
  #view: DataView;
  #len = 0;

  constructor(capacity = 1024) {
    this.#buf = new Uint8Array(capacity);
    this.#view = new DataView(this.#buf.buffer);
  }

  get length(): number {
    return this.#len;
  }

  #ensure(n: number): number {
    const at = this.#len;
    if (at + n > this.#buf.length) {
      let cap = this.#buf.length * 2;
      while (cap < at + n) cap *= 2;
      const next = new Uint8Array(cap);
      next.set(this.#buf.subarray(0, at));
      this.#buf = next;
      this.#view = new DataView(next.buffer);
    }
    this.#len = at + n;
    return at;
  }

  u8(v: number): this {
    const at = this.#ensure(1);
    this.#view.setUint8(at, v);
    return this;
  }

  u16(v: number): this {
    const at = this.#ensure(2);
    this.#view.setUint16(at, v, true);
    return this;
  }

  i16(v: number): this {
    const at = this.#ensure(2);
    this.#view.setInt16(at, v, true);
    return this;
  }

  u32(v: number): this {
    const at = this.#ensure(4);
    this.#view.setUint32(at, v, true);
    return this;
  }

  i32(v: number): this {
    const at = this.#ensure(4);
    this.#view.setInt32(at, v, true);
    return this;
  }

  u64(v: bigint): this {
    const at = this.#ensure(8);
    this.#view.setBigUint64(at, v, true);
    return this;
  }

  bytes(data: Uint8Array): this {
    const at = this.#ensure(data.length);
    this.#buf.set(data, at);
    return this;
  }

  zeros(n: number): this {
    const at = this.#ensure(n);
    this.#buf.fill(0, at, this.#len);
    return this;
  }

  fixedString(n: number, s: string): this {
    if (s.length >= n) throw new RangeError(`string too long for ${n} bytes: ${s}`);
    const at = this.#ensure(n);
    this.#buf.fill(0, at, at + n);
    for (let i = 0; i < s.length; i++) {
      const c = s.charCodeAt(i);
      if (c > 0xff) throw new RangeError(`non-Latin-1 character in ${s}`);
      this.#buf[at + i] = c;
    }
    return this;
  }

  patchU32(at: number, v: number): this {
    if (at + 4 > this.#len) throw new RangeError('patch outside written data');
    this.#view.setUint32(at, v, true);
    return this;
  }

  toBytes(): Uint8Array<ArrayBuffer> {
    return this.#buf.slice(0, this.#len);
  }
}

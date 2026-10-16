import type { RandomStream } from '../../../tactical/combat/context.ts';

export interface TracedDraw {
  readonly n: number;
  readonly v: number;
}

export class DrawMismatch extends Error {
  readonly stream: string;
  readonly position: number;

  constructor(stream: string, position: number, message: string) {
    super(`${stream} draw #${position}: ${message}`);
    this.stream = stream;
    this.position = position;
  }
}

export class ReplayStream implements RandomStream {
  readonly name: string;
  readonly #draws: readonly TracedDraw[];
  #position = 0;

  constructor(name: string, draws: readonly TracedDraw[]) {
    this.name = name;
    this.#draws = draws;
  }

  get position(): number {
    return this.#position;
  }

  get remaining(): number {
    return this.#draws.length - this.#position;
  }

  skipTo(position: number): void {
    this.#position = position;
  }

  int(n: number): number {
    if (n === 0) return 0;
    const draw = this.#draws[this.#position];
    if (!draw) throw new DrawMismatch(this.name, this.#position, `trace exhausted, wanted range ${n}`);
    if (draw.n !== n)
      throw new DrawMismatch(this.name, this.#position, `range ${n} requested, trace has range ${draw.n} (value ${draw.v})`);
    this.#position++;
    return draw.v;
  }
}

export class ScriptedStream implements RandomStream {
  readonly requested: number[] = [];
  readonly #values: number[];
  readonly #fallback: number | null;

  constructor(values: readonly number[], fallback: number | null = null) {
    this.#values = [...values];
    this.#fallback = fallback;
  }

  get left(): number {
    return this.#values.length;
  }

  push(...values: number[]): void {
    this.#values.push(...values);
  }

  int(n: number): number {
    if (n === 0) return 0;
    this.requested.push(n);
    const v = this.#values.shift() ?? this.#fallback;
    if (v === null) throw new RangeError(`scripted stream exhausted at a draw of range ${n}`);
    if (v < 0 || v >= n) throw new RangeError(`scripted value ${v} outside range ${n}`);
    return v;
  }
}

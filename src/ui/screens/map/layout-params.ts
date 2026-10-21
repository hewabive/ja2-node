import type { LayoutModel } from '../../layout/model.ts';
import type { NumberExpr } from '../../layout/types.ts';
import type { BitmapFont } from '../../text/bitmap-font.ts';
import type { FontSet } from '../../text/fonts.ts';

export type Params = Readonly<Record<string, unknown>>;

export class LayoutParams {
  readonly #model: LayoutModel;
  readonly #params: Params;
  readonly #fonts: FontSet;

  constructor(model: LayoutModel, params: Params, fonts: FontSet) {
    this.#model = model;
    this.#params = params;
    this.#fonts = fonts;
  }

  raw(key: string): unknown {
    return this.#params[key];
  }

  number(key: string): number {
    return this.#model.number(this.#params[key] as NumberExpr);
  }

  numbers(key: string): number[] {
    return ((this.#params[key] as readonly NumberExpr[] | undefined) ?? []).map((v) => this.#model.number(v));
  }

  pairs(key: string): (readonly [number, number])[] {
    return ((this.#params[key] as readonly (readonly NumberExpr[])[] | undefined) ?? []).map(
      (p) => [this.#model.number(p[0] as NumberExpr), this.#model.number(p[1] as NumberExpr)] as const,
    );
  }

  asset(key: string): string {
    return this.#model.asset(String(this.#params[key])).path;
  }

  font(key: string): BitmapFont {
    return this.#fonts.get(this.#model.font(String(this.#params[key])));
  }
}

export function at(values: readonly number[], index: number): number {
  return values[index] ?? 0;
}

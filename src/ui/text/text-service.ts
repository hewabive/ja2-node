import { type UiStrings, uiString } from '../../content/text/strings.ts';

export interface UiTextService {
  string(table: string, index: number): string | null;
  edt(file: string, row: number): string | null;
}

export type EdtRows = (file: string, row: number) => string | null;

export class StringsTextService implements UiTextService {
  readonly #strings: UiStrings;
  readonly #edt: EdtRows;

  constructor(strings: UiStrings, edt: EdtRows = () => null) {
    this.#strings = strings;
    this.#edt = edt;
  }

  string(table: string, index: number): string | null {
    return uiString(this.#strings, table, index);
  }

  edt(file: string, row: number): string | null {
    return this.#edt(file, row);
  }
}

export const NO_TEXT: UiTextService = { string: () => null, edt: () => null };

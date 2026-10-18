import { CREDITS_FILE, FIRST_CREDIT_ROW } from '../../content/formats/credits.ts';

export type FetchCreditRow = (row: number) => Promise<string | null>;

const HTTP_NOT_FOUND = 404;
const DEFAULT_PREFETCH = 8;

export async function fetchCreditRow(row: number): Promise<string | null> {
  const res = await fetch(`/api/text?file=${encodeURIComponent(CREDITS_FILE)}&row=${row}`);
  if (res.status === HTTP_NOT_FOUND) return null;
  if (!res.ok) throw new Error(`credits row ${row}: HTTP ${res.status}`);
  const body = (await res.json()) as { text?: unknown };
  return typeof body.text === 'string' ? body.text : '';
}

export class CreditRowFeed {
  readonly #fetchRow: FetchCreditRow;
  readonly #prefetch: number;
  readonly #rows = new Map<number, string>();
  #nextToFetch: number;
  #nextToTake: number;
  #end: number | null = null;
  #inFlight = 0;
  error: string | null = null;

  constructor(fetchRow: FetchCreditRow, prefetch = DEFAULT_PREFETCH, firstRow = FIRST_CREDIT_ROW) {
    this.#fetchRow = fetchRow;
    this.#prefetch = prefetch;
    this.#nextToFetch = firstRow;
    this.#nextToTake = firstRow;
    this.#fill();
  }

  take(): string | null | undefined {
    const row = this.#nextToTake;
    if (this.#end !== null && row >= this.#end) return null;
    const text = this.#rows.get(row);
    if (text === undefined) return undefined;
    this.#rows.delete(row);
    this.#nextToTake++;
    this.#fill();
    return text;
  }

  #fill(): void {
    while (this.#end === null && this.#inFlight < this.#prefetch && this.#nextToFetch < this.#nextToTake + this.#prefetch) {
      const row = this.#nextToFetch++;
      this.#inFlight++;
      void this.#fetchRow(row)
        .catch((err: Error) => {
          this.error = err.message;
          return null;
        })
        .then((text) => {
          this.#inFlight--;
          if (text === null) this.#end = Math.min(this.#end ?? row, row);
          else this.#rows.set(row, text);
          this.#fill();
        });
    }
  }
}

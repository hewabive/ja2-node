// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-21. See LICENSE (SFI-SCLA).
// @src src/game/Tactical/Interface_Cursors.h UICURSOR_*; src/game/Tactical/Interface_Cursors.cc gUICursors (read from
// @src data/tables/ui-cursors.json). See docs/28 §6.4.

export const UI_CURSORS_TABLE_PATH = 'tables/ui-cursors.json';

export const UiCursorFlag = {
  FREEFLOWING: 0x2,
  SNAPPING: 0x4,
  SHOWTILE: 0x8,
  CENTERAPS: 0x40,
  SHOWTILEAPDEPENDENT: 0x80,
  DONTSHOW2NDLEVEL: 0x100,
} as const;

export interface UiCursorEntry {
  readonly name: string;
  readonly flags: number;
  readonly cursor: string | null;
  readonly data: string | null;
}

export class UiCursorTable {
  readonly cursors: readonly UiCursorEntry[];
  readonly #byName: ReadonlyMap<string, UiCursorEntry>;

  constructor(cursors: readonly UiCursorEntry[]) {
    this.cursors = cursors;
    this.#byName = new Map(cursors.map((c) => [c.name, c]));
  }

  entry(name: string): UiCursorEntry {
    const found = this.#byName.get(name);
    if (!found) throw new Error(`unknown UI cursor ${name}`);
    return found;
  }

  has(name: string, flag: number): boolean {
    return (this.entry(name).flags & flag) !== 0;
  }
}

function isEntry(v: unknown): v is UiCursorEntry {
  if (typeof v !== 'object' || v === null) return false;
  const e = v as Record<string, unknown>;
  return typeof e.name === 'string' && typeof e.flags === 'number';
}

export function parseUiCursorTable(json: unknown): UiCursorTable {
  const cursors = (json as { cursors?: unknown }).cursors;
  if (!Array.isArray(cursors) || !cursors.every(isEntry)) throw new Error('bad UI cursor table');
  return new UiCursorTable(
    cursors.map((c) => ({
      name: c.name,
      flags: c.flags,
      cursor: typeof c.cursor === 'string' ? c.cursor : null,
      data: typeof c.data === 'string' ? c.data : null,
    })),
  );
}

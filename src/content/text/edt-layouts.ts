import { FormatError } from '../binary/errors.ts';
import { normalizeVfsPath } from '../vfs/path.ts';

export const EDT_LAYOUTS_PATH = 'tables/edt-layouts.json';

export interface EdtLayout {
  readonly path: string;
  readonly columns: readonly number[];
}

interface CompiledLayout extends EdtLayout {
  readonly match: RegExp;
}

const PLACEHOLDERS: Readonly<Record<string, string>> = {
  '{02d}': '\\d{2}',
  '{03d}': '\\d{3}',
  '{sector}': '[a-p](?:[1-9]|1[0-6])',
};

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function compile(path: string): RegExp {
  const parts = path.split(/(\{[^}]*\})/).map((part) => {
    if (!part.startsWith('{')) return escapeRegExp(part);
    const pattern = PLACEHOLDERS[part];
    if (!pattern) throw new FormatError(`unknown placeholder ${part} in ${path}`);
    return pattern;
  });
  return new RegExp(`^${parts.join('')}$`);
}

function columnsOf(value: unknown, path: string): number[] {
  if (!Array.isArray(value) || value.length === 0 || value.some((w) => !Number.isInteger(w) || (w as number) < 2))
    throw new FormatError(`bad columns for ${path}`);
  return value as number[];
}

export class EdtLayouts {
  readonly entries: readonly EdtLayout[];
  readonly #compiled: readonly CompiledLayout[];

  constructor(entries: readonly EdtLayout[]) {
    this.entries = entries;
    this.#compiled = entries.map((e) => ({ ...e, match: compile(e.path) }));
  }

  static parse(json: unknown): EdtLayouts {
    const files = (json as { files?: unknown } | null)?.files;
    if (!Array.isArray(files)) throw new FormatError('malformed EDT layout table');
    return new EdtLayouts(
      files.map((f: { path?: unknown; columns?: unknown }) => {
        if (typeof f.path !== 'string') throw new FormatError('EDT layout without a path');
        return { path: f.path, columns: columnsOf(f.columns, f.path) };
      }),
    );
  }

  layoutOf(file: string): EdtLayout | null {
    let path: string;
    try {
      path = normalizeVfsPath(file);
    } catch {
      return null;
    }
    const hit = this.#compiled.find((c) => c.match.test(path));
    return hit ? { path, columns: hit.columns } : null;
  }
}

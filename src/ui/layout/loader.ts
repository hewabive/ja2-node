import type { DataVersion } from '../../content/text/data-version.ts';
import { type ConstantTable, constantTablePath, parseConstantTable, SHARED_CONSTANT_TABLES } from './constants.ts';
import { type LayoutEnvironment, LayoutModel, MLG_TABLE_PATH, parseMlgTable } from './model.ts';
import { validateLayout } from './schema.ts';
import { LAYOUTS_DIR, type LayoutJson } from './types.ts';

export type ReadText = (path: string) => Promise<string | null>;

export function layoutPath(skin: string, screen: string): string {
  return `${LAYOUTS_DIR}/${skin}/${screen}.json`;
}

async function readJson(read: ReadText, path: string): Promise<unknown> {
  const text = await read(path);
  if (text === null) throw new Error(`missing ${path}`);
  return JSON.parse(text);
}

export class LayoutLoader {
  readonly #read: ReadText;
  readonly #dataVersion: DataVersion;
  readonly #tables = new Map<string, ConstantTable>();
  #mlg: LayoutEnvironment['mlg'] | null = null;

  constructor(read: ReadText, dataVersion: DataVersion) {
    this.#read = read;
    this.#dataVersion = dataVersion;
  }

  async #ensureTables(names: readonly string[]): Promise<void> {
    for (const name of [...SHARED_CONSTANT_TABLES, ...names]) {
      if (this.#tables.has(name)) continue;
      this.#tables.set(name, parseConstantTable(await readJson(this.#read, constantTablePath(name)), name));
    }
  }

  async environment(names: readonly string[] = []): Promise<LayoutEnvironment> {
    await this.#ensureTables(names);
    this.#mlg ??= parseMlgTable(await readJson(this.#read, MLG_TABLE_PATH));
    return { tables: this.#tables, mlg: this.#mlg, dataVersion: this.#dataVersion };
  }

  async fromJson(json: unknown, where: string): Promise<LayoutModel> {
    const layout: LayoutJson = validateLayout(json, where);
    return new LayoutModel(layout, await this.environment(layout.constants ?? []));
  }

  async load(skin: string, screen: string): Promise<LayoutModel> {
    const path = layoutPath(skin, screen);
    return this.fromJson(await readJson(this.#read, path), path);
  }
}

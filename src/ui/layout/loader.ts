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
  readonly #loading = new Map<string, Promise<void>>();
  #mlg: Promise<LayoutEnvironment['mlg']> | null = null;

  constructor(read: ReadText, dataVersion: DataVersion) {
    this.#read = read;
    this.#dataVersion = dataVersion;
  }

  #ensureTable(name: string): Promise<void> {
    let loading = this.#loading.get(name);
    if (!loading) {
      loading = readJson(this.#read, constantTablePath(name)).then(
        (json) => {
          this.#tables.set(name, parseConstantTable(json, name));
        },
        (err: unknown) => {
          this.#loading.delete(name);
          throw err;
        },
      );
      this.#loading.set(name, loading);
    }
    return loading;
  }

  async environment(names: readonly string[] = []): Promise<LayoutEnvironment> {
    this.#mlg ??= readJson(this.#read, MLG_TABLE_PATH).then(parseMlgTable, (err: unknown) => {
      this.#mlg = null;
      throw err;
    });
    const [mlg] = await Promise.all([this.#mlg, ...[...SHARED_CONSTANT_TABLES, ...names].map((name) => this.#ensureTable(name))]);
    return { tables: this.#tables, mlg, dataVersion: this.#dataVersion };
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

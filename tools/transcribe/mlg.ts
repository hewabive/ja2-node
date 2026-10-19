import { join } from 'node:path';
import { PROJECT_DATA_DIR } from '../../src/node/repo.ts';
import { cleanSource, enumDefinitions, expandMacros, functionMacros, objectDefines, stringLiteral } from './c-constants.ts';
import { bracedBody, readSource, STRACCIATELLA_COMMIT, writeTable } from './c-source.ts';

const GAME_RES_CC = 'game/GameRes.cc';
const GAME_RES_H = 'game/GameRes.h';
const DIRECTORIES_H = 'game/Directories.h';
const FUNCTION = 'char const* GetMLGFilename(MultiLanguageGraphic const id)';
const ID_ENUM = 'MultiLanguageGraphic';

const VERSION_OF_GAME_VERSION: Readonly<Record<string, string>> = {
  ENGLISH: 'english',
  FRENCH: 'french',
  GERMAN: 'german',
  DUTCH: 'dutch',
  ITALIAN: 'italian',
  POLISH: 'polish',
  RUSSIAN: 'russian',
  RUSSIAN_GOLD: 'russianGold',
  SIMPLIFIED_CHINESE: 'simplifiedChinese',
};

export interface MlgTable {
  readonly source: string;
  readonly license: string;
  readonly format: string;
  readonly ids: readonly string[];
  readonly versions: Readonly<Record<string, Readonly<Record<string, string>>>>;
}

export function buildMlgTable(): MlgTable {
  const src = cleanSource(readSource(GAME_RES_CC));
  const macros = functionMacros(src);
  const directories = new Map(objectDefines(cleanSource(readSource(DIRECTORIES_H))).map((d) => [d.name, d.expression.replace(/"/g, '')]));
  const ids = enumDefinitions(cleanSource(readSource(GAME_RES_H)))
    .find((e) => e.name === ID_ENUM)
    ?.members.map((m) => m.name);
  if (!ids) throw new Error(`${ID_ENUM} not found`);
  const body = bracedBody(src, FUNCTION);
  const versions: Record<string, Record<string, string>> = {};
  const blocks = body.split(/switch\s*\(\s*id\s*\)/);
  for (let i = 1; i < blocks.length; i++) {
    const condition = blocks[i - 1]?.slice(-400) ?? '';
    const names = [...condition.matchAll(/GameVersion::(\w+)/g)].map((m) => m[1] as string);
    const lastIf = condition.lastIndexOf('if');
    const own = names.filter((_, k) => condition.indexOf(`GameVersion::${names[k]}`, lastIf) >= 0);
    const files: Record<string, string> = {};
    for (const m of (blocks[i] ?? '').matchAll(/case\s+(MLG_\w+)\s*:\s*return\s+([^;]+);/g)) {
      const expression = expandMacros((m[2] as string).trim(), macros);
      const path = stringLiteral(expression, (n) => directories.get(n) ?? null);
      if (path === null) throw new Error(`${m[1]}: cannot read ${expression}`);
      files[m[1] as string] = path.toLowerCase();
    }
    for (const name of own) {
      const version = VERSION_OF_GAME_VERSION[name];
      if (!version) throw new Error(`unknown game version ${name}`);
      versions[version] = files;
    }
  }
  for (const [version, files] of Object.entries(versions)) {
    const missing = ids.filter((id) => !(id in files));
    if (missing.length > 0) throw new Error(`${version} misses ${missing.join(', ')}`);
  }
  return {
    source: `JA2 Stracciatella ${STRACCIATELLA_COMMIT}: src/${GAME_RES_CC} GetMLGFilename, src/${GAME_RES_H} MultiLanguageGraphic, src/${DIRECTORIES_H}`,
    license: 'Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA). See LICENSE.',
    format:
      'ids: MultiLanguageGraphic in enum order; versions: per data version (src/content/text/data-version.ts names), the VFS path of every id',
    ids,
    versions,
  };
}

if (import.meta.main) {
  const target = join(PROJECT_DATA_DIR, 'tables', 'mlg.json');
  const table = buildMlgTable();
  writeTable(target, table);
  console.log(`${target}: ${table.ids.length} ids, ${Object.keys(table.versions).length} versions`);
}

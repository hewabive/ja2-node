import { join } from 'node:path';
import { PROJECT_DATA_DIR } from '../../src/node/repo.ts';
import { cleanSource, enumDefinitions } from './c-constants.ts';
import { readSource, STRACCIATELLA_COMMIT, writeTable } from './c-source.ts';

const MODEL_CC = 'externalized/LoadingScreenModel.cc';
const SCREEN_H = 'game/Loading_Screen.h';
const ID_ENUM_MEMBER_PREFIX = 'LOADINGSCREEN_';
const ENTRY = /LoadingScreen\(\s*(LOADINGSCREEN_\w+)\s*,\s*"(\w+)"\s*,\s*"([^"]+)"\s*\)/g;

export interface LoadScreenEntry {
  readonly index: number;
  readonly name: string;
  readonly file: string;
}

export interface LoadScreenTable {
  readonly source: string;
  readonly license: string;
  readonly format: string;
  readonly predefined: readonly LoadScreenEntry[];
}

function screenIds(): ReadonlyMap<string, number> {
  const ids = new Map<string, number>();
  for (const e of enumDefinitions(cleanSource(readSource(SCREEN_H)))) {
    let next = 0;
    for (const member of e.members) {
      if (!member.name.startsWith(ID_ENUM_MEMBER_PREFIX)) continue;
      const value = member.expression === '' ? next : Number(member.expression);
      ids.set(member.name, value);
      next = value + 1;
    }
  }
  return ids;
}

export function buildLoadScreenTable(): LoadScreenTable {
  const ids = screenIds();
  const predefined: LoadScreenEntry[] = [];
  for (const m of cleanSource(readSource(MODEL_CC)).matchAll(ENTRY)) {
    const index = ids.get(m[1] as string);
    if (index === undefined) throw new Error(`unknown loading screen ${m[1]}`);
    predefined.push({ index, name: m[2] as string, file: (m[3] as string).replace(/^\//, '').toLowerCase() });
  }
  predefined.forEach((entry, i) => {
    if (entry.index !== i) throw new Error(`loading screen ${entry.name} is listed at ${i}, its id is ${entry.index}`);
  });
  return {
    source: `JA2 Stracciatella ${STRACCIATELLA_COMMIT}: src/${MODEL_CC} PREDEFINED_SCREENS, src/${SCREEN_H}`,
    license: 'Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA). See LICENSE.',
    format:
      'predefined: the hard-coded loading screens by id (index), their internal name and their file under loadscreens/; the ids from the predefined count on are the entries of externalized/loading-screens.json in order',
    predefined,
  };
}

if (import.meta.main) {
  const target = join(PROJECT_DATA_DIR, 'tables', 'load-screens.json');
  const table = buildLoadScreenTable();
  writeTable(target, table);
  console.log(`${target}: ${table.predefined.length} predefined loading screens`);
}

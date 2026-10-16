import { join } from 'node:path';
import { REPO_ROOT } from '../../src/node/repo.ts';
import { bracedBody, readSource, STRACCIATELLA_COMMIT, stripCComments, writeTable } from './c-source.ts';

const header = readSource('game/Tactical/Tactical_Save.h');
const source = readSource('game/Tactical/Tactical_Save.cc');

function defined(name: string): number {
  const m = new RegExp(`#define\\s+${name}\\s+(\\d+)\\b`).exec(header);
  if (!m) throw new Error(`${name} not found`);
  return Number(m[1]);
}

const rowLength = defined('NEW_ROTATION_ARRAY_SIZE');
const baseSets = defined('BASE_NUMBER_OF_ROTATION_ARRAYS');
const body = stripCComments(bracedBody(source, 'g_encryption_array[][NEW_ROTATION_ARRAY_SIZE]'));
const sets = [...body.matchAll(/\{([^{}]*)\}/g)].map((m) =>
  (m[1] as string)
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
    .map((s) => {
      if (!/^\d+$/.test(s)) throw new Error(`unexpected entry ${s}`);
      const v = Number(s);
      if (v > 255) throw new Error(`entry out of byte range: ${s}`);
      return v;
    }),
);
if (sets.length !== baseSets * 12) throw new Error(`${sets.length} sets, expected ${baseSets * 12}`);
for (const [i, set] of sets.entries()) if (set.length !== rowLength) throw new Error(`set ${i} has ${set.length} entries`);

const out = {
  source: `JA2 Stracciatella ${STRACCIATELLA_COMMIT}: src/game/Tactical/Tactical_Save.cc g_encryption_array, Tactical_Save.h`,
  license: 'Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA). See LICENSE.',
  format: 'sets[guiJA2EncryptionSet] is the rotation array of NewJA2EncryptedFileRead; baseSets = BASE_NUMBER_OF_ROTATION_ARRAYS',
  baseSets,
  sets,
};
const target = join(REPO_ROOT, 'data/tables/save-encryption.json');
writeTable(target, out);
console.log(`${sets.length} rotation arrays of ${rowLength} bytes → ${target}`);

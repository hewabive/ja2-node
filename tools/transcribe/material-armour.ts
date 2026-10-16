import { join } from 'node:path';
import { REPO_ROOT } from '../../src/node/repo.ts';
import { arrayItems, readSource, STRACCIATELLA_COMMIT, writeTable } from './c-source.ts';

const structure = readSource('game/TileEngine/Structure.cc');
const armour = arrayItems(structure, 'UINT8 const gubMaterialArmour[]').map((v) => {
  if (!/^\d+$/.test(v)) throw new Error(`non-literal material armour ${v}`);
  return Number(v);
});

const out = {
  source: `JA2 Stracciatella ${STRACCIATELLA_COMMIT}: src/game/TileEngine/Structure.cc gubMaterialArmour`,
  license: 'Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA). See LICENSE.',
  format: 'armour value by structure material index (JSD armour field)',
  armour,
};
const target = join(REPO_ROOT, 'data/tables/material-armour.json');
writeTable(target, out);
console.log(`${armour.length} materials → ${target}`);

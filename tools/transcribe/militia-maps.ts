import { join } from 'node:path';
import { REPO_ROOT } from '../../src/node/repo.ts';
import { bracedBody, readVanillaSource, stripCComments, VANILLA_COMMIT, writeTable } from './c-source.ts';

const BASE_SECTOR_LIST = 'INT16 sBaseSectorList[] =';
const SECTOR_CALL = /SECTOR\(\s*(\d+)\s*,\s*(\d+)\s*\)/g;
const MAP_ROWS = 'ABCDEFGHIJKLMNOP';

function sectorName(x: string, y: string): string {
  const row = MAP_ROWS[Number(y) - 1];
  if (!row) throw new Error(`row ${y} is off the map`);
  return `${row}${Number(x)}`;
}

const body = stripCComments(bracedBody(readVanillaSource('Strategic/MapScreenInterfaceMap.c'), BASE_SECTOR_LIST));
const baseSectors = [...body.matchAll(SECTOR_CALL)].map((m) => sectorName(m[1] ?? '', m[2] ?? ''));
if (!/^[\s,]*$/.test(body.replace(SECTOR_CALL, ''))) throw new Error('sBaseSectorList holds more than SECTOR(x, y) items');

const out = {
  source: `JA2 vanilla ${VANILLA_COMMIT} (gtrafimenkov/ja2-vanilla): ja2/Build/Strategic/MapScreenInterfaceMap.c sBaseSectorList`,
  license: 'Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA). See LICENSE.',
  format:
    'baseSectors: per town id from 1 on, the top left sector of the 3x3 grid the militia panel draws for the town, which matches its cutout in interface/militiamaps.sti',
  baseSectors,
};
const target = join(REPO_ROOT, 'data/tables/militia-maps.json');
writeTable(target, out);
console.log(`${baseSectors.length} militia map corners → ${target}`);

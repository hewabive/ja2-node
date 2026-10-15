import { join } from 'node:path';
import { REPO_ROOT } from '../../src/node/repo.ts';
import { arrayItems, evaluateIntExpression, readSource, STRACCIATELLA_COMMIT, sequentialEnum, writeTable } from './c-source.ts';

const header = readSource('game/TileEngine/TileDat.h');
const tables = readSource('game/TileEngine/TileDat.cc');
const tileNames = sequentialEnum(header, 'TileDefines');
const typeNames = [...sequentialEnum(header, 'TileTypeDefines').entries()].filter(([name]) => name !== 'NUMBEROFTILETYPES');
const surfaceNames = arrayItems(tables, 'gTileSurfaceName[NUMBEROFTILETYPES]').map((s) => JSON.parse(s) as string);
const counts = arrayItems(tables, 'gNumTilesPerType[NUMBEROFTILETYPES]').map((e) => evaluateIntExpression(e, tileNames));

if (surfaceNames.length !== typeNames.length || counts.length !== typeNames.length) {
  throw new Error(`table sizes differ: ${typeNames.length} types, ${surfaceNames.length} names, ${counts.length} counts`);
}

let start = 0;
const types = typeNames.map(([name, index], i) => {
  const type = { index, name, surfaceName: surfaceNames[i], start, count: counts[i] };
  start += counts[i] ?? 0;
  return type;
});
const numberOfTiles = tileNames.get('NUMBEROFTILES');
if (start !== numberOfTiles) throw new Error(`sum of tile counts ${start} != NUMBEROFTILES ${numberOfTiles}`);

const typeIndex = new Map(typeNames);
const shadowBuddies = arrayItems(tables, 'g_shadow_buddies[]')
  .join(',')
  .replace(/[{}]/g, '')
  .split(',')
  .map((t) => t.trim())
  .filter((t) => t)
  .reduce<string[][]>((rows, name, i) => {
    if (i % 4 === 0) rows.push([]);
    rows.at(-1)?.push(name);
    return rows;
  }, [])
  .map(([structure, shadow, firstStructure, firstShadow]) => ({
    structureType: typeIndex.get(structure ?? ''),
    shadowType: typeIndex.get(shadow ?? ''),
    firstStructureTile: tileNames.get(firstStructure ?? ''),
    firstShadowTile: tileNames.get(firstShadow ?? ''),
  }));
const tileList = (declaration: string) =>
  arrayItems(tables, declaration)
    .map((e) => evaluateIntExpression(e, tileNames))
    .filter((v) => v !== -1);
const tileNameList = [...tileNames.entries()].filter(([, i]) => i < (numberOfTiles ?? 0)).map(([name]) => name);

const out = {
  source: `JA2 Stracciatella ${STRACCIATELLA_COMMIT}: src/game/TileEngine/TileDat.h, TileDat.cc`,
  license: 'Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA). See LICENSE.',
  numberOfTiles,
  types,
  shadowBuddies,
  doorAnimations: {
    open: tileList('gOpenDoorList[]'),
    openShadow: tileList('gOpenDoorShadowList[]'),
    closed: tileList('gClosedDoorList[]'),
    closedShadow: tileList('gClosedDoorShadowList[]'),
  },
  fullBaseTileValues: arrayItems(tables, 'gFullBaseTileValues[]').map(Number),
  tileNames: tileNameList,
};
const target = join(REPO_ROOT, 'data/tables/tiles.json');
writeTable(target, out);
console.log(`${types.length} tile types, ${numberOfTiles} tiles → ${target}`);

import { join } from 'node:path';
import { REPO_ROOT } from '../../src/node/repo.ts';
import { arrayItems, readSource, STRACCIATELLA_COMMIT, sequentialEnum, stripCComments, writeTable } from './c-source.ts';

const corpseHeader = readSource('game/Tactical/Rotting_Corpses.h');
const corpseSource = stripCComments(readSource('game/Tactical/Rotting_Corpses.cc'));
const dataHeader = readSource('game/Tactical/Animation_Data.h');
const controlHeader = readSource('game/Tactical/Animation_Control.h');
const controlSource = stripCComments(readSource('game/Tactical/Animation_Control.cc'));

const corpseIndex = sequentialEnum(corpseHeader, 'RottingCorpseDefines');
const corpseNames = [...corpseIndex.keys()].filter((n) => n !== 'NUM_CORPSES');
const stateIndex = sequentialEnum(controlHeader, 'AnimationStates');
const bodyIndex = new Map([...sequentialEnum(dataHeader, 'SoldierBodyType').entries()].filter(([, v]) => v >= 0));

function lookup(map: ReadonlyMap<string, number>, name: string, what: string): number {
  const v = map.get(name);
  if (v === undefined) throw new Error(`unknown ${what} ${name}`);
  return v;
}

function fileList(declaration: string): string[] {
  const files = arrayItems(corpseSource, declaration).map((item) => {
    const m = /^(?:ANIMSDIR\s*)?"([^"]*)"$/.exec(item);
    if (!m) throw new Error(`unexpected corpse file entry ${item}`);
    return m[1] ? `anims${(m[1] as string).toLowerCase()}` : '';
  });
  if (files.length !== corpseNames.length) throw new Error(`${files.length} files for ${corpseNames.length} corpse types`);
  return files;
}

const animationCorpse: Record<number, Record<number, number>> = {};
for (const m of controlSource.matchAll(/gubAnimSurfaceCorpseID\[(\w+)\]\[(\w+)\]\s*=\s*(\w+);/g)) {
  if (m[1] === 'cnt1') continue;
  const body = lookup(bodyIndex, m[1] as string, 'body');
  const state = lookup(stateIndex, m[2] as string, 'state');
  const byState = animationCorpse[body] ?? {};
  animationCorpse[body] = byState;
  byState[state] = lookup(corpseIndex, m[3] as string, 'corpse');
}

const out = {
  source: `JA2 Stracciatella ${STRACCIATELLA_COMMIT}: src/game/Tactical/Rotting_Corpses.h/.cc, Animation_Control.cc`,
  license: 'Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA). See LICENSE.',
  types: corpseNames,
  files: fileList('zCorpseFilenames[NUM_CORPSES]'),
  noBloodFiles: fileList('zNoBloodCorpseFilenames[NUM_CORPSES]'),
  twoDirectionsFrom8: arrayItems(corpseSource, 'gb2DirectionsFrom8[8]').map(Number),
  fourDirectionsFrom8: arrayItems(corpseSource, 'gb4DirectionsFrom8[8]').map(Number),
  animationCorpse,
};
const target = join(REPO_ROOT, 'data/tables/corpses.json');
writeTable(target, out);
const entries = Object.values(animationCorpse).reduce((a, s) => a + Object.keys(s).length, 0);
console.log(`${corpseNames.length} corpse types, ${entries} animation entries → ${target}`);

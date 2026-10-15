import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { REPO_ROOT } from '../../src/node/repo.ts';
import { arrayItems, bracedBody, readSource, STRACCIATELLA_COMMIT, sequentialEnum, stripCComments } from './c-source.ts';

const dataHeader = readSource('game/Tactical/Animation_Data.h');
const dataSource = readSource('game/Tactical/Animation_Data.cc');
const controlHeader = readSource('game/Tactical/Animation_Control.h');
const controlSource = stripCComments(readSource('game/Tactical/Animation_Control.cc'));

const surfaceNames = [...sequentialEnum(dataHeader, 'AnimationSurfaceTypes').keys()].filter((n) => n !== 'NUMANIMATIONSURFACETYPES');
const surfaceIndex = new Map(surfaceNames.map((n, i) => [n, i]));
const stateIndex = new Map([...sequentialEnum(controlHeader, 'AnimationStates').entries()]);
const bodyIndex = new Map([...sequentialEnum(dataHeader, 'SoldierBodyType').entries()].filter(([, v]) => v >= 0));
const structTypes: Record<string, number> = {
  S_STRUCT: 0,
  C_STRUCT: 1,
  P_STRUCT: 2,
  F_STRUCT: 3,
  FB_STRUCT: 4,
  DEFAULT_STRUCT: 5,
  NO_STRUCT: 120,
};

const rows = [
  ...stripCComments(bracedBody(dataSource, 'gAnimSurfaceDatabase[NUMANIMATIONSURFACETYPES]')).matchAll(
    /M\(\s*(\w+),\s*ANIMSDIR\s*"([^"]+)"\s*,\s*(\w+),\s*([\w|]+),\s*(\d+),\s*(-?\d+)\s*\)/g,
  ),
];
if (rows.length !== surfaceNames.length) throw new Error(`${rows.length} surface rows for ${surfaceNames.length} ids`);
const surfaces = rows.map((m, id) => {
  const struct = structTypes[m[3] as string];
  if (struct === undefined) throw new Error(`unknown struct type ${m[3]}`);
  return {
    id,
    name: surfaceNames[id],
    file: `anims${(m[2] as string).toLowerCase()}`,
    struct,
    noFrames: (m[4] as string).includes('ANIM_DATA_FLAG_NOFRAMES'),
    directions: Number(m[5]),
    profile: Number(m[6]),
  };
});

function lookup(map: Map<string, number>, name: string, what: string): number {
  const v = map.get(name);
  if (v === undefined) throw new Error(`unknown ${what} ${name}`);
  return v;
}

function assignments(array: string, withHand: boolean): Record<number, Record<number, number | number[]>> {
  const out: Record<number, Record<number, number | number[]>> = {};
  const pattern = withHand
    ? new RegExp(`${array}\\[(\\w+)\\]\\[(\\w+)\\]\\[(\\d)\\]\\s*=\\s*(\\w+);`, 'g')
    : new RegExp(`${array}\\[(\\w+)\\]\\[(\\w+)\\]\\s*=\\s*(\\w+);`, 'g');
  for (const m of controlSource.matchAll(pattern)) {
    if (m[1] === 'cnt1') continue;
    const body = lookup(bodyIndex, m[1] as string, 'body');
    const state = lookup(stateIndex, m[2] as string, 'state');
    const byState = out[body] ?? {};
    out[body] = byState;
    if (withHand) {
      const hand = Number(m[3]);
      const pair = (byState[state] as number[] | undefined) ?? [-1, -1];
      pair[hand] = lookup(surfaceIndex, m[4] as string, 'surface');
      byState[state] = pair;
    } else {
      byState[state] = lookup(surfaceIndex, m[3] as string, 'surface');
    }
  }
  return out;
}

function subType(name: string): { state: number; surfaces: number[] } {
  const m = new RegExp(`${name}\\s*=\\s*\\{\\s*(\\w+),\\s*\\{([^}]*)\\}`).exec(controlSource);
  if (!m) throw new Error(`sub type ${name} not found`);
  return {
    state: lookup(stateIndex, m[1] as string, 'state'),
    surfaces: (m[2] as string).split(',').map((s) => lookup(surfaceIndex, s.trim(), 'surface')),
  };
}

const out = {
  source: `JA2 Stracciatella ${STRACCIATELLA_COMMIT}: src/game/Tactical/Animation_Data.h/.cc, Animation_Control.cc`,
  license: 'Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA). See LICENSE.',
  surfaces,
  bodySurfaces: assignments('gubAnimSurfaceIndex', false),
  itemSubSurfaces: assignments('gubAnimSurfaceItemSubIndex', false),
  midWaterSurfaces: assignments('gubAnimSurfaceMidWaterSubIndex', true),
  nothingBreath: arrayItems(controlSource, 'gusNothingBreath[]').map((n) => lookup(surfaceIndex, n, 'surface')),
  injuredRifleWalk: subType('gRifleInjuredSub'),
  injuredNothingWalk: subType('gNothingInjuredSub'),
  doubleHandedStanding: subType('gDoubleHandledSub'),
};
const target = join(REPO_ROOT, 'data/tables/anim-surfaces.json');
writeFileSync(target, `${JSON.stringify(out, null, 1)}\n`);
const count = (r: Record<number, Record<number, unknown>>) => Object.values(r).reduce((a, s) => a + Object.keys(s).length, 0);
console.log(`${surfaces.length} surfaces, ${count(out.bodySurfaces)} body entries, ${count(out.itemSubSurfaces)} item subs → ${target}`);

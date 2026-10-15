import { join } from 'node:path';
import { REPO_ROOT } from '../../src/node/repo.ts';
import { arrayItems, bracedBody, readSource, STRACCIATELLA_COMMIT, sequentialEnum, stripCComments, writeTable } from './c-source.ts';

const header = readSource('game/Tactical/Animation_Control.h');
const source = readSource('game/Tactical/Animation_Control.cc');
const dataHeader = readSource('game/Tactical/Animation_Data.h');

const flags = new Map<string, number>();
for (const m of header.matchAll(/#define\s+(ANIM_\w+)\s+(0x[0-9A-Fa-f]+)/g)) flags.set(m[1] as string, Number(m[2]));

const heights = new Map<string, number>();
for (const m of stripCComments(bracedBody(header, 'enum AnimationHeight')).matchAll(/(ANIM_\w+)\s*=\s*(\d+)/g))
  heights.set(m[1] as string, Number(m[2]));

const states = [...sequentialEnum(header, 'AnimationStates').keys()].filter((n) => n !== 'NUMANIMATIONSTATES');
const bodyTypes = [...sequentialEnum(dataHeader, 'SoldierBodyType').entries()]
  .filter(([n, v]) => v >= 0 && n !== 'TOTALBODYTYPES')
  .map(([n]) => n);

const rows = [
  ...stripCComments(bracedBody(source, 'gAnimControl[NUMANIMATIONSTATES]')).matchAll(
    /\{\s*"([^"]*)",\s*([-0-9.]+)f?,\s*([^,]*?),\s*(-?\d+|USESTATS),\s*(\w+),\s*(\w+)\s*\}/g,
  ),
];
if (rows.length !== states.length) throw new Error(`${rows.length} gAnimControl rows for ${states.length} states`);

const animations = rows.map((m, index) => {
  const flagNames = (m[3] as string)
    .split('|')
    .map((f) => f.trim())
    .filter((f) => f && f !== '0');
  const mask = flagNames.reduce((acc, f) => {
    const v = flags.get(f);
    if (v === undefined) throw new Error(`unknown flag ${f}`);
    return (acc | v) >>> 0;
  }, 0);
  const height = heights.get(m[5] as string);
  const endHeight = heights.get(m[6] as string);
  if (height === undefined || endHeight === undefined) throw new Error(`unknown height in row ${index}`);
  return {
    index,
    id: states[index],
    name: m[1],
    movement: Number(m[2]),
    flags: mask,
    speed: m[4] === 'USESTATS' ? 0 : Number(m[4]),
    height,
    endHeight,
  };
});

function speedTable(declaration: string): { speed: number; movement: number }[] {
  const items = arrayItems(source, declaration)
    .join(',')
    .replace(/[{}]/g, '')
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s);
  const table: { speed: number; movement: number }[] = [];
  for (let i = 0; i + 1 < items.length; i += 2)
    table.push({ speed: Number(items[i]), movement: Number((items[i + 1] as string).replace(/f$/, '')) });
  while (table.length < bodyTypes.length) table.push({ speed: 0, movement: 0 });
  return table;
}

const out = {
  source: `JA2 Stracciatella ${STRACCIATELLA_COMMIT}: src/game/Tactical/Animation_Control.h/.cc, Animation_Data.h`,
  license: 'Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA). See LICENSE.',
  flags: Object.fromEntries(flags),
  bodyTypes,
  animations,
  bodySpeeds: {
    walk: speedTable('gubAnimWalkSpeeds[TOTALBODYTYPES]'),
    run: speedTable('gubAnimRunSpeeds[TOTALBODYTYPES]'),
    swat: speedTable('gubAnimSwatSpeeds[TOTALBODYTYPES]'),
    crawl: speedTable('gubAnimCrawlSpeeds[TOTALBODYTYPES]'),
  },
};
const target = join(REPO_ROOT, 'data/tables/anim-control.json');
writeTable(target, out);
console.log(`${animations.length} animation states, ${bodyTypes.length} body types → ${target}`);

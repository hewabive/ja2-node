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

const randomAnimConstants = new Map<string, number>();
for (const m of header.matchAll(/#define\s+(RANDOM_ANIM_\w+)\s+(0x[0-9A-Fa-f]+|\d+)/g))
  randomAnimConstants.set(m[1] as string, Number(m[2]));
const SOUNDS_DIR = 'sounds';
const RANDOM_ANIM_SOUND = 'RANDOM_ANIM_SOUND';

interface RandomAnim {
  hand: number;
  anim: string | null;
  sound?: string;
  firstRoll: number;
  lastRoll: number;
  flags: number;
  height: number;
}

function randomAnimConstant(expression: string): number {
  return expression
    .split('|')
    .map((term) => term.trim())
    .reduce((acc, term) => {
      const v = /^\d+$/.test(term) ? Number(term) : (randomAnimConstants.get(term) ?? heights.get(term));
      if (v === undefined) throw new Error(`unknown random animation value ${term}`);
      return acc | v;
    }, 0);
}

function setRandomAnimField(entry: RandomAnim, field: string, value: string): void {
  if (field === 'ubHandRestriction') entry.hand = randomAnimConstant(value);
  else if (field === 'sAnimID') entry.anim = value === RANDOM_ANIM_SOUND ? null : value;
  else if (field === 'ubStartRoll') entry.firstRoll = Number(value);
  else if (field === 'ubEndRoll') entry.lastRoll = Number(value);
  else if (field === 'ubFlags') entry.flags = randomAnimConstant(value);
  else if (field === 'ubAnimHeight') entry.height = randomAnimConstant(value);
  else if (field === 'zSoundFile') entry.sound = `${SOUNDS_DIR}${(/"([^"]*)"/.exec(value) as RegExpExecArray)[1]}`;
  else throw new Error(`unknown random animation field ${field}`);
}

const randomAnimSlots = new Map<string, RandomAnim[]>();
for (const m of stripCComments(source).matchAll(/gRandomAnimDefs\[(\w+)\]\[(\d+)\]\.(\w+)\s*=\s*([^;]+);/g)) {
  const [, body, slot, field, value] = m as unknown as [string, string, string, string, string];
  const slots = randomAnimSlots.get(body) ?? [];
  randomAnimSlots.set(body, slots);
  const entry = slots[Number(slot)] ?? { hand: 0, anim: null, firstRoll: 0, lastRoll: 0, flags: 0, height: 0 };
  slots[Number(slot)] = entry;
  setRandomAnimField(entry, field, value.trim());
}
for (const body of randomAnimSlots.keys()) if (!bodyTypes.includes(body)) throw new Error(`unknown body type ${body}`);
const randomAnims = bodyTypes.map((body) => (randomAnimSlots.get(body) ?? []).filter((entry) => entry !== undefined));

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
  randomAnims,
};
const target = join(REPO_ROOT, 'data/tables/anim-control.json');
writeTable(target, out);
console.log(
  `${animations.length} animation states, ${bodyTypes.length} body types, ${randomAnims.flat().length} random animations → ${target}`,
);

import { join } from 'node:path';
import { REPO_ROOT } from '../../src/node/repo.ts';
import { bracedBody, readSource, STRACCIATELLA_COMMIT, sequentialEnum, stripCComments, writeTable } from './c-source.ts';

const NO_FACT_LINE = /^\s*FACT_NONE\s*=\s*UINT16_MAX\s*,.*$/m;
const NO_QUEST = 'NO_QUEST';

function shortName(name: string, prefix: string): string {
  const rest = name.slice(prefix.length);
  return /^[A-Za-z]/.test(rest) ? rest : name;
}

function entries(values: Map<string, number>, prefix: string): { id: number; name: string }[] {
  return [...values]
    .filter(([name]) => name.startsWith(prefix) && name !== NO_QUEST)
    .map(([name, id]) => ({ id, name: shortName(name, prefix) }))
    .sort((a, b) => a.id - b.id);
}

const factsHeader = readSource('game/Strategic/Facts.h').replace(NO_FACT_LINE, '');
const facts = entries(sequentialEnum(factsHeader, 'Fact'), 'FACT_');
const quests = entries(sequentialEnum(readSource('game/Strategic/Quests.h'), 'Quests'), 'QUEST_');
const profiles = [...sequentialEnum(readSource('game/Tactical/Soldier_Profile.h'), 'NPCIDs : ProfileID')]
  .filter(([name]) => !/^(RPC|NPC)\d+$/.test(name))
  .map(([name, id]) => ({ id, name }));

function defines(src: string): Map<string, number> {
  const out = new Map<string, number>();
  for (const [, name, value] of src.matchAll(/^#define\s+(\w+)\s+(0x[0-9a-fA-F]+|\d+)\b/gm))
    if (name && value) out.set(name, Number(value));
  return out;
}

function literal(value: string, known: ReadonlyMap<string, number>): number {
  const named = known.get(value);
  if (named !== undefined) return named;
  if (!/^\d+$/.test(value)) throw new Error(`not a literal: ${value}`);
  return Number(value);
}

const hourlySource = readSource('game/Strategic/Hourly_Update.cc');
const hourlyDefines = defines(hourlySource);
const larryItems = [
  ...stripCComments(bracedBody(hourlySource, 'LarryItems[ NUM_LARRY_ITEMS ][ 3 ] =')).matchAll(/\{\s*(\w+)\s*,\s*(\w+)\s*,\s*(\w+)\s*\}/g),
].map(([, item, temptation, points]) => ({
  item: item ?? '',
  temptation: literal(temptation ?? '', hourlyDefines),
  points: literal(points ?? '', hourlyDefines),
}));
const larryBars = [...bracedBody(hourlySource, 'static const SGPSector bars[] =').matchAll(/\{\s*(\d+)\s*,\s*MAP_ROW_([A-P])\s*\}/g)].map(
  ([, x, row]) => `${row}${x}`,
);
if (larryItems.length === 0 || larryBars.length === 0) throw new Error('Larry tables not found');

const schedulingHeader = stripCComments(readSource('game/Strategic/Scheduling.h'));
const scheduleActions = [...schedulingHeader.matchAll(/\bSCHEDULE_ACTION_(\w+)\s*,/g)]
  .map(([, name]) => name ?? '')
  .map((name, id) => ({ id, name }));
const scheduleFlags = [...defines(schedulingHeader)]
  .filter(([name]) => name.startsWith('SCHEDULE_FLAGS_'))
  .map(([name, value]) => ({ name: name.slice('SCHEDULE_FLAGS_'.length), value }));

const seen = new Set<number>();
for (const f of facts) {
  if (seen.has(f.id)) throw new Error(`duplicate fact id ${f.id}`);
  seen.add(f.id);
}

const out = {
  source: `JA2 Stracciatella ${STRACCIATELLA_COMMIT}: src/game/Strategic/Facts.h enum Fact, src/game/Strategic/Quests.h enum Quests, src/game/Tactical/Soldier_Profile.h enum NPCIDs, src/game/Strategic/Hourly_Update.cc LarryItems and the bar sectors of HourlyLarryUpdate, src/game/Strategic/Scheduling.h SCHEDULE_ACTION_* and SCHEDULE_FLAGS_*`,
  license: 'Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA). See LICENSE.',
  format:
    'fact ids and names (FACT_ prefix removed unless the rest is a number) in id order; quest ids and names (QUEST_ prefix removed) in id order, NO_QUEST left out; named profile ids of NPCIDs (placeholders RPCnn/NPCnn left out); Larry items (item name, temptation, kit points) in search order; bar sectors; schedule actions (SCHEDULE_ACTION_ prefix removed) in id order; schedule flags (SCHEDULE_FLAGS_ prefix removed)',
  facts,
  quests,
  profiles,
  larryItems,
  larryBars,
  scheduleActions,
  scheduleFlags,
};
const target = join(REPO_ROOT, 'data/tables/narrative.json');
writeTable(target, out);
console.log(
  `${facts.length} facts, ${quests.length} quests, ${profiles.length} profiles, ${larryItems.length} Larry items, ${scheduleActions.length} schedule actions → ${target}`,
);

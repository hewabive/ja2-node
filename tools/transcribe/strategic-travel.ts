import { join } from 'node:path';
import { REPO_ROOT } from '../../src/node/repo.ts';
import { bracedBody, readSource, STRACCIATELLA_COMMIT, stripCComments, writeTable } from './c-source.ts';

const campaignTypes = readSource('game/Strategic/Campaign_Types.h');
const movement = readSource('game/Strategic/Strategic_Movement.cc');
const pathing = readSource('game/Strategic/Strategic_Pathing.cc');
const helicopter = readSource('game/Strategic/Map_Screen_Helicopter.h');

function enumItems(body: string): Map<string, number> {
  const values = new Map<string, number>();
  let next = 0;
  for (const raw of stripCComments(body).split(',')) {
    const item = raw.trim();
    if (!item) continue;
    const [name, value] = item.split('=').map((s) => s.trim());
    if (!name) continue;
    if (value !== undefined) next = Number(value);
    if (!Number.isInteger(next)) throw new Error(`non-literal enum value ${item}`);
    values.set(name, next++);
  }
  return values;
}

function defineValue(src: string, name: string): number {
  const m = new RegExp(`#define\\s+${name}\\s+(\\d+)`).exec(src);
  if (!m) throw new Error(`#define ${name} not found`);
  return Number(m[1]);
}

const traversability = new Map(
  [...enumItems(bracedBody(campaignTypes, '//Traversability ratings'))].filter(([name]) => !name.startsWith('NUM_')),
);
const masks = enumItems(bracedBody(campaignTypes, 'enum VehicleMovementType'));
const baseMinutes = new Map<string, number>();
for (const m of movement.matchAll(/#define\s+(\w+)_TRAVEL_TIME\s+(\d+)/g)) baseMinutes.set(m[1] as string, Number(m[2]));

const body = stripCComments(bracedBody(movement, 'INT32 GetSectorMvtTimeForGroup(UINT8 const'));
const town = /traverse_type\s*==\s*TOWN\s*&&\s*transport_mask\s*!=\s*AIR\s*\)\s*return\s+(\d+)\s*;/.exec(body);
if (!town) throw new Error('TOWN rule not found');
if (!/traverse_type\s*==\s*EDGEOFWORLD\)\s*return\s+TRAVERSE_TIME_IMPOSSIBLE/.test(body)) throw new Error('EDGEOFWORLD rule not found');

interface Transport {
  name: string;
  mask: number;
  baseMinutes: number;
  modifiers: Record<string, number> | null;
}

const blocks = body.split(/if\s*\(\s*transport_mask\s*&\s*/).slice(1);
const transports: Transport[] = blocks.map((block) => {
  const name = /^(\w+)\s*\)/.exec(block)?.[1];
  if (!name) throw new Error(`unparsed transport block ${block.slice(0, 40)}`);
  const mask = masks.get(name);
  if (mask === undefined) throw new Error(`unknown transport ${name}`);
  const timeName = /(\w+)_TRAVEL_TIME/.exec(block)?.[1];
  const base = timeName === undefined ? undefined : baseMinutes.get(timeName);
  if (base === undefined) throw new Error(`no travel time for ${name}`);
  const cases = [...block.matchAll(/case\s+(\w+)\s*:\s*traverse_mod\s*=\s*(\d+)\s*;/g)];
  if (cases.length > 0 && !/default\s*:\s*return\s+TRAVERSE_TIME_IMPOSSIBLE/.test(block)) throw new Error(`${name}: missing default`);
  if (cases.length > 0 && !new RegExp(`${timeName}_TRAVEL_TIME\\s*\\*\\s*100\\s*/\\s*traverse_mod`).test(block)) {
    throw new Error(`${name}: unexpected time formula`);
  }
  const modifiers: Record<string, number> = {};
  for (const c of cases) {
    if (!traversability.has(c[1] as string)) throw new Error(`${name}: unknown terrain ${c[1]}`);
    modifiers[c[1] as string] = Number(c[2]);
  }
  return { name, mask, baseMinutes: base, modifiers: cases.length > 0 ? modifiers : null };
});
if (transports.length !== masks.size) throw new Error(`expected ${masks.size} transports, found ${transports.length}`);

const out = {
  source: `JA2 Stracciatella ${STRACCIATELLA_COMMIT}: src/game/Strategic/Strategic_Movement.cc GetSectorMvtTimeForGroup and *_TRAVEL_TIME, src/game/Strategic/Campaign_Types.h, src/game/Strategic/Strategic_Pathing.cc FLAT_STRATEGIC_TRAVEL_TIME, src/game/Strategic/Map_Screen_Helicopter.h COST_AIRSPACE_*`,
  license: 'Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA). See LICENSE.',
  format:
    'transports in evaluation order; minutes = baseMinutes * 100 / modifiers[terrain] (integer), null modifiers = every terrain at baseMinutes; terrain missing from modifiers = impossible; EDGEOFWORLD is impossible for all; TOWN costs townMinutes unless the mask is exactly AIR',
  traversability: Object.fromEntries(traversability),
  townMinutes: Number(town[1]),
  flatStrategicTravelTime: defineValue(pathing, 'FLAT_STRATEGIC_TRAVEL_TIME'),
  airspaceCost: { safe: defineValue(helicopter, 'COST_AIRSPACE_SAFE'), unsafe: defineValue(helicopter, 'COST_AIRSPACE_UNSAFE') },
  transports,
};
const target = join(REPO_ROOT, 'data/tables/strategic-travel.json');
writeTable(target, out);
console.log(`${transports.length} transports → ${target}`);

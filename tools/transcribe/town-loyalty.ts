import { join } from 'node:path';
import { REPO_ROOT } from '../../src/node/repo.ts';
import { arrayItems, bracedBody, readSource, STRACCIATELLA_COMMIT, sequentialEnum, stripCComments, writeTable } from './c-source.ts';

const header = readSource('game/Strategic/Strategic_Town_Loyalty.h');
const source = readSource('game/Strategic/Strategic_Town_Loyalty.cc');

const gainPtsMatch = /#define\s+GAIN_PTS_PER_LOYALTY_PT\s+(\d+)/.exec(header);
if (!gainPtsMatch) throw new Error('GAIN_PTS_PER_LOYALTY_PT not found');
const gainPtsPerLoyaltyPt = Number(gainPtsMatch[1]);

function gainPoints(expression: string): number {
  const m = /^\(?\s*(\d+)\s*\*\s*GAIN_PTS_PER_LOYALTY_PT\s*\)?$/.exec(expression.trim());
  if (!m) throw new Error(`unsupported loyalty amount ${expression}`);
  return Number(m[1]) * gainPtsPerLoyaltyPt;
}

const rebelSentiment = arrayItems(source, 'UINT8 gubTownRebelSentiment[ NUM_TOWNS ] =').map(Number);
const usesLoyalty = arrayItems(source, 'BOOLEAN gfTownUsesLoyalty[ NUM_TOWNS ] =').map((v) => {
  if (v !== 'TRUE' && v !== 'FALSE') throw new Error(`unexpected boolean ${v}`);
  return v === 'TRUE';
});
const civilianMurderCost = arrayItems(source, 'UINT32 uiPercentLoyaltyDecreaseForCivMurder[]=').map(gainPoints);

const events = [...sequentialEnum(header, 'GlobalLoyaltyEventTypes').keys()];
const eventBody = stripCComments(bracedBody(source, 'void HandleGlobalLoyaltyEvent(UINT8 ubEventType, const SGPSector& sSector)'));
const amounts = new Map<string, number>();
for (const m of eventBody.matchAll(/case\s+(GLOBAL_LOYALTY_\w+)\s*:[\s\S]*?iLoyaltyChange\s*=\s*(-?\d+)\s*;/g))
  amounts.set(m[1] as string, Number(m[2]));
const globalEvents = events.map((name) => {
  const amount = amounts.get(name);
  if (amount === undefined) throw new Error(`no amount for ${name}`);
  return { name: name.replace(/^GLOBAL_LOYALTY_/, ''), amount };
});

const named: Record<string, number> = {};
for (const m of stripCComments(header).matchAll(/#define\s+LOYALTY_((?:BONUS|PENALTY)_\w+)\s+(\([^)]*\))/g))
  named[m[1] as string] = gainPoints(m[2] as string);

if (rebelSentiment.length !== usesLoyalty.length) throw new Error('town tables differ in length');

const out = {
  source: `JA2 Stracciatella ${STRACCIATELLA_COMMIT}: src/game/Strategic/Strategic_Town_Loyalty.cc gubTownRebelSentiment, gfTownUsesLoyalty, uiPercentLoyaltyDecreaseForCivMurder, HandleGlobalLoyaltyEvent; Strategic_Town_Loyalty.h`,
  license: 'Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA). See LICENSE.',
  format:
    'per town id (index 0 = no town): rebel sentiment and whether loyalty is tracked; civilian murder cost by body FATCIV..COW in loyalty change points; global loyalty events in enum order with their base change; named bonuses and penalties in change points',
  gainPointsPerLoyaltyPoint: gainPtsPerLoyaltyPt,
  rebelSentiment,
  usesLoyalty,
  civilianMurderCost,
  globalEvents,
  amounts: named,
};
const target = join(REPO_ROOT, 'data/tables/town-loyalty.json');
writeTable(target, out);
console.log(`${rebelSentiment.length} towns, ${globalEvents.length} global events → ${target}`);

import { join } from 'node:path';
import { REPO_ROOT } from '../../src/node/repo.ts';
import { bracedBody, readSource, STRACCIATELLA_COMMIT, sequentialEnum, stripCComments, writeTable } from './c-source.ts';

const mines = readSource('game/Strategic/Strategic_Mines.cc');
const mineHeader = readSource('game/Strategic/Strategic_Mines.h');
const profiles = sequentialEnum(readSource('game/Tactical/Soldier_Profile.h'), 'NPCIDs');
const strategicMap = readSource('game/Strategic/StrategicMap.cc');

const quotes = [...sequentialEnum(mineHeader, 'HeadMinerQuote').keys()]
  .filter((n) => n !== 'NUM_HEAD_MINER_STRATEGIC_QUOTES')
  .map((n) => n.replace(/^HEAD_MINER_STRATEGIC_QUOTE_/, ''));

const table = stripCComments(bracedBody(mines, 'static const HEAD_MINER_TYPE gHeadMinerData[NUM_HEAD_MINERS] ='));
const headMiners = [...table.matchAll(/\{\s*(\w+)\s*,\s*\{([^}]*)\}\s*\}/g)].map((m) => {
  const name = m[1] as string;
  const profile = profiles.get(name);
  if (profile === undefined) throw new Error(`unknown profile ${name}`);
  const numbers = (m[2] as string).split(',').map((s) => Number(s.trim()));
  if (numbers.length !== quotes.length) throw new Error(`${name}: expected ${quotes.length} quotes`);
  return { name, profile, quotes: numbers };
});

const random = /UINT8\s+ubRandomMiner\[RANDOM_HEAD_MINERS\]\s*=\s*\{([^}]*)\}/.exec(strategicMap);
if (!random) throw new Error('ubRandomMiner not found');
const randomMinerProfiles = (random[1] as string).split(',').map((s) => Number(s.trim()));

const out = {
  source: `JA2 Stracciatella ${STRACCIATELLA_COMMIT}: src/game/Strategic/Strategic_Mines.cc gHeadMinerData, Strategic_Mines.h HeadMinerQuote, src/game/Strategic/StrategicMap.cc HandleQuestCodeOnSectorEntry ubRandomMiner`,
  license: 'Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA). See LICENSE.',
  format: 'head miners in MINER_* order with their strategic quote numbers (-1 = none) per quote kind; random head miner profile ids',
  quoteKinds: quotes,
  headMiners,
  randomMinerProfiles,
};
const target = join(REPO_ROOT, 'data/tables/head-miners.json');
writeTable(target, out);
console.log(`${headMiners.length} head miners → ${target}`);

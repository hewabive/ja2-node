import { join } from 'node:path';
import { REPO_ROOT } from '../../src/node/repo.ts';
import { bracedBody, readSource, STRACCIATELLA_COMMIT, stripCComments, writeTable } from './c-source.ts';

const campaignTypes = readSource('game/Strategic/Campaign_Types.h');
const campaignInit = readSource('game/Strategic/Campaign_Init.cc');

const flags = new Map<string, number>();
for (const m of campaignTypes.matchAll(/#define\s+SFCF_(\w+)\s+0x([0-9A-Fa-f]+)/g))
  flags.set(m[1] as string, Number.parseInt(m[2] as string, 16));

const body = stripCComments(bracedBody(campaignInit, 'static void InitKnowFacilitiesFlags(void)'));
const sectors: { sector: string; facility: string }[] = [];
let current: string | null = null;
for (const raw of body.split(';')) {
  const statement = raw.trim();
  if (!statement) continue;
  const target = /^pSector\s*=\s*&SectorInfo\[\s*SEC_([A-P]\d{1,2})\s*\]$/.exec(statement);
  const set = /^pSector->uiFacilitiesFlags\s*\|=\s*SFCF_(\w+)$/.exec(statement);
  if (/^SECTORINFO\s*\*pSector$/.test(statement)) continue;
  if (target) current = target[1] as string;
  else if (set && current) {
    if (!flags.has(set[1] as string)) throw new Error(`unknown facility ${set[1]}`);
    sectors.push({ sector: current, facility: set[1] as string });
  } else throw new Error(`unsupported statement: ${statement}`);
}

const out = {
  source: `JA2 Stracciatella ${STRACCIATELLA_COMMIT}: src/game/Strategic/Campaign_Init.cc InitKnowFacilitiesFlags, src/game/Strategic/Campaign_Types.h SFCF_*`,
  license: 'Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA). See LICENSE.',
  format: 'facility flags known at a new campaign, applied in order with |= to SectorInfo[sector].uiFacilitiesFlags',
  flags: Object.fromEntries(flags),
  sectors,
};
const target = join(REPO_ROOT, 'data/tables/sector-facilities.json');
writeTable(target, out);
console.log(`${sectors.length} facility entries → ${target}`);

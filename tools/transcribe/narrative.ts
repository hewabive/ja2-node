import { join } from 'node:path';
import { REPO_ROOT } from '../../src/node/repo.ts';
import { readSource, STRACCIATELLA_COMMIT, sequentialEnum, writeTable } from './c-source.ts';

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

const seen = new Set<number>();
for (const f of facts) {
  if (seen.has(f.id)) throw new Error(`duplicate fact id ${f.id}`);
  seen.add(f.id);
}

const out = {
  source: `JA2 Stracciatella ${STRACCIATELLA_COMMIT}: src/game/Strategic/Facts.h enum Fact, src/game/Strategic/Quests.h enum Quests, src/game/Tactical/Soldier_Profile.h enum NPCIDs`,
  license: 'Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA). See LICENSE.',
  format:
    'fact ids and names (FACT_ prefix removed unless the rest is a number) in id order; quest ids and names (QUEST_ prefix removed) in id order, NO_QUEST left out; named profile ids of NPCIDs (placeholders RPCnn/NPCnn left out)',
  facts,
  quests,
  profiles,
};
const target = join(REPO_ROOT, 'data/tables/narrative.json');
writeTable(target, out);
console.log(`${facts.length} facts, ${quests.length} quests, ${profiles.length} profiles → ${target}`);

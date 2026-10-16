import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { REPO_ROOT } from '../../../node/repo.ts';
import { NpcActionCode } from '../../tactical/narrative/npc-actions/codes.ts';
import { Fact, Quest } from './fact-ids.ts';
import { NUM_FACTS } from './facts.ts';
import { NarrativeHistory } from './history-codes.ts';
import { Npc } from './npc-ids.ts';

interface Entry {
  readonly id: number;
  readonly name: string;
}

const table = JSON.parse(readFileSync(join(REPO_ROOT, 'data/tables/narrative.json'), 'utf8')) as {
  facts: Entry[];
  quests: Entry[];
  profiles: Entry[];
  npcActions: Entry[];
};
const contracts = JSON.parse(readFileSync(join(REPO_ROOT, 'data/tables/merc-contracts.json'), 'utf8')) as {
  historyCodes: Record<string, number>;
};

const asMap = (entries: readonly Entry[]) => Object.fromEntries(entries.map((e) => [e.name, e.id]));

describe('narrative ids', () => {
  it('match the transcribed fact, quest and profile tables', () => {
    expect(Fact).toEqual(asMap(table.facts));
    expect(Quest).toEqual(asMap(table.quests));
    expect(Npc).toEqual(asMap(table.profiles));
    expect(NpcActionCode).toEqual(asMap(table.npcActions));
  });

  it('take the history codes of the actions from the transcribed table', () => {
    for (const [name, code] of Object.entries(NarrativeHistory)) expect(contracts.historyCodes[name]).toBe(code);
  });

  it('keep every fact inside the store', () => {
    for (const id of Object.values(Fact)) expect(id).toBeLessThan(NUM_FACTS);
  });
});

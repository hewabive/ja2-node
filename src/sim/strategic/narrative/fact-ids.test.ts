import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { REPO_ROOT } from '../../../node/repo.ts';
import { Fact, Quest } from './fact-ids.ts';
import { NUM_FACTS } from './facts.ts';
import { Npc } from './npc-ids.ts';

interface Entry {
  readonly id: number;
  readonly name: string;
}

const table = JSON.parse(readFileSync(join(REPO_ROOT, 'data/tables/narrative.json'), 'utf8')) as {
  facts: Entry[];
  quests: Entry[];
  profiles: Entry[];
};

const asMap = (entries: readonly Entry[]) => Object.fromEntries(entries.map((e) => [e.name, e.id]));

describe('narrative ids', () => {
  it('match the transcribed fact, quest and profile tables', () => {
    expect(Fact).toEqual(asMap(table.facts));
    expect(Quest).toEqual(asMap(table.quests));
    expect(Npc).toEqual(asMap(table.profiles));
  });

  it('keep every fact inside the store', () => {
    for (const id of Object.values(Fact)) expect(id).toBeLessThan(NUM_FACTS);
  });
});

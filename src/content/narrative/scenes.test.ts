import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { MEANWHILE_FLAGS, Meanwhile } from '../../sim/strategic/ai/constants.ts';
import { parseNarrativeScenes } from './scenes.ts';

const TABLE = join(import.meta.dirname, '../../../data/tables/narrative-scenes.json');
const scenes = parseNarrativeScenes(JSON.parse(readFileSync(TABLE, 'utf8')));

describe('the transcribed meanwhile scenes (docs/26 §11.2)', () => {
  it('matches the meanwhile ids and flag bits the simulation uses', () => {
    expect(scenes.scenes.map((s) => [s.name, s.id])).toEqual(Object.entries(Meanwhile));
    expect(scenes.scenes.map((s) => s.flag)).toEqual(MEANWHILE_FLAGS);
  });

  it('puts the interrogation in N7 with Joe, the outskirts scene with Joe, every other scene in P3', () => {
    const interrogation = scenes.scenes[Meanwhile.INTERROGATION];
    expect(interrogation).toMatchObject({ sector: 'N7', npcs: ['QUEEN', 'ELLIOT', 'JOE'], skippable: false });
    expect(scenes.scenes.filter((s) => s.sector === 'P3')).toHaveLength(16);
    expect(scenes.scenes[Meanwhile.OUTSKIRTS_MEDUNA]?.npcs).toEqual(['QUEEN', 'ELLIOT', 'JOE']);
    expect(scenes.deidrannaWitnesses.size).toBeGreaterThan(0);
    expect(scenes.queenBugWitnesses.size).toBeGreaterThan(0);
  });
});

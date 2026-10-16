import { describe, expect, it } from 'vitest';
import { dialogueProfiles } from './laptop-content.ts';

const RPC = 4;
const NPC = 5;
const AIM = 0;

describe('dialogueProfiles', () => {
  it('finds text files of the original data, and of the stub pack only when the game runs on stubs', () => {
    const files = new Set(['mercedt/001.edt', 'stubs/npcdata/094.edt', 'npcdata/065.edt']);
    const types = new Map([
      [1, AIM],
      [2, AIM],
      [65, RPC],
      [94, NPC],
      [95, NPC],
    ]);
    const found = (stubbed: boolean) =>
      [...dialogueProfiles((p) => files.has(p), types, { namedProfiles: {} }, stubbed)].sort((a, b) => a - b);
    expect(found(true)).toEqual([1, 65, 94]);
    expect(found(false)).toEqual([1, 65]);
  });
});

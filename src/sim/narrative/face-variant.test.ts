import { describe, expect, it } from 'vitest';
import { Npc } from '../strategic/narrative/npc-ids.ts';
import { drunkTalkFace, elliotFaceVariant } from './face-variant.ts';

describe("Elliot's big face (InitFace)", () => {
  it('follows bNPCData through the beaten variants', () => {
    expect([0, 3, 4, 6, 7, 9, 10, 12, 13, 15, 16, 17, 18].map(elliotFaceVariant)).toEqual([
      null,
      null,
      'a',
      'a',
      'b',
      'b',
      'c',
      'c',
      'd',
      'd',
      null,
      'e',
      null,
    ]);
  });
});

describe('the drink icon on a face without a soldier (HandleRenderFaceAdjustments)', () => {
  it("shows on Father Walker's and Micky's talk face from a drink counter of 5, on nobody else's", () => {
    for (const profile of [Npc.FATHER, Npc.MICKY])
      expect([4, 5, 9].map((data) => drunkTalkFace(profile, data))).toEqual([false, true, true]);
    expect(drunkTalkFace(Npc.MICKY - 1, 9)).toBe(false);
  });
});

import { describe, expect, it } from 'vitest';
import { refusalMessage } from './refusals.ts';

describe('refusal messages', () => {
  it("box a move refused in the museum with ME_MUSEUM's map error and one during a bloodcat ambush with ME_COMBAT's", () => {
    expect(refusalMessage('museumChalice')).toEqual({ table: 'pMapErrorString', index: 34, shown: 'box' });
    expect(refusalMessage('inCombat')).toEqual({ table: 'pMapErrorString', index: 11, shown: 'box' });
  });
});

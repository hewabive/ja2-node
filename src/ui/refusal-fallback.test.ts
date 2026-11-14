import { describe, expect, it } from 'vitest';
import { fallbackRefusalLine } from './refusal-fallback.ts';

function refused(token: string, reason = `${token}: why`) {
  return { ok: false, reason, data: { refusal: token } };
}

describe('the fallback line for a refusal no screen shows', () => {
  it('prints the reason of a refusal the original has no string for, such as an open prompt or a meanwhile', () => {
    expect(fallbackRefusalLine(refused('promptOpen', 'answer the militiaContinue prompt first'))).toBe(
      'answer the militiaContinue prompt first',
    );
    expect(fallbackRefusalLine(refused('inMeanwhile'))).toBe('inMeanwhile: why');
    expect(fallbackRefusalLine({ ok: false, reason: 'unexpected reply' })).toBe('unexpected reply');
  });

  it("prints nothing for a refusal with the original's own message, which the session logs or the screen boxes", () => {
    expect(fallbackRefusalLine(refused('noPath'))).toBeNull();
    expect(fallbackRefusalLine(refused('loyaltyTooLow'))).toBeNull();
  });

  it('prints nothing where the original ignores the order, its input locked, or answers it without a line', () => {
    for (const token of [
      'notYourTurn',
      'uiLocked',
      'attackResolving',
      'mercActing',
      'autoBandaging',
      'refusesOrder',
      'noAmmo',
      'alreadyFacing',
    ])
      expect(fallbackRefusalLine(refused(token))).toBeNull();
    expect(fallbackRefusalLine({ ok: false, reason: 'paused' })).toBeNull();
  });

  it('prints nothing for an item put where it cannot go, as UIHandleItemPlacement fails without a word', () => {
    for (const token of ['doesNotFit', 'noRoom', 'cannotAttach', 'wrongAmmo', 'keyRingFull'])
      expect(fallbackRefusalLine(refused(token))).toBeNull();
  });

  it('prints nothing for a refusal a screen answers itself, with its own box or another order', () => {
    for (const token of ['noRoofEdge', 'mergePrompt', 'noMilitiaHere', 'alreadyInSquad'])
      expect(fallbackRefusalLine(refused(token))).toBeNull();
  });

  it('prints nothing for an accepted order', () => {
    expect(fallbackRefusalLine({ ok: true })).toBeNull();
  });
});

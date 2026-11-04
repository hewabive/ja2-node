import { describe, expect, it } from 'vitest';
import type { SoldierView } from '../../../protocol/view.ts';
import { apColour } from './soldiers.ts';

describe('the AP number of a merc in combat (PrintAP)', () => {
  const merc = { id: 2, ap: 4, enoughApToAttack: true } as SoldierView;

  it('turns dark red when he lacks the APs to attack his last target, ahead of the sneaking yellow', () => {
    expect(apColour(merc)).toBe('ltgray');
    expect(apColour({ ...merc, stealth: true })).toBe('ltyellow');
    expect(apColour({ ...merc, stealth: true, enoughApToAttack: false })).toBe('dkred');
    expect(apColour({ ...merc, ap: -2 })).toBe('dkred');
  });
});

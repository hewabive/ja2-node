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

  it('turns light blue under a drink, a hangover, adrenaline or its crash, ahead of the sneaking yellow but not of dark red', () => {
    const influences: readonly Partial<SoldierView>[] = [
      { drunk: 'feelingGood' },
      { drunk: 'hungover' },
      { adrenaline: 'active' },
      { adrenaline: 'crash' },
    ];
    for (const influence of influences) {
      expect(apColour({ ...merc, ...influence, stealth: true })).toBe('ltblue');
      expect(apColour({ ...merc, ...influence, enoughApToAttack: false })).toBe('dkred');
      expect(apColour({ ...merc, ...influence, ap: -1 })).toBe('dkred');
    }
  });
});

import { describe, expect, it } from 'vitest';
import type { PlayerView, SoldierView } from '../../../protocol/view.ts';
import { apColour, teamPanelMembers, vehicleCarrying } from './soldiers.ts';

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

describe('the team panel of the current squad (CheckForAndAddMercToTeamPanel)', () => {
  const HUMVEE = 22;
  const merc = (id: number, over: Partial<SoldierView> = {}) => ({ id, team: 0, bodyType: 0, squad: 1, ...over }) as SoldierView;

  it("lists a vehicle's passengers in seat order in its place, not the vehicle, and nobody aboard on his own", () => {
    const driver = merc(3, { squad: null, vehicle: { id: 0, driver: true } });
    const passenger = merc(1, { squad: null, vehicle: { id: 0, driver: false } });
    const truck = merc(18, { bodyType: HUMVEE, passengers: [3, 1] });
    const walker = merc(2);
    const view = { soldiers: [passenger, walker, driver, truck] } as unknown as PlayerView;
    expect(teamPanelMembers(view, [walker, truck, driver]).map((s) => s.id)).toEqual([2, 3, 1]);
  });

  it('finds the vehicle of a merc aboard, whose face selects it, and none for a merc on foot', () => {
    const passenger = merc(1, { squad: null, vehicle: { id: 0, driver: false } });
    const truck = merc(18, { bodyType: HUMVEE, passengers: [1] });
    const walker = merc(2);
    const view = { soldiers: [passenger, walker, truck] } as unknown as PlayerView;
    expect(vehicleCarrying(view, passenger)?.id).toBe(18);
    expect(vehicleCarrying(view, walker)).toBeNull();
  });
});

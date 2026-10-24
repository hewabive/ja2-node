import { describe, expect, it } from 'vitest';
import type { EstimateAttack } from '../../../../protocol/hints.ts';
import { attackCursor, OK_CHANCE_TO_GET_THROUGH, REFINE_AIM_1 } from './attack-cursors.ts';

const GUN: EstimateAttack = {
  cursor: 'target',
  weaponMode: 'single',
  apCost: 5,
  apCostByAim: [5, 6, 7, 8, 9],
  actionPoints: 20,
  chanceToHit: 40,
  chanceToGetThrough: 100,
  inRange: true,
  ammo: { empty: false, canReload: false, reloadAp: 0 },
};
const CONFIRMED = { activated: true, inCombat: true, burst: false, throwingKnife: false };
const AIM = { shownAimTime: REFINE_AIM_1, fullCountRing: false };

describe('the aim cursor', () => {
  it('marks its mouse cursor to flash and beep out of range, black where the shot cannot get through, clear otherwise', () => {
    expect(attackCursor(GUN, AIM, CONFIRMED).freeCursor).toBe('clear');
    expect(attackCursor({ ...GUN, inRange: false }, AIM, CONFIRMED).freeCursor).toBe('outOfRange');
    const blocked = { ...GUN, inRange: false, chanceToGetThrough: OK_CHANCE_TO_GET_THROUGH - 1 };
    expect(attackCursor(blocked, AIM, CONFIRMED).freeCursor).toBe('cannotGetThrough');
  });

  it('leaves the mouse cursor alone at the AP limit and before the aim is confirmed', () => {
    const broke = { ...GUN, inRange: false, actionPoints: 2 };
    expect(attackCursor(broke, AIM, CONFIRMED)).toMatchObject({ cursor: 'ACTION_TARGETRED_UICURSOR', freeCursor: 'untouched' });
    const far = attackCursor({ ...GUN, inRange: false }, AIM, { ...CONFIRMED, activated: false });
    expect(far).toMatchObject({ cursor: 'ACTION_FLASH_SHOOT_UICURSOR', freeCursor: 'untouched' });
  });
});

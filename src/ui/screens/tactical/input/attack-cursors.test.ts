import { describe, expect, it } from 'vitest';
import type { EstimateAttack } from '../../../../protocol/hints.ts';
import { attackCursor, OK_CHANCE_TO_GET_THROUGH, ordersAnAttack, REFINE_AIM_1 } from './attack-cursors.ts';

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
const CONFIRMED = { activated: true, inCombat: true, burst: false, throwingKnife: false, onTarget: true };
const HOVERING = { ...CONFIRMED, activated: false };
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

  it('draws the item cursors of HandleAidCursor and HandleRemoteCursor, and the unbuilt item actions greyed out', () => {
    const item = (cursor: EstimateAttack['cursor'], apCost = 0): EstimateAttack => ({ ...GUN, cursor, apCost, apCostByAim: [] });
    expect(attackCursor(item('aid'), AIM, HOVERING).cursor).toBe('ACTION_FIRSTAID_RED');
    expect(attackCursor(item('aid'), AIM, { ...HOVERING, onTarget: false }).cursor).toBe('ACTION_FIRSTAID_GRAY');
    expect(attackCursor(item('remote', 2), AIM, HOVERING)).toMatchObject({ cursor: 'PLACE_REMOTE_GREY_UICURSOR', apCost: 2 });
    expect(attackCursor(item('remote', 2), AIM, CONFIRMED).cursor).toBe('PLACE_REMOTE_RED_UICURSOR');
    expect(attackCursor(item('bomb'), AIM, CONFIRMED)).toMatchObject({ cursor: 'PLACE_BOMB_GREY_UICURSOR', apCost: null });
    expect(attackCursor(item('wirecutter'), AIM, HOVERING).cursor).toBe('BAD_WIRECUTTER_UICURSOR');
    expect(attackCursor(item('tincan'), AIM, HOVERING).cursor).toBe('PLACE_TINCAN_GREY_UICURSOR');
    expect(attackCursor(item('invalid'), AIM, HOVERING).cursor).toBe('INVALID_ACTION_UICURSOR');
    expect(attackCursor(item('other'), AIM, HOVERING).cursor).toBe('NO_UICURSOR');
    expect([item('aid'), item('remote'), item('bomb'), GUN].map(ordersAnAttack)).toEqual([false, false, false, true]);
  });
});

import { beforeAll, describe, expect, it } from 'vitest';
import { newCombatSim, runUntilIdle, spawnSoldier } from '../../../tests/support/combat.ts';
import { loadTestContent } from '../../../tests/support/tactical.ts';
import { Direction, gridNo } from '../../content/world/grid.ts';
import { createItem } from '../items/object.ts';
import type { TacticalContent } from './content.ts';
import { AP_RELOAD_GUN, InvSlot } from './inventory.ts';
import { AP } from './points.ts';
import { selectAfterPlayerTeamMemberDeath } from './selection.ts';
import { type Soldier, Team } from './soldier.ts';
import type { TacticalSim } from './tactical-sim.ts';

let content: TacticalContent;

beforeAll(async () => {
  content = await loadTestContent();
});

const OWNER = 0;
const HOLDER = 1;
const NO_MECHANICAL = 0;
const SILENCER_STATUS = 90;
const LASER_STATUS = 80;

const item = (name: string) => content.items.byName.get(name)?.index ?? -1;

function attachedItems(s: Soldier): number[] {
  return (s.inv[InvSlot.HAND]?.attachments ?? []).map((a) => a.item).filter((i) => i !== 0);
}

function gunner(sim: TacticalSim, id = OWNER, x = 80): Soldier {
  const merc = spawnSoldier(sim, id, Team.OUR, gridNo(x, 80), Direction.SOUTH);
  merc.inv[InvSlot.HAND] = createItem(content.items, item('GLOCK_17'), 100);
  merc.inv[InvSlot.BIGPOCK2] = createItem(content.items, item('SILENCER'), SILENCER_STATUS);
  merc.inv[InvSlot.BIGPOCK3] = createItem(content.items, item('LASERSCOPE'), LASER_STATUS);
  return merc;
}

function inCombat(sim: TacticalSim): void {
  spawnSoldier(sim, 20, Team.ENEMY, gridNo(80, 95), Direction.NORTH);
  sim.lookAround();
  expect(sim.state.inCombat).toBe(true);
  expect(sim.state.turn.currentTeam).toBe(Team.OUR);
}

function open(sim: TacticalSim, extra: Record<string, unknown> = {}): void {
  expect(sim.dispatch({ type: 'openItemDescription', soldier: OWNER, slot: 'hand', ...extra })).toMatchObject({ ok: true });
}

const attach = (pocket: string, extra: Record<string, unknown> = {}) => ({
  type: 'attach',
  soldier: OWNER,
  item: pocket,
  to: 'hand',
  ...extra,
});
const detach = (attachment: string) => ({ type: 'detach', soldier: OWNER, slot: 'hand', attachment });
const close = { type: 'closeItemDescription' };

describe('the item description box charges AP_RELOAD_GUN once as it closes (Interface_Items.cc DeleteItemDescriptionBox)', () => {
  it('charges two changes in one box once, at the close, and nothing for the changes themselves', () => {
    const sim = newCombatSim(content);
    const merc = gunner(sim);
    inCombat(sim);
    const ap = merc.actionPoints;
    open(sim);
    expect(sim.dispatch(attach('bigPocket2'))).toMatchObject({ ok: true, data: { result: 'attached', inBox: true } });
    expect(sim.dispatch(attach('bigPocket3'))).toMatchObject({ ok: true, data: { result: 'attached', inBox: true } });
    expect(merc.actionPoints).toBe(ap);
    expect(attachedItems(merc)).toEqual([item('SILENCER'), item('LASERSCOPE')]);
    expect(sim.dispatch(close)).toEqual({ ok: true, data: { charged: AP_RELOAD_GUN } });
    expect(ap - merc.actionPoints).toBe(AP_RELOAD_GUN);
    expect(sim.state.itemDescription).toBeNull();
  });

  it('charges nothing for an attach taken off again in the same box, as it compares the attachments with the opening', () => {
    const sim = newCombatSim(content);
    const merc = gunner(sim);
    inCombat(sim);
    const ap = merc.actionPoints;
    open(sim);
    expect(sim.dispatch(attach('bigPocket2'))).toMatchObject({ ok: true });
    expect(sim.dispatch(detach('SILENCER'))).toMatchObject({ ok: true, data: { item: 'SILENCER', inBox: true } });
    expect(sim.dispatch(close)).toEqual({ ok: true, data: { charged: 0 } });
    expect(merc.actionPoints).toBe(ap);
  });

  it('lets a merc with 5 APs attach twice and one with 9 detach after an attach in one box, which plain commands refuse', () => {
    const sim = newCombatSim(content);
    const merc = gunner(sim);
    inCombat(sim);
    merc.actionPoints = AP_RELOAD_GUN;
    expect(sim.dispatch(attach('bigPocket2'))).toMatchObject({ ok: true });
    expect(merc.actionPoints).toBe(0);
    expect(sim.dispatch(attach('bigPocket3'))).toMatchObject({ ok: false, data: { refusal: 'notEnoughAP' } });

    const boxed = newCombatSim(content);
    const twice = gunner(boxed);
    inCombat(boxed);
    twice.actionPoints = AP_RELOAD_GUN;
    expect(boxed.dispatch({ type: 'openItemDescription', soldier: OWNER, slot: 'hand' })).toMatchObject({ ok: true });
    expect(boxed.dispatch(attach('bigPocket2'))).toMatchObject({ ok: true });
    expect(boxed.dispatch(attach('bigPocket3'))).toMatchObject({ ok: true });
    expect(boxed.dispatch(close)).toMatchObject({ ok: true, data: { charged: AP_RELOAD_GUN } });
    expect(twice.actionPoints).toBe(0);

    twice.actionPoints = AP_RELOAD_GUN + AP.PICKUP_ITEM + 1;
    expect(boxed.dispatch({ type: 'openItemDescription', soldier: OWNER, slot: 'hand' })).toMatchObject({ ok: true });
    expect(boxed.dispatch(detach('SILENCER'))).toMatchObject({ ok: true, data: { inBox: true } });
    expect(boxed.dispatch(detach('LASERSCOPE'))).toMatchObject({ ok: true, data: { inBox: true } });
    expect(boxed.dispatch(close)).toMatchObject({ ok: true, data: { charged: AP_RELOAD_GUN } });
    expect(twice.actionPoints).toBe(AP.PICKUP_ITEM + 1);
  });

  it('charges nothing out of combat', () => {
    const sim = newCombatSim(content);
    const merc = gunner(sim);
    const ap = merc.actionPoints;
    open(sim);
    expect(sim.dispatch(attach('bigPocket2'))).toMatchObject({ ok: true, data: { inBox: true } });
    expect(sim.dispatch(close)).toEqual({ ok: true, data: { charged: 0 } });
    expect(merc.actionPoints).toBe(ap);
  });

  it("charges the merc whose cursor item opened the box once, his attach and the owner's detach inside selecting nobody", () => {
    const sim = newCombatSim(content);
    const owner = gunner(sim);
    owner.inv[InvSlot.HAND]?.attachments.splice(0, 1, { item: item('LASERSCOPE'), status: LASER_STATUS });
    const holder = gunner(sim, HOLDER, 81);
    inCombat(sim);
    const [ownerAp, holderAp] = [owner.actionPoints, holder.actionPoints];
    expect(sim.dispatch({ type: 'openItemDescription', soldier: HOLDER, toSoldier: OWNER, slot: 'hand' })).toEqual({
      ok: true,
      data: { soldier: OWNER, slot: InvSlot.HAND, payer: HOLDER },
    });
    expect(sim.state.turn.selected).toBe(OWNER);
    expect(sim.dispatch(attach('bigPocket2', { soldier: HOLDER, toSoldier: OWNER }))).toMatchObject({ ok: true, data: { inBox: true } });
    expect(sim.dispatch(detach('LASERSCOPE'))).toMatchObject({ ok: true, data: { inBox: true } });
    expect(sim.state.turn.selected).toBe(OWNER);
    expect(attachedItems(owner)).toEqual([item('SILENCER')]);
    expect(sim.dispatch(close)).toMatchObject({ ok: true, data: { charged: AP_RELOAD_GUN } });
    expect(holderAp - holder.actionPoints).toBe(AP_RELOAD_GUN);
    expect(owner.actionPoints).toBe(ownerAp);
  });

  it('refuses closeItemDescription with no box open and both commands on the enemy turn', () => {
    const sim = newCombatSim(content);
    gunner(sim);
    expect(sim.dispatch(close)).toMatchObject({ ok: false, data: { refusal: 'noItemDescription' } });
    expect(sim.dispatch({ type: 'openItemDescription', soldier: OWNER, slot: 'bigPocket1' })).toMatchObject({
      ok: false,
      data: { refusal: 'emptySlot' },
    });
    inCombat(sim);
    open(sim);
    sim.state.turn.currentTeam = Team.ENEMY;
    expect(sim.dispatch(close)).toMatchObject({ ok: false, data: { refusal: 'notYourTurn' } });
    expect(sim.dispatch({ type: 'openItemDescription', soldier: OWNER, slot: 'hand' })).toMatchObject({
      ok: false,
      data: { refusal: 'notYourTurn' },
    });
    expect(sim.state.itemDescription).not.toBeNull();
  });
});

describe('what closes the item description box', () => {
  function boxWithSilencer(sim: TacticalSim): Soldier {
    const merc = gunner(sim);
    gunner(sim, HOLDER, 81);
    inCombat(sim);
    open(sim);
    expect(sim.dispatch(attach('bigPocket2'))).toMatchObject({ ok: true });
    return merc;
  }

  it('closes and charges when another merc is selected, by an order of his or select (SetSMPanelCurrentMerc)', () => {
    const sim = newCombatSim(content);
    const merc = boxWithSilencer(sim);
    const ap = merc.actionPoints;
    expect(sim.dispatch({ type: 'stance', soldier: OWNER, stance: 'crouch' })).toMatchObject({ ok: true });
    runUntilIdle(sim);
    expect(sim.state.itemDescription).not.toBeNull();
    const crouched = merc.actionPoints;
    expect(sim.dispatch({ type: 'select', soldier: HOLDER })).toMatchObject({ ok: true });
    expect(sim.state.itemDescription).toBeNull();
    expect(crouched - merc.actionPoints).toBe(AP_RELOAD_GUN);
    expect(ap).toBeGreaterThan(crouched);
  });

  it('closes the first box and charges it when another opens', () => {
    const sim = newCombatSim(content);
    const merc = boxWithSilencer(sim);
    const ap = merc.actionPoints;
    expect(sim.dispatch({ type: 'openItemDescription', soldier: OWNER, slot: 'bigPocket3' })).toMatchObject({ ok: true });
    expect(ap - merc.actionPoints).toBe(AP_RELOAD_GUN);
    expect(sim.state.itemDescription).toMatchObject({ soldier: OWNER, slot: InvSlot.BIGPOCK3 });
  });

  it('closes the box first for an attach or detach on another item, which is a box of its own', () => {
    const sim = newCombatSim(content);
    const merc = boxWithSilencer(sim);
    merc.inv[InvSlot.SECOND_HAND] = createItem(content.items, item('GLOCK_17'), 100);
    const ap = merc.actionPoints;
    expect(sim.dispatch(attach('bigPocket3', { to: 'secondHand' }))).toMatchObject({ ok: true, data: { result: 'attached' } });
    expect(ap - merc.actionPoints).toBe(2 * AP_RELOAD_GUN);
    expect(sim.state.itemDescription).toBeNull();
  });

  it('closes when the merc dies and the selection moves on', () => {
    const sim = newCombatSim(content);
    const merc = boxWithSilencer(sim);
    const ap = merc.actionPoints;
    merc.life = 0;
    selectAfterPlayerTeamMemberDeath(sim.state, merc, sim.state.soldiers[HOLDER] ?? null);
    expect(sim.state.turn.selected).toBe(HOLDER);
    expect(sim.state.itemDescription).toBeNull();
    expect(ap - merc.actionPoints).toBe(AP_RELOAD_GUN);
  });

  it("stays open over the end of the turn and charges the next turn's APs at its close (UIHandleEndTurn leaves it up)", () => {
    const sim = newCombatSim(content);
    const merc = boxWithSilencer(sim);
    expect(sim.dispatch({ type: 'endTurn' })).toMatchObject({ ok: true });
    expect(sim.state.itemDescription).not.toBeNull();
    runUntilIdle(sim);
    expect(sim.state.turn.currentTeam).toBe(Team.OUR);
    expect(sim.state.itemDescription).toMatchObject({ soldier: OWNER, payer: OWNER });
    const fresh = merc.actionPoints;
    expect(sim.dispatch(close)).toMatchObject({ ok: true, data: { charged: AP_RELOAD_GUN } });
    expect(fresh - merc.actionPoints).toBe(AP_RELOAD_GUN);
  });

  it('closes, charging the changes before it, when an attachment skill check fails (Items.cc AttachObject)', () => {
    const sim = newCombatSim(content);
    const merc = boxWithSilencer(sim);
    merc.stats.mechanical = NO_MECHANICAL;
    merc.inv[InvSlot.BIGPOCK3] = createItem(content.items, item('GUN_BARREL_EXTENDER'), 100);
    const ap = merc.actionPoints;
    expect(sim.dispatch(attach('bigPocket3', { permanent: true }))).toMatchObject({
      ok: true,
      data: { result: 'failedCheck', inBox: true, boxClosed: true },
    });
    expect(sim.state.itemDescription).toBeNull();
    expect(ap - merc.actionPoints).toBe(AP_RELOAD_GUN);
  });
});

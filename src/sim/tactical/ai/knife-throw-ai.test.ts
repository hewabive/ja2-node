import { beforeAll, describe, expect, it } from 'vitest';
import { newCombatSim, runUntilIdle, spawnSoldier } from '../../../../tests/support/combat.ts';
import { loadTestContent } from '../../../../tests/support/tactical.ts';
import { Direction, gridNo } from '../../../content/world/grid.ts';
import type { SimEvent } from '../../events.ts';
import { createItem } from '../../items/object.ts';
import { initNewSoldierAnim, states } from '../animation.ts';
import type { TacticalContent } from '../content.ts';
import { InvSlot } from '../inventory.ts';
import { AlertStatus, type Soldier, Team } from '../soldier.ts';
import type { TacticalSim } from '../tactical-sim.ts';
import { enterCombatMode } from '../turns/turns.ts';
import { AiAction } from './actions.ts';
import { type CombatDeciderHooks, decideActionBlack } from './combat-decide.ts';

let content: TacticalContent;

beforeAll(async () => {
  content = await loadTestContent();
});

const item = (name: string) => content.items.byName.get(name)?.index ?? -1;
const KNIFE_IN_POCKET_STATUS = 90;
const SPARE_KNIFE_STATUS = 80;
const DYING_LIFE = 5;

function knifeThrower(hand: string, distance: number) {
  const sim = newCombatSim(content);
  const merc = spawnSoldier(sim, 0, Team.OUR, gridNo(80, 80), Direction.SOUTH);
  const enemy = spawnSoldier(sim, 20, Team.ENEMY, gridNo(80, 80 + distance), Direction.NORTH, { gun: hand });
  return { sim, t: sim.state, merc, enemy };
}

function armourAgainstGuns(merc: Soldier): void {
  merc.inv[InvSlot.HELMET] = createItem(content.items, item('SPECTRA_HELMET'), 100);
  merc.inv[InvSlot.VEST] = createItem(content.items, item('SPECTRA_VEST_Y'), 100);
  merc.inv[InvSlot.LEGS] = createItem(content.items, item('SPECTRA_LEGGINGS_Y'), 100);
}

function pocketKnives(enemy: Soldier, count: number): void {
  enemy.inv[InvSlot.SMALLPOCK1] = createItem(content.items, item('THROWING_KNIFE'), KNIFE_IN_POCKET_STATUS);
  if (count > 1) enemy.inv[InvSlot.SMALLPOCK2] = createItem(content.items, item('THROWING_KNIFE'), SPARE_KNIFE_STATUS);
}

function blackDecision(sim: TacticalSim, enemy: Soldier) {
  sim.lookAround();
  enterCombatMode(sim.state, Team.ENEMY);
  enemy.ai.alertStatus = AlertStatus.BLACK;
  enemy.ai.nextAction = AiAction.NONE;
  let acts = 0;
  const hooks: CombatDeciderHooks = { decideActionGreen: () => AiAction.NONE, npcDoesAct: () => acts++ };
  const action = decideActionBlack(sim.state, enemy, hooks);
  return { action, acts };
}

function enemyTurn(sim: TacticalSim): SimEvent[] {
  sim.lookAround();
  sim.drainEvents();
  expect(sim.dispatch({ type: 'endTurn' }).ok).toBe(true);
  return runUntilIdle(sim);
}

const knivesThrownBy = (events: readonly SimEvent[], s: Soldier) =>
  events.filter((e) => e.type === 'shotFired' && e.soldier === s.id && e.item === item('THROWING_KNIFE'));

describe('the throwing knife in black (DecideAction.cc DecideActionBlack, Attacks.cc CalcBestShot)', () => {
  it('weighs the knife as a shot and throws it at the opponent', () => {
    const { sim, merc, enemy } = knifeThrower('THROWING_KNIFE', 4);
    const { action, acts } = blackDecision(sim, enemy);
    expect(action).toBe(AiAction.THROW_KNIFE);
    expect(enemy.ai.actionData).toBe(merc.gridNo);
    expect(enemy.ai.nextAction).toBe(AiAction.NONE);
    expect(acts).toBe(1);
  });

  it('acts but throws nothing at an opponent who is down', () => {
    const { sim, merc, enemy } = knifeThrower('THROWING_KNIFE', 4);
    merc.life = DYING_LIFE;
    const { action, acts } = blackDecision(sim, enemy);
    expect(action).not.toBe(AiAction.THROW_KNIFE);
    expect(acts).toBe(1);
  });

  it('prefers a pocketed knife to a gun whose rounds the armour stops, and puts it in his hand for good', () => {
    const { sim, merc, enemy } = knifeThrower('GLOCK_17', 4);
    armourAgainstGuns(merc);
    pocketKnives(enemy, 1);
    initNewSoldierAnim(sim.state, enemy, states(content.animations).CROUCHING, 0, true);
    const { action } = blackDecision(sim, enemy);
    expect(action).toBe(AiAction.THROW_KNIFE);
    expect(enemy.inv[InvSlot.HAND]).toMatchObject({ item: item('THROWING_KNIFE') });
    expect(enemy.inv[InvSlot.SMALLPOCK1]).toMatchObject({ item: item('GLOCK_17') });
    expect(enemy.ai.nextAction).toBe(AiAction.NONE);
  });

  it('queues a second throw at the same tile for a standing soldier who draws the knife from a pocket: the lower-gun action meant to come first is overwritten', () => {
    const { sim, merc, enemy } = knifeThrower('GLOCK_17', 4);
    armourAgainstGuns(merc);
    pocketKnives(enemy, 1);
    const { action } = blackDecision(sim, enemy);
    expect(action).toBe(AiAction.THROW_KNIFE);
    expect(enemy.ai).toMatchObject({ actionData: merc.gridNo, nextAction: AiAction.THROW_KNIFE, nextActionData: merc.gridNo });
  });
});

describe('an enemy throwing knives on his turn (AIMain.cc ExecuteAction, Handle_Items.cc HandleItem)', () => {
  it('throws the knife in his hand, then the spare he takes from a pocket, and the bloody knives land in the merc pockets', () => {
    const { sim, t, merc, enemy } = knifeThrower('THROWING_KNIFE', 4);
    enemy.inv[InvSlot.SMALLPOCK1] = createItem(content.items, item('THROWING_KNIFE'), SPARE_KNIFE_STATUS);
    const events = enemyTurn(sim);
    expect(knivesThrownBy(events, enemy).map((e) => e.type === 'shotFired' && e.target)).toEqual([merc.gridNo, merc.gridNo]);
    const hits = events.filter((e) => e.type === 'soldierHit' && e.soldier === merc.id && e.attacker === enemy.id);
    const bloody = merc.inv.filter((o) => o.item === item('BLOODY_THROWING_KNIFE'));
    expect(bloody).toHaveLength(Math.min(hits.length, 2));
    expect(t.turn.attackBusyCount).toBe(0);
    expect(t.turn.currentTeam).toBe(Team.OUR);
  });

  it('throws both knives from his pockets at the same tile before he goes back to his gun', () => {
    const { sim, t, merc, enemy } = knifeThrower('GLOCK_17', 4);
    armourAgainstGuns(merc);
    pocketKnives(enemy, 2);
    const events = enemyTurn(sim);
    const shots = events.filter((e) => e.type === 'shotFired' && e.soldier === enemy.id);
    expect(shots.slice(0, 3)).toMatchObject([
      { item: item('THROWING_KNIFE'), target: merc.gridNo },
      { item: item('THROWING_KNIFE'), target: merc.gridNo },
      { item: item('GLOCK_17'), target: merc.gridNo },
    ]);
    expect(t.turn.currentTeam).toBe(Team.OUR);
  });

  it('runs up and punches with the empty hand the queued second throw finds after his only knife', () => {
    const { sim, t, merc, enemy } = knifeThrower('GLOCK_17', 4);
    armourAgainstGuns(merc);
    pocketKnives(enemy, 1);
    const events = enemyTurn(sim);
    const attacks = events.filter((e) => (e.type === 'shotFired' || e.type === 'meleeStrike') && e.soldier === enemy.id);
    expect(attacks.slice(0, 2)).toMatchObject([
      { type: 'shotFired', item: item('THROWING_KNIFE'), target: merc.gridNo },
      { type: 'meleeStrike', weapon: 'punch', target: merc.gridNo },
    ]);
    expect(t.turn.attackBusyCount).toBe(0);
    expect(t.turn.currentTeam).toBe(Team.OUR);
  });
});

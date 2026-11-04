import { beforeAll, describe, expect, it } from 'vitest';
import { hintAnswer, knowledgeOf, newCombatSim, spawnSoldier } from '../../../tests/support/combat.ts';
import { loadTestContent } from '../../../tests/support/tactical.ts';
import { DIRECTION_INCREMENT, Direction, gridNo } from '../../content/world/grid.ts';
import { createItem } from '../items/object.ts';
import { knowledgeViewOf } from '../knowledge/sim-view.ts';
import { AnimHeight, states } from '../tactical/animation.ts';
import { apsToDropBomb } from '../tactical/bombs/planting.ts';
import type { TacticalContent } from '../tactical/content.ts';
import { apsToBeginFirstAid } from '../tactical/first-aid.ts';
import { apsToGiveItem } from '../tactical/give.ts';
import { InvSlot } from '../tactical/inventory.ts';
import { apsToJumpOver } from '../tactical/jump-over.ts';
import { AP, apsToChangeStance } from '../tactical/points.ts';
import { apsToReloadRobot } from '../tactical/robot-reload.ts';
import { Body, Team } from '../tactical/soldier.ts';
import type { TacticalSim } from '../tactical/tactical-sim.ts';
import { AP_TOSS_ITEM } from '../tactical/toss.ts';
import { addItemToPool, Visibility, WorldItemFlags } from '../tactical/world-items.ts';
import { answerHint } from './answer.ts';
import type { PreviewAction } from './preview-action.ts';

let content: TacticalContent;

beforeAll(async () => {
  content = await loadTestContent();
});

const SOUTH = DIRECTION_INCREMENT[Direction.SOUTH] ?? 0;
const EAST = DIRECTION_INCREMENT[Direction.EAST] ?? 0;
const ORIGIN = gridNo(80, 80);
const ROBOT_RELOAD_AP = 4;

function action(sim: TacticalSim, kind: string, gridNoAt: number, extra: Readonly<Record<string, unknown>> = {}): PreviewAction {
  const answer = hintAnswer(sim, 'previewAction', { soldier: 0, kind, gridNo: gridNoAt, ...extra });
  expect(answer.ok, answer.reason).toBe(true);
  return answer.data as PreviewAction;
}

describe('the action previews of DrawUIMovementPath on the projection', () => {
  it('jumps over a prone squad mate for the stand-up plus AP_JUMP_OVER', () => {
    const sim = newCombatSim(content);
    const jumper = spawnSoldier(sim, 0, Team.OUR, ORIGIN, Direction.SOUTH);
    const lying = spawnSoldier(sim, 1, Team.OUR, ORIGIN + SOUTH, Direction.SOUTH);
    expect(action(sim, 'jump', ORIGIN + 2 * SOUTH)).toMatchObject({ ok: false, refusal: 'invalidJump' });
    lying.state = states(content.animations).PRONE;
    expect(action(sim, 'jump', ORIGIN + 2 * SOUTH)).toMatchObject({
      ok: true,
      apCost: apsToJumpOver(sim.state, jumper),
      direction: Direction.SOUTH,
    });
  });

  it('swaps places with an adjacent civilian and refuses an enemy', () => {
    const sim = newCombatSim(content);
    spawnSoldier(sim, 0, Team.OUR, ORIGIN, Direction.EAST);
    const civ = spawnSoldier(sim, 116, Team.CIV, ORIGIN + EAST, Direction.WEST);
    const enemy = spawnSoldier(sim, 20, Team.ENEMY, ORIGIN + SOUTH, Direction.NORTH);
    civ.visible = 1;
    enemy.visible = 1;
    expect(action(sim, 'swap', civ.gridNo, { target: civ.id })).toMatchObject({ ok: true, apCost: AP.EXCHANGE_PLACES });
    expect(action(sim, 'swap', enemy.gridNo, { target: enemy.id })).toMatchObject({ ok: false, refusal: 'invalidExchange' });
  });

  it('bandages a bleeding squad mate and refuses one who needs nothing, with the cost the cursor shows over both', () => {
    const sim = newCombatSim(content);
    const medic = spawnSoldier(sim, 0, Team.OUR, ORIGIN, Direction.EAST, { gun: 'FIRSTAIDKIT' });
    const patient = spawnSoldier(sim, 1, Team.OUR, ORIGIN + EAST, Direction.WEST);
    expect(action(sim, 'aid', patient.gridNo)).toMatchObject({
      ok: false,
      refusal: 'noNeed',
      apCost: apsToBeginFirstAid(sim.state, medic),
    });
    expect(action(sim, 'aid', ORIGIN + 3 * SOUTH)).toMatchObject({ ok: false, refusal: 'noTarget', apCost: 0 });
    patient.life -= 10;
    patient.bleeding = 5;
    expect(action(sim, 'aid', patient.gridNo)).toMatchObject({ ok: true, apCost: apsToBeginFirstAid(sim.state, medic) });
    medic.inv[InvSlot.HAND] = createItem(content.items, content.items.byName.get('GLOCK_17')?.index ?? 0, 100);
    expect(action(sim, 'aid', patient.gridNo)).toMatchObject({ ok: false, refusal: 'noKit' });
  });

  it('picks up items at the feet for AP_PICKUP_ITEM and walks to farther ones', () => {
    const sim = newCombatSim(content);
    spawnSoldier(sim, 0, Team.OUR, ORIGIN, Direction.EAST);
    const pistol = () => createItem(content.items, content.items.byName.get('GLOCK_17')?.index ?? 0, 100);
    addItemToPool(sim.state, ORIGIN, pistol(), Visibility.VISIBLE, 0);
    addItemToPool(sim.state, ORIGIN + 4 * EAST, pistol(), Visibility.VISIBLE, 0);
    expect(action(sim, 'pickUp', ORIGIN)).toMatchObject({ ok: true, apCost: AP.PICKUP_ITEM, actionGridNo: ORIGIN });
    const far = action(sim, 'pickUp', ORIGIN + 4 * EAST);
    expect(far.ok).toBe(true);
    expect(far.apCost).toBeGreaterThan(AP.PICKUP_ITEM);
    expect(far.steps.length).toBe(3);
    addItemToPool(sim.state, ORIGIN + 2 * EAST, pistol(), Visibility.VISIBLE, 0, WorldItemFlags.DONTRENDER, 40);
    expect(action(sim, 'pickUp', ORIGIN + 2 * EAST, { zLevel: 0 })).toMatchObject({ ok: false, refusal: 'nothingThere' });
    expect(action(sim, 'pickUp', ORIGIN + 2 * EAST)).toMatchObject({ ok: true, actionGridNo: ORIGIN + 2 * EAST });
  });

  it('searches a tile that shows no item, hidden items or none, for the walk plus AP_PICKUP_ITEM of a pickup there', () => {
    const sim = newCombatSim(content);
    spawnSoldier(sim, 0, Team.OUR, ORIGIN, Direction.EAST);
    const wirecutters = createItem(content.items, content.items.byName.get('WIRECUTTERS')?.index ?? 0, 100);
    addItemToPool(sim.state, ORIGIN + 3 * EAST, wirecutters, Visibility.HIDDEN_ITEM, 0);
    expect(action(sim, 'pickUp', ORIGIN)).toMatchObject({ ok: true, apCost: AP.PICKUP_ITEM, actionGridNo: ORIGIN });
    const empty = action(sim, 'pickUp', ORIGIN + 3 * SOUTH);
    const hidden = action(sim, 'pickUp', ORIGIN + 3 * EAST);
    expect([empty.ok, empty.actionGridNo, empty.steps.length, empty.apCost > AP.PICKUP_ITEM]).toEqual([true, ORIGIN + 3 * SOUTH, 2, true]);
    expect([hidden.ok, hidden.apCost, hidden.steps.length]).toEqual([true, empty.apCost, 2]);
  });

  it('looks for GetAPsToLook unless already facing, and talks to a squad mate for a bark', () => {
    const sim = newCombatSim(content);
    const merc = spawnSoldier(sim, 0, Team.OUR, ORIGIN, Direction.EAST);
    spawnSoldier(sim, 1, Team.OUR, ORIGIN + 2 * EAST, Direction.WEST);
    expect(action(sim, 'look', ORIGIN + 3 * EAST)).toMatchObject({ ok: false, refusal: 'alreadyFacing', apCost: 0 });
    expect(action(sim, 'look', ORIGIN + 3 * SOUTH)).toMatchObject({ ok: true, apCost: AP.LOOK_STANDING });
    expect(action(sim, 'talk', ORIGIN + 2 * EAST, { target: 1 })).toMatchObject({ ok: true, apCost: 0 });
    expect(apsToChangeStance(content, merc, AnimHeight.STAND)).toBe(0);
  });

  it('steals from a hostile soldier for AP_STEAL_ITEM, the stand-up and the walk to his side, and refuses a neutral', () => {
    const sim = newCombatSim(content);
    spawnSoldier(sim, 0, Team.OUR, ORIGIN, Direction.EAST);
    const enemy = spawnSoldier(sim, 20, Team.ENEMY, ORIGIN + 3 * EAST, Direction.WEST);
    const civ = spawnSoldier(sim, 116, Team.CIV, ORIGIN + SOUTH, Direction.NORTH);
    enemy.visible = 1;
    civ.visible = 1;
    const far = action(sim, 'steal', enemy.gridNo, { target: enemy.id });
    expect(far).toMatchObject({ ok: true, actionGridNo: ORIGIN + 2 * EAST });
    expect(far.steps.map((step) => step.gridNo)).toEqual([ORIGIN + EAST]);
    expect(far.apCost).toBeGreaterThan(AP.STEAL_ITEM);
    expect(action(sim, 'steal', civ.gridNo, { target: civ.id })).toMatchObject({ ok: false, refusal: 'notStealable' });
    const near = newCombatSim(content);
    const crouched = spawnSoldier(near, 0, Team.OUR, ORIGIN, Direction.EAST);
    spawnSoldier(near, 20, Team.ENEMY, ORIGIN + EAST, Direction.WEST).visible = 1;
    expect(action(near, 'steal', ORIGIN + EAST, { target: 20 })).toMatchObject({ ok: true, apCost: AP.STEAL_ITEM, steps: [] });
    crouched.state = states(content.animations).CROUCHING;
    expect(action(near, 'steal', ORIGIN + EAST, { target: 20 }).apCost).toBe(AP.STEAL_ITEM + AP.CROUCH);
  });

  it('previews a give to the robot as its reload: the walk to its side plus 4 AP, without the give’s AP', () => {
    const sim = newCombatSim(content);
    const merc = spawnSoldier(sim, 0, Team.OUR, ORIGIN, Direction.EAST);
    const robot = spawnSoldier(sim, 1, Team.OUR, ORIGIN + 4 * EAST, Direction.WEST, { body: Body.ROBOTNOWEAPON });
    const preview = action(sim, 'give', robot.gridNo, { target: robot.id });
    expect(preview).toMatchObject({ ok: true, reload: true, actionGridNo: ORIGIN + 3 * EAST });
    expect(preview.apCost).toBe(apsToReloadRobot(sim.state, merc, robot));
    expect(preview.apCost - ROBOT_RELOAD_AP).toBe(apsToGiveItem(sim.state, merc, ORIGIN + 3 * EAST) - AP.GIVE_ITEM);
    expect(preview.steps).not.toHaveLength(0);
  });

  it('previews a toss from the item cursor: AP_TOSS_ITEM and the landing tile, refused next to him and at a squad mate in passing range', () => {
    const sim = newCombatSim(content);
    const merc = spawnSoldier(sim, 0, Team.OUR, ORIGIN, Direction.EAST);
    merc.inv[InvSlot.BIGPOCK1] = createItem(content.items, content.items.byName.get('FIRSTAIDKIT')?.index ?? 0, 100);
    const far = ORIGIN + 6 * EAST;
    const pocket = { slot: 'bigPocket1' };
    expect(action(sim, 'toss', far, pocket)).toMatchObject({
      ok: true,
      apCost: AP_TOSS_ITEM,
      actionGridNo: far,
      landsAt: far,
      landsOnLevel: 0,
    });
    expect(action(sim, 'toss', ORIGIN + EAST, pocket)).toMatchObject({ ok: false, refusal: 'tooClose' });
    spawnSoldier(sim, 1, Team.OUR, ORIGIN + 2 * EAST, Direction.WEST);
    expect(action(sim, 'toss', ORIGIN + 2 * EAST, pocket)).toMatchObject({ ok: false, refusal: 'passInstead' });
    expect(action(sim, 'toss', far, { slot: 'smallPocket8' })).toMatchObject({ ok: false, refusal: 'emptySlot' });
    expect(sim.dispatch({ type: 'toss', soldier: 0, ...pocket, gridNo: far })).toEqual({ ok: true });
  });

  it('refuses an escort’s pickup and search as the hand cursor does', () => {
    const sim = newCombatSim(content);
    spawnSoldier(sim, 0, Team.OUR, ORIGIN, Direction.EAST);
    addItemToPool(
      sim.state,
      ORIGIN + EAST,
      createItem(content.items, content.items.byName.get('CANTEEN')?.index ?? 0, 100),
      Visibility.VISIBLE,
      0,
    );
    const view = knowledgeViewOf(sim);
    const escort = { ...view, soldiers: view.soldiers.map((v) => (v.id === 0 ? { ...v, kind: 'epc' } : v)) };
    const preview = (gridNoAt: number) =>
      answerHint(knowledgeOf(sim, escort), { type: 'previewAction', soldier: 0, kind: 'pickUp', gridNo: gridNoAt }).data as PreviewAction;
    expect([preview(ORIGIN + EAST), preview(ORIGIN + 3 * EAST)]).toMatchObject([
      { ok: false, refusal: 'escortCannotDoThat' },
      { ok: false, refusal: 'escortCannotDoThat' },
    ]);
    expect(action(sim, 'pickUp', ORIGIN + EAST)).toMatchObject({ ok: true });
  });

  it('plants on his own tile for AP_DROP_BOMB, walks onto another for the walk plus AP_DROP_BOMB, and refuses no bomb or a tile nobody could stand on', () => {
    const sim = newCombatSim(content);
    const sapper = spawnSoldier(sim, 0, Team.OUR, ORIGIN, Direction.EAST, { gun: 'MINE' });
    spawnSoldier(sim, 1, Team.OUR, ORIGIN + SOUTH, Direction.WEST);
    expect(action(sim, 'bomb', ORIGIN)).toMatchObject({ ok: true, apCost: AP.DROP_BOMB, actionGridNo: ORIGIN, steps: [] });
    const walk = action(sim, 'bomb', ORIGIN + 2 * EAST);
    expect(walk).toMatchObject({ ok: true, apCost: apsToDropBomb(sim.state, sapper, ORIGIN + 2 * EAST), actionGridNo: ORIGIN + 2 * EAST });
    expect(walk.apCost).toBeGreaterThan(AP.DROP_BOMB);
    expect(walk.steps.length).toBeGreaterThan(0);
    expect(action(sim, 'bomb', ORIGIN + SOUTH)).toMatchObject({ ok: false, refusal: 'badTile' });
    sapper.inv[InvSlot.HAND] = createItem(content.items, content.items.byName.get('GLOCK_17')?.index ?? 0, 100);
    expect(action(sim, 'bomb', ORIGIN)).toMatchObject({ ok: false, refusal: 'notABomb' });
  });

  it('answers notSupported for the item cursors without a command', () => {
    const sim = newCombatSim(content);
    spawnSoldier(sim, 0, Team.OUR, ORIGIN, Direction.EAST);
    for (const kind of ['cutFence', 'repair', 'refuel', 'jar', 'can', 'enterVehicle'])
      expect(hintAnswer(sim, 'previewAction', { soldier: 0, kind, gridNo: ORIGIN + 1 })).toMatchObject({
        ok: false,
        data: { refusal: 'notSupported' },
      });
  });

  it('never sees an unseen soldier standing on the walk-up path', () => {
    const sim = newCombatSim(content);
    spawnSoldier(sim, 0, Team.OUR, ORIGIN, Direction.EAST);
    const pistol = createItem(content.items, content.items.byName.get('GLOCK_17')?.index ?? 0, 100);
    addItemToPool(sim.state, ORIGIN + 4 * EAST, pistol, Visibility.VISIBLE, 0);
    const before = action(sim, 'pickUp', ORIGIN + 4 * EAST);
    const hidden = spawnSoldier(sim, 20, Team.ENEMY, ORIGIN + 2 * EAST, Direction.WEST);
    expect(hidden.visible).toBe(-1);
    expect(action(sim, 'pickUp', ORIGIN + 4 * EAST)).toEqual(before);
    expect(action(sim, 'swap', hidden.gridNo, { target: hidden.id })).toMatchObject({ ok: false, refusal: 'noSuchTarget' });
  });
});

import { beforeAll, describe, expect, it } from 'vitest';
import { hintAnswer, newCombatSim, spawnSoldier } from '../../../tests/support/combat.ts';
import { loadTestContent } from '../../../tests/support/tactical.ts';
import { DIRECTION_INCREMENT, Direction, gridNo } from '../../content/world/grid.ts';
import { createItem } from '../items/object.ts';
import { AnimHeight, states } from '../tactical/animation.ts';
import type { TacticalContent } from '../tactical/content.ts';
import { apsToBeginFirstAid } from '../tactical/first-aid.ts';
import { InvSlot } from '../tactical/inventory.ts';
import { apsToJumpOver } from '../tactical/jump-over.ts';
import { AP, apsToChangeStance } from '../tactical/points.ts';
import { Team } from '../tactical/soldier.ts';
import type { TacticalSim } from '../tactical/tactical-sim.ts';
import { addItemToPool, Visibility } from '../tactical/world-items.ts';
import type { PreviewAction } from './preview-action.ts';

const SLOW_MS = 60_000;

let content: TacticalContent;

beforeAll(async () => {
  content = await loadTestContent();
});

const SOUTH = DIRECTION_INCREMENT[Direction.SOUTH] ?? 0;
const EAST = DIRECTION_INCREMENT[Direction.EAST] ?? 0;
const ORIGIN = gridNo(80, 80);

function action(sim: TacticalSim, kind: string, gridNoAt: number, extra: Readonly<Record<string, unknown>> = {}): PreviewAction {
  const answer = hintAnswer(sim, 'previewAction', { soldier: 0, kind, gridNo: gridNoAt, ...extra });
  expect(answer.ok, answer.reason).toBe(true);
  return answer.data as PreviewAction;
}

describe('the action previews of DrawUIMovementPath on the projection', () => {
  it(
    'jumps over a prone squad mate for the stand-up plus AP_JUMP_OVER',
    () => {
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
    },
    SLOW_MS,
  );

  it(
    'swaps places with an adjacent civilian and refuses an enemy',
    () => {
      const sim = newCombatSim(content);
      spawnSoldier(sim, 0, Team.OUR, ORIGIN, Direction.EAST);
      const civ = spawnSoldier(sim, 116, Team.CIV, ORIGIN + EAST, Direction.WEST);
      const enemy = spawnSoldier(sim, 20, Team.ENEMY, ORIGIN + SOUTH, Direction.NORTH);
      civ.visible = 1;
      enemy.visible = 1;
      expect(action(sim, 'swap', civ.gridNo, { target: civ.id })).toMatchObject({ ok: true, apCost: AP.EXCHANGE_PLACES });
      expect(action(sim, 'swap', enemy.gridNo, { target: enemy.id })).toMatchObject({ ok: false, refusal: 'invalidExchange' });
    },
    SLOW_MS,
  );

  it(
    'bandages a bleeding squad mate and refuses one who needs nothing',
    () => {
      const sim = newCombatSim(content);
      const medic = spawnSoldier(sim, 0, Team.OUR, ORIGIN, Direction.EAST, { gun: 'FIRSTAIDKIT' });
      const patient = spawnSoldier(sim, 1, Team.OUR, ORIGIN + EAST, Direction.WEST);
      expect(action(sim, 'aid', patient.gridNo)).toMatchObject({ ok: false, refusal: 'noNeed' });
      patient.life -= 10;
      patient.bleeding = 5;
      expect(action(sim, 'aid', patient.gridNo)).toMatchObject({ ok: true, apCost: apsToBeginFirstAid(sim.state, medic) });
      medic.inv[InvSlot.HAND] = createItem(content.items, content.items.byName.get('GLOCK_17')?.index ?? 0, 100);
      expect(action(sim, 'aid', patient.gridNo)).toMatchObject({ ok: false, refusal: 'noKit' });
    },
    SLOW_MS,
  );

  it(
    'picks up items at the feet for AP_PICKUP_ITEM and walks to farther ones',
    () => {
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
      expect(action(sim, 'pickUp', ORIGIN + 2 * EAST)).toMatchObject({ ok: false, refusal: 'nothingThere' });
    },
    SLOW_MS,
  );

  it(
    'looks for GetAPsToLook unless already facing, and talks to a squad mate for a bark',
    () => {
      const sim = newCombatSim(content);
      const merc = spawnSoldier(sim, 0, Team.OUR, ORIGIN, Direction.EAST);
      spawnSoldier(sim, 1, Team.OUR, ORIGIN + 2 * EAST, Direction.WEST);
      expect(action(sim, 'look', ORIGIN + 3 * EAST)).toMatchObject({ ok: false, refusal: 'alreadyFacing', apCost: 0 });
      expect(action(sim, 'look', ORIGIN + 3 * SOUTH)).toMatchObject({ ok: true, apCost: AP.LOOK_STANDING });
      expect(action(sim, 'talk', ORIGIN + 2 * EAST, { target: 1 })).toMatchObject({ ok: true, apCost: 0 });
      expect(apsToChangeStance(content, merc, AnimHeight.STAND)).toBe(0);
    },
    SLOW_MS,
  );

  it(
    'answers notSupported for the item cursors without a command',
    () => {
      const sim = newCombatSim(content);
      spawnSoldier(sim, 0, Team.OUR, ORIGIN, Direction.EAST);
      for (const kind of ['steal', 'cutFence', 'repair', 'refuel', 'jar', 'can', 'bomb', 'enterVehicle'])
        expect(hintAnswer(sim, 'previewAction', { soldier: 0, kind, gridNo: ORIGIN + 1 })).toMatchObject({
          ok: false,
          data: { refusal: 'notSupported' },
        });
    },
    SLOW_MS,
  );

  it(
    'never sees an unseen soldier standing on the walk-up path',
    () => {
      const sim = newCombatSim(content);
      spawnSoldier(sim, 0, Team.OUR, ORIGIN, Direction.EAST);
      const pistol = createItem(content.items, content.items.byName.get('GLOCK_17')?.index ?? 0, 100);
      addItemToPool(sim.state, ORIGIN + 4 * EAST, pistol, Visibility.VISIBLE, 0);
      const before = action(sim, 'pickUp', ORIGIN + 4 * EAST);
      const hidden = spawnSoldier(sim, 20, Team.ENEMY, ORIGIN + 2 * EAST, Direction.WEST);
      expect(hidden.visible).toBe(-1);
      expect(action(sim, 'pickUp', ORIGIN + 4 * EAST)).toEqual(before);
      expect(action(sim, 'swap', hidden.gridNo, { target: hidden.id })).toMatchObject({ ok: false, refusal: 'noSuchTarget' });
    },
    SLOW_MS,
  );
});

import { beforeAll, describe, expect, it } from 'vitest';
import { newCombatSim, spawnSoldier } from '../../../../tests/support/combat.ts';
import { loadTestContent } from '../../../../tests/support/tactical.ts';
import { Direction, gridNo } from '../../../content/world/grid.ts';
import { Terrain } from '../../../content/world/terrain.ts';
import { createItem } from '../../items/object.ts';
import { ScriptedStream } from '../../strategic/forces/autoresolve/replay-rng.ts';
import { states } from '../animation.ts';
import { AiMorale } from '../combat/types.ts';
import type { TacticalContent } from '../content.ts';
import { InvSlot } from '../inventory.ts';
import { AlertStatus, Attitude, NOBODY, type Soldier, Team } from '../soldier.ts';
import type { TacticalSim } from '../tactical-sim.ts';
import { enterCombatMode } from '../turns/turns.ts';
import { AiAction } from './actions.ts';
import { type CombatDeciderHooks, decideActionBlack, decideActionRed, decideActionYellow } from './combat-decide.ts';
import { determineMovementMode } from './decide.ts';

let content: TacticalContent;

beforeAll(async () => {
  content = await loadTestContent();
});

const NO_GREEN_DECISION: CombatDeciderHooks = { decideActionGreen: () => AiAction.NONE, npcDoesAct: () => {} };

const item = (name: string) => content.items.byName.get(name)?.index ?? 0;

describe('the yellow decision (DecideAction.cc DecideActionYellow)', () => {
  function yellowGuard(sim: TacticalSim): Soldier {
    const guard = spawnSoldier(sim, 20, Team.ENEMY, gridNo(80, 80), Direction.SOUTH);
    spawnSoldier(sim, 21, Team.ENEMY, gridNo(70, 70), Direction.SOUTH);
    guard.ai.alertStatus = AlertStatus.YELLOW;
    guard.ai.noiseGridNo = gridNo(80, 90);
    guard.ai.noiseVolume = 10;
    return guard;
  }

  it('rolls PreRandom for the radio even when an ATTACKSLAYONLY attitude made the chance zero', () => {
    const sim = newCombatSim(content);
    const t = sim.state;
    const guard = yellowGuard(sim);
    guard.ai.attitude = Attitude.ATTACKSLAYONLY;
    guard.breath = 20;
    const pre = new ScriptedStream([], 0);
    Object.assign(t, { pre });
    expect(decideActionYellow(t, guard, NO_GREEN_DECISION)).toBe(AiAction.NONE);
    expect(pre.requested).toEqual([100]);
  });

  it('runs to a noise while the soldier has never weighed his morale: AI morale starts at HOPELESS', () => {
    const sim = newCombatSim(content);
    const t = sim.state;
    const guard = yellowGuard(sim);
    const moves = states(content.animations);
    expect(determineMovementMode(t, guard, AiAction.SEEK_NOISE)).toBe(moves.RUNNING);
    guard.ai.morale = AiMorale.NORMAL;
    expect(determineMovementMode(t, guard, AiAction.SEEK_NOISE)).toBe(moves.SWATTING);
  });
});

describe('the spotter call (DecideAction.cc DecideActionRed, DecideActionBlack)', () => {
  it('never stops a red grenadier to call for spotters: the original leaves the caller at soldier 0, never NOBODY', () => {
    const sim = newCombatSim(content);
    const t = sim.state;
    const grenadier = spawnSoldier(sim, 20, Team.ENEMY, gridNo(80, 80), Direction.SOUTH);
    spawnSoldier(sim, 21, Team.ENEMY, gridNo(70, 70), Direction.SOUTH);
    grenadier.inv[InvSlot.BIGPOCK1] = createItem(content.items, item('GLAUNCHER'), 100);
    grenadier.inv[InvSlot.BIGPOCK2] = createItem(content.items, item('GL_HE_GRENADE'), 100);
    grenadier.ai.alertStatus = AlertStatus.RED;
    t.inCombat = true;
    const caller = t.turn.spottersCalledForBy;
    const actionPoints = grenadier.actionPoints;
    decideActionRed(t, grenadier, NO_GREEN_DECISION);
    expect(caller).not.toBe(NOBODY);
    expect(t.turn.spottersCalledForBy).toBe(caller);
    expect(grenadier.actionPoints).toBe(actionPoints);
  });
});

describe('the mortar room in black (DecideAction.cc DecideActionBlack)', () => {
  const GUNNER_AT = gridNo(80, 80);
  const TOWARD_TARGET = gridNo(80, 81);
  const BEHIND = gridNo(80, 79);

  function blackMortarGunner(blocked: readonly number[]) {
    const sim = newCombatSim(content);
    const t = sim.state;
    spawnSoldier(sim, 0, Team.OUR, gridNo(80, 100), Direction.NORTH);
    const gunner = spawnSoldier(sim, 20, Team.ENEMY, GUNNER_AT, Direction.SOUTH);
    spawnSoldier(sim, 21, Team.ENEMY, gridNo(60, 60), Direction.SOUTH);
    gunner.inv[InvSlot.HAND] = createItem(content.items, 0, 0);
    gunner.inv[InvSlot.BIGPOCK1] = createItem(content.items, item('MORTAR'), 100);
    gunner.inv[InvSlot.BIGPOCK2] = createItem(content.items, item('MORTAR_SHELL'), 100);
    gunner.life = gunner.lifeMax / 2;
    sim.lookAround();
    enterCombatMode(t, Team.ENEMY);
    gunner.ai.alertStatus = AlertStatus.BLACK;
    for (const g of blocked) t.world.terrain[g] = Terrain.LOW_WATER;
    let acts = 0;
    const hooks: CombatDeciderHooks = { ...NO_GREEN_DECISION, npcDoesAct: () => acts++ };
    const action = decideActionBlack(t, gunner, hooks);
    return { action, actionData: gunner.ai.actionData, acts };
  }

  it('fires the mortar when the tile toward the target leaves room to fall', () => {
    const { action, acts } = blackMortarGunner([]);
    expect(action).toBe(AiAction.TOSS_PROJECTILE);
    expect(acts).toBe(1);
  });

  it('backs off a tile instead of firing when the tile toward the target is blocked', () => {
    const { action, actionData, acts } = blackMortarGunner([TOWARD_TARGET]);
    expect(action).toBe(AiAction.GET_CLOSER);
    expect(actionData).toBe(BEHIND);
    expect(acts).toBe(0);
  });

  it('drops the mortar throw without acting when there is no room on either side', () => {
    const { action, acts } = blackMortarGunner([TOWARD_TARGET, BEHIND]);
    expect(action).not.toBe(AiAction.TOSS_PROJECTILE);
    expect(action).not.toBe(AiAction.GET_CLOSER);
    expect(acts).toBe(0);
  });
});

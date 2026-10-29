import { beforeAll, describe, expect, it } from 'vitest';
import { newCombatSim, spawnSoldier } from '../../../../tests/support/combat.ts';
import { loadTestContent } from '../../../../tests/support/tactical.ts';
import { Direction, gridNo } from '../../../content/world/grid.ts';
import { createItem } from '../../items/object.ts';
import type { TacticalContent } from '../content.ts';
import { InvSlot } from '../inventory.ts';
import { AlertStatus, NOBODY, Team } from '../soldier.ts';
import { AiAction } from './actions.ts';
import { type CombatDeciderHooks, decideActionRed } from './combat-decide.ts';

let content: TacticalContent;

beforeAll(async () => {
  content = await loadTestContent();
});

const NO_GREEN_DECISION: CombatDeciderHooks = { decideActionGreen: () => AiAction.NONE, npcDoesAct: () => {} };

const item = (name: string) => content.items.byName.get(name)?.index ?? 0;

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

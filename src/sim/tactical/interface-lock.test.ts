import { beforeAll, describe, expect, it } from 'vitest';
import { newCombatSim, spawnSoldier } from '../../../tests/support/combat.ts';
import { loadTestContent } from '../../../tests/support/tactical.ts';
import { Direction, gridNo } from '../../content/world/grid.ts';
import type { TacticalContent } from './content.ts';
import { playerInterfaceLocked } from './interface-lock.ts';
import { NO_NARRATIVE_PORT } from './narrative/port.ts';
import { setActionToDoOnceMercsGetToLocation } from './sector-exit.ts';
import { Team } from './soldier.ts';
import { WaitForMercs } from './state.ts';
import type { TacticalSim } from './tactical-sim.ts';

let content: TacticalContent;

beforeAll(async () => {
  content = await loadTestContent();
});

function combatOn(team: number): TacticalSim {
  const sim = newCombatSim(content);
  sim.state.inCombat = true;
  sim.state.turn.currentTeam = team;
  return sim;
}

describe('the locked player interface (LOCKUI_MODE) as simulation state', () => {
  it('locks on a computer team’s turn in combat, not on ours and not out of combat', () => {
    const sim = newCombatSim(content);
    sim.state.turn.currentTeam = Team.ENEMY;
    expect(playerInterfaceLocked(sim.state)).toBe(false);
    sim.state.inCombat = true;
    expect(playerInterfaceLocked(sim.state)).toBe(true);
    sim.state.turn.currentTeam = Team.OUR;
    expect(playerInterfaceLocked(sim.state)).toBe(false);
  });

  it('stays open while a computer interrupt of our turn is hidden and locks once it shows (TeamTurns.cc DisplayHiddenInterrupt)', () => {
    const sim = combatOn(Team.ENEMY);
    sim.state.turn.intList.push(spawnSoldier(sim, 0, Team.OUR, gridNo(80, 80), Direction.SOUTH));
    sim.state.turn.hiddenInterrupt = true;
    expect(playerInterfaceLocked(sim.state)).toBe(false);
    sim.state.turn.hiddenInterrupt = false;
    expect(playerInterfaceLocked(sim.state)).toBe(true);
  });

  it('stays locked through a hidden interrupt of one computer team by another, as the computer’s turn already locked it', () => {
    const sim = combatOn(Team.MILITIA);
    sim.state.turn.intList.push(spawnSoldier(sim, 20, Team.ENEMY, gridNo(80, 92), Direction.NORTH));
    sim.state.turn.hiddenInterrupt = true;
    expect(playerInterfaceLocked(sim.state)).toBe(true);
  });

  it('locks while mercs walk off the map, to an exit grid or in from the edge', () => {
    for (const code of [WaitForMercs.WALKOFF_SCREEN, WaitForMercs.WALK_TO_GRIDNO, WaitForMercs.WALKON_SCREEN]) {
      const sim = newCombatSim(content);
      setActionToDoOnceMercsGetToLocation(sim.state, code, 1);
      expect(playerInterfaceLocked(sim.state)).toBe(true);
    }
  });

  it('locks while the boxers leave the ring, action items go off or a conversation runs with its panel closed', () => {
    const boxing = newCombatSim(content);
    boxing.state.boxing.uiLocked = true;
    const actionItems = newCombatSim(content);
    actionItems.state.actionItems.active = true;
    const scripted = newCombatSim(content);
    scripted.state.narrative = { ...NO_NARRATIVE_PORT, scriptedSequence: () => true };
    for (const sim of [boxing, actionItems, scripted]) expect(playerInterfaceLocked(sim.state)).toBe(true);
  });
});

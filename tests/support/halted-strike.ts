import { expect } from 'vitest';
import { Direction, gridNo } from '../../src/content/world/grid.ts';
import type { TacticalContent } from '../../src/sim/tactical/content.ts';
import { type Soldier, Team } from '../../src/sim/tactical/soldier.ts';
import type { TacticalSim } from '../../src/sim/tactical/tactical-sim.ts';
import { newCombatSim, runUntilIdle, spawnSoldier } from './combat.ts';

const HALT_TICKS = 2000;
const DYING_LIFE = 10;
const POOR_MARKSMANSHIP = 1;

function haltAtHisNextTileAsAnInterruptWould(sim: TacticalSim, merc: Soldier): void {
  const t = sim.state;
  const atNewGridNo = t.hooks.atNewGridNo;
  t.hooks = {
    ...t.hooks,
    atNewGridNo: (state, s) => {
      const interrupted = atNewGridNo(state, s);
      if (s !== merc) return interrupted;
      t.hooks = { ...t.hooks, atNewGridNo };
      return true;
    },
  };
  for (let tick = 0; tick < HALT_TICKS && !merc.noAPToFinishMove; tick++) sim.step();
  expect(merc.noAPToFinishMove).toBe(true);
}

export interface HaltedStrike {
  readonly sim: TacticalSim;
  readonly stabber: Soldier;
  readonly sighted: Soldier;
  readonly dying: Soldier;
  readonly shooter: Soldier;
}

export function stabberHaltedOnHisWalkUp(content: TacticalContent): HaltedStrike {
  const sim = newCombatSim(content);
  const t = sim.state;
  const stabber = spawnSoldier(sim, 0, Team.OUR, gridNo(83, 83), Direction.NORTHWEST, { gun: 'COMBAT_KNIFE' });
  const sighted = spawnSoldier(sim, 1, Team.OUR, gridNo(80, 95), Direction.SOUTH);
  const dying = spawnSoldier(sim, 20, Team.ENEMY, gridNo(81, 81), Direction.SOUTHEAST, { life: DYING_LIFE });
  const shooter = spawnSoldier(sim, 21, Team.ENEMY, gridNo(80, 100), Direction.NORTH, { marksmanship: POOR_MARKSMANSHIP });
  sim.lookAround();
  runUntilIdle(sim);
  expect(t.turn.currentTeam).toBe(Team.OUR);
  expect(sim.dispatch({ type: 'attack', soldier: stabber.id, target: dying.gridNo })).toEqual({ ok: true });
  haltAtHisNextTileAsAnInterruptWould(sim, stabber);
  runUntilIdle(sim);
  expect(stabber.pendingMelee).not.toBeNull();
  expect(stabber.finalDestination).not.toBe(stabber.gridNo);
  sim.drainEvents();
  return { sim, stabber, sighted, dying, shooter };
}

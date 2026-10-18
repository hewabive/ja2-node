import { beforeAll, describe, expect, it } from 'vitest';
import { newCombatSim, runUntilIdle, spawnSoldier } from '../../../../tests/support/combat.ts';
import { loadTestContent } from '../../../../tests/support/tactical.ts';
import { Direction, gridNo } from '../../../content/world/grid.ts';
import { Rng } from '../../../core/rng.ts';
import { emptyObject } from '../../items/object.ts';
import { AnimHeight, changeSoldierStance, setDesiredDirection, setSoldierDirection, states } from '../animation.ts';
import { calcTotalAPsToAttack } from '../combat/ap.ts';
import { calcChanceToStab } from '../combat/melee.ts';
import type { TacticalContent } from '../content.ts';
import { InvSlot } from '../inventory.ts';
import { Opp } from '../perception/opp.ts';
import { Team } from '../soldier.ts';
import { calcBestStab, calcSpreadBurst } from './attack-choice.ts';
import { plotPathCost } from './utils.ts';

let content: TacticalContent;

beforeAll(async () => {
  content = await loadTestContent();
});

function knifeFight(enemyAt: number, enemyHand: string | null) {
  const sim = newCombatSim(content);
  const merc = spawnSoldier(sim, 0, Team.OUR, gridNo(80, 80), Direction.SOUTH);
  const enemy = spawnSoldier(sim, 20, Team.ENEMY, enemyAt, Direction.NORTH, { gun: enemyHand ?? 'COMBAT_KNIFE' });
  if (enemyHand === null) enemy.inv[InvSlot.HAND] = emptyObject();
  sim.lookAround();
  sim.drainEvents();
  return { sim, t: sim.state, merc, enemy };
}

describe('calcBestStab', () => {
  it('finds an adjacent opponent for a knife without drawing random numbers', () => {
    const { t, merc, enemy } = knifeFight(gridNo(80, 81), 'COMBAT_KNIFE');
    expect(enemy.oppList[merc.id]).toBe(Opp.SEEN_CURRENTLY);
    const rngBefore = t.rng.state();
    const preBefore = t.pre.state();
    const stab = calcBestStab(t, enemy, true);
    expect(t.rng.state()).toEqual(rngBefore);
    expect(t.pre.state()).toEqual(preBefore);
    expect(stab).toMatchObject({ possible: true, opponent: merc, target: merc.gridNo, targetLevel: 0 });
    expect(stab.apCost).toBe(calcTotalAPsToAttack(t, enemy, merc.gridNo, true, 0) + stab.aimTime);
    expect(stab.chanceToReallyHit).toBe(calcChanceToStab(t, enemy, merc, stab.aimTime));
    expect(stab.attackValue).toBeGreaterThan(0);
  });

  it('prices a diagonal knife target without the walk to a side neighbour, as the original does', () => {
    const knife = knifeFight(gridNo(81, 81), 'COMBAT_KNIFE');
    const stab = calcBestStab(knife.t, knife.enemy, true);
    expect(stab).toMatchObject({ possible: true, target: knife.merc.gridNo });
    expect(knife.enemy.walkToAttackGridNo).toBe(knife.merc.gridNo);
    expect(knife.enemy.walkToAttackCost).toBe(0);
    const fists = knifeFight(gridNo(81, 81), null);
    const punch = calcBestStab(fists.t, fists.enemy, false);
    expect(punch).toMatchObject({ possible: true, target: fists.merc.gridNo });
    expect(punch.apCost).toBe(4 + punch.aimTime);
  });

  it('includes the running path to an opponent three tiles away', () => {
    const { t, merc, enemy } = knifeFight(gridNo(80, 84), 'COMBAT_KNIFE');
    const stab = calcBestStab(t, enemy, true);
    expect(stab).toMatchObject({ possible: true, target: merc.gridNo });
    expect(enemy.walkToAttackGridNo).toBe(merc.gridNo);
    expect(enemy.walkToAttackCost).toBe(plotPathCost(t, enemy, gridNo(80, 81), states(content.animations).RUNNING));
  });
});

describe('knife-armed enemy on his turn', () => {
  it('walks up to a merc three tiles away and stabs him on arrival', () => {
    const { sim, t, merc, enemy } = knifeFight(gridNo(80, 84), 'COMBAT_KNIFE');
    expect(sim.dispatch({ type: 'endTurn' }).ok).toBe(true);
    const events = runUntilIdle(sim);
    expect(events.some((e) => e.type === 'meleeStrike' && e.soldier === enemy.id && e.target === merc.gridNo)).toBe(true);
    expect(enemy.gridNo).toBe(gridNo(80, 81));
    expect(enemy.pendingMelee).toBeNull();
    expect(t.turn.attackBusyCount).toBe(0);
  });

  for (const getsUp of [false, true])
    for (const hand of ['COMBAT_KNIFE', null])
      it(`${getsUp ? 'gets up and' : 'lies prone and'} ${hand ? 'stabs' : 'punches'} a prone merc he must turn to`, () => {
        const { sim, t, merc, enemy } = knifeFight(gridNo(80, 81), hand);
        const st = states(content.animations);
        expect(sim.dispatch({ type: 'stance', soldier: merc.id, stance: 'prone' }).ok).toBe(true);
        changeSoldierStance(t, enemy, AnimHeight.PRONE);
        for (let tick = 0; tick < 2_000 && !(enemy.state === st.PRONE && merc.state === st.PRONE); tick++) sim.step();
        expect(enemy.state).toBe(st.PRONE);
        setSoldierDirection(t, enemy, Direction.EAST);
        setDesiredDirection(t, enemy, Direction.EAST);
        enemy.collapsed = getsUp;
        sim.drainEvents();
        expect(sim.dispatch({ type: 'endTurn' }).ok).toBe(true);
        const events = runUntilIdle(sim);
        expect(events.some((e) => e.type === 'meleeStrike' && e.soldier === enemy.id && e.target === merc.gridNo)).toBe(true);
        expect(t.turn.attackBusyCount).toBe(0);
        expect(t.turn.currentTeam).toBe(Team.OUR);
      });

  it('stabs the merc standing next to him', () => {
    const { sim, t, merc, enemy } = knifeFight(gridNo(80, 81), 'COMBAT_KNIFE');
    expect(t.inCombat).toBe(true);
    expect(sim.dispatch({ type: 'endTurn' }).ok).toBe(true);
    const events = runUntilIdle(sim);
    expect(events.some((e) => e.type === 'meleeStrike' && e.soldier === enemy.id && e.target === merc.gridNo && e.weapon === 'blade')).toBe(
      true,
    );
    expect(events.some((e) => e.type === 'shotFired')).toBe(false);
    expect(t.turn.attackBusyCount).toBe(0);
  });
});

describe('calcSpreadBurst', () => {
  it('spreads a burst over three opponents standing side by side with one Random(2) draw', () => {
    const sim = newCombatSim(content);
    const t = sim.state;
    const shooter = spawnSoldier(sim, 20, Team.ENEMY, gridNo(80, 80), Direction.SOUTH, { gun: 'MP5K' });
    const west = spawnSoldier(sim, 0, Team.OUR, gridNo(79, 90), Direction.NORTH);
    const centre = spawnSoldier(sim, 1, Team.OUR, gridNo(80, 90), Direction.NORTH);
    const east = spawnSoldier(sim, 2, Team.OUR, gridNo(81, 90), Direction.NORTH);
    for (const m of [west, centre, east]) shooter.oppList[m.id] = Opp.SEEN_CURRENTLY;
    const clone = Rng.fromState(t.rng.state());
    const reversed = clone.int(2) !== 0;
    expect(calcSpreadBurst(t, shooter, centre.gridNo, 0)).toBe(centre.gridNo);
    expect(t.rng.state()).toEqual(clone.state());
    expect(shooter.doSpread).toBe(1);
    const [e, c, w] = [east.gridNo, centre.gridNo, west.gridNo];
    expect(shooter.spreadLocations.slice(0, 5)).toEqual(reversed ? [w, w, c, c, e] : [e, e, c, c, w]);
  });

  it('leaves a lone target alone', () => {
    const sim = newCombatSim(content);
    const t = sim.state;
    const shooter = spawnSoldier(sim, 20, Team.ENEMY, gridNo(80, 80), Direction.SOUTH, { gun: 'MP5K' });
    const lone = spawnSoldier(sim, 0, Team.OUR, gridNo(80, 90), Direction.NORTH);
    shooter.oppList[lone.id] = Opp.SEEN_CURRENTLY;
    const rngBefore = t.rng.state();
    expect(calcSpreadBurst(t, shooter, lone.gridNo, 0)).toBe(lone.gridNo);
    expect(shooter.doSpread).toBe(0);
    expect(t.rng.state()).toEqual(rngBefore);
  });
});

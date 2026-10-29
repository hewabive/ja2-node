import { beforeAll, describe, expect, it } from 'vitest';
import { newCombatSim, spawnSoldier } from '../../../../tests/support/combat.ts';
import { loadTestContent } from '../../../../tests/support/tactical.ts';
import { Direction, gridNo } from '../../../content/world/grid.ts';
import { ScriptedStream } from '../../strategic/forces/autoresolve/replay-rng.ts';
import type { TacticalContent } from '../content.ts';
import { type Soldier, Team } from '../soldier.ts';
import type { TacticalSim } from '../tactical-sim.ts';
import { beginMercTurn, sayCloseCallQuotes } from '../turns/turns.ts';
import { handleSuppressionFire } from './barrier.ts';
import { soldierTakeDamage } from './hit.ts';
import { DamageReason } from './types.ts';

let content: TacticalContent;

beforeAll(async () => {
  content = await loadTestContent();
});

const UNDER_HEAVY_FIRE = 20;
const TAKEN_A_BEATING = 21;
const CLOSE_CALL = 22;

type Said = [soldier: number, quote: number, delayed: boolean];

function underFire(mainRolls: readonly number[] = []): { sim: TacticalSim; merc: Soldier; enemy: Soldier; said: Said[] } {
  const sim = newCombatSim(content);
  const merc = spawnSoldier(sim, 0, Team.OUR, gridNo(80, 80), Direction.SOUTH);
  const enemy = spawnSoldier(sim, 20, Team.ENEMY, gridNo(80, 90), Direction.NORTH);
  const said: Said[] = [];
  const t = sim.state;
  t.narrative = { ...t.narrative, sayQuote: (s, quote, delayed) => said.push([s.id, quote, delayed ?? false]) };
  Object.assign(t, { rng: new ScriptedStream(mainRolls, 1) });
  return { sim, merc, enemy, said };
}

describe('the close call quote (TeamTurns.cc SayCloseCallQuotes)', () => {
  it('lets a merc a bullet just missed say so on one roll in three, once a turn, and forgets the miss either way', () => {
    const { sim, merc, said } = underFire([0, 1]);
    merc.closeCall = true;
    sayCloseCallQuotes(sim.state);
    expect(said).toEqual([[merc.id, CLOSE_CALL, false]]);
    expect(merc.closeCall).toBe(false);
    merc.closeCall = true;
    sayCloseCallQuotes(sim.state);
    expect(said).toHaveLength(1);
    beginMercTurn(sim.state, merc);
    merc.closeCall = true;
    sayCloseCallQuotes(sim.state);
    expect(said).toHaveLength(1);
    expect(merc.closeCall).toBe(false);
  });

  it('keeps quiet for a merc who was hit this turn', () => {
    const { sim, merc, said } = underFire([0]);
    merc.closeCall = true;
    merc.numHitsThisTurn = 1;
    sayCloseCallQuotes(sim.state);
    expect(said).toEqual([]);
  });
});

describe('the heavy fire quote (Overhead.cc HandleSuppressionFire)', () => {
  it('lets the targeted merc say he is pinned down once his suppression passes 8, once a turn', () => {
    const { sim, merc, enemy, said } = underFire();
    sim.state.inCombat = true;
    merc.suppressionPoints = 9;
    handleSuppressionFire(sim.state, merc, enemy);
    expect(said).toEqual([[merc.id, UNDER_HEAVY_FIRE, false]]);
    expect(merc.pummeledQuoteSaid).toBe(true);
    merc.suppressionPoints = 20;
    handleSuppressionFire(sim.state, merc, enemy);
    expect(said).toHaveLength(1);
  });

  it('keeps quiet for a merc who was not the target', () => {
    const { sim, merc, enemy, said } = underFire();
    sim.state.inCombat = true;
    merc.suppressionPoints = 9;
    handleSuppressionFire(sim.state, null, enemy);
    expect(said).toEqual([]);
  });
});

describe('the beating quote (Soldier_Control.cc SoldierTakeDamage)', () => {
  it('counts the hits of a turn until the merc complains, after a delay, on 40 per hit beyond the second', () => {
    const { sim, merc, enemy, said } = underFire([30]);
    merc.oldLife = merc.life - 30;
    for (let hit = 0; hit < 3; hit++) soldierTakeDamage(sim.state, merc, 0, 0, DamageReason.GUNFIRE, enemy);
    expect(said).toEqual([[merc.id, TAKEN_A_BEATING, true]]);
    expect(merc.pummeledQuoteSaid).toBe(true);
    expect(merc.numHitsThisTurn).toBe(0);
    soldierTakeDamage(sim.state, merc, 0, 0, DamageReason.GUNFIRE, enemy);
    expect(merc.numHitsThisTurn).toBe(0);
  });

  it('never comes from hits alone: the original asks for a life gain of more than 20 since the turn began', () => {
    const { sim, merc, enemy, said } = underFire();
    const rng = new ScriptedStream([], 1);
    Object.assign(sim.state, { rng });
    const hits = 5;
    for (let hit = 0; hit < hits; hit++) soldierTakeDamage(sim.state, merc, 5, 0, DamageReason.GUNFIRE, enemy);
    expect(said).toEqual([]);
    expect(merc.numHitsThisTurn).toBe(hits);
    const weaponDropRolls = rng.requested.filter((range) => range === 100);
    expect(weaponDropRolls).toHaveLength(hits);
  });
});

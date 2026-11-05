import { beforeAll, describe, expect, it } from 'vitest';
import { newCombatSim, spawnSoldier } from '../../../../tests/support/combat.ts';
import { itemId } from '../../../../tests/support/explosives.ts';
import { loadTestContent } from '../../../../tests/support/tactical.ts';
import { SmokeEffectId } from '../../../content/items/explosions.ts';
import { Direction, gridNo } from '../../../content/world/grid.ts';
import { ScriptedStream } from '../../strategic/forces/autoresolve/replay-rng.ts';
import { CompressMode } from '../../strategic/time/constants.ts';
import type { TacticalContent } from '../content.ts';
import { newSmokeEffect, smokeEffectOnTile } from '../explosions/smoke.ts';
import { MercQuote } from '../narrative/merc-quotes.ts';
import { removeSoldierFromTacticalSector } from '../sector-presence.ts';
import { Body, NOWHERE, Personality, type Soldier, Team } from '../soldier.ts';
import { createRealtimeClock, type TacticalState } from '../state.ts';
import type { TacticalSim } from '../tactical-sim.ts';
import { beginTeamTurn, enterCombatMode, handleTacticalEndTurn } from './turns.ts';

let content: TacticalContent;

beforeAll(async () => {
  content = await loadTestContent();
});

const NOW = 100_000;
const MINE_LEVEL = { x: 13, y: 9, z: 1 };
const NO_CLAUSTROPHOBIA_STRIKE = 1;
const CLAUSTROPHOBIA_DIE = 5;
const WOUNDED = { lifeMax: 80, life: 60, bleeding: 20 };

function sector(): TacticalSim {
  const sim = newCombatSim(content);
  sim.state.inCombat = false;
  sim.state.worldClock = { seconds: NOW, paused: false, mode: CompressMode.X1 };
  return sim;
}

function offTheMap(t: TacticalState, s: Soldier): Soldier {
  removeSoldierFromTacticalSector(t, s);
  return s;
}

function listOurTeam(t: TacticalState, team: readonly Soldier[]): void {
  t.sectorHooks = { ...t.sectorHooks, ourWholeTeam: () => team };
}

function perTurnCounters(s: Soldier): number[] {
  return [s.actionPoints, s.numHitsThisTurn];
}

function spent(...team: Soldier[]): void {
  for (const s of team) Object.assign(s, { actionPoints: 0, numHitsThisTurn: 3 });
}

describe('our whole team at the turn starts (Tactical_Turns.cc HandleTacticalEndTurn, TeamTurns.cc BeginTeamTurn: FOR_EACH_IN_TEAM(OUR_TEAM))', () => {
  it('starts the real-time turn of every merc of ours in id order, off the map or not, and only those on the map draw', () => {
    const sim = sector();
    const t = sim.state;
    t.sector = MINE_LEVEL;
    const [first, absent, last] = [0, 1, 2].map((id) =>
      spawnSoldier(sim, id, Team.OUR, gridNo(60 + 2 * id, 60), Direction.NORTH, { profile: id + 1 }),
    ) as [Soldier, Soldier, Soldier];
    for (const s of [first, absent, last]) s.personalityTrait = Personality.CLAUSTROPHOBIC;
    Object.assign(offTheMap(t, absent), { ...WOUNDED, nextBleed: 0.5 });
    listOurTeam(t, [first, absent, last]);
    const main = new ScriptedStream([], NO_CLAUSTROPHOBIA_STRIKE);
    const pre = new ScriptedStream([]);
    Object.assign(t, { rng: main, pre });
    const lines: string[] = [];
    t.narrative = {
      ...t.narrative,
      sayQuote: (s, quote) => {
        if (quote === MercQuote.STARTING_TO_BLEED) lines.push(`${s.id} after ${main.requested.length} draws`);
      },
    };
    handleTacticalEndTurn(t, createRealtimeClock());
    expect(lines).toEqual(['1 after 1 draws']);
    expect(main.requested).toEqual([CLAUSTROPHOBIA_DIE, CLAUSTROPHOBIA_DIE]);
    expect(pre.requested).toEqual([]);
    expect(absent.life).toBe(WOUNDED.life - 1);
  });

  it('bleeds a merc of ours off the map a whole step at each of our turns in combat, half a step in real time (quirk)', () => {
    const bleedingAfter = (turn: (t: TacticalState) => void) => {
      const sim = sector();
      const t = sim.state;
      const here = spawnSoldier(sim, 0, Team.OUR, gridNo(60, 60), Direction.NORTH);
      const away = offTheMap(t, spawnSoldier(sim, 1, Team.OUR, gridNo(62, 60), Direction.NORTH));
      spawnSoldier(sim, 20, Team.ENEMY, gridNo(60, 120), Direction.SOUTH);
      Object.assign(away, { ...WOUNDED, nextBleed: 1 });
      listOurTeam(t, [here, away]);
      turn(t);
      return [away.life, away.nextBleed > 0];
    };
    expect(
      bleedingAfter((t) => {
        t.inCombat = true;
        beginTeamTurn(t, Team.OUR);
      }),
    ).toEqual([WOUNDED.life - 1, true]);
    expect(bleedingAfter((t) => handleTacticalEndTurn(t, createRealtimeClock()))).toEqual([WOUNDED.life, true]);
  });

  it('skips the robot and our vehicles in the real-time turn, off the map too, but starts their turns in combat (quirk)', () => {
    const team = (t: TacticalState, sim: TacticalSim) => {
      const merc = spawnSoldier(sim, 0, Team.OUR, gridNo(60, 60), Direction.NORTH);
      const robot = offTheMap(t, spawnSoldier(sim, 1, Team.OUR, gridNo(62, 60), Direction.NORTH, { body: Body.ROBOTNOWEAPON }));
      const jeep = spawnSoldier(sim, 2, Team.OUR, gridNo(66, 60), Direction.NORTH, { body: Body.JEEP });
      spawnSoldier(sim, 20, Team.ENEMY, gridNo(60, 120), Direction.SOUTH);
      spent(merc, robot, jeep);
      listOurTeam(t, [merc, robot, jeep]);
      return [robot, jeep];
    };
    const realTime = sector();
    const [robotRealTime, jeepRealTime] = team(realTime.state, realTime) as [Soldier, Soldier];
    handleTacticalEndTurn(realTime.state, createRealtimeClock());
    expect([perTurnCounters(robotRealTime), perTurnCounters(jeepRealTime)]).toEqual([
      [0, 3],
      [0, 3],
    ]);
    const combat = sector();
    const [robotInCombat, jeepInCombat] = team(combat.state, combat) as [Soldier, Soldier];
    combat.state.inCombat = true;
    beginTeamTurn(combat.state, Team.OUR);
    for (const s of [robotInCombat, jeepInCombat]) expect([s.actionPoints > 0, s.numHitsThisTurn]).toEqual([true, 0]);
  });

  it('stamps the real-time turn when combat starts (CommonEnterCombatModeCode, SyncStrategicTurnTimes)', () => {
    const sim = sector();
    const t = sim.state;
    spawnSoldier(sim, 0, Team.OUR, gridNo(60, 60), Direction.NORTH);
    spawnSoldier(sim, 20, Team.ENEMY, gridNo(60, 120), Direction.SOUTH);
    t.clockMs = 12_345;
    t.realtimeClock.lastTurnMs = 0;
    enterCombatMode(t, Team.OUR);
    expect([t.inCombat, t.realtimeClock.lastTurnMs]).toEqual([true, 12_345]);
  });
});

describe('a merc of ours taken out of the loaded sector (Overhead.cc RemoveSoldierFromTacticalSector)', () => {
  it('stands nowhere (RemoveSoldierFromGridNo)', () => {
    const sim = sector();
    const s = offTheMap(sim.state, spawnSoldier(sim, 0, Team.OUR, gridNo(60, 60), Direction.NORTH));
    expect([s.placed, s.gridNo]).toEqual([false, NOWHERE]);
  });

  it('loses the gassed flag at his next turn start, a cloud on the loaded map at the tile he left included: his gas test reads the loaded map where he stands, nowhere (quirk)', () => {
    const sim = sector();
    const t = sim.state;
    const left = gridNo(62, 60);
    const here = spawnSoldier(sim, 0, Team.OUR, gridNo(60, 60), Direction.NORTH);
    const away = offTheMap(t, spawnSoldier(sim, 1, Team.OUR, left, Direction.NORTH));
    away.gassed = true;
    newSmokeEffect(t, left, itemId(t, 'SMOKE_GRENADE'), 0, null);
    expect(smokeEffectOnTile(t, left, 0)).not.toBe(SmokeEffectId.NOTHING);
    listOurTeam(t, [here, away]);
    handleTacticalEndTurn(t, createRealtimeClock());
    expect(away.gassed).toBe(false);
  });
});

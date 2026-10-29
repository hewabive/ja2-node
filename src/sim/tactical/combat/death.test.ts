import { beforeAll, describe, expect, it } from 'vitest';
import { newCombatSim, spawnSoldier } from '../../../../tests/support/combat.ts';
import { loadTestContent } from '../../../../tests/support/tactical.ts';
import { Direction, gridNo } from '../../../content/world/grid.ts';
import { anim, animName } from '../anim-states.ts';
import type { TacticalContent } from '../content.ts';
import { Body, TEAM_FIRST_ID, Team } from '../soldier.ts';
import { deathOpcode, handleSoldierDeath } from './death.ts';

let content: TacticalContent;

beforeAll(async () => {
  content = await loadTestContent();
});

const DEATH_OR_RELEASE = 497;

describe('kill records (Overhead.cc HandleNPCTeamMemberDeath, Soldier_Ani.cc HandleSoldierDeath)', () => {
  it('counts a militia kill three times: once where the enemy dies and twice more where the kill is credited', () => {
    const sim = newCombatSim(content);
    const militia = spawnSoldier(sim, TEAM_FIRST_ID[Team.MILITIA], Team.MILITIA, gridNo(80, 80), Direction.SOUTH);
    const enemy = spawnSoldier(sim, TEAM_FIRST_ID[Team.ENEMY], Team.ENEMY, gridNo(80, 85), Direction.NORTH);
    enemy.attacker = militia;
    enemy.life = 0;
    handleSoldierDeath(sim.state, enemy);
    expect(militia.militiaKills).toBe(3);
  });

  it('begins the creature queen’s death only when somebody killed her', () => {
    function queenDies(killedByMerc: boolean): (number | null)[] {
      const sim = newCombatSim(content);
      const begun: (number | null)[] = [];
      sim.state.narrative = { ...sim.state.narrative, creatureQueenDied: (killer) => begun.push(killer?.id ?? null) };
      const merc = spawnSoldier(sim, 0, Team.OUR, gridNo(80, 80), Direction.SOUTH);
      const queen = spawnSoldier(sim, TEAM_FIRST_ID[Team.CREATURE], Team.CREATURE, gridNo(80, 85), Direction.NORTH);
      queen.bodyType = Body.QUEENMONSTER;
      queen.attacker = killedByMerc ? merc : null;
      queen.life = 0;
      handleSoldierDeath(sim.state, queen);
      return begun;
    }
    expect(queenDies(true)).toEqual([0]);
    expect(queenDies(false)).toEqual([]);
  });
});

describe('going down unconscious (Soldier_Ani.cc HandleCheckForDeathCommonCode)', () => {
  function knockedOutOnTurnOf(team: number) {
    const sim = newCombatSim(content);
    const t = sim.state;
    const s = spawnSoldier(sim, 0, Team.OUR, gridNo(80, 80), Direction.SOUTH, { life: 10 });
    t.inCombat = true;
    t.turn.currentTeam = team;
    s.state = anim(t.content, 'FALLFORWARD_FROMHIT_STAND');
    deathOpcode(t, s, DEATH_OR_RELEASE);
    return { s, pose: animName(t.content, s.state) };
  }

  it('counts two turns down on his own turn, as the original runs its getting-up check twice, and none on another team’s turn', () => {
    const own = knockedOutOnTurnOf(Team.OUR);
    expect(own.s.collapsed).toBe(true);
    expect(own.s.collapsedTurns).toBe(2);
    expect(own.pose).toBe('STAND_FALLFORWARD_STOP');
    const other = knockedOutOnTurnOf(Team.ENEMY);
    expect(other.s.collapsed).toBe(true);
    expect(other.s.collapsedTurns).toBe(0);
    expect(other.pose).toBe('STAND_FALLFORWARD_STOP');
  });
});

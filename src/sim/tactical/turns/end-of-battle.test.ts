import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { progressFor } from '../../../../tests/support/autoresolve.ts';
import { newCombatSim, runUntilIdle, spawnSoldier } from '../../../../tests/support/combat.ts';
import { loadTestContent } from '../../../../tests/support/tactical.ts';
import { parseStubProfiles, STUB_PROFILES_PATH } from '../../../content/formats/stub-profiles.ts';
import { Direction, gridNo } from '../../../content/world/grid.ts';
import { handleSoldierDeath } from '../combat/death.ts';
import { soldierTakeDamage } from '../combat/hit.ts';
import { DamageReason } from '../combat/types.ts';
import type { TacticalContent } from '../content.ts';
import { Profile } from '../narrative/constants.ts';
import { removeSoldierFromTacticalSector } from '../sector-presence.ts';
import { Body, OKLIFE, type Soldier, Team } from '../soldier.ts';
import { ourTeamInSectorWithTheDead, type TacticalState } from '../state.ts';
import type { TacticalSim } from '../tactical-sim.ts';
import { checkForEndOfBattle, checkForLosingEndOfBattle, numCapableEnemyInSector, numEnemyInSector } from './turns.ts';

let content: TacticalContent;

beforeAll(async () => {
  content = await loadTestContent();
});

describe('the end of a battle in real time', () => {
  it('clears the enemy presence when the last enemy bleeds to death', () => {
    const sim = newCombatSim(content);
    const t = sim.state;
    spawnSoldier(sim, 0, Team.OUR, gridNo(60, 60), Direction.NORTH);
    const enemy = spawnSoldier(sim, 20, Team.ENEMY, gridNo(110, 110), Direction.SOUTH, { life: 3 });
    t.turn.enemyInSector = true;
    expect(t.inCombat).toBe(false);
    expect(numCapableEnemyInSector(t)).toBe(0);
    soldierTakeDamage(t, enemy, enemy.life, 0, DamageReason.BLOODLOSS, null);
    expect(enemy.life).toBe(0);
    const events = [...sim.drainEvents(), ...runUntilIdle(sim)];
    expect(enemy.dead).toBe(true);
    expect(events).toContainEqual(expect.objectContaining({ type: 'combatEnded', reason: 'won' }));
    expect(t.turn.enemyInSector).toBe(false);
  });

  it('does not count a dying soldier whose death is already handled as capable', () => {
    const sim = newCombatSim(content);
    const t = sim.state;
    const enemy = spawnSoldier(sim, 20, Team.ENEMY, gridNo(110, 110), Direction.SOUTH);
    expect(numCapableEnemyInSector(t)).toBe(1);
    enemy.life = 0;
    expect(numCapableEnemyInSector(t)).toBe(1);
    enemy.dead = true;
    expect(numCapableEnemyInSector(t)).toBe(0);
  });
});

const MERC_AT = gridNo(60, 60);
const OTHER_MERC_AT = gridNo(62, 60);
const ENEMY_AT = gridNo(110, 110);
const DOWNED_LIFE = OKLIFE - 1;

function battle(): { sim: TacticalSim; t: TacticalState; merc: Soldier } {
  const sim = newCombatSim(content);
  const t = sim.state;
  const merc = spawnSoldier(sim, 0, Team.OUR, MERC_AT, Direction.NORTH);
  spawnSoldier(sim, 20, Team.ENEMY, ENEMY_AT, Direction.SOUTH);
  t.turn.enemyInSector = true;
  return { sim, t, merc };
}

function killOutright(t: TacticalState, s: Soldier): void {
  soldierTakeDamage(t, s, s.life, 0, DamageReason.GUNFIRE, null);
  handleSoldierDeath(t, s);
}

function robotContent(): TacticalContent {
  const json = JSON.parse(readFileSync(join(import.meta.dirname, '../../../..', STUB_PROFILES_PATH), 'utf8'));
  const profiles = parseStubProfiles(json, (name) => content.items.byName.get(name)?.index);
  const record = profiles.find((p) => p !== undefined);
  if (!record) throw new Error('no stub profile');
  profiles[Profile.ROBOT] = { ...record, bodyType: Body.ROBOTNOWEAPON };
  return { ...content, profiles };
}

function robotInSector(): { t: TacticalState; robot: Soldier } {
  const sim = newCombatSim(robotContent());
  const robot = spawnSoldier(sim, 0, Team.OUR, MERC_AT, Direction.NORTH, { profile: Profile.ROBOT, body: Body.ROBOTNOWEAPON });
  spawnSoldier(sim, 20, Team.ENEMY, ENEMY_AT, Direction.SOUTH);
  return { t: sim.state, robot };
}

describe('the count of a lost battle (CheckForLosingEndOfBattle, Overhead.cc:4950)', () => {
  it('keeps a merc killed outright in the sector, off the map, until he leaves it (TurnSoldierIntoCorpse, Rotting_Corpses.cc:737)', () => {
    const { t, merc } = battle();
    killOutright(t, merc);
    expect(merc.placed).toBe(false);
    expect(ourTeamInSectorWithTheDead(t)).toEqual([merc]);
    removeSoldierFromTacticalSector(t, merc);
    expect(ourTeamInSectorWithTheDead(t)).toEqual([]);
  });

  it('loses the battle when the last merc is killed outright', () => {
    const { t, merc } = battle();
    killOutright(t, merc);
    expect(checkForEndOfBattle(t)).toBe(true);
    expect(t.turn.enemyInSector).toBe(false);
  });

  it('runs no killing or capture when every merc in the sector is dead (bNumDead == bNumInBattle)', () => {
    const { t, merc } = battle();
    let lost = 0;
    t.sectorHooks = { ...t.sectorHooks, battleLost: () => lost++ };
    killOutright(t, merc);
    expect(checkForLosingEndOfBattle(t)).toBe(true);
    expect(lost).toBe(0);
  });

  it('runs the killing or capture for the one still down beside the one killed', () => {
    const { sim, t, merc } = battle();
    spawnSoldier(sim, 1, Team.OUR, OTHER_MERC_AT, Direction.NORTH, { life: DOWNED_LIFE });
    let lost = 0;
    t.sectorHooks = { ...t.sectorHooks, battleLost: () => lost++ };
    killOutright(t, merc);
    expect(checkForLosingEndOfBattle(t)).toBe(true);
    expect(lost).toBe(1);
  });

  it('fights on while one merc still stands beside the dead', () => {
    const { sim, t, merc } = battle();
    spawnSoldier(sim, 1, Team.OUR, OTHER_MERC_AT, Direction.NORTH);
    killOutright(t, merc);
    expect(checkForLosingEndOfBattle(t)).toBe(false);
  });

  it('asks the militia to finish the battle when a killed merc leaves them fighting', () => {
    const { sim, t, merc } = battle();
    spawnSoldier(sim, 84, Team.MILITIA, OTHER_MERC_AT, Direction.NORTH);
    let handedOver = 0;
    t.sectorHooks = {
      ...t.sectorHooks,
      militiaFinishBattle: () => {
        handedOver++;
        return true;
      },
    };
    killOutright(t, merc);
    expect(checkForLosingEndOfBattle(t)).toBe(false);
    expect(handedOver).toBe(1);
  });

  it('counts a sector with nobody of ours in it as lost: none down out of none in battle', () => {
    const sim = newCombatSim(content);
    const t = sim.state;
    spawnSoldier(sim, 20, Team.ENEMY, ENEMY_AT, Direction.SOUTH);
    t.turn.enemyInSector = true;
    expect(checkForEndOfBattle(t)).toBe(true);
    expect(sim.drainEvents()).toContainEqual(expect.objectContaining({ type: 'combatEnded', reason: 'lost' }));
  });

  it('leaves the vehicles out of the count', () => {
    const { sim, t, merc } = battle();
    spawnSoldier(sim, 1, Team.OUR, OTHER_MERC_AT, Direction.NORTH, { body: Body.HUMVEE });
    killOutright(t, merc);
    expect(checkForLosingEndOfBattle(t)).toBe(true);
  });

  it("does not let the robot, an EPC by recruitment, hold the battle alone (fOnlyEPCsLeft's quirk)", () => {
    const { t, robot } = robotInSector();
    t.narrative = { ...t.narrative, isEpc: (s) => s === robot };
    expect(robot.life).toBeGreaterThanOrEqual(OKLIFE);
    expect(checkForLosingEndOfBattle(t)).toBe(true);
  });

  it('lets a robot that is no EPC hold the battle', () => {
    const { t } = robotInSector();
    expect(checkForLosingEndOfBattle(t)).toBe(false);
  });

  it("lets a standing EPC who is no robot hold the battle (fOnlyEPCsLeft's quirk: its test is !robot || !EPC)", () => {
    const { t, merc } = battle();
    t.narrative = { ...t.narrative, isEpc: (s) => s === merc };
    expect(checkForLosingEndOfBattle(t)).toBe(false);
  });
});

describe('the battles a merc fought (CheckForEndOfBattle, Overhead.cc:4557)', () => {
  it('counts the battle for a merc who died in it, and not for one who left the sector', () => {
    const sim = newCombatSim(content);
    const t = sim.state;
    const killed = spawnSoldier(sim, 0, Team.OUR, MERC_AT, Direction.NORTH, { profile: 1 });
    const standing = spawnSoldier(sim, 1, Team.OUR, OTHER_MERC_AT, Direction.NORTH, { profile: 2 });
    const left = spawnSoldier(sim, 2, Team.OUR, gridNo(64, 60), Direction.NORTH, { profile: 3 });
    for (const s of [killed, standing, left]) t.profiles.set(s.profile, progressFor(s.profile));
    t.turn.enemyInSector = true;
    t.turn.numFoughtInBattle[Team.ENEMY] = 1;
    killOutright(t, killed);
    removeSoldierFromTacticalSector(t, left);
    expect(checkForEndOfBattle(t)).toBe(true);
    expect([killed, standing, left].map((s) => t.profiles.get(s.profile)?.battlesFought)).toEqual([1, 1, 0]);
  });
});

describe('the enemies in the sector (Overhead.cc NumEnemyInSector)', () => {
  it('counts every living, non-neutral, non-friendly soldier in the sector, the unconscious and the unseen included', () => {
    const sim = newCombatSim(content);
    const t = sim.state;
    spawnSoldier(sim, 0, Team.OUR, gridNo(60, 60), Direction.NORTH);
    spawnSoldier(sim, 84, Team.MILITIA, gridNo(62, 60), Direction.NORTH);
    const civilian = spawnSoldier(sim, 116, Team.CIV, gridNo(64, 60), Direction.NORTH);
    const unconscious = spawnSoldier(sim, 20, Team.ENEMY, gridNo(110, 110), Direction.SOUTH, { life: 5 });
    expect([numEnemyInSector(t), numCapableEnemyInSector(t)]).toEqual([1, 0]);
    civilian.neutral = false;
    expect(numEnemyInSector(t)).toBe(2);
    unconscious.life = 0;
    expect(numEnemyInSector(t)).toBe(1);
    civilian.placed = false;
    expect(numEnemyInSector(t)).toBe(0);
  });
});

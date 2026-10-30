import { beforeAll, describe, expect, it } from 'vitest';
import { newCombatSim, runUntilIdle, spawnSoldier } from '../../../../tests/support/combat.ts';
import { loadTestContent } from '../../../../tests/support/tactical.ts';
import { Direction, gridNo } from '../../../content/world/grid.ts';
import { eventSoldierGotHit } from '../combat/hit.ts';
import { AimShot } from '../combat/types.ts';
import type { TacticalContent } from '../content.ts';
import { Body, type Soldier, TEAM_FIRST_ID, Team } from '../soldier.ts';
import type { SectorRef } from '../state.ts';
import type { TacticalSim } from '../tactical-sim.ts';
import { beginMercTurn } from '../turns/turns.ts';
import { makeNoise, NoiseKind, squadHears } from './noise.ts';
import { Opp } from './opp.ts';

let content: TacticalContent;

beforeAll(async () => {
  content = await loadTestContent();
});

const UNSEEN = -1;
const HEARD_SOMETHING = 6;
const BLOODCAT_ARENA = { x: 5, y: 14, z: 0 };
const BESIDE_THE_ARENA = { x: 4, y: 14, z: 0 };

function squadAndStranger(
  strangerAt = gridNo(80, 70),
  walls: readonly number[] = [],
): { sim: TacticalSim; merc: Soldier; stranger: Soldier } {
  const sim = newCombatSim(content, walls);
  const merc = spawnSoldier(sim, 0, Team.OUR, gridNo(80, 80), Direction.NORTH);
  const stranger = spawnSoldier(sim, 20, Team.ENEMY, strangerAt, Direction.SOUTH);
  stranger.visible = UNSEEN;
  sim.state.events.length = 0;
  return { sim, merc, stranger };
}

const ofType = <E extends { readonly type: string }, T extends E['type']>(events: readonly E[], type: T) =>
  events.filter((e): e is Extract<E, { type: T }> => e.type === type);

describe('what the squad hears (OppList.cc ProcessNoise, CalcEffVolume)', () => {
  it('names the merc who hears a sound loudest, the side it comes from and how loud, and nothing beyond earshot', () => {
    const { sim, merc } = squadAndStranger();
    const near = squadHears(sim.state, gridNo(80, 72), 0, 20, NoiseKind.GUNFIRE);
    expect(near).toMatchObject({ by: merc.id, direction: Direction.NORTH });
    const far = squadHears(sim.state, gridNo(80, 40), 0, 20, NoiseKind.GUNFIRE);
    expect(far?.volumeClass ?? -1).toBeLessThan(near?.volumeClass ?? 0);
    expect(squadHears(sim.state, gridNo(80, 20), 0, 5, NoiseKind.GUNFIRE)).toBeNull();
    expect(squadHears(sim.state, gridNo(80, 72), 1, 20, NoiseKind.MOVEMENT)).toMatchObject({ direction: 'above' });
    expect(squadHears(sim.state, gridNo(80, 72), 1, 20, NoiseKind.ROCK_IMPACT)).toMatchObject({ direction: Direction.NORTH });
  });
});

describe('who listens to a noise (OppList.cc ProcessNoise)', () => {
  it('keeps the army and the creatures deaf to each other in the bloodcat arena of N5', () => {
    const heard = (sector: SectorRef) => {
      const wall = Array.from({ length: 21 }, (_, k) => gridNo(70 + k, 75));
      const sim = newCombatSim(content, wall);
      const t = sim.state;
      t.sector = sector;
      const soldier = spawnSoldier(sim, TEAM_FIRST_ID[Team.ENEMY], Team.ENEMY, gridNo(80, 80), Direction.NORTH);
      const cat = spawnSoldier(sim, TEAM_FIRST_ID[Team.CREATURE], Team.CREATURE, gridNo(80, 70), Direction.SOUTH);
      cat.bodyType = Body.BLOODCAT;
      makeNoise(t, cat, cat.gridNo, 0, 20, NoiseKind.MOVEMENT);
      makeNoise(t, soldier, soldier.gridNo, 0, 20, NoiseKind.MOVEMENT);
      return [soldier.oppList[cat.id], cat.oppList[soldier.id]];
    };
    expect(heard(BLOODCAT_ARENA)).toEqual([Opp.NOT_HEARD_OR_SEEN, Opp.NOT_HEARD_OR_SEEN]);
    expect(heard(BESIDE_THE_ARENA)).toEqual([Opp.HEARD_THIS_TURN, Opp.HEARD_THIS_TURN]);
  });
});

describe('telling the player about a noise (OppList.cc ProcessNoise, TellPlayerAboutNoise)', () => {
  it('tells during the enemy turn of a battle, never during ours', () => {
    const { sim, stranger } = squadAndStranger();
    const t = sim.state;
    t.inCombat = true;
    t.turn.currentTeam = Team.ENEMY;
    makeNoise(t, stranger, stranger.gridNo, 0, 10, NoiseKind.MOVEMENT);
    expect(ofType(t.events, 'noiseHeard')).toHaveLength(1);
    t.events.length = 0;
    t.turn.currentTeam = Team.OUR;
    makeNoise(t, stranger, stranger.gridNo, 0, 10, NoiseKind.SPLASHING);
    expect(ofType(t.events, 'noiseHeard')).toEqual([]);
  });

  it('marks a footstep as reported on the loudest listener under the bearing of the last listener', () => {
    const sim = newCombatSim(content);
    const near = spawnSoldier(sim, 0, Team.OUR, gridNo(80, 75), Direction.NORTH);
    const farEast = spawnSoldier(sim, 1, Team.OUR, gridNo(90, 70), Direction.WEST);
    const stranger = spawnSoldier(sim, 20, Team.ENEMY, gridNo(80, 70), Direction.SOUTH);
    const t = sim.state;
    t.events.length = 0;
    t.inCombat = true;
    t.turn.currentTeam = Team.ENEMY;
    makeNoise(t, stranger, stranger.gridNo, 0, 15, NoiseKind.MOVEMENT);
    expect(ofType(t.events, 'noiseHeard')).toMatchObject([{ listener: near.id, direction: Direction.NORTH }]);
    expect([near.movementNoiseHeard, farEast.movementNoiseHeard]).toEqual([1 << Direction.WEST, 0]);
  });

  it('keeps quiet about an explosion within sight of the squad', () => {
    const { sim } = squadAndStranger();
    const t = sim.state;
    makeNoise(t, null, gridNo(80, 70), 0, 40, NoiseKind.EXPLOSION);
    expect(ofType(t.events, 'noiseHeard')).toEqual([]);
    makeNoise(t, null, gridNo(80, 60), 0, 40, NoiseKind.EXPLOSION);
    expect(ofType(t.events, 'noiseHeard')).toHaveLength(1);
  });

  it('lets the squad hear the scream of a soldier dying out of sight until his death animation ends', () => {
    const wall = Array.from({ length: 21 }, (_, k) => gridNo(70 + k, 75));
    const { sim, merc, stranger } = squadAndStranger(gridNo(80, 70), wall);
    const t = sim.state;
    stranger.life = 0;
    makeNoise(t, stranger, stranger.gridNo, 0, 20, NoiseKind.SCREAM);
    expect(merc.oppList[stranger.id]).toBe(Opp.HEARD_THIS_TURN);
    merc.oppList[stranger.id] = Opp.NOT_HEARD_OR_SEEN;
    stranger.dead = true;
    makeNoise(t, stranger, stranger.gridNo, 0, 20, NoiseKind.SCREAM);
    expect(merc.oppList[stranger.id]).toBe(Opp.NOT_HEARD_OR_SEEN);
  });

  it('lets the merc say he heard something faint, then not again for a few turns', () => {
    const { sim, merc, stranger } = squadAndStranger(gridNo(80, 66));
    const t = sim.state;
    const said: number[] = [];
    t.narrative = { ...t.narrative, sayQuote: (_s, quote) => said.push(quote) };
    makeNoise(t, stranger, stranger.gridNo, 0, 14, NoiseKind.MOVEMENT);
    expect(ofType(t.events, 'noiseHeard')).toMatchObject([{ volumeClass: 0 }]);
    expect(said).toEqual([HEARD_SOMETHING]);
    const pause = t.inCombat ? 2 : 5;
    expect(merc.turnsUntilCanSayHeardNoise).toBe(pause);
    makeNoise(t, stranger, stranger.gridNo, 0, 14, NoiseKind.SPLASHING);
    expect(said).toEqual([HEARD_SOMETHING]);
    beginMercTurn(t, merc);
    expect(merc.turnsUntilCanSayHeardNoise).toBe(pause - 1);
  });
});

describe('the sounds of a soldier out of sight', () => {
  it('give his shot the side and loudness the squad hears it from instead of his target and chances', () => {
    const sim = newCombatSim(content);
    const merc = spawnSoldier(sim, 0, Team.OUR, gridNo(80, 80), Direction.SOUTH);
    const shooter = spawnSoldier(sim, 20, Team.ENEMY, gridNo(80, 86), Direction.NORTH);
    sim.lookAround();
    expect(sim.state.inCombat).toBe(true);
    shooter.visible = UNSEEN;
    sim.drainEvents();
    expect(sim.dispatch({ type: 'endTurn' }).ok).toBe(true);
    const [shot] = ofType(runUntilIdle(sim), 'shotFired').filter((e) => e.soldier === shooter.id);
    expect(shot).toMatchObject({ heard: { by: merc.id, direction: Direction.SOUTH } });
    expect(shot).not.toHaveProperty('target');
    expect(shot).not.toHaveProperty('chance');
    expect(shot).not.toHaveProperty('hit');
  });

  it('give his hit and cry the side the squad hears them from, not his tile, when his attacker is out of sight too', () => {
    const { sim, merc, stranger } = squadAndStranger(gridNo(80, 78));
    const attacker = spawnSoldier(sim, 21, Team.CIV, gridNo(81, 78), Direction.WEST);
    attacker.visible = UNSEEN;
    sim.state.events.length = 0;
    eventSoldierGotHit(sim.state, stranger, 0, 60, 0, stranger.direction, 0, attacker, 0, AimShot.TORSO);
    const [hit] = ofType(sim.state.events, 'soldierHit');
    expect(hit).toMatchObject({ soldier: stranger.id, heard: { by: merc.id, direction: Direction.NORTH } });
    expect(hit).not.toHaveProperty('gridNo');
    expect(hit).not.toHaveProperty('life');
  });
});

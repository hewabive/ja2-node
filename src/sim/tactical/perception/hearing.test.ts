import { beforeAll, describe, expect, it } from 'vitest';
import { newCombatSim, runUntilIdle, spawnSoldier } from '../../../../tests/support/combat.ts';
import { loadTestContent } from '../../../../tests/support/tactical.ts';
import { Orientation } from '../../../content/formats/jsd.ts';
import { NOTHING } from '../../../content/items/items.ts';
import { Direction, gridNo } from '../../../content/world/grid.ts';
import { StructureFlags } from '../../../content/world/structures.ts';
import { syntheticStructure } from '../../../content/world/synthetic.ts';
import { Terrain } from '../../../content/world/terrain.ts';
import { createItem, emptyObject } from '../../items/object.ts';
import { Assignment } from '../../strategic/economy/constants.ts';
import { eventSoldierGotHit } from '../combat/hit.ts';
import { AimShot } from '../combat/types.ts';
import type { TacticalContent } from '../content.ts';
import { InvSlot } from '../inventory.ts';
import { lightSetBaseLevel, NORMAL_LIGHTLEVEL_NIGHT } from '../lighting/lighting.ts';
import { Profile } from '../narrative/constants.ts';
import { MercQuote } from '../narrative/merc-quotes.ts';
import { AlertStatus, Body, Side, SkillTrait, type Soldier, TEAM_FIRST_ID, Team } from '../soldier.ts';
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
const LISTENER_AT = gridNo(80, 80);
const BEHIND_THE_WALL = gridNo(80, 70);
const WALL = Array.from({ length: 21 }, (_, k) => gridNo(70 + k, 75));
const WAIST_HIGH = 2;
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

describe("the listener's hearing (OppList.cc DecideHearing, CalcEffVolume)", () => {
  const NOISE_AT = gridNo(80, 70);
  const LOUDEST_PROBE = 40;
  const NEVER = Number.POSITIVE_INFINITY;

  function quietestHeard(heard: (volume: number) => boolean): number {
    for (let volume = 1; volume <= LOUDEST_PROBE; volume++) if (heard(volume)) return volume;
    return NEVER;
  }

  function mercListening(): { sim: TacticalSim; merc: Soldier; quietest: () => number } {
    const sim = newCombatSim(content);
    const merc = spawnSoldier(sim, 0, Team.OUR, gridNo(80, 80), Direction.NORTH);
    const quietest = () => quietestHeard((volume) => squadHears(sim.state, NOISE_AT, 0, volume, NoiseKind.GUNFIRE) !== null);
    return { sim, merc, quietest };
  }

  function wear(s: Soldier, slot: number, item: string, status = 100): void {
    s.inv[slot] = createItem(content.items, content.items.byName.get(item)?.index ?? 0, status);
  }

  it('hears farther with an extended ear in a head slot, by one plus a fifth of its status in tens, and not with one in a pocket', () => {
    const { merc, quietest } = mercListening();
    const bare = quietest();
    wear(merc, InvSlot.HEAD2, 'EXTENDEDEAR');
    expect(quietest()).toBe(bare - 6);
    wear(merc, InvSlot.HEAD2, 'EXTENDEDEAR', 59);
    expect(quietest()).toBe(bare - 3);
    merc.inv[InvSlot.HEAD2] = emptyObject();
    wear(merc, InvSlot.SMALLPOCK1, 'EXTENDEDEAR');
    expect(quietest()).toBe(bare);
  });

  it('hears nothing at all with a walkman on', () => {
    const { merc, quietest } = mercListening();
    expect(quietest()).toBeLessThan(NEVER);
    wear(merc, InvSlot.HEAD1, 'WALKMAN');
    expect(quietest()).toBe(NEVER);
  });

  it('gives night ops one step of hearing by day and two in the dark', () => {
    const { sim, merc, quietest } = mercListening();
    const byDay = quietest();
    merc.skillTrait1 = SkillTrait.NIGHTOPS;
    expect(quietest()).toBe(byDay - 1);
    lightSetBaseLevel(sim.state, NORMAL_LIGHTLEVEL_NIGHT);
    merc.skillTrait1 = SkillTrait.NONE;
    const atNight = quietest();
    expect(atNight).toBe(byDay - 3);
    merc.skillTrait1 = SkillTrait.NIGHTOPS;
    expect(quietest()).toBe(atNight - 2);
  });

  it('makes a tank hard of hearing', () => {
    const wall = Array.from({ length: 21 }, (_, k) => gridNo(70 + k, 75));
    const sim = newCombatSim(content, wall);
    const merc = spawnSoldier(sim, 0, Team.OUR, NOISE_AT, Direction.SOUTH);
    const listener = spawnSoldier(sim, TEAM_FIRST_ID[Team.ENEMY], Team.ENEMY, gridNo(80, 80), Direction.NORTH);
    const quietest = () =>
      quietestHeard((volume) => {
        listener.oppList[merc.id] = Opp.NOT_HEARD_OR_SEEN;
        makeNoise(sim.state, merc, merc.gridNo, 0, volume, NoiseKind.MOVEMENT);
        return listener.oppList[merc.id] !== Opp.NOT_HEARD_OR_SEEN;
      });
    const soldier = quietest();
    listener.bodyType = Body.TANK_NW;
    expect(quietest()).toBe(soldier + 5);
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

  it('leaves a merc held prisoner out of every noise', () => {
    const heard = (prisoner: boolean) => {
      const { sim, merc, stranger } = squadAndStranger(BEHIND_THE_WALL, WALL);
      const t = sim.state;
      t.narrative = { ...t.narrative, assignment: (s) => (prisoner && s === merc ? Assignment.ASSIGNMENT_POW : null) };
      makeNoise(t, stranger, stranger.gridNo, 0, 20, NoiseKind.MOVEMENT);
      return [merc.oppList[stranger.id], squadHears(t, stranger.gridNo, 0, 20, NoiseKind.MOVEMENT)?.by ?? null];
    };
    expect(heard(false)).toEqual([Opp.HEARD_THIS_TURN, 0]);
    expect(heard(true)).toEqual([Opp.NOT_HEARD_OR_SEEN, null]);
  });

  it('keeps the Warden, the General, the Sergeant and Conrad deaf to the army, not to the squad', () => {
    const heard = (profile: number | null, makerTeam: typeof Team.OUR | typeof Team.ENEMY) => {
      const sim = newCombatSim(content, WALL);
      const listener = spawnSoldier(
        sim,
        TEAM_FIRST_ID[Team.CIV],
        Team.CIV,
        LISTENER_AT,
        Direction.NORTH,
        profile === null ? {} : { profile },
      );
      const maker = spawnSoldier(sim, TEAM_FIRST_ID[makerTeam], makerTeam, BEHIND_THE_WALL, Direction.SOUTH);
      makeNoise(sim.state, maker, maker.gridNo, 0, 20, NoiseKind.MOVEMENT);
      return listener.oppList[maker.id];
    };
    expect(heard(null, Team.ENEMY)).toBe(Opp.HEARD_THIS_TURN);
    for (const profile of [Profile.WARDEN, Profile.GENERAL, Profile.SERGEANT, Profile.CONRAD]) {
      expect(heard(profile, Team.ENEMY)).toBe(Opp.NOT_HEARD_OR_SEEN);
      expect(heard(profile, Team.OUR)).toBe(Opp.HEARD_THIS_TURN);
    }
  });

  it('lets militia on our side and the squad ignore each other, and hear each other once the militia turned on us', () => {
    const heard = (side: number) => {
      const sim = newCombatSim(content, WALL);
      const t = sim.state;
      const merc = spawnSoldier(sim, 0, Team.OUR, LISTENER_AT, Direction.NORTH);
      const militia = spawnSoldier(sim, TEAM_FIRST_ID[Team.MILITIA], Team.MILITIA, BEHIND_THE_WALL, Direction.SOUTH);
      militia.side = side;
      makeNoise(t, merc, merc.gridNo, 0, 20, NoiseKind.MOVEMENT);
      makeNoise(t, militia, militia.gridNo, 0, 20, NoiseKind.MOVEMENT);
      return [militia.oppList[merc.id], merc.oppList[militia.id]];
    };
    expect(heard(Side.FRIENDLY)).toEqual([Opp.NOT_HEARD_OR_SEEN, Opp.NOT_HEARD_OR_SEEN]);
    expect(heard(Side.ENEMY)).toEqual([Opp.HEARD_THIS_TURN, Opp.HEARD_THIS_TURN]);
  });

  it('lets militia on our side ignore a noise nobody made', () => {
    const remembered = (side: number) => {
      const sim = newCombatSim(content, WALL);
      const militia = spawnSoldier(sim, TEAM_FIRST_ID[Team.MILITIA], Team.MILITIA, LISTENER_AT, Direction.NORTH);
      militia.side = side;
      makeNoise(sim.state, null, BEHIND_THE_WALL, 0, 20, NoiseKind.EXPLOSION);
      return militia.ai.noiseGridNo === BEHIND_THE_WALL;
    };
    expect(remembered(Side.FRIENDLY)).toBe(false);
    expect(remembered(Side.ENEMY)).toBe(true);
  });
});

describe('turning the head to a noise (OppList.cc HearNoise)', () => {
  const GASMASK = () => content.items.byName.get('GASMASK')?.index ?? -1;

  it('lets a crow neither look at nor remember a noise', () => {
    const listen = (bodyType: number) => {
      const sim = newCombatSim(content);
      const t = sim.state;
      const listener = spawnSoldier(sim, TEAM_FIRST_ID[Team.CIV], Team.CIV, LISTENER_AT, Direction.NORTH);
      listener.bodyType = bodyType;
      const soldier = spawnSoldier(sim, TEAM_FIRST_ID[Team.ENEMY], Team.ENEMY, BEHIND_THE_WALL, Direction.SOUTH);
      makeNoise(t, soldier, soldier.gridNo, 0, 20, NoiseKind.MOVEMENT);
      makeNoise(t, null, gridNo(84, 70), 0, 20, NoiseKind.EXPLOSION);
      return [listener.oppList[soldier.id], listener.ai.alertStatus];
    };
    expect(listen(Body.REGMALE)).toEqual([Opp.SEEN_CURRENTLY, AlertStatus.RED]);
    expect(listen(Body.CROW)).toEqual([Opp.NOT_HEARD_OR_SEEN, AlertStatus.GREEN]);
  });

  it('keeps a tank from looking at a noise it has to turn to, even within its sight', () => {
    const seenBy = (bodyType: number, facing: number) => {
      const sim = newCombatSim(content);
      const listener = spawnSoldier(sim, TEAM_FIRST_ID[Team.ENEMY], Team.ENEMY, LISTENER_AT, facing);
      listener.bodyType = bodyType;
      const merc = spawnSoldier(sim, 0, Team.OUR, gridNo(84, 76), Direction.SOUTHWEST);
      makeNoise(sim.state, merc, merc.gridNo, 0, 30, NoiseKind.MOVEMENT);
      return listener.oppList[merc.id];
    };
    expect(seenBy(Body.TANK_NW, Direction.NORTHEAST)).toBe(Opp.SEEN_CURRENTLY);
    expect(seenBy(Body.TANK_NW, Direction.NORTH)).toBe(Opp.HEARD_THIS_TURN);
    expect(seenBy(Body.REGMALE, Direction.NORTH)).toBe(Opp.SEEN_CURRENTLY);
  });

  it('looks at the tile of a noise nobody made from his own eye height, a prone one in deep water', () => {
    const NOISE_AT = gridNo(80, 70);
    const remembered = (overTerrain: number) => {
      const sim = newCombatSim(content, [], 3, new Set(), (w) =>
        w.structures.add(gridNo(80, 75), 0, syntheticStructure(StructureFlags.GENERIC, Orientation.NONE, { height: WAIST_HIGH })),
      );
      const soldier = spawnSoldier(sim, TEAM_FIRST_ID[Team.ENEMY], Team.ENEMY, LISTENER_AT, Direction.NORTH);
      soldier.overTerrain = overTerrain;
      makeNoise(sim.state, null, NOISE_AT, 0, 20, NoiseKind.EXPLOSION);
      return soldier.ai.noiseGridNo === NOISE_AT;
    };
    expect(remembered(Terrain.FLAT_GROUND)).toBe(false);
    expect(remembered(Terrain.DEEP_WATER)).toBe(true);
  });

  it('has the army put on a gas mask it carries at an alarm, never at an explosion, and never the squad', () => {
    const sim = newCombatSim(content, WALL);
    const t = sim.state;
    const soldier = spawnSoldier(sim, TEAM_FIRST_ID[Team.ENEMY], Team.ENEMY, LISTENER_AT, Direction.NORTH);
    const merc = spawnSoldier(sim, 0, Team.OUR, gridNo(82, 80), Direction.NORTH);
    for (const s of [soldier, merc]) s.inv[InvSlot.BIGPOCK1] = createItem(content.items, GASMASK(), 100);
    makeNoise(t, null, BEHIND_THE_WALL, 0, 20, NoiseKind.EXPLOSION);
    expect(soldier.inv[InvSlot.HEAD1]?.item).toBe(NOTHING);
    makeNoise(t, null, BEHIND_THE_WALL, 0, 20, NoiseKind.SILENT_ALARM);
    expect([soldier.inv[InvSlot.HEAD1]?.item, soldier.inv[InvSlot.BIGPOCK1]?.item]).toEqual([GASMASK(), NOTHING]);
    expect(merc.inv[InvSlot.HEAD1]?.item).toBe(NOTHING);
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
    expect(said).toEqual([HEARD_SOMETHING, MercQuote.SEE_ENEMY_VARIATION]);
    const pause = t.inCombat ? 2 : 5;
    expect(merc.turnsUntilCanSayHeardNoise).toBe(pause);
    makeNoise(t, stranger, stranger.gridNo, 0, 14, NoiseKind.SPLASHING);
    expect(said).toEqual([HEARD_SOMETHING, MercQuote.SEE_ENEMY_VARIATION]);
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

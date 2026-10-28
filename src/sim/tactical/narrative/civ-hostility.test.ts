import { beforeAll, describe, expect, it } from 'vitest';
import { newCombatSim, spawnSoldier } from '../../../../tests/support/combat.ts';
import { loadTestContent } from '../../../../tests/support/tactical.ts';
import { Orientation } from '../../../content/formats/jsd.ts';
import { WORLD_COLS, WORLD_MAX } from '../../../content/world/grid.ts';
import { StructureFlags } from '../../../content/world/structures.ts';
import { syntheticStructure } from '../../../content/world/synthetic.ts';
import { ScriptedStream } from '../../strategic/forces/autoresolve/replay-rng.ts';
import { createCivGroupState, makeCivGroupHostileOnNextSectorEntrance } from '../../strategic/narrative/civ-groups.ts';
import { EventKind } from '../../strategic/time/constants.ts';
import type { TacticalContent } from '../content.ts';
import { Opp } from '../perception/opp.ts';
import { AlertStatus, Body, CivilianGroup, Orders, Side, Team } from '../soldier.ts';
import { sectorMapOf } from '../state.ts';
import type { TacticalSim } from '../tactical-sim.ts';
import {
  addToShouldBecomeHostileOrSayQuoteList,
  checkHostileOrSayQuoteList,
  civilianGroupMemberChangesSides,
  handleBrothelWallDestroyed,
  makeCivHostile,
  processImplicationsOfPCAttack,
  processImplicationsOfPCMessingWithDoor,
} from './civ-hostility.ts';
import { CivGroupHostility, Loyalty, Profile, Town } from './constants.ts';
import { civilianDeathRules } from './death-rules.ts';
import { type NarrativePort, NO_NARRATIVE_PORT } from './port.ts';
import { newSightingRules } from './sight-rules.ts';

let content: TacticalContent;

beforeAll(async () => {
  content = await loadTestContent();
});

const NORTH = 0;
const MERC_AT = 80 * 160 + 80;
const NEAR = MERC_AT + 5;
const FAR = MERC_AT + 160 * 40;

interface PortLog {
  readonly calls: string[];
}

function recordingPort(overrides: Partial<NarrativePort> = {}): NarrativePort & PortLog {
  const calls: string[] = [];
  return {
    ...NO_NARRATIVE_PORT,
    civGroupWillBecomeHostile: (group) => calls.push(`willBecomeHostile ${group}`),
    rebelsBetrayed: () => calls.push('rebelsBetrayed'),
    townLoyaltyChange: (town, amount) => calls.push(`loyalty ${town} ${amount}`),
    addFutureDayEvent: (kind, minute, param, days) => calls.push(`event ${kind} ${minute} ${param} ${days}`),
    sayHostileQuote: (s) => calls.push(`hostileQuote ${s.profile}`),
    triggerNpcRecord: (profile, record) => calls.push(`record ${profile} ${record}`),
    ...overrides,
    calls,
  };
}

function setup(): { sim: TacticalSim; port: NarrativePort & PortLog } {
  const sim = newCombatSim(content);
  Object.assign(sim.state.world, { map: { ...sim.state.world.map, rooms: new Uint8Array(WORLD_MAX) } });
  const port = recordingPort();
  sim.state.narrative = port;
  spawnSoldier(sim, 0, Team.OUR, MERC_AT, NORTH);
  return { sim, port };
}

function civilian(sim: TacticalSim, id: number, at: number, group: number = CivilianGroup.NONE, profile?: number) {
  const s = spawnSoldier(sim, id, Team.CIV, at, NORTH);
  s.civilianGroup = group;
  if (profile !== undefined) Object.assign(s, { profile });
  return s;
}

describe('MakeCivHostile', () => {
  it('only drops neutrality: Stracciatella keeps the side, even for rebels', () => {
    const { sim } = setup();
    const villager = civilian(sim, 116, NEAR);
    const rebel = civilian(sim, 117, NEAR + 1, CivilianGroup.REBEL);
    makeCivHostile(sim.state, villager);
    makeCivHostile(sim.state, rebel);
    expect([villager.neutral, villager.side, rebel.neutral, rebel.side]).toEqual([false, Side.ENEMY, false, Side.ENEMY]);
  });

  it('switches Conrad to the new side, sends Billy patrolling and never touches cows', () => {
    const { sim } = setup();
    const conrad = civilian(sim, 116, NEAR, CivilianGroup.NONE, Profile.CONRAD);
    conrad.side = Side.FRIENDLY;
    const billy = civilian(sim, 117, NEAR + 1, CivilianGroup.NONE, Profile.BILLY);
    const cow = civilian(sim, 118, NEAR + 2);
    Object.assign(cow, { bodyType: Body.COW });
    for (const s of [conrad, billy, cow]) makeCivHostile(sim.state, s);
    expect([conrad.side, conrad.neutral, billy.ai.orders, cow.neutral]).toEqual([Side.ENEMY, false, Orders.FARPATROL, true]);
  });

  it('moves Conrad and the General to the enemy team through ChangeSoldierTeam', () => {
    const { sim, port } = setup();
    const moved: [number, number][] = [];
    sim.state.narrative = {
      ...port,
      changeSoldierTeam: (s, team) => {
        moved.push([s.profile, team]);
        return null;
      },
    };
    const general = civilian(sim, 116, NEAR, CivilianGroup.NONE, Profile.GENERAL);
    makeCivHostile(sim.state, general);
    makeCivHostile(sim.state, civilian(sim, 117, NEAR + 1, CivilianGroup.NONE, Profile.BILLY));
    expect(moved).toEqual([[Profile.GENERAL, Team.ENEMY]]);
  });
});

describe('recruited members of an attacked civilian group (CivilianGroupMemberChangesSides)', () => {
  it('go back to the civilian team, and the attacked soldier is followed to his new team', () => {
    const { sim, port } = setup();
    const moved: [number, number][] = [];
    const rebel = spawnSoldier(sim, 1, Team.OUR, MERC_AT + 2, NORTH);
    rebel.civilianGroup = CivilianGroup.REBEL;
    Object.assign(rebel, { profile: Profile.CARLOS });
    const replacement = civilian(sim, 120, MERC_AT + 2, CivilianGroup.REBEL, Profile.CARLOS);
    sim.state.narrative = {
      ...port,
      changeSoldierTeam: (s, team) => {
        moved.push([s.id, team]);
        return replacement;
      },
    };
    expect(civilianGroupMemberChangesSides(sim.state, rebel)).toBe(replacement);
    expect(moved).toEqual([[1, Team.CIV]]);
  });
});

describe('civilian groups', () => {
  it('turns nearby members of an attacked group hostile and schedules the group', () => {
    const { sim, port } = setup();
    const target = civilian(sim, 116, NEAR, CivilianGroup.HICKS);
    const near = civilian(sim, 117, NEAR + 3, CivilianGroup.HICKS);
    const far = civilian(sim, 118, FAR, CivilianGroup.HICKS);
    const other = civilian(sim, 119, NEAR + 4, CivilianGroup.KINGPIN);
    target.attacker = sim.state.soldiers[0] ?? null;
    expect(processImplicationsOfPCAttack(sim.state, sim.state.soldiers[0] as never, target)).toBe(true);
    expect([target.neutral, near.neutral, far.neutral, other.neutral]).toEqual([false, false, true, true]);
    expect(sim.state.civGroups.hostility[CivilianGroup.HICKS]).toBe(CivGroupHostility.WILL_EVENTUALLY_BECOME_HOSTILE);
    expect(port.calls).toEqual([`willBecomeHostile ${CivilianGroup.HICKS}`]);
  });

  it('betrays the rebels only the first time their group turns', () => {
    const { sim, port } = setup();
    const rebel = civilian(sim, 116, NEAR, CivilianGroup.REBEL);
    processImplicationsOfPCAttack(sim.state, sim.state.soldiers[0] as never, rebel);
    rebel.neutral = true;
    processImplicationsOfPCAttack(sim.state, sim.state.soldiers[0] as never, rebel);
    expect(port.calls).toEqual(['rebelsBetrayed', `willBecomeHostile ${CivilianGroup.REBEL}`]);
  });

  it('lists an attacked civilian without a group and resolves the list into hostility and combat', () => {
    const { sim } = setup();
    const villager = civilian(sim, 116, NEAR);
    const militia = spawnSoldier(sim, 84, Team.MILITIA, NEAR + 2, NORTH);
    processImplicationsOfPCAttack(sim.state, sim.state.soldiers[0] as never, villager);
    expect(sim.state.hostileQuoteList).toEqual([villager]);
    expect([militia.side, militia.neutral]).toEqual([Side.FRIENDLY, false]);
    checkHostileOrSayQuoteList(sim.state);
    expect(villager.neutral).toBe(false);
    expect(sim.state.hostileQuoteList).toEqual([]);
  });

  it('lets a profiled speaker with an unused hostile record talk first', () => {
    const { sim } = setup();
    const port = recordingPort({ hasUnusedHostileRecord: (profile) => profile === Profile.CARMEN });
    sim.state.narrative = port;
    const carmen = civilian(sim, 116, NEAR, CivilianGroup.NONE, Profile.CARMEN);
    const villager = civilian(sim, 117, NEAR + 1);
    addToShouldBecomeHostileOrSayQuoteList(sim.state, carmen);
    addToShouldBecomeHostileOrSayQuoteList(sim.state, villager);
    carmen.visible = 1;
    const main = new ScriptedStream([0]);
    Object.assign(sim.state, { rng: main });
    checkHostileOrSayQuoteList(sim.state);
    expect(main.requested).toEqual([1]);
    expect(port.calls).toEqual([`hostileQuote ${Profile.CARMEN}`]);
    expect([carmen.neutral, villager.neutral]).toEqual([true, true]);
    expect([sim.state.turn.pauseAllAi, sim.state.turn.pauseAllAiSinceMs]).toEqual([true, null]);
  });

  it('reveals an unseen speaker to our team before the quote and unpauses the AI when the list resolves', () => {
    const { sim } = setup();
    let carmenHasRecord = true;
    const port = recordingPort({ hasUnusedHostileRecord: (profile) => profile === Profile.CARMEN && carmenHasRecord });
    sim.state.narrative = port;
    const carmen = civilian(sim, 116, NEAR, CivilianGroup.NONE, Profile.CARMEN);
    carmen.visible = 0;
    addToShouldBecomeHostileOrSayQuoteList(sim.state, carmen);
    Object.assign(sim.state, { rng: new ScriptedStream([0], 0) });
    checkHostileOrSayQuoteList(sim.state);
    expect(sim.state.perception.publicOpp[Team.OUR]?.[carmen.id]).not.toBe(Opp.NOT_HEARD_OR_SEEN);
    expect(sim.state.turn.pauseAllAi).toBe(true);
    carmenHasRecord = false;
    checkHostileOrSayQuoteList(sim.state);
    expect([carmen.neutral, sim.state.turn.pauseAllAi, sim.state.hostileQuoteList]).toEqual([false, false, []]);
  });

  it('raises a group that will become hostile to hostile when a listed member resolves', () => {
    const { sim } = setup();
    const hick = civilian(sim, 116, NEAR, CivilianGroup.HICKS);
    sim.state.civGroups.hostility[CivilianGroup.HICKS] = CivGroupHostility.WILL_BECOME_HOSTILE;
    addToShouldBecomeHostileOrSayQuoteList(sim.state, hick);
    checkHostileOrSayQuoteList(sim.state);
    expect(sim.state.civGroups.hostility[CivilianGroup.HICKS]).toBe(CivGroupHostility.HOSTILE);
  });

  it('applies the next-sector-entrance event: will become hostile, rebels betrayed once', () => {
    const state = createCivGroupState();
    const calls: string[] = [];
    makeCivGroupHostileOnNextSectorEntrance(state, CivilianGroup.REBEL, () => calls.push('betrayed'));
    makeCivGroupHostileOnNextSectorEntrance(state, CivilianGroup.REBEL, () => calls.push('betrayed'));
    expect([state.hostility[CivilianGroup.REBEL], calls]).toEqual([CivGroupHostility.WILL_BECOME_HOSTILE, ['betrayed']]);
  });
});

describe('sight rules', () => {
  it('lists a neutral member of a group that will become hostile when it sees one of our mercs', () => {
    const { sim } = setup();
    const goon = civilian(sim, 116, NEAR, CivilianGroup.KINGPIN);
    sim.state.civGroups.hostility[CivilianGroup.KINGPIN] = CivGroupHostility.WILL_BECOME_HOSTILE;
    newSightingRules(sim.state, goon, sim.state.soldiers[0] as never);
    expect(sim.state.hostileQuoteList).toEqual([goon]);
  });

  it('turns hicks hostile at night but not by day', () => {
    const { sim } = setup();
    const hick = civilian(sim, 116, NEAR, CivilianGroup.HICKS);
    const merc = sim.state.soldiers[0] as never;
    sim.attachWorldClock({ seconds: 86400 + 12 * 3600 });
    newSightingRules(sim.state, hick, merc);
    expect(hick.neutral).toBe(true);
    sim.attachWorldClock({ seconds: 86400 + 3 * 3600 });
    newSightingRules(sim.state, hick, merc);
    expect(hick.neutral).toBe(false);
  });

  it('sends a neutral assassin seeking and starts Carmen hunting Slay', () => {
    const { sim, port } = setup();
    const jim = civilian(sim, 116, NEAR, CivilianGroup.NONE, Profile.JIM);
    const carmen = civilian(sim, 117, NEAR + 1, CivilianGroup.NONE, Profile.CARMEN);
    const slay = sim.state.soldiers[0];
    if (!slay) throw new Error('no merc');
    Object.assign(slay, { profile: Profile.SLAY });
    newSightingRules(sim.state, jim, slay);
    newSightingRules(sim.state, carmen, slay);
    expect([jim.ai.orders, carmen.ai.attitude]).toEqual([Orders.SEEKENEMY, 6]);
    expect(port.calls).toEqual([`record ${Profile.CARMEN} 28`]);
  });
});

describe('death rules', () => {
  it('sends the second airport attendant 480 + Random(60) minutes into the next day when Pablo dies', () => {
    const { sim, port } = setup();
    const pablo = civilian(sim, 116, NEAR, CivilianGroup.NONE, Profile.PABLO);
    const main = new ScriptedStream([17]);
    Object.assign(sim.state, { rng: main });
    civilianDeathRules(sim.state, pablo, null);
    expect(main.requested).toEqual([60]);
    expect(port.calls).toEqual([`event ${EventKind.SECOND_AIRPORT_ATTENDANT_ARRIVED} 497 0 1`]);
  });

  it('costs Balime loyalty when Eldin dies and Cambria loyalty when Joey dies unseen', () => {
    const { sim, port } = setup();
    civilianDeathRules(sim.state, civilian(sim, 116, NEAR, CivilianGroup.NONE, Profile.ELDIN), null);
    civilianDeathRules(sim.state, civilian(sim, 117, FAR, CivilianGroup.NONE, Profile.JOEY), null);
    expect(port.calls).toEqual([
      `loyalty ${Town.BALIME} ${-Loyalty.PENALTY_ELDIN_KILLED}`,
      `loyalty ${Town.CAMBRIA} ${-Loyalty.PENALTY_JOEY_KILLED}`,
    ]);
  });
});

describe('messing with doors', () => {
  it("turns Kingpin's goons who see it hostile at the San Mona door tiles", () => {
    const { sim } = setup();
    const merc = sim.state.soldiers[0];
    if (!merc) throw new Error('no merc');
    sim.state.sector = { x: 5, y: 4, z: 0 };
    const goon = civilian(sim, 116, 11010 + 3, CivilianGroup.KINGPIN);
    const blind = civilian(sim, 117, 11010 + 4, CivilianGroup.KINGPIN);
    Object.assign(merc, { gridNo: 11010 });
    goon.oppList[merc.id] = Opp.SEEN_CURRENTLY;
    processImplicationsOfPCMessingWithDoor(sim.state, merc);
    expect([goon.neutral, blind.neutral]).toEqual([false, true]);
  });

  it('alerts the Warden in Tixa within five tiles', () => {
    const { sim } = setup();
    const merc = sim.state.soldiers[0];
    if (!merc) throw new Error('no merc');
    sim.state.sector = { x: 9, y: 10, z: 0 };
    const warden = civilian(sim, 116, MERC_AT + 4, CivilianGroup.WARDEN, Profile.WARDEN);
    processImplicationsOfPCMessingWithDoor(sim.state, merc);
    expect(warden.ai.alertStatus).toBe(AlertStatus.RED);
  });
});

describe('a destroyed brothel wall (HandleBrothelWallDestroyed)', () => {
  const WALL = FAR + 20;
  const C5 = { x: 5, y: 3, z: 0 };
  const BROTHEL_ROOM = 100;

  interface Blast {
    readonly sector?: { x: number; y: number; z: number };
    readonly flags?: number;
    readonly destroyed?: boolean;
    readonly rooms?: readonly (readonly [number, number])[];
  }

  function blowWall(blast: Blast) {
    const { sim } = setup();
    const t = sim.state;
    t.sector = { ...(blast.sector ?? C5) };
    for (const [g, room] of blast.rooms ?? [[WALL + WORLD_COLS, BROTHEL_ROOM]]) sectorMapOf(t).rooms[g] = room;
    const goon = civilian(sim, 116, NEAR, CivilianGroup.KINGPIN);
    const villager = civilian(sim, 117, NEAR + 1);
    const wall = t.world.structures.add(WALL, 0, syntheticStructure(blast.flags ?? StructureFlags.WALL, Orientation.OUTSIDE_LEFT));
    if (!wall) throw new Error('no wall');
    handleBrothelWallDestroyed(t, WALL, wall, blast.destroyed ?? true);
    return { goonNeutral: goon.neutral, villagerNeutral: villager.neutral, group: t.civGroups.hostility[CivilianGroup.KINGPIN] };
  }

  it("turns Kingpin's whole group hostile when a wall beside a brothel room of C5 is destroyed", () => {
    expect(blowWall({})).toEqual({ goonNeutral: false, villagerNeutral: true, group: CivGroupHostility.HOSTILE });
    expect(blowWall({ rooms: [[WALL, 91]] }).goonNeutral).toBe(false);
    expect(blowWall({ rooms: [[WALL + 1, 119]] }).goonNeutral).toBe(false);
  });

  it('needs C5, a wall, its destruction and a brothel room on the tile, else south, else east of it', () => {
    expect(blowWall({ destroyed: false }).goonNeutral).toBe(true);
    expect(blowWall({ flags: StructureFlags.GENERIC }).goonNeutral).toBe(true);
    expect(blowWall({ sector: { x: 5, y: 3, z: 1 } }).goonNeutral).toBe(true);
    expect(blowWall({ sector: { x: 5, y: 4, z: 0 } }).goonNeutral).toBe(true);
    expect(blowWall({ rooms: [[WALL + WORLD_COLS, 90]] }).goonNeutral).toBe(true);
    expect(
      blowWall({
        rooms: [
          [WALL, 5],
          [WALL + WORLD_COLS, BROTHEL_ROOM],
        ],
      }).goonNeutral,
    ).toBe(true);
    expect(
      blowWall({
        rooms: [
          [WALL + WORLD_COLS, 120],
          [WALL + 1, BROTHEL_ROOM],
        ],
      }).goonNeutral,
    ).toBe(true);
  });
});

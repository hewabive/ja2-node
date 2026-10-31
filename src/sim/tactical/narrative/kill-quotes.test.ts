import { beforeAll, describe, expect, it } from 'vitest';
import { newCombatSim, spawnSoldier } from '../../../../tests/support/combat.ts';
import { testProfile } from '../../../../tests/support/profiles.ts';
import { loadTestContent } from '../../../../tests/support/tactical.ts';
import { Direction, gridNo } from '../../../content/world/grid.ts';
import { anim } from '../anim-states.ts';
import { reduceAttackBusyCount } from '../combat/barrier.ts';
import { handleSoldierDeath } from '../combat/death.ts';
import type { TacticalContent } from '../content.ts';
import { Body, CivilianGroup, type Soldier, TEAM_FIRST_ID, Team } from '../soldier.ts';
import type { TacticalState } from '../state.ts';
import type { TacticalSim } from '../tactical-sim.ts';
import type { EnemyKilledOnAttack } from '../turns/turn-state.ts';
import { Profile } from './constants.ts';
import { handleKilledQuote } from './kill-quotes.ts';
import { MercQuote, QuoteSaidExtFlag, QuoteSaidFlag } from './merc-quotes.ts';
import type { QuoteSaidRecord } from './port.ts';

let content: TacticalContent;

beforeAll(async () => {
  content = await loadTestContent();
});

const KILLER_AT = gridNo(80, 80);
const VICTIM_AT = gridNo(80, 84);
const WITNESS_AT = gridNo(84, 80);
const SECOND_WITNESS_AT = gridNo(76, 80);
const OUT_OF_SIGHT = gridNo(80, 150);
const ENEMY_ID = TEAM_FIRST_ID[Team.ENEMY];
const CIV_ID = TEAM_FIRST_ID[Team.CIV];
const LIKES_GUN_AFTER_KILL = 0;
const NO_GUN_QUOTE = 4;
const BUDDY = 5;
const DEADLY_GUN = 'M14';
const NO_BUDDY = -1;

interface Scene {
  readonly sim: TacticalSim;
  readonly t: TacticalState;
  readonly killer: Soldier;
  readonly said: [number, number][];
  readonly draws: number[];
  readonly flags: Map<number, QuoteSaidRecord>;
  readonly script: number[];
}

function scene(killerProfile = NO_GUN_QUOTE, aimMerc = false): Scene {
  const sim = newCombatSim(content);
  const t = sim.state;
  const killer = spawnSoldier(sim, 0, Team.OUR, KILLER_AT, Direction.SOUTH, { profile: killerProfile });
  const said: [number, number][] = [];
  const flags = new Map<number, QuoteSaidRecord>();
  t.narrative = {
    ...t.narrative,
    sayQuote: (s, quote) => said.push([s.id, quote]),
    isAimMerc: () => aimMerc,
    quoteSaidFlags: (s) => {
      const record = flags.get(s.id) ?? { quoteSaidFlags: 0, quoteSaidExtFlags: 0 };
      flags.set(s.id, record);
      return record;
    },
  };
  const draws: number[] = [];
  const script: number[] = [];
  const rng = t.rng as unknown as { int(n: number): number };
  rng.int = (n: number) => {
    draws.push(n);
    const v = script.shift();
    if (v === undefined || v >= n) throw new Error(`unscripted draw of ${n}`);
    return v;
  };
  return { sim, t, killer, said, draws, flags, script };
}

function victim(s: Scene, at = VICTIM_AT, team: number = Team.ENEMY, body: number = Body.REGMALE): Soldier {
  const id = team === Team.CIV ? CIV_ID : ENEMY_ID;
  return spawnSoldier(s.sim, id, team, at, Direction.NORTH, { body });
}

function killed(s: Scene, dead: Soldier): EnemyKilledOnAttack {
  return { victim: dead, killer: s.killer, gridNo: dead.gridNo, level: dead.level };
}

function kill(s: Scene, rolls: readonly number[], dead = victim(s)): void {
  s.script.push(...rolls);
  handleKilledQuote(s.t, killed(s, dead));
}

function headshot(s: Scene): Soldier {
  const dead = victim(s);
  dead.state = anim(content, 'JFK_HITDEATH');
  return dead;
}

function witness(s: Scene, id: number, at: number, profile: number): Soldier {
  return spawnSoldier(s.sim, id, Team.OUR, at, Direction.SOUTH, { profile });
}

function buddyOf(s: Scene, id: number, at: number, slot: number): Soldier {
  const buddies = [NO_BUDDY, NO_BUDDY, NO_BUDDY];
  buddies[slot] = s.killer.profile;
  s.t.profiles.set(BUDDY, testProfile(BUDDY, { buddies }));
  return witness(s, id, at, BUDDY);
}

describe("the killer's comment (Soldier_Ani.cc HandleKilledQuote)", () => {
  it('says he killed an enemy on Random(100) < 33, after one draw', () => {
    const s = scene();
    kill(s, [32]);
    expect(s.draws).toEqual([100]);
    expect(s.said).toEqual([[s.killer.id, MercQuote.KILLED_AN_ENEMY]]);
  });

  it('makes the same draw and says nothing from 33 up: the laugh or cool coin toss is not drawn', () => {
    const s = scene();
    kill(s, [33]);
    expect(s.draws).toEqual([100]);
    expect(s.said).toEqual([]);
  });

  it('says the creature kill for a creature and draws the roll for a bloodcat without a quote', () => {
    const s = scene();
    kill(s, [0], victim(s, VICTIM_AT, Team.ENEMY, Body.AM_MONSTER));
    kill(s, [0], victim(s, VICTIM_AT, Team.ENEMY, Body.BLOODCAT));
    expect(s.draws).toEqual([100, 100]);
    expect(s.said).toEqual([[s.killer.id, MercQuote.KILLED_A_CREATURE]]);
  });

  it('draws nothing for a plain civilian or a tile the killer cannot see; a civilian of a group counts as an enemy', () => {
    const s = scene();
    kill(s, [], victim(s, VICTIM_AT, Team.CIV));
    kill(s, [], victim(s, OUT_OF_SIGHT));
    expect(s.draws).toEqual([]);
    const rebel = victim(s, VICTIM_AT, Team.CIV);
    rebel.civilianGroup = CivilianGroup.REBEL;
    kill(s, [0], rebel);
    expect(s.said).toEqual([[s.killer.id, MercQuote.KILLED_AN_ENEMY]]);
  });

  it('remembers the victim as the last kill talked about, which the bloodcat check at the end of a battle reads', () => {
    const s = scene();
    const cat = victim(s, VICTIM_AT, Team.ENEMY, Body.BLOODCAT);
    kill(s, [50], cat);
    expect(s.t.turn.lastMercKill).toBe(cat);
  });
});

describe('the headshot quote (Soldier_Ani.cc HandleKilledQuote, JFK_HITDEATH)', () => {
  it('lets the killer say it on Random(100) < 40 with that one draw', () => {
    const s = scene();
    witness(s, 1, WITNESS_AT, NO_GUN_QUOTE);
    kill(s, [39], headshot(s));
    expect(s.draws).toEqual([100]);
    expect(s.said).toEqual([[s.killer.id, MercQuote.HEADSHOT]]);
  });

  it('else picks a merc who sees the tile with Random(n), whom the killer precedes on Random(100) < 50', () => {
    const s = scene();
    witness(s, 1, WITNESS_AT, NO_GUN_QUOTE);
    const second = witness(s, 2, SECOND_WITNESS_AT, NO_GUN_QUOTE);
    kill(s, [40, 1, 49], headshot(s));
    expect(s.draws).toEqual([100, 2, 100]);
    expect(s.said).toEqual([
      [s.killer.id, MercQuote.KILLED_AN_ENEMY],
      [second.id, MercQuote.HEADSHOT],
    ]);
  });

  it('leaves the killer out of the witnesses and silent on Random(100) >= 50', () => {
    const s = scene();
    const only = witness(s, 1, WITNESS_AT, NO_GUN_QUOTE);
    kill(s, [40, 0, 50], headshot(s));
    expect(s.draws).toEqual([100, 1, 100]);
    expect(s.said).toEqual([[only.id, MercQuote.HEADSHOT]]);
  });

  it('without a witness has the killer say his kill when he sees the tile, after the single draw', () => {
    const s = scene();
    kill(s, [40], headshot(s));
    expect(s.draws).toEqual([100]);
    expect(s.said).toEqual([[s.killer.id, MercQuote.KILLED_AN_ENEMY]]);
  });
});

describe('the special victims (Soldier_Ani.cc HandleKilledQuote)', () => {
  it("has an A.I.M. merc who sees Mike die say Mike's quote without a draw; another merc comments him as any enemy", () => {
    const aim = scene(NO_GUN_QUOTE, true);
    const mike = victim(aim);
    mike.profile = Profile.MIKE;
    kill(aim, [], mike);
    expect([aim.draws, aim.said]).toEqual([[], [[aim.killer.id, MercQuote.AIM_KILLED_MIKE]]]);
    const other = scene(NO_GUN_QUOTE, false);
    const again = victim(other);
    again.profile = Profile.MIKE;
    kill(other, [0], again);
    expect(other.said).toEqual([[other.killer.id, MercQuote.KILLED_AN_ENEMY]]);
  });

  it("has Doreen's killer say the factory manager quote even out of sight, without a draw", () => {
    const s = scene();
    const doreen = victim(s, OUT_OF_SIGHT);
    doreen.profile = Profile.DOREEN;
    kill(s, [], doreen);
    expect([s.draws, s.said]).toEqual([[], [[s.killer.id, MercQuote.KILLED_FACTORY_MANAGER]]]);
  });
});

describe('the gun quote after a kill (Soldier_Ani.cc ShouldMercSayHappyWithGunQuote)', () => {
  function deadlyGunScene(): Scene {
    const s = scene(LIKES_GUN_AFTER_KILL);
    s.killer.attackingWeapon = content.items.byName.get(DEADLY_GUN)?.index ?? 0;
    return s;
  }

  it('says it on Random(100) < 20 and marks it said, so the next kill rolls only the kill quote', () => {
    const s = deadlyGunScene();
    kill(s, [19]);
    expect(s.said).toEqual([[s.killer.id, MercQuote.SATISFACTION_WITH_GUN_AFTER_KILL]]);
    expect(s.flags.get(s.killer.id)?.quoteSaidFlags).toBe(QuoteSaidFlag.LIKESGUN);
    kill(s, [0]);
    expect(s.draws).toEqual([100, 100]);
    expect(s.said.at(-1)).toEqual([s.killer.id, MercQuote.KILLED_AN_ENEMY]);
  });

  it('rolls the gun before the kill quote, and not at all for a gun of deadliness 20 or less or a merc without the quote', () => {
    const s = deadlyGunScene();
    kill(s, [20, 0]);
    expect(s.draws).toEqual([100, 100]);
    expect(s.said).toEqual([[s.killer.id, MercQuote.KILLED_AN_ENEMY]]);
    const weak = scene(LIKES_GUN_AFTER_KILL);
    weak.killer.attackingWeapon = content.items.byName.get('GLOCK_17')?.index ?? 0;
    kill(weak, [50]);
    const without = scene(NO_GUN_QUOTE);
    without.killer.attackingWeapon = content.items.byName.get(DEADLY_GUN)?.index ?? 0;
    kill(without, [50]);
    expect([weak.draws, without.draws]).toEqual([[100], [100]]);
  });
});

describe('a buddy witnesses a kill (Soldier_Ani.cc SayBuddyWitnessedQuoteFromKill)', () => {
  it('lets a buddy who sees killer and victim comment on Random(100) < 20, picked with Random(n), once', () => {
    const s = scene();
    const buddy = buddyOf(s, 1, WITNESS_AT, 0);
    kill(s, [50, 19, 0]);
    expect(s.draws).toEqual([100, 100, 1]);
    expect(s.said).toEqual([[buddy.id, MercQuote.BUDDY_1_GOOD]]);
    expect(s.flags.get(buddy.id)?.quoteSaidExtFlags).toBe(QuoteSaidExtFlag.BUDDY_1_WITNESSED);
    kill(s, [50]);
    expect(s.draws).toEqual([100, 100, 1, 100]);
  });

  it('says the learned-to-like line from the third slot and makes no pick on Random(100) >= 20', () => {
    const s = scene();
    const buddy = buddyOf(s, 1, WITNESS_AT, 2);
    kill(s, [50, 20]);
    expect([s.draws, s.said]).toEqual([[100, 100], []]);
    kill(s, [50, 0, 0]);
    expect(s.said).toEqual([[buddy.id, MercQuote.LEARNED_TO_LIKE_WITNESSED]]);
    expect(s.flags.get(buddy.id)?.quoteSaidExtFlags).toBe(QuoteSaidExtFlag.BUDDY_3_WITNESSED);
  });

  it('skips a sleeping buddy, one who cannot see the victim and a merc who is no buddy, without a roll', () => {
    const s = scene();
    const asleep = buddyOf(s, 1, WITNESS_AT, 0);
    buddyOf(s, 2, gridNo(80, 150), 0);
    witness(s, 3, SECOND_WITNESS_AT, NO_GUN_QUOTE);
    s.t.narrative = { ...s.t.narrative, mercAsleep: (m) => m === asleep };
    kill(s, [50]);
    expect([s.draws, s.said]).toEqual([[100], []]);
  });
});

describe('the kill held until the end of the attack (Overhead.cc InternalReduceAttackBusyCount)', () => {
  it('comments only when the attack ends and remembers the victim then', () => {
    const s = scene();
    const dead = victim(s);
    dead.attacker = s.killer;
    s.t.turn.attackBusyCount = 1;
    dead.life = 0;
    handleSoldierDeath(s.t, dead);
    expect(s.t.turn.killedEnemyOnAttack).toMatchObject({ victim: dead, killer: s.killer, gridNo: VICTIM_AT, level: 0 });
    expect([s.said, s.t.turn.lastMercKill]).toEqual([[], null]);
    s.script.push(0);
    reduceAttackBusyCount(s.t, s.killer, false);
    expect(s.said).toEqual([[s.killer.id, MercQuote.KILLED_AN_ENEMY]]);
    expect([s.t.turn.killedEnemyOnAttack, s.t.turn.lastMercKill]).toEqual([null, dead]);
  });
});

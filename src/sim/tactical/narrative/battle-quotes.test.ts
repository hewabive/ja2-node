import { beforeAll, describe, expect, it } from 'vitest';
import { newCombatSim, spawnSoldier } from '../../../../tests/support/combat.ts';
import { loadTestContent } from '../../../../tests/support/tactical.ts';
import { Direction, gridNo } from '../../../content/world/grid.ts';
import { Assignment } from '../../strategic/economy/constants.ts';
import { traverseDown } from '../ai/queen-escape.ts';
import { handleSoldierDeath } from '../combat/death.ts';
import type { TacticalContent } from '../content.ts';
import { Opp } from '../perception/opp.ts';
import { AlertStatus, Body, type Soldier, TEAM_FIRST_ID, Team } from '../soldier.ts';
import type { TacticalState } from '../state.ts';
import type { TacticalSim } from '../tactical-sim.ts';
import { checkForEndOfCombatMode, enterCombatMode } from '../turns/turns.ts';
import { Profile } from './constants.ts';
import { MercQuote, QuoteSaidExtFlag } from './merc-quotes.ts';
import type { QuoteSaidRecord } from './port.ts';

let content: TacticalContent;

beforeAll(async () => {
  content = await loadTestContent();
});

const SQUAD_AT = [gridNo(80, 80), gridNo(82, 80), gridNo(84, 80)];
const FAR_AWAY = gridNo(80, 140);
const ENEMY_ID = TEAM_FIRST_ID[Team.ENEMY];
const CREATURE_ID = TEAM_FIRST_ID[Team.CREATURE];
const SPEAKER = 4;
const ALL_WITNESSED = QuoteSaidExtFlag.BUDDY_1_WITNESSED | QuoteSaidExtFlag.BUDDY_2_WITNESSED | QuoteSaidExtFlag.BUDDY_3_WITNESSED;

interface Scene {
  readonly sim: TacticalSim;
  readonly t: TacticalState;
  readonly squad: Soldier[];
  readonly said: [number, number][];
  readonly draws: number[];
  readonly script: number[];
  readonly flags: Map<number, QuoteSaidRecord>;
}

function scene(mercs = 2): Scene {
  const sim = newCombatSim(content);
  const t = sim.state;
  const squad = SQUAD_AT.slice(0, mercs).map((at, id) => spawnSoldier(sim, id, Team.OUR, at, Direction.SOUTH, { profile: SPEAKER + id }));
  const said: [number, number][] = [];
  const flags = new Map<number, QuoteSaidRecord>();
  t.narrative = {
    ...t.narrative,
    sayQuote: (s, quote) => said.push([s.id, quote]),
    quoteSaidFlags: (s) => {
      const record = flags.get(s.id) ?? { quoteSaidFlags: 0, quoteSaidExtFlags: 0 };
      flags.set(s.id, record);
      return record;
    },
  };
  return { sim, t, squad, said, draws: [], script: [], flags };
}

function scriptDraws(s: Scene, rolls: readonly number[]): void {
  s.script.push(...rolls);
  const rng = s.t.rng as unknown as { int(n: number): number };
  rng.int = (n: number) => {
    s.draws.push(n);
    const v = s.script.shift();
    if (v === undefined || v >= n) throw new Error(`unscripted draw of ${n}`);
    return v;
  };
}

function enemy(s: Scene, body: number = Body.REGMALE, id: number = ENEMY_ID, team: number = Team.ENEMY): Soldier {
  return spawnSoldier(s.sim, id, team, FAR_AWAY, Direction.NORTH, { body });
}

function fightAndWin(s: Scene, rolls: readonly number[], foe = enemy(s)): void {
  enterCombatMode(s.t, Team.OUR);
  expect(s.t.inCombat).toBe(true);
  scriptDraws(s, rolls);
  foe.life = 0;
  handleSoldierDeath(s.t, foe);
  expect(s.t.inCombat).toBe(false);
}

describe('the battle-end quote (Overhead.cc CheckForEndOfBattle)', () => {
  it('has a merc picked with Random(n) say the sector is safe after a fought battle', () => {
    const s = scene(3);
    fightAndWin(s, [2]);
    expect(s.draws).toEqual([3]);
    expect(s.said).toEqual([[2, MercQuote.SECTOR_SAFE]]);
  });

  it('leaves out sleeping, gassed and robot mercs, mercs on assignment and an EPC, and then says nothing', () => {
    const s = scene(3);
    const [asleep, doctor, gassed] = s.squad as [Soldier, Soldier, Soldier];
    s.t.narrative = {
      ...s.t.narrative,
      mercAsleep: (m) => m === asleep,
      assignment: (m) => (m === doctor ? Assignment.DOCTOR : null),
    };
    s.t.explosives.gassed[gassed.id] = 1;
    fightAndWin(s, []);
    expect([s.draws, s.said]).toEqual([[], []]);
    const t = scene(2);
    const [robot, epc] = t.squad as [Soldier, Soldier];
    robot.bodyType = Body.ROBOTNOWEAPON;
    t.t.narrative = { ...t.t.narrative, isEpc: (m) => m === epc };
    fightAndWin(t, []);
    expect([t.draws, t.said]).toEqual([[], []]);
  });

  it('leaves Ira out of the sector-safe pick when no soldier of the army was fought (Dialogue_Control.cc SayQuoteFromAnyBodyInSector)', () => {
    const s = scene(2);
    const ira = s.squad[1] as Soldier;
    ira.profile = Profile.IRA;
    fightAndWin(s, [0], enemy(s, Body.AM_MONSTER, CREATURE_ID, Team.CREATURE));
    expect(s.draws).toEqual([1]);
    expect(s.said).toEqual([[0, MercQuote.SECTOR_SAFE]]);
  });

  it('says nothing and draws nothing after a battle nobody fought', () => {
    const s = scene(2);
    const foe = enemy(s);
    s.t.turn.enemyInSector = true;
    scriptDraws(s, []);
    foe.life = 0;
    handleSoldierDeath(s.t, foe);
    expect([s.draws, s.said]).toEqual([[], []]);
  });

  it('draws nothing when the last kill talked about was a bloodcat: its COOL1 battle sound is not drawn', () => {
    const s = scene(2);
    s.t.turn.lastMercKill = enemy(s, Body.BLOODCAT, ENEMY_ID + 1);
    s.t.turn.lastMercKill.placed = false;
    fightAndWin(s, []);
    expect([s.draws, s.said]).toEqual([[], []]);
  });

  it('says the enemy retreated when the last one leaves the sector', () => {
    const s = scene(2);
    const foe = enemy(s);
    enterCombatMode(s.t, Team.OUR);
    scriptDraws(s, [1]);
    traverseDown(s.t, foe);
    expect(s.draws).toEqual([2]);
    expect(s.said).toEqual([[1, MercQuote.ENEMY_RETREATED]]);
  });

  it('clears the buddy-witnessed flags of mercs on their feet on the squad, not of a collapsed one', () => {
    const s = scene(2);
    const [standing, collapsed] = s.squad as [Soldier, Soldier];
    for (const m of s.squad) s.flags.set(m.id, { quoteSaidFlags: 0, quoteSaidExtFlags: ALL_WITNESSED | 1 });
    collapsed.collapsed = true;
    fightAndWin(s, [0]);
    expect([s.flags.get(standing.id)?.quoteSaidExtFlags, s.flags.get(collapsed.id)?.quoteSaidExtFlags]).toEqual([1, ALL_WITNESSED | 1]);
  });
});

describe('the lull quote (Overhead.cc CheckForEndOfCombatMode)', () => {
  function lull(s: Scene, rolls: readonly number[]): boolean {
    scriptDraws(s, rolls);
    return checkForEndOfCombatMode(s.t, true);
  }

  it('warns of the enemy still around when combat ends with nobody seen, picking the speaker with Random(n)', () => {
    const s = scene(2);
    enemy(s);
    enterCombatMode(s.t, Team.OUR);
    expect(lull(s, [0])).toBe(true);
    expect(s.draws).toEqual([2]);
    expect(s.said).toEqual([[0, MercQuote.WARNING_OUTSTANDING_ENEMY_AFTER_RT]]);
  });

  it('keeps quiet when nobody is alerted and a merc who sees no one now saw an enemy this turn', () => {
    const s = scene(2);
    const foe = enemy(s);
    enterCombatMode(s.t, Team.OUR);
    (s.squad[1] as Soldier).oppList[foe.id] = Opp.SEEN_THIS_TURN;
    expect(lull(s, [])).toBe(true);
    expect(s.said).toEqual([]);
  });

  it('warns after an alerted enemy went unseen for two turns', () => {
    const s = scene(2);
    const foe = enemy(s);
    enterCombatMode(s.t, Team.OUR);
    foe.ai.alertStatus = AlertStatus.RED;
    expect(lull(s, [])).toBe(false);
    expect(lull(s, [1])).toBe(true);
    expect(s.said).toEqual([[1, MercQuote.WARNING_OUTSTANDING_ENEMY_AFTER_RT]]);
  });

  it('keeps quiet while a bloodcat lives and in a creature lair', () => {
    const cats = scene(2);
    enemy(cats, Body.BLOODCAT, CREATURE_ID, Team.CREATURE);
    enterCombatMode(cats.t, Team.OUR);
    expect(lull(cats, [])).toBe(true);
    const lair = scene(2);
    enemy(lair, Body.AM_MONSTER, CREATURE_ID, Team.CREATURE);
    lair.t.sectorHooks = { ...lair.t.sectorHooks, inCreatureLair: () => true };
    enterCombatMode(lair.t, Team.OUR);
    expect(lull(lair, [])).toBe(true);
    expect([cats.said, lair.said, cats.draws, lair.draws]).toEqual([[], [], [], []]);
  });
});

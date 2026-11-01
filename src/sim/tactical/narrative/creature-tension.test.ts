import { beforeAll, describe, expect, it } from 'vitest';
import { newCombatSim, spawnSoldier } from '../../../../tests/support/combat.ts';
import { loadTestContent } from '../../../../tests/support/tactical.ts';
import { Direction, gridNo } from '../../../content/world/grid.ts';
import type { Rng } from '../../../core/rng.ts';
import { Quest } from '../../strategic/narrative/fact-ids.ts';
import { QuestStatus } from '../../strategic/narrative/facts.ts';
import type { TacticalContent } from '../content.ts';
import { addSoldierToSector, Insertion } from '../insertion.ts';
import { type Soldier, Team } from '../soldier.ts';
import type { TacticalState } from '../state.ts';
import type { TacticalSim } from '../tactical-sim.ts';
import { drawFirstCreatureTenseQuoteDelay, handleCreatureTenseQuote } from './creature-tension.ts';
import { MercQuote, QuoteSaidFlag } from './merc-quotes.ts';
import type { QuoteSaidRecord } from './port.ts';

let content: TacticalContent;

beforeAll(async () => {
  content = await loadTestContent();
});

const SQUAD_AT = [gridNo(80, 80), gridNo(82, 80), gridNo(84, 80)];
const SPEAKER = 4;
const SECOND = 1000;
const LONG_AGO = 600 * SECOND;

interface Scene {
  readonly sim: TacticalSim;
  readonly t: TacticalState;
  readonly squad: Soldier[];
  readonly said: [number, number][];
  readonly draws: number[];
  readonly script: number[];
  readonly flags: Map<number, QuoteSaidRecord>;
  quest: number;
}

function lair(mercs = 2): Scene {
  const sim = newCombatSim(content);
  const t = sim.state;
  const squad = SQUAD_AT.slice(0, mercs).map((at, id) => spawnSoldier(sim, id, Team.OUR, at, Direction.SOUTH, { profile: SPEAKER + id }));
  const scene: Scene = { sim, t, squad, said: [], draws: [], script: [], flags: new Map(), quest: QuestStatus.IN_PROGRESS };
  t.sectorHooks = { ...t.sectorHooks, inCreatureLair: () => true };
  t.narrative = {
    ...t.narrative,
    questStatus: (quest) => (quest === Quest.CREATURES ? scene.quest : QuestStatus.NOT_STARTED),
    sayQuote: (s, quote) => scene.said.push([s.id, quote]),
    quoteSaidFlags: (s) => {
      const record = scene.flags.get(s.id) ?? { quoteSaidFlags: 0, quoteSaidExtFlags: 0 };
      scene.flags.set(s.id, record);
      return record;
    },
  };
  return scene;
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

function lastQuoteAndDelay(s: Scene, lastMs: number, delaySeconds: number): void {
  s.t.realtimeClock.lastCreatureTenseQuoteMs = lastMs;
  s.t.realtimeClock.creatureTenseQuoteDelaySeconds = delaySeconds;
}

function tension(s: Scene, rolls: readonly number[], atMs: number): void {
  scriptDraws(s, rolls);
  s.t.clockMs = atMs;
  handleCreatureTenseQuote(s.t);
}

describe('the creature tension quotes (Overhead.cc HandleCreatureTenseQuote, DoCreatureTensionQuote)', () => {
  it('has a merc picked with Random(n) say a quote picked with Random(3) once the delay passed, then draws 60 + Random(60) s', () => {
    const s = lair(2);
    lastQuoteAndDelay(s, 0, 25);
    tension(s, [1, 2, 7], 25 * SECOND + 5);
    expect(s.draws).toEqual([2, 3, 60]);
    expect(s.said).toEqual([[1, MercQuote.WORRIED_ABOUT_CREATURE_PRESENCE]]);
    expect(s.t.realtimeClock).toMatchObject({ lastCreatureTenseQuoteMs: 25 * SECOND + 5, creatureTenseQuoteDelaySeconds: 67 });
    expect(s.flags.get(1)?.quoteSaidFlags).toBe(QuoteSaidFlag.WORRIED_ABOUT_CREATURES);
  });

  it('waits for more than the whole delay since the last tense quote', () => {
    const s = lair(1);
    lastQuoteAndDelay(s, 4 * SECOND, 60);
    tension(s, [], 64 * SECOND);
    expect([s.draws, s.said]).toEqual([[], []]);
    tension(s, [0, 0, 0], 64 * SECOND + 5);
    expect(s.said).toEqual([[0, MercQuote.SMELLED_CREATURE]]);
  });

  it('says nothing and draws nothing outside a lair, in combat, or once the creature quest is done', () => {
    const outside = lair(1);
    outside.t.sectorHooks = { ...outside.t.sectorHooks, inCreatureLair: () => false };
    const fighting = lair(1);
    fighting.t.inCombat = true;
    const done = lair(1);
    done.quest = QuestStatus.DONE;
    for (const s of [outside, fighting, done]) {
      lastQuoteAndDelay(s, 0, 10);
      tension(s, [], LONG_AGO);
      expect([s.draws, s.said, s.t.realtimeClock.lastCreatureTenseQuoteMs]).toEqual([[], [], 0]);
    }
  });

  it('says each quote once per merc: a quote he has said still takes its draws and restarts the delay in silence', () => {
    const s = lair(1);
    s.flags.set(0, { quoteSaidFlags: QuoteSaidFlag.SPOTTING_CREATURE_ATTACK, quoteSaidExtFlags: 0 });
    lastQuoteAndDelay(s, 0, 10);
    tension(s, [0, 1, 30], LONG_AGO);
    expect(s.draws).toEqual([1, 3, 60]);
    expect(s.said).toEqual([]);
    expect(s.t.realtimeClock).toMatchObject({ lastCreatureTenseQuoteMs: LONG_AGO, creatureTenseQuoteDelaySeconds: 90 });
  });

  it('clears the three tension flags when the merc is added to a sector (Soldier_Add.cc InternalAddSoldierToSector)', () => {
    const s = lair(1);
    const merc = s.squad[0] as Soldier;
    const other = QuoteSaidFlag.PERSONALITY;
    const tense = QuoteSaidFlag.SMELLED_CREATURE | QuoteSaidFlag.SPOTTING_CREATURE_ATTACK | QuoteSaidFlag.WORRIED_ABOUT_CREATURES;
    s.flags.set(merc.id, { quoteSaidFlags: tense | other, quoteSaidExtFlags: 0 });
    merc.insertionGridNo = SQUAD_AT[0] as number;
    addSoldierToSector(s.t, merc, { code: Insertion.GRIDNO, data: merc.insertionGridNo, direction: Direction.SOUTH }, {}, false);
    expect(s.flags.get(merc.id)?.quoteSaidFlags).toBe(other);
  });

  it('leaves out a merc who cannot speak and still draws the next delay when nobody can', () => {
    const s = lair(2);
    const [asleep, gassed] = s.squad as [Soldier, Soldier];
    s.t.narrative = { ...s.t.narrative, mercAsleep: (m) => m === asleep };
    gassed.gassed = true;
    lastQuoteAndDelay(s, 0, 10);
    tension(s, [5], LONG_AGO);
    expect([s.draws, s.said]).toEqual([[60], []]);
    expect(s.t.realtimeClock.creatureTenseQuoteDelaySeconds).toBe(65);
  });

  it('counts the first delay of a sector entry from the last tense quote, not from the entry: a lair entered long after one hears a quote at once', () => {
    const s = lair(1);
    s.t.realtimeClock.lastCreatureTenseQuoteMs = 0;
    scriptDraws(s, [19]);
    drawFirstCreatureTenseQuoteDelay(s.t.realtimeClock, s.t.rng as unknown as Rng);
    expect(s.t.realtimeClock.creatureTenseQuoteDelaySeconds).toBe(29);
    tension(s, [0, 2, 0], 29 * SECOND + 5);
    expect(s.draws).toEqual([20, 1, 3, 60]);
    expect(s.said).toEqual([[0, MercQuote.WORRIED_ABOUT_CREATURE_PRESENCE]]);
  });

  it('runs in the overhead pass of a tactical step', () => {
    const s = lair(2);
    lastQuoteAndDelay(s, 0, 10);
    s.t.clockMs = LONG_AGO;
    s.sim.step();
    expect(s.said).toHaveLength(1);
    expect(s.t.realtimeClock.lastCreatureTenseQuoteMs).toBe(LONG_AGO);
  });
});

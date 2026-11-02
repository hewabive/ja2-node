import { beforeAll, describe, expect, it } from 'vitest';
import { newCombatSim, spawnSoldier } from '../../../../tests/support/combat.ts';
import { loadTestContent } from '../../../../tests/support/tactical.ts';
import { Direction, gridNo } from '../../../content/world/grid.ts';
import type { Corpse } from '../combat/death.ts';
import type { TacticalContent } from '../content.ts';
import { revealRoofsAndItems } from '../perception/fov.ts';
import { addRottingCorpse, ROTTING_STAGE2 } from '../rotting-corpses.ts';
import { NOWHERE, OKLIFE, type Soldier, Team } from '../soldier.ts';
import type { TacticalState } from '../state.ts';
import type { TacticalSim } from '../tactical-sim.ts';
import { lookForAndMayCommentOnSeeingCorpse } from './corpse-comments.ts';
import { MercQuote } from './merc-quotes.ts';
import type { CorpseQuoteRecord } from './port.ts';

let content: TacticalContent;

beforeAll(async () => {
  content = await loadTestContent();
});

const MERC_AT = gridNo(80, 80);
const CORPSE_AT = gridNo(80, 83);
const OTHER_AT = gridNo(84, 80);
const GROSSED_OUT = 5;
const HEAD_SHOT_ONLY = 0;
const PAST_THE_TABLE = 75;
const NO_PROFILE = 200;
const FRESH_CORPSE = 3;
const RESET_CHOICES = 3;
const SQUAD_ODDS = 2;
const SQUAD_HARDENS = 1;
const SQUAD_SPARED = 0;

interface Scene {
  readonly sim: TacticalSim;
  readonly t: TacticalState;
  readonly merc: Soldier;
  readonly said: [number, number][];
  readonly draws: number[];
  readonly script: number[];
  readonly records: Map<number, CorpseQuoteRecord>;
}

function corpse(type = ROTTING_STAGE2, servicingCrows = 0): Corpse {
  return {
    gridNo: CORPSE_AT,
    level: 0,
    heightAdjustment: 0,
    bodyType: 0,
    direction: Direction.NORTH,
    state: 0,
    profile: NO_PROFILE,
    type,
    timeOfDeath: 0,
    headTaken: false,
    servicingCrows,
  };
}

function scene(profile = GROSSED_OUT, lying: Corpse | null = corpse()): Scene {
  const sim = newCombatSim(content);
  const t = sim.state;
  const merc = spawnSoldier(sim, 0, Team.OUR, MERC_AT, Direction.SOUTH, { profile });
  if (lying) addRottingCorpse(t, lying, { nowMinute: 0, loadingSave: true });
  const said: [number, number][] = [];
  const records = new Map<number, CorpseQuoteRecord>();
  t.narrative = {
    ...t.narrative,
    sayQuote: (s, quote) => said.push([s.id, quote]),
    corpseQuoteRecord: (s) => {
      const record = records.get(s.id) ?? { corpseQuoteTolerance: 0 };
      records.set(s.id, record);
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
  return { sim, t, merc, said, draws, script, records };
}

function tolerance(s: Scene, soldier: Soldier): number {
  return s.t.narrative.corpseQuoteRecord(soldier)?.corpseQuoteTolerance ?? Number.NaN;
}

function setTolerance(s: Scene, soldier: Soldier, value: number): void {
  const record = s.t.narrative.corpseQuoteRecord(soldier);
  if (record) record.corpseQuoteTolerance = value;
}

function look(s: Scene, rolls: readonly number[], soldier = s.merc): void {
  s.script.push(...rolls);
  lookForAndMayCommentOnSeeingCorpse(s.t, soldier, CORPSE_AT);
}

describe('a merc seeing a rotting corpse (Rotting_Corpses.cc LookForAndMayCommentOnSeeingCorpse)', () => {
  it('says the gross-out quote and resets his tolerance to Random(3) + 1, then draws Random(2) for the squad', () => {
    const s = scene();
    look(s, [2, SQUAD_SPARED]);
    expect(s.said).toEqual([[s.merc.id, MercQuote.HEADSHOT]]);
    expect(s.draws).toEqual([RESET_CHOICES, SQUAD_ODDS]);
    expect(tolerance(s, s.merc)).toBe(3);
  });

  it('adds one to the tolerance of every merc on the map with OKLIFE on Random(2) == 1, the speaker after his reset included', () => {
    const s = scene();
    const other = spawnSoldier(s.sim, 1, Team.OUR, OTHER_AT, Direction.SOUTH, { profile: HEAD_SHOT_ONLY });
    const dying = spawnSoldier(s.sim, 2, Team.OUR, OTHER_AT + 2, Direction.SOUTH, { profile: HEAD_SHOT_ONLY });
    dying.life = OKLIFE - 1;
    const away = spawnSoldier(s.sim, 3, Team.OUR, OTHER_AT + 4, Direction.SOUTH, { profile: HEAD_SHOT_ONLY });
    away.gridNo = NOWHERE;
    look(s, [0, SQUAD_HARDENS]);
    expect([tolerance(s, s.merc), tolerance(s, other), tolerance(s, dying), tolerance(s, away)]).toEqual([2, 1, 0, 0]);
  });

  it('keeps quiet without a draw above his tolerance threshold, and comments again once the days brought it down to 0', () => {
    const s = scene();
    setTolerance(s, s.merc, 1);
    look(s, []);
    expect([s.said, s.draws]).toEqual([[], []]);
    setTolerance(s, s.merc, 0);
    look(s, [0, SQUAD_SPARED]);
    expect(s.said).toHaveLength(1);
  });

  it('comments at a tolerance of 1 too while crows feed on the corpse', () => {
    const s = scene(GROSSED_OUT, corpse(ROTTING_STAGE2, 2));
    setTolerance(s, s.merc, 1);
    look(s, [0, SQUAD_SPARED]);
    setTolerance(s, s.merc, 2);
    look(s, []);
    expect(s.said).toEqual([[s.merc.id, MercQuote.HEADSHOT]]);
  });

  it('never comments for a head-shot-only profile, a profile past the 75 entries of QuoteExp_HeadShotOnly or a corpse not yet rotting', () => {
    for (const quiet of [scene(HEAD_SHOT_ONLY), scene(PAST_THE_TABLE), scene(NO_PROFILE), scene(GROSSED_OUT, corpse(FRESH_CORPSE))]) {
      look(quiet, []);
      expect([quiet.said, quiet.draws]).toEqual([[], []]);
    }
  });

  it('comments on a corpse lying on the ground below the roof tile he looks at: GetCorpseAtGridNo ignores the level', () => {
    const s = scene();
    s.merc.level = 1;
    look(s, [0, SQUAD_SPARED]);
    expect(s.said).toEqual([[s.merc.id, MercQuote.HEADSHOT]]);
  });

  it('is what a look that reveals items does on each tile it reaches (FOV.cc RevealRoofsAndItems)', () => {
    const s = scene();
    s.script.push(0, SQUAD_SPARED);
    revealRoofsAndItems(s.t, s.merc, true);
    expect(s.said).toEqual([[s.merc.id, MercQuote.HEADSHOT]]);
    expect(s.draws).toEqual([RESET_CHOICES, SQUAD_ODDS]);
  });
});

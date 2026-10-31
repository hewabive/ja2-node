import { beforeAll, describe, expect, it } from 'vitest';
import { newCombatSim, spawnSoldier } from '../../../tests/support/combat.ts';
import { loadTestContent } from '../../../tests/support/tactical.ts';
import { Direction, gridNo } from '../../content/world/grid.ts';
import { Assignment } from '../strategic/economy/constants.ts';
import type { TacticalContent } from './content.ts';
import { MercQuote, QuoteSaidFlag } from './narrative/merc-quotes.ts';
import type { QuoteSaidRecord } from './narrative/port.ts';
import { NO_SELECTION, SelectFlags, selectSoldier } from './selection.ts';
import { NO_PROFILE, Personality, type Soldier, TEAM_FIRST_ID, Team } from './soldier.ts';
import type { TacticalState } from './state.ts';
import type { TacticalSim } from './tactical-sim.ts';
import { enterCombatMode, startPlayerTeamTurn } from './turns/turns.ts';

let content: TacticalContent;

beforeAll(async () => {
  content = await loadTestContent();
});

const FIRST_PROFILE = 4;
const PERSONALITY_QUOTE_ODDS = 50;
const SAYS_IT = 0;
const KEEPS_QUIET = 1;
const DYING = 10;
const ENEMY_ID = TEAM_FIRST_ID[Team.ENEMY];
const FAR_AWAY = gridNo(80, 130);

interface Scene {
  readonly sim: TacticalSim;
  readonly t: TacticalState;
  readonly mercs: readonly Soldier[];
  readonly asleep: Set<number>;
  readonly woken: number[];
  readonly squads: number[];
  readonly said: [number, number][];
  readonly draws: number[];
  readonly script: number[];
  readonly flags: Map<number, QuoteSaidRecord>;
  readonly assignments: Map<number, number>;
  readonly playerCharacters: Set<number>;
}

function scene(count = 3): Scene {
  const sim = newCombatSim(content);
  const t = sim.state;
  const mercs = Array.from({ length: count }, (_, k) =>
    spawnSoldier(sim, k, Team.OUR, gridNo(80 + 2 * k, 80), Direction.SOUTH, { profile: FIRST_PROFILE + k }),
  );
  const s: Scene = {
    sim,
    t,
    mercs,
    asleep: new Set(),
    woken: [],
    squads: [],
    said: [],
    draws: [],
    script: [],
    flags: new Map(),
    assignments: new Map(),
    playerCharacters: new Set(),
  };
  t.narrative = {
    ...t.narrative,
    mercAsleep: (m) => s.asleep.has(m.id),
    putMercInAwakeState: (m) => {
      s.asleep.delete(m.id);
      s.woken.push(m.id);
    },
    setCurrentSquad: (m) => s.squads.push(m.id),
    assignment: (m) => s.assignments.get(m.id) ?? null,
    isPlayerCharacter: (m) => s.playerCharacters.has(m.id),
    sayQuote: (m, quote) => s.said.push([m.id, quote]),
    quoteSaidFlags: (m) => {
      const record = s.flags.get(m.id) ?? { quoteSaidFlags: 0, quoteSaidExtFlags: 0 };
      s.flags.set(m.id, record);
      return record;
    },
  };
  const rng = t.rng as unknown as { int(n: number): number };
  rng.int = (n: number) => {
    s.draws.push(n);
    const v = s.script.shift();
    if (v === undefined || v >= n) throw new Error(`unscripted draw of ${n}`);
    return v;
  };
  return s;
}

function merc(s: Scene, k: number): Soldier {
  const m = s.mercs[k];
  if (!m) throw new Error(`no merc ${k}`);
  return m;
}

function psycho(s: Scene, k: number): Soldier {
  return Object.assign(merc(s, k), { personalityTrait: Personality.PSYCHO });
}

function select(s: Scene, soldier: number, group?: readonly number[]) {
  return s.sim.dispatch({ type: 'select', soldier, ...(group ? { group } : {}) });
}

function refusalOf(result: ReturnType<TacticalSim['dispatch']>): string | null {
  return result.ok ? null : result.data.refusal;
}

describe('selecting a merc (Overhead.cc SelectSoldier)', () => {
  it('selects with select, sets his squad, wakes him and draws Random(50) for a psycho who has not said his personality quote', () => {
    const s = scene();
    psycho(s, 1);
    s.asleep.add(1);
    s.script.push(KEEPS_QUIET);
    expect(select(s, 1)).toEqual({ ok: true, data: { woke: [1] } });
    expect([s.t.turn.selected, s.squads, s.woken, s.draws, s.said]).toEqual([1, [1], [1], [PERSONALITY_QUOTE_ODDS], []]);
    expect(s.flags.get(1)?.quoteSaidFlags ?? 0).toBe(0);
  });

  it('says the personality quote on a 0 and never draws for it again (SOLDIER_QUOTE_SAID_PERSONALITY)', () => {
    const s = scene();
    psycho(s, 1);
    s.script.push(SAYS_IT);
    expect(select(s, 1).ok).toBe(true);
    expect(s.said).toEqual([[1, MercQuote.PERSONALITY_TRAIT]]);
    expect(s.flags.get(1)?.quoteSaidFlags).toBe(QuoteSaidFlag.PERSONALITY);
    expect(select(s, 0).ok).toBe(true);
    expect(select(s, 1).ok).toBe(true);
    expect(s.draws).toEqual([PERSONALITY_QUOTE_ODDS]);
  });

  it('draws for nobody but a psycho with a profile who is no player character', () => {
    const s = scene();
    psycho(s, 0);
    s.playerCharacters.add(0);
    Object.assign(psycho(s, 1), { profile: NO_PROFILE });
    for (const k of [0, 1, 2]) expect(select(s, k).ok).toBe(true);
    expect(s.draws).toEqual([]);
  });

  it('leaves the merc already selected alone: refused alreadySelected, no wake, no draw', () => {
    const s = scene();
    psycho(s, 1);
    s.script.push(KEEPS_QUIET);
    expect(select(s, 1).ok).toBe(true);
    s.asleep.add(1);
    expect(refusalOf(select(s, 1))).toBe('alreadySelected');
    expect([s.woken, s.draws, s.asleep.has(1)]).toEqual([[], [PERSONALITY_QUOTE_ODDS], true]);
  });

  it('wakes and draws again for the selected merc with FORCE_RESELECT, as interrupts and the combat start select', () => {
    const s = scene();
    psycho(s, 1);
    s.script.push(KEEPS_QUIET, KEEPS_QUIET);
    selectSoldier(s.t, merc(s, 1));
    s.asleep.add(1);
    expect(selectSoldier(s.t, merc(s, 1))).toBe(false);
    expect(selectSoldier(s.t, merc(s, 1), SelectFlags.FORCE_RESELECT)).toBe(true);
    expect([s.woken, s.draws]).toEqual([[1], [PERSONALITY_QUOTE_ODDS, PERSONALITY_QUOTE_ODDS]]);
  });

  it('refuses like the early returns of SelectSoldier: a merc out of control or without a move in our interrupt', () => {
    const s = scene();
    spawnSoldier(s.sim, ENEMY_ID, Team.ENEMY, FAR_AWAY, Direction.SOUTH);
    merc(s, 0).life = DYING;
    s.assignments.set(2, Assignment.DOCTOR);
    expect([refusalOf(select(s, ENEMY_ID)), refusalOf(select(s, 0)), refusalOf(select(s, 2))]).toEqual([
      'noSuchSoldier',
      'cannotAct',
      'onAssignment',
    ]);
    s.t.inCombat = true;
    s.t.turn.currentTeam = Team.OUR;
    s.t.turn.intList.push(merc(s, 1));
    merc(s, 1).moved = true;
    expect(refusalOf(select(s, 1))).toBe('mercUnavailable');
    s.t.turn.currentTeam = Team.ENEMY;
    expect(refusalOf(select(s, 1))).toBe('notYourTurn');
    expect([s.t.turn.selected, s.squads, s.draws]).toEqual([NO_SELECTION, [], []]);
  });
});

describe('an order selects his merc before its own checks, as the player selects a merc to order him', () => {
  it('wakes and selects a sleeping merc an order addresses, also when the order is then refused', () => {
    const s = scene();
    psycho(s, 1);
    s.asleep.add(1);
    s.script.push(KEEPS_QUIET);
    expect(refusalOf(s.sim.dispatch({ type: 'turn', soldier: 1, direction: 9 }))).toBe('badDirection');
    expect([s.t.turn.selected, s.woken, s.draws]).toEqual([1, [1], [PERSONALITY_QUOTE_ODDS]]);
  });

  it('wakes a merc ordered as one of the multi-selection without selecting him or drawing (multiSelected)', () => {
    const s = scene();
    expect(select(s, 0).ok).toBe(true);
    psycho(s, 1);
    s.asleep.add(1);
    expect(s.sim.dispatch({ type: 'turn', soldier: 1, direction: Direction.NORTH, multiSelected: true }).ok).toBe(true);
    expect(s.sim.dispatch({ type: 'stance', soldier: 1, stance: 'crouch', multiSelected: true }).ok).toBe(true);
    expect([s.t.turn.selected, s.woken, s.draws]).toEqual([0, [1], []]);
  });
});

describe('the end of a multi-selection (Handle_UI.cc EndMultiSoldierSelection)', () => {
  it('wakes every multi-selected merc in team order, then selects the chosen one', () => {
    const s = scene();
    s.asleep.add(0).add(2);
    expect(select(s, 1, [2, 0])).toEqual({ ok: true, data: { woke: [0, 2] } });
    expect([s.woken, s.t.turn.selected]).toEqual([[0, 2], 1]);
  });

  it('still wakes the group, the chosen merc too, when he is selected already, and draws for none of them', () => {
    const s = scene();
    expect(select(s, 1).ok).toBe(true);
    psycho(s, 2);
    s.asleep.add(2);
    expect(select(s, 1, [2])).toEqual({ ok: true, data: { woke: [2] } });
    s.asleep.add(1);
    expect(select(s, 1, [])).toEqual({ ok: true, data: { woke: [1] } });
    expect([s.t.turn.selected, s.draws]).toEqual([1, []]);
  });

  it('refuses a group in turn-based combat, where there is no multi-selection, and one with a merc out of control', () => {
    const s = scene();
    merc(s, 2).life = DYING;
    expect(refusalOf(select(s, 0, [2]))).toBe('badGroup');
    s.t.inCombat = true;
    s.t.turn.currentTeam = Team.OUR;
    expect(refusalOf(select(s, 0, [1]))).toBe('inCombat');
    expect(s.t.turn.selected).toBe(NO_SELECTION);
  });
});

describe('the selections the sim makes itself', () => {
  it('selects every merc of ours with an opponent when combat starts on our turn, waking a sleeper among them (EnterCombatMode)', () => {
    const s = scene();
    spawnSoldier(s.sim, ENEMY_ID, Team.ENEMY, FAR_AWAY, Direction.SOUTH);
    s.asleep.add(2);
    merc(s, 1).ai.oppCount = 1;
    merc(s, 2).ai.oppCount = 1;
    enterCombatMode(s.t, Team.OUR);
    expect([s.t.turn.selected, s.squads, s.woken]).toEqual([2, [1, 2], [2]]);
  });

  it('selects the first controllable merc of the team, not the one after him, when the selected merc is down at our turn (SelectNextAvailSoldier)', () => {
    const s = scene();
    expect(select(s, 1).ok).toBe(true);
    s.t.inCombat = true;
    merc(s, 1).life = DYING;
    s.asleep.add(0);
    startPlayerTeamTurn(s.t, true);
    expect([s.t.turn.selected, s.woken]).toEqual([0, [0]]);
    for (const k of [0, 2]) merc(s, k).life = DYING;
    startPlayerTeamTurn(s.t, true);
    expect(s.t.turn.selected).toBe(NO_SELECTION);
  });
});

import { describe, expect, it } from 'vitest';
import { type FakeHost, fakeHost, testSoldier } from '../../../tests/support/narrative.ts';
import { Assignment } from '../strategic/economy/constants.ts';
import { MercQuote } from '../tactical/narrative/merc-quotes.ts';
import type { PathEnv } from '../tactical/pathfinding.ts';
import { type Soldier, Team } from '../tactical/soldier.ts';
import type { TacticalState } from '../tactical/state.ts';
import { stepDialogue } from './converse.ts';
import {
  beginLoggingForBleedMeToos,
  characterDialogue,
  delayedTacticalCharacterDialogue,
  signalItemLocatorStart,
  tacticalCharacterDialogue,
} from './dialogue-queue.ts';

const MERC_PROFILE = 5;
const OTHER_PROFILE = 6;
const MERC_AT = 12_880;
const OTHER_AT = 12_890;
const SPOTTED_SOMETHING_TWO = 12;
const CONSCIOUS_BUT_DYING = 12;
const LINE_BUDGET = 1000;

function tacticalOf(host: FakeHost): TacticalState {
  const t = host.tactical();
  if (!t) throw new Error('no tactical state');
  return t;
}

function mercQuotesSaid(host: FakeHost): number[] {
  return host.emitted.flatMap((e) => (e.type === 'mercQuote' ? [e.id] : []));
}

function runQueueToTheEnd(host: FakeHost): void {
  for (let i = 0; i < LINE_BUDGET && (host.talk.queue.length > 0 || host.talk.face !== null); i++) {
    stepDialogue(host);
    host.advance();
  }
}

function sleepingMerc(): { host: FakeHost; merc: Soldier } {
  const merc = testSoldier(0, Team.OUR, MERC_PROFILE, MERC_AT);
  return { host: fakeHost({ soldiers: [merc], asleep: [merc.id] }), merc };
}

describe('the items-seen quote (Overhead.cc MakeCharacterDialogueEventSignalItemLocatorStart)', () => {
  it('unlocks the item locators and picks quote 11 or 12 with Random(2) only when the queue runs it', () => {
    const merc = testSoldier(0, Team.OUR, MERC_PROFILE, MERC_AT);
    const host = fakeHost({ soldiers: [merc], draws: [1] });
    const t = tacticalOf(host);
    t.turn.lockItemLocators = true;
    signalItemLocatorStart(host, merc);
    expect(host.drawsTaken).toEqual([]);
    expect(t.turn.lockItemLocators).toBe(true);
    stepDialogue(host);
    expect(host.drawsTaken).toEqual([2]);
    expect(t.turn.lockItemLocators).toBe(false);
    expect(host.emitted).toContainEqual(expect.objectContaining({ type: 'mercQuote', soldier: merc.id, id: SPOTTED_SOMETHING_TWO }));
    expect(host.talk.queue).toEqual([]);
  });
});

describe('who may say a line (Dialogue_Control.cc CanSayQuote, ExecuteCharacterDialogue)', () => {
  it('keeps a gassed merc quiet, queued or delayed', () => {
    const merc = testSoldier(0, Team.OUR, MERC_PROFILE, MERC_AT);
    const host = fakeHost({ soldiers: [merc] });
    tacticalOf(host).explosives.gassed[merc.id] = 1;
    expect(tacticalCharacterDialogue(host, merc, MercQuote.HEADSHOT)).toBe(false);
    expect(delayedTacticalCharacterDialogue(host, merc, MercQuote.HEADSHOT)).toBe(false);
    expect(host.talk.queue).toEqual([]);
  });

  it('keeps a merc held prisoner quiet', () => {
    const merc = testSoldier(0, Team.OUR, MERC_PROFILE, MERC_AT);
    const host = fakeHost({ soldiers: [merc], assignments: { [merc.id]: Assignment.ASSIGNMENT_POW } });
    expect(tacticalCharacterDialogue(host, merc, MercQuote.HEADSHOT)).toBe(false);
    expect(host.talk.queue).toEqual([]);
  });

  it('lets a dying merc who is still conscious say the seriously-wounded line (14) and nothing else', () => {
    const merc = testSoldier(0, Team.OUR, MERC_PROFILE, MERC_AT);
    merc.life = CONSCIOUS_BUT_DYING;
    const host = fakeHost({ soldiers: [merc] });
    expect(tacticalCharacterDialogue(host, merc, MercQuote.ATTACKED_BY_MULTIPLE_CREATURES)).toBe(false);
    expect(tacticalCharacterDialogue(host, merc, MercQuote.SERIOUSLY_WOUNDED)).toBe(true);
    runQueueToTheEnd(host);
    expect(mercQuotesSaid(host)).toEqual([MercQuote.SERIOUSLY_WOUNDED]);
  });

  it('drops a queued line when its speaker is gassed or captured by the time it plays', () => {
    const merc = testSoldier(0, Team.OUR, MERC_PROFILE, MERC_AT);
    const assignments: Record<number, number> = {};
    const host = fakeHost({ soldiers: [merc], assignments });
    tacticalCharacterDialogue(host, merc, MercQuote.HEADSHOT);
    tacticalCharacterDialogue(host, merc, MercQuote.KILLED_AN_ENEMY);
    tacticalOf(host).explosives.gassed[merc.id] = 1;
    stepDialogue(host);
    tacticalOf(host).explosives.gassed[merc.id] = 0;
    assignments[merc.id] = Assignment.ASSIGNMENT_POW;
    runQueueToTheEnd(host);
    expect(mercQuotesSaid(host)).toEqual([]);
    expect(host.talk.lastQuoteSaid).toBe(MercQuote.KILLED_AN_ENEMY);
  });
});

describe('auto-bandage mode (Dialogue_Control.cc HandleDialogue)', () => {
  it('drops the event at the head of the queue without running it', () => {
    const merc = testSoldier(0, Team.OUR, MERC_PROFILE, MERC_AT);
    const host = fakeHost({ soldiers: [merc] });
    tacticalCharacterDialogue(host, merc, MercQuote.HEADSHOT);
    tacticalCharacterDialogue(host, merc, MercQuote.KILLED_AN_ENEMY);
    const env = tacticalOf(host).pathEnv as { -readonly [K in keyof PathEnv]: PathEnv[K] };
    env.autoBandage = true;
    stepDialogue(host);
    expect(host.talk.queue).toHaveLength(1);
    expect(host.talk.face).toBeNull();
    env.autoBandage = false;
    runQueueToTheEnd(host);
    expect(mercQuotesSaid(host)).toEqual([MercQuote.KILLED_AN_ENEMY]);
  });
});

describe('a sleeping speaker (Dialogue_Control.cc DialogueEventQuote, MakeCharacterDialogueEventSleep)', () => {
  it('wakes for his line without the waking rules and goes back to sleep when the line is over', () => {
    const { host, merc } = sleepingMerc();
    tacticalCharacterDialogue(host, merc, MercQuote.HEADSHOT);
    stepDialogue(host);
    expect(host.mercAsleep?.(merc)).toBe(false);
    expect(mercQuotesSaid(host)).toEqual([MercQuote.HEADSHOT]);
    expect(host.talk.queue).toEqual([{ kind: 'backToSleep', speaker: MERC_PROFILE }]);
    runQueueToTheEnd(host);
    expect(host.mercAsleep?.(merc)).toBe(true);
  });

  it('sleeps again only after the events queued before his line ended: the sleep event goes to the back of the queue', () => {
    const { host, merc } = sleepingMerc();
    const other = testSoldier(1, Team.OUR, OTHER_PROFILE, OTHER_AT);
    tacticalOf(host).soldiers[other.id] = other;
    tacticalCharacterDialogue(host, merc, MercQuote.HEADSHOT);
    tacticalCharacterDialogue(host, other, MercQuote.HEADSHOT);
    tacticalCharacterDialogue(host, merc, MercQuote.KILLED_AN_ENEMY);
    stepDialogue(host);
    expect(host.talk.queue.map((e) => e.kind)).toEqual(['quote', 'quote', 'backToSleep']);
    const awakeWhileOthersTalk: boolean[] = [];
    for (let i = 0; i < LINE_BUDGET && host.talk.queue.length > 1; i++) {
      stepDialogue(host);
      awakeWhileOthersTalk.push(host.mercAsleep?.(merc) === false);
      host.advance();
    }
    expect(awakeWhileOthersTalk.every(Boolean)).toBe(true);
    expect(host.talk.queue).toEqual([{ kind: 'backToSleep', speaker: MERC_PROFILE }]);
    runQueueToTheEnd(host);
    expect(mercQuotesSaid(host)).toEqual([MercQuote.HEADSHOT, MercQuote.HEADSHOT, MercQuote.KILLED_AN_ENEMY]);
    expect(host.mercAsleep?.(merc)).toBe(true);
  });

  it('stays asleep while his delayed line waits for our turn', () => {
    const merc = testSoldier(0, Team.OUR, MERC_PROFILE, MERC_AT);
    const host = fakeHost({ soldiers: [merc], asleep: [merc.id], currentTeam: Team.ENEMY });
    delayedTacticalCharacterDialogue(host, merc, MercQuote.HEADSHOT);
    stepDialogue(host);
    expect(host.mercAsleep?.(merc)).toBe(true);
    expect(host.talk.queue).toHaveLength(1);
  });

  it('wakes an NPC line of his too: the wake looks up our team by profile, not the line kind', () => {
    const { host, merc } = sleepingMerc();
    characterDialogue(host, MERC_PROFILE, MercQuote.HEADSHOT, true, false);
    stepDialogue(host);
    expect(host.mercAsleep?.(merc)).toBe(false);
    runQueueToTheEnd(host);
    expect(host.mercAsleep?.(merc)).toBe(true);
  });
});

describe('the ME_TOO bleeding line (Dialogue_Control.cc TacticalCharacterDialogue, BeginLoggingForBleedMeToos)', () => {
  function threeBleeders(): { host: FakeHost; mercs: Soldier[] } {
    const mercs = [0, 1, 2].map((id) => testSoldier(id, Team.OUR, MERC_PROFILE + id, MERC_AT + id));
    return { host: fakeHost({ soldiers: mercs }), mercs };
  }

  function queuedQuotes(host: FakeHost): number[] {
    return host.talk.queue.flatMap((e) => (e.kind === 'quote' ? [e.quote] : []));
  }

  it('lets the first merc to bleed while the log is open say so and the next ones say me too', () => {
    const { host, mercs } = threeBleeders();
    beginLoggingForBleedMeToos(host.talk, true);
    for (const s of mercs) tacticalCharacterDialogue(host, s, MercQuote.STARTING_TO_BLEED);
    beginLoggingForBleedMeToos(host.talk, false);
    expect(queuedQuotes(host)).toEqual([MercQuote.STARTING_TO_BLEED, MercQuote.ME_TOO, MercQuote.ME_TOO]);
  });

  it('counts only bleeding lines that pass the speaker checks, and says them plainly while the log is closed', () => {
    const { host, mercs } = threeBleeders();
    const [first, gassed, third] = mercs as [Soldier, Soldier, Soldier];
    tacticalOf(host).explosives.gassed[gassed.id] = 1;
    beginLoggingForBleedMeToos(host.talk, true);
    tacticalCharacterDialogue(host, gassed, MercQuote.STARTING_TO_BLEED);
    tacticalCharacterDialogue(host, first, MercQuote.HEADSHOT);
    tacticalCharacterDialogue(host, first, MercQuote.STARTING_TO_BLEED);
    beginLoggingForBleedMeToos(host.talk, false);
    tacticalCharacterDialogue(host, third, MercQuote.STARTING_TO_BLEED);
    expect(queuedQuotes(host)).toEqual([MercQuote.HEADSHOT, MercQuote.STARTING_TO_BLEED, MercQuote.STARTING_TO_BLEED]);
  });
});

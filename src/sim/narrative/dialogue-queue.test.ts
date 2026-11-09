import { describe, expect, it } from 'vitest';
import { type FakeHost, fakeHost, LOCK_PAUSE_MERC_TALKING, testSoldier } from '../../../tests/support/narrative.ts';
import { NO_PROFILE } from '../../content/narrative/npc-constants.ts';
import { Assignment } from '../strategic/economy/constants.ts';
import { MercQuote } from '../tactical/narrative/merc-quotes.ts';
import type { PathEnv } from '../tactical/pathfinding.ts';
import { NOWHERE, type Soldier, Team } from '../tactical/soldier.ts';
import type { TacticalState } from '../tactical/state.ts';
import { finishTalkingFace, shutUpTalkingFace, stepDialogue } from './converse.ts';
import {
  addDialogueEvent,
  beginLoggingForBleedMeToos,
  characterDialogue,
  characterDialogueUsingAlternateFile,
  delayedTacticalCharacterDialogue,
  deleteSoldierFace,
  emptyDialogueQueue,
  externalNpcDialogue,
  FINAL_TALKING_DELAY_TICKS,
  handleImportantMercQuote,
  quietDialogueForLoad,
  setStopTimeQuoteCallback,
  signalItemLocatorStart,
  tacticalCharacterDialogue,
  tacticalFrameIsModal,
} from './dialogue-queue.ts';
import { NarrativeProfile } from './narrative-ids.ts';
import { TacticalModal } from './talk-state.ts';

const MERC_PROFILE = 5;
const OTHER_PROFILE = 6;
const MERC_AT = 12_880;
const OTHER_AT = 12_890;
const ITEMS_AT = 12_884;
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
    signalItemLocatorStart(host, merc, ITEMS_AT);
    expect(host.drawsTaken).toEqual([]);
    expect(t.turn.lockItemLocators).toBe(true);
    stepDialogue(host);
    expect(host.drawsTaken).toEqual([2]);
    expect(t.turn.lockItemLocators).toBe(false);
    expect(host.emitted).toContainEqual(expect.objectContaining({ type: 'mercQuote', soldier: merc.id, id: SPOTTED_SOMETHING_TWO }));
    expect(host.talk.queue).toEqual([]);
  });

  it('slides the view to the items it was queued for as it starts, before the line (SlideToLocation)', () => {
    const merc = testSoldier(0, Team.OUR, MERC_PROFILE, MERC_AT);
    const host = fakeHost({ soldiers: [merc], draws: [0] });
    signalItemLocatorStart(host, merc, ITEMS_AT);
    expect(host.emitted).toEqual([]);
    stepDialogue(host);
    expect(host.emitted.map((e) => e.type)).toEqual(['itemsLocated', 'mercQuote']);
    expect(host.emitted[0]).toEqual({ type: 'itemsLocated', gridNo: ITEMS_AT });
  });

  it('slides nowhere for a quote queued before the tile was kept (an older snapshot)', () => {
    const merc = testSoldier(0, Team.OUR, MERC_PROFILE, MERC_AT);
    const host = fakeHost({ soldiers: [merc], draws: [0] });
    signalItemLocatorStart(host, merc, NOWHERE);
    stepDialogue(host);
    expect(host.emitted.map((e) => e.type)).toEqual(['mercQuote']);
  });
});

describe('who may say a line (Dialogue_Control.cc CanSayQuote, ExecuteCharacterDialogue)', () => {
  it('keeps a gassed merc quiet, queued or delayed', () => {
    const merc = testSoldier(0, Team.OUR, MERC_PROFILE, MERC_AT);
    const host = fakeHost({ soldiers: [merc] });
    merc.gassed = true;
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
    merc.gassed = true;
    stepDialogue(host);
    merc.gassed = false;
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
    gassed.gassed = true;
    beginLoggingForBleedMeToos(host.talk, true);
    tacticalCharacterDialogue(host, gassed, MercQuote.STARTING_TO_BLEED);
    tacticalCharacterDialogue(host, first, MercQuote.HEADSHOT);
    tacticalCharacterDialogue(host, first, MercQuote.STARTING_TO_BLEED);
    beginLoggingForBleedMeToos(host.talk, false);
    tacticalCharacterDialogue(host, third, MercQuote.STARTING_TO_BLEED);
    expect(queuedQuotes(host)).toEqual([MercQuote.HEADSHOT, MercQuote.STARTING_TO_BLEED, MercQuote.STARTING_TO_BLEED]);
  });
});

describe('the map screen pause for a line (Dialogue_Control.cc DialogueEventQuote::Execute, HandleDialogue)', () => {
  const GUIDE_QUOTE = 1;
  const UNPAUSED = { paused: false, pauseLocked: false };

  function mercOnTheMap(): { host: FakeHost; merc: Soldier } {
    const merc = testSoldier(0, Team.OUR, MERC_PROFILE, MERC_AT);
    return { host: fakeHost({ soldiers: [merc], inMapMode: true }), merc };
  }

  function pauseOf(host: FakeHost): { paused: boolean; pauseLocked: boolean } {
    return { paused: host.paused, pauseLocked: host.pauseLocked };
  }

  function untilTheFaceEnds(host: FakeHost): void {
    host.advance((host.talk.face?.busyUntil ?? host.now) - host.now);
  }

  function pausesWhileTheQueueRuns(host: FakeHost): boolean[] {
    const paused: boolean[] = [];
    for (let i = 0; i < LINE_BUDGET && (host.talk.queue.length > 0 || host.talk.face !== null); i++) {
      stepDialogue(host);
      paused.push(host.paused);
      host.advance();
    }
    return paused;
  }

  it('pauses the game under LOCK_PAUSE_MERC_TALKING while the line plays and lifts the pause and the lock when its face ends', () => {
    const { host, merc } = mercOnTheMap();
    tacticalCharacterDialogue(host, merc, MercQuote.HEADSHOT);
    stepDialogue(host);
    expect(mercQuotesSaid(host)).toEqual([MercQuote.HEADSHOT]);
    expect({ ...pauseOf(host), reason: host.pauseLockReason }).toEqual({
      paused: true,
      pauseLocked: true,
      reason: LOCK_PAUSE_MERC_TALKING,
    });
    expect(host.talk.pausedForLine).toBe(true);
    host.advance((host.talk.face?.busyUntil ?? 0) - host.now - 1);
    stepDialogue(host);
    expect(pauseOf(host)).toEqual({ paused: true, pauseLocked: true });
    host.advance();
    stepDialogue(host);
    expect(host.talk.face).toBeNull();
    expect(pauseOf(host)).toEqual(UNPAUSED);
    expect(host.talk.pausedForLine).toBe(false);
  });

  it('keeps the game paused from one line to the next: one ends and the next starts in the same pass', () => {
    const { host, merc } = mercOnTheMap();
    tacticalCharacterDialogue(host, merc, MercQuote.HEADSHOT);
    tacticalCharacterDialogue(host, merc, MercQuote.KILLED_AN_ENEMY);
    const paused = pausesWhileTheQueueRuns(host);
    expect(mercQuotesSaid(host)).toEqual([MercQuote.HEADSHOT, MercQuote.KILLED_AN_ENEMY]);
    expect(paused.slice(0, -1).every(Boolean)).toBe(true);
    expect(pauseOf(host)).toEqual(UNPAUSED);
  });

  it('says a line in a pause it did not make without locking it, and leaves the game paused after it', () => {
    const { host, merc } = mercOnTheMap();
    host.paused = true;
    tacticalCharacterDialogue(host, merc, MercQuote.HEADSHOT);
    stepDialogue(host);
    expect(mercQuotesSaid(host)).toEqual([MercQuote.HEADSHOT]);
    expect(pauseOf(host)).toEqual({ paused: true, pauseLocked: false });
    runQueueToTheEnd(host);
    expect(pauseOf(host)).toEqual({ paused: true, pauseLocked: false });
    expect(host.talk.pausedForLine).toBe(false);
  });

  it('never pauses for a line said outside the map screen', () => {
    const merc = testSoldier(0, Team.OUR, MERC_PROFILE, MERC_AT);
    const host = fakeHost({ soldiers: [merc] });
    tacticalCharacterDialogue(host, merc, MercQuote.HEADSHOT);
    expect(pausesWhileTheQueueRuns(host).some(Boolean)).toBe(false);
    expect(mercQuotesSaid(host)).toEqual([MercQuote.HEADSHOT]);
  });

  it("pauses only for a queued quote: the alternate file's line, the items-seen line and a merc's trigger line play unpaused", () => {
    const { host, merc } = mercOnTheMap();
    characterDialogueUsingAlternateFile(host, MERC_PROFILE, GUIDE_QUOTE);
    signalItemLocatorStart(host, merc, ITEMS_AT);
    addDialogueEvent(host, { kind: 'pcTriggerNpc', speaker: MERC_PROFILE, quote: MercQuote.HEADSHOT, npc: OTHER_PROFILE, record: 0 });
    expect(pausesWhileTheQueueRuns(host).some(Boolean)).toBe(false);
    expect(mercQuotesSaid(host)).toHaveLength(3);
  });

  it('pauses for a line its speaker can no longer say until the next pass ends the empty face', () => {
    const { host, merc } = mercOnTheMap();
    tacticalCharacterDialogue(host, merc, MercQuote.HEADSHOT);
    merc.gassed = true;
    stepDialogue(host);
    expect(mercQuotesSaid(host)).toEqual([]);
    expect(pauseOf(host)).toEqual({ paused: true, pauseLocked: true });
    stepDialogue(host);
    expect(pauseOf(host)).toEqual(UNPAUSED);
  });

  it('lifts the pause at once when the line is cut short', () => {
    const { host, merc } = mercOnTheMap();
    tacticalCharacterDialogue(host, merc, MercQuote.HEADSHOT);
    stepDialogue(host);
    expect(pauseOf(host)).toEqual({ paused: true, pauseLocked: true });
    host.advance();
    expect(shutUpTalkingFace(host)).toBe(true);
    expect(pauseOf(host)).toEqual(UNPAUSED);
  });

  it('lifts the pause after the closing 300 ms when a viewer finished the line', () => {
    const { host, merc } = mercOnTheMap();
    tacticalCharacterDialogue(host, merc, MercQuote.HEADSHOT);
    stepDialogue(host);
    expect(finishTalkingFace(host)).toBe(true);
    host.advance(FINAL_TALKING_DELAY_TICKS - 1);
    stepDialogue(host);
    expect(pauseOf(host)).toEqual({ paused: true, pauseLocked: true });
    host.advance();
    stepDialogue(host);
    expect(pauseOf(host)).toEqual(UNPAUSED);
  });

  it('lifts the pause when the face ends even after the queue was emptied under it', () => {
    const { host, merc } = mercOnTheMap();
    tacticalCharacterDialogue(host, merc, MercQuote.HEADSHOT);
    tacticalCharacterDialogue(host, merc, MercQuote.KILLED_AN_ENEMY);
    stepDialogue(host);
    expect(pauseOf(host)).toEqual({ paused: true, pauseLocked: true });
    emptyDialogueQueue(host);
    untilTheFaceEnds(host);
    stepDialogue(host);
    expect(mercQuotesSaid(host)).toEqual([MercQuote.HEADSHOT]);
    expect(pauseOf(host)).toEqual(UNPAUSED);
  });

  it('lifts a pause lock it did not take: one lock flag, so a conversation engaged during the line loses its pause', () => {
    const { host, merc } = mercOnTheMap();
    tacticalCharacterDialogue(host, merc, MercQuote.HEADSHOT);
    stepDialogue(host);
    host.mapMode = false;
    host.setEngaged(true);
    untilTheFaceEnds(host);
    stepDialogue(host);
    expect(host.engaged()).toBe(true);
    expect(pauseOf(host)).toEqual(UNPAUSED);
  });
});

describe('an important merc line (Dialogue_Control.cc HandleImportantMercQuote)', () => {
  const CONTRACTS_OVER = 89;

  it('wakes a sleeping merc with an event before his line and puts him back to sleep with one after it', () => {
    const { host, merc } = sleepingMerc();
    handleImportantMercQuote(host, merc, CONTRACTS_OVER);
    expect(host.talk.queue.map((e) => e.kind)).toEqual(['wakeUp', 'quote', 'backToSleep']);
    stepDialogue(host);
    expect(host.mercAsleep?.(merc)).toBe(false);
    expect(host.talk.queue.map((e) => e.kind)).toEqual(['quote', 'backToSleep']);
    runQueueToTheEnd(host);
    expect(mercQuotesSaid(host)).toEqual([CONTRACTS_OVER]);
    expect(host.mercAsleep?.(merc)).toBe(true);
  });

  it('queues the wake and the sleep events even when the merc may not say the line', () => {
    const { host, merc } = sleepingMerc();
    merc.gassed = true;
    handleImportantMercQuote(host, merc, CONTRACTS_OVER);
    expect(host.talk.queue.map((e) => e.kind)).toEqual(['wakeUp', 'backToSleep']);
  });

  it("queues an awake merc's line alone", () => {
    const merc = testSoldier(0, Team.OUR, MERC_PROFILE, MERC_AT);
    const host = fakeHost({ soldiers: [merc] });
    handleImportantMercQuote(host, merc, CONTRACTS_OVER);
    expect(host.talk.queue.map((e) => e.kind)).toEqual(['quote']);
  });
});

describe('the merc a line is about', () => {
  it('rides the queue with the line and comes out as the subject of its mercQuote', () => {
    const merc = testSoldier(0, Team.OUR, MERC_PROFILE, MERC_AT);
    const host = fakeHost({ soldiers: [merc] });
    tacticalCharacterDialogue(host, merc, MercQuote.HEADSHOT, OTHER_PROFILE);
    stepDialogue(host);
    expect(host.emitted).toContainEqual(expect.objectContaining({ type: 'mercQuote', id: MercQuote.HEADSHOT, subject: OTHER_PROFILE }));
  });
});

describe('an external face (Dialogue_Control.cc CharacterDialogue with DIALOGUE_EXTERNAL_NPC_UI)', () => {
  const SKYRIDER_SAYS_HI = 23;
  const FRED = 106;
  const FRED_RUNNING_OUT = 17;
  const FREDS_MINE = 2;

  function onTheMap(): FakeHost {
    return fakeHost({ inMapMode: true });
  }

  it("says Skyrider's line without a soldier, as a skyriderQuote, and pauses the map screen while it plays", () => {
    const host = onTheMap();
    externalNpcDialogue(host, NarrativeProfile.SKYRIDER, SKYRIDER_SAYS_HI);
    stepDialogue(host);
    expect(host.emitted).toEqual([
      expect.objectContaining({ type: 'skyriderQuote', profile: NarrativeProfile.SKYRIDER, quote: SKYRIDER_SAYS_HI, chars: 10 }),
    ]);
    expect({ paused: host.paused, pauseLocked: host.pauseLocked }).toEqual({ paused: true, pauseLocked: true });
    runQueueToTheEnd(host);
    expect(host.paused).toBe(false);
  });

  it("says a head miner's line as a headMinerQuote of his mine", () => {
    const host = onTheMap();
    Object.assign(host, { headMinerMine: (profile: number) => (profile === FRED ? FREDS_MINE : -1) });
    externalNpcDialogue(host, FRED, FRED_RUNNING_OUT);
    stepDialogue(host);
    expect(host.emitted).toEqual([
      expect.objectContaining({ type: 'headMinerQuote', mine: FREDS_MINE, profile: FRED, quote: FRED_RUNNING_OUT }),
    ]);
  });

  it("names the head miner's soldier in the loaded sector, whose panel his popup takes (RenderFaceOverlay)", () => {
    const fred = testSoldier(5, Team.CIV, FRED, MERC_AT);
    const host = fakeHost({ soldiers: [fred], inMapMode: true });
    externalNpcDialogue(host, FRED, FRED_RUNNING_OUT);
    externalNpcDialogue(host, NarrativeProfile.SKYRIDER, SKYRIDER_SAYS_HI);
    runQueueToTheEnd(host);
    expect(host.emitted[0]).toMatchObject({ type: 'headMinerQuote', soldier: fred.id });
    expect(host.emitted[1]).not.toHaveProperty('soldier');
  });

  it("carries the bars of the head miner's soldier, which his popup draws while he talks (RenderFaceOverlay, DrawSoldierUIBars)", () => {
    const fred = testSoldier(5, Team.CIV, FRED, MERC_AT);
    Object.assign(fred, { life: 61, lifeMax: 75, bleeding: 4, breath: 50, breathMax: 90, morale: 33 });
    const host = fakeHost({ soldiers: [fred] });
    externalNpcDialogue(host, FRED, FRED_RUNNING_OUT);
    externalNpcDialogue(host, NarrativeProfile.SKYRIDER, SKYRIDER_SAYS_HI);
    runQueueToTheEnd(host);
    const bars = { life: 61, lifeMax: 75, bleeding: 4, breath: 50, breathMax: 90, morale: 33 };
    expect(host.emitted[0]).toMatchObject({ type: 'headMinerQuote', soldier: fred.id, bars });
    expect(host.emitted[1]).not.toHaveProperty('bars');
  });

  it("carries an NPC's bars on a line said on the map screen only, the one a switch to tactical gives his popup (HandleDialogue)", () => {
    const fred = testSoldier(5, Team.CIV, FRED, MERC_AT);
    const host = fakeHost({ soldiers: [fred], inMapMode: true });
    characterDialogue(host, FRED, FRED_RUNNING_OUT, true, false);
    runQueueToTheEnd(host);
    host.mapMode = false;
    characterDialogue(host, FRED, FRED_RUNNING_OUT, true, false);
    runQueueToTheEnd(host);
    const said = host.emitted.filter((e) => e.type === 'npcQuote');
    expect(said[0]).toMatchObject({ soldier: fred.id, bars: { life: 80, lifeMax: 80, breath: 100, morale: fred.morale } });
    expect(said[1]).toMatchObject({ soldier: fred.id });
    expect(said[1]).not.toHaveProperty('bars');
  });

  it('waits its turn behind the lines queued before it', () => {
    const merc = testSoldier(0, Team.OUR, MERC_PROFILE, MERC_AT);
    const host = fakeHost({ soldiers: [merc], inMapMode: true });
    tacticalCharacterDialogue(host, merc, MercQuote.HEADSHOT);
    externalNpcDialogue(host, NarrativeProfile.SKYRIDER, SKYRIDER_SAYS_HI);
    stepDialogue(host);
    expect(host.emitted.map((e) => e.type)).toEqual(['mercQuote']);
    runQueueToTheEnd(host);
    expect(host.emitted.map((e) => e.type)).toEqual(['mercQuote', 'skyriderQuote']);
  });
  it('takes the panel placement set since the last line ended, and puts the default back as the line ends (HandleDialogueEnd)', () => {
    const host = onTheMap();
    host.talk.externPanel = { monologue: 'drassenSam' };
    externalNpcDialogue(host, NarrativeProfile.SKYRIDER, SKYRIDER_SAYS_HI);
    externalNpcDialogue(host, NarrativeProfile.SKYRIDER, SKYRIDER_SAYS_HI);
    runQueueToTheEnd(host);
    const panels = host.emitted.flatMap((e) => (e.type === 'skyriderQuote' ? [e.panel ?? null] : []));
    expect(panels).toEqual([{ monologue: 'drassenSam' }, null]);
    expect(host.talk.externPanel).toBeNull();
  });

  it('loses a placement set while another line plays, as that line ends before the external one starts', () => {
    const merc = testSoldier(0, Team.OUR, MERC_PROFILE, MERC_AT);
    const host = fakeHost({ soldiers: [merc], inMapMode: true });
    Object.assign(host, { headMinerMine: (profile: number) => (profile === FRED ? FREDS_MINE : -1) });
    tacticalCharacterDialogue(host, merc, MercQuote.HEADSHOT);
    stepDialogue(host);
    host.talk.externPanel = { mine: FREDS_MINE };
    externalNpcDialogue(host, FRED, FRED_RUNNING_OUT);
    runQueueToTheEnd(host);
    expect(host.emitted.find((e) => e.type === 'headMinerQuote')).not.toHaveProperty('panel');
  });
});

describe('a special event that waits (DialogueEvent::Execute returning true)', () => {
  it('stays at the head of the queue while its callback asks to wait, and runs with its arguments once it may', () => {
    const merc = testSoldier(0, Team.OUR, MERC_PROFILE, MERC_AT);
    const host = fakeHost({ soldiers: [merc] });
    let open = true;
    const ran: (readonly number[])[] = [];
    Object.assign(host, {
      dialogueCallback: (_name: string, args: readonly number[]) => {
        if (open) return true;
        ran.push(args);
        return false;
      },
    });
    addDialogueEvent(host, { kind: 'callback', name: 'test:menu', args: [3, 1] });
    tacticalCharacterDialogue(host, merc, MercQuote.HEADSHOT);
    stepDialogue(host);
    stepDialogue(host);
    expect(host.talk.queue.map((e) => e.kind)).toEqual(['callback', 'quote']);
    expect(mercQuotesSaid(host)).toEqual([]);
    open = false;
    runQueueToTheEnd(host);
    expect(ran).toEqual([[3, 1]]);
    expect(mercQuotesSaid(host)).toEqual([MercQuote.HEADSHOT]);
  });
});

describe('a loaded game starts quiet (SaveLoadGame.cc LoadSavedGame: EmptyDialogueQueue, StopAnyCurrentlyTalkingSpeech)', () => {
  it('empties the queue with its callbacks and the trigger wait, and ends the talking face with its line pause and last speaker', () => {
    const merc = testSoldier(0, Team.OUR, MERC_PROFILE, MERC_AT);
    const host = fakeHost({ soldiers: [merc], inMapMode: true });
    const ran: string[] = [];
    Object.assign(host, {
      dialogueCallback: (name: string) => {
        ran.push(name);
        return false;
      },
    });
    tacticalCharacterDialogue(host, merc, MercQuote.HEADSHOT);
    tacticalCharacterDialogue(host, merc, MercQuote.KILLED_AN_ENEMY);
    addDialogueEvent(host, { kind: 'callback', name: 'test:departure', args: [merc.id, 1] });
    stepDialogue(host);
    host.talk.waitingForTrigger = true;
    expect(host.talk.face?.speaker).toBe(MERC_PROFILE);
    expect({ paused: host.paused, pauseLocked: host.pauseLocked }).toEqual({ paused: true, pauseLocked: true });
    quietDialogueForLoad(host);
    expect(host.talk).toMatchObject({
      queue: [],
      face: null,
      waitingForTrigger: false,
      pausedForLine: false,
      lastQuoteProfile: NO_PROFILE,
      lastQuoteSaid: MercQuote.HEADSHOT,
    });
    expect({ paused: host.paused, pauseLocked: host.pauseLocked }).toEqual({ paused: false, pauseLocked: false });
    runQueueToTheEnd(host);
    expect(mercQuotesSaid(host)).toEqual([MercQuote.HEADSHOT]);
    expect(ran).toEqual([]);
  });
});

describe('stop-time quotes (Dialogue_Control.cc CheckForStopTimeQuotes, GameScreen.cc EnterModalTactical, EndModalTactical)', () => {
  const CALLBACK = 'tactical:test';

  function withCallbacks(host: FakeHost): string[] {
    const ran: string[] = [];
    Object.assign(host, {
      dialogueCallback: (name: string) => {
        ran.push(name);
        return false;
      },
    });
    return ran;
  }

  function modalFrames(host: FakeHost, frames: number): boolean[] {
    return Array.from({ length: frames }, () => tacticalFrameIsModal(host.talk));
  }

  it.each([MercQuote.BOOBYTRAP_ITEM, MercQuote.SUSPICIOUS_GROUND])(
    'quote %i of our merc makes tactical modal from its start: one more full frame, then frozen until the line ends',
    (quote) => {
      const merc = testSoldier(0, Team.OUR, MERC_PROFILE, MERC_AT);
      const host = fakeHost({ soldiers: [merc] });
      const ran = withCallbacks(host);
      setStopTimeQuoteCallback(host.talk, CALLBACK);
      tacticalCharacterDialogue(host, merc, quote);
      expect(host.talk.tacticalModal).toBe(TacticalModal.OFF);
      stepDialogue(host);
      expect(host.talk.face?.modal).toBe(true);
      expect(host.talk.tacticalModal).toBe(TacticalModal.ENTERED);
      expect(modalFrames(host, 3)).toEqual([false, true, true]);
      host.advance(LINE_BUDGET);
      stepDialogue(host);
      expect(ran).toEqual([CALLBACK]);
      expect(host.talk).toMatchObject({ face: null, tacticalModal: TacticalModal.OFF, stopTimeCallback: null });
      expect(modalFrames(host, 1)).toEqual([false]);
    },
  );

  it('leaves tactical running for any other line', () => {
    const merc = testSoldier(0, Team.OUR, MERC_PROFILE, MERC_AT);
    const host = fakeHost({ soldiers: [merc] });
    const ran = withCallbacks(host);
    setStopTimeQuoteCallback(host.talk, CALLBACK);
    tacticalCharacterDialogue(host, merc, MercQuote.HEADSHOT);
    runQueueToTheEnd(host);
    expect(host.talk.tacticalModal).toBe(TacticalModal.OFF);
    expect([ran, host.talk.stopTimeCallback]).toEqual([[], CALLBACK]);
  });

  it('leaves tactical running when the speaker is no merc of ours', () => {
    const npc = testSoldier(0, Team.CIV, OTHER_PROFILE, MERC_AT);
    const host = fakeHost({ soldiers: [npc] });
    characterDialogue(host, OTHER_PROFILE, MercQuote.BOOBYTRAP_ITEM, false, false);
    stepDialogue(host);
    expect(host.talk.face?.modal).toBe(false);
    expect(host.talk.tacticalModal).toBe(TacticalModal.OFF);
  });

  it('keeps its callback waiting when the merc cannot say the line, and nothing stops', () => {
    const merc = testSoldier(0, Team.OUR, MERC_PROFILE, MERC_AT);
    merc.gassed = true;
    const host = fakeHost({ soldiers: [merc] });
    const ran = withCallbacks(host);
    setStopTimeQuoteCallback(host.talk, CALLBACK);
    expect(tacticalCharacterDialogue(host, merc, MercQuote.BOOBYTRAP_ITEM)).toBe(false);
    runQueueToTheEnd(host);
    expect([ran, host.talk.tacticalModal, host.talk.stopTimeCallback]).toEqual([[], TacticalModal.OFF, CALLBACK]);
  });

  it('still goes modal and runs the callback at the next frame when the line fails as it starts', () => {
    const merc = testSoldier(0, Team.OUR, MERC_PROFILE, MERC_AT);
    const host = fakeHost({ soldiers: [merc] });
    const ran = withCallbacks(host);
    setStopTimeQuoteCallback(host.talk, CALLBACK);
    tacticalCharacterDialogue(host, merc, MercQuote.BOOBYTRAP_ITEM);
    merc.gassed = true;
    stepDialogue(host);
    expect(mercQuotesSaid(host)).toEqual([]);
    expect(host.talk.tacticalModal).toBe(TacticalModal.ENTERED);
    host.advance();
    stepDialogue(host);
    expect(ran).toEqual([CALLBACK]);
    expect(host.talk.tacticalModal).toBe(TacticalModal.OFF);
  });

  it('ends the modal with the line a player load silences, without its callback', () => {
    const merc = testSoldier(0, Team.OUR, MERC_PROFILE, MERC_AT);
    const host = fakeHost({ soldiers: [merc] });
    const ran = withCallbacks(host);
    setStopTimeQuoteCallback(host.talk, CALLBACK);
    tacticalCharacterDialogue(host, merc, MercQuote.BOOBYTRAP_ITEM);
    stepDialogue(host);
    quietDialogueForLoad(host);
    expect([ran, host.talk.tacticalModal]).toEqual([[], TacticalModal.OFF]);
  });
});

describe('a soldier face deleted while it talks (Faces.cc DeleteFace from DeleteSoldierFace, Dialogue_Control.cc HandleDialogue)', () => {
  const SKYRIDER_SAYS_HI = 23;
  const NPC_LINE = 4;

  function twoMercs(inMapMode = false): { host: FakeHost; merc: Soldier; other: Soldier } {
    const merc = testSoldier(0, Team.OUR, MERC_PROFILE, MERC_AT);
    const other = testSoldier(1, Team.OUR, OTHER_PROFILE, OTHER_AT);
    return { host: fakeHost({ soldiers: [merc, other], inMapMode }), merc, other };
  }

  function facesDeleted(host: FakeHost): unknown[] {
    return host.emitted.filter((e) => e.type === 'soldierFaceDeleted');
  }

  it('ends his line there, with the ticks it had left, and the next pass says the next line', () => {
    const { host, merc, other } = twoMercs();
    tacticalCharacterDialogue(host, merc, MercQuote.HEADSHOT);
    tacticalCharacterDialogue(host, other, MercQuote.KILLED_AN_ENEMY);
    stepDialogue(host);
    host.advance();
    deleteSoldierFace(host, MERC_PROFILE);
    expect(facesDeleted(host)).toEqual([{ type: 'soldierFaceDeleted', profile: MERC_PROFILE, saidAt: 0 }]);
    stepDialogue(host);
    expect(mercQuotesSaid(host)).toEqual([MercQuote.HEADSHOT, MercQuote.KILLED_AN_ENEMY]);
    expect(host.talk.face).toMatchObject({ speaker: OTHER_PROFILE, saidAt: 1 });
  });

  it('lifts the map screen pause of his line as the next pass ends the face, without its closing 300 ms', () => {
    const { host, merc } = twoMercs(true);
    tacticalCharacterDialogue(host, merc, MercQuote.HEADSHOT);
    stepDialogue(host);
    deleteSoldierFace(host, MERC_PROFILE);
    expect(host.paused).toBe(true);
    stepDialogue(host);
    expect([host.talk.face, host.paused, host.pauseLocked]).toEqual([null, false, false]);
  });

  it("leaves talking every face that is not his soldier face: another merc's, his NPC line's and an external face's", () => {
    const { host, merc } = twoMercs();
    tacticalCharacterDialogue(host, merc, MercQuote.HEADSHOT);
    stepDialogue(host);
    deleteSoldierFace(host, OTHER_PROFILE);
    const npcLine = fakeHost({ soldiers: [merc] });
    characterDialogue(npcLine, MERC_PROFILE, NPC_LINE, true, false);
    stepDialogue(npcLine);
    deleteSoldierFace(npcLine, MERC_PROFILE);
    const external = fakeHost({ inMapMode: true });
    externalNpcDialogue(external, NarrativeProfile.SKYRIDER, SKYRIDER_SAYS_HI);
    stepDialogue(external);
    deleteSoldierFace(external, NarrativeProfile.SKYRIDER);
    const stillTalking = [host, npcLine, external].map((h) => (h.talk.face?.busyUntil ?? 0) > h.now);
    expect(stillTalking).toEqual([true, true, true]);
    expect([host, npcLine, external].flatMap(facesDeleted)).toEqual([
      { type: 'soldierFaceDeleted', profile: OTHER_PROFILE },
      { type: 'soldierFaceDeleted', profile: MERC_PROFILE },
      { type: 'soldierFaceDeleted', profile: NarrativeProfile.SKYRIDER },
    ]);
  });

  it('ends no line once his own is over, and names none', () => {
    const { host, merc } = twoMercs();
    tacticalCharacterDialogue(host, merc, MercQuote.HEADSHOT);
    runQueueToTheEnd(host);
    deleteSoldierFace(host, MERC_PROFILE);
    deleteSoldierFace(host, NO_PROFILE);
    expect(facesDeleted(host)).toEqual([{ type: 'soldierFaceDeleted', profile: MERC_PROFILE }]);
  });
});

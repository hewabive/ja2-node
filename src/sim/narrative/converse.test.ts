import { describe, expect, it } from 'vitest';
import { type FakeHost, fakeHost, NPC_TYPE, recordArray, testSoldier } from '../../../tests/support/narrative.ts';
import { type NpcRecord, QuoteFlag, UiCode } from '../../content/formats/npc.ts';
import { Approach, NpcAction, StandardQuote } from '../../content/narrative/npc-constants.ts';
import { TICK_MS } from '../clock.ts';
import { TEAM_FIRST_ID, Team } from '../tactical/soldier.ts';
import {
  converse,
  deleteTalkingMenu,
  handleTalkingMenuEscape,
  handleWaitTimerForNpcTrigger,
  initiateConversationFull,
  npcReachedDestination,
  pcsNearNpc,
  stepDialogue,
  triggerNpcRecord,
} from './converse.ts';
import { lineTicks, voicedLineTicks } from './dialogue-queue.ts';
import { NarrativeFact, NarrativeProfile } from './narrative-ids.ts';
import type { DialogueEvent } from './talk-state.ts';

const NPC = 94;
const MERC = 3;
const NPC_ID = TEAM_FIRST_ID[Team.CIV] + 4;
const MERC_ID = 0;
const NPC_TILE = 12080;
const MERC_TILE = 12083;
const CHARS = 10;

function setup(records: NpcRecord[], extra: Parameters<typeof fakeHost>[0] = {}): FakeHost {
  const npc = testSoldier(NPC_ID, Team.CIV, extra.types?.[70] ? 70 : NPC, NPC_TILE);
  const merc = testSoldier(MERC_ID, Team.OUR, MERC, MERC_TILE);
  return fakeHost({
    scripts: { [NPC]: records, 70: records },
    types: { [NPC]: NPC_TYPE, 70: NPC_TYPE },
    profiles: { [NPC]: {}, [MERC]: {}, 70: {} },
    soldiers: [npc, merc],
    facts: { [NarrativeFact.CURRENT_SECTOR_IS_SAFE]: true },
    chars: () => CHARS,
    ...extra,
  });
}

function kinds(host: FakeHost): string[] {
  return host.talk.queue.map((e: DialogueEvent) =>
    e.kind === 'quote' ? `quote ${e.quote}` : e.kind === 'doAction' ? `action ${e.code}` : e.kind,
  );
}

function open(host: FakeHost, npc = NPC): void {
  host.talk.inPanel = true;
  host.talk.charNum = npc;
  host.context.src = MERC_ID;
  host.context.dest = NPC_ID;
  host.context.srcProfile = MERC;
}

function runQueue(host: FakeHost, maxTicks = 5000): void {
  for (let i = 0; i < maxTicks && (host.talk.queue.length > 0 || host.talk.face || host.talk.waitingForTrigger); i++) {
    host.advance();
    handleWaitTimerForNpcTrigger(host);
    stepDialogue(host);
  }
}

describe('ConverseFull', () => {
  it('sets facts and quests at once, ends before it starts, and queues lines before the action', () => {
    const host = setup(
      recordArray({
        0: {
          approachRequired: Approach.FRIENDLY,
          quoteNum: 10,
          numQuotes: 2,
          setFactTrue: 132,
          endQuest: 13,
          startQuest: 14,
          actionData: NpcAction.CLOSE_DIALOGUE_PANEL,
          flags: QuoteFlag.ERASE_ONCE_SAID,
        },
      }),
    );
    open(host);
    converse(host, NPC, MERC, Approach.FRIENDLY);
    expect(host.facts.values.get(132)).toBe(true);
    expect(host.questLog).toEqual([
      ['end', 13],
      ['start', 14],
    ]);
    expect(host.records.arrays[NPC]?.[0]?.flags).toBe(QuoteFlag.ERASE_ONCE_SAID | QuoteFlag.SAID);
    expect(kinds(host)).toEqual(['quote 10', 'quote 11', 'action 24']);
    expect(host.profile(NPC)).toMatchObject({ lastQuoteSaid: 0, lastQuoteSaidWasSpecial: true, lastDateSpokenTo: 1 });
  });

  it('turns to a profile before the lines and runs other early actions after them', () => {
    const host = setup(
      recordArray({
        0: { approachRequired: Approach.FRIENDLY, quoteNum: 10, numQuotes: 1, actionData: -(NpcAction.TURN_TO_FACE_NEAREST_MERC + 88) },
        1: { approachRequired: Approach.DIRECT, quoteNum: 12, numQuotes: 1, actionData: -NpcAction.CLOSE_DIALOGUE_PANEL },
      }),
    );
    open(host);
    converse(host, NPC, MERC, Approach.FRIENDLY);
    expect(kinds(host)).toEqual(['action 588', 'quote 10']);
    host.talk.queue.length = 0;
    converse(host, NPC, MERC, Approach.DIRECT);
    expect(kinds(host)).toEqual(['quote 12', 'action 24']);
  });

  it('gives each default once, draws the friendly line on the main stream, then sends the squad away', () => {
    const host = setup(recordArray({}), { draws: [1] });
    open(host);
    converse(host, NPC, MERC, Approach.FRIENDLY);
    expect(kinds(host)).toEqual([`quote ${StandardQuote.FRIENDLY_DEFAULT2}`]);
    expect(host.drawsTaken).toEqual([2]);
    converse(host, NPC, MERC, Approach.DIRECT);
    expect(kinds(host).at(-2)).toBe(`quote ${StandardQuote.GETLOST}`);
    expect(kinds(host).at(-1)).toBe('closePanel');
    expect(host.drawsTaken).toEqual([2]);
    converse(host, NPC, MERC, Approach.RECRUIT);
    expect(kinds(host).at(-1)).toBe(`quote ${StandardQuote.RECRUIT_NO}`);
    expect(host.profile(NPC)?.lastQuoteSaidWasSpecial).toBe(false);
  });

  it('makes Conrad an enemy when he sends the squad away', () => {
    const host = setup(recordArray({}), { types: { 70: NPC_TYPE } });
    host.context.dest = NPC_ID;
    const profile = host.profile(70);
    if (profile) profile.threatenDefaultResponseUsedRecently = 1;
    converse(host, NarrativeProfile.CONRAD, MERC, Approach.THREATEN);
    expect(kinds(host)).toEqual(['quote 9', 'action 22', 'closePanel']);
  });

  it('opens with the intro, stays silent the same day and greets again on a later day', () => {
    const host = setup(recordArray({}));
    open(host);
    converse(host, NPC, MERC, Approach.NPC_INITIAL_QUOTE);
    expect(kinds(host)).toEqual(['action 500', 'quote 0']);
    expect(host.profile(NPC)?.lastDateSpokenTo).toBe(1);
    host.talk.queue.length = 0;
    converse(host, NPC, MERC, Approach.NPC_INITIAL_QUOTE);
    expect(kinds(host)).toEqual(['action 500']);
    host.talk.queue.length = 0;
    host.today = 2;
    converse(host, NPC, MERC, Approach.NPC_INITIAL_QUOTE);
    expect(kinds(host)).toEqual(['action 500', 'quote 1']);
  });

  it('prefers the special initial quote, then the initial quote record', () => {
    const host = setup(
      recordArray({
        0: { approachRequired: Approach.INITIAL_QUOTE, quoteNum: 20, numQuotes: 1 },
        1: { approachRequired: Approach.SPECIAL_INITIAL_QUOTE, factMustBeTrue: 132, quoteNum: 21, numQuotes: 1 },
      }),
    );
    open(host);
    converse(host, NPC, MERC, Approach.NPC_INITIAL_QUOTE);
    expect(kinds(host)).toEqual(['action 500', 'quote 20']);
    host.talk.queue.length = 0;
    host.facts.values.set(132, true);
    host.today = 2;
    converse(host, NPC, MERC, Approach.NPC_INITIAL_QUOTE);
    expect(kinds(host)).toEqual(['action 500', 'quote 21']);
  });

  it('replaces the approach when the sector is not safe and skips the greeting', () => {
    const host = setup(recordArray({ 0: { approachRequired: Approach.SECTOR_NOT_SAFE, quoteNum: 30, numQuotes: 1 } }), {
      facts: { [NarrativeFact.CURRENT_SECTOR_IS_SAFE]: false },
    });
    open(host);
    converse(host, NPC, MERC, Approach.NPC_INITIAL_QUOTE);
    expect(kinds(host)).toEqual(['quote 30']);
    expect(host.profile(NPC)?.lastDateSpokenTo).toBe(0);
  });

  it('repeats the last record’s lines or the last default line', () => {
    const host = setup(recordArray({ 0: { approachRequired: Approach.FRIENDLY, quoteNum: 10, numQuotes: 2 } }));
    open(host);
    converse(host, NPC, MERC, Approach.FRIENDLY);
    host.talk.queue.length = 0;
    converse(host, NPC, MERC, Approach.REPEAT);
    expect(kinds(host)).toEqual(['quote 10', 'quote 11']);
  });
});

describe('the dialogue queue', () => {
  it('runs one event per tick and holds the queue for 12 ticks per character and the final 300 ms', () => {
    const host = setup(recordArray({ 0: { approachRequired: Approach.FRIENDLY, quoteNum: 10, numQuotes: 2, actionData: 24 } }));
    open(host);
    converse(host, NPC, MERC, Approach.FRIENDLY);
    const started: number[] = [];
    for (let i = 0; i < 400 && host.talk.queue.length > 0; i++) {
      const before = host.talk.queue.length;
      stepDialogue(host);
      if (host.talk.queue.length < before) started.push(host.now);
      host.advance();
    }
    const hold = lineTicks(CHARS);
    expect(started).toEqual([0, hold, 2 * hold]);
    expect(host.actionsRun).toEqual([[NPC, 24, 0]]);
    expect(host.emitted.filter((e) => e.type === 'npcQuote').map((e) => (e as { quote: number }).quote)).toEqual([10, 11]);
  });

  it('holds the queue for the longer of the voice and the text of a line, then the final 300 ms', () => {
    const LONG_VOICE_MS = 1234;
    const SHORT_VOICE_MS = 100;
    const voiceMs = (line: { readonly textKey: { readonly row: number } }) => (line.textKey.row === 10 ? LONG_VOICE_MS : SHORT_VOICE_MS);
    const host = setup(recordArray({ 0: { approachRequired: Approach.FRIENDLY, quoteNum: 10, numQuotes: 2, actionData: 24 } }), {
      voiceMs,
    });
    open(host);
    converse(host, NPC, MERC, Approach.FRIENDLY);
    const started: number[] = [];
    for (let i = 0; i < 1000 && host.talk.queue.length > 0; i++) {
      const before = host.talk.queue.length;
      stepDialogue(host);
      if (host.talk.queue.length < before) started.push(host.now);
      host.advance();
    }
    expect(voicedLineTicks(LONG_VOICE_MS)).toBe(Math.ceil(LONG_VOICE_MS / TICK_MS) + 60);
    expect(voicedLineTicks(LONG_VOICE_MS)).toBeGreaterThan(lineTicks(CHARS));
    expect(voicedLineTicks(SHORT_VOICE_MS)).toBeLessThan(lineTicks(CHARS));
    expect(started).toEqual([0, voicedLineTicks(LONG_VOICE_MS), voicedLineTicks(LONG_VOICE_MS) + lineTicks(CHARS)]);
  });

  it('keeps a delayed quote until it is our turn and lets a silent line pass in one tick', () => {
    const host = setup(recordArray({}), { chars: () => 0, currentTeam: Team.ENEMY });
    host.talk.queue.push({ kind: 'quote', speaker: NPC, quote: 3, npcUi: true, fromSoldier: false, delayed: true, record: null });
    stepDialogue(host);
    expect(host.talk.queue).toHaveLength(1);
    host.talk.queue.length = 0;
    host.talk.queue.push({ kind: 'quote', speaker: NPC, quote: 3, npcUi: true, fromSoldier: false, delayed: false, record: null });
    stepDialogue(host);
    expect(host.talk.face?.busyUntil).toBe(host.now);
    host.advance();
    stepDialogue(host);
    expect(host.talk.face).toBeNull();
  });

  it('defers a conversation while the queue is busy and opens it once the queue is empty', () => {
    const host = setup(recordArray({}));
    host.talk.queue.push({ kind: 'closePanel' });
    const npc = host.tactical()?.soldiers[NPC_ID];
    const merc = host.tactical()?.soldiers[MERC_ID];
    if (!npc || !merc) throw new Error('no soldiers');
    expect(initiateConversationFull(host, npc, merc, Approach.NPC_INITIAL_QUOTE, 0, null, 'player')).toBe(false);
    expect(host.engagedFlag).toBe(true);
    stepDialogue(host);
    expect(host.talk.inPanel).toBe(false);
    host.advance();
    stepDialogue(host);
    expect(host.talk.inPanel).toBe(true);
    expect(host.talk.pending).toBeNull();
    expect(host.emitted.some((e) => e.type === 'conversationOpened')).toBe(true);
  });
});

describe('triggers and scripted sequences', () => {
  it('waits 100 ticks before a trigger with lines opens a panel with the closest merc', () => {
    const host = setup(recordArray({ 3: { approachRequired: Approach.TRIGGER_NPC, quoteNum: 40, numQuotes: 1 } }));
    triggerNpcRecord(host, NPC, 3);
    expect(kinds(host)).toEqual(['triggerNpc']);
    stepDialogue(host);
    expect(host.talk.waitingForTrigger).toBe(true);
    for (let i = 0; i < 100; i++) {
      host.advance();
      handleWaitTimerForNpcTrigger(host);
    }
    expect(host.talk.inPanel).toBe(false);
    host.advance();
    handleWaitTimerForNpcTrigger(host);
    expect(host.talk.inPanel).toBe(true);
    expect(host.talk.initiatedBy).toBe('npc');
    expect(host.context.src).toBe(MERC_ID);
    expect(kinds(host)).toEqual(['quote 40']);
  });

  it('does not trigger a record that fails its conditions', () => {
    const host = setup(recordArray({ 3: { approachRequired: Approach.TRIGGER_NPC, factMustBeTrue: 200 } }));
    triggerNpcRecord(host, NPC, 3);
    expect(host.talk.queue).toHaveLength(0);
  });

  it('walks the NPC with the UI off, and turns it back on from the tile record', () => {
    const host = setup(
      recordArray({
        0: { approachRequired: Approach.FRIENDLY, quoteNum: 5, numQuotes: 1, goToGridNo: 12240, giftItem: UiCode.TURN_UI_OFF },
        1: { approachRequired: Approach.TRIGGER_NPC, requirement: -12240, quoteNum: 6, numQuotes: 1, giftItem: UiCode.TURN_UI_ON },
      }),
    );
    open(host);
    converse(host, NPC, MERC, Approach.FRIENDLY);
    expect(host.engagedFlag).toBe(true);
    expect(host.talk.referenceCount).toBe(1);
    runQueue(host);
    const npc = host.tactical()?.soldiers[NPC_ID];
    if (!npc) throw new Error('no npc');
    expect(host.talk.inPanel).toBe(false);
    expect(host.engagedFlag).toBe(true);
    expect(npc.quoteRecord).toBe(1);
    expect(npc.absoluteFinalDestination).toBe(12240);
    npc.gridNo = 12240;
    host.context.src = null;
    npcReachedDestination(host, npc, false);
    expect(host.talk.waitingForTrigger).toBe(true);
    runQueue(host);
    expect(host.talk.inPanel).toBe(true);
    expect(host.talk.referenceCount).toBe(0);
    expect(host.engagedFlag).toBe(true);
    expect(handleTalkingMenuEscape(host)).toBe(true);
    expect(host.engagedFlag).toBe(false);
  });

  it('keeps the UI locked after a script closes the panel while the reference count holds', () => {
    const host = setup(recordArray({}));
    open(host);
    host.talk.referenceCount = 1;
    host.setEngaged(true);
    deleteTalkingMenu(host, 'script');
    expect(host.engagedFlag).toBe(true);
  });

  it('sets the PC-near fact only while the tile records are considered', () => {
    const host = setup(
      recordArray({
        2: { approachRequired: Approach.TRIGGER_NPC, requirement: -NPC_TILE, factMustBeTrue: NarrativeFact.PC_NEAR, quoteNum: 255 },
      }),
    );
    pcsNearNpc(host, NPC);
    expect(host.facts.values.get(NarrativeFact.PC_NEAR)).toBe(false);
    expect(host.factLog).toContainEqual([NarrativeFact.PC_NEAR, NPC]);
  });
});

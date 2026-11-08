import { describe, expect, it } from 'vitest';
import { appendToLog, MESSAGE_LOG_SIZE, type MessageEntry } from '../protocol/message-log.ts';
import type { SimEvent } from '../sim/events.ts';
import { refuse } from '../sim/tactical/refusal.ts';
import { type MessageFacts, messageEntriesOf, refusalEntry } from './message-entries.ts';

const NAMES: Readonly<Record<number, string>> = { 0: 'Ivan', 1: 'Fox', 20: 'Soldier', 116: 'Fatima' };
const TEAMS: Readonly<Record<number, number>> = { 0: 0, 1: 0, 20: 1, 116: 4 };
const ITEM_INDICES: Readonly<Record<string, number>> = { GLOCK_17: 2, WINE: 255 };

const facts: MessageFacts = {
  soldierName: (id) => NAMES[id] ?? null,
  soldierTeam: (id) => TEAMS[id] ?? null,
  soldierProfile: (id) => (id === 116 ? 101 : null),
  soldierVisible: (id) => id !== 20,
  profileName: (profile) => (profile === 101 ? 'Fatima' : null),
  itemIndex: (name) => ITEM_INDICES[name] ?? null,
};

const at = (e: Record<string, unknown>): SimEvent => ({ tick: 40, ...e }) as unknown as SimEvent;

describe('message entries from the ScreenMsg sites of the original', () => {
  it('reports noises, stat gains and interrupts in the interface colour', () => {
    const entries = messageEntriesOf(
      [
        at({ type: 'noiseHeard', listener: 0, kind: 1, volumeClass: 2, direction: 3 }),
        at({ type: 'noiseHeard', listener: 0, kind: 0, volumeClass: 0, direction: 'above' }),
        at({ type: 'statChanged', soldier: 1, stat: 'experience', change: 1 }),
        at({ type: 'statChanged', soldier: 1, stat: 'marksmanship', change: -2 }),
        at({ type: 'interrupt', team: 0, soldiers: [0, 1], selected: 0 }),
        at({ type: 'interrupt', team: 1 }),
      ],
      facts,
    );
    expect(entries).toEqual([
      {
        tick: 40,
        kind: 'interface',
        colour: 145,
        table: 'pNewNoiseStr',
        index: 1,
        args: [{ text: 'Ivan' }, { string: { table: 'pNoiseVolStr', index: 2 } }, { string: { table: 'pDirectionStr', index: 3 } }],
      },
      {
        tick: 40,
        kind: 'interface',
        colour: 145,
        table: 'pNewNoiseStr',
        index: 0,
        args: [{ text: 'Ivan' }, { string: { table: 'pNoiseVolStr', index: 0 } }, { string: { table: 'gzLateLocalizedString', index: 5 } }],
      },
      {
        tick: 40,
        kind: 'interface',
        colour: 145,
        args: [
          { text: 'Fox' },
          { string: { table: 'sPreStatBuildString', index: 1 } },
          { number: 1 },
          { string: { table: 'sPreStatBuildString', index: 4 } },
          { string: { table: 'sStatGainStrings', index: 8 } },
        ],
      },
      {
        tick: 40,
        kind: 'interface',
        colour: 145,
        args: [
          { text: 'Fox' },
          { string: { table: 'sPreStatBuildString', index: 0 } },
          { number: 2 },
          { string: { table: 'sPreStatBuildString', index: 3 } },
          { string: { table: 'sStatGainStrings', index: 7 } },
        ],
      },
      { tick: 40, kind: 'interface', colour: 145, table: 'Message', index: 53, args: [{ text: 'Ivan, Fox' }] },
    ]);
  });

  it('names deaths of visible named civilians, shows our dead on the skull feedback and keeps the rest quiet', () => {
    const entries = messageEntriesOf(
      [
        at({ type: 'soldierDied', soldier: 116, killer: 20, gridNo: 1 }),
        at({ type: 'soldierDied', soldier: 0, killer: 20, gridNo: 1 }),
        at({ type: 'soldierDied', soldier: 20, killer: 0, gridNo: 1 }),
      ],
      facts,
    );
    expect(entries.map((e) => [e.kind, e.table, e.args])).toEqual([
      ['interface', 'pMercDeadString', [{ text: 'Fatima' }]],
      ['skullFeedback', 'pMercDeadString', [{ text: 'Ivan' }]],
    ]);
    expect(appendToLog([], entries).map((e) => e.kind)).toEqual(['interface']);
  });

  it('prints pMercDeadString in red for our merc dying off the tactical map only off the tactical screen', () => {
    const entries = messageEntriesOf(
      [at({ type: 'mercDied', soldier: 1, sector: 'B9' }), at({ type: 'mercDied', soldier: 0, sector: 'A9', mapScreen: true })],
      facts,
    );
    expect(entries).toEqual([{ tick: 40, kind: 'interface', colour: 163, table: 'pMercDeadString', index: 0, args: [{ text: 'Ivan' }] }]);
  });

  it('prints STR_LOSES_1_HP in the interface colour for our merc who loses a point of maximum life bleeding, nothing for a plain bleed', () => {
    const entries = messageEntriesOf(
      [at({ type: 'mercBled', soldier: 1 }), at({ type: 'mercBled', soldier: 0, lifeMaxLost: true })],
      facts,
    );
    expect(entries).toEqual([{ tick: 40, kind: 'interface', colour: 145, table: 'Message', index: 4, args: [{ text: 'Ivan' }] }]);
  });

  it('follows the lock and trap lines of Handle_Doors and Keys', () => {
    const door = (action: string, result: string, trap?: string) => at({ type: 'doorResult', soldier: 0, gridNo: 5, action, result, trap });
    const entries = messageEntriesOf(
      [
        door('force', 'noLock'),
        door('unlock', 'noLock'),
        door('examine', 'trapFound', 'electric'),
        door('lock', 'wrongKey'),
        door('unlock', 'wrongKey'),
        at({ type: 'doorTrap', soldier: 0, gridNo: 5, trap: 'siren' }),
        at({ type: 'doorTrap', soldier: 0, gridNo: 5, trap: 'silentAlarm' }),
        at({ type: 'lockDestroyed', soldier: 0, gridNo: 5 }),
      ],
      facts,
    );
    expect(entries.map((e) => [e.table, e.index, e.args ?? []])).toEqual([
      ['TacticalStr', 4, []],
      ['TacticalStr', 3, [{ string: { table: 'pDoorTrapStrings', index: 2 } }]],
      ['TacticalStr', 6, [{ text: 'Ivan' }]],
      ['TacticalStr', 79, [{ string: { table: 'pDoorTrapStrings', index: 3 } }]],
      ['TacticalStr', 133, []],
    ]);
  });

  it('announces final arrivals on the surface and quotes dialogue lines in the dialogue colour', () => {
    const key = { file: 'mercedt/000.edt', row: 7, width: 240 };
    const entries = messageEntriesOf(
      [
        at({ type: 'groupArrived', group: 3, sector: 'B9', final: true, who: { kind: 'squad', squad: 0 } }),
        at({ type: 'groupArrived', group: 3, sector: 'B9', final: false, who: { kind: 'squad', squad: 0 } }),
        at({ type: 'groupArrived', group: 4, sector: 'B9-1', final: true, who: { kind: 'merc', soldier: 0 } }),
        at({ type: 'mercQuote', soldier: 0, profile: 7, quote: 'quote7', id: 7, textKey: key, chars: 30 }),
        at({ type: 'civQuote', soldier: 116, quote: 99, entry: 0, hint: true, textKey: key, chars: 30 }),
        at({ type: 'civQuote', soldier: 116, quote: 3, entry: 0, hint: false, textKey: key, chars: 30 }),
      ],
      facts,
    );
    expect(entries).toEqual([
      {
        tick: 40,
        kind: 'interface',
        colour: 145,
        table: 'pMessageStrings',
        index: 22,
        args: [
          { string: { table: 'pAssignmentStrings', index: 0 } },
          { string: { table: 'pMapVertIndex', index: 2 } },
          { string: { table: 'pMapHortIndex', index: 9 } },
        ],
      },
      { tick: 40, kind: 'dialog', colour: 208, textKey: key, speaker: 7 },
      { tick: 40, kind: 'dialog', colour: 208, textKey: key },
    ]);
  });

  it('prints MERC_HAS_ARRIVED_STR as a merc arrives, but for one the helicopter brings, whose line comes as it drops him', () => {
    const arrived = { tick: 40, kind: 'interface', colour: 145, table: 'TacticalStr', index: 80 };
    const entries = messageEntriesOf(
      [
        at({ type: 'mercArrived', soldier: 0, profile: 7, sector: 'B13' }),
        at({ type: 'mercArrived', soldier: 1, profile: 8, sector: 'A9', helicopter: true }),
        at({ type: 'mercDropped', soldier: 1 }),
      ],
      facts,
    );
    expect(entries).toEqual([
      { ...arrived, args: [{ text: 'Ivan' }] },
      { ...arrived, args: [{ text: 'Fox' }] },
    ]);
  });

  it('prints the refusals the original prints in the log, with the merc where the string names him', () => {
    const refused = (refusal: string) => refuse(refusal, refusal);
    expect(refusalEntry(9, { type: 'move', soldier: 0 }, refused('notEnoughAP'), facts)).toEqual({
      tick: 9,
      kind: 'uiFeedback',
      colour: 144,
      table: 'TacticalStr',
      index: 87,
    });
    expect(refusalEntry(9, { type: 'move', soldier: 1 }, refused('mercUnavailable'), facts)).toMatchObject({
      index: 82,
      args: [{ text: 'Fox' }],
    });
    expect(refusalEntry(9, { type: 'move', soldier: 0 }, refused('badDestination'), facts)).toBeNull();
    expect(refusalEntry(9, { type: 'route', soldier: 0 }, refused('enemiesPresent'), facts)).toBeNull();
    expect(refusalEntry(9, { type: 'move', soldier: 0 }, { ok: true }, facts)).toBeNull();
  });

  it('names the calibre the robot needs when it refuses the ammo given to it', () => {
    const refused = refuse('robotNeedsCalibre', 'robotNeedsCalibre', { calibre: 2 });
    expect(refusalEntry(9, { type: 'give', soldier: 0, target: 1 }, refused, facts)).toEqual({
      tick: 9,
      kind: 'uiFeedback',
      colour: 144,
      table: 'TacticalStr',
      index: 44,
      args: [{ string: { table: 'ammo-calibre', index: 2 } }],
    });
  });

  it('prints the line of CanExchangePlaces for a soldier who refuses to move, naming him when he has a profile', () => {
    const swap = { type: 'swapPlaces', soldier: 0, with: 116, cursor: true };
    expect(refusalEntry(9, swap, refuse('npcRefusesToMove', 'refuses', { soldier: 116 }), facts)).toEqual({
      tick: 9,
      kind: 'uiFeedback',
      colour: 144,
      table: 'gzLateLocalizedString',
      index: 2,
      args: [{ text: 'Fatima' }],
    });
    expect(refusalEntry(9, swap, refuse('personRefusesToMove', 'refuses', { soldier: 20 }), facts)).toEqual({
      tick: 9,
      kind: 'uiFeedback',
      colour: 144,
      table: 'TacticalStr',
      index: 119,
    });
    expect(refusalEntry(9, swap, refuse('notEnoughAP', 'short'), facts)).toMatchObject({ table: 'TacticalStr', index: 87 });
    expect(refusalEntry(9, swap, refuse('cannotExchange', 'moving'), facts)).toBeNull();
  });

  it('leaves the refusals of a sector exit to the exit cursor, which prints its own lines', () => {
    const refused = refuse('uncontrolledRobot', 'the robot cannot leave without a merc using its controller');
    expect(refusalEntry(9, { type: 'exitSector', soldier: 0, direction: 'north' }, refused, facts)).toBeNull();
    expect(refusalEntry(9, { type: 'move', soldier: 0 }, refused, facts)).toMatchObject({ table: 'TacticalStr', index: 88 });
  });

  it('quotes the line of a rocket rifle taking the fingerprints, and prints nothing for one that refuses them', () => {
    const entries = messageEntriesOf(
      [at({ type: 'gunImprint', soldier: 0, result: 'imprinted' }), at({ type: 'gunImprint', soldier: 0, result: 'denied' })],
      facts,
    );
    expect(entries).toEqual([{ tick: 40, kind: 'interface', colour: 145, table: 'TacticalStr', index: 111, quoted: true }]);
    const refused = refuse('wrongFingerprint', 'the rocket rifle answers to someone else');
    expect(refusalEntry(9, { type: 'attack', soldier: 0 }, refused, facts)).toBeNull();
  });

  it('names the merc whose camouflage wore off in the interface colour', () => {
    expect(messageEntriesOf([at({ type: 'camoWornOff', soldier: 1 })], facts)).toEqual([
      { tick: 40, kind: 'interface', colour: 145, table: 'Message', index: 30, args: [{ text: 'Fox' }] },
    ]);
  });

  it('names the soldier whose camouflage the water washed off with STR_CAMO_WASHED_OFF', () => {
    expect(messageEntriesOf([at({ type: 'camoWashedOff', soldier: 1 })], facts)).toEqual([
      { tick: 40, kind: 'interface', colour: 145, table: 'Message', index: 31, args: [{ text: 'Fox' }] },
    ]);
  });

  it('prints a steal with the thief and the short name of the item, a knocked-away item as stolen too', () => {
    const steal = (result: 'grabbed' | 'dropped' | 'failed') => at({ type: 'stealAttempt', soldier: 1, target: 20, item: 7, result });
    const args = [{ text: 'Fox' }, { item: 7, name: 'short' }];
    expect(messageEntriesOf([steal('grabbed'), steal('dropped'), steal('failed')], facts)).toEqual([
      { tick: 40, kind: 'interface', colour: 145, table: 'Message', index: 33, args },
      { tick: 40, kind: 'interface', colour: 145, table: 'Message', index: 33, args },
      { tick: 40, kind: 'interface', colour: 145, table: 'Message', index: 51, args },
    ]);
  });

  it('prints the head gear a merc puts on or takes off with the long item name from the new strings', () => {
    const gear = (on: boolean) => at({ type: 'headGearChanged', soldier: 1, item: 9, on });
    const args = [{ text: 'Fox' }, { item: 9, name: 'long' }];
    expect(messageEntriesOf([gear(true), gear(false)], facts)).toEqual([
      { tick: 40, kind: 'interface', colour: 145, table: 'new-strings', index: 0, args },
      { tick: 40, kind: 'interface', colour: 145, table: 'new-strings', index: 1, args },
    ]);
  });

  it('prints a pass with the short item name and the catcher, and the no-room line when it does not fit', () => {
    const args = [{ item: 4, name: 'short' }, { text: 'Fox' }];
    const events = [at({ type: 'itemPassed', soldier: 0, target: 1, item: 4 }), at({ type: 'passFailed', soldier: 0, target: 1, item: 4 })];
    expect(messageEntriesOf(events, facts)).toEqual([
      { tick: 40, kind: 'interface', colour: 145, table: 'pMessageStrings', index: 39, args },
      { tick: 40, kind: 'interface', colour: 145, table: 'pMessageStrings', index: 40, args },
    ]);
  });

  it('prints a drink with the drinker and its short name, another drug with the merc who took it, and nothing for the rest', () => {
    const applied = (item: string) => at({ type: 'itemApplied', soldier: 0, target: 1, item });
    expect(messageEntriesOf([applied('WINE'), applied('REGEN_BOOSTER'), applied('CANTEEN')], facts)).toEqual([
      {
        tick: 40,
        kind: 'interface',
        colour: 145,
        table: 'pMessageStrings',
        index: 64,
        args: [{ text: 'Fox' }, { item: 255, name: 'short' }],
      },
      { tick: 40, kind: 'interface', colour: 145, table: 'pMessageStrings', index: 30, args: [{ text: 'Fox' }] },
    ]);
  });

  it('prints STR_LATE_37 with the name of a soldier who trips and falls, blind or drunk, ours or not', () => {
    const fell = (soldier: number, cause: 'blind' | 'drunk') => at({ type: 'fellDown', soldier, cause });
    expect(messageEntriesOf([fell(1, 'drunk'), fell(20, 'blind')], facts)).toEqual([
      { tick: 40, kind: 'interface', colour: 145, table: 'gzLateLocalizedString', index: 36, args: [{ text: 'Fox' }] },
      { tick: 40, kind: 'interface', colour: 145, table: 'gzLateLocalizedString', index: 36, args: [{ text: 'Soldier' }] },
    ]);
  });

  it('prints STR_SLIPPED_MARBLES as UI feedback with the name of our merc who slips on marbles, and nothing for anyone else', () => {
    const slipped = (soldier: number) => at({ type: 'slippedOnMarbles', soldier });
    expect(messageEntriesOf([slipped(1), slipped(20)], facts)).toEqual([
      { tick: 40, kind: 'uiFeedback', colour: 144, table: 'Message', index: 50, args: [{ text: 'Fox' }] },
    ]);
  });

  it('prints STR_LATE_58 when a switch is activated', () => {
    expect(messageEntriesOf([at({ type: 'switchActivated', soldier: 1 })], facts)).toEqual([
      { tick: 40, kind: 'interface', colour: 145, table: 'gzLateLocalizedString', index: 57 },
    ]);
  });

  it('prints CANNOT_THROW_TO_DEST_STR for a toss that cannot get there', () => {
    const entry = refusalEntry(40, { type: 'toss', soldier: 0 }, refuse('badThrow', 'the item cannot get there'), facts);
    expect(entry).toEqual({ tick: 40, kind: 'uiFeedback', colour: 144, table: 'TacticalStr', index: 45 });
  });

  it('prints EPC_CANNOT_DO_THAT for an escort’s pickup or search', () => {
    const entry = refusalEntry(
      40,
      { type: 'pickUp', soldier: 0 },
      refuse('escortCannotDoThat', 'an escort can neither pick up nor search'),
      facts,
    );
    expect(entry).toEqual({ tick: 40, kind: 'uiFeedback', colour: 144, table: 'TacticalStr', index: 124 });
  });

  it('keeps the last 256 entries of the log', () => {
    const entry = (tick: number): MessageEntry => ({ tick, kind: 'interface', colour: 145, table: 'pMessageStrings', index: 67 });
    const log = appendToLog(
      [],
      Array.from({ length: MESSAGE_LOG_SIZE + 10 }, (_, i) => entry(i)),
    );
    expect(log).toHaveLength(MESSAGE_LOG_SIZE);
    expect(log[0]?.tick).toBe(10);
  });
});

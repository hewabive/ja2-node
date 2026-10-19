import { describe, expect, it } from 'vitest';
import { appendToLog, MESSAGE_LOG_SIZE, type MessageEntry } from '../protocol/message-log.ts';
import type { SimEvent } from '../sim/events.ts';
import { type MessageFacts, messageEntriesOf, refusalEntry } from './message-entries.ts';

const NAMES: Readonly<Record<number, string>> = { 0: 'Ivan', 1: 'Fox', 20: 'Soldier', 116: 'Fatima' };
const TEAMS: Readonly<Record<number, number>> = { 0: 0, 1: 0, 20: 1, 116: 4 };

const facts: MessageFacts = {
  soldierName: (id) => NAMES[id] ?? null,
  soldierTeam: (id) => TEAMS[id] ?? null,
  soldierProfile: (id) => (id === 116 ? 101 : null),
  soldierVisible: (id) => id !== 20,
  profileName: (profile) => (profile === 101 ? 'Fatima' : null),
  itemIndex: (name) => (name === 'GLOCK_17' ? 2 : null),
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

  it('prints the refusals the original prints in the log, with the merc where the string names him', () => {
    const refused = (refusal: string) => ({ ok: false, reason: refusal, data: { refusal } });
    expect(refusalEntry(9, { type: 'move', soldier: 0 }, refused('notEnoughAP'), facts)).toEqual({
      tick: 9,
      kind: 'interface',
      colour: 145,
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

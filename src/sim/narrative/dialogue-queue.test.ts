import { describe, expect, it } from 'vitest';
import { fakeHost, testSoldier } from '../../../tests/support/narrative.ts';
import { Team } from '../tactical/soldier.ts';
import { stepDialogue } from './converse.ts';
import { signalItemLocatorStart } from './dialogue-queue.ts';

const MERC_PROFILE = 5;
const MERC_AT = 12_880;
const SPOTTED_SOMETHING_TWO = 12;

describe('the items-seen quote (Overhead.cc MakeCharacterDialogueEventSignalItemLocatorStart)', () => {
  it('unlocks the item locators and picks quote 11 or 12 with Random(2) only when the queue runs it', () => {
    const merc = testSoldier(0, Team.OUR, MERC_PROFILE, MERC_AT);
    const host = fakeHost({ soldiers: [merc], draws: [1] });
    const t = host.tactical();
    if (!t) throw new Error('no tactical state');
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

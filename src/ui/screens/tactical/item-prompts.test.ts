import { describe, expect, it } from 'vitest';
import { KEY_TEXT } from '../../../../tests/support/map-screen.ts';
import type { PromptView, TacticalPromptView } from '../../../protocol/view.ts';
import { MessageBoxFlag, MessageBoxReturn, MessageBoxStyleId } from '../../widgets/message-box.ts';
import { type PromptContext, promptBox } from '../map/map-prompts.ts';
import { itemPromptBox, tacticalItemPrompt } from './item-prompts.ts';

const YES_NO = ['yes', 'no'] as const;
const NUMBERS = ['1', '2', '3', '4'] as const;

const PROMPTS: readonly (readonly [TacticalPromptView, string])[] = [
  [{ id: 'p', kind: 'activateSwitch', soldier: 0, choices: YES_NO }, 'TacticalStr[14]'],
  [{ id: 'p', kind: 'disarmTrap', soldier: 0, gridNo: 1, buried: true, choices: YES_NO }, 'TacticalStr[15]'],
  [{ id: 'p', kind: 'disarmTrap', soldier: 0, gridNo: 1, buried: false, item: 'CANTEEN', choices: YES_NO }, 'TacticalStr[24]'],
  [{ id: 'p', kind: 'removeBlueFlag', soldier: 0, gridNo: 1, choices: YES_NO }, 'TacticalStr[25]'],
  [{ id: 'p', kind: 'placeBlueFlag', soldier: 0, gridNo: 1, choices: YES_NO }, 'TacticalStr[26]'],
  [{ id: 'p', kind: 'remoteFrequency', soldier: 0, choices: NUMBERS }, 'TacticalStr[21]'],
  [{ id: 'p', kind: 'bombSetting', soldier: 0, gridNo: 1, item: 'TNT', detonator: 'timed', choices: NUMBERS }, 'TacticalStr[22]'],
  [{ id: 'p', kind: 'bombSetting', soldier: 0, gridNo: 1, item: 'TNT', detonator: 'remote', choices: NUMBERS }, 'TacticalStr[23]'],
];

const MAP_CONTEXT: PromptContext = { text: KEY_TEXT, strategic: undefined, sectorName: (label) => label, townOf: () => 0 };

describe('the item boxes of a tactical prompt (Handle_Items.cc DoMessageBox calls)', () => {
  it.each(PROMPTS)('asks %o with its TacticalStr line', (prompt, text) => {
    expect(itemPromptBox(KEY_TEXT, prompt).text).toBe(text);
  });

  it('answers a yes/no box with yes or no in the basic style, and nothing when it closed on its own', () => {
    const box = itemPromptBox(KEY_TEXT, { id: 'p', kind: 'activateSwitch', choices: YES_NO });
    expect([box.buttons, box.style]).toEqual(['yesNo', MessageBoxStyleId.BASIC]);
    expect([MessageBoxReturn.YES, MessageBoxReturn.NO, MessageBoxReturn.NONE].map(box.answer)).toEqual(['yes', 'no', null]);
  });

  it('answers a bomb box with the number of its button, four small numbered buttons as in StartBombMessageBox', () => {
    const box = itemPromptBox(KEY_TEXT, { id: 'p', kind: 'remoteFrequency', soldier: 0, choices: NUMBERS });
    expect([box.buttons, box.style]).toEqual(['numbered', MessageBoxStyleId.BASIC_SMALL_BUTTONS]);
    expect([1, 2, 3, 4, MessageBoxReturn.NONE].map(box.answer)).toEqual(['1', '2', '3', '4', null]);
  });

  it('picks the item prompts out of the view prompt', () => {
    const surrender: PromptView = { id: 's', kind: 'surrender', context: 'tactical', soldier: 1, choices: ['accept', 'reject'] };
    const disarm: PromptView = { id: 'd', kind: 'disarmTrap', soldier: 0, gridNo: 1, buried: false, choices: YES_NO };
    expect([tacticalItemPrompt(surrender), tacticalItemPrompt(disarm), tacticalItemPrompt(null)]).toEqual([null, disarm, null]);
  });

  it('shows the same boxes on the map screen', () => {
    const yesNo = promptBox(MAP_CONTEXT, { id: 'p', kind: 'activateSwitch', choices: YES_NO });
    const numbered = promptBox(MAP_CONTEXT, { id: 'p', kind: 'remoteFrequency', soldier: 0, choices: NUMBERS });
    expect([yesNo?.text, yesNo?.flags, yesNo?.answer(MessageBoxReturn.YES)]).toEqual(['TacticalStr[14]', MessageBoxFlag.YESNO, 'yes']);
    expect([numbered?.flags, numbered?.answer(3)]).toEqual([MessageBoxFlag.FOUR_NUMBERED_BUTTONS, '3']);
  });
});

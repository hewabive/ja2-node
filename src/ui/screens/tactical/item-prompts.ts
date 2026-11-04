// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-11-04. See LICENSE (SFI-SCLA).
// @src src/game/Tactical/Handle_Items.cc the boxes of SoldierGetItemFromWorld (ACTIVATE_SWITCH_PROMPT),
// @src ContinuePastBoobyTrap and BoobyTrapDialogueCallBack (DISARM_BOOBYTRAP_PROMPT), HandleSoldierPickupItem
// @src (DISARM_TRAP_PROMPT), BoobyTrapMessageBoxCallBack (REMOVE_BLUE_FLAG_PROMPT), MineSpottedLocatorCallback
// @src (PLACE_BLUE_FLAG_PROMPT), all MSG_BOX_BASIC_STYLE yes/no boxes, and StartBombMessageBox (CHOOSE_BOMB_FREQUENCY_STR,
// @src CHOOSE_TIMER_STR, CHOOSE_REMOTE_FREQUENCY_STR in a MSG_BOX_BASIC_SMALL_BUTTONS box with four numbered buttons whose
// @src number is the answer); Utils/Text.h TacticalStr.

import type { PromptView, TacticalPromptView } from '../../../protocol/view.ts';
import type { MessageBoxButtons } from '../../message-boxes.ts';
import type { UiTextService } from '../../text/text-service.ts';
import { MessageBoxReturn, MessageBoxStyleId } from '../../widgets/message-box.ts';

const TACTICAL = 'TacticalStr';
const TacticalStr = {
  ACTIVATE_SWITCH_PROMPT: 14,
  DISARM_TRAP_PROMPT: 15,
  CHOOSE_BOMB_FREQUENCY_STR: 21,
  CHOOSE_TIMER_STR: 22,
  CHOOSE_REMOTE_FREQUENCY_STR: 23,
  DISARM_BOOBYTRAP_PROMPT: 24,
  REMOVE_BLUE_FLAG_PROMPT: 25,
  PLACE_BLUE_FLAG_PROMPT: 26,
} as const;
const NUMBERED_RESULTS: readonly number[] = [MessageBoxReturn.ONE, MessageBoxReturn.TWO, MessageBoxReturn.THREE, MessageBoxReturn.FOUR];

const TACTICAL_KINDS: ReadonlySet<string> = new Set([
  'disarmTrap',
  'activateSwitch',
  'removeBlueFlag',
  'placeBlueFlag',
  'bombSetting',
  'remoteFrequency',
]);

export interface ItemPromptBox {
  readonly text: string;
  readonly buttons: Extract<MessageBoxButtons, 'yesNo' | 'numbered'>;
  readonly style: number;
  readonly answer: (result: number) => string | null;
}

export function tacticalItemPrompt(prompt: PromptView | null | undefined): TacticalPromptView | null {
  return prompt && TACTICAL_KINDS.has(prompt.kind) ? (prompt as TacticalPromptView) : null;
}

function yesNoAnswer(result: number): string | null {
  if (result === MessageBoxReturn.YES) return 'yes';
  return result === MessageBoxReturn.NO ? 'no' : null;
}

function numberedAnswer(result: number): string | null {
  return NUMBERED_RESULTS.includes(result) ? String(result) : null;
}

function yesNoBox(text: UiTextService, index: number): ItemPromptBox {
  return { text: text.string(TACTICAL, index) ?? '', buttons: 'yesNo', style: MessageBoxStyleId.BASIC, answer: yesNoAnswer };
}

function numberedBox(text: UiTextService, index: number): ItemPromptBox {
  return {
    text: text.string(TACTICAL, index) ?? '',
    buttons: 'numbered',
    style: MessageBoxStyleId.BASIC_SMALL_BUTTONS,
    answer: numberedAnswer,
  };
}

export function itemPromptBox(text: UiTextService, prompt: TacticalPromptView): ItemPromptBox {
  switch (prompt.kind) {
    case 'disarmTrap':
      return yesNoBox(text, prompt.buried ? TacticalStr.DISARM_TRAP_PROMPT : TacticalStr.DISARM_BOOBYTRAP_PROMPT);
    case 'activateSwitch':
      return yesNoBox(text, TacticalStr.ACTIVATE_SWITCH_PROMPT);
    case 'removeBlueFlag':
      return yesNoBox(text, TacticalStr.REMOVE_BLUE_FLAG_PROMPT);
    case 'placeBlueFlag':
      return yesNoBox(text, TacticalStr.PLACE_BLUE_FLAG_PROMPT);
    case 'bombSetting':
      return numberedBox(text, prompt.detonator === 'timed' ? TacticalStr.CHOOSE_TIMER_STR : TacticalStr.CHOOSE_REMOTE_FREQUENCY_STR);
    case 'remoteFrequency':
      return numberedBox(text, TacticalStr.CHOOSE_BOMB_FREQUENCY_STR);
  }
}

// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-20. See LICENSE (SFI-SCLA).
// @src src/game/Tactical/Interface_Dialogue.cc StartDialogueMessageBox (the basic YES/NO box per request: ESCORT_PROMPT
// @src or STR_LATE_57 for John and Mary, HIRE_PROMPT with "$" and the salary, BOXING_PROMPT, BUY_VEST_PROMPT with the
// @src vest's name and price, YESNOLIE_STR with YES/NO/LIE, FREE_MEDICAL_PROMPT, PAY_MONEY_PROMPT with the cost or
// @src "$10000" for the vehicle, MARRY_DARYL_PROMPT, SPARE_KROTT_PROMPT), DialogueMessageBoxCallBack. See docs/24 §6.7,
// @src docs/28 §5.8.

import type { NpcRequestPromptView } from '../../../protocol/view.ts';
import type { MessageBoxButtons } from '../../message-boxes.ts';
import { printf } from '../../text/printf.ts';
import type { UiTextService } from '../../text/text-service.ts';
import { MessageBoxReturn } from '../../widgets/message-box.ts';

const TACTICAL_STR = 'TacticalStr';
const LATE_STRINGS = 'gzLateLocalizedString';
const ESCORT_PROMPT = 38;
const HIRE_PROMPT = 39;
const BOXING_PROMPT = 40;
const BUY_VEST_PROMPT = 41;
const YESNOLIE_STR = 110;
const PAY_MONEY_PROMPT = 120;
const FREE_MEDICAL_PROMPT = 121;
const MARRY_DARYL_PROMPT = 122;
const SPARE_KROTT_PROMPT = 125;
const STR_LATE_57 = 56;
const VEHICLE_PRICE = '$10000';

export interface NpcRequestBox {
  readonly text: string;
  readonly buttons: MessageBoxButtons;
}

function dollars(amount: number | undefined): string {
  return `$${amount ?? 0}`;
}

export function npcRequestBox(request: NpcRequestPromptView, text: UiTextService, vestName: string): NpcRequestBox {
  const tactical = (index: number) => text.string(TACTICAL_STR, index) ?? '';
  const yesNo = (value: string): NpcRequestBox => ({ text: value, buttons: 'yesNo' });
  switch (request.request) {
    case 'escort':
      return yesNo(request.pair ? (text.string(LATE_STRINGS, STR_LATE_57) ?? '') : printf(tactical(ESCORT_PROMPT), [request.name]));
    case 'hire':
      return yesNo(printf(tactical(HIRE_PROMPT), [request.name, dollars(request.amount)]));
    case 'boxingBet':
    case 'fightAgain':
      return yesNo(tactical(BOXING_PROMPT));
    case 'buyVest':
      return yesNo(printf(tactical(BUY_VEST_PROMPT), [vestName, dollars(request.amount)]));
    case 'lie':
      return { text: tactical(YESNOLIE_STR), buttons: 'yesNoLie' };
    case 'freeTreatment':
      return yesNo(tactical(FREE_MEDICAL_PROMPT));
    case 'payDoctor':
      return yesNo(printf(tactical(PAY_MONEY_PROMPT), [dollars(request.amount)]));
    case 'buyVehicle':
      return yesNo(printf(tactical(PAY_MONEY_PROMPT), [request.amount === undefined ? VEHICLE_PRICE : dollars(request.amount)]));
    case 'marryDaryl':
      return yesNo(tactical(MARRY_DARYL_PROMPT));
    case 'spareKrott':
      return yesNo(tactical(SPARE_KROTT_PROMPT));
    default:
      return yesNo(request.request);
  }
}

export function npcRequestChoice(result: number): 'yes' | 'no' | 'lie' {
  if (result === MessageBoxReturn.YES) return 'yes';
  if (result === MessageBoxReturn.LIE) return 'lie';
  return 'no';
}

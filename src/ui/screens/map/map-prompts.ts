// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-21. See LICENSE (SFI-SCLA).
// @src src/game/Strategic/Town_Militia.cc HandleInterfaceMessageForCostOfTrainingMilitia (pMilitiaConfirmStrings 0, 1 and 6),
// @src HandleInterfaceMessageForContinuingTrainingMilitia (3 and 4); src/game/Strategic/Strategic_Movement.cc
// @src PossibleToCoordinateSimultaneousGroupArrivals (STR_DETECTED_SINGULAR or _PLURAL, the enemy type, STR_COORDINATE),
// @src HandlePlayerGroupEnteringSectorToCheckForNPCsOfNote (pLandMarkInSectorString, OK at the final destination, else
// @src CONTINUE/STOP); src/game/Strategic/Merc_Contract.cc NotifyPlayerOfMercDepartureAndPromptEquipmentPlacement (the
// @src GENERIC buttons with the two sectors, REHIRE when the merc may be rehired), HandleNotifyPlayerCanAffordInsurance
// @src (zMarksMapScreenText[10]); src/game/Strategic/MapScreen.cc DoMapMessageBox (centred in 0, 0, 640, 340). The
// @src pre-battle interface and the autoresolve screen are screens of their own (src/ui/screens/battle).

import type { PromptView, StrategicView } from '../../../protocol/view.ts';
import { sprintMoney } from '../../text/money.ts';
import { printf } from '../../text/printf.ts';
import type { UiTextService } from '../../text/text-service.ts';
import { MessageBoxFlag, MessageBoxReturn } from '../../widgets/message-box.ts';

const MILITIA = 'pMilitiaConfirmStrings';
const STRATEGIC = 'gpStrategicString';
const STR_DETECTED_SINGULAR = 0;
const STR_DETECTED_PLURAL = 1;
const STR_COORDINATE = 2;
const STR_PB_ENEMIES = 36;
const STR_ENEMY_SURRENDER_OFFER = 3;
const LANDMARK = 'pLandMarkInSectorString';
const INSURANCE = 10;
const MARKS = 'zMarksMapScreenText';
const HE_CHOOSES = 'str_he_leaves_where_drop_equipment';
const HE_DROPS = 'str_he_leaves_drops_equipment';
const LOCATIVES = 'strategic-map-town-name-locatives';

export interface PromptBox {
  readonly text: string;
  readonly flags: MessageBoxFlag;
  readonly user1?: string;
  readonly user2?: string;
  readonly answer: (result: number) => string | null;
}

export interface PromptContext {
  readonly text: UiTextService;
  readonly strategic: StrategicView | undefined;
  readonly sectorName: (label: string, detailed: boolean) => string;
  readonly townOf: (label: string) => number;
}

function yesNo(text: string): PromptBox {
  return { text, flags: MessageBoxFlag.YESNO, answer: (r) => (r === MessageBoxReturn.YES ? 'yes' : 'no') };
}

export function promptBox(ctx: PromptContext, prompt: PromptView): PromptBox | null {
  const text = ctx.text;
  switch (prompt.kind) {
    case 'militiaPayment': {
      const n = prompt.sectors.length;
      const body =
        n > 1
          ? printf(text.string(MILITIA, 6) ?? '', [n, prompt.cost, text.string(MILITIA, 1) ?? ''])
          : `${text.string(MILITIA, 0) ?? ''}${prompt.cost}. ${text.string(MILITIA, 1) ?? ''}`;
      return yesNo(body);
    }
    case 'militiaContinue':
      return yesNo(
        printf(text.string(MILITIA, 3) ?? '', [ctx.sectorName(prompt.sector, true), text.string(MILITIA, 4) ?? '', prompt.cost]),
      );
    case 'simultaneousArrival': {
      const template = text.string(STRATEGIC, prompt.groups === 1 ? STR_DETECTED_SINGULAR : STR_DETECTED_PLURAL) ?? '';
      const body = `${printf(template, [text.string(STRATEGIC, STR_PB_ENEMIES) ?? '', prompt.sector])} ${text.string(STRATEGIC, STR_COORDINATE) ?? ''}`;
      return yesNo(body);
    }
    case 'npcOfNote': {
      const group = (ctx.strategic?.groups ?? []).find((g) => g.id === prompt.group);
      const leader = ctx.strategic?.mercs.find((m) => m.id === group?.members[0]);
      const body = printf(text.string(LANDMARK, 0) ?? '', [(leader?.squad ?? 0) + 1, ctx.sectorName(prompt.sector, false)]);
      const final = prompt.choices.includes('ok');
      return final
        ? { text: body, flags: MessageBoxFlag.OK, answer: () => 'ok' }
        : { text: body, flags: MessageBoxFlag.CONTINUESTOP, answer: (r) => (r === MessageBoxReturn.OK ? 'continue' : 'stop') };
    }
    case 'surrender':
      return yesNo(text.string(STRATEGIC, STR_ENEMY_SURRENDER_OFFER) ?? '');
    case 'preBattle':
    case 'autoresolveDone':
      return null;
  }
}

export function departureBox(
  ctx: PromptContext,
  prompt: { readonly name: string; readonly sector: string; readonly choices: readonly string[]; readonly elsewhereSector: string | null },
): PromptBox {
  const text = ctx.text;
  const here = prompt.sector.split('-')[0] ?? prompt.sector;
  const rehire = prompt.choices.includes('rehire');
  if (prompt.elsewhereSector && prompt.choices.includes('elsewhere')) {
    const elsewhere = prompt.elsewhereSector;
    const town = ctx.townOf(elsewhere);
    const locative = text.string(LOCATIVES, town) ?? '';
    return {
      text: printf(text.string(HE_CHOOSES, 0) ?? '', [prompt.name, here, locative, elsewhere]),
      flags: rehire ? MessageBoxFlag.GENERICCONTRACT : MessageBoxFlag.GENERIC,
      user1: here,
      user2: elsewhere,
      answer: (r) =>
        r === MessageBoxReturn.CONTRACT ? 'rehire' : r === MessageBoxReturn.YES || r === MessageBoxReturn.OK ? 'here' : 'elsewhere',
    };
  }
  return {
    text: printf(text.string(HE_DROPS, 0) ?? '', [prompt.name, here]),
    flags: rehire ? MessageBoxFlag.OKCONTRACT : MessageBoxFlag.OK,
    answer: (r) => (r === MessageBoxReturn.CONTRACT ? 'rehire' : 'here'),
  };
}

export function insuranceBox(
  ctx: PromptContext,
  prompt: { readonly name: string; readonly cost: number; readonly days: number },
): PromptBox {
  return yesNo(printf(ctx.text.string(MARKS, INSURANCE) ?? '', [prompt.name, sprintMoney(prompt.cost), prompt.days]));
}

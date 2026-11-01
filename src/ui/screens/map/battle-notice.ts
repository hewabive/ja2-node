// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-31. See LICENSE (SFI-SCLA).
// @src src/game/Strategic/Strategic_Movement.cc NotifyPlayerOfBloodcatBattle (an OK box with pMapErrorString 12 and the
// @src detailed GetSectorIDString for an ambush, 13 for the lair entrance), CheckConditionsForBattle (an OK box with
// @src STR_DIALOG_ENEMIES_ATTACK_UNCONCIOUSMERCS and the detailed GetSectorIDString when the enemy finds no merc able to
// @src fight and no militia; both boxes come before the pre-battle panel, which their callback TriggerPrebattleInterface
// @src opens).

import type { ViewFrame } from '../../../protocol/view.ts';
import { printf } from '../../text/printf.ts';
import type { UiTextService } from '../../text/text-service.ts';

type FrameEvent = NonNullable<ViewFrame['events']>[number];
type PreBattleEvent = Extract<FrameEvent, { readonly type: 'preBattle' }>;
export type BattleNoticeEvent = PreBattleEvent & { readonly notice: NonNullable<PreBattleEvent['notice']> };

const MAP_ERROR = 'pMapErrorString';
const STRATEGIC = 'gpStrategicString';
const BLOODCAT_AMBUSH_TEXT = 12;
const BLOODCAT_LAIR_TEXT = 13;
const STR_DIALOG_ENEMIES_ATTACK_UNCONCIOUSMERCS = 67;

function noticed(e: FrameEvent): e is BattleNoticeEvent {
  return e.type === 'preBattle' && e.notice !== undefined;
}

export function battleNoticesOf(frames: readonly ViewFrame[]): BattleNoticeEvent[] {
  return frames.flatMap((f) => (f.events ?? []).filter(noticed));
}

export function battleNoticeText(text: UiTextService, event: BattleNoticeEvent, detailedName: (label: string) => string): string {
  switch (event.notice) {
    case 'bloodcatAmbush':
      return printf(text.string(MAP_ERROR, BLOODCAT_AMBUSH_TEXT) ?? '', [detailedName(event.sector)]);
    case 'bloodcatLair':
      return text.string(MAP_ERROR, BLOODCAT_LAIR_TEXT) ?? '';
    case 'unconsciousMercsAttacked':
      return printf(text.string(STRATEGIC, STR_DIALOG_ENEMIES_ATTACK_UNCONCIOUSMERCS) ?? '', [detailedName(event.sector)]);
  }
}

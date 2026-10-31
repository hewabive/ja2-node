// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-30. See LICENSE (SFI-SCLA).
// @src src/game/Tactical/Interface_Items.cc InternalBeginItemPointer, EndItemPointer, DoAttachment,
// @src ItemDescAttachmentsCallbackPrimary, ItemPopupRegionCallbackPrimary; Tactical/Interface_Panels.cc
// @src MergeMessageBoxCallBack, SMInvClickCallbackPrimary (a CTRL stack clean-up without a cursor item flags nothing);
// @src Strategic/MapScreen.cc MAPInvClickCallbackPrimary, InternalMAPBeginItemPointer (gfReEvaluateEveryonesNothingToDo).

import type { CommandResult } from '../command.ts';
import type { StrategicState } from '../strategic/state.ts';

interface ItemCommand {
  readonly type: string;
  readonly [key: string]: unknown;
}

const CURSOR_ITEM_COMMANDS: ReadonlySet<string> = new Set([
  'moveItem',
  'attach',
  'detach',
  'unload',
  'applyItem',
  'splitMoney',
  'discardItem',
  'drop',
  'toss',
  'give',
]);

function movesItemThroughCursor(cmd: ItemCommand): boolean {
  if (cmd.type === 'reload') return cmd.ammo !== undefined;
  if (cmd.type === 'combineStack') return cmd.from !== undefined;
  return CURSOR_ITEM_COMMANDS.has(cmd.type);
}

export function flagNothingToDoAfterItemMove(state: StrategicState, cmd: ItemCommand, result: CommandResult): void {
  if (result.ok && movesItemThroughCursor(cmd)) state.economy.reEvaluateNothingToDo = true;
}

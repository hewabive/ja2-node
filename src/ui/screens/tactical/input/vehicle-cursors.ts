// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-11-05. See LICENSE (SFI-SCLA).
// @src src/game/Tactical/Handle_UI.cc UIHandleInteractiveTilesAndItemsOnTerrain (ENTER_VEHICLE_UICURSOR over any visible
// @src enterable vehicle by hand; by the move cursor CANNOT_MOVE_UICURSOR for a vehicle OKUseVehicle refuses, else the enter
// @src cursor only for a vehicle nobody is aboard); Turn_Based_Input.cc CheckForAndHandleHandleVehicleInteractiveClick (the
// @src fMovementMode of the hand and move clicks).

import type { PreviewAction } from '../../../../protocol/hints.ts';

export const BoardingCursor = { HAND: 'hand', MOVE: 'move' } as const;
export type BoardingCursor = (typeof BoardingCursor)[keyof typeof BoardingCursor];

const ENTER_VEHICLE_CURSOR = 'ENTER_VEHICLE_UICURSOR';

const MOVE_CURSOR_BY_REFUSAL: Readonly<Record<string, string | null>> = {
  notAllowed: 'CANNOT_MOVE_UICURSOR',
  vehicleOccupied: null,
  notInCampaign: null,
};

export function enterVehicleCursor(cursor: BoardingCursor, preview: PreviewAction | null): string | null {
  if (cursor === BoardingCursor.HAND) return ENTER_VEHICLE_CURSOR;
  if (!preview) return null;
  const refusal = preview.refusal;
  if (refusal !== undefined && refusal in MOVE_CURSOR_BY_REFUSAL) return MOVE_CURSOR_BY_REFUSAL[refusal] ?? null;
  return ENTER_VEHICLE_CURSOR;
}

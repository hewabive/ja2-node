import { describe, expect, it } from 'vitest';
import type { PreviewAction } from '../../../../protocol/hints.ts';
import { BoardingCursor, enterVehicleCursor } from './vehicle-cursors.ts';

const BOARDABLE: PreviewAction = { kind: 'enterVehicle', ok: true, apCost: 4, affordable: true, actionGridNo: 100, steps: [] };
const refused = (refusal: string): PreviewAction => ({ ...BOARDABLE, ok: false, refusal });

describe('the enter-vehicle cursor (Handle_UI.cc UIHandleInteractiveTilesAndItemsOnTerrain)', () => {
  it('shows by hand over any enterable vehicle, usable, occupied or out of reach', () => {
    const previews = [BOARDABLE, refused('notAllowed'), refused('vehicleOccupied'), refused('noPath'), null];
    expect(previews.map((p) => enterVehicleCursor(BoardingCursor.HAND, p))).toEqual(Array(previews.length).fill('ENTER_VEHICLE_UICURSOR'));
  });

  it('shows the move cursor as cannot-move over a vehicle not usable yet, as enter over an empty one even out of reach, and leaves an occupied one to the move cursor', () => {
    const previews = [refused('notAllowed'), BOARDABLE, refused('noPath'), refused('vehicleOccupied'), null];
    expect(previews.map((p) => enterVehicleCursor(BoardingCursor.MOVE, p))).toEqual([
      'CANNOT_MOVE_UICURSOR',
      'ENTER_VEHICLE_UICURSOR',
      'ENTER_VEHICLE_UICURSOR',
      null,
      null,
    ]);
  });
});

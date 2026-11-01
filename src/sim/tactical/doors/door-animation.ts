// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-11-01. See LICENSE (SFI-SCLA).
// @src src/game/Tactical/Handle_Doors.cc HandleDoorsOpenClose (the door's tile animation and its premature end);
// @src TileEngine/Tile_Animation.cc CreateAnimationTile, UpdateAniTiles, DeleteAniTile (ANITILE_DOOR);
// @src TileEngine/Interactive_Tiles.h INTTILE_DOOR_OPENSPEED; TileEngine/TileDat.cc SetAnimData (five frames a door).

import { type DoorTile, removeAniTile } from '../explosions/state.ts';
import type { TacticalState } from '../state.ts';
import { clearDoorBusy } from './door-status.ts';

export const DOOR_FRAME_DELAY_MS = 70;
const DOOR_ANIMATION_FRAMES = 5;
const START_FRAME = 0;

export function startDoorAnimation(t: TacticalState, base: number, forward: boolean): void {
  t.explosives.aniTiles.unshift({ kind: 'door', gridNo: base, forward, frame: START_FRAME, lastUpdate: t.clockMs });
}

function endDoorAnimation(t: TacticalState, a: DoorTile): void {
  removeAniTile(t.explosives, a);
  clearDoorBusy(t, a.gridNo);
}

export function endDoorAnimationEarly(t: TacticalState, base: number): void {
  const running = t.explosives.aniTiles.find((a): a is DoorTile => a.kind === 'door' && a.gridNo === base);
  if (running) endDoorAnimation(t, running);
}

function hasNextFrame(a: DoorTile): boolean {
  return a.forward ? a.frame + 1 < DOOR_ANIMATION_FRAMES : a.frame - 1 >= START_FRAME;
}

export function stepDoorAnimation(t: TacticalState, a: DoorTile): boolean {
  if (hasNextFrame(a)) {
    a.frame += a.forward ? 1 : -1;
    return false;
  }
  endDoorAnimation(t, a);
  return true;
}

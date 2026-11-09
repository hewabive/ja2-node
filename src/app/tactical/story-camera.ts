// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-24. See LICENSE (SFI-SCLA).
// @src src/game/GameScreen.cc EnterTacticalScreen (in a meanwhile scene the view locates the scene's NPC,
// @src LocateToMeanwhileCharacter; while IN_DEIDRANNA_ENDGAME it locates gridno 4561); src/game/Strategic/Meanwhile.cc
// @src LocateToMeanwhileCharacter (gCurrentMeanwhileDef.ubNPCNumber, QUEEN for every scene, LocateSoldier(…, FALSE):
// @src only when off screen, no locator). The order of a sector entry's camera (2026-11-09): Meanwhile.cc
// @src DoneFadeOutMeanwhile (InternalLocateGridNo(scene tile, TRUE) right after the scene's load), then GameScreen.cc
// @src MainGameScreenHandle (TacticalScreenLocateToSoldier before EnterTacticalScreen in the next frame); a scene started
// @src in tactical entered the game screen before its load (CheckForMeanwhileOKStart's LeaveTacticalScreen), where the
// @src Queen was not yet to be found, so only one started on the map locates her after it; Tactical/Overhead.cc
// @src LocateSoldier, InternalLocateGridNo.

import type { PlayerView } from '../../protocol/view.ts';
import { Npc } from '../../sim/strategic/narrative/npc-ids.ts';
import { type EntryCameraMove, LocateFlag } from '../../ui/screens/tactical/overlays.ts';

const ENDGAME_GRIDNO = 4561;
const MEANWHILE_NPC = Npc.QUEEN;

export interface SceneCamera {
  readonly gridNo: number | null;
  readonly mapScreen: boolean;
}

export interface CameraEntry {
  readonly scene: SceneCamera | null;
  readonly located: number | null;
}

export function entryCamera(view: PlayerView | null, entry: CameraEntry | null): EntryCameraMove[] {
  const scene = entry?.scene ?? null;
  return [...sceneTile(scene), ...locatedMerc(entry?.located ?? null), ...enterTacticalScreen(view, scene)];
}

function sceneTile(scene: SceneCamera | null): EntryCameraMove[] {
  return scene && scene.gridNo !== null ? [{ kind: 'gridNo', gridNo: scene.gridNo }] : [];
}

function locatedMerc(located: number | null): EntryCameraMove[] {
  return located !== null ? [{ kind: 'soldier', soldier: located, flag: LocateFlag.CENTER_AND_SETLOCATOR }] : [];
}

function enterTacticalScreen(view: PlayerView | null, scene: SceneCamera | null): EntryCameraMove[] {
  const flow = view?.strategic?.flow;
  if (flow === 'endgame') return [{ kind: 'gridNo', gridNo: ENDGAME_GRIDNO }];
  if (flow !== 'meanwhile' || (scene !== null && !scene.mapScreen)) return [];
  const npc = view?.soldiers.find((s) => s.profile === MEANWHILE_NPC);
  return npc ? [{ kind: 'soldier', soldier: npc.id, flag: LocateFlag.DONTSETLOCATOR }] : [];
}

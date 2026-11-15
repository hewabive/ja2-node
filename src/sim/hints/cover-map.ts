// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-11-15. See LICENSE (SFI-SCLA).
// @src src/game/Tactical/DisplayCover.cc DisplayCoverOfSelectedGridNo, DisplayGridNoVisibleToSoldierGrid (the selected
// @src merc, the tile under the cursor, the interface level and the size options); GameSettings.cc
// @src InitGameSettings (ubSizeOfDisplayCover and ubSizeOfLOS 4).

import { isVisibleTile } from '../../content/world/grid.ts';
import type { KnowledgeWorld } from '../knowledge/knowledge-world.ts';
import { AnimHeight } from '../tactical/animation.ts';
import {
  coverAroundGridNo,
  displayCoverStance,
  MAX_DISPLAY_RADIUS,
  sightAroundGridNo,
  type TileCover,
  type TileSight,
} from '../tactical/display-cover.ts';
import type { Stance } from '../tactical/movement-mode.ts';
import { groundUnderDrawnRoof, tilesOfRuns } from './shown-map.ts';
import { type ActingSoldier, actingSoldier } from './soldier-check.ts';
import { type HintRefusal, type HintRequestBase, type HintResult, hintData, refuseHint } from './types.ts';

export const DEFAULT_DISPLAY_RADIUS = 4;
const GROUND = 0;
const ROOF = 1;

export interface DisplayMapRequest extends HintRequestBase {
  readonly soldier?: unknown;
  readonly center?: unknown;
  readonly level?: unknown;
  readonly radius?: unknown;
}

export interface CoverMap {
  readonly center: number;
  readonly level: number;
  readonly radius: number;
  readonly stance: Exclude<Stance, 'run'>;
  readonly tiles: readonly TileCover[];
}

export interface SightMap {
  readonly center: number;
  readonly level: number;
  readonly radius: number;
  readonly tiles: readonly TileSight[];
}

interface DisplayArea {
  readonly acting: ActingSoldier;
  readonly center: number;
  readonly level: number;
  readonly radius: number;
}

const STANCE_NAMES: Readonly<Record<number, Exclude<Stance, 'run'>>> = {
  [AnimHeight.STAND]: 'stand',
  [AnimHeight.CROUCH]: 'crouch',
  [AnimHeight.PRONE]: 'prone',
};

function intOption(value: unknown, fallback: number, min: number, max: number): number | null {
  if (value === undefined) return fallback;
  return typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max ? value : null;
}

function displayArea(world: KnowledgeWorld, req: DisplayMapRequest): DisplayArea | { readonly refusal: HintRefusal } {
  const acting = actingSoldier(world, req.soldier);
  if ('refusal' in acting) return { refusal: acting.refusal };
  const center = req.center;
  if (typeof center !== 'number' || !Number.isInteger(center) || !isVisibleTile(center))
    return { refusal: refuseHint('badCenter', 'center must be a visible gridNo') };
  const level = intOption(req.level, acting.soldier.level > 0 ? ROOF : GROUND, GROUND, ROOF);
  if (level === null) return { refusal: refuseHint('badLevel', 'give level 0 or 1') };
  const radius = intOption(req.radius, DEFAULT_DISPLAY_RADIUS, 0, MAX_DISPLAY_RADIUS);
  if (radius === null) return { refusal: refuseHint('badRadius', `give radius 0..${MAX_DISPLAY_RADIUS}`) };
  return { acting, center, level, radius };
}

export function coverMap(world: KnowledgeWorld, req: DisplayMapRequest): HintResult<CoverMap> {
  const area = displayArea(world, req);
  if ('refusal' in area) return area.refusal;
  const { acting, center, level, radius } = area;
  const { state: t, soldier: s } = acting;
  const underRoof = groundUnderDrawnRoof(t, world.view);
  const tiles = coverAroundGridNo(t, s, center, level, radius).filter((tile) => level === ROOF || !underRoof(tile.gridNo));
  return hintData({ center, level, radius, stance: STANCE_NAMES[displayCoverStance(t, s)] ?? 'crouch', tiles });
}

export function sightMap(world: KnowledgeWorld, req: DisplayMapRequest): HintResult<SightMap> {
  const area = displayArea(world, req);
  if ('refusal' in area) return area.refusal;
  const { acting, center, level, radius } = area;
  const { state: t, soldier: s } = acting;
  const revealed = tilesOfRuns(world.view.revealedTiles);
  const roofs = { showAllRoofs: level === ROOF, revealed: (g: number) => revealed[g] === 1 };
  const underRoof = groundUnderDrawnRoof(t, world.view);
  const tiles = sightAroundGridNo(t, s, center, radius, roofs).filter((tile) => tile.roof || !underRoof(tile.gridNo));
  return hintData({ center, level, radius, tiles });
}

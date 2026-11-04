// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-11-04. See LICENSE (SFI-SCLA).
// @src src/game/TileEngine/WorldDef.h MAPELEMENT_ENEMY_MINE_PRESENT, MAPELEMENT_PLAYER_MINE_PRESENT; WorldDef.cc
// @src SetBlueFlagFlags; Tactical/Handle_Items.cc AddBlueFlag, RemoveBlueFlag; TileEngine/TileDat.h BLUEFLAG_GRAPHIC.

import { WORLD_MAX } from '../../../content/world/grid.ts';
import { recompileLocalMovementCosts } from '../../../content/world/movement-costs.ts';
import { tileIndex } from '../../../content/world/tile-tables.ts';
import { addStructTileToTail, removeStructTile, structLayerAt } from '../map-changes.ts';
import type { TacticalState } from '../state.ts';

export const MineFlag = { ENEMY: 0x04, PLAYER: 0x08 } as const;

const BLUE_FLAG_GRAPHIC = 'FIRSTSWITCHES21';
const GROUND_LEVEL = 0;

export function hasMineFlag(t: Pick<TacticalState, 'mineFlags'>, g: number, flag: number): boolean {
  return ((t.mineFlags[g] ?? 0) & flag) !== 0;
}

export function setMineFlag(t: Pick<TacticalState, 'mineFlags'>, g: number, flag: number): void {
  t.mineFlags[g] = (t.mineFlags[g] ?? 0) | flag;
}

export function clearMineFlag(t: Pick<TacticalState, 'mineFlags'>, g: number, flag: number): void {
  t.mineFlags[g] = (t.mineFlags[g] ?? 0) & ~flag;
}

function blueFlagTile(t: TacticalState): number | null {
  const tables = t.world.tables;
  return tables ? tileIndex(tables, BLUE_FLAG_GRAPHIC) : null;
}

export function addBlueFlag(t: TacticalState, g: number, level: number): void {
  setMineFlag(t, g, MineFlag.PLAYER);
  const tile = blueFlagTile(t);
  if (tile !== null) addStructTileToTail(t, g, tile);
  recompileLocalMovementCosts(t.world.costs, t.world, g, level);
}

export function removeBlueFlag(t: TacticalState, g: number, level: number): void {
  clearMineFlag(t, g, MineFlag.PLAYER);
  const tile = blueFlagTile(t);
  if (tile !== null && level === GROUND_LEVEL) removeStructTile(t, g, tile);
  recompileLocalMovementCosts(t.world.costs, t.world, g, level);
}

function tilesWithTileInMapOrChanges(t: TacticalState, tile: number): Set<number> {
  const at = new Set<number>();
  const { offsets, tiles } = t.world.level.layers.structs;
  for (let g = 0; g < WORLD_MAX; g++) {
    for (let k = offsets[g] ?? 0; k < (offsets[g + 1] ?? 0); k++) if (tiles[k] === tile) at.add(g);
  }
  for (const c of t.mapChanges) if (c.tile === tile) at.add(c.gridNo);
  return at;
}

export function setBlueFlagFlags(t: TacticalState): void {
  const tile = blueFlagTile(t);
  if (tile === null) return;
  for (const g of tilesWithTileInMapOrChanges(t, tile)) if (structLayerAt(t, g).includes(tile)) setMineFlag(t, g, MineFlag.PLAYER);
}

export function knownMineTiles(t: Pick<TacticalState, 'mineFlags'>): number[] {
  const tiles: number[] = [];
  for (let g = 0; g < t.mineFlags.length; g++) if (hasMineFlag(t, g, MineFlag.PLAYER)) tiles.push(g);
  return tiles;
}

export function setKnownMines(t: Pick<TacticalState, 'mineFlags'>, tiles: readonly number[]): void {
  t.mineFlags.fill(0);
  for (const g of tiles) setMineFlag(t, g, MineFlag.PLAYER);
}

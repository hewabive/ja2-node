// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-11-15. See LICENSE (SFI-SCLA).
// @src src/game/Tactical/DisplayCover.cc DisplayCoverOfSelectedGridNo (worked out again on every frame but while the
// @src cursor rests on the merc's own tile), RemoveCoverOfSelectedGridNo (at the interface level of the removal),
// @src AddCoverTileToEachGridNo, AddCoverObjectToWorld (LEVELNODE_REVEAL, DEFAULT_SHADE_LEVEL at night),
// @src RemoveCoverObjectFromWorld, DisplayGridNoVisibleToSoldierGrid, RemoveVisibleGridNoAtSelectedGridNo,
// @src AddVisibleToSoldierToEachGridNo (every slot of gVisibleToSoldierStruct), CalculateCoverInRadiusAroundGridno and
// @src CalculateVisibleToSoldierAroundGridno (GridNoOnScreen, the slot counter), ChangeSizeOfDisplayCover, ChangeSizeOfLOS
// @src (the display taken off and shown again); Turn_Based_Input.cc GetPolledKeyboardInput (Delete and End held);
// @src TileEngine/WorldMan.cc CreateLevelNode (LightGetAmbient), AddObjectToHead, AddOnRoofToHead, RemoveObject,
// @src RemoveOnRoof; Strategic/Game_Clock.cc NightTime.

import { gridSquare, WORLD_COLS } from '../../../../content/world/grid.ts';
import type { CoverMap, SightMap } from '../../../../protocol/hints.ts';
import type { CommandEnvelope } from '../../../../protocol/messages.ts';
import type { SoldierView } from '../../../../protocol/view.ts';
import type { WorldMarker } from '../environment.ts';
import type { HintState } from './hints.ts';
import { COVER_KEY, SIGHT_KEY } from './hotkeys.ts';

const NOWHERE = -1;
const GROUND_LEVEL = 0;
export const DEFAULT_SHADE_LEVEL = 4;
export const TCTL_MSG_DISPLAY_COVER = 2;
export const TCTL_MSG_LOS = 3;
const COVER_TILES = ['SPECIALTILE_COVER_1', 'SPECIALTILE_COVER_2', 'SPECIALTILE_COVER_3', 'SPECIALTILE_COVER_4'] as const;
const COVER_BAND_TOPS = [20, 40, 60, 80] as const;
const FULL_COVER_TILE = 'SPECIALTILE_COVER_5';
const SIGHT_TILES: Readonly<Record<number, string>> = {
  0: 'SPECIALTILE_COVER_1',
  1: 'SPECIALTILE_COVER_2',
  2: 'SPECIALTILE_COVER_3',
  3: 'SPECIALTILE_COVER_5',
};
const SEES_NO_STANCE_TILE = 'SPECIALTILE_COVER_1';
const DISPLAY_STANCE: Readonly<Record<NonNullable<SoldierView['stance']>, string>> = {
  run: 'stand',
  stand: 'stand',
  crouch: 'crouch',
  prone: 'prone',
};

export interface CoverDisplayHost {
  selected(): SoldierView | null;
  cursor(): number | null;
  interfaceLevel(): number;
  keyHeld(key: string): boolean;
  coverSize(): number;
  sightSize(): number;
  hint<T>(request: CommandEnvelope): HintState<T>;
  onScreen(gridNo: number): boolean;
  nodeShade(): number;
  message(index: number): void;
  mapPath(): string | null;
}

interface CoverNode {
  readonly gridNo: number;
  readonly tile: string;
  readonly roof: boolean;
  readonly shade: number;
}

interface PlacedTile {
  readonly gridNo: number;
  readonly tile: string;
  readonly roof: boolean;
}

export function coverTile(cover: number): string {
  const band = COVER_BAND_TOPS.findIndex((top) => cover <= top);
  return band < 0 ? FULL_COVER_TILE : (COVER_TILES[band] ?? FULL_COVER_TILE);
}

export function nodeShade(night: boolean, ambient: number): number {
  return night ? DEFAULT_SHADE_LEVEL : ambient;
}

function rowsOfSquare(center: number, radius: number): number[][] {
  const rows = new Map<number, number[]>();
  for (const g of gridSquare(center, radius)) {
    const row = Math.trunc(g / WORLD_COLS);
    const tiles = rows.get(row) ?? [];
    tiles.push(g);
    rows.set(row, tiles);
  }
  return [...rows.values()];
}

export function sightSlots(answer: SightMap, onScreen: (g: number) => boolean): PlacedTile[] {
  const seen = new Map(answer.tiles.map((tile) => [tile.gridNo, tile]));
  const slots: PlacedTile[] = [];
  for (const row of rowsOfSquare(answer.center, answer.radius)) {
    let leftOver: number | null = null;
    for (const g of row) {
      const tile = seen.get(g);
      if (tile && onScreen(g)) {
        slots.push({ gridNo: g, tile: SIGHT_TILES[tile.stances] ?? SEES_NO_STANCE_TILE, roof: tile.roof });
        leftOver = null;
      } else leftOver = g;
    }
    if (leftOver !== null) slots.push({ gridNo: leftOver, tile: SEES_NO_STANCE_TILE, roof: false });
  }
  return slots;
}

class CoverNodes {
  #nodes: CoverNode[] = [];
  #mapPath: string | null = null;

  follow(mapPath: string | null): void {
    if (mapPath === this.#mapPath) return;
    this.#mapPath = mapPath;
    this.#nodes = [];
  }

  add(tile: PlacedTile, shade: number): void {
    this.#nodes.unshift({ ...tile, shade });
  }

  remove(gridNo: number, tile: string, roof: boolean): void {
    const at = this.#nodes.findIndex((n) => n.gridNo === gridNo && n.tile === tile && n.roof === roof);
    if (at >= 0) this.#nodes.splice(at, 1);
  }

  markers(): WorldMarker[] {
    return this.#nodes.map((n) => ({
      gridNo: n.gridNo,
      layer: n.roof ? 'onRoof' : 'object',
      tile: n.tile,
      head: true,
      translucent: true,
      shade: n.shade,
    }));
  }
}

export class CoverDisplay {
  readonly #host: CoverDisplayHost;
  readonly #nodes = new CoverNodes();
  #deleteDown = false;
  #endDown = false;
  #lastCoverGridNo = NOWHERE;
  #lastStance: string | null = null;
  #lastSoldierGridNo = NOWHERE;
  #lastVisibleGridNo = NOWHERE;
  #coverRequest: CommandEnvelope | null = null;
  #coverShown: PlacedTile[] = [];
  #sightRequest: CommandEnvelope | null = null;
  #sightShown: PlacedTile[] = [];

  constructor(host: CoverDisplayHost) {
    this.#host = host;
  }

  poll(): void {
    this.#nodes.follow(this.#host.mapPath());
    const h = this.#host;
    if (h.keyHeld(COVER_KEY)) {
      this.#displayCover();
      this.#deleteDown = true;
    }
    if (!h.keyHeld(COVER_KEY) && this.#deleteDown) {
      this.#removeCover();
      this.#deleteDown = false;
    }
    if (h.keyHeld(SIGHT_KEY)) {
      this.#displaySight();
      this.#endDown = true;
    }
    if (!h.keyHeld(SIGHT_KEY) && this.#endDown) {
      this.#removeSight();
      this.#endDown = false;
    }
    this.#resolveCover();
    this.#resolveSight();
  }

  markers(): WorldMarker[] {
    this.#nodes.follow(this.#host.mapPath());
    return this.#nodes.markers();
  }

  resizedCover(): void {
    this.#removeCover();
    this.#displayCover();
  }

  resizedSight(): void {
    this.#removeSight();
    this.#displaySight();
  }

  #displayCover(): void {
    const h = this.#host;
    const sel = h.selected();
    if (!sel) return;
    const cursor = h.cursor();
    if (cursor === null) return;
    const stance = DISPLAY_STANCE[sel.stance ?? 'stand'];
    if (this.#lastCoverGridNo === cursor && this.#lastStance === stance && this.#lastCoverGridNo === sel.gridNo) return;
    if (this.#lastCoverGridNo !== NOWHERE || this.#lastStance !== null || this.#lastSoldierGridNo !== NOWHERE) this.#removeCover();
    else h.message(TCTL_MSG_DISPLAY_COVER);
    this.#lastStance = stance;
    this.#lastCoverGridNo = cursor;
    this.#lastSoldierGridNo = sel.gridNo;
    this.#coverRequest = { type: 'coverMap', soldier: sel.id, center: cursor, level: h.interfaceLevel(), radius: h.coverSize() };
    this.#resolveCover();
  }

  #resolveCover(): void {
    const request = this.#coverRequest;
    if (!request) return;
    const answer = this.#host.hint<CoverMap>(request);
    if (answer.state === 'pending') return;
    this.#coverRequest = null;
    if (answer.state !== 'ok') return;
    const roof = answer.data.level !== GROUND_LEVEL;
    const shade = this.#host.nodeShade();
    this.#coverShown = answer.data.tiles
      .filter((tile) => this.#host.onScreen(tile.gridNo))
      .map((tile) => ({ gridNo: tile.gridNo, tile: coverTile(tile.cover), roof }));
    for (const tile of this.#coverShown) this.#nodes.add(tile, shade);
  }

  #removeCover(): void {
    if (this.#lastCoverGridNo === NOWHERE) return;
    const roof = this.#host.interfaceLevel() !== GROUND_LEVEL;
    for (const tile of this.#coverShown) this.#nodes.remove(tile.gridNo, tile.tile, roof);
    this.#coverShown = [];
    this.#coverRequest = null;
    this.#lastCoverGridNo = NOWHERE;
    this.#lastStance = null;
    this.#lastSoldierGridNo = NOWHERE;
  }

  #displaySight(): void {
    const h = this.#host;
    const sel = h.selected();
    if (!sel) return;
    const cursor = h.cursor();
    if (cursor === null) return;
    if (cursor === this.#lastVisibleGridNo && sel.gridNo === this.#lastSoldierGridNo) return;
    if (this.#lastVisibleGridNo !== NOWHERE || this.#lastSoldierGridNo !== NOWHERE) this.#removeSight();
    else h.message(TCTL_MSG_LOS);
    this.#lastVisibleGridNo = cursor;
    this.#lastSoldierGridNo = sel.gridNo;
    this.#sightRequest = { type: 'sightMap', soldier: sel.id, center: cursor, level: h.interfaceLevel(), radius: h.sightSize() };
    this.#resolveSight();
  }

  #resolveSight(): void {
    const request = this.#sightRequest;
    if (!request) return;
    const answer = this.#host.hint<SightMap>(request);
    if (answer.state === 'pending') return;
    this.#sightRequest = null;
    if (answer.state !== 'ok') return;
    const shade = this.#host.nodeShade();
    this.#sightShown = sightSlots(answer.data, (g) => this.#host.onScreen(g));
    for (const slot of this.#sightShown) this.#nodes.add(slot, shade);
  }

  #removeSight(): void {
    if (this.#lastVisibleGridNo === NOWHERE) return;
    for (const slot of this.#sightShown) this.#nodes.remove(slot.gridNo, slot.tile, slot.roof);
    this.#sightShown = [];
    this.#sightRequest = null;
    this.#lastVisibleGridNo = NOWHERE;
    this.#lastSoldierGridNo = NOWHERE;
  }
}

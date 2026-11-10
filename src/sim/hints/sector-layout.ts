// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-11-10. See LICENSE (SFI-SCLA).
// @src src/game/Tactical/Handle_UI.cc ChangeInterfaceLevel (the roof view draws every roof, SHOW_ALL_ROOFS).

import { DIRECTION_COUNT, WORLD_COLS, WORLD_ROWS } from '../../content/world/grid.ts';
import { TravelCost } from '../../content/world/movement-costs.ts';
import { StructureFlags } from '../../content/world/structures.ts';
import { idiv } from '../../core/int.ts';
import type { KnowledgeWorld } from '../knowledge/knowledge-world.ts';
import { isDoorOpenAt } from '../tactical/doors.ts';
import { isWater } from '../tactical/pathfinding.ts';
import { Team } from '../tactical/soldier.ts';
import { onVisibleWorldTile, type TacticalState } from '../tactical/state.ts';
import { groundUnderDrawnRoofs, shownExitGrids } from './shown-map.ts';
import { type HintRequestBase, type HintResult, hintData, refuseHint } from './types.ts';

export interface SectorLayoutRequest extends HintRequestBase {
  readonly level?: unknown;
  readonly cell?: unknown;
  readonly center?: unknown;
  readonly radius?: unknown;
}

export interface LayoutMerc {
  readonly soldier: number;
  readonly gridNo: number;
}

export interface SectorLayout {
  readonly sector: string | null;
  readonly level: number;
  readonly cell: number;
  readonly origin: number;
  readonly rows: readonly string[];
  readonly legend: Readonly<Record<string, string>>;
  readonly mercs: readonly LayoutMerc[];
}

type TileKind = 'off' | 'covered' | 'water' | 'blocked' | 'wall' | 'fence' | 'door' | 'openDoor' | 'open' | 'roof' | 'noRoof';

const GROUND = 0;
const ROOF = 1;
const SECTOR_CELL = 4;
const WINDOW_CELL = 1;
const MAX_CELL = 8;
const WINDOW_RADIUS = 12;
const MAX_RADIUS = 40;

const MERC = '@';
const EXIT_GRID = 'E';
const OFF_MAP = ' ';

const TILE_CHARS: Readonly<Record<TileKind, string>> = {
  off: OFF_MAP,
  covered: 'R',
  water: '~',
  blocked: '#',
  wall: '|',
  fence: '+',
  door: 'D',
  openDoor: 'd',
  open: '.',
  roof: '^',
  noRoof: '-',
};

const PARTLY_BLOCKED = ':';
const OBSTACLE_SHARE_DENOMINATOR = 4;
const PARTLY_BLOCKING: ReadonlySet<TileKind> = new Set(['blocked', 'wall', 'fence', 'door', 'openDoor']);

const GROUND_LEGEND: Readonly<Record<string, string>> = {
  [OFF_MAP]: 'off the map',
  '.': 'open ground',
  '#': 'blocked: trees, rocks, furniture, cliffs',
  '~': 'water: wading or swimming',
  R: 'under a roof the screen draws: a building no merc has seen into yet; underground, rock',
  [EXIT_GRID]: 'an exit grid the cursor shows (sectorExits)',
  [MERC]: 'one of our mercs',
};

const CELL_GROUND_LEGEND: Readonly<Record<string, string>> = {
  ...GROUND_LEGEND,
  [PARTLY_BLOCKED]: 'ground with some obstacles, walls, fences or doors',
};

const TILE_GROUND_LEGEND: Readonly<Record<string, string>> = {
  ...GROUND_LEGEND,
  '|': 'a wall, window or drop on a side of the tile',
  '+': 'a fence a merc jumps',
  D: 'a closed door',
  d: 'an open door',
};

const ROOF_LEGEND: Readonly<Record<string, string>> = {
  [OFF_MAP]: 'off the map',
  '^': 'a roof a merc can stand on',
  '-': 'no roof to stand on',
  [MERC]: 'one of our mercs on a roof',
};

function groundTileKind(t: TacticalState, covered: Uint8Array, g: number): TileKind {
  if (!onVisibleWorldTile(t, g)) return 'off';
  if (covered[g] === 1) return 'covered';
  if (t.world.structures.find(g, StructureFlags.ANYDOOR)) return isDoorOpenAt(t, g) ? 'openDoor' : 'door';
  if (isWater(t.pathWorld, g)) return 'water';
  let blocked = 0;
  let sideBlocked = false;
  let fence = false;
  for (let d = 0; d < DIRECTION_COUNT; d++) {
    const c = t.world.costs.get(g, d, GROUND);
    if (c === TravelCost.FENCE) fence = true;
    else if (c >= TravelCost.BLOCKED && c !== TravelCost.EXITGRID) {
      blocked++;
      if (d % 2 === 0) sideBlocked = true;
    }
  }
  if (blocked === DIRECTION_COUNT) return 'blocked';
  if (fence) return 'fence';
  return sideBlocked ? 'wall' : 'open';
}

function roofTileKind(t: TacticalState, g: number): TileKind {
  if (!onVisibleWorldTile(t, g)) return 'off';
  return t.world.costs.get(g, 0, ROOF) < TravelCost.BLOCKED ? 'roof' : 'noRoof';
}

function cellChar(kinds: readonly TileKind[]): string {
  const counts = new Map<TileKind, number>();
  for (const k of kinds) counts.set(k, (counts.get(k) ?? 0) + 1);
  const count = (k: TileKind) => counts.get(k) ?? 0;
  const shown = kinds.length - count('off');
  if (shown === 0) return OFF_MAP;
  if (count('covered') * 2 >= shown) return TILE_CHARS.covered;
  if (count('roof') * 2 >= shown) return TILE_CHARS.roof;
  if (count('noRoof') > 0) return TILE_CHARS.noRoof;
  const uncovered = shown - count('covered');
  if (count('water') * 2 >= uncovered) return TILE_CHARS.water;
  if (count('blocked') * 2 >= uncovered) return TILE_CHARS.blocked;
  const obstacles = kinds.filter((k) => PARTLY_BLOCKING.has(k)).length;
  return obstacles * OBSTACLE_SHARE_DENOMINATOR >= uncovered ? PARTLY_BLOCKED : TILE_CHARS.open;
}

interface Window {
  readonly x0: number;
  readonly y0: number;
  readonly x1: number;
  readonly y1: number;
}

function intOption(value: unknown, fallback: number, min: number, max: number): number | null {
  if (value === undefined) return fallback;
  return typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max ? value : null;
}

function visibleBounds(t: TacticalState, cell: number): Window {
  let x0 = WORLD_COLS;
  let y0 = WORLD_ROWS;
  let x1 = -1;
  let y1 = -1;
  for (let y = 0; y < WORLD_ROWS; y++)
    for (let x = 0; x < WORLD_COLS; x++) {
      if (!onVisibleWorldTile(t, y * WORLD_COLS + x)) continue;
      x0 = Math.min(x0, x);
      y0 = Math.min(y0, y);
      x1 = Math.max(x1, x);
      y1 = Math.max(y1, y);
    }
  return { x0: x0 - (x0 % cell), y0: y0 - (y0 % cell), x1, y1 };
}

function windowAround(center: number, radius: number): Window {
  const cx = center % WORLD_COLS;
  const cy = idiv(center, WORLD_COLS);
  return {
    x0: Math.max(0, cx - radius),
    y0: Math.max(0, cy - radius),
    x1: Math.min(WORLD_COLS - 1, cx + radius),
    y1: Math.min(WORLD_ROWS - 1, cy + radius),
  };
}

function layoutRows(w: Window, cell: number, kindAt: (g: number) => TileKind, marks: ReadonlyMap<number, string>): string[] {
  const rows: string[] = [];
  for (let y = w.y0; y <= w.y1; y += cell) {
    let row = '';
    for (let x = w.x0; x <= w.x1; x += cell) {
      const kinds: TileKind[] = [];
      let mark: string | null = null;
      for (let dy = 0; dy < cell && y + dy <= w.y1; dy++)
        for (let dx = 0; dx < cell && x + dx <= w.x1; dx++) {
          const g = (y + dy) * WORLD_COLS + x + dx;
          kinds.push(kindAt(g));
          const m = marks.get(g);
          if (m === MERC || (m && !mark)) mark = m;
        }
      row += mark ?? (cell === 1 ? TILE_CHARS[kinds[0] ?? 'off'] : cellChar(kinds));
    }
    rows.push(row.trimEnd());
  }
  return rows;
}

function legendOf(level: number, cell: number): Readonly<Record<string, string>> {
  if (level === ROOF) return ROOF_LEGEND;
  return cell === 1 ? TILE_GROUND_LEGEND : CELL_GROUND_LEGEND;
}

export function sectorLayout(world: KnowledgeWorld, req: SectorLayoutRequest): HintResult<SectorLayout> {
  const tactical = world.tactical;
  if (!tactical) return refuseHint('noSector', 'no sector is loaded');
  const t = tactical.state;
  const windowed = req.center !== undefined;
  const level = intOption(req.level, GROUND, GROUND, ROOF);
  const cell = intOption(req.cell, windowed ? WINDOW_CELL : SECTOR_CELL, 1, MAX_CELL);
  const radius = intOption(req.radius, WINDOW_RADIUS, 1, MAX_RADIUS);
  const center = intOption(req.center, 0, 0, WORLD_COLS * WORLD_ROWS - 1);
  if (level === null) return refuseHint('badLevel', 'give level 0 or 1');
  if (cell === null) return refuseHint('badCell', `give cell 1..${MAX_CELL}`);
  if (radius === null || center === null) return refuseHint('badWindow', `give center as a gridNo and radius 1..${MAX_RADIUS}`);
  const covered = groundUnderDrawnRoofs(t, world.view);
  const kindAt = level === ROOF ? (g: number) => roofTileKind(t, g) : (g: number) => groundTileKind(t, covered, g);
  const mercs = world.view.soldiers
    .filter((s) => s.team === Team.OUR && s.level === level && !s.vehicle)
    .map((s) => ({ soldier: s.id, gridNo: s.gridNo }));
  const marks = new Map<number, string>();
  if (level === GROUND) for (const e of shownExitGrids(t, world.view)) marks.set(e.gridNo, EXIT_GRID);
  for (const m of mercs) marks.set(m.gridNo, MERC);
  const w = windowed ? windowAround(center, radius) : visibleBounds(t, cell);
  return hintData({
    sector: world.view.strategic?.worldSector ?? null,
    level,
    cell,
    origin: w.y0 * WORLD_COLS + w.x0,
    rows: layoutRows(w, cell, kindAt, marks),
    legend: legendOf(level, cell),
    mercs,
  });
}

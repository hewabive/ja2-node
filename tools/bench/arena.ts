import { writeMap } from '../../src/content/formats/map.ts';
import { parseStubMapSource, STUB_MAP_FORMAT, stubMapToMapDef } from '../../src/content/formats/stub-map.ts';
import { STUB_MAPS_DIR } from '../../src/content/strategic/sector-maps.ts';
import { WORLD_COLS } from '../../src/content/world/grid.ts';
import type { TileTables } from '../../src/content/world/tile-tables.ts';
import { Rng } from '../../src/core/rng.ts';

export const ArenaLayout = { BATTLE: 'battle', PATROL: 'patrol' } as const;
export type ArenaLayout = (typeof ArenaLayout)[keyof typeof ArenaLayout];

export interface ArenaSpec {
  readonly name: string;
  readonly layout: ArenaLayout;
  readonly enemies: number;
  readonly elites: number;
  readonly militia: number;
  readonly civilians: number;
  readonly mercs: number;
  readonly seed: number;
}

export interface Garrison {
  readonly admins: number;
  readonly troops: number;
  readonly elites: number;
}

export interface Arena {
  readonly spec: ArenaSpec;
  readonly path: string;
  readonly text: string;
  readonly mercGridNos: readonly number[];
  readonly alarmGridNo: number | null;
  readonly garrison: Garrison;
}

interface Point {
  readonly x: number;
  readonly y: number;
}

interface Box {
  readonly x0: number;
  readonly y0: number;
  readonly x1: number;
  readonly y1: number;
}

export const ARENA_WIDTH = 64;
export const ARENA_HEIGHT = 56;
export const ARENA_ORIGIN: Point = { x: 48, y: 52 };
export const ARENA_TILESET = 0;
export const ARENA_MAP_PREFIX = 'bench-';

const GROUND = '.';
const GRASS_VARIANT = ':';
const DIRT = ',';
const BARREL = 'b';
const WEST_WALL = '|';
const NORTH_WALL = '-';
const CORNER_WALL = '+';
const FLOOR = '_';
const ROOM_WEST = 'L';
const ROOM_NORTH = 'R';
const ROOM_CORNER = 'C';
const OPEN_TILES = new Set([GROUND, GRASS_VARIANT, DIRT]);

const LEGEND: readonly string[] = [
  "legend '.': land FIRSTTEXTURE 1",
  "legend ':': land FIRSTTEXTURE 2",
  "legend ',': land SECONDTEXTURE 1",
  "legend 'b': land SECONDTEXTURE 2; structs FIRSTOSTRUCT 1",
  "legend '|': land FIRSTTEXTURE 1; structs FIRSTWALL 1",
  "legend '-': land FIRSTTEXTURE 1; structs FIRSTWALL 2",
  "legend '+': land FIRSTTEXTURE 1; structs FIRSTWALL 1; structs FIRSTWALL 2",
  "legend '_': land FIRSTFLOOR 1; roofs FIRSTROOF 1; room 1",
  "legend 'L': land FIRSTFLOOR 1; structs FIRSTWALL 1; roofs FIRSTROOF 1; room 1",
  "legend 'R': land FIRSTFLOOR 1; structs FIRSTWALL 2; roofs FIRSTROOF 1; room 1",
  "legend 'C': land FIRSTFLOOR 1; structs FIRSTWALL 1; structs FIRSTWALL 2; roofs FIRSTROOF 1; room 1",
];

const DIRECTIONS = ['NORTH', 'NORTHEAST', 'EAST', 'SOUTHEAST', 'SOUTH', 'SOUTHWEST', 'WEST', 'NORTHWEST'];
const ATTITUDES = ['DEFENSIVE', 'BRAVESOLO', 'BRAVEAID', 'CUNNINGSOLO', 'CUNNINGAID', 'AGGRESSIVE'];
const BATTLE_ORDERS = ['SEEKENEMY', 'ONGUARD', 'CLOSEPATROL', 'FARPATROL', 'STATIONARY'];
const PATROL_ORDERS = ['FARPATROL', 'RNDPTPATROL', 'CLOSEPATROL', 'FARPATROL', 'ONGUARD'];
const CIVILIAN_PATROL_ORDERS = ['FARPATROL', 'RNDPTPATROL', 'CLOSEPATROL', 'STATIONARY'];

const BATTLE_BARRELS = 48;
const BATTLE_WALLS = 14;
const PATROL_BARRELS = 32;
const PATROL_WALLS = 10;
const GROUND_PATCHES = 24;
const WALL_MIN_LENGTH = 3;
const WALL_LENGTH_SPREAD = 4;
const SOLDIER_SPACING = 2;
const MERC_CLEARANCE = 4;
const BORDER = 2;
const MERC_ROW_FROM_BOTTOM = 8;
const MERC_COLUMN_STEP = 2;
const MERC_ROW_STEP = 2;
const MERCS_PER_ROW = 3;
const NEAR_ENEMY_SHARE = 4;
const NEAR_ENEMY_MIN = 8;
const NEAR_ENEMY_MAX = 13;
const NEAR_ENEMY_HALF_WIDTH = 10;
const FAR_ENEMY_BOTTOM_MARGIN = 22;
const MILITIA_HALF_WIDTH = 8;
const MILITIA_ROWS_ABOVE = 2;
const MILITIA_ROWS_BELOW = 4;
const BUNKER: Box = { x0: 2, y0: ARENA_HEIGHT - 7, x1: 8, y1: ARENA_HEIGHT - 5 };
const BUNKER_KEEP_OUT = 14;
const ALARM: Point = { x: ARENA_WIDTH - 12, y: 10 };
const MAX_TRIES = 10_000;

class Canvas {
  readonly rows: string[][];
  readonly taken: Point[] = [];

  constructor() {
    this.rows = Array.from({ length: ARENA_HEIGHT }, () => Array.from({ length: ARENA_WIDTH }, () => GROUND));
  }

  at(p: Point): string {
    return this.rows[p.y]?.[p.x] ?? '';
  }

  set(p: Point, ch: string): void {
    const row = this.rows[p.y];
    if (row && p.x >= 0 && p.x < ARENA_WIDTH) row[p.x] = ch;
  }

  open(p: Point): boolean {
    return OPEN_TILES.has(this.at(p));
  }

  spaced(p: Point): boolean {
    return this.taken.every((q) => Math.max(Math.abs(q.x - p.x), Math.abs(q.y - p.y)) >= SOLDIER_SPACING);
  }

  text(): string {
    return this.rows.map((r) => r.join('')).join('\n');
  }
}

function pick<T>(rng: Rng, list: readonly T[]): T {
  return list[rng.int(list.length)] as T;
}

function between(rng: Rng, lo: number, hi: number): number {
  return lo + rng.int(Math.max(1, hi - lo + 1));
}

function inBox(p: Point, box: Box, margin: number): boolean {
  return p.x >= box.x0 - margin && p.x <= box.x1 + margin && p.y >= box.y0 - margin && p.y <= box.y1 + margin;
}

function scatter(rng: Rng, canvas: Canvas, count: number, area: Box, keepOut: (p: Point) => boolean, mark: (p: Point) => void): void {
  for (let placed = 0, tries = 0; placed < count && tries < MAX_TRIES; tries++) {
    const p = { x: between(rng, area.x0, area.x1), y: between(rng, area.y0, area.y1) };
    if (!canvas.open(p) || keepOut(p)) continue;
    mark(p);
    placed++;
  }
}

function drawWalls(rng: Rng, canvas: Canvas, count: number, keepOut: (p: Point) => boolean): void {
  const area = { x0: BORDER, y0: BORDER, x1: ARENA_WIDTH - BORDER - 1, y1: ARENA_HEIGHT - BORDER - 1 };
  scatter(rng, canvas, count, area, keepOut, (start) => {
    const vertical = rng.coinToss();
    const length = WALL_MIN_LENGTH + rng.int(WALL_LENGTH_SPREAD);
    for (let i = 0; i < length; i++) {
      const p = vertical ? { x: start.x, y: start.y + i } : { x: start.x + i, y: start.y };
      if (canvas.open(p) && !keepOut(p) && p.x < ARENA_WIDTH - BORDER && p.y < ARENA_HEIGHT - BORDER)
        canvas.set(p, vertical ? WEST_WALL : NORTH_WALL);
    }
  });
}

function drawBunker(canvas: Canvas, box: Box): void {
  for (let y = box.y0; y <= box.y1; y++)
    for (let x = box.x0; x <= box.x1; x++) {
      const west = x === box.x0;
      const north = y === box.y0;
      canvas.set({ x, y }, west && north ? ROOM_CORNER : west ? ROOM_WEST : north ? ROOM_NORTH : FLOOR);
    }
  for (let y = box.y0; y <= box.y1; y++) canvas.set({ x: box.x1 + 1, y }, WEST_WALL);
  for (let x = box.x0; x <= box.x1; x++) canvas.set({ x, y: box.y1 + 1 }, NORTH_WALL);
  canvas.set({ x: box.x1 + 1, y: box.y1 + 1 }, CORNER_WALL);
}

function placeSoldiers(rng: Rng, canvas: Canvas, count: number, area: Box, keepOut: (p: Point) => boolean): Point[] {
  const out: Point[] = [];
  for (let tries = 0; out.length < count && tries < MAX_TRIES; tries++) {
    const p = { x: between(rng, area.x0, area.x1), y: between(rng, area.y0, area.y1) };
    if (!canvas.open(p) || keepOut(p) || !canvas.spaced(p)) continue;
    canvas.taken.push(p);
    out.push(p);
  }
  if (out.length < count) throw new Error(`arena: placed ${out.length} of ${count} soldiers`);
  return out;
}

function battleMercs(): Point[] {
  const cx = Math.trunc(ARENA_WIDTH / 2);
  const y = ARENA_HEIGHT - MERC_ROW_FROM_BOTTOM;
  return Array.from({ length: 2 * MERCS_PER_ROW }, (_, i) => ({
    x: cx + ((i % MERCS_PER_ROW) - 1) * MERC_COLUMN_STEP,
    y: y + Math.trunc(i / MERCS_PER_ROW) * MERC_ROW_STEP,
  }));
}

function bunkerMercs(): Point[] {
  return Array.from({ length: 2 * MERCS_PER_ROW }, (_, i) => ({
    x: BUNKER.x0 + 1 + (i % MERCS_PER_ROW) * MERC_COLUMN_STEP,
    y: BUNKER.y0 + Math.trunc(i / MERCS_PER_ROW) * MERC_ROW_STEP,
  }));
}

function soldierLine(team: string, p: Point, direction: string, orders: string, attitude: string, cls: string, optional: boolean): string {
  return `soldier: ${team} ${p.x} ${p.y} ${direction} ${orders} ${attitude} ${cls}${optional ? ' optional' : ''}`;
}

function gridNoOf(p: Point): number {
  return (ARENA_ORIGIN.y + p.y) * WORLD_COLS + ARENA_ORIGIN.x + p.x;
}

function addGroundPatches(rng: Rng, canvas: Canvas): void {
  const area = { x0: 0, y0: 0, x1: ARENA_WIDTH - 1, y1: ARENA_HEIGHT - 1 };
  scatter(
    rng,
    canvas,
    GROUND_PATCHES,
    area,
    () => false,
    (p) => {
      const ch = rng.coinToss() ? GRASS_VARIANT : DIRT;
      for (let dy = 0; dy < 2; dy++)
        for (let dx = 0; dx < 3; dx++) if (canvas.at({ x: p.x + dx, y: p.y + dy }) === GROUND) canvas.set({ x: p.x + dx, y: p.y + dy }, ch);
    },
  );
}

export function generateArena(spec: ArenaSpec): Arena {
  if (spec.mercs > 2 * MERCS_PER_ROW) throw new Error(`arena: at most ${2 * MERCS_PER_ROW} mercs`);
  if (spec.elites > spec.enemies) throw new Error('arena: more elites than enemies');
  const rng = Rng.fromSeed(spec.seed);
  const canvas = new Canvas();
  const battle = spec.layout === ArenaLayout.BATTLE;
  addGroundPatches(rng, canvas);
  const mercs = (battle ? battleMercs() : bunkerMercs()).slice(0, spec.mercs);
  const mercBox: Box = {
    x0: Math.min(...mercs.map((p) => p.x)),
    y0: Math.min(...mercs.map((p) => p.y)),
    x1: Math.max(...mercs.map((p) => p.x)),
    y1: Math.max(...mercs.map((p) => p.y)),
  };
  const nearMercs = (p: Point) => inBox(p, mercBox, MERC_CLEARANCE);
  const nearBunker = (p: Point) => inBox(p, BUNKER, 1);
  if (!battle) drawBunker(canvas, BUNKER);
  const structureKeepOut = battle ? nearMercs : nearBunker;
  const interior = { x0: BORDER, y0: BORDER, x1: ARENA_WIDTH - BORDER - 1, y1: ARENA_HEIGHT - BORDER - 1 };
  drawWalls(rng, canvas, battle ? BATTLE_WALLS : PATROL_WALLS, structureKeepOut);
  scatter(rng, canvas, battle ? BATTLE_BARRELS : PATROL_BARRELS, interior, structureKeepOut, (p) => canvas.set(p, BARREL));
  canvas.taken.push(...mercs);
  const lines: string[] = [];
  const cls = (i: number) => (i < spec.elites ? 'ELITE' : 'ARMY');
  if (battle) {
    const militia = placeSoldiers(
      rng,
      canvas,
      spec.militia,
      {
        x0: mercBox.x0 - MILITIA_HALF_WIDTH,
        y0: mercBox.y0 - MILITIA_ROWS_ABOVE,
        x1: mercBox.x1 + MILITIA_HALF_WIDTH,
        y1: mercBox.y1 + MILITIA_ROWS_BELOW,
      },
      () => false,
    );
    for (const p of militia) lines.push(soldierLine('ENEMY', p, 'NORTH', 'STATIONARY', pick(rng, ATTITUDES), 'ARMY', false));
    const near = Math.ceil(spec.enemies / NEAR_ENEMY_SHARE);
    const nearArea = {
      x0: mercBox.x0 - NEAR_ENEMY_HALF_WIDTH,
      y0: mercBox.y0 - NEAR_ENEMY_MAX,
      x1: mercBox.x1 + NEAR_ENEMY_HALF_WIDTH,
      y1: mercBox.y0 - NEAR_ENEMY_MIN,
    };
    const farArea = { x0: BORDER, y0: BORDER, x1: ARENA_WIDTH - BORDER - 1, y1: ARENA_HEIGHT - FAR_ENEMY_BOTTOM_MARGIN };
    const enemies = [
      ...placeSoldiers(rng, canvas, near, nearArea, () => false),
      ...placeSoldiers(rng, canvas, spec.enemies - near, farArea, () => false),
    ];
    for (const [i, p] of enemies.entries())
      lines.push(soldierLine('ENEMY', p, pick(rng, DIRECTIONS), pick(rng, BATTLE_ORDERS), pick(rng, ATTITUDES), cls(i), true));
    const civilians = placeSoldiers(rng, canvas, spec.civilians, interior, nearMercs);
    for (const p of civilians) lines.push(soldierLine('CIV', p, pick(rng, DIRECTIONS), 'STATIONARY', 'DEFENSIVE', 'NONE', false));
  } else {
    const away = (p: Point) => inBox(p, BUNKER, BUNKER_KEEP_OUT);
    const enemies = placeSoldiers(rng, canvas, spec.enemies, interior, away);
    for (const [i, p] of enemies.entries())
      lines.push(soldierLine('ENEMY', p, pick(rng, DIRECTIONS), pick(rng, PATROL_ORDERS), pick(rng, ATTITUDES), cls(i), true));
    const civilians = placeSoldiers(rng, canvas, spec.civilians, interior, away);
    for (const p of civilians)
      lines.push(soldierLine('CIV', p, pick(rng, DIRECTIONS), pick(rng, CIVILIAN_PATROL_ORDERS), 'DEFENSIVE', 'NONE', false));
  }
  const entry = mercs[0] ?? { x: 0, y: 0 };
  const text = [
    STUB_MAP_FORMAT,
    `name: Bench ${spec.name}`,
    `tileset: ${ARENA_TILESET}`,
    `origin: ${ARENA_ORIGIN.x} ${ARENA_ORIGIN.y}`,
    'fill: land FIRSTTEXTURE 1',
    ...LEGEND,
    `entry: center ${entry.x} ${entry.y}`,
    ...lines,
    'map:',
    canvas.text(),
    '',
  ].join('\n');
  return {
    spec,
    path: `${STUB_MAPS_DIR}${ARENA_MAP_PREFIX}${spec.name}.dat`,
    text,
    mercGridNos: mercs.map(gridNoOf),
    alarmGridNo: battle ? null : gridNoOf(ALARM),
    garrison: { admins: 0, troops: spec.enemies - spec.elites, elites: spec.elites },
  };
}

export function arenaMapBytes(arena: Arena, tables: TileTables): Uint8Array {
  return writeMap(stubMapToMapDef(parseStubMapSource(arena.text, tables)));
}

import { FormatError } from '../binary/errors.ts';
import { parseSectorString } from '../strategic/sector-ids.ts';
import { WORLD_COLS, WORLD_MAX, WORLD_ROWS } from '../world/grid.ts';
import { type TileTables, typeIndex } from '../world/tile-tables.ts';
import {
  type ExitGrid,
  LAYER_NAMES,
  type LayerName,
  LightTime,
  type MapDef,
  MapFlags,
  type MapLightSprite,
  type Placement,
  tileLayerFromLists,
} from './map.ts';

export const STUB_MAP_FORMAT = 'ja2-node.map/1';
const STUB_MAP_MAJOR_VERSION = 5;
const STUB_MAP_MINOR_VERSION = 25;

interface TileRef {
  readonly layer: LayerName;
  readonly type: number;
  readonly subIndex: number;
}

interface Legend {
  readonly tiles: readonly TileRef[];
  readonly room: number;
}

export interface StubSoldier {
  readonly team: number;
  readonly x: number;
  readonly y: number;
  readonly direction: number;
  readonly orders: number;
  readonly attitude: number;
  readonly soldierClass: number;
  readonly priority: boolean;
}

export const StubEntry = { NORTH: 'north', EAST: 'east', SOUTH: 'south', WEST: 'west', CENTER: 'center', ISOLATED: 'isolated' } as const;
export type StubEntryName = (typeof StubEntry)[keyof typeof StubEntry];

export interface StubExit {
  readonly x: number;
  readonly y: number;
  readonly sector: { readonly x: number; readonly y: number; readonly z: number };
  readonly destinationGridNo: number;
}

export interface StubLight {
  readonly x: number;
  readonly y: number;
  readonly template: string;
  readonly time: number;
}

export interface StubMapSource {
  readonly name: string;
  readonly tilesetId: number;
  readonly origin: { readonly x: number; readonly y: number };
  readonly fill: Legend;
  readonly legend: ReadonlyMap<string, Legend>;
  readonly rows: readonly string[];
  readonly soldiers: readonly StubSoldier[];
  readonly lights: readonly StubLight[];
  readonly entries: ReadonlyMap<StubEntryName, { readonly x: number; readonly y: number }>;
  readonly exits: readonly StubExit[];
  readonly basement: boolean;
}

const AVERAGE_LEVEL = 2;
const BLACK_LIGHT_COLOUR = [0, 0, 0] as const;
const LIGHT_TIMES: Readonly<Record<string, number>> = { ALWAYS: 0, PRIME: LightTime.PRIME_TIME, NIGHT: LightTime.NIGHT_TIME };
const TEAMS: Readonly<Record<string, number>> = { ENEMY: 1, CREATURE: 2, MILITIA: 3, CIV: 4 };
const DIRECTIONS: Readonly<Record<string, number>> = {
  NORTH: 0,
  NORTHEAST: 1,
  EAST: 2,
  SOUTHEAST: 3,
  SOUTH: 4,
  SOUTHWEST: 5,
  WEST: 6,
  NORTHWEST: 7,
};
const ORDERS: Readonly<Record<string, number>> = {
  STATIONARY: 0,
  ONGUARD: 1,
  CLOSEPATROL: 2,
  FARPATROL: 3,
  POINTPATROL: 4,
  ONCALL: 5,
  SEEKENEMY: 6,
  RNDPTPATROL: 7,
};
const ATTITUDES: Readonly<Record<string, number>> = {
  DEFENSIVE: 0,
  BRAVESOLO: 1,
  BRAVEAID: 2,
  CUNNINGSOLO: 3,
  CUNNINGAID: 4,
  AGGRESSIVE: 5,
};
const CLASSES: Readonly<Record<string, number>> = { NONE: 0, ADMINISTRATOR: 1, ELITE: 2, ARMY: 3 };

function named(table: Readonly<Record<string, number>>, name: string | undefined, what: string, line: number): number {
  const v = name === undefined ? undefined : table[name];
  if (v === undefined) throw new FormatError(`line ${line}: unknown ${what} '${name ?? ''}'`);
  return v;
}

const OPTIONAL_PLACEMENT = 'optional';
const ENTRY_NAMES: readonly string[] = Object.values(StubEntry);

function parseSoldier(spec: string, line: number): StubSoldier {
  const [team, x, y, direction, orders, attitude, soldierClass, flag] = spec.split(/\s+/);
  if (flag !== undefined && flag !== OPTIONAL_PLACEMENT) throw new FormatError(`line ${line}: unknown soldier flag '${flag}'`);
  return {
    priority: flag !== OPTIONAL_PLACEMENT,
    team: named(TEAMS, team, 'team', line),
    x: Number(x),
    y: Number(y),
    direction: named(DIRECTIONS, direction, 'direction', line),
    orders: named(ORDERS, orders, 'orders', line),
    attitude: named(ATTITUDES, attitude, 'attitude', line),
    soldierClass: named(CLASSES, soldierClass ?? 'NONE', 'soldier class', line),
  };
}

function parseEntry(spec: string, line: number): [StubEntryName, { x: number; y: number }] {
  const [name, x, y] = spec.split(/\s+/);
  if (!name || !ENTRY_NAMES.includes(name) || x === undefined || y === undefined)
    throw new FormatError(`line ${line}: expected '<${ENTRY_NAMES.join('|')}> <x> <y>'`);
  return [name as StubEntryName, { x: Number(x), y: Number(y) }];
}

function parseExit(spec: string, line: number): StubExit {
  const m = /^(\d+)\s+(\d+)\s*->\s*([A-Pa-p]\d{1,2})(?:\s+z=(\d))?\s+at\s+(\d+)\s+(\d+)$/.exec(spec);
  if (!m) throw new FormatError(`line ${line}: expected '<x> <y> -> <SECTOR> [z=<level>] at <worldX> <worldY>'`);
  const [, x, y, sectorName, z, toX, toY] = m;
  const target = parseSectorString(sectorName ?? '', Number(z ?? 0));
  return { x: Number(x), y: Number(y), sector: target, destinationGridNo: Number(toY) * WORLD_COLS + Number(toX) };
}

const SCROLL_BASEMENT = 'basement';
const SCROLL_DEFAULT = 'default';
const BASEMENT_RESTRICTED_SCROLL = 1;
const BASEMENT_AMBIENT_LIGHT = 10;

function parseScroll(spec: string, line: number): boolean {
  if (spec !== SCROLL_BASEMENT && spec !== SCROLL_DEFAULT) throw new FormatError(`line ${line}: expected 'scroll: basement|default'`);
  return spec === SCROLL_BASEMENT;
}

function parseLight(spec: string, line: number): StubLight {
  const [x, y, template, time] = spec.split(/\s+/);
  if (!template) throw new FormatError(`line ${line}: expected '<x> <y> <TEMPLATE.LHT> [ALWAYS|PRIME|NIGHT]'`);
  return { x: Number(x), y: Number(y), template, time: named(LIGHT_TIMES, time ?? 'ALWAYS', 'light time', line) };
}

function parseLegend(spec: string, tables: TileTables, line: number): Legend {
  const tiles: TileRef[] = [];
  let room = 0;
  for (const part of spec.split(';').map((p) => p.trim())) {
    if (!part) continue;
    const [kind, name, sub] = part.split(/\s+/);
    if (kind === 'room') {
      room = Number(name);
      continue;
    }
    if (!LAYER_NAMES.includes(kind as LayerName) || !name)
      throw new FormatError(`line ${line}: expected '<layer> <TILETYPE> <subIndex>', got '${part}'`);
    tiles.push({ layer: kind as LayerName, type: typeIndex(tables, name), subIndex: Number(sub ?? 1) });
  }
  return { tiles, room };
}

export function parseStubMapSource(text: string, tables: TileTables): StubMapSource {
  const lines = text.split(/\r?\n/);
  if (lines[0]?.trim() !== STUB_MAP_FORMAT) throw new FormatError(`stub map must start with '${STUB_MAP_FORMAT}'`);
  let name = '';
  let tilesetId = 0;
  let origin = { x: 0, y: 0 };
  let fill: Legend | null = null;
  const legend = new Map<string, Legend>();
  const rows: string[] = [];
  const soldiers: StubSoldier[] = [];
  const lights: StubLight[] = [];
  const entries = new Map<StubEntryName, { x: number; y: number }>();
  const exits: StubExit[] = [];
  let inMap = false;
  let basement = false;
  lines.slice(1).forEach((raw, i) => {
    const lineNo = i + 2;
    if (inMap) {
      if (raw.length > 0) rows.push(raw);
      return;
    }
    const line = raw.trim();
    if (!line || line.startsWith('#')) return;
    if (line === 'map:') {
      inMap = true;
      return;
    }
    const match = /^(\w+)(?:\s+'(.)')?:\s*(.*)$/.exec(line);
    if (!match) throw new FormatError(`line ${lineNo}: cannot parse '${line}'`);
    const [, key, symbol, value = ''] = match;
    if (key === 'name') name = value;
    else if (key === 'tileset') tilesetId = Number(value);
    else if (key === 'origin') {
      const [x, y] = value.split(/\s+/).map(Number);
      origin = { x: x ?? 0, y: y ?? 0 };
    } else if (key === 'fill') fill = parseLegend(value, tables, lineNo);
    else if (key === 'legend' && symbol) legend.set(symbol, parseLegend(value, tables, lineNo));
    else if (key === 'soldier') soldiers.push(parseSoldier(value, lineNo));
    else if (key === 'light') lights.push(parseLight(value, lineNo));
    else if (key === 'entry') entries.set(...parseEntry(value, lineNo));
    else if (key === 'exit') exits.push(parseExit(value, lineNo));
    else if (key === 'scroll') basement = parseScroll(value, lineNo);
    else throw new FormatError(`line ${lineNo}: unknown key '${key}'`);
  });
  if (!fill) throw new FormatError('stub map needs a fill legend');
  const width = Math.max(0, ...rows.map((r) => r.length));
  if (origin.x < 0 || origin.y < 0 || origin.x + width > WORLD_COLS || origin.y + rows.length > WORLD_ROWS) {
    throw new FormatError('stub map does not fit into the world');
  }
  for (const row of rows) for (const ch of row) if (!legend.has(ch)) throw new FormatError(`unknown map symbol '${ch}'`);
  return { name, tilesetId, origin, fill, legend, rows, soldiers, lights, entries, exits, basement };
}

function localGridNo(source: StubMapSource, x: number, y: number): number {
  return (source.origin.y + y) * WORLD_COLS + source.origin.x + x;
}

function entryGridNo(source: StubMapSource, name: StubEntryName, fallback: number): number {
  const at = source.entries.get(name);
  return at ? localGridNo(source, at.x, at.y) : fallback;
}

export function stubMapToMapDef(source: StubMapSource): Omit<MapDef, 'trailingBytes'> {
  const lists = Object.fromEntries(
    LAYER_NAMES.map((n) => [n, Array.from({ length: WORLD_MAX }, () => [] as { type: number; subIndex: number }[])]),
  ) as Record<LayerName, { type: number; subIndex: number }[][]>;
  const rooms = new Uint8Array(WORLD_MAX);
  const place = (g: number, l: Legend) => {
    for (const t of l.tiles) lists[t.layer][g]?.push({ type: t.type, subIndex: t.subIndex });
    rooms[g] = l.room;
  };
  for (let g = 0; g < WORLD_MAX; g++) place(g, source.fill);
  source.rows.forEach((row, y) => {
    [...row].forEach((ch, x) => {
      const g = (source.origin.y + y) * WORLD_COLS + source.origin.x + x;
      for (const name of LAYER_NAMES) (lists[name][g] as unknown[]).length = 0;
      place(g, source.legend.get(ch) as Legend);
    });
  });
  const center =
    (source.origin.y + Math.floor(source.rows.length / 2)) * WORLD_COLS + source.origin.x + Math.floor((source.rows[0]?.length ?? 0) / 2);
  return {
    majorVersion: STUB_MAP_MAJOR_VERSION,
    minorVersion: STUB_MAP_MINOR_VERSION,
    flags:
      (source.soldiers.length > 0 ? MapFlags.FULL_SOLDIER : 0) |
      (source.lights.length > 0 ? MapFlags.WORLD_LIGHTS : 0) |
      (source.exits.length > 0 ? MapFlags.EXIT_GRIDS : 0) |
      (source.basement ? MapFlags.AMBIENT_LIGHT_LEVEL : 0),
    tilesetId: source.tilesetId,
    heights: new Uint8Array(WORLD_MAX),
    worldFlags: new Uint8Array(WORLD_MAX),
    layers: Object.fromEntries(LAYER_NAMES.map((n) => [n, tileLayerFromLists(lists[n])])) as MapDef['layers'],
    rooms,
    items: [],
    ambient: source.basement ? { basement: true, caves: false, lightLevel: BASEMENT_AMBIENT_LIGHT } : null,
    lights:
      source.lights.length > 0 ? { colors: [BLACK_LIGHT_COLOUR], sprites: source.lights.map((l) => stubLightSprite(source, l)) } : null,
    info: {
      northGridNo: entryGridNo(source, StubEntry.NORTH, -1),
      eastGridNo: entryGridNo(source, StubEntry.EAST, -1),
      southGridNo: entryGridNo(source, StubEntry.SOUTH, -1),
      westGridNo: entryGridNo(source, StubEntry.WEST, -1),
      numIndividuals: source.soldiers.length,
      mapVersion: STUB_MAP_MINOR_VERSION,
      restrictedScrollId: source.basement ? BASEMENT_RESTRICTED_SCROLL : 0,
      editorSmoothingType: 0,
      centerGridNo: entryGridNo(source, StubEntry.CENTER, center),
      isolatedGridNo: entryGridNo(source, StubEntry.ISOLATED, -1),
    },
    placements: source.soldiers.map((soldier) => stubPlacement(source, soldier)),
    exitGrids: source.exits.map(
      (e): ExitGrid => ({ mapIndex: localGridNo(source, e.x, e.y), gridNo: e.destinationGridNo, sector: e.sector }),
    ),
    doors: [],
    edgepoints: null,
    schedules: [],
  };
}

function stubLightSprite(source: StubMapSource, l: StubLight): MapLightSprite {
  return { x: source.origin.x + l.x, y: source.origin.y + l.y, flags: l.time, template: l.template };
}

function stubPlacement(source: StubMapSource, s: StubSoldier): Placement {
  const g = (source.origin.y + s.y) * WORLD_COLS + source.origin.x + s.x;
  return {
    basic: {
      detailed: false,
      startingGridNo: g,
      team: s.team,
      relativeAttributeLevel: AVERAGE_LEVEL,
      relativeEquipmentLevel: AVERAGE_LEVEL,
      direction: s.direction,
      orders: s.orders,
      attitude: s.attitude,
      bodyType: -1,
      patrolGrid: [g],
      patrolCount: 0,
      onRoof: false,
      soldierClass: s.soldierClass,
      civilianGroup: 0,
      priorityExistence: s.priority,
      hasKeys: false,
    },
    detailedRaw: null,
  };
}

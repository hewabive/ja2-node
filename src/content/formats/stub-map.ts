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
  type MapDoor,
  MapFlags,
  type MapLightSprite,
  type MapSchedule,
  type Placement,
  tileLayerFromLists,
} from './map.ts';
import { writeProfileDetailedPlacement } from './placement.ts';

export const STUB_MAP_FORMAT = 'ja2-node.map/1';
export const SAME_SECTOR = { x: 0, y: 0 } as const;
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
  readonly profile: number | null;
  readonly schedule: string | null;
  readonly civilianGroup: number;
  readonly bodyType: number;
}

export interface StubScheduleEntry {
  readonly time: number | null;
  readonly action: number;
  readonly data1: { readonly x: number; readonly y: number } | null;
  readonly data2: { readonly x: number; readonly y: number } | null;
}

export interface StubSchedule {
  readonly symbol: string;
  readonly entries: readonly StubScheduleEntry[];
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

export interface StubDoor {
  readonly x: number;
  readonly y: number;
  readonly lockId: number;
  readonly locked: boolean;
  readonly trapId: number;
  readonly trapLevel: number;
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
  readonly doors: readonly StubDoor[];
  readonly schedules: readonly StubSchedule[];
  readonly basement: boolean;
}

const AVERAGE_LEVEL = 2;
const NO_PROFILE = 200;
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
const PROFILE_FLAG = /^profile=(\d+)$/;
const SCHEDULE_FLAG = /^schedule=(.)$/;
const GROUP_FLAG = /^group=(\d+)$/;
const BODY_FLAG = /^body=(\d+)$/;
const RANDOM_BODY = -1;
const ENTRY_NAMES: readonly string[] = Object.values(StubEntry);

function parseSoldier(spec: string, line: number): StubSoldier {
  const [team, x, y, direction, orders, attitude, soldierClass, ...flags] = spec.split(/\s+/);
  let profile: number | null = null;
  let schedule: string | null = null;
  let civilianGroup = 0;
  let bodyType = RANDOM_BODY;
  for (const flag of flags) {
    const m = PROFILE_FLAG.exec(flag);
    const scheduled = SCHEDULE_FLAG.exec(flag);
    const group = GROUP_FLAG.exec(flag);
    const body = BODY_FLAG.exec(flag);
    if (m) profile = Number(m[1]);
    else if (scheduled) schedule = scheduled[1] ?? null;
    else if (group) civilianGroup = Number(group[1]);
    else if (body) bodyType = Number(body[1]);
    else if (flag !== OPTIONAL_PLACEMENT) throw new FormatError(`line ${line}: unknown soldier flag '${flag}'`);
  }
  return {
    priority: !flags.includes(OPTIONAL_PLACEMENT),
    profile,
    schedule,
    civilianGroup,
    bodyType,
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

const HERE = 'here';

function exitTarget(sectorName: string, z: number): { x: number; y: number; z: number } {
  return sectorName === HERE ? { ...SAME_SECTOR, z } : parseSectorString(sectorName, z);
}

function parseExit(spec: string, line: number): StubExit {
  const m = /^(\d+)\s+(\d+)\s*->\s*([A-Pa-p]\d{1,2}|here)(?:\s+z=(\d))?\s+at\s+(\d+)\s+(\d+)$/.exec(spec);
  if (!m) throw new FormatError(`line ${line}: expected '<x> <y> -> <SECTOR|here> [z=<level>] at <worldX> <worldY>'`);
  const [, x, y, sectorName, z, toX, toY] = m;
  const target = exitTarget(sectorName ?? '', Number(z ?? 0));
  return { x: Number(x), y: Number(y), sector: target, destinationGridNo: Number(toY) * WORLD_COLS + Number(toX) };
}

const DOOR_TRAPS: Readonly<Record<string, number>> = {
  NONE: 0,
  EXPLOSION: 1,
  ELECTRIC: 2,
  SIREN: 3,
  SILENT_ALARM: 4,
  BROTHEL_SIREN: 5,
  SUPER_ELECTRIC: 6,
};

function parseDoor(spec: string, line: number): StubDoor {
  const [x, y, ...options] = spec.split(/\s+/);
  if (x === undefined || y === undefined)
    throw new FormatError(`line ${line}: expected '<x> <y> lock=<id> [locked] [trap=<NAME> level=<n>]'`);
  const door = { x: Number(x), y: Number(y), lockId: 0, locked: false, trapId: 0, trapLevel: 0 };
  for (const option of options) {
    const [key, value] = option.split('=');
    if (key === 'locked' && value === undefined) door.locked = true;
    else if (key === 'lock') door.lockId = Number(value);
    else if (key === 'trap') door.trapId = named(DOOR_TRAPS, value, 'door trap', line);
    else if (key === 'level') door.trapLevel = Number(value);
    else throw new FormatError(`line ${line}: unknown door option '${option}'`);
  }
  return door;
}

const SCHEDULE_ACTIONS: Readonly<Record<string, number>> = {
  LOCKDOOR: 1,
  UNLOCKDOOR: 2,
  OPENDOOR: 3,
  CLOSEDOOR: 4,
  GRIDNO: 5,
  LEAVESECTOR: 6,
  ENTERSECTOR: 7,
  STAYINSECTOR: 8,
  SLEEP: 9,
  WAKE: 10,
};
const SCHEDULE_ENTRY = /^(?:(\d{2}):(\d{2})\s+)?([A-Z]+)(?:\s+(\d+)\s+(\d+))?(?:\s*->\s*(\d+)\s+(\d+))?$/;
const MAX_SCHEDULE_ENTRIES = 4;
const MINUTES_PER_HOUR = 60;
const UNSET_SCHEDULE_VALUE = 0xffff;

function point(x: string | undefined, y: string | undefined): { x: number; y: number } | null {
  return x === undefined || y === undefined ? null : { x: Number(x), y: Number(y) };
}

function parseScheduleEntry(spec: string, line: number): StubScheduleEntry {
  const m = SCHEDULE_ENTRY.exec(spec);
  if (!m) throw new FormatError(`line ${line}: expected '[HH:MM] <ACTION> [<x> <y>] [-> <x> <y>]', got '${spec}'`);
  const [, hours, minutes, action, x1, y1, x2, y2] = m;
  return {
    time: hours === undefined ? null : Number(hours) * MINUTES_PER_HOUR + Number(minutes),
    action: named(SCHEDULE_ACTIONS, action, 'schedule action', line),
    data1: point(x1, y1),
    data2: point(x2, y2),
  };
}

function parseSchedule(symbol: string, spec: string, line: number): StubSchedule {
  const entries = spec
    .split(';')
    .map((part) => part.trim())
    .filter((part) => part.length > 0)
    .map((part) => parseScheduleEntry(part, line));
  if (entries.length === 0 || entries.length > MAX_SCHEDULE_ENTRIES)
    throw new FormatError(`line ${line}: a schedule has 1 to ${MAX_SCHEDULE_ENTRIES} entries`);
  return { symbol, entries };
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
  const doors: StubDoor[] = [];
  const schedules: StubSchedule[] = [];
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
    else if (key === 'door') doors.push(parseDoor(value, lineNo));
    else if (key === 'schedule' && symbol) schedules.push(parseSchedule(symbol, value, lineNo));
    else if (key === 'scroll') basement = parseScroll(value, lineNo);
    else throw new FormatError(`line ${lineNo}: unknown key '${key}'`);
  });
  if (!fill) throw new FormatError('stub map needs a fill legend');
  const width = Math.max(0, ...rows.map((r) => r.length));
  if (origin.x < 0 || origin.y < 0 || origin.x + width > WORLD_COLS || origin.y + rows.length > WORLD_ROWS) {
    throw new FormatError('stub map does not fit into the world');
  }
  for (const row of rows) for (const ch of row) if (!legend.has(ch)) throw new FormatError(`unknown map symbol '${ch}'`);
  checkScheduleLinks(schedules, soldiers);
  return { name, tilesetId, origin, fill, legend, rows, soldiers, lights, entries, exits, doors, schedules, basement };
}

function checkScheduleLinks(schedules: readonly StubSchedule[], soldiers: readonly StubSoldier[]): void {
  const symbols = schedules.map((s) => s.symbol);
  if (new Set(symbols).size !== symbols.length) throw new FormatError('schedule symbols must be unique');
  const used = soldiers.map((s) => s.schedule).filter((s): s is string => s !== null);
  if (new Set(used).size !== used.length) throw new FormatError('a schedule belongs to one soldier');
  for (const symbol of used) if (!symbols.includes(symbol)) throw new FormatError(`unknown schedule '${symbol}'`);
}

function scheduleIdOf(source: StubMapSource, symbol: string | null): number {
  return symbol === null ? 0 : source.schedules.findIndex((s) => s.symbol === symbol) + 1;
}

function stubMapSchedule(source: StubMapSource, schedule: StubSchedule): MapSchedule {
  const unset = () => Array.from({ length: MAX_SCHEDULE_ENTRIES }, () => UNSET_SCHEDULE_VALUE);
  const times = unset();
  const data1 = unset();
  const data2 = unset();
  const actions = Array.from({ length: MAX_SCHEDULE_ENTRIES }, () => 0);
  schedule.entries.forEach((e, i) => {
    times[i] = e.time ?? UNSET_SCHEDULE_VALUE;
    actions[i] = e.action;
    if (e.data1) data1[i] = localGridNo(source, e.data1.x, e.data1.y);
    if (e.data2) data2[i] = localGridNo(source, e.data2.x, e.data2.y);
  });
  return { times, data1, data2, actions, flags: 0 };
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
      (source.doors.length > 0 ? MapFlags.DOOR_TABLE : 0) |
      (source.schedules.length > 0 ? MapFlags.NPC_SCHEDULES : 0) |
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
    doors: source.doors.map(
      (d): MapDoor => ({
        gridNo: localGridNo(source, d.x, d.y),
        locked: d.locked,
        trapLevel: d.trapLevel,
        trapId: d.trapId,
        lockId: d.lockId,
        perceivedLocked: 0,
        perceivedTrapped: 0,
        lockDamage: 0,
      }),
    ),
    edgepoints: null,
    schedules: source.schedules.map((schedule) => stubMapSchedule(source, schedule)),
  };
}

function stubLightSprite(source: StubMapSource, l: StubLight): MapLightSprite {
  return { x: source.origin.x + l.x, y: source.origin.y + l.y, flags: l.time, template: l.template };
}

function stubPlacement(source: StubMapSource, s: StubSoldier): Placement {
  const g = (source.origin.y + s.y) * WORLD_COLS + source.origin.x + s.x;
  const detailedRaw =
    s.profile === null && s.schedule === null && s.civilianGroup === 0
      ? null
      : writeProfileDetailedPlacement({
          profile: s.profile ?? NO_PROFILE,
          direction: s.direction,
          insertionGridNo: g,
          team: s.team,
          attitude: s.attitude,
          orders: s.orders,
          soldierClass: s.soldierClass,
          scheduleId: scheduleIdOf(source, s.schedule),
          civilianGroup: s.civilianGroup,
        });
  return {
    basic: {
      detailed: detailedRaw !== null,
      startingGridNo: g,
      team: s.team,
      relativeAttributeLevel: AVERAGE_LEVEL,
      relativeEquipmentLevel: AVERAGE_LEVEL,
      direction: s.direction,
      orders: s.orders,
      attitude: s.attitude,
      bodyType: s.bodyType,
      patrolGrid: [g],
      patrolCount: 0,
      onRoof: false,
      soldierClass: s.soldierClass,
      civilianGroup: s.civilianGroup,
      priorityExistence: s.priority,
      hasKeys: false,
    },
    detailedRaw,
  };
}

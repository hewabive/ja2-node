// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-15. See LICENSE (SFI-SCLA).
// @src src/game/TileEngine/WorldDef.cc LoadWorldFromSGPFile, LoadMapLights; Tactical/World_Items.cc;
// @src Tactical/Map_Information.cc; Tactical/Soldier_Init_List.cc; TileEngine/Exit_Grids.cc; Tactical/Keys.cc;
// @src TileEngine/Map_Edgepoints.cc; Strategic/Scheduling.cc; TileEngine/LoadSaveLightSprite.cc

import { FormatError } from '../binary/errors.ts';
import { BinaryReader } from '../binary/reader.ts';
import { BinaryWriter } from '../binary/writer.ts';
import { WORLD_COLS, WORLD_MAX, WORLD_ROWS } from '../world/grid.ts';

export const MapFlags = {
  FULL_SOLDIER: 0x001,
  WORLD_LIGHTS: 0x004,
  WORLD_ITEMS: 0x008,
  EXIT_GRIDS: 0x010,
  DOOR_TABLE: 0x020,
  EDGEPOINTS: 0x040,
  AMBIENT_LIGHT_LEVEL: 0x080,
  NPC_SCHEDULES: 0x100,
} as const;

export const LightTime = { PRIME_TIME: 0x0080, NIGHT_TIME: 0x0100 } as const;

const NEWEST_MAJOR_VERSION = 6;
const NEWEST_MINOR_VERSION = 26;
const MINOR_VERSION_WITH_WIDE_OBJECT_SUBINDEX = 15;
const RUSSIAN_MAP_EXTRA_BYTES = 148;
const WORLD_ITEM_BYTES = 52;
const MAP_INFORMATION_BYTES = 100;
const BASIC_PLACEMENT_BYTES = 52;
const DETAILED_PLACEMENT_BYTES = 1040;
const LIGHT_SPRITE_HEADER_BYTES = 25;
const DOOR_BYTES = 14;
const SCHEDULE_BYTES = 36;
const EXIT_GRID_BYTES = 7;
const MAP_VERSION_WITH_SECOND_EDGEPOINT_LAYER = 17;

export const LAYER_NAMES = ['land', 'objects', 'structs', 'shadows', 'roofs', 'onRoof'] as const;
export type LayerName = (typeof LAYER_NAMES)[number];

export interface TileLayer {
  readonly offsets: Uint32Array;
  readonly types: Uint8Array;
  readonly subIndices: Uint16Array;
}

export interface MapItem {
  readonly gridNo: number;
  readonly level: number;
  readonly item: number;
  readonly flags: number;
  readonly renderZHeightAboveLevel: number;
  readonly visible: number;
  readonly nonExistChance: number;
  readonly raw: Uint8Array;
}

export interface MapLightSprite {
  readonly x: number;
  readonly y: number;
  readonly flags: number;
  readonly template: string;
}

export interface MapLights {
  readonly colors: readonly (readonly [number, number, number])[];
  readonly sprites: readonly MapLightSprite[];
}

export interface MapInformation {
  readonly northGridNo: number;
  readonly eastGridNo: number;
  readonly southGridNo: number;
  readonly westGridNo: number;
  readonly numIndividuals: number;
  readonly mapVersion: number;
  readonly restrictedScrollId: number;
  readonly editorSmoothingType: number;
  readonly centerGridNo: number;
  readonly isolatedGridNo: number;
}

export interface BasicPlacement {
  readonly detailed: boolean;
  readonly startingGridNo: number;
  readonly team: number;
  readonly relativeAttributeLevel: number;
  readonly relativeEquipmentLevel: number;
  readonly direction: number;
  readonly orders: number;
  readonly attitude: number;
  readonly bodyType: number;
  readonly patrolGrid: readonly number[];
  readonly patrolCount: number;
  readonly onRoof: boolean;
  readonly soldierClass: number;
  readonly civilianGroup: number;
  readonly priorityExistence: boolean;
  readonly hasKeys: boolean;
}

export interface Placement {
  readonly basic: BasicPlacement;
  readonly detailedRaw: Uint8Array | null;
}

export interface ExitGrid {
  readonly mapIndex: number;
  readonly gridNo: number;
  readonly sector: { readonly x: number; readonly y: number; readonly z: number };
}

export interface MapDoor {
  readonly gridNo: number;
  readonly locked: boolean;
  readonly trapLevel: number;
  readonly trapId: number;
  readonly lockId: number;
  readonly perceivedLocked: number;
  readonly perceivedTrapped: number;
  readonly lockDamage: number;
}

export interface EdgepointList {
  readonly middle: number;
  readonly gridNos: readonly number[];
}

export interface MapEdgepoints {
  readonly primary: readonly EdgepointList[];
  readonly secondary: readonly EdgepointList[] | null;
}

export interface MapSchedule {
  readonly times: readonly number[];
  readonly data1: readonly number[];
  readonly data2: readonly number[];
  readonly actions: readonly number[];
  readonly flags: number;
}

export interface MapDef {
  readonly majorVersion: number;
  readonly minorVersion: number;
  readonly flags: number;
  readonly tilesetId: number;
  readonly heights: Uint8Array;
  readonly worldFlags: Uint8Array;
  readonly layers: Readonly<Record<LayerName, TileLayer>>;
  readonly rooms: Uint8Array;
  readonly items: readonly MapItem[];
  readonly ambient: { readonly basement: boolean; readonly caves: boolean; readonly lightLevel: number } | null;
  readonly lights: MapLights | null;
  readonly info: MapInformation;
  readonly placements: readonly Placement[];
  readonly exitGrids: readonly ExitGrid[];
  readonly doors: readonly MapDoor[];
  readonly edgepoints: MapEdgepoints | null;
  readonly schedules: readonly MapSchedule[];
  readonly trailingBytes: number;
}

export function tilesAt(layer: TileLayer, gridNo: number): { type: number; subIndex: number }[] {
  const out: { type: number; subIndex: number }[] = [];
  for (let i = layer.offsets[gridNo] ?? 0; i < (layer.offsets[gridNo + 1] ?? 0); i++) {
    out.push({ type: layer.types[i] ?? 0, subIndex: layer.subIndices[i] ?? 0 });
  }
  return out;
}

function readLayer(r: BinaryReader, counts: Uint8Array, wideSubIndex: boolean): TileLayer {
  const offsets = new Uint32Array(WORLD_MAX + 1);
  for (let g = 0; g < WORLD_MAX; g++) offsets[g + 1] = (offsets[g] ?? 0) + (counts[g] ?? 0);
  const total = offsets[WORLD_MAX] ?? 0;
  const types = new Uint8Array(total);
  const subIndices = new Uint16Array(total);
  for (let i = 0; i < total; i++) {
    types[i] = r.u8();
    subIndices[i] = wideSubIndex ? r.u16() : r.u8();
  }
  return { offsets, types, subIndices };
}

function readItem(r: BinaryReader): MapItem {
  const raw = r.bytesView(WORLD_ITEM_BYTES).slice();
  const v = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
  return {
    gridNo: v.getInt16(2, true),
    level: v.getUint8(4),
    item: v.getUint16(8, true),
    flags: v.getUint16(44, true),
    renderZHeightAboveLevel: v.getInt8(46),
    visible: v.getInt8(47),
    nonExistChance: v.getUint8(48),
    raw,
  };
}

function readLights(r: BinaryReader): MapLights {
  const colorCount = r.u8();
  const colors: [number, number, number][] = [];
  for (let i = 0; i < colorCount; i++) {
    colors.push([r.u8(), r.u8(), r.u8()]);
    r.skip(1);
  }
  const lightCount = r.u16();
  const sprites: MapLightSprite[] = [];
  for (let i = 0; i < lightCount; i++) {
    const header = new BinaryReader(r.bytesView(LIGHT_SPRITE_HEADER_BYTES));
    const x = header.i16();
    const y = header.i16();
    header.skip(12);
    const flags = header.u32();
    header.skip(4);
    const nameLength = header.u8();
    sprites.push({ x, y, flags, template: r.fixedString(nameLength) });
  }
  return { colors, sprites };
}

function readMapInformation(r: BinaryReader): MapInformation {
  const b = new BinaryReader(r.bytesView(MAP_INFORMATION_BYTES));
  return {
    northGridNo: b.i16(),
    eastGridNo: b.i16(),
    southGridNo: b.i16(),
    westGridNo: b.i16(),
    numIndividuals: b.u8(),
    mapVersion: b.u8(),
    restrictedScrollId: b.u8(),
    editorSmoothingType: b.u8(),
    centerGridNo: b.i16(),
    isolatedGridNo: b.i16(),
  };
}

function readBasicPlacement(r: BinaryReader): BasicPlacement {
  const b = new BinaryReader(r.bytesView(BASIC_PLACEMENT_BYTES));
  const detailed = b.u8() !== 0;
  b.skip(1);
  const startingGridNo = b.u16();
  const team = (b.u8() << 24) >> 24;
  const relativeAttributeLevel = (b.u8() << 24) >> 24;
  const relativeEquipmentLevel = (b.u8() << 24) >> 24;
  const direction = (b.u8() << 24) >> 24;
  const orders = (b.u8() << 24) >> 24;
  const attitude = (b.u8() << 24) >> 24;
  const bodyType = (b.u8() << 24) >> 24;
  b.skip(1);
  const patrolGrid: number[] = [];
  for (let i = 0; i < 10; i++) patrolGrid.push(b.i16());
  const patrolCount = (b.u8() << 24) >> 24;
  const onRoof = b.u8() !== 0;
  const soldierClass = b.u8();
  const civilianGroup = b.u8();
  const priorityExistence = b.u8() !== 0;
  const hasKeys = b.u8() !== 0;
  return {
    detailed,
    startingGridNo,
    team,
    relativeAttributeLevel,
    relativeEquipmentLevel,
    direction,
    orders,
    attitude,
    bodyType,
    patrolGrid,
    patrolCount,
    onRoof,
    soldierClass,
    civilianGroup,
    priorityExistence,
    hasKeys,
  };
}

function readEdgepointList(r: BinaryReader): EdgepointList {
  const count = r.u16();
  const middle = r.u16();
  const gridNos: number[] = [];
  for (let i = 0; i < count; i++) gridNos.push(r.i16());
  return { middle, gridNos };
}

function readSchedule(r: BinaryReader): MapSchedule {
  const b = new BinaryReader(r.bytesView(SCHEDULE_BYTES));
  b.skip(4);
  const u16s = (n: number) => Array.from({ length: n }, () => b.u16());
  const times = u16s(4);
  const data1 = u16s(4);
  const data2 = u16s(4);
  const actions = Array.from({ length: 4 }, () => b.u8());
  b.skip(2);
  return { times, data1, data2, actions, flags: b.u16() };
}

export function parseMap(bytes: Uint8Array): MapDef {
  const r = new BinaryReader(bytes);
  const majorVersion = new DataView(bytes.buffer, bytes.byteOffset, 4).getFloat32(0, true);
  r.skip(4);
  const minorVersion = majorVersion >= 4 ? r.u8() : 0;
  if (majorVersion > NEWEST_MAJOR_VERSION || minorVersion > NEWEST_MINOR_VERSION) {
    throw new FormatError(`unsupported map version ${majorVersion}/${minorVersion}`);
  }
  const flags = r.u32();
  const tilesetId = r.i32();
  r.skip(4);

  const heights = new Uint8Array(WORLD_MAX);
  for (let row = 0; row < WORLD_ROWS; row++) {
    const packed = r.bytesView(WORLD_COLS * 2);
    for (let col = 0; col < WORLD_COLS; col++) heights[row * WORLD_COLS + col] = packed[col * 2] ?? 0;
  }

  const counts = LAYER_NAMES.map(() => new Uint8Array(WORLD_MAX));
  const worldFlags = new Uint8Array(WORLD_MAX);
  for (let g = 0; g < WORLD_MAX; g++) {
    const [b0, b1, b2, b3] = [r.u8(), r.u8(), r.u8(), r.u8()];
    const [land, objects, structs, shadows, roofs, onRoof] = counts as [
      Uint8Array,
      Uint8Array,
      Uint8Array,
      Uint8Array,
      Uint8Array,
      Uint8Array,
    ];
    land[g] = b0 & 0x0f;
    worldFlags[g] = b0 >> 4;
    objects[g] = b1 & 0x0f;
    structs[g] = b1 >> 4;
    shadows[g] = b2 & 0x0f;
    roofs[g] = b2 >> 4;
    onRoof[g] = b3 & 0x0f;
  }
  const layerList = LAYER_NAMES.map((name, i) =>
    readLayer(r, counts[i] as Uint8Array, name === 'objects' && minorVersion >= MINOR_VERSION_WITH_WIDE_OBJECT_SUBINDEX),
  );
  const layers = Object.fromEntries(LAYER_NAMES.map((name, i) => [name, layerList[i]])) as Record<LayerName, TileLayer>;

  if (majorVersion === NEWEST_MAJOR_VERSION && minorVersion === NEWEST_MINOR_VERSION) r.skip(RUSSIAN_MAP_EXTRA_BYTES);
  const rooms = r.bytesView(WORLD_MAX).slice();

  const items: MapItem[] = [];
  if (flags & MapFlags.WORLD_ITEMS) {
    const count = r.u32();
    for (let i = 0; i < count; i++) items.push(readItem(r));
  }
  const ambient = flags & MapFlags.AMBIENT_LIGHT_LEVEL ? { basement: r.u8() !== 0, caves: r.u8() !== 0, lightLevel: r.u8() } : null;
  const lights = flags & MapFlags.WORLD_LIGHTS ? readLights(r) : null;
  const info = readMapInformation(r);
  if (majorVersion >= 4 && info.mapVersion !== minorVersion) {
    throw new FormatError(`map information version ${info.mapVersion} does not match minor version ${minorVersion}`);
  }

  const placements: Placement[] = [];
  if (flags & MapFlags.FULL_SOLDIER) {
    for (let i = 0; i < info.numIndividuals; i++) {
      const basic = readBasicPlacement(r);
      placements.push({ basic, detailedRaw: basic.detailed ? r.bytesView(DETAILED_PLACEMENT_BYTES).slice() : null });
    }
  }
  const exitGrids: ExitGrid[] = [];
  if (flags & MapFlags.EXIT_GRIDS) {
    const count = r.u16();
    for (let i = 0; i < count; i++) {
      const b = new BinaryReader(r.bytesView(EXIT_GRID_BYTES));
      exitGrids.push({ mapIndex: b.u16(), gridNo: b.u16(), sector: { x: b.u8(), y: b.u8(), z: b.u8() } });
    }
  }
  const doors: MapDoor[] = [];
  if (flags & MapFlags.DOOR_TABLE) {
    const count = r.u8();
    for (let i = 0; i < count; i++) {
      const b = new BinaryReader(r.bytesView(DOOR_BYTES));
      const gridNo = b.i16();
      const locked = b.u8() !== 0;
      const trapLevel = b.u8();
      const trapId = b.u8();
      const lockId = b.u8();
      b.skip(2);
      doors.push({ gridNo, locked, trapLevel, trapId, lockId, perceivedLocked: 0, perceivedTrapped: 0, lockDamage: (b.u8() << 24) >> 24 });
    }
  }
  let edgepoints: MapEdgepoints | null = null;
  if (flags & MapFlags.EDGEPOINTS) {
    const primary = [0, 1, 2, 3].map(() => readEdgepointList(r));
    const secondary = info.mapVersion >= MAP_VERSION_WITH_SECOND_EDGEPOINT_LAYER ? [0, 1, 2, 3].map(() => readEdgepointList(r)) : null;
    edgepoints = { primary, secondary };
  }
  const schedules: MapSchedule[] = [];
  if (flags & MapFlags.NPC_SCHEDULES) {
    const count = r.u8();
    for (let i = 0; i < count; i++) schedules.push(readSchedule(r));
  }

  return {
    majorVersion,
    minorVersion,
    flags,
    tilesetId,
    heights,
    worldFlags,
    layers,
    rooms,
    items,
    ambient,
    lights,
    info,
    placements,
    exitGrids,
    doors,
    edgepoints,
    schedules,
    trailingBytes: r.remaining,
  };
}

function writeLayer(w: BinaryWriter, layer: TileLayer, wideSubIndex: boolean): void {
  for (let i = 0; i < layer.types.length; i++) {
    w.u8(layer.types[i] ?? 0);
    if (wideSubIndex) w.u16(layer.subIndices[i] ?? 0);
    else w.u8(layer.subIndices[i] ?? 0);
  }
}

function layerCount(layer: TileLayer, g: number): number {
  const n = (layer.offsets[g + 1] ?? 0) - (layer.offsets[g] ?? 0);
  if (n > 0x0f) throw new RangeError(`more than 15 tiles in one layer at gridno ${g}`);
  return n;
}

export function writeMap(map: Omit<MapDef, 'trailingBytes'>): Uint8Array {
  const w = new BinaryWriter(1 << 20);
  const head = new DataView(new ArrayBuffer(4));
  head.setFloat32(0, map.majorVersion, true);
  w.bytes(new Uint8Array(head.buffer));
  if (map.majorVersion >= 4) w.u8(map.minorVersion);
  w.u32(map.flags).i32(map.tilesetId).zeros(4);
  for (let g = 0; g < WORLD_MAX; g++) w.u8(map.heights[g] ?? 0).u8(0);
  const l = map.layers;
  for (let g = 0; g < WORLD_MAX; g++) {
    w.u8(layerCount(l.land, g) | ((map.worldFlags[g] ?? 0) << 4));
    w.u8(layerCount(l.objects, g) | (layerCount(l.structs, g) << 4));
    w.u8(layerCount(l.shadows, g) | (layerCount(l.roofs, g) << 4));
    w.u8(layerCount(l.onRoof, g));
  }
  for (const name of LAYER_NAMES) writeLayer(w, l[name], name === 'objects' && map.minorVersion >= MINOR_VERSION_WITH_WIDE_OBJECT_SUBINDEX);
  if (map.majorVersion === NEWEST_MAJOR_VERSION && map.minorVersion === NEWEST_MINOR_VERSION) w.zeros(RUSSIAN_MAP_EXTRA_BYTES);
  w.bytes(map.rooms);
  if (map.flags & MapFlags.WORLD_ITEMS) {
    w.u32(map.items.length);
    for (const item of map.items) w.bytes(item.raw);
  }
  if (map.flags & MapFlags.AMBIENT_LIGHT_LEVEL) {
    w.u8(map.ambient?.basement ? 1 : 0)
      .u8(map.ambient?.caves ? 1 : 0)
      .u8(map.ambient?.lightLevel ?? 0);
  }
  if (map.flags & MapFlags.WORLD_LIGHTS) {
    const lights = map.lights ?? { colors: [], sprites: [] };
    w.u8(lights.colors.length);
    for (const [r, g, b] of lights.colors) w.u8(r).u8(g).u8(b).u8(0);
    w.u16(lights.sprites.length);
    for (const s of lights.sprites) {
      w.i16(s.x)
        .i16(s.y)
        .zeros(12)
        .u32(s.flags)
        .zeros(4)
        .u8(s.template.length + 1)
        .fixedString(s.template.length + 1, s.template);
    }
  }
  const info = map.info;
  w.i16(info.northGridNo).i16(info.eastGridNo).i16(info.southGridNo).i16(info.westGridNo);
  w.u8(info.numIndividuals).u8(info.mapVersion).u8(info.restrictedScrollId).u8(info.editorSmoothingType);
  w.i16(info.centerGridNo)
    .i16(info.isolatedGridNo)
    .zeros(MAP_INFORMATION_BYTES - 16);
  if (map.flags & MapFlags.FULL_SOLDIER) {
    for (const p of map.placements) {
      const b = p.basic;
      w.u8(b.detailed ? 1 : 0)
        .zeros(1)
        .u16(b.startingGridNo);
      for (const v of [b.team, b.relativeAttributeLevel, b.relativeEquipmentLevel, b.direction, b.orders, b.attitude, b.bodyType])
        w.u8(v & 0xff);
      w.zeros(1);
      for (let i = 0; i < 10; i++) w.i16(b.patrolGrid[i] ?? 0);
      w.u8(b.patrolCount & 0xff)
        .u8(b.onRoof ? 1 : 0)
        .u8(b.soldierClass)
        .u8(b.civilianGroup)
        .u8(b.priorityExistence ? 1 : 0)
        .u8(b.hasKeys ? 1 : 0)
        .zeros(14);
      if (b.detailed) w.bytes(p.detailedRaw ?? new Uint8Array(DETAILED_PLACEMENT_BYTES));
    }
  }
  if (map.flags & MapFlags.EXIT_GRIDS) {
    w.u16(map.exitGrids.length);
    for (const e of map.exitGrids) w.u16(e.mapIndex).u16(e.gridNo).u8(e.sector.x).u8(e.sector.y).u8(e.sector.z);
  }
  if (map.flags & MapFlags.DOOR_TABLE) {
    w.u8(map.doors.length);
    for (const d of map.doors) {
      w.i16(d.gridNo)
        .u8(d.locked ? 1 : 0)
        .u8(d.trapLevel)
        .u8(d.trapId)
        .u8(d.lockId)
        .u8(d.perceivedLocked & 0xff)
        .u8(d.perceivedTrapped & 0xff)
        .u8(d.lockDamage & 0xff)
        .zeros(DOOR_BYTES - 9);
    }
  }
  if (map.flags & MapFlags.EDGEPOINTS) {
    const lists = [...(map.edgepoints?.primary ?? []), ...(map.edgepoints?.secondary ?? [])];
    for (const list of lists) {
      w.u16(list.gridNos.length).u16(list.middle);
      for (const g of list.gridNos) w.i16(g);
    }
  }
  if (map.flags & MapFlags.NPC_SCHEDULES) {
    w.u8(map.schedules.length);
    for (const s of map.schedules) {
      w.zeros(4);
      for (const v of [...s.times, ...s.data1, ...s.data2]) w.u16(v);
      for (const a of s.actions) w.u8(a);
      w.zeros(2).u16(s.flags);
    }
  }
  return w.toBytes();
}

export function emptyTileLayer(): TileLayer {
  return { offsets: new Uint32Array(WORLD_MAX + 1), types: new Uint8Array(0), subIndices: new Uint16Array(0) };
}

export function tileLayerFromLists(lists: readonly (readonly { type: number; subIndex: number }[])[]): TileLayer {
  const offsets = new Uint32Array(WORLD_MAX + 1);
  for (let g = 0; g < WORLD_MAX; g++) offsets[g + 1] = (offsets[g] ?? 0) + (lists[g]?.length ?? 0);
  const total = offsets[WORLD_MAX] ?? 0;
  const types = new Uint8Array(total);
  const subIndices = new Uint16Array(total);
  let i = 0;
  for (let g = 0; g < WORLD_MAX; g++) {
    for (const t of lists[g] ?? []) {
      types[i] = t.type;
      subIndices[i++] = t.subIndex;
    }
  }
  return { offsets, types, subIndices };
}

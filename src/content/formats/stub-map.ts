import { FormatError } from '../binary/errors.ts';
import { WORLD_COLS, WORLD_MAX, WORLD_ROWS } from '../world/grid.ts';
import { type TileTables, typeIndex } from '../world/tile-tables.ts';
import { LAYER_NAMES, type LayerName, type MapDef, tileLayerFromLists } from './map.ts';

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

export interface StubMapSource {
  readonly name: string;
  readonly tilesetId: number;
  readonly origin: { readonly x: number; readonly y: number };
  readonly fill: Legend;
  readonly legend: ReadonlyMap<string, Legend>;
  readonly rows: readonly string[];
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
  let inMap = false;
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
    else throw new FormatError(`line ${lineNo}: unknown key '${key}'`);
  });
  if (!fill) throw new FormatError('stub map needs a fill legend');
  const width = Math.max(0, ...rows.map((r) => r.length));
  if (origin.x < 0 || origin.y < 0 || origin.x + width > WORLD_COLS || origin.y + rows.length > WORLD_ROWS) {
    throw new FormatError('stub map does not fit into the world');
  }
  for (const row of rows) for (const ch of row) if (!legend.has(ch)) throw new FormatError(`unknown map symbol '${ch}'`);
  return { name, tilesetId, origin, fill, legend, rows };
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
    flags: 0,
    tilesetId: source.tilesetId,
    heights: new Uint8Array(WORLD_MAX),
    worldFlags: new Uint8Array(WORLD_MAX),
    layers: Object.fromEntries(LAYER_NAMES.map((n) => [n, tileLayerFromLists(lists[n])])) as MapDef['layers'],
    rooms,
    items: [],
    ambient: null,
    lights: null,
    info: {
      northGridNo: -1,
      eastGridNo: -1,
      southGridNo: -1,
      westGridNo: -1,
      numIndividuals: 0,
      mapVersion: STUB_MAP_MINOR_VERSION,
      restrictedScrollId: 0,
      editorSmoothingType: 0,
      centerGridNo: center,
      isolatedGridNo: -1,
    },
    placements: [],
    exitGrids: [],
    doors: [],
    edgepoints: null,
    schedules: [],
  };
}

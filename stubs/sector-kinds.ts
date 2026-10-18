import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { FormatError } from '../src/content/binary/errors.ts';
import { asArray, asObject, asString } from '../src/content/strategic/json-fields.ts';
import { parseSectorString, type Sector } from '../src/content/strategic/sector-ids.ts';

export const SECTOR_KINDS_FILE = join(import.meta.dirname, 'maps', 'sector-kinds.json');
export const SECTOR_KINDS_FORMAT = 'ja2-node stub sector kinds v1';

const SECTOR_NAME = /^([A-P]\d{1,2})(?:_b([1-3]))?(_a)?$/;
const MAP_NAME = /^[a-z0-9_-]+$/;
const MAP_SUFFIX = '.dat';

export interface SectorKind {
  readonly kind: string;
  readonly map: string;
  readonly sectors: readonly string[];
}

export interface SectorKindTable {
  readonly fallback: string;
  readonly handMade: ReadonlyMap<string, string>;
  readonly kinds: readonly SectorKind[];
}

export interface NamedSector extends Sector {
  readonly alternate: boolean;
}

export function parseSectorName(name: string): NamedSector {
  const m = SECTOR_NAME.exec(name);
  if (!m) throw new FormatError(`stub sector kinds: bad sector name ${name}`);
  return { ...parseSectorString(m[1] ?? '', Number(m[2] ?? 0)), alternate: m[3] !== undefined };
}

export function sectorMapFile(name: string): string {
  parseSectorName(name);
  return `${name.toLowerCase()}${MAP_SUFFIX}`;
}

function mapName(value: unknown, what: string): string {
  const name = asString(value, what);
  if (!MAP_NAME.test(name)) throw new FormatError(`${what}: bad map name ${name}`);
  return name;
}

export function parseSectorKinds(json: unknown): SectorKindTable {
  const o = asObject(json, 'stub sector kinds');
  if (o.format !== SECTOR_KINDS_FORMAT) throw new FormatError(`stub sector kinds: format must be ${SECTOR_KINDS_FORMAT}`);
  const seen = new Set<string>();
  const claim = (name: string) => {
    parseSectorName(name);
    if (seen.has(name)) throw new FormatError(`stub sector kinds: ${name} is listed twice`);
    seen.add(name);
  };
  const handMade = new Map<string, string>();
  for (const [name, note] of Object.entries(asObject(o.handMade, 'stub sector kinds.handMade'))) {
    claim(name);
    handMade.set(name, asString(note, `stub sector kinds.handMade.${name}`));
  }
  const kinds = asArray(o.kinds, 'stub sector kinds.kinds').map((entry, i): SectorKind => {
    const k = asObject(entry, `stub sector kinds.kinds[${i}]`);
    const sectors = asArray(k.sectors, `stub sector kinds.kinds[${i}].sectors`).map((s, j) =>
      asString(s, `stub sector kinds.kinds[${i}].sectors[${j}]`),
    );
    for (const name of sectors) claim(name);
    return {
      kind: asString(k.kind, `stub sector kinds.kinds[${i}].kind`),
      map: mapName(k.map, `stub sector kinds.kinds[${i}].map`),
      sectors,
    };
  });
  return { fallback: mapName(o.fallback, 'stub sector kinds.fallback'), handMade, kinds };
}

export async function loadSectorKinds(): Promise<SectorKindTable> {
  return parseSectorKinds(JSON.parse(await readFile(SECTOR_KINDS_FILE, 'utf8')));
}

export function kindOfSector(table: SectorKindTable, name: string): SectorKind | null {
  return table.kinds.find((k) => k.sectors.includes(name)) ?? null;
}

export function sectorKindAliases(table: SectorKindTable, mapsDir: string, compiled: ReadonlySet<string>): Map<string, string> {
  for (const name of table.handMade.keys())
    if (!compiled.has(sectorMapFile(name))) throw new FormatError(`stub sector kinds: no hand-made map for ${name}`);
  if (!compiled.has(`${table.fallback}${MAP_SUFFIX}`)) throw new FormatError(`stub sector kinds: no fallback map ${table.fallback}`);
  const aliases = new Map<string, string>();
  for (const kind of table.kinds) {
    const target = `${kind.map}${MAP_SUFFIX}`;
    if (!compiled.has(target)) throw new FormatError(`stub sector kinds: no map ${kind.map} for ${kind.kind}`);
    for (const name of kind.sectors) {
      const file = sectorMapFile(name);
      if (file === target) continue;
      if (compiled.has(file)) throw new FormatError(`stub sector kinds: ${name} has a hand-made map and a kind`);
      aliases.set(`${mapsDir}/${file}`, `${mapsDir}/${target}`);
    }
  }
  return aliases;
}

// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-11-09. See LICENSE (SFI-SCLA).
// @src rust/stracciatella/src/guess.rs guess_by_resource_matching, match_resources, Percentages (the share of
// @src resources only in the data directory counts those only in the pack); rust/stracciatella/src/res.rs ResourcePack
// @src (has_file_size, get_hashes, get_archives), ResourcePackBuilder (the game's temp folder left out, md5 only);
// @src rust/stracciatella/src/config/vanilla_version.rs VanillaVersion::from_str; rust/stracciatella/src/unicode.rs
// @src Nfc::caseless.

import { FormatError } from '../binary/errors.ts';
import { asArray, asObject, asString, type JsonObject } from '../strategic/json-fields.ts';
import { VANILLA_VERSIONS, type VanillaVersion } from './data-version.ts';

export const RESOURCE_PACKS_DIR = 'externalized/resource_packs';

const VERSION_PROPERTY = 'vanilla_version';
const FILE_SIZE_PROPERTY = 'with_file_size';
const HASH_PROPERTY_PREFIX = 'with_hash_';
const ARCHIVE_PROPERTY_PREFIX = 'with_archive_';
const RESOURCE_FILE_SIZE = 'file_size';
const RESOURCE_HASH_PREFIX = 'hash_';
const RESOURCE_ARCHIVE_PATH = 'archive_path';
const SUPPORTED_HASHES: ReadonlySet<string> = new Set(['md5']);
const GAME_TEMP_FOLDER = 'temp/';

export interface PackResource {
  readonly path: string;
  readonly archivePath: string | null;
  readonly fileSize: number | null;
  readonly hashes: ReadonlyMap<string, string>;
}

export interface ResourcePack {
  readonly name: string;
  readonly version: VanillaVersion;
  readonly withFileSize: boolean;
  readonly hashes: readonly string[];
  readonly resources: readonly PackResource[];
}

export interface DataDirFile {
  readonly path: string;
  readonly size: number;
}

export type HashFile = (file: DataDirFile, algorithm: string) => Promise<string>;

function stracciatellaName(version: VanillaVersion): string {
  return version.replaceAll(/[A-Z]/g, (c) => `_${c}`).toUpperCase();
}

function packVersion(name: string): VanillaVersion {
  const version = VANILLA_VERSIONS.find((v) => stracciatellaName(v) === name);
  if (!version) throw new FormatError(`resource version ${name} is unknown`);
  return version;
}

function enabledProperties(properties: JsonObject): string[] {
  return Object.entries(properties).flatMap(([key, value]) => (value === true ? [key] : []));
}

function prefixed(keys: readonly string[], prefix: string): string[] {
  return keys.filter((k) => k.startsWith(prefix)).map((k) => k.slice(prefix.length));
}

function integerOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) ? value : null;
}

function packResource(json: unknown, what: string): PackResource {
  const o = asObject(json, what);
  const properties = asObject(o.properties ?? {}, `${what}.properties`);
  const hashes = new Map<string, string>();
  for (const [key, value] of Object.entries(properties))
    if (key.startsWith(RESOURCE_HASH_PREFIX) && typeof value === 'string') hashes.set(key.slice(RESOURCE_HASH_PREFIX.length), value);
  const archivePath = properties[RESOURCE_ARCHIVE_PATH];
  return {
    path: asString(o.path, `${what}.path`),
    archivePath: typeof archivePath === 'string' ? archivePath : null,
    fileSize: integerOrNull(properties[RESOURCE_FILE_SIZE]),
    hashes,
  };
}

export function parseResourcePack(json: unknown): ResourcePack {
  const o = asObject(json, 'resource pack');
  const properties = asObject(o.properties ?? {}, 'resource pack.properties');
  const enabled = enabledProperties(properties);
  const archives = prefixed(enabled, ARCHIVE_PROPERTY_PREFIX);
  if (archives.length > 0) throw new FormatError(`resource packs with archives (${archives.join(', ')}) are not supported`);
  const hashes = [...new Set(prefixed(enabled, HASH_PROPERTY_PREFIX))].sort();
  const unsupported = hashes.find((h) => !SUPPORTED_HASHES.has(h));
  if (unsupported) throw new FormatError(`${unsupported} hashes are not supported`);
  return {
    name: asString(o.name, 'resource pack.name'),
    version: packVersion(asString(properties[VERSION_PROPERTY], `resource pack.properties.${VERSION_PROPERTY}`)),
    withFileSize: enabled.includes(FILE_SIZE_PROPERTY),
    hashes,
    resources: asArray(o.resources ?? [], 'resource pack.resources').map((r, i) => packResource(r, `resource pack.resources[${i}]`)),
  };
}

function caseless(path: string): string {
  return path.normalize('NFC').toLowerCase();
}

function comparedKey(archivePath: string | null, path: string): string {
  return JSON.stringify([archivePath === null ? null : caseless(archivePath), caseless(path)]);
}

function inGameTempFolder(path: string): boolean {
  return path.toLowerCase().startsWith(GAME_TEMP_FOLDER);
}

interface Candidate {
  readonly file: DataDirFile;
  readonly expected: PackResource;
}

interface PackMatch {
  readonly order: number;
  readonly pack: ResourcePack;
  readonly resources: number;
  readonly onlyInPack: number;
  readonly sizeMismatches: number;
  hashMismatches: number;
  readonly unhashed: Candidate[];
}

function differenceShare(m: PackMatch, hashMismatches: number): number {
  const n = m.resources;
  const onlyInPack = m.onlyInPack / n;
  const onlyInDataDir = onlyInPack;
  return onlyInDataDir + onlyInPack + m.sizeMismatches / n + hashMismatches / n;
}

const leastDifference = (m: PackMatch) => differenceShare(m, m.hashMismatches);
const mostDifference = (m: PackMatch) => differenceShare(m, m.hashMismatches + m.unhashed.length * m.pack.hashes.length);

function matchPack(pack: ResourcePack, order: number, files: readonly DataDirFile[]): PackMatch {
  const dataKeys = new Set(files.map((f) => comparedKey(null, f.path)));
  const packKeys = new Set(pack.resources.map((r) => comparedKey(r.archivePath, r.path)));
  const byPath = new Map<string, PackResource>();
  for (const r of pack.resources) if (!byPath.has(caseless(r.path))) byPath.set(caseless(r.path), r);
  let sizeMismatches = 0;
  const unhashed: Candidate[] = [];
  for (const file of files) {
    const expected = packKeys.has(comparedKey(null, file.path)) ? byPath.get(caseless(file.path)) : undefined;
    if (!expected) continue;
    if ((pack.withFileSize ? file.size : null) !== expected.fileSize) sizeMismatches++;
    else if (pack.hashes.length > 0) unhashed.push({ file, expected });
  }
  unhashed.sort((a, b) => a.file.size - b.file.size);
  return {
    order,
    pack,
    resources: new Set([...dataKeys, ...packKeys]).size,
    onlyInPack: [...packKeys].filter((k) => !dataKeys.has(k)).length,
    sizeMismatches,
    hashMismatches: 0,
    unhashed,
  };
}

function before(a: PackMatch, b: PackMatch): boolean {
  const da = leastDifference(a);
  const db = leastDifference(b);
  return da < db || (da === db && a.order < b.order);
}

function beatsWhateverIsLeft(m: PackMatch, others: readonly PackMatch[]): boolean {
  const most = mostDifference(m);
  return others.every((o) => o === m || most < leastDifference(o) || (most === leastDifference(o) && m.order < o.order));
}

async function hashNext(m: PackMatch, hash: HashFile): Promise<void> {
  const next = m.unhashed.shift();
  if (!next) return;
  for (const algorithm of m.pack.hashes) if ((await hash(next.file, algorithm)) !== next.expected.hashes.get(algorithm)) m.hashMismatches++;
}

export async function matchResourcePacks(
  packs: readonly ResourcePack[],
  dataDir: readonly DataDirFile[],
  hash: HashFile,
): Promise<VanillaVersion | null> {
  const files = dataDir.filter((f) => !inGameTempFolder(f.path));
  const matches = packs.map((pack, order) => matchPack(pack, order, files)).filter((m) => m.resources > 0);
  for (;;) {
    const best = matches.reduce<PackMatch | null>((found, m) => (found === null || before(m, found) ? m : found), null);
    if (best === null) return null;
    if (beatsWhateverIsLeft(best, matches)) return best.pack.version;
    await hashNext(best, hash);
  }
}

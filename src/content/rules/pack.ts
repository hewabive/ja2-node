import { ANIMATION_SCRIPTS_PATHS } from '../anim/timelines.ts';
import { FormatError } from '../binary/errors.ts';
import { normalizeVfsPath } from '../vfs/path.ts';
import type { ReadFile } from '../world/tileset-loader.ts';
import { isMapFile, isRuleFile, isTextRuleFile } from './families.ts';
import { encodeGraphicFacts, graphicFactsOf, graphicFactsPath, isGraphicFactsPath } from './graphic-facts.ts';
import { ruleGraphicPaths } from './graphics.ts';

export const RULE_PACK_FORMAT = 'ja2-node-rules';
export const RULE_PACK_VERSION = 1;
export const CONTENT_HASH_LENGTH = 16;
export const NO_SCRIPTS = 'none';

export type RuleSource = 'original' | 'stubs';

export type Sha256 = (bytes: Uint8Array) => Promise<string>;

export interface RuleListingEntry {
  readonly path: string;
  readonly size: number;
  readonly layers: number;
}

export interface RuleHashedEntry {
  readonly path: string;
  readonly size: number;
  readonly hash: string;
}

export interface RuleBlob {
  readonly path: string;
  readonly size: number;
  readonly sha256: string;
}

export type RuleLayerCount = readonly [path: string, count: number];

export interface RulePackManifest {
  readonly format: typeof RULE_PACK_FORMAT;
  readonly version: number;
  readonly source: RuleSource;
  readonly hash: string;
  readonly scripts: string;
  readonly files: readonly RuleBlob[];
  readonly graphics: readonly RuleHashedEntry[];
  readonly layers: readonly RuleLayerCount[];
}

export interface RulePackIdentityInput {
  readonly source: RuleSource;
  readonly files: readonly RuleHashedEntry[];
  readonly graphics: readonly RuleHashedEntry[];
  readonly layers: readonly RuleLayerCount[];
}

export interface RuleBlobSink {
  put(sha256: string, bytes: Uint8Array): Promise<void>;
}

export interface RuleBlobSource {
  get(sha256: string): Promise<Uint8Array>;
}

export interface RulePackBuildInput {
  readonly source: RuleSource;
  readonly listing: readonly RuleListingEntry[];
  read(path: string): Promise<Uint8Array>;
  readonly sha256: Sha256;
  readonly sink: RuleBlobSink;
  readonly onDigest?: (path: string, sha256: string) => void;
}

export class NotARuleFileError extends Error {
  override readonly name = 'NotARuleFileError';
  readonly path: string;

  constructor(path: string) {
    super(`${path} is not a rule file: the simulation reads only the rule pack`);
    this.path = path;
  }
}

export function contentHashOf(sha256: string): string {
  return sha256.slice(0, CONTENT_HASH_LENGTH);
}

function byPath<T extends { readonly path: string }>(a: T, b: T): number {
  return a.path < b.path ? -1 : a.path > b.path ? 1 : 0;
}

function fileLine(e: RuleHashedEntry): string {
  return isTextRuleFile(e.path) ? `p ${e.path}` : `f ${e.path} ${e.size} ${e.hash}`;
}

export function rulePackIdentityText(input: RulePackIdentityInput): string {
  return [
    `${RULE_PACK_FORMAT} ${RULE_PACK_VERSION}`,
    `source ${input.source}`,
    ...[...input.files].sort(byPath).map(fileLine),
    ...[...input.graphics].sort(byPath).map((g) => `g ${g.path} ${g.size} ${g.hash}`),
    ...[...input.layers].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([path, count]) => `l ${path} ${count}`),
  ].join('\n');
}

export function rulePackHash(input: RulePackIdentityInput, sha256: Sha256): Promise<string> {
  return sha256(new TextEncoder().encode(rulePackIdentityText(input)));
}

export function manifestIdentity(manifest: Pick<RulePackManifest, 'source' | 'files' | 'graphics' | 'layers'>): RulePackIdentityInput {
  return {
    source: manifest.source,
    files: manifest.files
      .filter((f) => !isGraphicFactsPath(f.path))
      .map((f) => ({ path: f.path, size: f.size, hash: contentHashOf(f.sha256) })),
    graphics: manifest.graphics,
    layers: manifest.layers,
  };
}

function scriptsHashOf(files: readonly RuleBlob[]): string {
  for (const path of ANIMATION_SCRIPTS_PATHS) {
    const found = files.find((f) => f.path === path);
    if (found) return contentHashOf(found.sha256);
  }
  return NO_SCRIPTS;
}

function listingByPath<T extends RuleListingEntry>(listing: readonly T[]): Map<string, T> {
  return new Map(listing.map((e) => [normalizeVfsPath(e.path), e]));
}

function ruleReaderOver(listed: ReadonlyMap<string, RuleListingEntry>, read: (path: string) => Promise<Uint8Array>): ReadFile {
  return async (path) => {
    const normalized = normalizeVfsPath(path);
    return listed.has(normalized) && isRuleFile(normalized) ? read(normalized) : null;
  };
}

async function listedRuleGraphics(
  listed: ReadonlyMap<string, RuleListingEntry>,
  read: (path: string) => Promise<Uint8Array>,
): Promise<string[]> {
  const maps = [...listed.keys()].filter((path) => isMapFile(path) && isRuleFile(path));
  return (await ruleGraphicPaths(ruleReaderOver(listed, read), maps)).filter((path) => listed.has(path));
}

export interface RuleListingWithHash extends RuleListingEntry {
  readonly hash: string;
}

export async function rulePackIdentityOfListing(
  source: RuleSource,
  listing: readonly RuleListingWithHash[],
  read: (path: string) => Promise<Uint8Array>,
): Promise<RulePackIdentityInput> {
  const listed = listingByPath(listing);
  const rules = [...listed.values()].filter((e) => isRuleFile(e.path));
  const hashed = (e: RuleListingWithHash): RuleHashedEntry => ({ path: e.path, size: e.size, hash: e.hash });
  const graphics = (await listedRuleGraphics(listed, read)).map((path) => hashed(listed.get(path) as RuleListingWithHash));
  return {
    source,
    files: rules.map(hashed),
    graphics,
    layers: rules.filter((e) => e.layers > 1).map((e): RuleLayerCount => [e.path, e.layers]),
  };
}

export function scriptsHashOfListing(listing: readonly RuleListingWithHash[]): string {
  const listed = listingByPath(listing);
  for (const path of ANIMATION_SCRIPTS_PATHS) {
    const found = listed.get(path);
    if (found) return found.hash;
  }
  return NO_SCRIPTS;
}

async function storeBlob(input: RulePackBuildInput, path: string, bytes: Uint8Array): Promise<RuleBlob> {
  const sha256 = await input.sha256(bytes);
  await input.sink.put(sha256, bytes);
  return { path, size: bytes.length, sha256 };
}

export async function buildRulePackManifest(input: RulePackBuildInput): Promise<RulePackManifest> {
  const listed = listingByPath(input.listing);
  const rules = [...listed.values()].filter((e) => isRuleFile(e.path)).sort(byPath);
  const files: RuleBlob[] = [];
  for (const entry of rules) {
    const blob = await storeBlob(input, entry.path, await input.read(entry.path));
    input.onDigest?.(entry.path, blob.sha256);
    files.push(blob);
  }
  const graphics: RuleHashedEntry[] = [];
  for (const path of await listedRuleGraphics(listed, input.read)) {
    const bytes = await input.read(path);
    const sha256 = await input.sha256(bytes);
    input.onDigest?.(path, sha256);
    graphics.push({ path, size: bytes.length, hash: contentHashOf(sha256) });
    files.push(await storeBlob(input, graphicFactsPath(path), encodeGraphicFacts(graphicFactsOf(path, bytes))));
  }
  files.sort(byPath);
  const layers = rules.filter((e) => e.layers > 1).map((e): RuleLayerCount => [e.path, e.layers]);
  const partial = { source: input.source, files, graphics, layers };
  return {
    format: RULE_PACK_FORMAT,
    version: RULE_PACK_VERSION,
    source: input.source,
    hash: await rulePackHash(manifestIdentity(partial), input.sha256),
    scripts: scriptsHashOf(files),
    files,
    graphics,
    layers,
  };
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isHashedEntry(value: unknown, hashKey: 'hash' | 'sha256'): boolean {
  return isRecord(value) && typeof value.path === 'string' && typeof value.size === 'number' && typeof value[hashKey] === 'string';
}

export function parseRulePackManifest(value: unknown): RulePackManifest {
  if (!isRecord(value) || value.format !== RULE_PACK_FORMAT) throw new FormatError('not a ja2-node rule pack');
  if (value.version !== RULE_PACK_VERSION) throw new FormatError(`rule pack version ${String(value.version)} is not ${RULE_PACK_VERSION}`);
  if (value.source !== 'original' && value.source !== 'stubs') throw new FormatError('rule pack source must be original or stubs');
  if (typeof value.hash !== 'string' || typeof value.scripts !== 'string') throw new FormatError('rule pack hashes are missing');
  if (!Array.isArray(value.files) || !value.files.every((f) => isHashedEntry(f, 'sha256'))) throw new FormatError('bad rule pack files');
  if (!Array.isArray(value.graphics) || !value.graphics.every((g) => isHashedEntry(g, 'hash')))
    throw new FormatError('bad rule pack graphics');
  const layersOk =
    Array.isArray(value.layers) && value.layers.every((l) => Array.isArray(l) && typeof l[0] === 'string' && typeof l[1] === 'number');
  if (!layersOk) throw new FormatError('bad rule pack layer counts');
  return value as unknown as RulePackManifest;
}

export async function verifyRulePackManifest(manifest: RulePackManifest, sha256: Sha256): Promise<boolean> {
  return (await rulePackHash(manifestIdentity(manifest), sha256)) === manifest.hash && scriptsHashOf(manifest.files) === manifest.scripts;
}

export class RulePack {
  readonly manifest: RulePackManifest;
  readonly #blobs: RuleBlobSource;
  readonly #files: ReadonlyMap<string, RuleBlob>;
  readonly #layers: ReadonlyMap<string, number>;

  constructor(manifest: RulePackManifest, blobs: RuleBlobSource) {
    this.manifest = manifest;
    this.#blobs = blobs;
    this.#files = new Map(manifest.files.map((f) => [f.path, f]));
    this.#layers = new Map(manifest.layers);
  }

  get hash(): string {
    return this.manifest.hash;
  }

  get scriptsHash(): string {
    return this.manifest.scripts;
  }

  get source(): RuleSource {
    return this.manifest.source;
  }

  #entry(path: string): RuleBlob | null {
    const normalized = normalizeVfsPath(path);
    const entry = this.#files.get(normalized);
    if (entry) return entry;
    if (isRuleFile(normalized) || isGraphicFactsPath(normalized)) return null;
    throw new NotARuleFileError(path);
  }

  readonly read: ReadFile = async (path) => {
    const entry = this.#entry(path);
    return entry ? this.#blobs.get(entry.sha256) : null;
  };

  readonly exists = (path: string): boolean => this.#entry(path) !== null;

  readonly layers = (path: string): number => {
    const normalized = normalizeVfsPath(path);
    return this.#layers.get(normalized) ?? (this.#files.has(normalized) ? 1 : 0);
  };
}

export class MemoryRuleBlobs implements RuleBlobSink, RuleBlobSource {
  readonly #blobs = new Map<string, Uint8Array>();

  async put(sha256: string, bytes: Uint8Array): Promise<void> {
    this.#blobs.set(sha256, bytes);
  }

  async get(sha256: string): Promise<Uint8Array> {
    const bytes = this.#blobs.get(sha256);
    if (!bytes) throw new FormatError(`the rule pack has no blob ${sha256}`);
    return bytes;
  }
}

export async function buildMemoryRulePack(input: Omit<RulePackBuildInput, 'sink'>): Promise<RulePack> {
  const blobs = new MemoryRuleBlobs();
  return new RulePack(await buildRulePackManifest({ ...input, sink: blobs }), blobs);
}

import { createHash, randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readdir, readFile, rename, rm, stat, utimes, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { SPEECH_LENGTHS_VERSION } from '../content/audio/speech-lengths.ts';
import { RULE_FAMILIES_SIGNATURE } from '../content/rules/families.ts';
import { GRAPHIC_FACTS_VERSION } from '../content/rules/graphic-facts.ts';
import {
  buildMemoryRulePack,
  buildRulePackManifest,
  parseRulePackManifest,
  RULE_PACK_VERSION,
  type RuleBlobSink,
  type RuleBlobSource,
  type RuleListingEntry,
  RulePack,
  type RulePackManifest,
  type RuleSource,
  type Sha256,
  verifyRulePackManifest,
} from '../content/rules/pack.ts';
import type { Vfs } from '../content/vfs/vfs.ts';
import { REPO_ROOT } from '../node/repo.ts';

export const CACHE_DIR_ENV = 'JA2_CACHE_DIR';
export const DEFAULT_CACHE_DIR = join(REPO_ROOT, '.ja2', 'cache');
const PACK_DIR_PREFIX = 'rules-';
const BUILD_DIR_PREFIX = 'build-rules-';
const PACK_FILE = 'pack.json';
const BLOB_DIR = 'blobs';
const INDEX_FILE = 'rules-index.json';
const KEPT_PACKS = 4;

export interface CachedRulePack {
  readonly sourceKey: string;
  readonly manifest: RulePackManifest;
}

export interface OpenRulePackOptions {
  readonly vfs: Vfs;
  readonly source: RuleSource;
  readonly cacheDir: string | null;
  readonly onDigest?: (path: string, sha256: string) => void;
}

export interface OpenedRulePack {
  readonly pack: RulePack;
  readonly cached: boolean;
  readonly dir: string | null;
}

export const nodeSha256: Sha256 = async (bytes) => createHash('sha256').update(bytes).digest('hex');

export function cacheDirFromEnv(env: NodeJS.ProcessEnv = process.env): string {
  return env[CACHE_DIR_ENV] || DEFAULT_CACHE_DIR;
}

export function vfsRuleListing(vfs: Vfs): RuleListingEntry[] {
  return vfs.list().map((f) => ({ path: f.path, size: f.size, layers: vfs.layerCount(f.path), layer: f.layer }));
}

export function ruleSourceKey(vfs: Vfs, source: RuleSource): string | null {
  const hash = createHash('sha256');
  hash.update([RULE_PACK_VERSION, GRAPHIC_FACTS_VERSION, SPEECH_LENGTHS_VERSION, RULE_FAMILIES_SIGNATURE, source].join('\n'));
  for (const f of vfs.list()) {
    const stamp = vfs.stamp(f.path);
    if (stamp === null) return null;
    hash.update(`\n${f.path}\t${f.size}\t${vfs.layerCount(f.path)}\t${f.layer}\t${stamp}`);
  }
  return hash.digest('hex');
}

class DirRuleBlobs implements RuleBlobSink, RuleBlobSource {
  readonly #dir: string;

  constructor(dir: string) {
    this.#dir = dir;
  }

  async put(sha256: string, bytes: Uint8Array): Promise<void> {
    const path = join(this.#dir, sha256);
    if (!existsSync(path)) await writeFile(path, bytes);
  }

  get(sha256: string): Promise<Uint8Array> {
    return readFile(join(this.#dir, sha256));
  }
}

async function readJson(path: string): Promise<unknown> {
  try {
    return JSON.parse(await readFile(path, 'utf8')) as unknown;
  } catch {
    return null;
  }
}

async function writeJsonAtomically(path: string, value: unknown): Promise<void> {
  const temp = `${path}.${randomUUID()}.tmp`;
  await writeFile(temp, JSON.stringify(value));
  await rename(temp, path);
}

async function readIndex(cacheDir: string): Promise<Record<string, string>> {
  const index = await readJson(join(cacheDir, INDEX_FILE));
  return typeof index === 'object' && index !== null && !Array.isArray(index) ? (index as Record<string, string>) : {};
}

function packDir(cacheDir: string, hash: string): string {
  return join(cacheDir, `${PACK_DIR_PREFIX}${hash}`);
}

async function loadCached(cacheDir: string, sourceKey: string): Promise<OpenedRulePack | null> {
  const hash = (await readIndex(cacheDir))[sourceKey];
  if (typeof hash !== 'string') return null;
  const dir = packDir(cacheDir, hash);
  const cached = (await readJson(join(dir, PACK_FILE))) as Partial<CachedRulePack> | null;
  if (!cached || cached.sourceKey !== sourceKey) return null;
  try {
    const manifest = parseRulePackManifest(cached.manifest);
    if (manifest.allLayersHash !== hash || !(await verifyRulePackManifest(manifest, nodeSha256))) return null;
    const now = new Date();
    await utimes(join(dir, PACK_FILE), now, now);
    return { pack: new RulePack(manifest, new DirRuleBlobs(join(dir, BLOB_DIR))), cached: true, dir };
  } catch {
    return null;
  }
}

async function moveMissingBlobs(from: string, to: string): Promise<void> {
  await mkdir(to, { recursive: true });
  for (const name of await readdir(from)) if (!existsSync(join(to, name))) await rename(join(from, name), join(to, name));
}

async function settle(cacheDir: string, built: string, cached: CachedRulePack): Promise<string> {
  const dir = packDir(cacheDir, cached.manifest.allLayersHash);
  await writeJsonAtomically(join(built, PACK_FILE), cached);
  try {
    await rename(built, dir);
  } catch {
    await moveMissingBlobs(join(built, BLOB_DIR), join(dir, BLOB_DIR));
    await writeJsonAtomically(join(dir, PACK_FILE), cached);
    await rm(built, { recursive: true, force: true });
  }
  const index = await readIndex(cacheDir);
  await writeJsonAtomically(join(cacheDir, INDEX_FILE), { ...index, [cached.sourceKey]: cached.manifest.allLayersHash });
  return dir;
}

async function prune(cacheDir: string, keep: string): Promise<void> {
  const packs: { dir: string; used: number }[] = [];
  for (const entry of await readdir(cacheDir, { withFileTypes: true })) {
    if (!entry.isDirectory() || !entry.name.startsWith(PACK_DIR_PREFIX)) continue;
    const dir = join(cacheDir, entry.name);
    const used = await stat(join(dir, PACK_FILE)).then(
      (s) => s.mtimeMs,
      () => 0,
    );
    packs.push({ dir, used });
  }
  packs.sort((a, b) => b.used - a.used);
  for (const { dir } of packs.slice(KEPT_PACKS)) if (dir !== keep) await rm(dir, { recursive: true, force: true });
}

async function buildCached(options: OpenRulePackOptions, cacheDir: string, sourceKey: string): Promise<OpenedRulePack> {
  await mkdir(cacheDir, { recursive: true });
  const built = await mkdtemp(join(cacheDir, BUILD_DIR_PREFIX));
  try {
    await mkdir(join(built, BLOB_DIR));
    const manifest = await buildRulePackManifest({
      source: options.source,
      listing: vfsRuleListing(options.vfs),
      read: (path) => options.vfs.read(path),
      sha256: nodeSha256,
      sink: new DirRuleBlobs(join(built, BLOB_DIR)),
      ...(options.onDigest ? { onDigest: options.onDigest } : {}),
    });
    const dir = await settle(cacheDir, built, { sourceKey, manifest });
    await prune(cacheDir, dir);
    return { pack: new RulePack(manifest, new DirRuleBlobs(join(dir, BLOB_DIR))), cached: false, dir };
  } catch (err) {
    await rm(built, { recursive: true, force: true });
    throw err;
  }
}

export async function openRulePack(options: OpenRulePackOptions): Promise<OpenedRulePack> {
  const sourceKey = options.cacheDir ? ruleSourceKey(options.vfs, options.source) : null;
  if (options.cacheDir && sourceKey) {
    const cached = await loadCached(options.cacheDir, sourceKey);
    if (cached) return cached;
    return buildCached(options, options.cacheDir, sourceKey);
  }
  const pack = await buildMemoryRulePack({
    source: options.source,
    listing: vfsRuleListing(options.vfs),
    read: (path) => options.vfs.read(path),
    sha256: nodeSha256,
    ...(options.onDigest ? { onDigest: options.onDigest } : {}),
  });
  return { pack, cached: false, dir: null };
}

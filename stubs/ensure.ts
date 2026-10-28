import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { rename, rm, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';
import { PROJECT_DATA_DIR, REPO_ROOT } from '../src/node/repo.ts';

export type StubPackBuilder = (dir: string) => Promise<string[]>;

export interface StubPackInputs {
  readonly root: string;
  readonly entry: string;
  readonly trees: readonly string[];
  readonly files: readonly string[];
  readonly runtime: string;
}

export const STUB_PACK_INPUTS: StubPackInputs = {
  root: REPO_ROOT,
  entry: join(import.meta.dirname, 'build.ts'),
  trees: [import.meta.dirname, PROJECT_DATA_DIR],
  files: [join(REPO_ROOT, 'pnpm-lock.yaml')],
  runtime: process.version,
};

const DIGEST_SUFFIX = '.inputs';
const TEST_FILE = /\.test\.ts$/;
const RELATIVE_IMPORT =
  /^[ \t]*(?:import|export)\s+(?:[\w*{}\s,$]+\s+from\s+)?['"](\.{1,2}\/[^'"]+)['"]|\bimport\(\s*['"](\.{1,2}\/[^'"]+)['"]\s*\)/gm;

function moduleGraph(entry: string): string[] {
  const seen = new Set<string>();
  const pending = [entry];
  for (let file = pending.pop(); file !== undefined; file = pending.pop()) {
    if (seen.has(file)) continue;
    seen.add(file);
    for (const m of readFileSync(file, 'utf8').matchAll(RELATIVE_IMPORT)) pending.push(resolve(dirname(file), (m[1] ?? m[2]) as string));
  }
  return [...seen];
}

function treeFiles(dir: string): string[] {
  const entries = readdirSync(dir, { recursive: true, withFileTypes: true });
  return entries.filter((e) => e.isFile() && !TEST_FILE.test(e.name)).map((e) => join(e.parentPath, e.name));
}

export function stubInputsDigest(inputs: StubPackInputs = STUB_PACK_INPUTS): string {
  const listed = [moduleGraph(inputs.entry), ...inputs.trees.map(treeFiles)].flat();
  const hash = createHash('sha256').update(`${inputs.runtime}\0`);
  for (const path of [...new Set([...listed, ...inputs.files])].sort()) {
    const content = readFileSync(path);
    hash.update(`${relative(inputs.root, path)}\0${content.length}\0`).update(content);
  }
  return hash.digest('hex');
}

function digestFile(dir: string): string {
  return `${resolve(dir)}${DIGEST_SUFFIX}`;
}

function isMissing(err: unknown): boolean {
  return (err as NodeJS.ErrnoException).code === 'ENOENT';
}

function recordedDigest(dir: string): string | null {
  try {
    return statSync(dir).isDirectory() ? readFileSync(digestFile(dir), 'utf8') : null;
  } catch (err) {
    if (isMissing(err)) return null;
    throw err;
  }
}

export function stubPackMatches(dir: string, digest: string): boolean {
  return recordedDigest(dir) === digest;
}

export async function replaceStubPack(dir: string, build: StubPackBuilder, digest?: string): Promise<string[]> {
  const inputs = digest ?? stubInputsDigest();
  const target = resolve(dir);
  const next = `${target}.next-${process.pid}`;
  const previous = `${target}.previous-${process.pid}`;
  try {
    const written = await build(next);
    await rm(digestFile(target), { force: true });
    await rename(target, previous).catch((err: unknown) => {
      if (!isMissing(err)) throw err;
    });
    await rename(next, target);
    await writeFile(digestFile(target), inputs);
    return written;
  } finally {
    await rm(next, { recursive: true, force: true });
    await rm(previous, { recursive: true, force: true });
  }
}

export async function ensureStubPack(dir: string, onBuild: () => void = () => {}): Promise<boolean> {
  const digest = stubInputsDigest();
  if (stubPackMatches(dir, digest)) return false;
  onBuild();
  const { buildStubs } = await import('./build.ts');
  await replaceStubPack(dir, buildStubs, digest);
  return true;
}

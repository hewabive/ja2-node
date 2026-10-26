import { chmod, mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildStubs } from '../../stubs/build.ts';
import { STUB_PACK_ENV } from './stub-pack.ts';

const READ_ONLY_FILE = 0o444;
const READ_ONLY_DIR = 0o555;
const WRITABLE_DIR = 0o755;

async function setModes(root: string, fileMode: number | null, dirMode: number): Promise<void> {
  for (const entry of await readdir(root, { recursive: true, withFileTypes: true })) {
    const mode = entry.isDirectory() ? dirMode : fileMode;
    if (mode !== null) await chmod(join(entry.parentPath, entry.name), mode);
  }
  await chmod(root, dirMode);
}

export default async function buildSharedStubPack(): Promise<() => Promise<void>> {
  const dir = await mkdtemp(join(tmpdir(), 'ja2-shared-stubs-'));
  await buildStubs(dir);
  await setModes(dir, READ_ONLY_FILE, READ_ONLY_DIR);
  process.env[STUB_PACK_ENV] = dir;
  return async () => {
    await setModes(dir, null, WRITABLE_DIR);
    await rm(dir, { recursive: true, force: true });
  };
}

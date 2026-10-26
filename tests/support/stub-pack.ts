import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildStubs } from '../../stubs/build.ts';

export const STUB_PACK_ENV = 'JA2_TEST_STUB_PACK';

export interface StubPack {
  readonly dir: string;
  release(): Promise<void>;
}

export function sharedStubPackDir(): string {
  const dir = process.env[STUB_PACK_ENV];
  if (!dir) throw new Error(`no shared stub pack: the vitest and Playwright global setups set ${STUB_PACK_ENV}`);
  return dir;
}

export async function openStubPack(): Promise<StubPack> {
  const shared = process.env[STUB_PACK_ENV];
  if (shared) return { dir: shared, release: async () => {} };
  const dir = await mkdtemp(join(tmpdir(), 'ja2-stub-pack-'));
  await buildStubs(dir);
  return { dir, release: () => rm(dir, { recursive: true, force: true }) };
}

import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { inject } from 'vitest';
import { buildStubs } from '../../stubs/build.ts';

declare module 'vitest' {
  export interface ProvidedContext {
    readonly stubPackDir: string;
  }
}

export interface StubPack {
  readonly dir: string;
  release(): Promise<void>;
}

export function sharedStubPackDir(): string {
  return inject('stubPackDir');
}

export async function openStubPack(): Promise<StubPack> {
  if (process.env.VITEST) return { dir: sharedStubPackDir(), release: async () => {} };
  const dir = await mkdtemp(join(tmpdir(), 'ja2-stub-pack-'));
  await buildStubs(dir);
  return { dir, release: () => rm(dir, { recursive: true, force: true }) };
}

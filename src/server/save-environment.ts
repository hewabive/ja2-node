import { dirname, join } from 'node:path';
import type { DataDecoding, DataVersion } from '../content/text/data-version.ts';
import type { Vfs } from '../content/vfs/vfs.ts';
import { ContentLedger, engineIdentity } from './content-identity.ts';
import type { LogOrigin } from './input-log.ts';
import { type OriginBuilder, replaySave } from './replay.ts';
import { SaveService } from './save-service.ts';
import { SaveStore, saveDirFromEnv } from './save-store.ts';
import type { SessionSim } from './session.ts';
import { type SessionSources, simFromOrigin } from './session-factory.ts';
import { restoreSession } from './session-snapshot.ts';

export const NATIVE_SAVES_ENV = 'JA2_SAVES_DIR';

export interface SaveEnvironmentInput {
  readonly vfs: Vfs;
  readonly dataDir: string | null;
  readonly dataVersion: DataVersion;
  readonly decoding: DataDecoding;
  readonly env?: NodeJS.ProcessEnv;
  readonly warn?: (message: string) => void;
}

export interface SaveEnvironment {
  readonly ledger: ContentLedger;
  readonly store: SaveStore;
  readonly saves: SaveService;
  readonly sources: SessionSources;
  readonly build: OriginBuilder;
}

export function nativeSavesDir(dataDir: string | null, env: NodeJS.ProcessEnv = process.env): string | null {
  return env[NATIVE_SAVES_ENV] || (dataDir ? join(dirname(dataDir), 'SavedGames') : null);
}

export function createSaveEnvironment(input: SaveEnvironmentInput): SaveEnvironment {
  const { vfs, dataDir, decoding } = input;
  const env = input.env ?? process.env;
  const read = async (path: string): Promise<Uint8Array | null> => (vfs.stat(path) ? vfs.read(path) : null);
  const exists = (path: string) => vfs.stat(path) !== undefined;
  const layers = (path: string) => vfs.layerCount(path);
  const originalData = dataDir !== null;
  const ledger = new ContentLedger(originalData ? 'original' : 'stubs', read, exists);
  const store = new SaveStore(saveDirFromEnv(env), nativeSavesDir(dataDir, env));
  const saves = new SaveService({
    store,
    ledger,
    dataVersion: input.dataVersion,
    engine: engineIdentity(env),
    restore: (snapshot) => restoreSession(snapshot, ledger.read, ledger.exists, { layers, decoding }),
    ...(input.warn ? { warn: input.warn } : {}),
  });
  const sources: SessionSources = { read: ledger.read, exists: ledger.exists, layers, decoding, originalData, store };
  const build = (origin: LogOrigin): Promise<SessionSim> => simFromOrigin(sources, origin, saves);
  return { ledger, store, saves, sources, build };
}

export function replayStoredSave(environment: SaveEnvironment, name: string): ReturnType<typeof replaySave> {
  return replaySave(name, environment.saves, environment.build);
}

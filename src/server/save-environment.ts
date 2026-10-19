import { dirname, join } from 'node:path';
import type { RulePack } from '../content/rules/pack.ts';
import type { DataDecoding, DataVersion } from '../content/text/data-version.ts';
import { type Vfs, vfsFileReader } from '../content/vfs/vfs.ts';
import type { WelcomeIdentity } from '../protocol/messages.ts';
import {
  ContentLedger,
  type EngineIdentity,
  engineIdentity,
  type LogicIdentity,
  logicIdentityOf,
  welcomeIdentityOf,
} from './content-identity.ts';
import type { LogOrigin } from './input-log.ts';
import { type OriginBuilder, replaySave } from './replay.ts';
import { SaveService } from './save-service.ts';
import { SAVE_DIR_ENV, SaveStore, saveDirFromEnv } from './save-store.ts';
import type { SessionSim } from './session.ts';
import { type SessionSources, simFromOrigin } from './session-factory.ts';
import { restoreSession } from './session-snapshot.ts';

export const NATIVE_SAVES_ENV = 'JA2_SAVES_DIR';

export interface SaveEnvironmentInput {
  readonly vfs: Vfs;
  readonly pack: RulePack;
  readonly dataDir: string | null;
  readonly dataVersion: DataVersion;
  readonly decoding: DataDecoding;
  readonly env?: NodeJS.ProcessEnv;
  readonly engine?: EngineIdentity;
  readonly warn?: (message: string) => void;
}

export interface SaveEnvironment {
  readonly engine: EngineIdentity;
  readonly identity: LogicIdentity;
  readonly welcome: WelcomeIdentity;
  readonly store: SaveStore;
  readonly saves: SaveService;
  readonly sources: SessionSources;
  readonly build: OriginBuilder;
}

export function nativeSavesDir(dataDir: string | null, env: NodeJS.ProcessEnv = process.env): string | null {
  return env[NATIVE_SAVES_ENV] || (dataDir ? join(dirname(dataDir), 'SavedGames') : null);
}

export function saveDirsEnv(store: SaveStore): Record<string, string> {
  return { [SAVE_DIR_ENV]: store.dir, ...(store.nativeDir ? { [NATIVE_SAVES_ENV]: store.nativeDir } : {}) };
}

export function contentSourceOf(dataDir: string | null): 'original' | 'stubs' {
  return dataDir !== null ? 'original' : 'stubs';
}

export function legacyContentLedger(vfs: Vfs, pack: RulePack): ContentLedger {
  return new ContentLedger(pack.source, vfsFileReader(vfs), (path) => vfs.stat(path) !== undefined);
}

export function createSaveEnvironment(input: SaveEnvironmentInput): SaveEnvironment {
  const { vfs, pack, dataDir, decoding } = input;
  const env = input.env ?? process.env;
  const { read, exists, layers } = pack;
  const identity = logicIdentityOf(pack, legacyContentLedger(vfs, pack));
  const store = new SaveStore(saveDirFromEnv(env), nativeSavesDir(dataDir, env));
  const engine = input.engine ?? engineIdentity(env);
  const saves = new SaveService({
    store,
    identity,
    dataVersion: input.dataVersion,
    engine,
    restore: (snapshot) => restoreSession(snapshot, read, exists, { layers, decoding }),
    ...(input.warn ? { warn: input.warn } : {}),
  });
  const sources: SessionSources = { read, exists, layers, decoding, originalData: dataDir !== null, store };
  const build = (origin: LogOrigin): Promise<SessionSim> => simFromOrigin(sources, origin, saves);
  return { engine, identity, welcome: welcomeIdentityOf(engine, pack), store, saves, sources, build };
}

export function replayStoredSave(environment: SaveEnvironment, name: string): ReturnType<typeof replaySave> {
  return replaySave(name, environment.saves, environment.build);
}

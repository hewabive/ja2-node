import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ContentLedger, type EngineIdentity } from '../../src/server/content-identity.ts';
import type { LogOrigin } from '../../src/server/input-log.ts';
import { type OriginBuilder, replaySave } from '../../src/server/replay.ts';
import { SaveService } from '../../src/server/save-service.ts';
import { SaveStore } from '../../src/server/save-store.ts';
import { DEFAULT_SESSION_TEXT, type Session, type SessionSim } from '../../src/server/session.ts';
import { createSessionFactory, type SessionSources, simFromOrigin } from '../../src/server/session-factory.ts';
import { type NewSessionRequest, openSession, type SessionFactory } from '../../src/server/session-registry.ts';
import { restoreSession } from '../../src/server/session-snapshot.ts';
import type { StubSectorKit } from './sectors.ts';

export const TEST_ENGINE: EngineIdentity = { version: '0.0.0-test', commit: 'test' };
export const TEST_SAVED_AT = new Date('2026-10-18T12:00:00Z');

export interface SaveKitOptions {
  readonly entropy?: () => number;
  readonly nativeDir?: string | null;
  readonly dataVersion?: string;
}

export interface SaveKit {
  readonly dir: string;
  readonly ledger: ContentLedger;
  readonly store: SaveStore;
  readonly saves: SaveService;
  readonly sources: SessionSources;
  readonly factory: SessionFactory;
  readonly sessions: Map<string, Session>;
  readonly warnings: string[];
  open(request: NewSessionRequest): Promise<Session>;
  build: OriginBuilder;
  replay(name: string): ReturnType<typeof replaySave>;
  dispose(): Promise<void>;
}

export async function createSaveKit(kit: StubSectorKit, options: SaveKitOptions = {}): Promise<SaveKit> {
  const dir = await mkdtemp(join(tmpdir(), 'ja2-saves-'));
  const ledger = new ContentLedger('stubs', kit.read, (path) => kit.worlds.exists(path));
  const store = new SaveStore(dir, options.nativeDir ?? null);
  const warnings: string[] = [];
  let tick = 0;
  const saves = new SaveService({
    store,
    ledger,
    dataVersion: options.dataVersion ?? 'stubs',
    engine: TEST_ENGINE,
    restore: (snapshot) => restoreSession(snapshot, ledger.read, ledger.exists),
    now: () => new Date(TEST_SAVED_AT.getTime() + 1000 * tick++),
    warn: (message) => warnings.push(message),
    ...(options.entropy ? { entropy: options.entropy } : {}),
  });
  const sources: SessionSources = { read: ledger.read, exists: ledger.exists, originalData: false, store };
  const factory = createSessionFactory({ ...sources, text: DEFAULT_SESSION_TEXT, saves });
  const sessions = new Map<string, Session>();
  const build: OriginBuilder = (origin: LogOrigin): Promise<SessionSim> => simFromOrigin(sources, origin, saves);
  return {
    dir,
    ledger,
    store,
    saves,
    sources,
    factory,
    sessions,
    warnings,
    open: (request) => openSession(sessions, 'test', factory, request),
    build,
    replay: (name) => replaySave(name, saves, build),
    dispose: async () => {
      await saves.flush();
      await rm(dir, { recursive: true, force: true });
    },
  };
}

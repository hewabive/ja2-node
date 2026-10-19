import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { RulePack } from '../../src/content/rules/pack.ts';
import { type EngineIdentity, type LogicIdentity, logicIdentityOf, welcomeIdentityOf } from '../../src/server/content-identity.ts';
import type { LogOrigin } from '../../src/server/input-log.ts';
import { type OriginBuilder, replaySave } from '../../src/server/replay.ts';
import { legacyContentLedger } from '../../src/server/save-environment.ts';
import { SaveService } from '../../src/server/save-service.ts';
import { SaveStore } from '../../src/server/save-store.ts';
import { DEFAULT_SESSION_TEXT, type Session, type SessionSim } from '../../src/server/session.ts';
import { createSessionFactory, type SessionSources, simFromOrigin } from '../../src/server/session-factory.ts';
import { InProcessHost } from '../../src/server/session-host.ts';
import { type NewSessionRequest, openSession, type SessionFactory, type SessionRequest } from '../../src/server/session-registry.ts';
import { restoreSession } from '../../src/server/session-snapshot.ts';
import { SliceScheduler, TimeSlicer } from '../../src/server/slicing.ts';
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
  readonly pack: RulePack;
  readonly identity: LogicIdentity;
  readonly store: SaveStore;
  readonly saves: SaveService;
  readonly sources: SessionSources;
  readonly factory: SessionFactory;
  readonly sessions: Map<string, Session>;
  readonly hosts: Map<string, InProcessHost>;
  readonly hostFactory: (id: string, request: SessionRequest) => Promise<InProcessHost>;
  readonly warnings: string[];
  open(request: NewSessionRequest): Promise<Session>;
  build: OriginBuilder;
  replay(name: string): ReturnType<typeof replaySave>;
  dispose(): Promise<void>;
}

export async function createSaveKit(kit: StubSectorKit, options: SaveKitOptions = {}): Promise<SaveKit> {
  const dir = await mkdtemp(join(tmpdir(), 'ja2-saves-'));
  const pack = await kit.rulePack();
  const identity = logicIdentityOf(pack, legacyContentLedger(kit.vfs, pack));
  const store = new SaveStore(dir, options.nativeDir ?? null);
  const warnings: string[] = [];
  let tick = 0;
  const saves = new SaveService({
    store,
    identity,
    dataVersion: options.dataVersion ?? 'stubs',
    engine: TEST_ENGINE,
    restore: (snapshot) => restoreSession(snapshot, pack.read, pack.exists, { layers: pack.layers }),
    now: () => new Date(TEST_SAVED_AT.getTime() + 1000 * tick++),
    warn: (message) => warnings.push(message),
    ...(options.entropy ? { entropy: options.entropy } : {}),
  });
  const sources: SessionSources = { read: pack.read, exists: pack.exists, layers: pack.layers, originalData: false, store };
  const factory = createSessionFactory({ ...sources, text: DEFAULT_SESSION_TEXT, saves, identity: welcomeIdentityOf(TEST_ENGINE, pack) });
  const sessions = new Map<string, Session>();
  const hosts = new Map<string, InProcessHost>();
  const scheduler = new SliceScheduler();
  const hostFactory = async (id: string, request: SessionRequest) =>
    new InProcessHost(await factory(id, request), { saves, slicer: new TimeSlicer(scheduler) });
  const build: OriginBuilder = (origin: LogOrigin): Promise<SessionSim> => simFromOrigin(sources, origin, saves);
  return {
    dir,
    pack,
    identity,
    store,
    saves,
    sources,
    factory,
    sessions,
    hosts,
    hostFactory,
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

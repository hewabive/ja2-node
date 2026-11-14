import { existsSync } from 'node:fs';
import { serve } from '@hono/node-server';
import { dataDecoding, type UiLanguage } from '../content/text/data-version.ts';
import { type DataVfs, openDataVfs } from '../node/data-vfs.ts';
import { loadOrCreateToken } from '../node/token.ts';
import { createApp } from './app.ts';
import { VfsHashes } from './assets-manifest.ts';
import { chooseDisplayLanguage, type DataVersionChoice, detectDataVersion, LANGUAGE_ENV } from './data-version.ts';
import type { ServerLayout, StateDirs } from './layout.ts';
import { repositoryHistoryOf } from './repository-history.ts';
import { openRulePack } from './rule-pack.ts';
import { contentSourceOf, createSaveEnvironment, nativeSavesDir } from './save-environment.ts';
import type { SessionEnvironmentConfig } from './session-environment.ts';
import { createSessionFactory } from './session-factory.ts';
import {
  type HostFactory,
  inProcessHostFactory,
  type SessionDescription,
  type SessionHost,
  type SessionHostKind,
  sessionHostKind,
} from './session-host.ts';
import type { SessionRequest } from './session-registry.ts';
import { SliceScheduler } from './slicing.ts';
import { TextService } from './text-service.ts';
import { workerHostFactory } from './worker-host.ts';
import { attachWebSocket, closeSockets } from './ws.ts';

export const HOST_ENV = 'JA2_HOST';
export const PORT_ENV = 'JA2_PORT';
export const DATA_DIR_ENV = 'JA2_DATA_DIR';
export const DEFAULT_HOST = '127.0.0.1';
export const DEFAULT_PORT = 7420;

const DEFAULT_SESSION = 'sandbox';
const SEED_ENV = 'JA2_SEED';
const SAVE_ENV = 'JA2_SAVE';
const CAMPAIGN_ENV = 'JA2_CAMPAIGN';
const DEFAULT_SEED = 1;

export interface ServerListen {
  readonly host: string;
  readonly port: number;
  readonly allowedHosts?: readonly string[];
}

export interface ServerStart {
  readonly layout: ServerLayout;
  readonly state: StateDirs;
  readonly listen: ServerListen;
  readonly dataDir: string | null;
  readonly env: NodeJS.ProcessEnv;
  readonly warn: (message: string) => void;
}

export interface RulePackReport {
  readonly hash: string;
  readonly files: number;
  readonly cached: boolean;
  readonly dir: string | null;
}

export interface ServerReport {
  readonly port: number;
  readonly token: string;
  readonly dataDir: string | null;
  readonly slfCount: number;
  readonly stubsDir: string | null;
  readonly dataVersion: DataVersionChoice;
  readonly language: UiLanguage;
  readonly files: number;
  readonly rules: RulePackReport;
  readonly sandbox: SessionDescription | null;
  readonly hostKind: SessionHostKind;
  readonly saveDir: string;
  readonly nativeSavesDir: string | null;
  readonly installationFile: string;
  readonly clientBuilt: boolean;
}

export interface RunningServer {
  readonly report: ServerReport;
  close(): Promise<void>;
}

function defaultSessionRequest(env: NodeJS.ProcessEnv): SessionRequest {
  const seed = Number(env[SEED_ENV] ?? DEFAULT_SEED);
  const save = env[SAVE_ENV];
  const campaign = env[CAMPAIGN_ENV];
  return { seed, ...(save ? { save } : {}), ...(campaign ? { campaign: { options: { difficulty: Number(campaign) } } } : {}) };
}

async function closeAll(sessions: Map<string, SessionHost>): Promise<void> {
  await Promise.all([...sessions.values()].map((session) => session.close('shutdown')));
}

export async function startServer(start: ServerStart): Promise<RunningServer> {
  const { layout, state, env, warn } = start;
  const data: DataVfs = await openDataVfs({
    projectDataDir: layout.projectDataDir,
    dataDir: start.dataDir ?? undefined,
    stubsDir: layout.stubsDir ?? undefined,
  });
  const sessions = new Map<string, SessionHost>();
  try {
    const dataVersion = await detectDataVersion(data, env);
    const language = chooseDisplayLanguage(env[LANGUAGE_ENV], dataVersion.version);
    const decoding = dataDecoding(dataVersion.version);
    const texts = new TextService({ vfs: data.vfs, dataVersion: dataVersion.version });
    const sessionText = { language, dataVersion: dataVersion.version };
    const token = loadOrCreateToken(state.tokenFile, env);
    const scheduler = new SliceScheduler();
    const hashes = await VfsHashes.open(data.vfs, state.cacheDir);
    const source = contentSourceOf(data.dataDir);
    const rules = await openRulePack({ vfs: data.vfs, source, cacheDir: state.cacheDir, onDigest: hashes.remember });
    const { store, installation, saves, sources, engine, welcome } = createSaveEnvironment({
      vfs: data.vfs,
      pack: rules.pack,
      dataDir: data.dataDir,
      dataVersion: dataVersion.version,
      decoding,
      saveDir: state.saveDir,
      nativeSavesDir: nativeSavesDir(data.dataDir, env),
      engine: layout.engine,
      savedRepositoryFile: repositoryHistoryOf(layout.repositoryRoot, layout.projectDataDir),
      warn,
    });
    const hostKind = sessionHostKind(env);
    const workerConfig: SessionEnvironmentConfig = {
      data: { projectDataDir: layout.projectDataDir, dataDir: data.dataDir ?? undefined, stubsDir: data.stubsDir ?? undefined },
      text: sessionText,
      engine,
      saveDir: store.dir,
      nativeSavesDir: store.nativeDir,
      repositoryRoot: layout.repositoryRoot,
      cacheDir: state.cacheDir,
    };
    const createSession: HostFactory =
      hostKind === 'worker'
        ? workerHostFactory(layout.sessionWorker, workerConfig)
        : inProcessHostFactory(
            createSessionFactory({ ...sources, text: sessionText, saves, identity: welcome, installation }),
            saves,
            scheduler,
          );
    try {
      sessions.set(DEFAULT_SESSION, await createSession(DEFAULT_SESSION, defaultSessionRequest(env)));
    } catch (err) {
      warn(`sandbox session unavailable: ${(err as Error).message}`);
    }
    const clientBuilt = existsSync(layout.clientDir);
    const app = createApp({
      vfs: data.vfs,
      token,
      hashes,
      rules: welcome.rules,
      sessions,
      defaultSession: DEFAULT_SESSION,
      createSession,
      texts,
      defaultLanguage: language,
      saves,
      installation,
      ...(layout.projectDirsChange ? { refreshFiles: data.refreshProjectDirs } : {}),
      ...(clientBuilt ? { clientDir: layout.clientDir } : {}),
      ...(start.listen.allowedHosts ? { allowedHosts: start.listen.allowedHosts } : {}),
      info: { originalData: data.dataDir !== null, slfCount: data.slfCount, stubs: data.stubsDir !== null },
    });
    const sandbox = (await sessions.get(DEFAULT_SESSION)?.describe()) ?? null;
    let onListening: (port: number) => void = () => {};
    const server = serve({ fetch: app.fetch, hostname: start.listen.host, port: start.listen.port }, (addr) => onListening(addr.port));
    const sockets = attachWebSocket(server, {
      token,
      sessions,
      defaultSession: DEFAULT_SESSION,
      ...(start.listen.allowedHosts ? { allowedHosts: start.listen.allowedHosts } : {}),
    });
    let port: number;
    try {
      port = await new Promise<number>((resolve, reject) => {
        server.once('error', reject);
        onListening = (actual) => {
          server.off('error', reject);
          resolve(actual);
        };
      });
    } catch (err) {
      closeSockets(sockets);
      throw err;
    }
    const report: ServerReport = {
      port,
      token,
      dataDir: data.dataDir,
      slfCount: data.slfCount,
      stubsDir: data.stubsDir,
      dataVersion,
      language,
      files: data.vfs.size,
      rules: { hash: rules.pack.hash, files: rules.pack.manifest.files.length, cached: rules.cached, dir: rules.dir },
      sandbox,
      hostKind,
      saveDir: store.dir,
      nativeSavesDir: store.nativeDir,
      installationFile: installation.path,
      clientBuilt,
    };
    return {
      report,
      close: async () => {
        try {
          await closeAll(sessions);
          await Promise.all([saves.flush(), hashes.flush()]);
        } catch (err) {
          warn(`saving on shutdown failed: ${(err as Error).message}`);
        }
        closeSockets(sockets);
        await new Promise<void>((resolve) => server.close(() => resolve()));
        await data.close();
      },
    };
  } catch (err) {
    await closeAll(sessions).catch(() => {});
    await data.close();
    throw err;
  }
}

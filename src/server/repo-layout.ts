import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { DEFAULT_STUBS_DIR, PROJECT_DATA_DIR, REPO_ROOT, REPO_STATE_DIR, REPO_TOKEN_FILE } from '../node/repo.ts';
import { checkoutEngineIdentity } from './content-identity.ts';
import type { ServerLayout, StateDirs } from './layout.ts';
import { cacheDirFromEnv } from './rule-pack.ts';
import { saveDirFromEnv } from './save-store.ts';

export const STUBS_DIR_ENV = 'JA2_STUBS_DIR';
export const REPO_SAVE_DIR = join(REPO_STATE_DIR, 'saves');
export const REPO_CACHE_DIR = join(REPO_STATE_DIR, 'cache');
export const REPO_CLIENT_DIR = join(REPO_ROOT, 'dist', 'client');
export const SOURCE_SESSION_WORKER = pathToFileURL(join(REPO_ROOT, 'src', 'server', 'session-worker.ts'));

export function repoLayout(env: NodeJS.ProcessEnv = process.env): ServerLayout {
  return {
    projectDataDir: PROJECT_DATA_DIR,
    stubsDir: (env[STUBS_DIR_ENV] ?? DEFAULT_STUBS_DIR) || null,
    clientDir: REPO_CLIENT_DIR,
    sessionWorker: SOURCE_SESSION_WORKER,
    engine: checkoutEngineIdentity(REPO_ROOT, env),
    repositoryRoot: REPO_ROOT,
  };
}

export function repoStateDirs(env: NodeJS.ProcessEnv = process.env): StateDirs {
  return { tokenFile: REPO_TOKEN_FILE, saveDir: saveDirFromEnv(REPO_SAVE_DIR, env), cacheDir: cacheDirFromEnv(REPO_CACHE_DIR, env) };
}

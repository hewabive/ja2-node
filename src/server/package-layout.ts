import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseEngineIdentity } from './content-identity.ts';
import type { ServerLayout } from './layout.ts';

export const PACKAGE_SERVER_DIR = 'dist/server';
export const PACKAGE_CLIENT_DIR = 'dist/client';
export const PACKAGE_STUBS_DIR = 'dist/stubs';
export const PACKAGE_DATA_DIR = 'data';
export const PLAYER_BUNDLE = 'player';
export const SESSION_WORKER_BUNDLE = 'session-worker';
export const ENGINE_FILE = 'engine.json';
const BUNDLE_EXTENSION = '.js';

export function bundleFile(name: string): string {
  return `${name}${BUNDLE_EXTENSION}`;
}

export function packageLayout(root: string): ServerLayout {
  const serverDir = join(root, PACKAGE_SERVER_DIR);
  return {
    projectDataDir: join(root, PACKAGE_DATA_DIR),
    stubsDir: join(root, PACKAGE_STUBS_DIR),
    clientDir: join(root, PACKAGE_CLIENT_DIR),
    sessionWorker: pathToFileURL(join(serverDir, bundleFile(SESSION_WORKER_BUNDLE))),
    engine: parseEngineIdentity(readFileSync(join(serverDir, ENGINE_FILE), 'utf8')),
    repositoryRoot: null,
    projectDirsChange: false,
  };
}

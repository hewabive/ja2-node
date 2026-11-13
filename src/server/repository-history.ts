import { execFile } from 'node:child_process';
import { relative, sep } from 'node:path';
import { promisify } from 'node:util';
import { PROJECT_DATA_LAYER } from '../content/vfs/layers.ts';
import type { SavedRepositoryFile } from './content-identity.ts';

const COMMIT_ID = /^[0-9a-f]{7,40}$/;
const MAX_FILE_BYTES = 64 * 1024 * 1024;
const execFileAsync = promisify(execFile);

export interface RepositoryHistoryOptions {
  readonly root: string;
  readonly projectDataDir: string;
}

export const NO_REPOSITORY_HISTORY: SavedRepositoryFile = async () => null;

export function gitRepositoryHistory(options: RepositoryHistoryOptions): SavedRepositoryFile {
  const { root } = options;
  const dataDir = relative(root, options.projectDataDir).split(sep).join('/');
  return async (commit, layer, path) => {
    if (layer !== PROJECT_DATA_LAYER || !COMMIT_ID.test(commit)) return null;
    try {
      const { stdout } = await execFileAsync('git', ['cat-file', 'blob', `${commit}:${dataDir}/${path}`], {
        cwd: root,
        encoding: 'buffer',
        maxBuffer: MAX_FILE_BYTES,
      });
      return new Uint8Array(stdout);
    } catch {
      return null;
    }
  };
}

export function repositoryHistoryOf(root: string | null, projectDataDir: string | undefined): SavedRepositoryFile {
  return root !== null && projectDataDir !== undefined ? gitRepositoryHistory({ root, projectDataDir }) : NO_REPOSITORY_HISTORY;
}

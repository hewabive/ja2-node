import { execFile } from 'node:child_process';
import { relative, sep } from 'node:path';
import { promisify } from 'node:util';
import { PROJECT_DATA_LAYER } from '../content/vfs/layers.ts';
import { PROJECT_DATA_DIR, REPO_ROOT } from '../node/repo.ts';
import type { SavedRepositoryFile } from './content-identity.ts';

const COMMIT_ID = /^[0-9a-f]{7,40}$/;
const MAX_FILE_BYTES = 64 * 1024 * 1024;
const execFileAsync = promisify(execFile);

export interface RepositoryHistoryOptions {
  readonly root?: string;
  readonly projectDataDir?: string;
}

export function gitRepositoryHistory(options: RepositoryHistoryOptions = {}): SavedRepositoryFile {
  const root = options.root ?? REPO_ROOT;
  const dataDir = relative(root, options.projectDataDir ?? PROJECT_DATA_DIR)
    .split(sep)
    .join('/');
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

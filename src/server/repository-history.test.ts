import { execFileSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { PROJECT_DATA_LAYER, STUBS_LAYER } from '../content/vfs/layers.ts';
import { REPO_ROOT } from '../node/repo.ts';
import { gitRepositoryHistory } from './repository-history.ts';

const TABLE = 'tables/tiles.json';

function headCommit(): string | null {
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: REPO_ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return null;
  }
}

const head = headCommit();

describe('the repository history of the project tables', () => {
  const history = gitRepositoryHistory();

  it.skipIf(head === null)('reads a project table as a commit holds it', async () => {
    const bytes = await history(head as string, PROJECT_DATA_LAYER, TABLE);
    expect(bytes).not.toBeNull();
    expect(JSON.parse(new TextDecoder().decode(bytes as Uint8Array))).toHaveProperty('types');
    expect(await history(head as string, PROJECT_DATA_LAYER, 'tables/no-such-table.json')).toBeNull();
  });

  it('knows nothing of other layers, unknown commits or arguments that are not commit ids', async () => {
    expect(await history(head ?? '0123abc', STUBS_LAYER, 'stubs/profiles.json')).toBeNull();
    for (const commit of ['unknown', 'test', '--output=/tmp/x', 'HEAD', '0123abc'])
      expect(await history(commit, PROJECT_DATA_LAYER, TABLE), commit).toBeNull();
  });
});

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export default function useRunTempDir(): () => void {
  const runDir = mkdtempSync(join(tmpdir(), 'ja2-vitest-'));
  process.env.TMPDIR = runDir;
  return () => rmSync(runDir, { recursive: true, force: true });
}

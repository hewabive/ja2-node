import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { REPO_ROOT } from './repo.ts';

export const TOKEN_FILE = join(REPO_ROOT, '.ja2', 'token');

export function loadOrCreateToken(file = TOKEN_FILE): string {
  const fromEnv = process.env.JA2_TOKEN?.trim();
  if (fromEnv) return fromEnv;
  if (existsSync(file)) {
    const t = readFileSync(file, 'utf8').trim();
    if (t.length >= 16) return t;
  }
  const token = randomBytes(24).toString('hex');
  mkdirSync(join(file, '..'), { recursive: true });
  writeFileSync(file, `${token}\n`, { mode: 0o600 });
  return token;
}

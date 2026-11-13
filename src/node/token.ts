import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

export const TOKEN_ENV = 'JA2_TOKEN';
const MIN_TOKEN_CHARS = 16;

export function loadOrCreateToken(file: string, env: NodeJS.ProcessEnv = process.env): string {
  const fromEnv = env[TOKEN_ENV]?.trim();
  if (fromEnv) return fromEnv;
  if (existsSync(file)) {
    const t = readFileSync(file, 'utf8').trim();
    if (t.length >= MIN_TOKEN_CHARS) return t;
  }
  const token = randomBytes(24).toString('hex');
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, `${token}\n`, { mode: 0o600 });
  return token;
}

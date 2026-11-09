import { parseJsoncBytes } from '../../src/content/strategic/jsonc.ts';
import type { ReadFile } from '../../src/content/world/tileset-loader.ts';

export const GAME_POLICY_PATH = 'externalized/game.json';

export type JsonRecord = Record<string, unknown>;

export function withGamePolicy(read: ReadFile, change: (policy: JsonRecord) => void): ReadFile {
  return async (path) => {
    const bytes = await read(path);
    if (path !== GAME_POLICY_PATH || !bytes) return bytes;
    const policy = parseJsoncBytes(bytes) as JsonRecord;
    change(policy);
    return new TextEncoder().encode(JSON.stringify(policy));
  };
}

export function withImpPolicy(read: ReadFile, imp: JsonRecord): ReadFile {
  return withGamePolicy(read, (policy) => {
    policy.imp = { ...(policy.imp as JsonRecord | undefined), ...imp };
  });
}

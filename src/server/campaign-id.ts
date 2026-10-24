import { randomUUID } from 'node:crypto';
import type { LogOrigin } from './input-log.ts';
import type { SavePresentation } from './save-file.ts';

const IMPORT_PREFIX = 'import:';
const SAVE_PREFIX = 'save:';
const DIGEST_CHARS = 16;

export function campaignIdOfOrigin(origin: LogOrigin, newId: () => string = randomUUID): string | null {
  if (origin.kind === 'campaign') return newId();
  if (origin.kind === 'import') return `${IMPORT_PREFIX}${origin.digest.slice(0, DIGEST_CHARS)}`;
  return null;
}

export function campaignIdOfSave(presentation: SavePresentation | undefined, digest: string, campaign: boolean): string | null {
  const saved = presentation?.campaign;
  if (typeof saved === 'string' && saved.length > 0) return saved;
  return campaign ? `${SAVE_PREFIX}${digest.slice(0, DIGEST_CHARS)}` : null;
}

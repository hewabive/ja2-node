import { resolve } from 'node:path';

export const REPO_ROOT = resolve(import.meta.dirname, '../..');

export const DEFAULT_STUBS_DIR = resolve(REPO_ROOT, 'dist/stubs');

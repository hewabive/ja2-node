import { resolve } from 'node:path';

export const REPO_ROOT = resolve(import.meta.dirname, '../..');

export const DEFAULT_STUBS_DIR = resolve(REPO_ROOT, 'dist/stubs');

export const PROJECT_DATA_DIR = resolve(REPO_ROOT, 'data');

export const REPO_STATE_DIR = resolve(REPO_ROOT, '.ja2');

export const REPO_TOKEN_FILE = resolve(REPO_STATE_DIR, 'token');

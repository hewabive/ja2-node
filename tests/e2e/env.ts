import { tmpdir } from 'node:os';
import { join } from 'node:path';

export const SERVER_PORT = Number(process.env.JA2_E2E_PORT ?? 7431);
export const WEB_PORT = Number(process.env.JA2_E2E_WEB_PORT ?? 5183);
export const SERVER = `http://127.0.0.1:${SERVER_PORT}`;
export const TOKEN = 'e2e-token-not-secret-0123456789';
export const SAVE_DIR = process.env.JA2_E2E_SAVE_DIR ?? join(tmpdir(), `ja2-e2e-saves-${SERVER_PORT}`);
export const E2E_MAX_SESSIONS = 64;
export const E2E_TEST_TIMEOUT_MS = 900_000;
export const E2E_LONG_TEST_TIMEOUT_MS = 1_800_000;
export const E2E_EXPECT_TIMEOUT_MS = 120_000;
export const E2E_SERVER_START_TIMEOUT_MS = 300_000;
export const DATA_DIR = process.env.JA2_E2E_DATA_DIR ?? '';
export const ORIGINAL_DATA_MODE = DATA_DIR !== '';
export const DATA_SAVE_DIR = process.env.JA2_E2E_SAVE_DIR ?? join(tmpdir(), `ja2-e2e-data-saves-${SERVER_PORT}`);

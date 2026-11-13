import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { z } from 'zod';
import { parseVanillaVersion, VANILLA_VERSIONS, type VanillaVersion } from '../../content/text/data-version.ts';
import { DATA_VERSION_ENV } from '../data-version.ts';
import { DATA_DIR_ENV, DEFAULT_HOST, DEFAULT_PORT, HOST_ENV, PORT_ENV } from '../start.ts';

export const CONFIG_FORMAT = 'ja2-node-config';
const CONFIG_VERSION = 1;
const MAX_PORT = 65535;
const TEMP_SUFFIX = '.tmp';

export interface PlayerConfig {
  readonly dataDir: string | null;
  readonly dataVersion: VanillaVersion | null;
  readonly host: string;
  readonly port: number;
}

export const DEFAULT_CONFIG: PlayerConfig = { dataDir: null, dataVersion: null, host: DEFAULT_HOST, port: DEFAULT_PORT };

const ConfigFile = z.object({
  format: z.literal(CONFIG_FORMAT),
  version: z.literal(CONFIG_VERSION),
  dataDir: z.string().min(1).nullable(),
  dataVersion: z.enum(VANILLA_VERSIONS).nullable(),
  host: z.string().min(1),
  port: z.number().int().min(1).max(MAX_PORT),
});

export class ConfigError extends Error {}

export function parsePort(text: string): number | null {
  const port = Number(text.trim());
  return text.trim() !== '' && Number.isInteger(port) && port >= 1 && port <= MAX_PORT ? port : null;
}

export function parseConfig(text: string, file: string): PlayerConfig {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch (err) {
    throw new ConfigError(`${file} is not JSON: ${(err as Error).message}`);
  }
  const parsed = ConfigFile.safeParse(json);
  if (!parsed.success) throw new ConfigError(`${file} is not a ja2-node config: ${z.prettifyError(parsed.error)}`);
  const { dataDir, dataVersion, host, port } = parsed.data;
  return { dataDir, dataVersion, host, port };
}

export function configText(config: PlayerConfig): string {
  return `${JSON.stringify({ format: CONFIG_FORMAT, version: CONFIG_VERSION, ...config }, null, 2)}\n`;
}

function isMissing(err: unknown): boolean {
  return (err as NodeJS.ErrnoException).code === 'ENOENT';
}

export async function readConfig(file: string): Promise<PlayerConfig | null> {
  try {
    return parseConfig(await readFile(file, 'utf8'), file);
  } catch (err) {
    if (isMissing(err)) return null;
    throw err;
  }
}

export async function writeConfig(file: string, config: PlayerConfig): Promise<void> {
  await mkdir(dirname(file), { recursive: true });
  const temp = `${file}${TEMP_SUFFIX}`;
  await writeFile(temp, configText(config));
  await rename(temp, file);
}

export type SettingSource = 'flag' | 'environment' | 'file' | 'default';

export interface Setting<T> {
  readonly value: T;
  readonly source: SettingSource;
}

export type PlayerSettings = { readonly [K in keyof PlayerConfig]: Setting<PlayerConfig[K]> };

export interface PlayerFlags {
  readonly dataDir?: string | null;
  readonly host?: string;
  readonly port?: number;
}

function fromEnv<T>(env: NodeJS.ProcessEnv, name: string, parse: (text: string) => T): Setting<T> | null {
  const text = env[name];
  return text === undefined ? null : { value: parse(text.trim()), source: 'environment' };
}

function envPort(text: string): number {
  const port = parsePort(text);
  if (port === null) throw new ConfigError(`${PORT_ENV} must be a port from 1 to ${MAX_PORT} (got ${text})`);
  return port;
}

function envDataVersion(text: string): VanillaVersion | null {
  if (text === '') return null;
  const version = parseVanillaVersion(text);
  if (!version) throw new ConfigError(`${DATA_VERSION_ENV} must be one of ${VANILLA_VERSIONS.join(', ')} (got ${text})`);
  return version;
}

function pick<K extends keyof PlayerConfig>(
  key: K,
  flag: PlayerConfig[K] | undefined,
  env: Setting<PlayerConfig[K]> | null,
  file: PlayerConfig | null,
): Setting<PlayerConfig[K]> {
  if (flag !== undefined) return { value: flag, source: 'flag' };
  if (env) return env;
  if (file) return { value: file[key], source: 'file' };
  return { value: DEFAULT_CONFIG[key], source: 'default' };
}

export function resolveSettings(flags: PlayerFlags, env: NodeJS.ProcessEnv, file: PlayerConfig | null): PlayerSettings {
  return {
    dataDir: pick(
      'dataDir',
      flags.dataDir,
      fromEnv(env, DATA_DIR_ENV, (text) => text || null),
      file,
    ),
    dataVersion: pick('dataVersion', undefined, fromEnv(env, DATA_VERSION_ENV, envDataVersion), file),
    host: pick(
      'host',
      flags.host,
      fromEnv(env, HOST_ENV, (text) => text || DEFAULT_HOST),
      file,
    ),
    port: pick('port', flags.port, fromEnv(env, PORT_ENV, envPort), file),
  };
}

export function settingValues(settings: PlayerSettings): PlayerConfig {
  return {
    dataDir: settings.dataDir.value,
    dataVersion: settings.dataVersion.value,
    host: settings.host.value,
    port: settings.port.value,
  };
}

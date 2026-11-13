import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { DATA_VERSION_ENV } from '../data-version.ts';
import { DATA_DIR_ENV, HOST_ENV, PORT_ENV } from '../start.ts';
import {
  ConfigError,
  configText,
  DEFAULT_CONFIG,
  type PlayerConfig,
  parseConfig,
  parsePort,
  readConfig,
  resolveSettings,
  settingValues,
  writeConfig,
} from './settings.ts';

const SAVED: PlayerConfig = { dataDir: '/games/ja2/Data', dataVersion: 'russianGold', host: '0.0.0.0', port: 7500 };

describe('the settings file of the player', () => {
  let dir: string | null = null;
  afterEach(async () => {
    if (dir) await rm(dir, { recursive: true, force: true });
    dir = null;
  });

  it('is JSON, so a Windows path keeps its backslashes', () => {
    const windows: PlayerConfig = { ...SAVED, dataDir: 'C:\\new games\\JA2\\Data' };
    expect(parseConfig(configText(windows), 'config.json')).toEqual(windows);
  });

  it('refuses a damaged or foreign file with its name in the message', () => {
    expect(() => parseConfig('{', 'config.json')).toThrow(ConfigError);
    expect(() => parseConfig('{', 'config.json')).toThrow(/config\.json is not JSON/);
    expect(() => parseConfig(JSON.stringify({ ...SAVED }), 'config.json')).toThrow(/not a ja2-node config/);
    const text = configText(SAVED).replace('"port": 7500', '"port": 70000');
    expect(() => parseConfig(text, 'config.json')).toThrow(/port/);
  });

  it('is missing before the first setup and written whole', async () => {
    dir = await mkdtemp(join(tmpdir(), 'ja2-player-config-'));
    const file = join(dir, 'nested', 'config.json');
    expect(await readConfig(file)).toBeNull();
    await writeConfig(file, SAVED);
    expect(await readConfig(file)).toEqual(SAVED);
    expect(JSON.parse(await readFile(file, 'utf8'))).toMatchObject({ format: 'ja2-node-config', version: 1 });
    await writeFile(file, 'not json');
    await expect(readConfig(file)).rejects.toThrow(ConfigError);
  });
});

describe('the settings of a run', () => {
  it('take the command line over the environment over the file over the defaults', () => {
    const env = { [HOST_ENV]: '192.168.1.5', [PORT_ENV]: '7600' };
    const settings = resolveSettings({ port: 7700 }, env, SAVED);
    expect(settings.port).toEqual({ value: 7700, source: 'flag' });
    expect(settings.host).toEqual({ value: '192.168.1.5', source: 'environment' });
    expect(settings.dataDir).toEqual({ value: SAVED.dataDir, source: 'file' });
    expect(settingValues(resolveSettings({}, {}, null))).toEqual(DEFAULT_CONFIG);
    expect(resolveSettings({}, {}, null).port.source).toBe('default');
  });

  it('read an empty data folder variable or --no-data as no game data, and an empty version as detection', () => {
    expect(resolveSettings({}, { [DATA_DIR_ENV]: '' }, SAVED).dataDir).toEqual({ value: null, source: 'environment' });
    expect(resolveSettings({ dataDir: null }, {}, SAVED).dataDir).toEqual({ value: null, source: 'flag' });
    expect(resolveSettings({}, { [DATA_VERSION_ENV]: '' }, SAVED).dataVersion).toEqual({ value: null, source: 'environment' });
    expect(resolveSettings({}, { [DATA_VERSION_ENV]: 'RussianGold' }, null).dataVersion.value).toBe('russianGold');
  });

  it('refuse a bad port or version in the environment', () => {
    expect(() => resolveSettings({}, { [PORT_ENV]: 'abc' }, null)).toThrow(ConfigError);
    expect(() => resolveSettings({}, { [DATA_VERSION_ENV]: 'klingon' }, null)).toThrow(/must be one of/);
  });

  it('take ports from 1 to 65535 only', () => {
    expect(parsePort('7420')).toBe(7420);
    for (const text of ['', '0', '65536', '74.2', 'port']) expect(parsePort(text), text).toBeNull();
  });
});

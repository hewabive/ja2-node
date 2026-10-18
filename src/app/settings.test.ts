import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SETTINGS,
  effectiveMaster,
  loadSettings,
  normalizeSettings,
  SETTINGS_KEY,
  type SettingsStorage,
  saveSettings,
  updateSettings,
} from './settings.ts';

function memory(): SettingsStorage & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return { data, getItem: (k) => data.get(k) ?? null, setItem: (k, v) => void data.set(k, v) };
}

const broken: SettingsStorage = {
  getItem: () => {
    throw new Error('denied');
  },
  setItem: () => {
    throw new Error('denied');
  },
};

describe('client settings', () => {
  it('default the four volumes to 63, the master to full, speech and subtitles on', () => {
    expect(loadSettings(memory())).toEqual(DEFAULT_SETTINGS);
    expect(DEFAULT_SETTINGS.volumes).toEqual({ effects: 63, speech: 63, music: 63, ambient: 63, master: 127 });
  });

  it('round-trip through storage under one versioned key', () => {
    const store = memory();
    const changed = updateSettings(DEFAULT_SETTINGS, { volumes: { effects: 100 }, muteConfirmations: true });
    expect(saveSettings(changed, store)).toBe(true);
    expect(JSON.parse(store.data.get(SETTINGS_KEY) ?? '{}').version).toBe(1);
    expect(loadSettings(store)).toEqual(changed);
  });

  it('clamp volumes, ignore junk and other versions, and keep speech or subtitles on', () => {
    expect(normalizeSettings({ volumes: { effects: 500, speech: -3, music: 'x', ambient: 12.6 } }).volumes).toEqual({
      effects: 127,
      speech: 0,
      music: 63,
      ambient: 13,
      master: 127,
    });
    expect(normalizeSettings({ version: 99, muted: true })).toEqual(DEFAULT_SETTINGS);
    expect(normalizeSettings('nope')).toEqual(DEFAULT_SETTINGS);
    expect(normalizeSettings({ speech: false, subtitles: false })).toMatchObject({ speech: true, subtitles: true });
    expect(normalizeSettings({ speech: false })).toMatchObject({ speech: false, subtitles: true });
  });

  it('work without storage or with storage that throws', () => {
    expect(loadSettings(null)).toEqual(DEFAULT_SETTINGS);
    expect(loadSettings(broken)).toEqual(DEFAULT_SETTINGS);
    expect(saveSettings(DEFAULT_SETTINGS, broken)).toBe(false);
    const store = memory();
    store.data.set(SETTINGS_KEY, '{not json');
    expect(loadSettings(store)).toEqual(DEFAULT_SETTINGS);
  });

  it('play the splash and the beginning intro by default and keep either switch off once saved', () => {
    expect(DEFAULT_SETTINGS).toMatchObject({ playSplash: true, playIntro: true });
    const store = memory();
    saveSettings(updateSettings(DEFAULT_SETTINGS, { playSplash: false }), store);
    expect(loadSettings(store)).toMatchObject({ playSplash: false, playIntro: true });
    expect(normalizeSettings({ version: 1, playIntro: 'no' })).toMatchObject({ playIntro: true });
  });

  it('silence the master while muted without losing its value', () => {
    const muted = updateSettings(DEFAULT_SETTINGS, { muted: true });
    expect(effectiveMaster(muted)).toBe(0);
    expect(effectiveMaster(updateSettings(muted, { muted: false }))).toBe(127);
  });
});

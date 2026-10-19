import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SETTINGS,
  effectiveMaster,
  loadSettings,
  markMeanwhileSceneSeen,
  meanwhileSceneSeen,
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
    expect(JSON.parse(store.data.get(SETTINGS_KEY) ?? '{}').version).toBe(2);
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

  it('keep the version 1 fields and add the version 2 ones with the original defaults', () => {
    const v1 = { version: 1, volumes: { music: 90 }, muted: true, speech: false, subtitles: true, playIntro: false };
    expect(normalizeSettings(v1)).toEqual({
      ...DEFAULT_SETTINGS,
      volumes: { ...DEFAULT_SETTINGS.volumes, music: 90 },
      muted: true,
      speech: false,
      playIntro: false,
    });
    expect(DEFAULT_SETTINGS).toMatchObject({
      keyAdvanceSpeech: false,
      sleepWakeNotification: true,
      playbackSpeed: 1,
      language: null,
      meanwhileScenesSeen: 0,
      helpHidden: false,
      coverSize: 4,
      losSize: 4,
    });
    expect(DEFAULT_SETTINGS.display).toMatchObject({ useMetricSystem: true, snapCursorToDoor: true, cursor3d: false, trackingMode: true });
  });

  it('clamp the display sizes, the playback speed and the language, and keep the display toggles apart', () => {
    expect(normalizeSettings({ coverSize: 30, losSize: 1 })).toMatchObject({ coverSize: 11, losSize: 4 });
    expect(normalizeSettings({ playbackSpeed: 3, language: 'xx' })).toMatchObject({ playbackSpeed: 1, language: null });
    expect(normalizeSettings({ playbackSpeed: 4, language: 'rus' })).toMatchObject({ playbackSpeed: 4, language: 'rus' });
    const changed = updateSettings(DEFAULT_SETTINGS, { display: { glowItems: false }, keyAdvanceSpeech: true });
    expect(changed.display).toEqual({ ...DEFAULT_SETTINGS.display, glowItems: false });
    expect(changed.keyAdvanceSpeech).toBe(true);
  });

  it('remember the meanwhile scenes seen as flags', () => {
    const seen = markMeanwhileSceneSeen(markMeanwhileSceneSeen(DEFAULT_SETTINGS, 3), 31);
    expect(meanwhileSceneSeen(seen, 3)).toBe(true);
    expect(meanwhileSceneSeen(seen, 31)).toBe(true);
    expect(meanwhileSceneSeen(seen, 4)).toBe(false);
    expect(markMeanwhileSceneSeen(seen, 40)).toBe(seen);
    expect(normalizeSettings({ meanwhileScenesSeen: -1 }).meanwhileScenesSeen).toBe(0);
  });

  it('silence the master while muted without losing its value', () => {
    const muted = updateSettings(DEFAULT_SETTINGS, { muted: true });
    expect(effectiveMaster(muted)).toBe(0);
    expect(effectiveMaster(updateSettings(muted, { muted: false }))).toBe(127);
  });

  it('default to the automatic UI scale without the 640×480-only option and keep only whole scales in range', () => {
    expect(DEFAULT_SETTINGS).toMatchObject({ uiScale: 0, fixed640: false });
    expect(normalizeSettings({ uiScale: 3, fixed640: true })).toMatchObject({ uiScale: 3, fixed640: true });
    expect(normalizeSettings({ uiScale: 2.5 })).toMatchObject({ uiScale: 0 });
    expect(normalizeSettings({ uiScale: 99 })).toMatchObject({ uiScale: 0 });
  });
});

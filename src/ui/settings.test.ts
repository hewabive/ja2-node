import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SETTINGS,
  effectiveMaster,
  meanwhileScenesHandedOver,
  meanwhileScenesSeenIn,
  meanwhileScenesToBeHandedOver,
  meanwhileScenesToHandOver,
  normalizeSettings,
  readSettings,
  SETTINGS_KEY,
  type SettingsStorage,
  updateSettings,
  writeSettings,
} from './settings.ts';

function memory(): SettingsStorage & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return { data, getItem: (k) => data.get(k) ?? null, setItem: (k, v) => void data.set(k, v) };
}

const OLDER_PAGE_SCENES = ((1 << 3) | (1 << 31)) >>> 0;

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
    expect(readSettings(memory())).toEqual(DEFAULT_SETTINGS);
    expect(DEFAULT_SETTINGS.volumes).toEqual({ effects: 63, speech: 63, music: 63, ambient: 63, master: 127 });
  });

  it('round-trip through storage under one versioned key', () => {
    const store = memory();
    const changed = updateSettings(DEFAULT_SETTINGS, { volumes: { effects: 100 }, muteConfirmations: true });
    expect(writeSettings(changed, store)).toBe(true);
    expect(JSON.parse(store.data.get(SETTINGS_KEY) ?? '{}').version).toBe(2);
    expect(readSettings(store)).toEqual(changed);
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
    expect(readSettings(null)).toEqual(DEFAULT_SETTINGS);
    expect(readSettings(broken)).toEqual(DEFAULT_SETTINGS);
    expect(writeSettings(DEFAULT_SETTINGS, broken)).toBe(false);
    const store = memory();
    store.data.set(SETTINGS_KEY, '{not json');
    expect(readSettings(store)).toEqual(DEFAULT_SETTINGS);
  });

  it('play the splash and the beginning intro by default and keep either switch off once saved', () => {
    expect(DEFAULT_SETTINGS).toMatchObject({ playSplash: true, playIntro: true });
    const store = memory();
    writeSettings(updateSettings(DEFAULT_SETTINGS, { playSplash: false }), store);
    expect(readSettings(store)).toMatchObject({ playSplash: false, playIntro: true });
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
      catchUpSpeed: 1,
      language: null,
      helpHidden: false,
      coverSize: 4,
      losSize: 4,
    });
    expect(DEFAULT_SETTINGS.display).toMatchObject({ useMetricSystem: true, snapCursorToDoor: true, cursor3d: false, trackingMode: true });
  });

  it('clamp the display sizes, the catch-up speed and the language, and keep the display toggles apart', () => {
    expect(normalizeSettings({ coverSize: 30, losSize: 1 })).toMatchObject({ coverSize: 11, losSize: 4 });
    expect(normalizeSettings({ catchUpSpeed: 0.5, language: 'xx' })).toMatchObject({ catchUpSpeed: 1, language: null });
    expect(normalizeSettings({ catchUpSpeed: 4, language: 'rus' })).toMatchObject({ catchUpSpeed: 4, language: 'rus' });
    const changed = updateSettings(DEFAULT_SETTINGS, { display: { glowItems: false }, keyAdvanceSpeech: true });
    expect(changed.display).toEqual({ ...DEFAULT_SETTINGS.display, glowItems: false });
    expect(changed.keyAdvanceSpeech).toBe(true);
  });

  it('keep the meanwhile scenes seen an older page stored out of the settings, through every write, until the server has them', () => {
    const storage = memory();
    storage.setItem(SETTINGS_KEY, JSON.stringify({ version: 2, muted: true, meanwhileScenesSeen: OLDER_PAGE_SCENES }));
    expect(readSettings(storage)).not.toHaveProperty('meanwhileScenesSeen');
    expect(meanwhileScenesToHandOver(storage)).toBe(OLDER_PAGE_SCENES);
    writeSettings(updateSettings(readSettings(storage), { playIntro: false }), storage);
    expect(JSON.parse(storage.getItem(SETTINGS_KEY) ?? '{}')).toMatchObject({ muted: true, playIntro: false });
    expect(meanwhileScenesToHandOver(storage)).toBe(OLDER_PAGE_SCENES);
    meanwhileScenesHandedOver(1 << 3, storage);
    expect(meanwhileScenesToHandOver(storage)).toBe((1 << 31) >>> 0);
    meanwhileScenesHandedOver(1 << 31, storage);
    expect(JSON.parse(storage.getItem(SETTINGS_KEY) ?? '{}')).not.toHaveProperty('meanwhileScenesSeen');
    expect(readSettings(storage)).toMatchObject({ muted: true, playIntro: false });
    meanwhileScenesToBeHandedOver(1 << 5, storage);
    expect(meanwhileScenesToHandOver(storage)).toBe(1 << 5);
    expect(meanwhileScenesSeenIn({ meanwhileScenesSeen: -1 })).toBe(0);
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

  it('keep the World Wide Wait at the original speed by default, allow it off and reject junk', () => {
    expect(DEFAULT_SETTINGS.websiteLoadingTimeScale).toBe(1);
    expect(normalizeSettings({ websiteLoadingTimeScale: 0 })).toMatchObject({ websiteLoadingTimeScale: 0 });
    expect(normalizeSettings({ websiteLoadingTimeScale: 2.5 })).toMatchObject({ websiteLoadingTimeScale: 2.5 });
    expect(normalizeSettings({ websiteLoadingTimeScale: -1 })).toMatchObject({ websiteLoadingTimeScale: 1 });
    expect(normalizeSettings({ websiteLoadingTimeScale: 'slow' })).toMatchObject({ websiteLoadingTimeScale: 1 });
  });

  it('start without a last saved game slot, keep a slot of the INT8 range and read anything below 0 as -1', () => {
    expect(DEFAULT_SETTINGS.lastSavedGameSlot).toBe(-1);
    expect(normalizeSettings({ lastSavedGameSlot: 0 })).toMatchObject({ lastSavedGameSlot: 0 });
    expect(normalizeSettings({ lastSavedGameSlot: 127 })).toMatchObject({ lastSavedGameSlot: 127 });
    expect(normalizeSettings({ lastSavedGameSlot: -5 })).toMatchObject({ lastSavedGameSlot: -1 });
    expect(normalizeSettings({ lastSavedGameSlot: 128 })).toMatchObject({ lastSavedGameSlot: -1 });
    expect(normalizeSettings({ lastSavedGameSlot: 0.5 })).toMatchObject({ lastSavedGameSlot: -1 });
  });
});

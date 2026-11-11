import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, speechOrSubtitlesKept, updateSettings } from '../../ui/settings.ts';
import { parseSettingsFile, SETTINGS_FILE_FORMAT, settingsFileText } from './settings-file.ts';

describe('settings export and import', () => {
  it('round-trip the settings through a file', () => {
    const changed = updateSettings(DEFAULT_SETTINGS, {
      volumes: { music: 10, master: 90 },
      language: 'rus',
      playIntro: false,
      sleepWakeNotification: false,
      catchUpSpeed: 4,
    });
    const text = settingsFileText(changed);
    expect(JSON.parse(text)).toMatchObject({ format: SETTINGS_FILE_FORMAT, settings: { version: 2, language: 'rus' } });
    expect(JSON.parse(text).settings).not.toHaveProperty('meanwhileScenesSeen');
    expect(parseSettingsFile(text)).toEqual({ settings: changed, meanwhileScenesSeen: 0 });
  });

  it("carry the installation's meanwhile scenes seen beside the settings, where an older file kept them, for the server to merge", () => {
    const seen = (1 << 1) | (1 << 7);
    const text = settingsFileText(DEFAULT_SETTINGS, seen);
    expect(JSON.parse(text).settings).toMatchObject({ meanwhileScenesSeen: seen });
    expect(parseSettingsFile(text)).toEqual({ settings: DEFAULT_SETTINGS, meanwhileScenesSeen: seen });
    const older = JSON.stringify({ format: SETTINGS_FILE_FORMAT, settings: { version: 2, muted: true, meanwhileScenesSeen: 1 << 3 } });
    expect(parseSettingsFile(older)).toEqual({ settings: updateSettings(DEFAULT_SETTINGS, { muted: true }), meanwhileScenesSeen: 1 << 3 });
  });

  it('refuse other files and normalize what they hold', () => {
    expect(parseSettingsFile('not json')).toBeNull();
    expect(parseSettingsFile('[]')).toBeNull();
    expect(parseSettingsFile(JSON.stringify({ format: 'other', settings: {} }))).toBeNull();
    expect(parseSettingsFile(JSON.stringify({ format: SETTINGS_FILE_FORMAT }))).toBeNull();
    const odd = parseSettingsFile(
      JSON.stringify({ format: SETTINGS_FILE_FORMAT, settings: { volumes: { effects: 500 }, speech: false, subtitles: false } }),
    );
    expect(odd?.settings.volumes.effects).toBe(127);
    expect(odd?.settings.speech && odd.settings.subtitles).toBe(true);
    expect(parseSettingsFile(JSON.stringify({ format: SETTINGS_FILE_FORMAT, settings: { version: 99 } }))?.settings).toEqual(
      DEFAULT_SETTINGS,
    );
  });

  it('keep speech or subtitles on', () => {
    const subtitlesOff = updateSettings(DEFAULT_SETTINGS, { subtitles: false });
    expect(speechOrSubtitlesKept(subtitlesOff, 'speech', false)).toBe(false);
    expect(speechOrSubtitlesKept(DEFAULT_SETTINGS, 'speech', false)).toBe(true);
    expect(speechOrSubtitlesKept(subtitlesOff, 'subtitles', true)).toBe(true);
    expect(speechOrSubtitlesKept(subtitlesOff, 'muted', false)).toBe(true);
  });
});

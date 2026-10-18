import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, updateSettings } from '../settings.ts';
import { parseSettingsFile, SETTINGS_FILE_FORMAT, settingsFileText } from './settings-file.ts';
import { speechOrSubtitlesKept } from './settings-panel.ts';

describe('settings export and import', () => {
  it('round-trip the settings through a file', () => {
    const changed = updateSettings(DEFAULT_SETTINGS, {
      volumes: { music: 10, master: 90 },
      language: 'rus',
      playIntro: false,
      sleepWakeNotification: false,
      playbackSpeed: 4,
    });
    const text = settingsFileText(changed);
    expect(JSON.parse(text)).toMatchObject({ format: SETTINGS_FILE_FORMAT, settings: { version: 2, language: 'rus' } });
    expect(parseSettingsFile(text)).toEqual(changed);
  });

  it('refuse other files and normalize what they hold', () => {
    expect(parseSettingsFile('not json')).toBeNull();
    expect(parseSettingsFile('[]')).toBeNull();
    expect(parseSettingsFile(JSON.stringify({ format: 'other', settings: {} }))).toBeNull();
    expect(parseSettingsFile(JSON.stringify({ format: SETTINGS_FILE_FORMAT }))).toBeNull();
    const odd = parseSettingsFile(
      JSON.stringify({ format: SETTINGS_FILE_FORMAT, settings: { volumes: { effects: 500 }, speech: false, subtitles: false } }),
    );
    expect(odd?.volumes.effects).toBe(127);
    expect(odd?.speech && odd.subtitles).toBe(true);
    expect(parseSettingsFile(JSON.stringify({ format: SETTINGS_FILE_FORMAT, settings: { version: 99 } }))).toEqual(DEFAULT_SETTINGS);
  });

  it('keep speech or subtitles on', () => {
    const subtitlesOff = updateSettings(DEFAULT_SETTINGS, { subtitles: false });
    expect(speechOrSubtitlesKept(subtitlesOff, 'speech', false)).toBe(false);
    expect(speechOrSubtitlesKept(DEFAULT_SETTINGS, 'speech', false)).toBe(true);
    expect(speechOrSubtitlesKept(subtitlesOff, 'subtitles', true)).toBe(true);
    expect(speechOrSubtitlesKept(subtitlesOff, 'muted', false)).toBe(true);
  });
});

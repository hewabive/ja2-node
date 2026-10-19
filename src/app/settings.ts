import { type ClientSettings, readSettings, type SettingsStorage, writeSettings } from '../ui/settings.ts';

function browserStorage(): SettingsStorage | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

export function loadSettings(storage: SettingsStorage | null = browserStorage()): ClientSettings {
  return readSettings(storage);
}

export function saveSettings(settings: ClientSettings, storage: SettingsStorage | null = browserStorage()): boolean {
  return writeSettings(settings, storage);
}

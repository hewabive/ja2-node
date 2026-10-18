import { type ClientSettings, normalizeSettings } from '../settings.ts';

export const SETTINGS_FILE_FORMAT = 'ja2-node-settings';
export const SETTINGS_FILE_NAME = 'ja2-node-settings.json';
const JSON_INDENT = 2;

interface SettingsFile {
  readonly format: typeof SETTINGS_FILE_FORMAT;
  readonly settings: ClientSettings;
}

export function settingsFileText(settings: ClientSettings): string {
  const file: SettingsFile = { format: SETTINGS_FILE_FORMAT, settings: normalizeSettings(settings) };
  return `${JSON.stringify(file, null, JSON_INDENT)}\n`;
}

export function parseSettingsFile(text: string): ClientSettings | null {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return null;
  }
  if (typeof value !== 'object' || value === null) return null;
  const file = value as Partial<Record<keyof SettingsFile, unknown>>;
  if (file.format !== SETTINGS_FILE_FORMAT || typeof file.settings !== 'object' || file.settings === null) return null;
  return normalizeSettings(file.settings);
}

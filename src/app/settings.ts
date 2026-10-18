// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-18. See LICENSE (SFI-SCLA).
// @src src/game/GameSettings.cc LoadGameSettings (volumes default to 63, speech or subtitles always on). See docs/27 §2.2.

export const SETTINGS_KEY = 'ja2-node:settings';
export const SETTINGS_VERSION = 1;
export const MAX_SETTING_VOLUME = 127;
const DEFAULT_CATEGORY_VOLUME = 63;

export interface VolumeSettings {
  readonly effects: number;
  readonly speech: number;
  readonly music: number;
  readonly ambient: number;
  readonly master: number;
}

export interface ClientSettings {
  readonly version: typeof SETTINGS_VERSION;
  readonly volumes: VolumeSettings;
  readonly muted: boolean;
  readonly speech: boolean;
  readonly subtitles: boolean;
  readonly muteConfirmations: boolean;
}

export const DEFAULT_SETTINGS: ClientSettings = {
  version: SETTINGS_VERSION,
  volumes: {
    effects: DEFAULT_CATEGORY_VOLUME,
    speech: DEFAULT_CATEGORY_VOLUME,
    music: DEFAULT_CATEGORY_VOLUME,
    ambient: DEFAULT_CATEGORY_VOLUME,
    master: MAX_SETTING_VOLUME,
  },
  muted: false,
  speech: true,
  subtitles: true,
  muteConfirmations: false,
};

export interface SettingsStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

function volume(value: unknown, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return Math.min(MAX_SETTING_VOLUME, Math.max(0, Math.round(value)));
}

function flag(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

function record(value: unknown): Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

export function normalizeSettings(raw: unknown): ClientSettings {
  const o = record(raw);
  if (o.version !== undefined && o.version !== SETTINGS_VERSION) return DEFAULT_SETTINGS;
  const v = record(o.volumes);
  const d = DEFAULT_SETTINGS;
  const neither = !flag(o.speech, d.speech) && !flag(o.subtitles, d.subtitles);
  const speech = neither || flag(o.speech, d.speech);
  const subtitles = neither || flag(o.subtitles, d.subtitles);
  return {
    version: SETTINGS_VERSION,
    volumes: {
      effects: volume(v.effects, d.volumes.effects),
      speech: volume(v.speech, d.volumes.speech),
      music: volume(v.music, d.volumes.music),
      ambient: volume(v.ambient, d.volumes.ambient),
      master: volume(v.master, d.volumes.master),
    },
    muted: flag(o.muted, d.muted),
    speech,
    subtitles,
    muteConfirmations: flag(o.muteConfirmations, d.muteConfirmations),
  };
}

function browserStorage(): SettingsStorage | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

export function loadSettings(storage: SettingsStorage | null = browserStorage()): ClientSettings {
  try {
    const text = storage?.getItem(SETTINGS_KEY);
    return text ? normalizeSettings(JSON.parse(text)) : DEFAULT_SETTINGS;
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export function saveSettings(settings: ClientSettings, storage: SettingsStorage | null = browserStorage()): boolean {
  try {
    storage?.setItem(SETTINGS_KEY, JSON.stringify(normalizeSettings(settings)));
    return storage !== null;
  } catch {
    return false;
  }
}

export function updateSettings(
  settings: ClientSettings,
  change: Partial<Omit<ClientSettings, 'version' | 'volumes'>> & { volumes?: Partial<VolumeSettings> },
): ClientSettings {
  return normalizeSettings({ ...settings, ...change, volumes: { ...settings.volumes, ...change.volumes } });
}

export function effectiveMaster(settings: ClientSettings): number {
  return settings.muted ? 0 : settings.volumes.master;
}

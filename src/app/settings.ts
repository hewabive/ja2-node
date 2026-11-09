import {
  type ClientSettings,
  meanwhileScenesHandedOver,
  meanwhileScenesToBeHandedOver,
  meanwhileScenesToHandOver,
  readSettings,
  type SettingsStorage,
  writeSettings,
} from '../ui/settings.ts';

export type HandOver = (meanwhileScenesSeen: number) => Promise<boolean>;

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

export function pendingMeanwhileScenesSeen(storage: SettingsStorage | null = browserStorage()): number {
  return meanwhileScenesToHandOver(storage);
}

export async function handOverSeenMeanwhileScenes(
  handOver: HandOver,
  imported = 0,
  storage: SettingsStorage | null = browserStorage(),
): Promise<boolean> {
  if (imported !== 0) meanwhileScenesToBeHandedOver(imported, storage);
  const flags = meanwhileScenesToHandOver(storage);
  if (flags === 0) return true;
  const accepted = await handOver(flags).catch(() => false);
  if (accepted) meanwhileScenesHandedOver(flags, storage);
  return accepted;
}

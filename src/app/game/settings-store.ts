import type { SettingsStore } from '../../ui/screens/front-end/environment.ts';
import { type ClientSettings, effectiveMaster, type SettingsChange, updateSettings } from '../../ui/settings.ts';
import { loadSettings, saveSettings } from '../settings.ts';

export class BrowserSettingsStore implements SettingsStore {
  readonly #listeners: ((settings: ClientSettings) => void)[] = [];
  #settings: ClientSettings = loadSettings();

  current(): ClientSettings {
    return this.#settings;
  }

  change(change: SettingsChange): void {
    this.#settings = updateSettings(this.#settings, change);
    for (const listener of this.#listeners) listener(this.#settings);
  }

  persist(): void {
    saveSettings(this.#settings);
  }

  listen(listener: (settings: ClientSettings) => void): void {
    this.#listeners.push(listener);
    listener(this.#settings);
  }
}

export function engineVolumes(settings: ClientSettings) {
  return { ...settings.volumes, master: effectiveMaster(settings) };
}

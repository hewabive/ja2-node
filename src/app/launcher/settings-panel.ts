import {
  type ClientSettings,
  PLAYBACK_SPEEDS,
  type SettingsChange,
  speechOrSubtitlesKept,
  type VolumeSettings,
} from '../../ui/settings.ts';
import type { Labels } from '../../ui/text/labels.ts';
import type { MessageBox } from './message-box.ts';
import { parseSettingsFile, SETTINGS_FILE_NAME, settingsFileText } from './settings-file.ts';

type FlagSetting =
  | 'muted'
  | 'speech'
  | 'subtitles'
  | 'keyAdvanceSpeech'
  | 'muteConfirmations'
  | 'sleepWakeNotification'
  | 'playSplash'
  | 'playIntro';

const FLAG_SETTINGS: readonly FlagSetting[] = [
  'muted',
  'speech',
  'subtitles',
  'keyAdvanceSpeech',
  'muteConfirmations',
  'sleepWakeNotification',
  'playSplash',
  'playIntro',
];
const VOLUME_SETTINGS: readonly (keyof VolumeSettings)[] = ['effects', 'speech', 'music', 'ambient', 'master'];
const REVOKE_DELAY_MS = 1000;

export interface SettingsPanelContext {
  readonly settings: () => ClientSettings;
  readonly change: (change: SettingsChange) => void;
  readonly replace: (settings: ClientSettings) => void;
  readonly labels: () => Labels;
  readonly box: MessageBox;
  readonly status: (text: string, error?: boolean) => void;
}

function isFlagSetting(value: string | undefined): value is FlagSetting {
  return FLAG_SETTINGS.includes(value as FlagSetting);
}

function isVolumeSetting(value: string | undefined): value is keyof VolumeSettings {
  return VOLUME_SETTINGS.includes(value as keyof VolumeSettings);
}

export class SettingsPanel {
  readonly #ctx: SettingsPanelContext;
  readonly #speed = document.getElementById('playbackSpeed') as HTMLSelectElement;

  constructor(ctx: SettingsPanelContext) {
    this.#ctx = ctx;
    for (const input of document.querySelectorAll<HTMLInputElement>('[data-volume]')) {
      input.addEventListener('input', () => {
        const key = input.dataset.volume;
        if (isVolumeSetting(key)) ctx.change({ volumes: { [key]: Number(input.value) } });
      });
    }
    for (const input of document.querySelectorAll<HTMLInputElement>('[data-setting]')) {
      input.addEventListener('change', () => void this.#toggle(input));
    }
    this.#speed.replaceChildren(
      ...PLAYBACK_SPEEDS.map((speed) => {
        const o = document.createElement('option');
        o.value = String(speed);
        o.textContent = `${speed}×`;
        return o;
      }),
    );
    this.#speed.addEventListener('change', () => ctx.change({ playbackSpeed: Number(this.#speed.value) }));
    document.getElementById('exportSettings')?.addEventListener('click', () => this.#export());
    const importInput = document.getElementById('importSettings') as HTMLInputElement;
    importInput.addEventListener('change', () => void this.#import(importInput));
  }

  async #toggle(input: HTMLInputElement): Promise<void> {
    const key = input.dataset.setting;
    if (!isFlagSetting(key)) return;
    if (!speechOrSubtitlesKept(this.#ctx.settings(), key, input.checked)) {
      input.checked = true;
      await this.#ctx.box.alert(this.#ctx.labels().text('needSpeechOrSubtitles'));
      return;
    }
    this.#ctx.change({ [key]: input.checked });
  }

  render(): void {
    const settings = this.#ctx.settings();
    for (const input of document.querySelectorAll<HTMLInputElement>('[data-volume]')) {
      const key = input.dataset.volume;
      if (isVolumeSetting(key)) input.value = String(settings.volumes[key]);
    }
    for (const input of document.querySelectorAll<HTMLInputElement>('[data-setting]')) {
      const key = input.dataset.setting;
      if (isFlagSetting(key)) input.checked = settings[key];
    }
    this.#speed.value = String(settings.playbackSpeed);
  }

  #export(): void {
    const blob = new Blob([settingsFileText(this.#ctx.settings())], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = SETTINGS_FILE_NAME;
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), REVOKE_DELAY_MS);
  }

  async #import(input: HTMLInputElement): Promise<void> {
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    const imported = parseSettingsFile(await file.text());
    if (!imported) return this.#ctx.status(this.#ctx.labels().text('notSettingsFile'), true);
    this.#ctx.replace(imported);
    this.#ctx.status(this.#ctx.labels().text('settingsImported'));
  }
}

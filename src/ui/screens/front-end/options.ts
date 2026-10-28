// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-19. See LICENSE (SFI-SCLA).
// @src src/game/GameSettings.h TOPTION_* (the order of the toggles); src/game/Options_Screen.cc EnterOptionsScreen (Save
// @src disabled from the main menu, when the game cannot be saved and in Dead is Dead; the game paused), HandleOptionToggle
// @src (speech and subtitles cannot both be off: OPT_NEED_AT_LEAST_SPEECH_OR_SUBTITLE_OPTION_ON; BIG_SWITCH3 in and out
// @src at BTNVOLUME for a click on a label), SelectedOptionTextRegionCallBack, SelectedOptionTextRegionMovementCallBack,
// @src SelectedToggleBoxAreaRegionMovementCallBack, HandleHighLightedText, SoundFXSliderChangeCallBack,
// @src SpeechSliderChangeCallBack, MusicSliderChangeCallBack, HandleSliderBarMovementSounds (a test sample
// @src OPT_MUSIC_SLIDER_PLAY_SOUND_DELAY ms after the effects or speech slider stops), BtnOptQuitCallback and
// @src ConfirmQuitToMainMenuMessageBoxCallBack (OPT_RETURN_TO_MAIN YES/NO), ExitOptionsScreen (the settings saved on any
// @src exit).

import { type ControllerContract, ViewModelController } from '../../layout/controller.ts';
import type { MessageBoxes } from '../../message-boxes.ts';
import { type ClientSettings, type DisplaySettings, type SettingsChange, speechOrSubtitlesKept } from '../../settings.ts';
import type { UiTextService } from '../../text/text-service.ts';
import { UiScreenKind, type UiSoundSink } from '../../widgets/button-sounds.ts';
import { type FrontEndEnvironment, FrontEndLayout, FrontEndScreen, type SettingsStore } from './environment.ts';

export const OPTIONS_SCREEN = 'options';

export const OPTIONS_CONTRACT: ControllerContract = {
  id: OPTIONS_SCREEN,
  actions: {
    toggle: { args: 1 },
    labelPress: { args: 1 },
    labelToggle: { args: 1 },
    hover: { args: 2 },
    unhighlight: { args: 1 },
    setEffects: { args: 1 },
    setSpeech: { args: 1 },
    setMusic: { args: 1 },
    saveGame: {},
    loadGame: {},
    mainMenu: {},
    done: {},
  },
  bindings: { toggles: 'list', effects: 'number', speech: 'number', music: 'number', saveEnabled: 'boolean' },
};

type TopLevelToggle = 'speech' | 'muteConfirmations' | 'subtitles' | 'keyAdvanceSpeech' | 'sleepWakeNotification' | 'bloodAndGore';
export type ToggleSetting = { readonly top: TopLevelToggle } | { readonly display: keyof DisplaySettings };

export const OPTION_TOGGLES: readonly ToggleSetting[] = [
  { top: 'speech' },
  { top: 'muteConfirmations' },
  { top: 'subtitles' },
  { top: 'keyAdvanceSpeech' },
  { display: 'animateSmoke' },
  { top: 'bloodAndGore' },
  { display: 'dontMoveMouse' },
  { display: 'oldSelectionMethod' },
  { display: 'alwaysShowMovementPath' },
  { display: 'showMisses' },
  { display: 'rtConfirm' },
  { top: 'sleepWakeNotification' },
  { display: 'useMetricSystem' },
  { display: 'mercAlwaysLightUp' },
  { display: 'smartCursor' },
  { display: 'snapCursorToDoor' },
  { display: 'glowItems' },
  { display: 'treeTops' },
  { display: 'wireframe' },
  { display: 'cursor3d' },
  { display: 'mercCastsLight' },
  { display: 'hideBullets' },
  { display: 'trackingMode' },
];

const BLOOD_AND_GORE = 5;
const NO_HIGHLIGHT = -1;
const HOVER_ON = 1;
const SLIDER_SOUND_DELAY_MS = 75;
const BTN_VOLUME = 40;
const HIGH_VOLUME = 127;
const EFFECTS_TEST_SAMPLE = 'sounds/weapons/lmg reload.wav';
const SPEECH_TEST_SAMPLE = 'battlesnds/m_cool.wav';
const LABEL_SOUND_IN = 'BIG_SWITCH3_IN';
const LABEL_SOUND_OUT = 'BIG_SWITCH3_OUT';
const OPTIONS_TEXT = 'zOptionsText';
const NEED_SPEECH_OR_SUBTITLES = 8;
const RETURN_TO_MAIN = 7;

export type OptionsOrigin = 'mainMenu' | 'game';

export interface OptionsActions {
  saveGame(): void;
  loadGame(): void;
  quitToMainMenu(): void;
  done(): void;
}

export interface OptionsDeps {
  readonly actions: OptionsActions;
  readonly settings: SettingsStore;
  readonly boxes: MessageBoxes;
  readonly text: UiTextService;
  readonly sounds: UiSoundSink;
  readonly origin: OptionsOrigin;
  readonly canSave: boolean;
  readonly deadIsDead: boolean;
  readonly sessionBloodAndGore: boolean | null;
  readonly setSessionBloodAndGore?: (on: boolean) => void;
}

export interface ToggleRow {
  on: boolean;
  highlighted: boolean;
}

export interface OptionsModel {
  toggles: ToggleRow[];
  effects: number;
  speech: number;
  music: number;
  saveEnabled: boolean;
}

export function toggleValue(settings: ClientSettings, toggle: ToggleSetting): boolean {
  return 'top' in toggle ? settings[toggle.top] : settings.display[toggle.display];
}

function toggleChange(toggle: ToggleSetting, on: boolean): SettingsChange {
  return 'top' in toggle ? { [toggle.top]: on } : { display: { [toggle.display]: on } };
}

export class OptionsController extends ViewModelController {
  readonly view: OptionsModel;
  readonly #deps: OptionsDeps;
  #highlighted = NO_HIGHLIGHT;
  #sessionBlood: boolean | null;
  #effectsMovedAt: number | null = null;
  #speechMovedAt: number | null = null;
  #now = 0;
  #leaving = false;

  constructor(deps: OptionsDeps) {
    const view: OptionsModel = { toggles: [], effects: 0, speech: 0, music: 0, saveEnabled: false };
    super(OPTIONS_CONTRACT, view as unknown as Record<string, unknown>, {
      toggle: ([i]) => void this.toggle(i ?? NO_HIGHLIGHT),
      labelPress: () => this.#play(LABEL_SOUND_IN),
      labelToggle: ([i]) => {
        this.#play(LABEL_SOUND_OUT);
        void this.toggle(i ?? NO_HIGHLIGHT);
      },
      hover: ([i, on]) => this.#hover(i ?? NO_HIGHLIGHT, on === HOVER_ON),
      unhighlight: ([on]) => {
        if (on === HOVER_ON) this.#highlight(NO_HIGHLIGHT);
      },
      setEffects: ([v]) => this.#volume('effects', v),
      setSpeech: ([v]) => this.#volume('speech', v),
      setMusic: ([v]) => this.#volume('music', v),
      saveGame: () => this.#leave(() => this.#deps.actions.saveGame(), this.view.saveEnabled),
      loadGame: () => this.#leave(() => this.#deps.actions.loadGame()),
      mainMenu: () => void this.#mainMenu(),
      done: () => this.#leave(() => this.#deps.actions.done()),
    });
    this.view = view;
    this.#deps = deps;
    this.#sessionBlood = deps.sessionBloodAndGore;
    this.view.saveEnabled = deps.origin !== 'mainMenu' && deps.canSave && !deps.deadIsDead;
    this.refresh();
  }

  refresh(): void {
    const settings = this.#deps.settings.current();
    this.view.toggles = OPTION_TOGGLES.map((toggle, i) => ({
      on: i === BLOOD_AND_GORE && this.#sessionBlood !== null ? this.#sessionBlood : toggleValue(settings, toggle),
      highlighted: i === this.#highlighted,
    }));
    this.view.effects = settings.volumes.effects;
    this.view.speech = settings.volumes.speech;
    this.view.music = settings.volumes.music;
  }

  #play(sample: string): void {
    this.#deps.sounds.play({ sample, volume: BTN_VOLUME });
  }

  #highlight(index: number): void {
    this.#highlighted = index;
    this.view.toggles.forEach((row, i) => {
      row.highlighted = i === index;
    });
  }

  #hover(index: number, on: boolean): void {
    if (on) this.#highlight(index);
    else if (this.#highlighted === index) this.#highlight(NO_HIGHLIGHT);
  }

  async toggle(index: number): Promise<void> {
    const toggle = OPTION_TOGGLES[index];
    const row = this.view.toggles[index];
    if (!toggle || !row) return;
    const on = !row.on;
    if (!speechOrSubtitlesKept(this.#deps.settings.current(), 'top' in toggle ? toggle.top : '', on)) {
      this.refresh();
      await this.#deps.boxes.alert(this.#deps.text.string(OPTIONS_TEXT, NEED_SPEECH_OR_SUBTITLES) ?? '');
      return;
    }
    if (index === BLOOD_AND_GORE && this.#sessionBlood !== null) {
      this.#sessionBlood = on;
      this.#deps.setSessionBloodAndGore?.(on);
    } else this.#deps.settings.change(toggleChange(toggle, on));
    this.refresh();
  }

  #volume(key: 'effects' | 'speech' | 'music', value: number | undefined): void {
    if (value === undefined) return;
    this.#deps.settings.change({ volumes: { [key]: value } });
    this.view[key] = value;
    if (key === 'effects') this.#effectsMovedAt = this.#now;
    if (key === 'speech') this.#speechMovedAt = this.#now;
  }

  update(now: number): void {
    this.#now = now;
    if (this.#effectsMovedAt !== null && now - this.#effectsMovedAt > SLIDER_SOUND_DELAY_MS) {
      this.#effectsMovedAt = null;
      this.#deps.sounds.play({ file: EFFECTS_TEST_SAMPLE, volume: HIGH_VOLUME });
    }
    if (this.#speechMovedAt !== null && now - this.#speechMovedAt > SLIDER_SOUND_DELAY_MS) {
      this.#speechMovedAt = null;
      this.#deps.sounds.play({ file: SPEECH_TEST_SAMPLE, volume: HIGH_VOLUME, speech: true });
    }
  }

  #leave(go: () => void, allowed = true): void {
    if (!allowed || this.#leaving) return;
    this.#leaving = true;
    go();
  }

  async #mainMenu(): Promise<void> {
    if (this.#leaving) return;
    const yes = await this.#deps.boxes.confirm(this.#deps.text.string(OPTIONS_TEXT, RETURN_TO_MAIN) ?? '');
    if (yes) this.#leave(() => this.#deps.actions.quitToMainMenu());
  }
}

export function optionsScreen(
  env: FrontEndEnvironment,
  controller: OptionsController,
  deps: Pick<OptionsDeps, 'settings' | 'origin'>,
): FrontEndScreen {
  return new FrontEndScreen(env, {
    id: OPTIONS_SCREEN,
    layout: FrontEndLayout.OPTIONS,
    controller,
    soundScreen: UiScreenKind.OPTIONS,
    onUpdate: (now) => controller.update(now),
    onEnter: () => {
      if (deps.origin === 'game') env.runtime.pauseGame(true);
    },
    onExit: () => {
      deps.settings.persist();
      if (deps.origin === 'game') env.runtime.pauseGame(false);
    },
  });
}

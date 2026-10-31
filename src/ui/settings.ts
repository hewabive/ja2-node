// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-18. See LICENSE (SFI-SCLA).
// @src src/game/GameSettings.cc InitGameSettings (the TOPTION defaults, volumes 63, sizes of the cover and LOS displays,
// @src bLastSavedGameSlot -1), LoadGameSettings (speech or subtitles always on, a bLastSavedGameSlot below 0 read as -1);
// @src src/game/Options_Screen.cc HandleOptionToggle (speech and subtitles cannot both be off); src/game/HelpScreen.h
// @src HelpScreenID (the help mask bits); GameSettings.h GAME_SETTINGS; Tactical/DisplayCover.cc DC__MIN_SIZE,
// @src DC__MAX_SIZE.

import { UI_LANGUAGES, type UiLanguage } from '../content/text/data-version.ts';
import { AUTO_UI_SCALE, MAX_UI_SCALE } from './resolution.ts';

export const SETTINGS_KEY = 'ja2-node:settings';
export const SETTINGS_VERSION = 2;
const PREVIOUS_VERSIONS: readonly number[] = [1];
export const MAX_SETTING_VOLUME = 127;
const DEFAULT_CATEGORY_VOLUME = 63;
export const MIN_DISPLAY_SIZE = 4;
export const MAX_DISPLAY_SIZE = 11;
export const PLAYBACK_SPEEDS: readonly number[] = [0.25, 0.5, 1, 2, 4, 8, 16];
const DEFAULT_PLAYBACK_SPEED = 1;
const MEANWHILE_SCENE_BITS = 32;
export const DEFAULT_WEBSITE_LOADING_TIME_SCALE = 1;
export const MAX_WEBSITE_LOADING_TIME_SCALE = 10;
const HELP_SCREEN_BITS = 16;
export const NO_SAVED_GAME_SLOT = -1;
const INT8_MAX = 127;
const MAX_HELP_CAMPAIGNS = 32;

export interface VolumeSettings {
  readonly effects: number;
  readonly speech: number;
  readonly music: number;
  readonly ambient: number;
  readonly master: number;
}

export interface DisplaySettings {
  readonly animateSmoke: boolean;
  readonly dontMoveMouse: boolean;
  readonly oldSelectionMethod: boolean;
  readonly alwaysShowMovementPath: boolean;
  readonly showMisses: boolean;
  readonly rtConfirm: boolean;
  readonly useMetricSystem: boolean;
  readonly mercAlwaysLightUp: boolean;
  readonly smartCursor: boolean;
  readonly snapCursorToDoor: boolean;
  readonly glowItems: boolean;
  readonly treeTops: boolean;
  readonly wireframe: boolean;
  readonly cursor3d: boolean;
  readonly mercCastsLight: boolean;
  readonly hideBullets: boolean;
  readonly trackingMode: boolean;
}

export interface ClientSettings {
  readonly version: typeof SETTINGS_VERSION;
  readonly volumes: VolumeSettings;
  readonly muted: boolean;
  readonly speech: boolean;
  readonly subtitles: boolean;
  readonly keyAdvanceSpeech: boolean;
  readonly muteConfirmations: boolean;
  readonly sleepWakeNotification: boolean;
  readonly display: DisplaySettings;
  readonly playbackSpeed: number;
  readonly language: UiLanguage | null;
  readonly meanwhileScenesSeen: number;
  readonly helpHidden: boolean;
  readonly helpScreensSeen: Readonly<Record<string, number>>;
  readonly bloodAndGore: boolean;
  readonly coverSize: number;
  readonly losSize: number;
  readonly playSplash: boolean;
  readonly playIntro: boolean;
  readonly uiScale: number;
  readonly fixed640: boolean;
  readonly websiteLoadingTimeScale: number;
  readonly lastSavedGameSlot: number;
}

export const DEFAULT_DISPLAY_SETTINGS: DisplaySettings = {
  animateSmoke: true,
  dontMoveMouse: false,
  oldSelectionMethod: false,
  alwaysShowMovementPath: false,
  showMisses: false,
  rtConfirm: false,
  useMetricSystem: true,
  mercAlwaysLightUp: false,
  smartCursor: false,
  snapCursorToDoor: true,
  glowItems: true,
  treeTops: true,
  wireframe: true,
  cursor3d: false,
  mercCastsLight: true,
  hideBullets: false,
  trackingMode: true,
};

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
  keyAdvanceSpeech: false,
  muteConfirmations: false,
  sleepWakeNotification: true,
  display: DEFAULT_DISPLAY_SETTINGS,
  playbackSpeed: DEFAULT_PLAYBACK_SPEED,
  language: null,
  meanwhileScenesSeen: 0,
  helpHidden: false,
  helpScreensSeen: {},
  bloodAndGore: true,
  coverSize: MIN_DISPLAY_SIZE,
  losSize: MIN_DISPLAY_SIZE,
  playSplash: true,
  playIntro: true,
  uiScale: AUTO_UI_SCALE,
  fixed640: false,
  websiteLoadingTimeScale: DEFAULT_WEBSITE_LOADING_TIME_SCALE,
  lastSavedGameSlot: NO_SAVED_GAME_SLOT,
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

function displaySize(value: unknown, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return Math.min(MAX_DISPLAY_SIZE, Math.max(MIN_DISPLAY_SIZE, Math.round(value)));
}

function playbackSpeed(value: unknown): number {
  return typeof value === 'number' && PLAYBACK_SPEEDS.includes(value) ? value : DEFAULT_PLAYBACK_SPEED;
}

function uiScale(value: unknown): number {
  return typeof value === 'number' && Number.isInteger(value) && value >= AUTO_UI_SCALE && value <= MAX_UI_SCALE ? value : AUTO_UI_SCALE;
}

function loadingTimeScale(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= MAX_WEBSITE_LOADING_TIME_SCALE
    ? value
    : DEFAULT_WEBSITE_LOADING_TIME_SCALE;
}

function savedGameSlot(value: unknown): number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= INT8_MAX ? value : NO_SAVED_GAME_SLOT;
}

function language(value: unknown): UiLanguage | null {
  return UI_LANGUAGES.includes(value as UiLanguage) ? (value as UiLanguage) : null;
}

function sceneFlags(value: unknown): number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value < 2 ** MEANWHILE_SCENE_BITS ? value : 0;
}

function helpMask(value: unknown): number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value < 2 ** HELP_SCREEN_BITS ? value : 0;
}

function helpScreens(value: unknown): Readonly<Record<string, number>> {
  const entries = Object.entries(record(value))
    .map(([campaign, mask]) => [campaign, helpMask(mask)] as const)
    .filter(([campaign, mask]) => campaign.length > 0 && mask !== 0);
  return Object.fromEntries(entries.slice(-MAX_HELP_CAMPAIGNS));
}

function record(value: unknown): Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function display(raw: unknown): DisplaySettings {
  const o = record(raw);
  const d = DEFAULT_DISPLAY_SETTINGS;
  const out: Record<string, boolean> = {};
  for (const key of Object.keys(d) as (keyof DisplaySettings)[]) out[key] = flag(o[key], d[key]);
  return out as unknown as DisplaySettings;
}

function knownVersion(version: unknown): boolean {
  return version === undefined || version === SETTINGS_VERSION || PREVIOUS_VERSIONS.includes(version as number);
}

export function normalizeSettings(raw: unknown): ClientSettings {
  const o = record(raw);
  if (!knownVersion(o.version)) return DEFAULT_SETTINGS;
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
    keyAdvanceSpeech: flag(o.keyAdvanceSpeech, d.keyAdvanceSpeech),
    muteConfirmations: flag(o.muteConfirmations, d.muteConfirmations),
    sleepWakeNotification: flag(o.sleepWakeNotification, d.sleepWakeNotification),
    display: display(o.display),
    playbackSpeed: playbackSpeed(o.playbackSpeed),
    language: language(o.language),
    meanwhileScenesSeen: sceneFlags(o.meanwhileScenesSeen),
    helpHidden: flag(o.helpHidden, d.helpHidden),
    helpScreensSeen: helpScreens(o.helpScreensSeen),
    bloodAndGore: flag(o.bloodAndGore, d.bloodAndGore),
    coverSize: displaySize(o.coverSize, d.coverSize),
    losSize: displaySize(o.losSize, d.losSize),
    playSplash: flag(o.playSplash, d.playSplash),
    playIntro: flag(o.playIntro, d.playIntro),
    uiScale: uiScale(o.uiScale),
    fixed640: flag(o.fixed640, d.fixed640),
    websiteLoadingTimeScale: loadingTimeScale(o.websiteLoadingTimeScale),
    lastSavedGameSlot: savedGameSlot(o.lastSavedGameSlot),
  };
}

export function readSettings(storage: SettingsStorage | null): ClientSettings {
  try {
    const text = storage?.getItem(SETTINGS_KEY);
    return text ? normalizeSettings(JSON.parse(text)) : DEFAULT_SETTINGS;
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export function writeSettings(settings: ClientSettings, storage: SettingsStorage | null): boolean {
  try {
    storage?.setItem(SETTINGS_KEY, JSON.stringify(normalizeSettings(settings)));
    return storage !== null;
  } catch {
    return false;
  }
}

export type SettingsChange = Partial<Omit<ClientSettings, 'version' | 'volumes' | 'display'>> & {
  volumes?: Partial<VolumeSettings>;
  display?: Partial<DisplaySettings>;
};

export function updateSettings(settings: ClientSettings, change: SettingsChange): ClientSettings {
  return normalizeSettings({
    ...settings,
    ...change,
    volumes: { ...settings.volumes, ...change.volumes },
    display: { ...settings.display, ...change.display },
  });
}

export function markMeanwhileSceneSeen(settings: ClientSettings, scene: number): ClientSettings {
  if (!Number.isInteger(scene) || scene < 0 || scene >= MEANWHILE_SCENE_BITS) return settings;
  return updateSettings(settings, { meanwhileScenesSeen: (settings.meanwhileScenesSeen | (1 << scene)) >>> 0 });
}

export function meanwhileSceneSeen(settings: ClientSettings, scene: number): boolean {
  return scene >= 0 && scene < MEANWHILE_SCENE_BITS && ((settings.meanwhileScenesSeen >>> scene) & 1) === 1;
}

export function effectiveMaster(settings: ClientSettings): number {
  return settings.muted ? 0 : settings.volumes.master;
}

export function markHelpScreenSeen(settings: ClientSettings, campaign: string, screen: number): ClientSettings {
  if (!Number.isInteger(screen) || screen < 0 || screen >= HELP_SCREEN_BITS || campaign.length === 0) return settings;
  const { [campaign]: previous = 0, ...others } = settings.helpScreensSeen;
  return updateSettings(settings, { helpScreensSeen: { ...others, [campaign]: previous | (1 << screen) } });
}

export function helpScreenSeen(settings: ClientSettings, campaign: string, screen: number): boolean {
  return screen >= 0 && screen < HELP_SCREEN_BITS && (((settings.helpScreensSeen[campaign] ?? 0) >>> screen) & 1) === 1;
}

export type SpeechOrSubtitles = 'speech' | 'subtitles';

export function speechOrSubtitlesKept(settings: Pick<ClientSettings, SpeechOrSubtitles>, flag: string, on: boolean): boolean {
  if (on || (flag !== 'speech' && flag !== 'subtitles')) return true;
  return settings[flag === 'speech' ? 'subtitles' : 'speech'];
}

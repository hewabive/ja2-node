import type { UiLanguage } from '../../content/text/data-version.ts';
import { printf } from './printf.ts';
import {
  DEAD_IS_DEAD_TAB,
  FINANCE_HEADER_BALANCE,
  GameInitText,
  MERC_ACCOUNT_MERC,
  MessageString,
  OptionsText,
  OptionToggle,
  SaveLoadText,
  STR_LATE_14,
  STR_PB_MERCS,
  STR_PB_NOTAPPLICABLE_ABBREVIATION,
  STR_PB_SECTOR,
  TCTL_MSG_IRON_MAN_CANT_SAVE_NOW,
  UpdateBoxReason,
} from './string-ids.ts';

export interface OriginalLabel {
  readonly table: string;
  readonly index: number | null;
}

export interface OwnLabel {
  readonly eng: string;
  readonly rus: string;
}

export type LabelSource = OriginalLabel | OwnLabel;
export type StringTables = Readonly<Record<string, string | readonly string[]>>;

const original = (table: string, index: number | null = null): OriginalLabel => ({ table, index });
const own = (eng: string, rus: string): OwnLabel => ({ eng, rus });
const saveLoad = (index: number) => original('zSaveLoadText', index);
const gameInit = (index: number) => original('gzGIOScreenText', index);
const toggle = (index: number) => original('zOptionsToggleText', index);
const message = (index: number) => original('pMessageStrings', index);

export const LABELS = {
  saveGame: saveLoad(SaveLoadText.SAVE_GAME),
  loadGame: saveLoad(SaveLoadText.LOAD_GAME),
  cancel: saveLoad(SaveLoadText.CANCEL),
  saveSelected: saveLoad(SaveLoadText.SAVE_SELECTED),
  loadSelected: saveLoad(SaveLoadText.LOAD_SELECTED),
  saveOk: saveLoad(SaveLoadText.SAVE_GAME_OK),
  saveError: saveLoad(SaveLoadText.SAVE_GAME_ERROR),
  loadOk: saveLoad(SaveLoadText.LOAD_GAME_OK),
  loadError: saveLoad(SaveLoadText.LOAD_GAME_ERROR),
  gameVersionDiffers: saveLoad(SaveLoadText.GAME_VERSION_DIF),
  confirmDelete: saveLoad(SaveLoadText.CONFIRM_DELETE),
  savedGameIssue: saveLoad(SaveLoadText.SAVED_GAME_ISSUE),
  continueAnyway: saveLoad(SaveLoadText.SAVED_GAME_CONTINUE_ANYWAYS),
  confirmOverwrite: saveLoad(SaveLoadText.CONFIRM_SAVE),
  saving: saveLoad(SaveLoadText.SAVING_GAME_MESSAGE),
  normalGuns: saveLoad(SaveLoadText.NORMAL_GUNS),
  tonsOfGuns: saveLoad(SaveLoadText.ADDITIONAL_GUNS),
  realisticStyle: saveLoad(SaveLoadText.REALISTIC),
  sciFiStyle: saveLoad(SaveLoadText.SCIFI),
  difficultySuffix: saveLoad(SaveLoadText.DIFF),
  initialSettings: gameInit(GameInitText.INITIAL_GAME_SETTINGS),
  gameStyle: gameInit(GameInitText.GAME_STYLE),
  realistic: gameInit(GameInitText.REALISTIC),
  sciFi: gameInit(GameInitText.SCI_FI),
  gunOptions: gameInit(GameInitText.GUN_OPTIONS),
  gunNut: gameInit(GameInitText.GUN_NUT),
  reducedGuns: gameInit(GameInitText.REDUCED_GUNS),
  difficultyLevel: gameInit(GameInitText.DIF_LEVEL),
  easy: gameInit(GameInitText.EASY),
  medium: gameInit(GameInitText.MEDIUM),
  hard: gameInit(GameInitText.HARD),
  startGame: gameInit(GameInitText.OK),
  saveStyle: gameInit(GameInitText.GAME_SAVE_STYLE),
  saveAnywhere: gameInit(GameInitText.SAVE_ANYWHERE),
  ironMan: gameInit(GameInitText.IRON_MAN),
  deadIsDead: gameInit(GameInitText.DEAD_IS_DEAD),
  deadIsDeadHint: original('str_dead_is_dead_mode_enter_name'),
  deadIsDeadMark: original('gs_dead_is_dead_mode_tab_name', DEAD_IS_DEAD_TAB),
  effectsVolume: original('zOptionsText', OptionsText.SOUND_FX),
  speechVolume: original('zOptionsText', OptionsText.SPEECH),
  musicVolume: original('zOptionsText', OptionsText.MUSIC),
  needSpeechOrSubtitles: original('zOptionsText', OptionsText.NEED_AT_LEAST_SPEECH_OR_SUBTITLE_OPTION_ON),
  speech: toggle(OptionToggle.SPEECH),
  muteConfirmations: toggle(OptionToggle.MUTE_CONFIRMATIONS),
  subtitles: toggle(OptionToggle.SUBTITLES),
  keyAdvanceSpeech: toggle(OptionToggle.KEY_ADVANCE_SPEECH),
  bloodAndGore: toggle(OptionToggle.BLOOD_N_GORE),
  sleepWakeNotification: toggle(OptionToggle.SLEEPWAKE_NOTIFICATION),
  ok: message(MessageString.OK),
  yes: message(MessageString.YES),
  no: message(MessageString.NO),
  gameSaved: message(MessageString.SAVE_SUCCESS),
  day: message(MessageString.DAY),
  mercs: message(MessageString.MERCS),
  merc: original('MercAccountText', MERC_ACCOUNT_MERC),
  notApplicable: original('gpStrategicString', STR_PB_NOTAPPLICABLE_ABBREVIATION),
  noSector: original('gzLateLocalizedString', STR_LATE_14),
  sectorColumn: original('gpStrategicString', STR_PB_SECTOR),
  mercsColumn: original('gpStrategicString', STR_PB_MERCS),
  balanceColumn: original('pFinanceHeaders', FINANCE_HEADER_BALANCE),
  ironManCannotSave: original('zNewTacticalMessages', TCTL_MSG_IRON_MAN_CANT_SAVE_NOW),
  mercsAsleep: original('pUpdateMercStrings', UpdateBoxReason.ASLEEP_GOING_AUTO),
  mercsAwake: original('pUpdateMercStrings', UpdateBoxReason.ASSIGNMENT_RETURNING),
  tagline: own('A non-commercial reimplementation of Jagged Alliance 2', 'Некоммерческая реимплементация Jagged Alliance 2'),
  data: own('Data', 'Данные'),
  originalData: own('original game data', 'данные оригинальной игры'),
  stubData: own('stub pack', 'набор заглушек'),
  dataVersion: own('data version', 'версия данных'),
  language: own('Display language', 'Язык интерфейса'),
  serverDefault: own('server default', 'по умолчанию сервера'),
  newCampaign: own('New campaign', 'Новая кампания'),
  deadIsDeadName: own('Dead is Dead save name', 'Имя сохранения Dead is Dead'),
  squad: own('Squad', 'Отряд'),
  defaultSquad: own('default squad', 'отряд по умолчанию'),
  hireInLaptop: own('hire in the laptop', 'нанять в ноутбуке'),
  landAtOnce: own('fly in at once', 'сразу высадиться'),
  openPage: own('Then open', 'Затем открыть'),
  strategicPage: own('strategic map', 'стратегическую карту'),
  tacticalPage: own('tactical view', 'тактический экран'),
  savedGames: own('Saved games', 'Сохранённые игры'),
  session: own('Session', 'Сессия'),
  newSession: own('a new session', 'новую сессию'),
  loadInto: own('Load into', 'Загрузить в'),
  description: own('Description', 'Описание'),
  saveAsNew: own('Save as new', 'Сохранить как новую'),
  delete: own('Delete', 'Удалить'),
  download: own('Download', 'Скачать'),
  upload: own('Upload', 'Загрузить файл'),
  importNative: own('Import', 'Импортировать'),
  nativeSave: own('native save of the original', 'сохранение оригинальной игры'),
  dataVersionDiffers: own(
    'The save was made with another data version or other text, so a replay may differ.',
    'Сохранение сделано с другой версией данных или другим текстом, повтор может отличаться.',
  ),
  noSaves: own('No saved games.', 'Сохранённых игр нет.'),
  settings: own('Settings', 'Настройки'),
  ambientVolume: own('Ambient', 'Окружение'),
  masterVolume: own('Master', 'Общая громкость'),
  mute: own('Mute', 'Без звука'),
  playbackSpeed: own('Playback speed', 'Скорость воспроизведения'),
  playSplash: own('Play the splash at start', 'Заставка при запуске'),
  playIntro: own('Play the intro of a new campaign', 'Вступление новой кампании'),
  exportSettings: own('Export settings', 'Экспорт настроек'),
  importSettings: own('Import settings', 'Импорт настроек'),
  settingsImported: own('Settings imported.', 'Настройки импортированы.'),
  notSettingsFile: own('This is not a ja2-node settings file.', 'Это не файл настроек ja2-node.'),
  media: own('Video and credits', 'Видео и титры'),
  splash: own('Splash', 'Заставка'),
  intro: own('Intro', 'Вступление'),
  credits: own('Credits', 'Титры'),
  clickToStart: own('Click to start', 'Щёлкните, чтобы начать'),
  sessions: own('Running sessions', 'Запущенные сессии'),
  developerPages: own('Developer pages', 'Страницы разработчика'),
  starting: own('Starting the campaign…', 'Запуск кампании…'),
  quickSave: own('quick save', 'быстрое сохранение'),
  quickLoad: own('quick load', 'быстрая загрузка'),
  noQuickSave: own('There is no quick save.', 'Быстрого сохранения нет.'),
} as const satisfies Record<string, LabelSource>;

export type LabelId = keyof typeof LABELS;

function isOriginal(source: LabelSource): source is OriginalLabel {
  return 'table' in source;
}

function ownText(label: OwnLabel, language: UiLanguage): string {
  return language === 'rus' ? label.rus : label.eng;
}

export function originalText(tables: StringTables | null, label: OriginalLabel): string | null {
  const value = tables?.[label.table];
  if (value === undefined) return null;
  if (label.index === null) return typeof value === 'string' ? value : null;
  if (typeof value === 'string') return null;
  return value[label.index] ?? null;
}

export class Labels {
  readonly language: UiLanguage;
  readonly #tables: StringTables | null;

  constructor(language: UiLanguage, tables: StringTables | null) {
    this.language = language;
    this.#tables = tables;
  }

  get loaded(): boolean {
    return this.#tables !== null;
  }

  text(id: LabelId): string {
    const source: LabelSource = LABELS[id];
    if (!isOriginal(source)) return ownText(source, this.language);
    return originalText(this.#tables, source) ?? id;
  }

  format(id: LabelId, ...args: readonly (string | number)[]): string {
    return printf(this.text(id), args);
  }
}

interface StringsBody {
  readonly language?: UiLanguage;
  readonly tables?: StringTables;
}

export async function fetchLabels(language: UiLanguage | null, fallback: UiLanguage = 'eng'): Promise<Labels> {
  try {
    const res = await fetch(language ? `/api/strings?lang=${encodeURIComponent(language)}` : '/api/strings');
    if (!res.ok) return new Labels(language ?? fallback, null);
    const body = (await res.json()) as StringsBody;
    return new Labels(body.language ?? language ?? fallback, body.tables ?? null);
  } catch {
    return new Labels(language ?? fallback, null);
  }
}

import { UI_LANGUAGES, type UiLanguage } from '../../content/text/data-version.ts';
import { u32 } from '../../core/int.ts';
import type { Health } from '../../ui/client/api-types.ts';
import { playUrl } from '../../ui/client/campaign-form.ts';
import { type ClientSettings, type SettingsChange, updateSettings } from '../../ui/settings.ts';
import { LABELS, type LabelId, Labels } from '../../ui/text/labels.ts';
import { fetchInstallation, handOverMeanwhileScenesSeen } from '../net/installation.ts';
import { handOverSeenMeanwhileScenes, loadSettings, pendingMeanwhileScenesSeen, saveSettings } from '../settings.ts';
import { fetchHealth } from './api.ts';
import { fetchLabels } from './labels.ts';
import { MessageBox } from './message-box.ts';
import { SavePanel, type SavePanelHook } from './save-panel.ts';
import { SettingsPanel } from './settings-panel.ts';

interface LauncherHook {
  ready: boolean;
  language: UiLanguage | null;
  message: string;
  error: string | null;
  saves: SavePanelHook | null;
}

declare global {
  interface Window {
    __ja2Launcher: LauncherHook;
  }
}

const LANGUAGE_NAMES: Readonly<Record<UiLanguage, string>> = {
  chs: '简体中文',
  dut: 'Nederlands',
  eng: 'English',
  fr: 'Français',
  ger: 'Deutsch',
  it: 'Italiano',
  pl: 'Polski',
  rus: 'Русский',
};
const DOCUMENT_LANGUAGE: Readonly<Record<UiLanguage, string>> = {
  chs: 'zh',
  dut: 'nl',
  eng: 'en',
  fr: 'fr',
  ger: 'de',
  it: 'it',
  pl: 'pl',
  rus: 'ru',
};

const hook: LauncherHook = {
  ready: false,
  language: null,
  message: '',
  error: null,
  saves: null,
};
window.__ja2Launcher = hook;

function element<T extends HTMLElement>(id: string): T {
  const found = document.getElementById(id);
  if (!found) throw new Error(`missing #${id}`);
  return found as T;
}

const statusEl = element('status');
const languageSelect = element<HTMLSelectElement>('language');
let settings: ClientSettings = loadSettings();
let health: Health | null = null;
let labels = new Labels(settings.language ?? 'eng', null);
const box = new MessageBox(() => labels);

function status(text: string, error = false): void {
  statusEl.textContent = text;
  statusEl.classList.toggle('error', error);
  hook.message = text;
  if (error) hook.error = text;
}

function changeSettings(change: SettingsChange): void {
  replaceSettings(updateSettings(settings, change));
}

function replaceSettings(next: ClientSettings): void {
  const languageChanged = next.language !== settings.language;
  settings = next;
  saveSettings(settings);
  settingsPanel.render();
  if (languageChanged) void reloadLabels();
}

async function meanwhileScenesSeen(): Promise<number> {
  const installation = await fetchInstallation().catch(() => null);
  return u32((installation?.meanwhileScenesSeen ?? 0) | pendingMeanwhileScenesSeen());
}

const settingsPanel = new SettingsPanel({
  settings: () => settings,
  change: changeSettings,
  replace: replaceSettings,
  meanwhileScenesSeen,
  handOver: (imported) => handOverSeenMeanwhileScenes(handOverMeanwhileScenesSeen, imported),
  labels: () => labels,
  box,
  status,
});
const savePanel = new SavePanel({
  labels: () => labels,
  health: () => health,
  language: () => settings.language,
  box,
  status,
  loadTarget: () => ({ kind: 'newSession' }),
  loaded: (session) => location.assign(playUrl(session)),
});
hook.saves = savePanel.hook;

function isLabelId(value: string | undefined): value is LabelId {
  return value !== undefined && Object.hasOwn(LABELS, value);
}

function applyLabels(): void {
  for (const el of document.querySelectorAll<HTMLElement>('[data-label]')) {
    const id = el.dataset.label;
    if (isLabelId(id)) el.textContent = labels.text(id);
  }
  document.documentElement.lang = DOCUMENT_LANGUAGE[labels.language];
}

function renderDataInfo(): void {
  if (!health) return;
  const source = health.data.original ? `${labels.text('originalData')} (${health.data.slf} SLF)` : labels.text('stubData');
  element('dataInfo').textContent = `${labels.text('data')}: ${source} · ${labels.text('dataVersion')}: ${health.dataVersion}`;
}

function languageOption(value: string, text: string): HTMLOptionElement {
  const o = document.createElement('option');
  o.value = value;
  o.textContent = text;
  o.selected = value === (settings.language ?? '');
  return o;
}

function renderLanguages(): void {
  const serverDefault = `${labels.text('serverDefault')} (${health ? LANGUAGE_NAMES[health.language] : '?'})`;
  languageSelect.replaceChildren(
    languageOption('', serverDefault),
    ...UI_LANGUAGES.map((language) => languageOption(language, LANGUAGE_NAMES[language])),
  );
}

function renderAll(): void {
  applyLabels();
  renderDataInfo();
  renderLanguages();
  savePanel.render();
  settingsPanel.render();
  hook.language = labels.language;
}

async function reloadLabels(): Promise<void> {
  labels = await fetchLabels(settings.language ?? health?.language ?? null);
  renderAll();
}

languageSelect.addEventListener('change', () => {
  const value = languageSelect.value;
  changeSettings({ language: UI_LANGUAGES.includes(value as UiLanguage) ? (value as UiLanguage) : null });
});

async function start(): Promise<void> {
  try {
    health = await fetchHealth();
  } catch (err) {
    status((err as Error).message, true);
  }
  await reloadLabels();
  await savePanel.refresh();
  await handOverSeenMeanwhileScenes(handOverMeanwhileScenesSeen);
  hook.ready = true;
}

void start();

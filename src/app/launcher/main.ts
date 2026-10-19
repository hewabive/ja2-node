import { AudioEngine } from '../../audio/engine.ts';
import { UI_LANGUAGES, type UiLanguage } from '../../content/text/data-version.ts';
import type { Health, SessionSummary } from '../../ui/client/api-types.ts';
import { type CampaignProblem, campaignRequest, pageUrl, type StartPage } from '../../ui/client/campaign-form.ts';
import { type ClientSettings, effectiveMaster, type SettingsChange, updateSettings } from '../../ui/settings.ts';
import { LABELS, type LabelId, Labels } from '../../ui/text/labels.ts';
import { type CreditsMonitor, createCreditsMonitor, playCredits } from '../credits/scroller.ts';
import { readVfsFileOrNull } from '../net/vfs.ts';
import { loadSettings, saveSettings } from '../settings.ts';
import { createSequenceMonitor, playSequence, type SequenceMonitor } from '../video/sequence-player.ts';
import { beginningPlan, type SequencePlan, sequenceEnabled, splashPlan } from '../video/sequences.ts';
import { engineSound } from '../video/sound.ts';
import { createSession, fetchHealth } from './api.ts';
import { CampaignPanel } from './campaign-panel.ts';
import { fetchLabels } from './labels.ts';
import { MessageBox } from './message-box.ts';
import { SavePanel, type SavePanelHook } from './save-panel.ts';
import { SettingsPanel } from './settings-panel.ts';

type SplashState = 'pending' | 'off' | 'waiting' | 'playing' | 'done';

interface LauncherHook {
  ready: boolean;
  splash: SplashState;
  language: UiLanguage | null;
  busy: boolean;
  campaign: string | null;
  message: string;
  error: string | null;
  video: SequenceMonitor;
  credits: CreditsMonitor;
  saves: SavePanelHook | null;
}

declare global {
  interface Window {
    __ja2Launcher: LauncherHook;
  }
}

const SPLASH_SHOWN_KEY = 'ja2-node:splashShown';
const SEED_PARAM = 'seed';
const SESSION_PARAM = 'session';
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
const PROBLEM_LABELS: Readonly<Record<CampaignProblem, LabelId>> = { deadIsDeadName: 'deadIsDeadName', squadSize: 'squad' };

const hook: LauncherHook = {
  ready: false,
  splash: 'pending',
  language: null,
  busy: false,
  campaign: null,
  message: '',
  error: null,
  video: createSequenceMonitor(),
  credits: createCreditsMonitor(),
  saves: null,
};
window.__ja2Launcher = hook;

function element<T extends HTMLElement>(id: string): T {
  const found = document.getElementById(id);
  if (!found) throw new Error(`missing #${id}`);
  return found as T;
}

function splashShownThisTab(): boolean {
  try {
    return sessionStorage.getItem(SPLASH_SHOWN_KEY) === '1';
  } catch {
    return false;
  }
}

function markSplashShown(): void {
  try {
    sessionStorage.setItem(SPLASH_SHOWN_KEY, '1');
  } catch {}
}

const params = new URLSearchParams(location.search);
const statusEl = element('status');
const languageSelect = element<HTMLSelectElement>('language');
const startOverlay = element('start');
let settings: ClientSettings = loadSettings();
let health: Health | null = null;
let labels = new Labels(settings.language ?? 'eng', null);
let sessions: readonly SessionSummary[] = [];
const engine = new AudioEngine({ createGraph: () => new AudioContext(), load: readVfsFileOrNull });
const sound = engineSound(engine);
const box = new MessageBox(() => labels);

function status(text: string, error = false): void {
  statusEl.textContent = text;
  statusEl.classList.toggle('error', error);
  hook.message = text;
  if (error) hook.error = text;
}

function applyVolumes(): void {
  engine.setVolumes({ ...settings.volumes, master: effectiveMaster(settings) });
}

function changeSettings(change: SettingsChange): void {
  replaceSettings(updateSettings(settings, change));
}

function replaceSettings(next: ClientSettings): void {
  const languageChanged = next.language !== settings.language;
  settings = next;
  saveSettings(settings);
  applyVolumes();
  settingsPanel.render();
  if (languageChanged) void reloadLabels();
}

function openPage(page: StartPage, session: string): void {
  location.assign(pageUrl(page, session));
}

const campaignPanel = new CampaignPanel(() => void startCampaign());
const settingsPanel = new SettingsPanel({
  settings: () => settings,
  change: changeSettings,
  replace: replaceSettings,
  labels: () => labels,
  box,
  status,
});
const savePanel = new SavePanel(
  {
    labels: () => labels,
    health: () => health,
    language: () => settings.language,
    box,
    status,
    open: openPage,
    sessionsChanged: (list) => {
      sessions = list;
      renderSessions();
    },
  },
  params.get(SESSION_PARAM),
);
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

function pageLink(text: string, page: StartPage, session: string): HTMLAnchorElement {
  const a = document.createElement('a');
  a.textContent = text;
  a.href = pageUrl(page, session);
  return a;
}

function renderSessions(): void {
  const items = sessions.map((s) => {
    const li = document.createElement('li');
    li.dataset.session = s.session;
    const where = [s.flow, s.sector].filter(Boolean).join(' ');
    li.append(`${s.session}${where ? ` (${where})` : ''}: `);
    if (s.flow) li.append(pageLink(labels.text('strategicPage'), 'strategic', s.session));
    if (s.flow && s.map) li.append(' · ');
    if (s.map) li.append(pageLink(labels.text('tacticalPage'), 'tactical', s.session));
    return li;
  });
  element('sessionList').replaceChildren(...items);
}

function renderAll(): void {
  applyLabels();
  renderDataInfo();
  renderLanguages();
  campaignPanel.renderSizes(labels);
  savePanel.render();
  renderSessions();
  settingsPanel.render();
  hook.language = labels.language;
}

async function reloadLabels(): Promise<void> {
  labels = await fetchLabels(settings.language ?? health?.language ?? null);
  renderAll();
}

async function exclusive(task: () => Promise<unknown>): Promise<void> {
  if (hook.busy) return;
  hook.busy = true;
  try {
    await task();
  } catch (err) {
    status((err as Error).message, true);
  } finally {
    hook.busy = false;
  }
}

const playPlan = (plan: SequencePlan) => playSequence(plan, { sound, monitor: hook.video });

function seed(): number | null {
  const value = params.get(SEED_PARAM);
  return value !== null && /^\d+$/.test(value) ? Number(value) : null;
}

async function startCampaign(): Promise<void> {
  const form = campaignPanel.read();
  const request = campaignRequest(form, settings.language, seed());
  if (!request.ok) return status(`${labels.text(PROBLEM_LABELS[request.problem])}?`, true);
  engine.unlock();
  campaignPanel.busy(true);
  await exclusive(async () => {
    status(labels.text('starting'));
    const created = await createSession(request.body);
    hook.campaign = created.session;
    if (sequenceEnabled('beginning', settings)) await playPlan(beginningPlan());
    openPage(request.page, created.session);
  });
  campaignPanel.busy(false);
}

async function playSplash(): Promise<void> {
  startOverlay.hidden = true;
  engine.unlock();
  markSplashShown();
  hook.splash = 'playing';
  await exclusive(() => playPlan(splashPlan()));
  hook.splash = 'done';
}

function offerSplash(): void {
  if (!sequenceEnabled('splash', settings) || splashShownThisTab()) {
    hook.splash = 'off';
    return;
  }
  hook.splash = 'waiting';
  startOverlay.hidden = false;
  element('startButton').addEventListener('click', () => void playSplash(), { once: true });
}

element('playSplash').addEventListener('click', () => void exclusive(() => playPlan(splashPlan())));
element('playIntro').addEventListener('click', () => void exclusive(() => playPlan(beginningPlan())));
element('playCredits').addEventListener('click', () => void exclusive(() => playCredits({ monitor: hook.credits })));
languageSelect.addEventListener('change', () => {
  const value = languageSelect.value;
  changeSettings({ language: UI_LANGUAGES.includes(value as UiLanguage) ? (value as UiLanguage) : null });
});
const unlock = () => engine.unlock();
window.addEventListener('pointerdown', unlock, { capture: true });
window.addEventListener('keydown', unlock, { capture: true });
applyVolumes();

async function start(): Promise<void> {
  try {
    health = await fetchHealth();
  } catch (err) {
    status((err as Error).message, true);
  }
  await reloadLabels();
  await savePanel.refresh();
  hook.ready = true;
  offerSplash();
}

void start();

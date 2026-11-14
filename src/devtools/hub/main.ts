import { closeSession, createSession, fetchHealth, fetchSessions } from '../../app/launcher/api.ts';
import { fetchLabels } from '../../app/launcher/labels.ts';
import { MessageBox } from '../../app/launcher/message-box.ts';
import { SavePanel, type SavePanelHook } from '../../app/launcher/save-panel.ts';
import { SessionClient } from '../../app/net/session-client.ts';
import { loadSettings } from '../../app/settings.ts';
import type { UiLanguage } from '../../content/text/data-version.ts';
import type { DriverMode } from '../../protocol/messages.ts';
import type { Health, SessionSummary } from '../../ui/client/api-types.ts';
import { type CampaignProblem, campaignRequest } from '../../ui/client/campaign-form.ts';
import { Labels } from '../../ui/text/labels.ts';
import { CampaignPanel } from './campaign-panel.ts';
import { driverChoiceOf } from './drivers.ts';
import { gamePageUrl, PlayFlags } from './play-flags.ts';
import { SessionList } from './session-list.ts';
import { SessionSaves } from './session-saves.ts';

interface DevHook {
  ready: boolean;
  busy: boolean;
  message: string;
  error: string | null;
  sessions: string[];
  saves: SavePanelHook | null;
}

declare global {
  interface Window {
    __ja2Dev: DevHook;
  }
}

const SESSION_PARAM = 'session';
const SEED_PARAM = 'seed';
const PAGE_LANGUAGE: UiLanguage = 'eng';
const SHORT_COMMIT = 7;
const PROBLEM_TEXT: Readonly<Record<CampaignProblem, string>> = {
  deadIsDeadName: 'Dead is Dead save name?',
  squadSize: 'Squad size?',
};

const hook: DevHook = { ready: false, busy: false, message: '', error: null, sessions: [], saves: null };
window.__ja2Dev = hook;

function element<T extends HTMLElement>(id: string): T {
  const found = document.getElementById(id);
  if (!found) throw new Error(`missing #${id}`);
  return found as T;
}

const params = new URLSearchParams(location.search);
const statusEl = element('status');
let health: Health | null = null;
let labels = new Labels(PAGE_LANGUAGE, null);
let sessions: readonly SessionSummary[] = [];
const box = new MessageBox(() => labels);
const sessionLanguage = () => loadSettings().language;

function status(text: string, error = false): void {
  statusEl.textContent = text;
  statusEl.classList.toggle('error', error);
  hook.message = text;
  if (error) hook.error = text;
}

function busy(on: boolean): void {
  hook.busy = on;
  campaign.busy(on);
  sessionList.busy(on);
}

async function exclusive(task: () => Promise<unknown>): Promise<void> {
  if (hook.busy) return;
  busy(true);
  try {
    await task();
  } catch (err) {
    status((err as Error).message, true);
  } finally {
    busy(false);
  }
}

const flags = new PlayFlags(() => sessionList.render(sessions));
const sessionList = new SessionList({
  gameUrl: (session) => gamePageUrl(session, flags.current()),
  drive: (session, driver) => void exclusive(() => drive(session, driver)),
  runUntilIdle: (session) => void exclusive(() => runUntilIdle(session)),
  close: (session) => void exclusive(() => closeOne(session)),
});
const campaign = new CampaignPanel(
  () => void exclusive(startCampaign),
  () => void exclusive(startSandbox),
  params.get(SEED_PARAM),
);
const sessionSaves = new SessionSaves(
  {
    labels: () => labels,
    health: () => health,
    box,
    status,
    selectedRow: () => savePanel.selectedRow(),
    saved: async (name) => {
      await savePanel.refresh();
      savePanel.select(name);
    },
  },
  params.get(SESSION_PARAM),
);
const savePanel = new SavePanel({
  labels: () => labels,
  health: () => health,
  language: sessionLanguage,
  box,
  status,
  loadTarget: () => sessionSaves.loadTarget(),
  loaded: () => void refreshSessions(),
  selectionChanged: () => sessionSaves.updateButtons(),
});
hook.saves = savePanel.hook;

async function refreshSessions(): Promise<void> {
  sessions = await fetchSessions().catch(() => sessions);
  hook.sessions = sessions.map((s) => s.session);
  sessionList.render(sessions);
  sessionSaves.render(sessions);
}

function languagePart(): { readonly language?: UiLanguage } {
  const language = sessionLanguage();
  return language ? { language } : {};
}

async function startCampaign(): Promise<void> {
  const choice = campaign.read();
  const request = campaignRequest(choice.form, sessionLanguage(), choice.seed);
  if (!request.ok) return status(PROBLEM_TEXT[request.problem], true);
  status('Starting the campaign…');
  const created = await createSession(request.body);
  location.assign(gamePageUrl(created.session, flags.current()));
}

async function startSandbox(): Promise<void> {
  const choice = campaign.read();
  const created = await createSession({ ...(choice.seed !== null ? { seed: choice.seed } : {}), ...languagePart() });
  location.assign(gamePageUrl(created.session, flags.current()));
}

async function withSession<T>(session: string, task: (client: SessionClient) => Promise<T>): Promise<T> {
  const client = await SessionClient.connect(session);
  try {
    return await task(client);
  } finally {
    client.close();
  }
}

async function drive(session: string, driver: DriverMode): Promise<void> {
  await withSession(session, (client) => client.drive(driver));
  status(`${session}: ${driverChoiceOf(driver).label}.`);
  await refreshSessions();
}

async function runUntilIdle(session: string): Promise<void> {
  const report = await withSession(session, (client) => client.advance({ idle: true }));
  status(report ? `${session} ran to tick ${report.tick}: ${report.reason}.` : `${session} did not run.`, !report);
  await refreshSessions();
}

async function closeOne(session: string): Promise<void> {
  if (!(await box.confirm(`Close the session ${session}?`))) return;
  const outcome = await closeSession(session);
  status(outcome.closed ? `Closed ${session}.` : `${session} stays open: ${outcome.refused ?? 'refused'}.`, !outcome.closed);
  await refreshSessions();
}

function renderDataInfo(): void {
  if (!health) return;
  const source = health.data.original ? `original game data (${health.data.slf} SLF)` : 'stub pack';
  const engine = health.engine ? ` · engine ${health.engine.version} (${health.engine.commit.slice(0, SHORT_COMMIT)})` : '';
  element('dataInfo').textContent = `Data: ${source} · data version ${health.dataVersion}${engine}`;
}

element('refreshSessions').addEventListener('click', () => void refreshSessions());
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) void refreshSessions();
});

async function start(): Promise<void> {
  try {
    health = await fetchHealth();
  } catch (err) {
    status((err as Error).message, true);
  }
  labels = await fetchLabels(PAGE_LANGUAGE);
  renderDataInfo();
  await refreshSessions();
  await savePanel.refresh();
  hook.ready = true;
}

void start();

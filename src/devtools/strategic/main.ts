import { parseJsoncBytes } from '../../content/strategic/jsonc.ts';
import { MAP_SIDE, sectorShortString } from '../../content/strategic/sector-ids.ts';
import type { AutoresolveView, PromptView, StrategicMercView, StrategicSectorView, StrategicView } from '../../protocol/view.ts';
import { fetchFile } from '../asset-browser/api.ts';
import { SessionClient } from '../net/session-client.ts';

interface StrategicHook {
  ready: boolean;
  session: string | null;
  worldSector: string | null;
  clock: string | null;
  error: string | null;
  lastResult: string | null;
}

declare global {
  interface Window {
    __ja2Strategic: StrategicHook;
  }
}

interface SessionSummary {
  readonly session: string;
  readonly flow?: string;
  readonly sector?: string | null;
  readonly map?: string | null;
}

interface TownEntry {
  readonly townId: number;
  readonly internalName: string;
}

const debug: StrategicHook = { ready: false, session: null, worldSector: null, clock: null, error: null, lastResult: null };
window.__ja2Strategic = debug;

const TOWNS_PATH = 'externalized/strategic-map-towns.json';
const ROW_LETTERS = 'ABCDEFGHIJKLMNOP';
const ON_DUTY = 20;
const FINISH = 0;
const REALTIME_SPEED = 1;

function el<T extends HTMLElement>(id: string): T {
  const e = document.getElementById(id);
  if (!e) throw new Error(`#${id} missing`);
  return e as T;
}

const mapEl = el('map');
const mercsEl = el<HTMLTableElement>('mercs');
const groupsEl = el('groups');
const sectorTitle = el('sectorTitle');
const sectorInfo = el('sectorInfo');
const resultEl = el('result');
const statusEl = el('status');
const clockEl = el('clock');
const routeButton = el<HTMLButtonElement>('route');
const enterButton = el<HTMLButtonElement>('enter');
const tacticalLink = el<HTMLAnchorElement>('tactical');
const sessionSelect = el<HTMLSelectElement>('session');
const battleEl = el('battle');
const battleTitle = el('battleTitle');
const battleInfo = el('battleInfo');
const choicesEl = el('choices');
const cellsEl = el<HTMLTableElement>('cells');

let client: SessionClient | null = null;
let shown: StrategicView | null = null;
let shownPrompt: PromptView | null = null;
let playback = FINISH;
let lastFrameAt = performance.now();
let shownAutoresolve: AutoresolveView | null = null;
let picked: string | null = null;
let towns = new Map<number, string>();
const selectedMercs = new Set<number>();
const cells = new Map<string, HTMLButtonElement>();

function setStatus(text: string, error = false): void {
  statusEl.textContent = text;
  statusEl.classList.toggle('error', error);
}

function showResult(text: string, error = false): void {
  resultEl.textContent = text;
  resultEl.classList.toggle('error', error);
  debug.lastResult = text;
}

function townName(id: number): string {
  const name = towns.get(id);
  if (!name) return `town ${id}`;
  return name
    .split('_')
    .map((word) => word.charAt(0) + word.slice(1).toLowerCase())
    .join(' ');
}

async function loadTowns(): Promise<void> {
  try {
    const entries = parseJsoncBytes(await fetchFile(TOWNS_PATH)) as TownEntry[];
    towns = new Map(entries.map((t) => [t.townId, t.internalName]));
  } catch {
    towns = new Map();
  }
}

function buildGrid(): void {
  mapEl.replaceChildren();
  mapEl.append(axis(''));
  for (let x = 1; x <= MAP_SIDE; x++) mapEl.append(axis(String(x)));
  for (let y = 1; y <= MAP_SIDE; y++) {
    mapEl.append(axis(ROW_LETTERS[y - 1] ?? '?'));
    for (let x = 1; x <= MAP_SIDE; x++) {
      const id = sectorShortString({ x, y });
      const cell = document.createElement('button');
      cell.type = 'button';
      cell.className = 'cell';
      cell.dataset.sector = id;
      cell.addEventListener('click', () => pickSector(id));
      cells.set(id, cell);
      mapEl.append(cell);
    }
  }
}

function axis(text: string): HTMLElement {
  const a = document.createElement('div');
  a.className = 'axis';
  a.textContent = text;
  return a;
}

function badge(kind: string, text: string): HTMLElement {
  const b = document.createElement('span');
  b.className = `badge ${kind}`;
  b.textContent = text;
  return b;
}

function squadsIn(view: StrategicView, sector: string): number[] {
  const squads = new Set<number>();
  for (const m of view.mercs) if (m.sector === sector && !m.betweenSectors && m.squad !== null) squads.add(m.squad + 1);
  return [...squads].sort((a, b) => a - b);
}

function routedSectors(view: StrategicView): Set<string> {
  return new Set(view.groups.flatMap((g) => g.path));
}

function renderCell(view: StrategicView, id: string, info: StrategicSectorView | undefined, routed: Set<string>): void {
  const cell = cells.get(id);
  if (!cell) return;
  cell.className = 'cell';
  cell.classList.toggle('visited', info?.visited === true);
  cell.classList.toggle('player', info?.playerControlled === true);
  cell.classList.toggle('enemy', info?.playerControlled === false);
  cell.classList.toggle('town', (info?.town ?? 0) !== 0);
  cell.classList.toggle('world', view.worldSector === id);
  cell.classList.toggle('route', routed.has(id));
  cell.classList.toggle('picked', picked === id);
  const name = document.createElement('span');
  name.className = 'name';
  name.textContent = id;
  const town = document.createElement('span');
  town.className = 'town-name';
  town.textContent = info?.town ? townName(info.town) : '';
  const badges = document.createElement('span');
  badges.className = 'badges';
  if (info?.enemies !== null && info?.enemies !== undefined && info.enemies !== 0) badges.append(badge('enemies', String(info.enemies)));
  const militia = info?.militia.reduce((a, b) => a + b, 0) ?? 0;
  if (militia > 0) badges.append(badge('militia', String(militia)));
  for (const squad of squadsIn(view, id)) badges.append(badge('squad', `S${squad}`));
  cell.replaceChildren(name, town, badges);
  cell.title = sectorSummary(view, id, info);
}

function sectorSummary(view: StrategicView, id: string, info: StrategicSectorView | undefined): string {
  const lines = [info?.town ? `${id}, ${townName(info.town)}` : id];
  lines.push(info?.visited ? 'visited' : 'not visited');
  if (info?.playerControlled !== null && info?.playerControlled !== undefined)
    lines.push(info.playerControlled ? 'player controlled' : 'enemy controlled');
  if (info?.enemies !== null && info?.enemies !== undefined) lines.push(`enemies: ${info.enemies}`);
  if (info?.militia.some((n) => n > 0)) lines.push(`militia (green/regular/elite): ${info.militia.join('/')}`);
  const here = view.mercs.filter((m) => m.sector === id && !m.betweenSectors);
  if (here.length > 0) lines.push(`mercs: ${here.map((m) => m.name).join(', ')}`);
  return lines.join('\n');
}

function renderMercs(view: StrategicView): void {
  const header = document.createElement('tr');
  for (const h of ['', 'name', 'sector', 'squad', 'life', 'breath', 'state']) {
    const th = document.createElement('th');
    th.textContent = h;
    header.append(th);
  }
  const rows = view.mercs.map((m) => mercRow(m));
  mercsEl.replaceChildren(header, ...rows);
}

function mercRow(m: StrategicMercView): HTMLTableRowElement {
  const tr = document.createElement('tr');
  const pick = document.createElement('input');
  pick.type = 'checkbox';
  pick.checked = selectedMercs.has(m.id);
  pick.addEventListener('change', () => {
    if (pick.checked) selectedMercs.add(m.id);
    else selectedMercs.delete(m.id);
    updateActions();
  });
  const state = [
    m.asleep ? 'asleep' : '',
    m.betweenSectors ? 'travelling' : '',
    m.assignment >= ON_DUTY ? `assignment ${m.assignment}` : '',
  ]
    .filter(Boolean)
    .join(', ');
  const columns = [
    m.name,
    m.sector,
    m.squad === null ? '–' : String(m.squad + 1),
    `${m.life}/${m.lifeMax}`,
    `${m.breath}/${m.breathMax}`,
    state,
  ];
  const first = document.createElement('td');
  first.append(pick);
  tr.append(first);
  for (const text of columns) {
    const td = document.createElement('td');
    td.textContent = text;
    tr.append(td);
  }
  return tr;
}

function renderGroups(view: StrategicView): void {
  const items = view.groups.map((g) => {
    const li = document.createElement('li');
    const names = g.members.map((id) => view.mercs.find((m) => m.id === id)?.name ?? `#${id}`).join(', ');
    const eta = g.next ? `, next ${g.next} in ${g.etaMinutes} min` : '';
    const moving = g.path.length > 0 ? ` → ${g.path.join(' → ')}${eta}` : '';
    li.textContent = `group ${g.id} at ${g.sector}${g.betweenSectors ? ' (between sectors)' : ''}${moving}: ${names}`;
    return li;
  });
  groupsEl.replaceChildren(...items);
}

function renderSectorPanel(view: StrategicView): void {
  if (!picked) return;
  const info = view.sectors.find((s) => s.sector === picked);
  sectorTitle.textContent = `Sector ${picked}`;
  sectorInfo.textContent = sectorSummary(view, picked, info);
}

function render(view: StrategicView): void {
  const bySector = new Map(view.sectors.map((s) => [s.sector, s]));
  const routed = routedSectors(view);
  for (const id of cells.keys()) renderCell(view, id, bySector.get(id), routed);
  renderMercs(view);
  renderGroups(view);
  renderSectorPanel(view);
  updateActions();
  debug.worldSector = view.worldSector;
  setStatus(
    `${view.flow} · balance $${view.balance.toLocaleString('en-US')} · ${view.worldSector ? `loaded ${view.worldSector}` : 'no sector loaded'}`,
  );
}

function promptSummary(prompt: PromptView): string {
  switch (prompt.kind) {
    case 'preBattle': {
      const lines = [`${prompt.encounter} in ${prompt.sector}`, `enemies: ${prompt.enemies}, militia: ${prompt.militia}`];
      for (const m of prompt.involved) lines.push(`${m.name}: ${m.condition}, hp ${m.hp}%, bp ${m.bp}%`);
      for (const o of prompt.options.filter((o) => !o.enabled)) lines.push(`${o.choice} disabled: ${o.reason ?? 'not allowed'}`);
      return lines.join('\n');
    }
    case 'autoresolveDone':
      return `battle over: ${prompt.status}${prompt.canBandage ? ', wounded can be bandaged' : ''}`;
    case 'simultaneousArrival':
      return `${prompt.groups} groups arrive at ${prompt.sector} together`;
    case 'npcOfNote':
      return `group ${prompt.group} meets someone in ${prompt.sector}`;
    case 'surrender':
      return 'the enemy offers to take the squad prisoner';
  }
}

function promptChoices(prompt: PromptView): readonly { readonly choice: string; readonly enabled: boolean }[] {
  return prompt.kind === 'preBattle' ? prompt.options : prompt.choices.map((choice) => ({ choice, enabled: true }));
}

function choiceButton(prompt: PromptView, choice: string, enabled: boolean): HTMLButtonElement {
  const b = document.createElement('button');
  b.type = 'button';
  b.textContent = choice;
  b.disabled = !enabled;
  b.dataset.choice = choice;
  b.addEventListener('click', () => {
    void send({ type: 'answer', prompt: prompt.id, choice }).then((r) =>
      showResult(r.ok ? `answered ${choice}` : (r.reason ?? 'refused'), !r.ok),
    );
  });
  return b;
}

function retreatButton(): HTMLButtonElement {
  const b = document.createElement('button');
  b.type = 'button';
  b.textContent = 'retreat all';
  b.addEventListener('click', () => {
    void send({ type: 'autoresolveRetreat' }).then((r) => showResult(r.ok ? 'retreat ordered' : (r.reason ?? 'refused'), !r.ok));
  });
  return b;
}

function renderCells(ar: AutoresolveView | null): void {
  if (!ar) {
    cellsEl.replaceChildren();
    return;
  }
  const rows = ar.cells.map((c) => {
    const tr = document.createElement('tr');
    const condition = c.life !== undefined ? `${c.life}/${c.lifeMax}${c.bleeding ? `, bleeding ${c.bleeding}` : ''}` : (c.health ?? '');
    for (const text of [c.side, c.name ?? c.kind, c.state, condition]) {
      const td = document.createElement('td');
      td.textContent = text;
      tr.append(td);
    }
    return tr;
  });
  cellsEl.replaceChildren(...rows);
}

function renderBattle(prompt: PromptView | null, ar: AutoresolveView | null): void {
  battleEl.hidden = !prompt && !ar;
  if (battleEl.hidden) return;
  const lines: string[] = [];
  if (ar)
    lines.push(
      `autoresolve in ${ar.sector}: ${ar.status}, ${ar.battleSeconds} s`,
      `alive: ${ar.alive.mercs} mercs, ${ar.alive.militia} militia, ${ar.alive.enemies} enemies`,
    );
  if (prompt) lines.push(promptSummary(prompt));
  battleTitle.textContent = prompt ? `Decision: ${prompt.kind}` : 'Autoresolve';
  battleInfo.textContent = lines.join('\n');
  const buttons = prompt ? promptChoices(prompt).map((o) => choiceButton(prompt, o.choice, o.enabled)) : [];
  if (ar && !prompt) buttons.push(retreatButton());
  choicesEl.replaceChildren(...buttons);
  renderCells(ar);
}

function renderClock(): void {
  const c = client?.clock;
  if (!c) return;
  const text = `Day ${c.day}, ${String(c.hour).padStart(2, '0')}:${String(c.minute).padStart(2, '0')}${c.compressing ? ' ⏩' : ''}`;
  if (clockEl.textContent !== text) clockEl.textContent = text;
  debug.clock = text;
}

function updateActions(): void {
  routeButton.disabled = !picked || selectedMercs.size === 0;
  enterButton.disabled = !picked;
}

function pickSector(id: string): void {
  picked = id;
  if (shown) render(shown);
}

async function send(cmd: { type: string; [key: string]: unknown }): Promise<{ ok: boolean; reason?: string }> {
  if (!client) return { ok: false, reason: 'not connected' };
  return client.command(cmd);
}

function oneMercPerSquad(view: StrategicView | null, ids: Iterable<number>): number[] {
  const leaders = new Map<string, number>();
  for (const id of ids) {
    const squad = view?.mercs.find((m) => m.id === id)?.squad;
    const key = squad === null || squad === undefined ? `merc ${id}` : `squad ${squad}`;
    if (!leaders.has(key)) leaders.set(key, id);
  }
  return [...leaders.values()];
}

routeButton.addEventListener('click', () => {
  const to = picked;
  if (!to) return;
  const leaders = oneMercPerSquad(shown, selectedMercs);
  void Promise.all(leaders.map((soldier) => send({ type: 'route', soldier, to }))).then((results) => {
    const refused = results.filter((r) => !r.ok);
    showResult(refused.length === 0 ? `route to ${to} plotted` : refused.map((r) => r.reason ?? 'refused').join('\n'), refused.length > 0);
  });
});

enterButton.addEventListener('click', () => {
  const sector = picked;
  if (!sector) return;
  void send({ type: 'enterSector', sector }).then((r) => showResult(r.ok ? `entered ${sector}` : (r.reason ?? 'refused'), !r.ok));
});

for (const b of document.querySelectorAll<HTMLButtonElement>('[data-compress]')) {
  b.addEventListener('click', () => {
    void send({ type: 'compressTime', mode: Number(b.dataset.compress) }).then((r) =>
      showResult(r.ok ? `compressing (${b.textContent})` : (r.reason ?? 'refused'), !r.ok),
    );
  });
}
for (const [id, label] of [
  ['mapScreen', 'map screen'],
  ['tacticalScreen', 'tactical screen'],
] as const) {
  el<HTMLButtonElement>(id).addEventListener('click', () => {
    void send({ type: id }).then((r) => showResult(r.ok ? `${label} open` : (r.reason ?? 'refused'), !r.ok));
  });
}

el<HTMLButtonElement>('stopTime').addEventListener('click', () => {
  void send({ type: 'stopTime' }).then((r) => showResult(r.ok ? 'compression stopped' : (r.reason ?? 'refused'), !r.ok));
});

for (const b of document.querySelectorAll<HTMLButtonElement>('[data-drive]')) {
  b.addEventListener('click', () => {
    for (const other of document.querySelectorAll<HTMLButtonElement>('[data-drive]')) other.classList.toggle('active', other === b);
    void client?.drive(b.dataset.drive === 'realtime' ? { mode: 'realtime', speed: REALTIME_SPEED } : { mode: 'manual' });
  });
}

el<HTMLButtonElement>('advance').addEventListener('click', () => {
  const battleRunning = client?.autoresolve !== null && client?.prompt === null;
  void client?.advance(battleRunning ? { idle: true } : { compressionStopped: true }).then((report) => {
    if (!report) return showResult('advance failed', true);
    const when = report.worldTime
      ? ` at day ${report.worldTime.day} ${report.worldTime.hour}:${String(report.worldTime.minute).padStart(2, '0')}`
      : '';
    showResult(`stopped: ${report.reason}${report.refusal ? ` (${report.refusal})` : ''}${when}`, report.reason === 'refused');
  });
});

for (const b of document.querySelectorAll<HTMLButtonElement>('[data-playback]')) {
  b.classList.toggle('active', b.dataset.playback === 'finish');
  b.addEventListener('click', () => {
    playback = b.dataset.playback === 'finish' ? FINISH : Number(b.dataset.playback);
    for (const other of document.querySelectorAll<HTMLButtonElement>('[data-playback]')) other.classList.toggle('active', other === b);
  });
}

el<HTMLButtonElement>('newCampaign').addEventListener('click', () => {
  const difficulty = Number(el<HTMLSelectElement>('difficulty').value);
  void fetch('/api/sessions', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ campaign: { difficulty } }),
  })
    .then(async (res) => {
      const body = (await res.json()) as SessionSummary & { error?: string };
      if (!res.ok || body.error) throw new Error(body.error ?? `HTTP ${res.status}`);
      location.search = `?session=${encodeURIComponent(body.session)}`;
    })
    .catch((err: Error) => showResult(err.message, true));
});

sessionSelect.addEventListener('change', () => {
  location.search = `?session=${encodeURIComponent(sessionSelect.value)}`;
});

async function loadSessions(current: string | null): Promise<void> {
  const res = await fetch('/api/sessions');
  const list = res.ok ? ((await res.json()) as SessionSummary[]) : [];
  const options = list.map((s) => {
    const o = document.createElement('option');
    o.value = s.session;
    o.textContent = s.flow ? `${s.session} (${s.flow}${s.sector ? ` ${s.sector}` : ''})` : `${s.session} (tactical only)`;
    o.selected = s.session === current;
    return o;
  });
  sessionSelect.replaceChildren(...options);
}

function frame(): void {
  requestAnimationFrame(frame);
  const now = performance.now();
  const elapsed = now - lastFrameAt;
  lastFrameAt = now;
  if (!client) return;
  if (playback === FINISH) client.skipToLatest();
  else {
    client.playbackSpeed = playback;
    client.playFor(elapsed);
  }
  renderClock();
  const view = client.strategic;
  if (view && view !== shown) {
    shown = view;
    render(view);
  }
  if (client.prompt !== shownPrompt || client.autoresolve !== shownAutoresolve) {
    shownPrompt = client.prompt;
    shownAutoresolve = client.autoresolve;
    renderBattle(shownPrompt, shownAutoresolve);
  }
}

async function start(): Promise<void> {
  const session = new URLSearchParams(location.search).get('session');
  buildGrid();
  try {
    await Promise.all([loadTowns(), loadSessions(session)]);
    client = await SessionClient.connect(session ?? undefined);
    const id = session ?? sessionSelect.value;
    debug.session = id || null;
    tacticalLink.href = `../tactical/${id ? `?session=${encodeURIComponent(id)}` : ''}`;
    for (const b of document.querySelectorAll<HTMLButtonElement>('[data-drive]'))
      b.classList.toggle('active', b.dataset.drive === client?.driver.mode);
    if (!client.strategic) setStatus('this session has no strategic layer: start a new campaign', true);
    debug.ready = true;
  } catch (err) {
    debug.error = (err as Error).message;
    setStatus((err as Error).message, true);
  }
}

requestAnimationFrame(frame);
void start();

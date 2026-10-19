import { installSaveControls } from '../../app/net/save-controls.ts';
import { SessionClient } from '../../app/net/session-client.ts';
import { SleepWakeStop } from '../../app/net/sleep-wake-stop.ts';
import { fetchVfsFile, fetchVfsList, type VfsFile } from '../../app/net/vfs.ts';
import { TacticalSound } from '../../app/sound/tactical-sound.ts';
import { AiTurnHolder } from '../../app/world/ai-turn.ts';
import { LightTemplates, MERC_LIGHT } from '../../app/world/light-templates.ts';
import { SoldierAssets } from '../../app/world/soldier-assets.ts';
import { loadSoldierFrames, type SoldierFrames } from '../../app/world/soldier-frames.ts';
import type { SoldierScene } from '../../app/world/soldier-scene.ts';
import {
  DEFAULT_TACTICAL_OPTIONS,
  type TacticalDisplayOptions,
  type TacticalPresentation,
  TacticalWorldView,
} from '../../app/world/tactical-world-view.ts';
import { WorldEffects } from '../../app/world/world-effects.ts';
import { WORLD_COLS } from '../../content/world/grid.ts';
import type { TileTables } from '../../content/world/tile-tables.ts';
import type { SoldierView } from '../../protocol/view.ts';
import { createContext } from '../../render/gl.ts';
import { cameraOnGridNo, type ScrollLimits, scrollBy, scrollLimits, setRenderCenter } from '../../render/world/camera.ts';
import type { WorldUiNode } from '../../render/world/dynamic-scene.ts';
import { type Camera, screenToGridNo, type Viewport } from '../../render/world/geometry.ts';
import { type WorldDrawStats, WorldRenderer } from '../../render/world/world-renderer.ts';
import { Radar } from '../map-viewer/radar.ts';
import { DoorPanel } from './door-panel.ts';
import { PromptPanel } from './prompt-panel.ts';
import { nearestMerchant, ShopPanel } from './shop-panel.ts';
import { nearestTalkable, TalkPanel } from './talk-panel.ts';

interface TacticalHook {
  ready: boolean;
  map: string | null;
  soldiers: number;
  drawnSoldiers: number;
  selected: number | null;
  selectedGridNo: number | null;
  tick: number;
  error: string | null;
  lastResult: string | null;
  doorResult: string;
  talkOpen: boolean;
  talkResult: string;
  drawCalls: number;
  stats: WorldDrawStats | null;
  camera: Camera | null;
  hoveredSoldier: number | null;
  renderMs: number;
  zoom: number;
  items: number;
  soldierTeams: number[];
  framePolicy: string | null;
  mercLightOrigin: string | null;
  lightTemplatesFromData: number;
  corpses: number;
  smokeTiles: number;
  tileChanges: number;
  ambient: number | null;
  dynamicLights: number;
  aiTurn: number | null;
  command(cmd: { readonly type: string; readonly [key: string]: unknown }): Promise<unknown>;
  soldierBoxes: { readonly id: number; readonly x: number; readonly y: number; readonly width: number; readonly height: number }[];
}

declare global {
  interface Window {
    __ja2Tactical: TacticalHook;
  }
}

const debug: TacticalHook = {
  ready: false,
  map: null,
  soldiers: 0,
  drawnSoldiers: 0,
  selected: null,
  selectedGridNo: null,
  tick: 0,
  error: null,
  lastResult: null,
  doorResult: '',
  talkOpen: false,
  talkResult: '',
  drawCalls: 0,
  stats: null,
  camera: null,
  hoveredSoldier: null,
  renderMs: 0,
  zoom: 2,
  items: 0,
  soldierTeams: [],
  framePolicy: null,
  mercLightOrigin: null,
  lightTemplatesFromData: 0,
  corpses: 0,
  smokeTiles: 0,
  tileChanges: 0,
  ambient: null,
  dynamicLights: 0,
  aiTurn: null,
  command: (cmd) => client?.command(cmd) ?? Promise.resolve({ ok: false, reason: 'not connected' }),
  soldierBoxes: [],
};
window.__ja2Tactical = debug;

const OUR_TEAM = 0;
const DEFAULT_PLAYBACK = 4;
const HOVER_POINTER = 'FIRSTPOINTERS1';
const SELECTED_POINTER = 'FIRSTPOINTERS2';

type MutableOptions = { -readonly [K in keyof TacticalDisplayOptions]: TacticalDisplayOptions[K] };

function el<T extends HTMLElement>(id: string): T {
  const e = document.getElementById(id);
  if (!e) throw new Error(`#${id} missing`);
  return e as T;
}

const canvas = el<HTMLCanvasElement>('canvas');
const status = el('status');
const info = el('info');
const tradeButton = el<HTMLButtonElement>('trade');
const talkButton = el<HTMLButtonElement>('talkButton');
const doorPanel = new DoorPanel((cmd) => client?.command(cmd) ?? Promise.resolve({ ok: false, reason: 'not connected' }));
const shopPanel = new ShopPanel((cmd) => client?.command(cmd) ?? Promise.resolve({ ok: false, reason: 'not connected' }));
const promptPanel = new PromptPanel((cmd) => client?.command(cmd) ?? Promise.resolve({ ok: false, reason: 'not connected' }));
const talkPanel = new TalkPanel((cmd) => client?.command(cmd) ?? Promise.resolve({ ok: false, reason: 'not connected' }));
const muteBox = el<HTMLInputElement>('mute');
const volumeSlider = el<HTMLInputElement>('volume');
const sound = new TacticalSound();
const gl = createContext(canvas, { depth: false });
const renderer = new WorldRenderer(gl);
const pageStart = performance.now();
const options: MutableOptions = { ...DEFAULT_TACTICAL_OPTIONS };
const OPTION_BOXES: readonly [keyof MutableOptions, string][] = [
  ['roofs', 'roofs'],
  ['treeTops', 'treetops'],
  ['wireframes', 'wireframes'],
  ['glowItems', 'glowItems'],
  ['mercCastsLight', 'mercLight'],
  ['mercAlwaysLit', 'mercAlwaysLit'],
];

let view: TacticalWorldView | null = null;
let assets: SoldierAssets | null = null;
let soldierScene: SoldierScene | null = null;
let soldierFrames: SoldierFrames | null = null;
let effects: WorldEffects | null = null;
let lightTemplates = new LightTemplates();
const aiTurns = new AiTurnHolder();
let client: SessionClient | null = null;
let camera: Camera = { centerX: 805, centerY: 805 };
let limits: ScrollLimits = scrollLimits(0);
let zoom = 2;
let pointer: { x: number; y: number } | null = null;
let hoverGridNo: number | null = null;
let hoveredSoldier: number | null = null;
let selected: number | null = null;
let pointerTiles = { hover: -1, selected: -1 };
const radar = new Radar(el<HTMLCanvasElement>('radar'), (cellX, cellY) => {
  camera = setRenderCenter({ centerX: cellX, centerY: cellY }, viewport(), limits);
});

function setStatus(text: string, error = false): void {
  status.textContent = text;
  status.classList.toggle('error', error);
}

function viewport(): Viewport {
  return { width: Math.max(1, Math.floor(canvas.width / zoom)), height: Math.max(1, Math.floor(canvas.height / zoom)) };
}

function moraleById(): Map<number, number> {
  const mercs = client?.strategic?.mercs ?? [];
  return new Map(mercs.flatMap((m) => (m.morale === undefined ? [] : [[m.id, m.morale] as const])));
}

function updateSound(v: Viewport): void {
  sound.update({
    camera,
    width: v.width,
    height: v.height,
    selected,
    inCombat: !!client?.combat,
    clock: client?.clock ?? null,
    morale: moraleById(),
  });
}

function soldiers(): readonly SoldierView[] {
  return client?.soldiers ?? [];
}

function pointerTile(tables: TileTables, name: string): number {
  return tables.tileIndexByName.get(name) ?? -1;
}

function uiNodes(): WorldUiNode[] {
  const nodes: WorldUiNode[] = [];
  const sel = soldiers().find((s) => s.id === selected);
  if (sel && pointerTiles.selected >= 0) {
    nodes.push({ gridNo: sel.gridNo, layer: sel.level > 0 ? 'roof' : 'object', tile: pointerTiles.selected, head: true });
  }
  if (hoverGridNo !== null && pointerTiles.hover >= 0) nodes.push({ gridNo: hoverGridNo, layer: 'topmost', tile: pointerTiles.hover });
  return nodes;
}

let lastRenderAt = performance.now();
const showMessage = (text: string) => {
  debug.lastResult = text;
};
const sleepWake = new SleepWakeStop(() => client, showMessage);
installSaveControls({ client: () => client, show: showMessage, toolbar: document.querySelector('header') });

function render(): void {
  requestAnimationFrame(render);
  const dpr = window.devicePixelRatio || 1;
  const w = Math.floor(canvas.clientWidth * dpr);
  const h = Math.floor(canvas.clientHeight * dpr);
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w;
    canvas.height = h;
  }
  const now = performance.now();
  if (client?.driver.mode === 'instant') client.playFor(now - lastRenderAt);
  else client?.playUntil(client.latestTick);
  lastRenderAt = now;
  followSectorChange();
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  gl.viewport(0, 0, canvas.width, canvas.height);
  gl.clearColor(0, 0, 0, 1);
  gl.clear(gl.COLOR_BUFFER_BIT);
  if (!view) return;
  const v = viewport();
  updateSound(v);
  debug.soldiers = soldiers().length;
  debug.tick = client?.shownTick ?? 0;
  const sel = soldiers().find((s) => s.id === selected);
  debug.selectedGridNo = sel?.gridNo ?? null;
  const renderStart = performance.now();
  const stats = view.render({
    viewport: v,
    camera,
    clockMs: now - pageStart,
    roofLevel: false,
    options,
    view: {
      tick: client?.shownTick ?? 0,
      soldiers: soldiers(),
      items: client?.items ?? [],
      openDoors: client?.openDoors ?? [],
      revealedRooms: client?.revealedRooms ?? [],
      clock: client?.clock ?? null,
      combat: client?.combat ?? null,
      corpses: client?.view?.corpses ?? [],
      smoke: client?.view?.smoke ?? [],
      light: client?.view?.light ?? null,
      tileChanges: client?.view?.tileChanges ?? [],
    },
    hovered: hoveredSoldier,
    selected,
    uiNodes: uiNodes(),
    underAiControl: (id) => aiTurns.holds(id),
  });
  renderer.present(null, canvas.height, 0, 0, zoom);
  debug.renderMs = performance.now() - renderStart;
  if (pointer) {
    hoveredSoldier = renderer.soldierAt(pointer.x, pointer.y);
    debug.hoveredSoldier = hoveredSoldier;
  }
  debug.drawnSoldiers = view.drawnSoldiers;
  debug.zoom = zoom;
  debug.items = client?.items.length ?? 0;
  debug.soldierTeams = soldiers().map((s) => s.team);
  debug.corpses = client?.view?.corpses?.length ?? 0;
  debug.smokeTiles = client?.view?.smoke?.length ?? 0;
  debug.tileChanges = client?.view?.tileChanges?.length ?? 0;
  debug.ambient = client?.view?.light?.ambient ?? null;
  debug.dynamicLights = client?.view?.light?.sprites.length ?? 0;
  debug.aiTurn = aiTurns.soldier;
  debug.soldierBoxes = renderer.placedSoldiers.map((p) => ({ id: p.id, x: p.x, y: p.y, width: p.width, height: p.height }));
  debug.drawCalls = stats.drawCalls;
  debug.stats = stats;
  debug.camera = camera;
  radar.drawViewport({ ...v, camera });
  info.textContent = describe();
  shopPanel.update(client?.shop ?? null, soldiers());
  doorPanel.update(client?.doors ?? [], new Set(client?.openDoors ?? []));
  debug.doorResult = doorPanel.result;
  tradeButton.disabled = !!client?.shop || !nearestMerchant(soldiers(), sel);
  talkPanel.update(client?.conversation ?? null, client?.scriptedSequence ?? false, client?.npcRequest ?? null, soldiers());
  promptPanel.update(client?.prompt ?? null);
  debug.talkOpen = talkPanel.open;
  debug.talkResult = talkPanel.result;
  talkButton.disabled = talkPanel.open || !nearestTalkable(soldiers(), sel);
}

function driverLabel(): string {
  const driver = client?.driver;
  if (driver?.mode === 'realtime') return `${driver.speed}×`;
  if (driver?.mode === 'instant') return `instant, playback ${client?.playbackSpeed ?? 1}× (${Math.floor(client?.latestTick ?? 0)})`;
  return 'paused';
}

function describe(): string {
  const lines = [`tick ${Math.floor(client?.shownTick ?? 0)}  ·  ${driverLabel()}`];
  const combat = client?.combat;
  if (combat)
    lines.push(
      `COMBAT round ${combat.round}: ${combat.team === 0 ? 'your turn' : `team ${combat.team} acting`}${combat.interrupt ? ' (interrupt)' : ''}`,
    );
  const boxing = client?.boxing;
  if (boxing) lines.push(`BOXING ${boxing.state}${boxing.uiLocked ? ' (interface locked until our boxer leaves the ring)' : ''}`);
  const sel = soldiers().find((s) => s.id === selected);
  if (sel)
    lines.push(
      `selected: ${sel.name || `#${sel.id}`} at ${sel.gridNo}${sel.ap !== undefined ? `  AP ${sel.ap}  life ${sel.life}/${sel.lifeMax}  breath ${sel.breath}` : ''}`,
    );
  if (hoverGridNo !== null) lines.push(`tile ${hoverGridNo} (${hoverGridNo % WORLD_COLS}, ${Math.floor(hoverGridNo / WORLD_COLS)})`);
  const hovered = soldiers().find((s) => s.id === hoveredSoldier);
  if (hovered) lines.push(`over: ${hovered.name || `#${hovered.id}`} (team ${hovered.team})`);
  if (debug.stats) lines.push(`${debug.stats.drawCalls} draw calls, ${debug.stats.instances} sprites`);
  if (debug.lastResult) lines.push(debug.lastResult);
  return lines.join('\n');
}

function logicalPoint(e: MouseEvent): { x: number; y: number } {
  const dpr = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  return { x: ((e.clientX - rect.left) * dpr) / zoom, y: ((e.clientY - rect.top) * dpr) / zoom };
}

function gridAt(e: MouseEvent): number | null {
  const p = logicalPoint(e);
  return screenToGridNo(p.x, p.y, viewport(), camera);
}

function select(id: number): void {
  if (selected !== id) sound.director?.attention(id);
  selected = id;
  debug.selected = selected;
}

async function clickTile(g: number, run: boolean, picked: number | null): Promise<void> {
  const pickedMerc = soldiers().find((s) => s.id === picked && s.team === OUR_TEAM);
  const mine = pickedMerc ?? soldiers().find((s) => s.gridNo === g && s.team === OUR_TEAM);
  if (mine) {
    select(mine.id);
    return;
  }
  if (selected === null || !client) return;
  const mover = selected;
  const result = await client.command({ type: 'move', soldier: mover, to: g, mode: run ? 'run' : 'walk' });
  if (result.ok) sound.director?.confirm(mover);
  debug.lastResult = result.ok ? `move to ${g}: ok` : `move to ${g}: ${result.reason ?? 'refused'}`;
}

function centerOn(g: number): void {
  camera = setRenderCenter(cameraOnGridNo(g), viewport(), limits);
}

let dragRemainder = { x: 0, y: 0 };

function pan(dx: number, dy: number): void {
  const x = dragRemainder.x + dx;
  const y = dragRemainder.y + dy;
  const next = scrollBy(camera, Math.trunc(x), Math.trunc(y), viewport(), limits);
  if (next.centerX !== camera.centerX || next.centerY !== camera.centerY) {
    camera = next;
    dragRemainder = { x: 0, y: 0 };
  } else dragRemainder = { x, y };
}

let drag: { x: number; y: number; moved: boolean } | null = null;
canvas.addEventListener('contextmenu', (e) => e.preventDefault());
canvas.addEventListener('pointerdown', (e) => {
  drag = { x: e.clientX, y: e.clientY, moved: false };
  canvas.setPointerCapture(e.pointerId);
});
canvas.addEventListener('pointerup', (e) => {
  const wasDrag = drag?.moved ?? false;
  drag = null;
  if (wasDrag) return;
  const g = gridAt(e);
  if (g === null) return;
  const p = logicalPoint(e);
  if ((e.ctrlKey || e.altKey) && selected !== null) doorPanel.act(selected, g);
  else void clickTile(g, e.button === 2 || e.shiftKey, renderer.soldierAt(p.x, p.y));
});
canvas.addEventListener('pointermove', (e) => {
  const dpr = window.devicePixelRatio || 1;
  if (drag && (Math.abs(drag.x - e.clientX) > 3 || Math.abs(drag.y - e.clientY) > 3 || drag.moved)) {
    pan(((drag.x - e.clientX) * dpr) / zoom, ((drag.y - e.clientY) * dpr) / zoom);
    drag = { x: e.clientX, y: e.clientY, moved: true };
  }
  hoverGridNo = gridAt(e);
  pointer = logicalPoint(e);
});
canvas.addEventListener('pointerleave', () => {
  pointer = null;
  hoverGridNo = null;
  hoveredSoldier = null;
});
window.addEventListener('keydown', (e) => {
  const moves: Record<string, [number, number]> = { ArrowLeft: [-40, 0], ArrowRight: [40, 0], ArrowUp: [0, -20], ArrowDown: [0, 20] };
  const m = moves[e.key];
  if (m) pan(m[0], m[1]);
});
for (const [key, id] of OPTION_BOXES) {
  const box = el<HTMLInputElement>(id);
  box.checked = options[key];
  box.addEventListener('change', () => {
    options[key] = box.checked;
  });
}
for (const b of document.querySelectorAll<HTMLButtonElement>('[data-zoom]')) {
  b.classList.toggle('active', Number(b.dataset.zoom) === zoom);
  b.addEventListener('click', () => {
    zoom = Number(b.dataset.zoom);
    for (const other of document.querySelectorAll<HTMLButtonElement>('[data-zoom]')) other.classList.toggle('active', other === b);
    camera = setRenderCenter(camera, viewport(), limits);
  });
}
for (const b of document.querySelectorAll<HTMLButtonElement>('[data-speed]')) {
  b.addEventListener('click', () => {
    for (const other of document.querySelectorAll<HTMLButtonElement>('[data-speed]')) other.classList.toggle('active', other === b);
    const speed = Number(b.dataset.speed);
    if (b.dataset.speed === 'instant') void client?.drive({ mode: 'instant' });
    else void client?.drive(speed === 0 ? { mode: 'manual' } : { mode: 'realtime', speed });
  });
}
for (const b of document.querySelectorAll<HTMLButtonElement>('[data-playback]')) {
  b.classList.toggle('active', Number(b.dataset.playback) === DEFAULT_PLAYBACK);
  b.addEventListener('click', () => {
    if (client) client.playbackSpeed = Number(b.dataset.playback);
    for (const other of document.querySelectorAll<HTMLButtonElement>('[data-playback]')) other.classList.toggle('active', other === b);
  });
}
el<HTMLButtonElement>('skip').addEventListener('click', () => client?.skipToLatest());
el<HTMLButtonElement>('endTurn').addEventListener('click', () => {
  void client?.command({ type: 'endTurn' }).then((r) => {
    debug.lastResult = r.ok ? 'turn ended' : `end turn: ${r.reason ?? 'refused'}`;
  });
});
function selectedCommand(type: string, done: string): void {
  if (selected === null || !client) return;
  void client.command({ type, soldier: selected }).then((r) => {
    debug.lastResult = r.ok ? done : `${type}: ${r.reason ?? 'refused'}`;
  });
}
el<HTMLButtonElement>('reload').addEventListener('click', () => selectedCommand('reload', 'reloaded'));
el<HTMLButtonElement>('swapHands').addEventListener('click', () => selectedCommand('swapHands', 'hands swapped'));
tradeButton.addEventListener('click', () => {
  const merchant = nearestMerchant(
    soldiers(),
    soldiers().find((s) => s.id === selected),
  );
  if (!merchant || selected === null || !client) return;
  void client.command({ type: 'openShop', dealer: merchant.profile, soldier: selected }).then((r) => {
    debug.lastResult = r.ok ? `shop of ${merchant.name} open` : `trade: ${r.reason ?? 'refused'}`;
  });
});
talkButton.addEventListener('click', () => {
  const sel = soldiers().find((s) => s.id === selected);
  const npc = nearestTalkable(soldiers(), sel);
  if (npc && selected !== null) talkPanel.talk(selected, npc);
});
el<HTMLButtonElement>('idle').addEventListener('click', () => {
  void client?.advance({ idle: true }).then((report) => {
    debug.lastResult = report ? `advanced to ${report.tick}: ${report.reason}` : 'advance failed';
  });
});

let available: ReadonlySet<string> = new Set();
let listing: readonly VfsFile[] = [];
const pageParams = new URLSearchParams(location.search);
let loadingMap: string | null = null;

async function loadSector(mapPath: string): Promise<void> {
  loadingMap = mapPath;
  debug.ready = false;
  if (!soldierScene) throw new Error('soldier assets are not loaded');
  const presentation: TacticalPresentation = { soldiers: soldierScene, frames: soldierFrames, effects, lightTemplates };
  const loaded = await TacticalWorldView.load(renderer, mapPath, available, presentation);
  view = loaded;
  limits = scrollLimits(loaded.world.map.info.restrictedScrollId);
  pointerTiles = { hover: pointerTile(loaded.world.tables, HOVER_POINTER), selected: pointerTile(loaded.world.tables, SELECTED_POINTER) };
  await sound.setWorld(loaded.world);
  await radar.load(mapPath, available);
  const squad = soldiers().filter((s) => s.team === OUR_TEAM);
  selected = squad.find((s) => s.id === selected)?.id ?? squad[0]?.id ?? null;
  debug.selected = selected;
  centerOn(squad[0]?.gridNo ?? loaded.world.map.info.centerGridNo);
  await Promise.all(soldiers().flatMap((s) => assets?.preload(s) ?? []));
  debug.map = mapPath;
  loadingMap = null;
  setStatus(`${mapPath} · ${soldiers().length} soldiers visible`);
  debug.ready = true;
}

function followSectorChange(): void {
  const mapPath = client?.mapPath ?? null;
  if (!mapPath || mapPath === debug.map || loadingMap !== null || !soldierScene) return;
  void loadSector(mapPath).catch((err: Error) => {
    loadingMap = null;
    debug.error = err.message;
    setStatus(err.message, true);
  });
}

async function start(): Promise<void> {
  try {
    listing = await fetchVfsList();
    available = new Set(listing.map((f) => f.path));
    client = await SessionClient.connect(pageParams.get('session') ?? undefined);
    client.playbackSpeed = DEFAULT_PLAYBACK;
    const mapPath = client.mapPath;
    if (!mapPath) throw new Error('no sector is loaded in this session');
    assets = await SoldierAssets.load(available);
    soldierScene = TacticalWorldView.soldierScene(assets);
    soldierFrames = await loadSoldierFrames({
      available,
      read: fetchVfsFile,
      serverScripts: client.rules?.scripts ?? null,
      preferStubScripts: pageParams.get('scripts') === 'stub',
    });
    debug.framePolicy = soldierFrames?.policy ?? null;
    effects = await WorldEffects.load(fetchVfsFile, available, assets.palettes);
    lightTemplates = await LightTemplates.load(listing, fetchVfsFile);
    debug.lightTemplatesFromData = lightTemplates.fromData;
    debug.mercLightOrigin = lightTemplates.resolve(MERC_LIGHT)?.origin ?? null;
    await sound.load(available, assets.tables, client.session ?? 'local');
    sound.director?.reset(client.soldiers);
    sound.music.reset(client.view?.music);
    client.onFrames = (frames) => {
      sound.frames(frames);
      sleepWake.frames(frames);
      for (const frame of frames) aiTurns.observe(frame.events ?? []);
    };
    client.onReceive = (frames) => {
      for (const frame of frames) soldierFrames?.observe(frame.events ?? []);
    };
    client.onWelcome = () => {
      sound.director?.reset(client?.soldiers ?? []);
      sound.music.reset(client?.view?.music);
      soldierFrames?.reset();
      aiTurns.reset();
    };
    await loadSector(mapPath);
    for (const b of document.querySelectorAll<HTMLButtonElement>('[data-speed]'))
      b.classList.toggle('active', Number(b.dataset.speed) === 0);
  } catch (err) {
    debug.error = (err as Error).message;
    setStatus((err as Error).message, true);
  }
}

const unlockSound = () => sound.unlock();
window.addEventListener('pointerdown', unlockSound, { capture: true });
window.addEventListener('keydown', unlockSound, { capture: true });
muteBox.checked = sound.settings.muted;
volumeSlider.value = String(sound.settings.volumes.master);
muteBox.addEventListener('change', () => sound.change({ muted: muteBox.checked }));
volumeSlider.addEventListener('input', () => sound.change({ volumes: { master: Number(volumeSlider.value) } }));

requestAnimationFrame(render);
void start();

import { installSaveControls } from '../../app/net/save-controls.ts';
import { SessionClient } from '../../app/net/session-client.ts';
import { SleepWakeStop } from '../../app/net/sleep-wake-stop.ts';
import { fetchVfsList } from '../../app/net/vfs.ts';
import { TacticalSound } from '../../app/sound/tactical-sound.ts';
import { SoldierAssets } from '../../app/world/soldier-assets.ts';
import { type LoadedWorld, loadWorld } from '../../app/world/world-loader.ts';
import { soldierSheetFrame } from '../../content/anim/soldier-sprite.ts';
import { WORLD_COLS } from '../../content/world/grid.ts';
import { typeIndex } from '../../content/world/tile-tables.ts';
import type { SoldierView } from '../../protocol/view.ts';
import { TextureAtlas } from '../../render/atlas.ts';
import { createContext } from '../../render/gl.ts';
import { SpriteRenderer } from '../../render/sprite-renderer.ts';
import { prepareLevelRenderData } from '../../render/world/level-render-data.ts';
import {
  buildScene,
  type Camera,
  type FrameGeometry,
  type SceneMerc,
  type SceneOptions,
  type SceneSource,
  screenToGridNo,
  tileOrigin,
} from '../../render/world/scene.ts';
import { type MercDrawSpec, SoldierSprites } from '../../render/world/soldier-sprites.ts';
import { TileAtlas } from '../../render/world/tile-atlas.ts';
import { drawScene } from '../../render/world/world-renderer.ts';
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
};
window.__ja2Tactical = debug;

const OUR_TEAM = 0;
const DOOR_FLAGS = 0x00cc0008;
const OPEN_FLAG = 0x2;
const DEFAULT_PLAYBACK = 4;

function el<T extends HTMLElement>(id: string): T {
  const e = document.getElementById(id);
  if (!e) throw new Error(`#${id} missing`);
  return e as T;
}

const canvas = el<HTMLCanvasElement>('canvas');
const status = el('status');
const info = el('info');
const roofs = el<HTMLInputElement>('roofs');
const tradeButton = el<HTMLButtonElement>('trade');
const talkButton = el<HTMLButtonElement>('talkButton');
const doorPanel = new DoorPanel((cmd) => client?.command(cmd) ?? Promise.resolve({ ok: false, reason: 'not connected' }));
const shopPanel = new ShopPanel((cmd) => client?.command(cmd) ?? Promise.resolve({ ok: false, reason: 'not connected' }));
const promptPanel = new PromptPanel((cmd) => client?.command(cmd) ?? Promise.resolve({ ok: false, reason: 'not connected' }));
const talkPanel = new TalkPanel((cmd) => client?.command(cmd) ?? Promise.resolve({ ok: false, reason: 'not connected' }));
const muteBox = el<HTMLInputElement>('mute');
const volumeSlider = el<HTMLInputElement>('volume');
const sound = new TacticalSound();
const gl = createContext(canvas, { depth: true, preserveDrawingBuffer: true });
const renderer = new SpriteRenderer(gl);
const sprites = new SoldierSprites(gl);
const cursorAtlas = new TextureAtlas(gl, 'rgba', 64);
const cursorRegion = cursorAtlas.add(40, 20, diamond([255, 230, 120, 255]));
const selectRegion = cursorAtlas.add(40, 20, diamond([120, 230, 120, 255]));

let world: LoadedWorld | null = null;
let source: SceneSource | null = null;
let atlas: TileAtlas | null = null;
let assets: SoldierAssets | null = null;
let client: SessionClient | null = null;
let camera: Camera = { centerX: 805, centerY: 805 };
let zoom = 2;
let hoverGridNo: number | null = null;
let selected: number | null = null;
let mercsByGrid = new Map<number, SceneMerc[]>();
let openDoors: ReadonlySet<number> = new Set();
let revealedRooms: ReadonlySet<number> = new Set();
const lastDrawn = new Map<number, { spec: MercDrawSpec; frame: FrameGeometry }>();
const radar = new Radar(el<HTMLCanvasElement>('radar'), (cellX, cellY) => {
  camera = { centerX: cellX, centerY: cellY };
});

function diamond(rgba: readonly number[]): Uint8Array {
  const out = new Uint8Array(40 * 20 * 4);
  for (let y = 0; y < 20; y++) {
    const dy = y < 10 ? y : 19 - y;
    const half = 2 + dy * 2;
    for (const x of [20 - half, 20 + half - 1]) out.set(rgba, (y * 40 + x) * 4);
  }
  return out;
}

function setStatus(text: string, error = false): void {
  status.textContent = text;
  status.classList.toggle('error', error);
}

function sceneOptions(): SceneOptions {
  return {
    width: Math.floor(canvas.width / zoom),
    height: Math.floor(canvas.height / zoom),
    camera,
    ambientShade: 3,
    showRoofs: roofs.checked,
    showShadows: true,
  };
}

function moraleById(): Map<number, number> {
  const mercs = client?.strategic?.mercs ?? [];
  return new Map(mercs.flatMap((m) => (m.morale === undefined ? [] : [[m.id, m.morale] as const])));
}

function updateSound(options: SceneOptions): void {
  sound.update({
    camera,
    width: options.width,
    height: options.height,
    selected,
    inCombat: !!client?.combat,
    clock: client?.clock ?? null,
    morale: moraleById(),
  });
}

function soldiers(): readonly SoldierView[] {
  return client?.soldiers ?? [];
}

function currentSprite(s: SoldierView): { spec: MercDrawSpec; frame: FrameGeometry } | null {
  if (!assets) return null;
  const request = assets.sheetFor(s);
  const standingRequest = assets.standingSheetFor(s);
  const sheet = request ? assets.ready(request) : null;
  const standing = standingRequest ? assets.ready(standingRequest) : null;
  if (!request || !standingRequest || !sheet || !standing) return null;
  const loaded = sprites.addSheet(request.id, sheet);
  const index = soldierSheetFrame(loaded.layout, s.frame, s.direction);
  const region = loaded.regions[index];
  const f = loaded.picture.frames[index];
  if (!region || !f) return null;
  const paletteKey = `${standingRequest.id}|${s.palettes.join('|')}`;
  const paletteRowBase = sprites.paletteRowBase(paletteKey, () => assets?.paletteFor(s, standing) ?? standing.picture.palette);
  return { spec: { region, paletteRowBase }, frame: { offsetX: f.offsetX, offsetY: f.offsetY, width: f.width, height: f.height } };
}

function collectMercs(): number {
  sprites.beginFrame();
  mercsByGrid = new Map();
  let drawn = 0;
  for (const s of soldiers()) {
    const sprite = currentSprite(s) ?? lastDrawn.get(s.id) ?? null;
    if (!sprite) continue;
    lastDrawn.set(s.id, sprite);
    const key = sprites.addSpec(sprite.spec);
    const list = mercsByGrid.get(s.gridNo) ?? [];
    list.push({ key, gridNo: s.gridNo, x: s.x, y: s.y, level: s.level, frame: sprite.frame });
    mercsByGrid.set(s.gridNo, list);
    drawn++;
  }
  return drawn;
}

function drawCursor(g: number, region: typeof cursorRegion, options: SceneOptions): void {
  if (!world || !source) return;
  const o = tileOrigin(g % WORLD_COLS, Math.floor(g / WORLD_COLS), options);
  const y = o.y - (world.level.heights[g] ?? 0) + source.prepared.renderHeight;
  renderer.draw(cursorAtlas, region, o.x * zoom, y * zoom, zoom);
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
  openDoors = new Set(client?.openDoors ?? []);
  revealedRooms = new Set(client?.revealedRooms ?? []);
  followSectorChange();
  gl.clearColor(0, 0, 0, 1);
  gl.clearDepth(0);
  gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
  if (!world || !source || !atlas) return;
  const options = sceneOptions();
  updateSound(options);
  debug.drawnSoldiers = collectMercs();
  debug.soldiers = soldiers().length;
  debug.tick = client?.shownTick ?? 0;
  renderer.begin();
  drawScene(renderer, atlas, world.tiles, buildScene(source, options), zoom, sprites);
  renderer.end(canvas.width, canvas.height, atlas.palettes);
  renderer.begin();
  const sel = soldiers().find((s) => s.id === selected);
  debug.selectedGridNo = sel?.gridNo ?? null;
  if (sel) drawCursor(sel.gridNo, selectRegion, options);
  if (hoverGridNo !== null) drawCursor(hoverGridNo, cursorRegion, options);
  renderer.end(canvas.width, canvas.height, null);
  radar.drawViewport(options);
  info.textContent = describe();
  shopPanel.update(client?.shop ?? null, soldiers());
  doorPanel.update(client?.doors ?? [], openDoors);
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
  if (debug.lastResult) lines.push(debug.lastResult);
  return lines.join('\n');
}

function gridAt(e: MouseEvent): number | null {
  const dpr = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  return screenToGridNo(((e.clientX - rect.left) * dpr) / zoom, ((e.clientY - rect.top) * dpr) / zoom, sceneOptions());
}

async function clickTile(g: number, run: boolean): Promise<void> {
  const mine = soldiers().find((s) => s.gridNo === g && s.team === OUR_TEAM);
  if (mine) {
    if (selected !== mine.id) sound.director?.attention(mine.id);
    selected = mine.id;
    debug.selected = selected;
    return;
  }
  if (selected === null || !client) return;
  const mover = selected;
  const result = await client.command({ type: 'move', soldier: mover, to: g, mode: run ? 'run' : 'walk' });
  if (result.ok) sound.director?.confirm(mover);
  debug.lastResult = result.ok ? `move to ${g}: ok` : `move to ${g}: ${result.reason ?? 'refused'}`;
}

function centerOn(g: number): void {
  camera = { centerX: (g % WORLD_COLS) * 10 + 5, centerY: Math.floor(g / WORLD_COLS) * 10 + 5 };
}

function pan(dx: number, dy: number): void {
  camera = { centerX: camera.centerX + Math.round(dx / 4 + dy / 2), centerY: camera.centerY + Math.round(dy / 2 - dx / 4) };
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
  if ((e.ctrlKey || e.altKey) && selected !== null) doorPanel.act(selected, g);
  else void clickTile(g, e.button === 2 || e.shiftKey);
});
canvas.addEventListener('pointermove', (e) => {
  const dpr = window.devicePixelRatio || 1;
  if (drag && (Math.abs(drag.x - e.clientX) > 3 || Math.abs(drag.y - e.clientY) > 3 || drag.moved)) {
    pan(((drag.x - e.clientX) * dpr) / zoom, ((drag.y - e.clientY) * dpr) / zoom);
    drag = { x: e.clientX, y: e.clientY, moved: true };
  }
  hoverGridNo = gridAt(e);
});
window.addEventListener('keydown', (e) => {
  const moves: Record<string, [number, number]> = { ArrowLeft: [-40, 0], ArrowRight: [40, 0], ArrowUp: [0, -40], ArrowDown: [0, 40] };
  const m = moves[e.key];
  if (m) pan(m[0], m[1]);
});
for (const b of document.querySelectorAll<HTMLButtonElement>('[data-zoom]')) {
  b.classList.toggle('active', Number(b.dataset.zoom) === zoom);
  b.addEventListener('click', () => {
    zoom = Number(b.dataset.zoom);
    for (const other of document.querySelectorAll<HTMLButtonElement>('[data-zoom]')) other.classList.toggle('active', other === b);
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
let loadingMap: string | null = null;

async function loadSector(mapPath: string): Promise<void> {
  loadingMap = mapPath;
  debug.ready = false;
  const loaded = await loadWorld(mapPath, available);
  atlas?.dispose();
  world = loaded;
  atlas = new TileAtlas(gl, loaded.surfaces);
  const firstRoofType = typeIndex(loaded.tables, 'FIRSTROOF');
  const lastRoofType = typeIndex(loaded.tables, 'SECONDSLANTROOF');
  const underground = loaded.map.ambient?.basement === true || loaded.map.ambient?.caves === true;
  source = {
    level: loaded.level,
    tiles: loaded.tiles,
    prepared: prepareLevelRenderData(loaded.level, loaded.tiles, loaded.tables, loaded.map.info, underground),
    frame: (tile) => {
      const te = loaded.tiles[tile];
      const f = te ? loaded.surfaces[te.type]?.picture.frames[te.regionIndex] : undefined;
      return f ? { offsetX: f.offsetX, offsetY: f.offsetY, width: f.width, height: f.height } : null;
    },
    mercsAt: (g) => mercsByGrid.get(g) ?? [],
    roofHidden: (g, tile) => {
      const room = loaded.level.rooms[g] ?? 0;
      if (room === 0 || !revealedRooms.has(room)) return false;
      const type = loaded.tiles[tile]?.type ?? -1;
      return type >= firstRoofType && type <= lastRoofType;
    },
    substitute: (g, tile) => {
      if (!openDoors.has(g)) return tile;
      const def = loaded.tiles[tile]?.structure;
      return def && def.flags & DOOR_FLAGS && !(def.flags & OPEN_FLAG) ? tile + def.partnerDelta : tile;
    },
  };
  await sound.setWorld(loaded);
  await radar.load(mapPath, available);
  const squad = soldiers().filter((s) => s.team === OUR_TEAM);
  selected = squad.find((s) => s.id === selected)?.id ?? squad[0]?.id ?? null;
  debug.selected = selected;
  centerOn(squad[0]?.gridNo ?? loaded.map.info.centerGridNo);
  await Promise.all(soldiers().flatMap((s) => assets?.preload(s) ?? []));
  debug.map = mapPath;
  loadingMap = null;
  setStatus(`${mapPath} · ${soldiers().length} soldiers visible`);
  debug.ready = true;
}

function followSectorChange(): void {
  const mapPath = client?.mapPath ?? null;
  if (!mapPath || mapPath === debug.map || loadingMap !== null) return;
  void loadSector(mapPath).catch((err: Error) => {
    loadingMap = null;
    debug.error = err.message;
    setStatus(err.message, true);
  });
}

async function start(): Promise<void> {
  try {
    const files = await fetchVfsList();
    available = new Set(files.map((f) => f.path));
    client = await SessionClient.connect(new URLSearchParams(location.search).get('session') ?? undefined);
    client.playbackSpeed = DEFAULT_PLAYBACK;
    const mapPath = client.mapPath;
    if (!mapPath) throw new Error('no sector is loaded in this session');
    assets = await SoldierAssets.load(available);
    await sound.load(available, assets.tables, client.session ?? 'local');
    sound.director?.reset(client.soldiers);
    sound.music.reset(client.view?.music);
    client.onFrames = (frames) => {
      sound.frames(frames);
      sleepWake.frames(frames);
    };
    client.onWelcome = () => {
      sound.director?.reset(client?.soldiers ?? []);
      sound.music.reset(client?.view?.music);
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

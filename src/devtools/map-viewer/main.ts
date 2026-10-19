import { fetchVfsList } from '../../app/net/vfs.ts';
import { type LoadedWorld, loadWorld } from '../../app/world/world-loader.ts';
import { WORLD_COLS } from '../../content/world/grid.ts';
import { levelTilesAt } from '../../content/world/level.ts';
import { TextureAtlas } from '../../render/atlas.ts';
import { createContext } from '../../render/gl.ts';
import { SpriteRenderer } from '../../render/sprite-renderer.ts';
import { prepareLevelRenderData } from '../../render/world/level-render-data.ts';
import {
  buildScene,
  type Camera,
  type FrameGeometry,
  type SceneOptions,
  type SceneSource,
  screenToGridNo,
  tileOrigin,
} from '../../render/world/scene.ts';
import { TileAtlas } from '../../render/world/tile-atlas.ts';
import { drawScene } from '../../render/world/world-renderer.ts';
import { Radar } from './radar.ts';

interface MapViewerHook {
  ready: boolean;
  map: string | null;
  quads: number;
  hoverGridNo: number | null;
  error: string | null;
}

declare global {
  interface Window {
    __ja2MapViewer: MapViewerHook;
  }
}

const debug: MapViewerHook = { ready: false, map: null, quads: 0, hoverGridNo: null, error: null };
window.__ja2MapViewer = debug;

function el<T extends HTMLElement>(id: string): T {
  const e = document.getElementById(id);
  if (!e) throw new Error(`#${id} missing`);
  return e as T;
}

const canvas = el<HTMLCanvasElement>('canvas');
const status = el('status');
const hover = el('hover');
const mapSelect = el<HTMLSelectElement>('map');
const roofs = el<HTMLInputElement>('roofs');
const shadows = el<HTMLInputElement>('shadows');
const light = el<HTMLSelectElement>('light');
const gl = createContext(canvas, { depth: true, preserveDrawingBuffer: true });
const renderer = new SpriteRenderer(gl);
const cursorAtlas = new TextureAtlas(gl, 'rgba', 64);
const cursorRegion = cursorAtlas.add(40, 20, cursorDiamond());

let world: LoadedWorld | null = null;
let source: SceneSource | null = null;
let atlas: TileAtlas | null = null;
let camera: Camera = { centerX: 805, centerY: 805 };
let zoom = 2;
let hoverGridNo: number | null = null;
let frameRequested = false;
let available: ReadonlySet<string> = new Set();
const radar = new Radar(el<HTMLCanvasElement>('radar'), (cellX, cellY) => {
  camera = { centerX: cellX, centerY: cellY };
  requestFrame();
});

function cursorDiamond(): Uint8Array {
  const rgba = new Uint8Array(40 * 20 * 4);
  for (let y = 0; y < 20; y++) {
    const dy = y < 10 ? y : 19 - y;
    const half = 2 + dy * 2;
    for (const x of [20 - half, 20 + half - 1]) rgba.set([255, 230, 120, 255], (y * 40 + x) * 4);
  }
  return rgba;
}

function setStatus(text: string, error = false): void {
  status.textContent = text;
  status.classList.toggle('error', error);
}

function viewSize(): { width: number; height: number } {
  return { width: Math.floor(canvas.width / zoom), height: Math.floor(canvas.height / zoom) };
}

function sceneOptions(): SceneOptions {
  return { ...viewSize(), camera, ambientShade: Number(light.value), showRoofs: roofs.checked, showShadows: shadows.checked };
}

function frameOf(w: LoadedWorld): (tile: number) => FrameGeometry | null {
  return (tile) => {
    const te = w.tiles[tile];
    const f = te ? w.surfaces[te.type]?.picture.frames[te.regionIndex] : undefined;
    return f ? { offsetX: f.offsetX, offsetY: f.offsetY, width: f.width, height: f.height } : null;
  };
}

function requestFrame(): void {
  if (frameRequested) return;
  frameRequested = true;
  requestAnimationFrame(render);
}

function render(): void {
  frameRequested = false;
  const dpr = window.devicePixelRatio || 1;
  const w = Math.floor(canvas.clientWidth * dpr);
  const h = Math.floor(canvas.clientHeight * dpr);
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w;
    canvas.height = h;
  }
  gl.clearColor(0, 0, 0, 1);
  gl.clearDepth(0);
  gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
  if (!world || !source || !atlas) return;
  const options = sceneOptions();
  renderer.begin();
  drawScene(renderer, atlas, world.tiles, buildScene(source, options), zoom);
  renderer.end(canvas.width, canvas.height, atlas.palettes);
  let quads = renderer.lastQuadCount;
  if (hoverGridNo !== null) {
    const o = tileOrigin(hoverGridNo % WORLD_COLS, Math.floor(hoverGridNo / WORLD_COLS), options);
    const y = o.y - (world.level.heights[hoverGridNo] ?? 0) + source.prepared.renderHeight;
    renderer.begin();
    renderer.draw(cursorAtlas, cursorRegion, o.x * zoom, y * zoom, zoom);
    renderer.end(canvas.width, canvas.height, null);
    quads += renderer.lastQuadCount;
  }
  debug.quads = quads;
  radar.drawViewport(options);
}

function describeTile(g: number): string {
  if (!world) return '';
  const x = g % WORLD_COLS;
  const y = Math.floor(g / WORLD_COLS);
  const lines = [`gridno ${g}  (${x}, ${y})  height ${world.level.heights[g]}  room ${world.level.rooms[g]}`];
  for (const name of ['land', 'objects', 'structs', 'roofs', 'onRoof'] as const) {
    const names = [...levelTilesAt(world.level.layers[name], g)].map((t) => world?.tables.tileNames[t] ?? t);
    if (names.length > 0) lines.push(`${name.padEnd(8)} ${names.join(' ')}`);
  }
  return lines.join('\n');
}

function centerOn(gridNo: number): void {
  camera = { centerX: (gridNo % WORLD_COLS) * 10 + 5, centerY: Math.floor(gridNo / WORLD_COLS) * 10 + 5 };
}

async function open(path: string): Promise<void> {
  debug.ready = false;
  setStatus(`loading ${path}…`);
  try {
    const loaded = await loadWorld(path, available);
    atlas?.dispose();
    world = loaded;
    atlas = new TileAtlas(gl, loaded.surfaces);
    const underground = loaded.map.ambient?.basement === true || loaded.map.ambient?.caves === true;
    source = {
      level: loaded.level,
      tiles: loaded.tiles,
      prepared: prepareLevelRenderData(loaded.level, loaded.tiles, loaded.tables, loaded.map.info, underground),
      frame: frameOf(loaded),
    };
    const center = loaded.map.info.centerGridNo;
    centerOn(center >= 0 && center < WORLD_COLS * WORLD_COLS ? center : 80 * WORLD_COLS + 80);
    await radar.load(path, available);
    debug.map = path;
    debug.error = null;
    setStatus(`${path} · tileset ${loaded.map.tilesetId} · ${loaded.surfaces.filter(Boolean).length} surfaces`);
    history.replaceState(null, '', `#map=${encodeURIComponent(path)}`);
    requestFrame();
    await new Promise((resolve) => requestAnimationFrame(resolve));
    debug.ready = true;
  } catch (err) {
    debug.error = (err as Error).message;
    setStatus(`${path}: ${(err as Error).message}`, true);
  }
}

function pan(dx: number, dy: number): void {
  camera = { centerX: camera.centerX + Math.round(dx / 4 + dy / 2), centerY: camera.centerY + Math.round(dy / 2 - dx / 4) };
  requestFrame();
}

let drag: { x: number; y: number } | null = null;
canvas.addEventListener('pointerdown', (e) => {
  drag = { x: e.clientX, y: e.clientY };
  canvas.setPointerCapture(e.pointerId);
});
canvas.addEventListener('pointerup', () => {
  drag = null;
});
canvas.addEventListener('pointermove', (e) => {
  const dpr = window.devicePixelRatio || 1;
  if (drag) {
    pan(((drag.x - e.clientX) * dpr) / zoom, ((drag.y - e.clientY) * dpr) / zoom);
    drag = { x: e.clientX, y: e.clientY };
  }
  const rect = canvas.getBoundingClientRect();
  const g = screenToGridNo(((e.clientX - rect.left) * dpr) / zoom, ((e.clientY - rect.top) * dpr) / zoom, sceneOptions());
  if (g !== hoverGridNo) {
    hoverGridNo = g;
    debug.hoverGridNo = g;
    hover.textContent = g === null ? '' : describeTile(g);
    hover.hidden = g === null;
    requestFrame();
  }
});
window.addEventListener('keydown', (e) => {
  const step = 40;
  const moves: Record<string, [number, number]> = {
    ArrowLeft: [-step, 0],
    ArrowRight: [step, 0],
    ArrowUp: [0, -step],
    ArrowDown: [0, step],
  };
  const m = moves[e.key];
  if (m) pan(m[0], m[1]);
});
for (const input of [roofs, shadows, light]) input.addEventListener('change', requestFrame);
for (const b of document.querySelectorAll<HTMLButtonElement>('[data-zoom]')) {
  b.classList.toggle('active', Number(b.dataset.zoom) === zoom);
  b.addEventListener('click', () => {
    zoom = Number(b.dataset.zoom);
    for (const other of document.querySelectorAll<HTMLButtonElement>('[data-zoom]')) other.classList.toggle('active', other === b);
    requestFrame();
  });
}
mapSelect.addEventListener('change', () => void open(mapSelect.value));
new ResizeObserver(requestFrame).observe(canvas);

async function start(): Promise<void> {
  try {
    const files = await fetchVfsList();
    available = new Set(files.map((f) => f.path));
    const maps = files.filter((f) => /(^|\/)maps\/[^/]+\.dat$/.test(f.path)).map((f) => f.path);
    mapSelect.replaceChildren(
      ...maps.map((m) => {
        const option = document.createElement('option');
        option.value = m;
        option.textContent = m;
        return option;
      }),
    );
    const fromHash = new URLSearchParams(location.hash.slice(1)).get('map');
    const initial = fromHash && maps.includes(fromHash) ? fromHash : (maps.find((m) => m === 'maps/a9.dat') ?? maps[0]);
    if (!initial) {
      setStatus('no maps in the VFS', true);
      return;
    }
    mapSelect.value = initial;
    await open(initial);
  } catch (err) {
    debug.error = (err as Error).message;
    setStatus(`no connection to the server: ${(err as Error).message}`, true);
  }
}

void start();

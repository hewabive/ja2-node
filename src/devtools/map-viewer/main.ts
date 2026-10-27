import { fetchVfsList } from '../../app/net/vfs.ts';
import { type LightingTime, WorldLighting } from '../../app/world/world-lighting.ts';
import { type LoadedWorld, loadWorld, renderWorldOf } from '../../app/world/world-loader.ts';
import { WORLD_COLS, WORLD_MAX } from '../../content/world/grid.ts';
import { levelTilesAt } from '../../content/world/level.ts';
import { tileIndex } from '../../content/world/tile-tables.ts';
import { createContext } from '../../render/gl.ts';
import { cameraOnGridNo, type ScrollLimits, scrollBy, scrollLimits, setRenderCenter } from '../../render/world/camera.ts';
import type { WorldUiNode } from '../../render/world/dynamic-scene.ts';
import { type Camera, screenToGridNo, type Viewport } from '../../render/world/geometry.ts';
import { DEFAULT_DISPLAY_OPTIONS, type WorldDrawStats, WorldRenderer } from '../../render/world/world-renderer.ts';
import { Radar } from './radar.ts';

interface MapViewerHook {
  ready: boolean;
  map: string | null;
  quads: number;
  drawCalls: number;
  stats: WorldDrawStats | null;
  camera: Camera | null;
  hoverGridNo: number | null;
  error: string | null;
}

declare global {
  interface Window {
    __ja2MapViewer: MapViewerHook;
  }
}

const debug: MapViewerHook = { ready: false, map: null, quads: 0, drawCalls: 0, stats: null, camera: null, hoverGridNo: null, error: null };
window.__ja2MapViewer = debug;

const LIGHT_TIMES: Readonly<Record<string, LightingTime>> = {
  day: { hour: 12, minute: 0 },
  dusk: { hour: 21, minute: 5 },
  night: { hour: 22, minute: 0 },
};

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
const treeTops = el<HTMLInputElement>('treetops');
const wireframes = el<HTMLInputElement>('wireframes');
const roofLevel = el<HTMLInputElement>('roofLevel');
const light = el<HTMLSelectElement>('light');
const gl = createContext(canvas, { depth: false });
const renderer = new WorldRenderer(gl);

let world: LoadedWorld | null = null;
let lighting: WorldLighting | null = null;
let limits: ScrollLimits = scrollLimits(0);
let camera: Camera = { centerX: 805, centerY: 805 };
let zoom = 2;
let hoverGridNo: number | null = null;
let hoverTile = 0;
let frameRequested = false;
let available: ReadonlySet<string> = new Set();
const radar = new Radar(el<HTMLCanvasElement>('radar'), (cellX, cellY) => {
  camera = setRenderCenter({ centerX: cellX, centerY: cellY }, viewport(), limits);
  requestFrame();
});

function setStatus(text: string, error = false): void {
  status.textContent = text;
  status.classList.toggle('error', error);
}

function viewport(): Viewport {
  return { width: Math.max(1, Math.floor(canvas.width / zoom)), height: Math.max(1, Math.floor(canvas.height / zoom)) };
}

function requestFrame(): void {
  if (frameRequested) return;
  frameRequested = true;
  requestAnimationFrame(render);
}

function uiNodes(): WorldUiNode[] {
  return hoverGridNo === null || hoverTile < 0 ? [] : [{ gridNo: hoverGridNo, layer: 'topmost', tile: hoverTile }];
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
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  gl.viewport(0, 0, canvas.width, canvas.height);
  gl.clearColor(0, 0, 0, 1);
  gl.clear(gl.COLOR_BUFFER_BIT);
  if (!world || !lighting) return;
  const v = viewport();
  const time = LIGHT_TIMES[light.value] ?? LIGHT_TIMES.day ?? { hour: 12, minute: 0 };
  const stats = renderer.render({
    viewport: v,
    camera,
    roofLevel: roofLevel.checked,
    clockMs: 0,
    options: {
      ...DEFAULT_DISPLAY_OPTIONS,
      roofs: roofs.checked,
      shadows: shadows.checked,
      treeTops: treeTops.checked,
      wireframes: wireframes.checked,
    },
    shade: lighting.field({ time, openDoors: new Set(), mercLights: [] }),
    openStructures: new Set(),
    revealedRooms: new Set(),
    soldiers: [],
    items: [],
    uiNodes: uiNodes(),
  });
  renderer.present(null, canvas.height, 0, 0, zoom);
  debug.quads = stats.instances;
  debug.drawCalls = stats.drawCalls;
  debug.stats = stats;
  debug.camera = camera;
  radar.drawViewport({ ...v, camera });
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

async function open(path: string): Promise<void> {
  debug.ready = false;
  setStatus(`loading ${path}…`);
  try {
    const loaded = await loadWorld(path, available);
    world = loaded;
    lighting = new WorldLighting(loaded.tactical);
    renderer.setWorld(renderWorldOf(loaded));
    limits = scrollLimits(loaded.map.info.restrictedScrollId);
    hoverTile = loaded.tables.tileIndexByName.has('FIRSTPOINTERS1') ? tileIndex(loaded.tables, 'FIRSTPOINTERS1') : -1;
    const center = loaded.map.info.centerGridNo;
    camera = setRenderCenter(cameraOnGridNo(center >= 0 && center < WORLD_MAX ? center : 80 * WORLD_COLS + 80), viewport(), limits);
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

let dragRemainder = { x: 0, y: 0 };

function pan(dx: number, dy: number): void {
  const x = dragRemainder.x + dx;
  const y = dragRemainder.y + dy;
  const next = scrollBy(camera, Math.trunc(x), Math.trunc(y), viewport(), limits);
  if (next.centerX !== camera.centerX || next.centerY !== camera.centerY) {
    camera = next;
    dragRemainder = { x: 0, y: 0 };
    requestFrame();
  } else dragRemainder = { x, y };
}

function logicalPoint(e: MouseEvent): { x: number; y: number } {
  const dpr = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  return { x: ((e.clientX - rect.left) * dpr) / zoom, y: ((e.clientY - rect.top) * dpr) / zoom };
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
  const p = logicalPoint(e);
  const g = screenToGridNo(p.x, p.y, viewport(), camera);
  if (g !== hoverGridNo) {
    hoverGridNo = g;
    debug.hoverGridNo = g;
    hover.textContent = g === null ? '' : describeTile(g);
    hover.hidden = g === null;
    requestFrame();
  }
});
window.addEventListener('keydown', (e) => {
  const moves: Record<string, [number, number]> = { ArrowLeft: [-40, 0], ArrowRight: [40, 0], ArrowUp: [0, -20], ArrowDown: [0, 20] };
  const m = moves[e.key];
  if (m) pan(m[0], m[1]);
});
for (const input of [roofs, shadows, treeTops, wireframes, roofLevel, light]) input.addEventListener('change', requestFrame);
for (const b of document.querySelectorAll<HTMLButtonElement>('[data-zoom]')) {
  b.classList.toggle('active', Number(b.dataset.zoom) === zoom);
  b.addEventListener('click', () => {
    zoom = Number(b.dataset.zoom);
    for (const other of document.querySelectorAll<HTMLButtonElement>('[data-zoom]')) other.classList.toggle('active', other === b);
    camera = setRenderCenter(camera, viewport(), limits);
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

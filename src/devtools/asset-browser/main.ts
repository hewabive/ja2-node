import type { Sti } from '../../content/formats/sti.ts';
import { fetchHealth, fetchVfsList, type Health, type VfsFile } from './api.ts';
import type { DebugHook } from './debug-hook.ts';
import { FileTree } from './file-tree.ts';
import { type Asset, hexDump, loadAsset } from './loaders.ts';
import { PictureViewer, type ViewMode } from './viewer.ts';

const SOLDIER_DIRECTIONS = 8;

const debug: DebugHook = { ready: false, current: null, frames: 0, lastQuads: 0, error: null };
window.__ja2AssetBrowser = debug;

function el<T extends HTMLElement>(id: string): T {
  const e = document.getElementById(id);
  if (!e) throw new Error(`#${id} missing`);
  return e as T;
}

const status = el('status');
const stage = el('stage');
const textView = el<HTMLPreElement>('text');
const empty = el('empty');
const info = el('info');
const hover = el('hover');
const paletteCanvas = el<HTMLCanvasElement>('palette');
const viewer = new PictureViewer(el<HTMLCanvasElement>('canvas'), stage);
viewer.onRender = (quads) => {
  debug.lastQuads = quads;
};

let current: { file: VfsFile; asset: Asset } | null = null;

function setStatus(text: string, error = false): void {
  status.textContent = text;
  status.classList.toggle('error', error);
}

function dl(rows: [string, string][]): HTMLElement {
  const d = document.createElement('dl');
  for (const [k, v] of rows) {
    const dt = document.createElement('dt');
    dt.textContent = k;
    const dd = document.createElement('dd');
    dd.textContent = v;
    d.append(dt, dd);
  }
  return d;
}

function drawPalette(rgb: Uint8Array | null): void {
  paletteCanvas.hidden = !rgb;
  if (!rgb) return;
  const ctx = paletteCanvas.getContext('2d');
  if (!ctx) return;
  for (let i = 0; i < 256; i++) {
    ctx.fillStyle = `rgb(${rgb[i * 3]}, ${rgb[i * 3 + 1]}, ${rgb[i * 3 + 2]})`;
    ctx.fillRect((i % 16) * 12, Math.floor(i / 16) * 12, 12, 12);
  }
  ctx.strokeStyle = '#d0a85c';
  ctx.strokeRect(0.5, 0.5, 11, 11);
}

function showFrameInfo(index: number | null): void {
  if (current?.asset.kind !== 'picture' || index === null) {
    hover.replaceChildren();
    return;
  }
  const pic = current.asset.picture;
  if (pic.kind !== 'indexed') return;
  const f = pic.frames[index];
  if (!f) return;
  const sti: Sti | undefined = current.asset.sti;
  const aux = sti?.kind === 'indexed' ? sti.appData?.[index] : undefined;
  const rows: [string, string][] = [
    ['frame', `${index} of ${pic.frames.length}`],
    ['size', `${f.width}×${f.height}`],
    ['offset', `${f.offsetX}, ${f.offsetY}`],
  ];
  if (aux) rows.push(['aux', JSON.stringify(aux)]);
  hover.replaceChildren(dl(rows));
}

function readHash(): URLSearchParams {
  return new URLSearchParams(location.hash.slice(1));
}

function writeHash(): void {
  const s = viewer.state;
  const h = new URLSearchParams();
  if (current) h.set('path', current.file.path);
  if (s.mode !== 'grid') h.set('mode', s.mode);
  if (s.zoom !== 2) h.set('zoom', String(s.zoom));
  if (s.groupSize !== 1) h.set('group-size', String(s.groupSize));
  if (s.group !== 0) h.set('group', String(s.group));
  if (s.playing) h.set('play', '1');
  history.replaceState(null, '', `#${h.toString()}`);
}

function syncToolbar(): void {
  const s = viewer.state;
  document.body.classList.toggle('mode-anim', s.mode === 'anim');
  for (const b of document.querySelectorAll<HTMLButtonElement>('[data-mode]')) b.classList.toggle('active', b.dataset.mode === s.mode);
  for (const b of document.querySelectorAll<HTMLButtonElement>('[data-zoom]'))
    b.classList.toggle('active', Number(b.dataset.zoom) === s.zoom);
  el<HTMLButtonElement>('play').textContent = s.playing ? '⏸' : '▶';
  el<HTMLInputElement>('fps').value = String(s.fps);
  el<HTMLInputElement>('group-size').value = String(s.groupSize);
  el<HTMLInputElement>('group').value = String(s.group);
}

async function open(file: VfsFile): Promise<void> {
  setStatus(`loading ${file.path}…`);
  try {
    const asset = await loadAsset(file.path);
    current = { file, asset };
    debug.current = file.path;
    debug.error = null;
    const rows: [string, string][] = [
      ['layer', file.layer],
      ['size', `${file.size} bytes`],
    ];
    textView.hidden = true;
    empty.hidden = true;
    if (asset.kind === 'picture') {
      const p = asset.picture;
      rows.push(['format', asset.format]);
      if (p.kind === 'indexed') {
        rows.push(['frames', String(p.frames.length)]);
        const looksLikeSoldierAnimation = p.frames.length % SOLDIER_DIRECTIONS === 0 && p.frames.length > SOLDIER_DIRECTIONS;
        if (viewer.state.groupSize === 1 && looksLikeSoldierAnimation) viewer.state.groupSize = p.frames.length / SOLDIER_DIRECTIONS;
      } else {
        rows.push(['image', `${p.width}×${p.height}`]);
      }
      viewer.show(p);
      debug.frames = viewer.frameCount;
      drawPalette(p.kind === 'indexed' ? p.palette : null);
    } else {
      viewer.show(null);
      debug.frames = 0;
      drawPalette(null);
      textView.hidden = false;
      textView.textContent = asset.kind === 'text' ? asset.text : hexDump(asset.bytes);
    }
    const title = document.createElement('h3');
    title.textContent = file.path;
    info.replaceChildren(title, dl(rows));
    showFrameInfo(null);
    viewer.update({});
    syncToolbar();
    writeHash();
    setStatus(statusLine);
  } catch (err) {
    debug.error = (err as Error).message;
    setStatus(`${file.path}: ${(err as Error).message}`, true);
  }
}

let statusLine = '';

function describeHealth(h: Health): string {
  const parts = [`files: ${h.files}`];
  parts.push(h.data.original ? `original data: ${h.data.slf} SLF` : 'original data not connected');
  parts.push(h.data.stubs ? 'stubs: yes' : 'stubs: none');
  return parts.join(' · ');
}

const tree = new FileTree(el('tree'), (f) => {
  viewer.state.groupSize = 1;
  viewer.state.group = 0;
  void open(f);
});

el<HTMLInputElement>('filter').addEventListener('input', (e) => tree.setFilter((e.target as HTMLInputElement).value));
for (const b of document.querySelectorAll<HTMLButtonElement>('[data-mode]')) {
  b.addEventListener('click', () => {
    viewer.update({ mode: b.dataset.mode as ViewMode });
    syncToolbar();
    writeHash();
  });
}
for (const b of document.querySelectorAll<HTMLButtonElement>('[data-zoom]')) {
  b.addEventListener('click', () => {
    viewer.update({ zoom: Number(b.dataset.zoom) });
    syncToolbar();
    writeHash();
  });
}
el('play').addEventListener('click', () => {
  viewer.update({ playing: !viewer.state.playing });
  syncToolbar();
  writeHash();
});
el('step').addEventListener('click', () => viewer.step());
for (const [id, key] of [
  ['fps', 'fps'],
  ['group-size', 'groupSize'],
  ['group', 'group'],
] as const) {
  el<HTMLInputElement>(id).addEventListener('change', (e) => {
    viewer.update({ [key]: Number((e.target as HTMLInputElement).value) });
    syncToolbar();
    writeHash();
  });
}
el('bg').addEventListener('click', () => {
  stage.classList.toggle('checker');
  stage.classList.toggle('flat');
});
stage.addEventListener('mousemove', (e) => {
  if (viewer.state.mode === 'grid') showFrameInfo(viewer.hitTest(e.clientX, e.clientY));
});
viewer.onFrameChange = (i) => {
  if (viewer.state.mode === 'anim') showFrameInfo(i);
};

async function applyHash(): Promise<void> {
  const h = readHash();
  viewer.update({
    mode: h.get('mode') === 'anim' ? 'anim' : 'grid',
    zoom: Number(h.get('zoom') ?? 2) || 2,
    groupSize: Number(h.get('group-size') ?? 1) || 1,
    group: Number(h.get('group') ?? 0) || 0,
    playing: h.get('play') === '1',
  });
  syncToolbar();
  const path = h.get('path');
  const file = path && path !== current?.file.path ? tree.reveal(path) : undefined;
  if (file) await open(file);
}

async function start(): Promise<void> {
  try {
    const [health, files] = await Promise.all([fetchHealth(), fetchVfsList()]);
    statusLine = describeHealth(health);
    setStatus(statusLine);
    tree.setFiles(files);
    await applyHash();
    window.addEventListener('hashchange', () => {
      debug.ready = false;
      void applyHash().then(() => {
        debug.ready = true;
      });
    });
    debug.ready = true;
  } catch (err) {
    debug.error = (err as Error).message;
    setStatus(`no connection to the server: ${(err as Error).message}. Run pnpm dev.`, true);
  }
}

void start();

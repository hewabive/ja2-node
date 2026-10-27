import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { CORPSES_TABLE_PATH, parseCorpseTable } from '../src/content/anim/corpses.ts';
import { encodeStiIndexed, type StiAppData, type StiSubImage } from '../src/content/formats/sti.ts';
import { SMOKE_EFFECTS_PATH } from '../src/content/items/explosions.ts';
import { PROJECT_DATA_DIR } from '../src/node/repo.ts';
import { color, type RampName } from './palette.ts';
import { IndexedRaster } from './raster.ts';

const DIRECTIONS = 8;
const SHADOW_INDEX = 254;
const SMOKE_FRAMES = 12;
const BODY_WIDTH = 30;
const BODY_HEIGHT = 18;
const PUFF_SIZE = 32;
const MINIBOOM_PATH = 'tilecache/miniboom.sti';
const MINIBOOM_FRAMES = 13;
const MINIBOOM_PEAK_FRAME = 5;
const SMOKE_RAMPS: Readonly<Record<string, RampName>> = { SMOKE: 'gray', TEARGAS: 'sand', MUSTARDGAS: 'olive', CREATUREGAS: 'teal' };
const SCREEN_VECTOR_BY_DIRECTION: readonly (readonly [number, number])[] = [
  [0.7, -0.35],
  [1, 0],
  [0.7, 0.35],
  [0, 1],
  [-0.7, 0.35],
  [-1, 0],
  [-0.7, -0.35],
  [0, -1],
];

function appData(frames: number, count: number): StiAppData[] {
  return Array.from({ length: count }, (_, i) => ({
    wallOrientation: 0,
    numberOfTiles: 0,
    tileLocationIndex: 0,
    currentFrame: 0,
    numberOfFrames: i === 0 ? frames : 0,
    flags: 0,
  }));
}

function lyingBody(block: number): StiSubImage {
  const r = new IndexedRaster(BODY_WIDTH, BODY_HEIGHT);
  const direction = (block + DIRECTIONS - 1) % DIRECTIONS;
  const [vx, vy] = SCREEN_VECTOR_BY_DIRECTION[direction] ?? [1, 0];
  const cx = BODY_WIDTH / 2;
  const cy = BODY_HEIGHT / 2;
  r.ellipse(cx + 2, cy + 3, 11, 4, () => SHADOW_INDEX);
  r.line(cx - vx * 9, cy - vy * 5, cx + vx * 9, cy + vy * 5, color('green', 7));
  r.line(cx - vx * 9, cy - vy * 5 + 1, cx + vx * 9, cy + vy * 5 + 1, color('khaki', 5));
  r.ellipse(cx + vx * 10, cy + vy * 6, 2.5, 2.5, () => color('skin', 8));
  r.ellipse(cx - vx * 4, cy - vy * 2, 2, 2, () => color('red', 6));
  return { offsetX: -cx, offsetY: -cy - 4, width: r.width, height: r.height, pixels: r.pixels };
}

function puff(frame: number, ramp: RampName, scale: number): StiSubImage {
  const size = Math.round(PUFF_SIZE * scale);
  const r = new IndexedRaster(size, size);
  const phase = (frame / SMOKE_FRAMES) * Math.PI * 2;
  for (let k = 0; k < 3; k++) {
    const a = phase + (k * Math.PI * 2) / 3;
    r.ellipse(size / 2 + Math.cos(a) * size * 0.15, size / 2 + Math.sin(a) * size * 0.1, size * 0.28, size * 0.22, (nx, ny) =>
      color(ramp, 10 - nx * 2 - ny * 2),
    );
  }
  return { offsetX: -size / 2, offsetY: -size + 4, width: size, height: size, pixels: r.pixels };
}

function miniboom(frame: number): StiSubImage {
  const growth = frame <= MINIBOOM_PEAK_FRAME ? frame : MINIBOOM_PEAK_FRAME;
  const radius = 1.5 + growth * 2;
  const size = Math.ceil(radius * 2) + 1;
  const r = new IndexedRaster(size, size);
  const fade = Math.max(0, frame - MINIBOOM_PEAK_FRAME);
  r.ellipse(radius, radius, radius, radius, (nx, ny) => color(fade > 3 ? 'gray' : 'orange', 13 - fade - (nx + ny) * 3));
  return { offsetX: -Math.round(radius), offsetY: -Math.round(radius), width: size, height: size, pixels: r.pixels };
}

async function writeSti(
  out: string,
  path: string,
  palette: Uint8Array,
  subImages: readonly StiSubImage[],
  frames: number,
): Promise<string> {
  const file = join(out, path);
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, encodeStiIndexed({ palette, subImages, appData: appData(frames, subImages.length) }));
  return path;
}

interface SmokeGraphicsEntry {
  readonly name: string;
  readonly graphics?: string;
  readonly dissipatingGraphics?: string;
  readonly staticGraphics?: string;
}

export async function buildStubEffects(out: string, palette: Uint8Array): Promise<string[]> {
  const written: string[] = [];
  const table = parseCorpseTable(JSON.parse(await readFile(join(PROJECT_DATA_DIR, CORPSES_TABLE_PATH), 'utf8')));
  const corpseFiles = new Set([...table.files, ...table.noBloodFiles].filter((f) => f.length > 0));
  const bodies = Array.from({ length: DIRECTIONS }, (_, block) => lyingBody(block));
  for (const path of [...corpseFiles].sort()) written.push(await writeSti(out, path, palette, bodies, 1));
  const smoke = JSON.parse(await readFile(join(PROJECT_DATA_DIR, SMOKE_EFFECTS_PATH), 'utf8')) as SmokeGraphicsEntry[];
  const smokeFiles = new Map<string, { ramp: RampName; scale: number }>();
  for (const s of smoke) {
    const ramp = SMOKE_RAMPS[s.name] ?? 'gray';
    if (s.graphics) smokeFiles.set(s.graphics, { ramp, scale: 1 });
    if (s.dissipatingGraphics && !smokeFiles.has(s.dissipatingGraphics)) smokeFiles.set(s.dissipatingGraphics, { ramp, scale: 0.7 });
    if (s.staticGraphics && !smokeFiles.has(s.staticGraphics)) smokeFiles.set(s.staticGraphics, { ramp, scale: 0.85 });
  }
  for (const [path, look] of [...smokeFiles].sort(([a], [b]) => a.localeCompare(b))) {
    const frames = Array.from({ length: SMOKE_FRAMES }, (_, f) => puff(f, look.ramp, look.scale));
    written.push(await writeSti(out, path, palette, frames, SMOKE_FRAMES));
  }
  const boom = Array.from({ length: MINIBOOM_FRAMES }, (_, f) => miniboom(f));
  written.push(await writeSti(out, MINIBOOM_PATH, palette, boom, MINIBOOM_FRAMES));
  return written;
}

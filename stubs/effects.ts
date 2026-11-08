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
const KNIFE_PATH = 'tilecache/knifing.sti';
const VAPORIZE_PATH = 'tilecache/gen_blow.sti';
const VAPORIZE_FRAMES = 10;
const VAPORIZE_PEAK_FRAME = 3;
const VAPORIZE_DROPS = 9;
const TRAIL_FRAMES = 9;
const TRAILS: readonly { readonly path: string; readonly ramp: RampName; readonly size: number }[] = [
  { path: 'tilecache/msle_smk.sti', ramp: 'gray', size: 14 },
  { path: 'tilecache/msle_sma.sti', ramp: 'gray', size: 7 },
  { path: 'tilecache/msle_spt.sti', ramp: 'olive', size: 14 },
];
const KNIFE_SPIN_FRAMES = 4;
const KNIFE_LENGTH = 7;
const CROW_SHADOW_PATH = 'tilecache/fly_shdw.sti';
const CROW_SHADOW_FRAMES = 4;
const CROW_SHADOW_SIZE = 16;
const CROW_WING_SPANS = [7, 5, 3, 5];
const HELICOPTER_SHADOW_PATH = 'tilecache/heli_sh.sti';
const HELICOPTER_SHADOW_FRAMES = 4;
const HELICOPTER_SHADOW_WIDTH = 96;
const HELICOPTER_SHADOW_HEIGHT = 56;
const ROTOR_REACH = 34;
const ROTOR_BLADES = 2;
const ROTOR_TURN_PER_FRAME = Math.PI / (ROTOR_BLADES * HELICOPTER_SHADOW_FRAMES);
const ISOMETRIC_SQUASH = 0.5;
const FLIGHT_ON_SCREEN: readonly [number, number] = [-0.89, 0.45];
const NOSE_REACH = 14;
const TAIL_ROOT = 8;
const TAIL_REACH = 36;
const FUSELAGE_HALF_WIDTH = 4;
const TAIL_ROTOR_HALF = 5;
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

function bodyBlow(frame: number): StiSubImage {
  const growth = Math.min(frame, VAPORIZE_PEAK_FRAME) + 1;
  const size = 8 + growth * 6;
  const r = new IndexedRaster(size, size);
  const fade = Math.max(0, frame - VAPORIZE_PEAK_FRAME);
  for (let k = 0; k < VAPORIZE_DROPS; k++) {
    const a = (k * Math.PI * 2) / VAPORIZE_DROPS + frame * 0.3;
    const reach = (size / 2 - 2) * Math.min(1, (frame + 1) / (VAPORIZE_PEAK_FRAME + 1));
    r.ellipse(size / 2 + Math.cos(a) * reach, size / 2 + Math.sin(a) * reach * 0.6, 1.5, 1.2, () => color('red', 8 - Math.min(fade, 4)));
  }
  if (frame <= VAPORIZE_PEAK_FRAME) r.ellipse(size / 2, size / 2, growth * 2, growth * 1.5, (nx, ny) => color('red', 10 - nx - ny));
  return { offsetX: -size / 2, offsetY: -size + 4, width: size, height: size, pixels: r.pixels };
}

function trailPuff(frame: number, ramp: RampName, largest: number): StiSubImage {
  const radius = 1 + ((largest / 2 - 1) * (frame + 1)) / TRAIL_FRAMES;
  const size = Math.ceil(radius * 2) + 1;
  const r = new IndexedRaster(size, size);
  r.ellipse(radius, radius, radius, radius, (nx, ny) => color(ramp, 12 - frame / 2 - nx - ny));
  return { offsetX: -Math.round(radius), offsetY: -Math.round(radius), width: size, height: size, pixels: r.pixels };
}

function knifeFrame(block: number, spin: number): StiSubImage {
  const [vx, vy] = SCREEN_VECTOR_BY_DIRECTION[block] ?? [1, 0];
  const angle = Math.atan2(vy, vx) + (spin * Math.PI) / 2;
  const size = KNIFE_LENGTH + 1;
  const r = new IndexedRaster(size, size);
  const half = KNIFE_LENGTH / 2;
  const dx = Math.cos(angle) * half;
  const dy = Math.sin(angle) * half;
  r.line(half - dx, half - dy, half + dx, half + dy, color('steel', 13));
  r.set(Math.round(half - dx), Math.round(half - dy), color('brown', 5));
  return { offsetX: -Math.round(half), offsetY: -Math.round(half), width: size, height: size, pixels: r.pixels };
}

function crowShadow(block: number, flap: number): StiSubImage {
  const direction = (block + DIRECTIONS - 1) % DIRECTIONS;
  const [vx, vy] = SCREEN_VECTOR_BY_DIRECTION[direction] ?? [1, 0];
  const r = new IndexedRaster(CROW_SHADOW_SIZE, CROW_SHADOW_SIZE);
  const c = CROW_SHADOW_SIZE / 2;
  const span = CROW_WING_SPANS[flap] ?? 5;
  r.line(c - vx * 3, c - vy * 2, c + vx * 3, c + vy * 2, SHADOW_INDEX);
  r.line(c - vy * span, c + vx * span * 0.5, c + vy * span, c - vx * span * 0.5, SHADOW_INDEX);
  return { offsetX: -c, offsetY: -c, width: r.width, height: r.height, pixels: r.pixels };
}

function stroke(r: IndexedRaster, x0: number, y0: number, x1: number, y1: number, halfWidth: number): void {
  const [fx, fy] = FLIGHT_ON_SCREEN;
  for (let k = -halfWidth; k <= halfWidth; k++) r.line(x0 - fy * k, y0 + fx * k, x1 - fy * k, y1 + fx * k, SHADOW_INDEX);
}

function helicopterShadow(frame: number): StiSubImage {
  const r = new IndexedRaster(HELICOPTER_SHADOW_WIDTH, HELICOPTER_SHADOW_HEIGHT);
  const cx = HELICOPTER_SHADOW_WIDTH / 2;
  const cy = HELICOPTER_SHADOW_HEIGHT / 2;
  const [fx, fy] = FLIGHT_ON_SCREEN;
  stroke(r, cx + fx * NOSE_REACH, cy + fy * NOSE_REACH, cx - fx * TAIL_ROOT, cy - fy * TAIL_ROOT, FUSELAGE_HALF_WIDTH);
  stroke(r, cx - fx * TAIL_ROOT, cy - fy * TAIL_ROOT, cx - fx * TAIL_REACH, cy - fy * TAIL_REACH, 1);
  const tx = cx - fx * TAIL_REACH;
  const ty = cy - fy * TAIL_REACH;
  r.line(tx - fy * TAIL_ROTOR_HALF, ty + fx * TAIL_ROTOR_HALF, tx + fy * TAIL_ROTOR_HALF, ty - fx * TAIL_ROTOR_HALF, SHADOW_INDEX);
  for (let blade = 0; blade < ROTOR_BLADES; blade++) {
    const a = frame * ROTOR_TURN_PER_FRAME + (blade * Math.PI) / ROTOR_BLADES;
    const dx = Math.cos(a) * ROTOR_REACH;
    const dy = Math.sin(a) * ROTOR_REACH * ISOMETRIC_SQUASH;
    r.line(cx - dx, cy - dy, cx + dx, cy + dy, SHADOW_INDEX);
  }
  return { offsetX: -cx, offsetY: -cy, width: r.width, height: r.height, pixels: r.pixels };
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
  const blow = Array.from({ length: VAPORIZE_FRAMES }, (_, f) => bodyBlow(f));
  written.push(await writeSti(out, VAPORIZE_PATH, palette, blow, VAPORIZE_FRAMES));
  const knife = Array.from({ length: DIRECTIONS * KNIFE_SPIN_FRAMES }, (_, f) =>
    knifeFrame(Math.floor(f / KNIFE_SPIN_FRAMES), f % KNIFE_SPIN_FRAMES),
  );
  written.push(await writeSti(out, KNIFE_PATH, palette, knife, KNIFE_SPIN_FRAMES));
  const crow = Array.from({ length: DIRECTIONS * CROW_SHADOW_FRAMES }, (_, f) =>
    crowShadow(Math.floor(f / CROW_SHADOW_FRAMES), f % CROW_SHADOW_FRAMES),
  );
  written.push(await writeSti(out, CROW_SHADOW_PATH, palette, crow, CROW_SHADOW_FRAMES));
  const helicopter = Array.from({ length: HELICOPTER_SHADOW_FRAMES }, (_, f) => helicopterShadow(f));
  written.push(await writeSti(out, HELICOPTER_SHADOW_PATH, palette, helicopter, HELICOPTER_SHADOW_FRAMES));
  for (const trail of TRAILS) {
    const puffs = Array.from({ length: TRAIL_FRAMES }, (_, f) => trailPuff(f, trail.ramp, trail.size));
    written.push(await writeSti(out, trail.path, palette, puffs, TRAIL_FRAMES));
  }
  return written;
}

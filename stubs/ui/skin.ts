import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { encodePcx } from '../../src/content/formats/pcx.ts';
import { encodeStiIndexed, type StiAppData, type StiSubImage } from '../../src/content/formats/sti.ts';
import { STUB_DATA_VERSION } from '../../src/content/text/data-version.ts';
import { PROJECT_DATA_DIR } from '../../src/node/repo.ts';
import { LayoutLoader } from '../../src/ui/layout/loader.ts';
import type { LayoutModel } from '../../src/ui/layout/model.ts';
import { collectReferences } from '../../src/ui/layout/references.ts';
import { LAYOUTS_DIR, ORIGINAL_SKIN, type StubFrameState } from '../../src/ui/layout/types.ts';
import { buildPalette, color } from '../palette.ts';
import { IndexedRaster } from '../raster.ts';
import { labelFont, labelHeight, labelWidth, stampLabel } from './label.ts';

export const DEFAULT_STUB_SIZE: readonly [number, number] = [32, 32];
const BEVEL = 1;
const LABEL_MARGIN = 2;
const AUX_ANIMATED_TILE = 0x02;

export interface FramePlan {
  width: number;
  height: number;
  state: StubFrameState;
  hollow: boolean;
}

export interface StubAssetPlan {
  readonly path: string;
  readonly kind: 'sti' | 'pcx';
  readonly frames: FramePlan[];
  readonly animated: number;
  readonly layouts: string[];
}

const FILLS: Readonly<Record<StubFrameState, number>> = {
  plain: color('steel', 6),
  normal: color('ui', 7),
  hover: color('ui', 10),
  pressed: color('ui', 4),
  pressedHover: color('ui', 6),
  grayed: color('gray', 5),
};

export async function readOriginalLayouts(): Promise<LayoutModel[]> {
  const loader = new LayoutLoader(async (path) => {
    try {
      return await readFile(join(PROJECT_DATA_DIR, path), 'utf8');
    } catch {
      return null;
    }
  }, STUB_DATA_VERSION);
  const dir = join(PROJECT_DATA_DIR, LAYOUTS_DIR, ORIGINAL_SKIN);
  const files = (await readdir(dir)).filter((f) => f.endsWith('.json')).sort();
  return Promise.all(files.map((f) => loader.load(ORIGINAL_SKIN, f.replace(/\.json$/, ''))));
}

function sizeOf(model: LayoutModel, value: readonly [unknown, unknown] | undefined): [number, number] | null {
  if (!value) return null;
  return [model.number(value[0] as number | string), model.number(value[1] as number | string)];
}

export function planStubSkin(models: readonly LayoutModel[]): Map<string, StubAssetPlan> {
  const plans = new Map<string, StubAssetPlan>();
  for (const model of models) {
    const refs = collectReferences(model);
    if (refs.problems.length > 0) throw new Error(refs.problems.join('\n'));
    for (const use of refs.assets.values()) {
      const { asset } = use;
      const stub = asset.stub;
      const sizes = (stub?.sizes ?? []).map((s) => sizeOf(model, s) as [number, number]);
      const size = sizeOf(model, stub?.size);
      const declared = stub?.frames === undefined ? 0 : model.number(stub.frames as number | string);
      const used = Math.max(-1, ...use.frames.keys()) + 1;
      const count = Math.max(1, declared, sizes.length, used);
      const plan = plans.get(asset.path) ?? { path: asset.path, kind: asset.kind, frames: [], animated: 0, layouts: [] };
      plan.layouts.push(model.json.screen);
      for (let i = 0; i < count; i++) {
        const [width, height] = sizes[i] ?? size ?? DEFAULT_STUB_SIZE;
        const state = use.frames.get(i) ?? stub?.states?.[i] ?? 'plain';
        const known = plan.frames[i];
        if (known && (known.width !== width || known.height !== height))
          throw new Error(
            `${asset.path} frame ${i}: ${plan.layouts.join(', ')} declare ${known.width}×${known.height} and ${width}×${height}`,
          );
        const hollow = stub?.hollow === true || (Array.isArray(stub?.hollow) && stub.hollow.includes(i));
        if (!known) plan.frames[i] = { width, height, state, hollow };
        else if (hollow) known.hollow = true;
        else if (known.state === 'plain') known.state = state;
      }
      const animated = stub?.animated === undefined ? 0 : model.number(stub.animated as number | string);
      plans.set(asset.path, { ...plan, animated: Math.max(plan.animated, animated) });
    }
  }
  return plans;
}

function bevelled(width: number, height: number, state: StubFrameState): IndexedRaster {
  const raster = new IndexedRaster(width, height);
  raster.rect(0, 0, width, height, FILLS[state]);
  if (width <= 2 * BEVEL || height <= 2 * BEVEL) return raster;
  const sunken = state === 'pressed' || state === 'pressedHover';
  const light = color(state === 'grayed' ? 'gray' : 'ui', 13);
  const dark = color(state === 'grayed' ? 'gray' : 'ui', 2);
  for (let x = 0; x < width; x++) {
    raster.set(x, 0, sunken ? dark : light);
    raster.set(x, height - 1, sunken ? light : dark);
  }
  for (let y = 0; y < height; y++) {
    raster.set(0, y, sunken ? dark : light);
    raster.set(width - 1, y, sunken ? light : dark);
  }
  return raster;
}

function outlined(width: number, height: number): IndexedRaster {
  const raster = new IndexedRaster(width, height);
  const ink = color('ui', 13);
  for (let x = 0; x < width; x++) {
    raster.set(x, 0, ink);
    raster.set(x, height - 1, ink);
  }
  for (let y = 0; y < height; y++) {
    raster.set(0, y, ink);
    raster.set(width - 1, y, ink);
  }
  return raster;
}

async function frameImage(name: string, index: number, frame: FramePlan): Promise<IndexedRaster> {
  const raster = frame.hollow ? outlined(frame.width, frame.height) : bevelled(frame.width, frame.height, frame.state);
  const font = await labelFont();
  const label = `${name}#${index}`;
  const short = String(index);
  const ink = color(frame.state === 'grayed' ? 'gray' : 'ui', 15);
  const fits = (text: string) =>
    labelWidth(font, text) + 2 * LABEL_MARGIN <= frame.width && labelHeight(font) + 2 * LABEL_MARGIN <= frame.height;
  const text = fits(label) ? label : fits(short) ? short : null;
  if (text) stampLabel(raster, font, text, LABEL_MARGIN, LABEL_MARGIN, ink);
  return raster;
}

function baseName(path: string): string {
  return (path.split('/').at(-1) ?? path).replace(/\.(sti|pcx)$/, '');
}

export async function encodeStubAsset(plan: StubAssetPlan): Promise<Uint8Array> {
  const name = baseName(plan.path);
  if (plan.kind === 'pcx') {
    const frame = plan.frames[0] as FramePlan;
    const raster = await frameImage(name, 0, frame);
    return encodePcx(raster.width, raster.height, raster.pixels, buildPalette());
  }
  const subImages: StiSubImage[] = [];
  for (const [i, frame] of plan.frames.entries()) {
    const raster = await frameImage(name, i, frame);
    subImages.push({ offsetX: 0, offsetY: 0, width: raster.width, height: raster.height, pixels: raster.pixels });
  }
  const appData: StiAppData[] | undefined =
    plan.animated > 0
      ? subImages.map(() => ({
          wallOrientation: 0,
          numberOfTiles: 0,
          tileLocationIndex: 0,
          currentFrame: 0,
          numberOfFrames: plan.animated,
          flags: AUX_ANIMATED_TILE,
        }))
      : undefined;
  return encodeStiIndexed({ palette: buildPalette(), subImages, ...(appData ? { appData } : {}) });
}

export async function buildStubSkin(out: string, exists: (path: string) => boolean): Promise<string[]> {
  const written: string[] = [];
  for (const plan of planStubSkin(await readOriginalLayouts()).values()) {
    if (exists(plan.path)) continue;
    const target = join(out, plan.path);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, await encodeStubAsset(plan));
    written.push(plan.path);
  }
  return written.sort();
}

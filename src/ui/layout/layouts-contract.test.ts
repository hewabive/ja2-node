import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ORIGINAL_DATA_DIR } from '../../../tests/support/original-data.ts';
import { sharedStubPackDir } from '../../../tests/support/stub-pack.ts';
import { decodePcx } from '../../content/formats/pcx.ts';
import { decodeSti } from '../../content/formats/sti.ts';
import { type DataVersion, DEFAULT_VANILLA_VERSION, STUB_DATA_VERSION } from '../../content/text/data-version.ts';
import { type DataVfs, openDataVfs, STUBS_PREFIX } from '../../node/data-vfs.ts';
import { PROJECT_DATA_DIR } from '../../node/repo.ts';
import { LAYOUT_CONTRACTS } from '../screens/contracts.ts';
import { LayoutLoader } from './loader.ts';
import type { LayoutModel, ResolvedAsset } from './model.ts';
import { collectReferences } from './references.ts';
import { LAYOUTS_DIR, type WidgetJson } from './types.ts';

interface LayoutFile {
  readonly skin: string;
  readonly screen: string;
}

async function layoutFiles(): Promise<LayoutFile[]> {
  const root = join(PROJECT_DATA_DIR, LAYOUTS_DIR);
  const files: LayoutFile[] = [];
  for (const skin of await readdir(root)) {
    for (const file of await readdir(join(root, skin)))
      if (file.endsWith('.json')) files.push({ skin, screen: file.replace(/\.json$/, '') });
  }
  return files;
}

function loader(version: DataVersion): LayoutLoader {
  return new LayoutLoader(async (path) => {
    try {
      return await readFile(join(PROJECT_DATA_DIR, path), 'utf8');
    } catch {
      return null;
    }
  }, version);
}

async function loadAll(version: DataVersion): Promise<LayoutModel[]> {
  const l = loader(version);
  return Promise.all((await layoutFiles()).map((f) => l.load(f.skin, f.screen)));
}

function frameCount(bytes: Uint8Array, asset: ResolvedAsset): { count: number; width: number; height: number } {
  if (asset.kind === 'pcx') {
    const pcx = decodePcx(bytes);
    return { count: 1, width: pcx.width, height: pcx.height };
  }
  const sti = decodeSti(bytes, false);
  if (sti.kind === 'rgb') return { count: 1, width: sti.width, height: sti.height };
  return { count: sti.subImages.length, width: sti.width, height: sti.height };
}

function textsWithoutShadow(widgets: readonly WidgetJson[]): string[] {
  return widgets.flatMap((w) => {
    const own = w.type === 'text' && w.shadow === undefined ? [w.id ?? 'text'] : [];
    const buttonText =
      w.type === 'button' && typeof w.text === 'object' && w.text !== null && !('shadow' in w.text) ? [w.id ?? 'button'] : [];
    const children =
      w.template === undefined ? [] : textsWithoutShadow((Array.isArray(w.template) ? w.template : [w.template]) as WidgetJson[]);
    return [...own, ...buttonText, ...children];
  });
}

describe('every layout of every skin', () => {
  let models: LayoutModel[];
  let l10n: Readonly<Record<string, number | null>>;

  beforeAll(async () => {
    models = await loadAll(STUB_DATA_VERSION);
    l10n = JSON.parse(await readFile(join(PROJECT_DATA_DIR, 'tables/l10n.json'), 'utf8')).translation;
  });

  it('passes the schema and names a known controller', async () => {
    expect((await layoutFiles()).length).toBeGreaterThanOrEqual(2);
    for (const model of models) expect(LAYOUT_CONTRACTS[model.json.screen], model.json.screen).toBeDefined();
  });

  it('binds what its controller declares and marks the rest unsupported', () => {
    for (const model of models) {
      const contract = LAYOUT_CONTRACTS[model.json.screen];
      if (!contract) continue;
      const refs = collectReferences(model);
      expect(refs.problems, model.json.screen).toEqual([]);
      const unsupported = new Set(model.json.unsupported ?? []);
      for (const binding of refs.bindings)
        expect(Object.keys(contract.bindings), `${model.json.screen} binds ${binding}`).toContain(binding);
      for (const action of refs.actions) expect(Object.keys(contract.actions), `${model.json.screen} calls ${action}`).toContain(action);
      for (const binding of Object.keys(contract.bindings))
        expect(refs.bindings.has(binding) || unsupported.has(binding), `${model.json.screen} leaves ${binding} unbound`).toBe(true);
      for (const action of Object.keys(contract.actions))
        expect(refs.actions.has(action) || unsupported.has(action), `${model.json.screen} leaves ${action} unused`).toBe(true);
    }
  });

  it('carries provenance, uses literal text only in debug layouts and declares a stub size for every asset', () => {
    for (const model of models) {
      if (model.json['@src'] !== undefined) expect(model.json['@derived'], model.json.screen).toContain('SFI-SCLA');
      const refs = collectReferences(model);
      if (!model.debug) {
        expect(refs.literals, model.json.screen).toEqual([]);
        expect(textsWithoutShadow(model.json.widgets ?? []), `${model.json.screen} gives every text its shadow`).toEqual([]);
      }
      for (const [name, use] of refs.assets) {
        const stub = use.asset.stub;
        expect(stub?.size !== undefined || stub?.sizes !== undefined, `${model.json.screen} asset ${name} has no stub size`).toBe(true);
      }
    }
  });

  it('names only known fonts, cursors and string keys', () => {
    for (const model of models) {
      const refs = collectReferences(model);
      for (const font of refs.fonts) expect(() => model.font(font), `${model.json.screen} font ${font}`).not.toThrow();
      for (const cursor of refs.cursors) expect(() => model.cursor(cursor), `${model.json.screen} cursor ${cursor}`).not.toThrow();
      for (const [table, index] of refs.strings) {
        expect(table in l10n, `${model.json.screen} table ${table}`).toBe(true);
        const size = l10n[table];
        if (typeof size === 'number') expect(index, `${model.json.screen} ${table}[${index}]`).toBeLessThan(size);
      }
    }
  });

  describe('on the stub pack', () => {
    let data: DataVfs;

    beforeAll(async () => {
      data = await openDataVfs({ projectDataDir: PROJECT_DATA_DIR, stubsDir: sharedStubPackDir() });
    });

    afterAll(async () => {
      await data.close();
    });

    it('resolves every asset, frame and EDT file', async () => {
      for (const model of models) {
        for (const [file] of collectReferences(model).edts)
          expect(data.vfs.stat(`${STUBS_PREFIX}/${file}`), `${model.json.screen} ${file}`).toBeDefined();
        for (const [name, use] of collectReferences(model).assets) {
          const path = `${STUBS_PREFIX}/${use.asset.path}`;
          expect(data.vfs.stat(path), `${model.json.screen} asset ${name} (${path})`).toBeDefined();
          const { count } = frameCount(await data.vfs.read(path), use.asset);
          for (const frame of use.frames.keys()) expect(frame, `${model.json.screen} ${name} frame ${frame}`).toBeLessThan(count);
        }
      }
    });
  });
});

describe.skipIf(!ORIGINAL_DATA_DIR)('every original layout on the original data', () => {
  let data: DataVfs;
  let models: LayoutModel[];

  beforeAll(async () => {
    data = await openDataVfs({ projectDataDir: PROJECT_DATA_DIR, dataDir: ORIGINAL_DATA_DIR });
    models = (await loadAll(DEFAULT_VANILLA_VERSION)).filter((m) => m.json['@derived'] !== undefined);
  });

  afterAll(async () => {
    await data.close();
  });

  it('resolves every asset and frame, and the backgrounds cover the boxes the code sizes by constants', async () => {
    for (const model of models) {
      for (const [file] of collectReferences(model).edts) expect(data.vfs.stat(file), `${model.json.screen} ${file}`).toBeDefined();
      for (const [name, use] of collectReferences(model).assets) {
        const stat = data.vfs.stat(use.asset.path);
        expect(stat, `${model.json.screen} asset ${name} (${use.asset.path})`).toBeDefined();
        const picture = frameCount(await data.vfs.read(use.asset.path), use.asset);
        for (const frame of use.frames.keys()) expect(frame, `${model.json.screen} ${name} frame ${frame}`).toBeLessThan(picture.count);
        const stub = use.asset.stub?.size;
        if (use.asset.kind === 'pcx' && stub && typeof stub[0] === 'string' && typeof stub[1] === 'string') {
          expect(picture.width, `${model.json.screen} ${name} width`).toBeGreaterThanOrEqual(model.number(stub[0] as number | string) - 1);
          expect(picture.height, `${model.json.screen} ${name} height`).toBeGreaterThanOrEqual(
            model.number(stub[1] as number | string) - 1,
          );
        }
      }
    }
  });
});

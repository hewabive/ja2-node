import { type DataVersion, displayLanguageOf, edtEncodingOf, glyphTablePath, STUB_DATA_VERSION } from '../../content/text/data-version.ts';
import { EDT_LAYOUTS_PATH, EdtLayouts } from '../../content/text/edt-layouts.ts';
import { loadUiStrings } from '../../content/text/strings.ts';
import { CURSORS_TABLE_PATH, type CursorTable, cursorFilePaths, parseCursorTable } from '../../ui/cursors/cursor-table.ts';
import type { AssetKey } from '../../ui/draw-list.ts';
import { LayoutLoader } from '../../ui/layout/loader.ts';
import type { LayoutModel } from '../../ui/layout/model.ts';
import { collectReferences } from '../../ui/layout/references.ts';
import { ORIGINAL_SKIN } from '../../ui/layout/types.ts';
import { UiRuntime } from '../../ui/runtime.ts';
import { fontIdOfPath } from '../../ui/text/bitmap-font.ts';
import { EdtTextCache } from '../../ui/text/edt-text.ts';
import { FONTS_TABLE_PATH, type FontFiles, type FontSet, parseFontFiles } from '../../ui/text/fonts.ts';
import { NO_TEXT, StringsTextService, type UiTextService } from '../../ui/text/text-service.ts';
import { AssetCache } from '../assets/asset-cache.ts';
import type { HttpAssetSource } from '../assets/asset-source.ts';
import { pageAssetSource } from '../assets/page-assets.ts';
import { fetchHealth } from '../net/vfs.ts';
import { loadSettings } from '../settings.ts';
import type { GamePage } from './game-page.ts';
import { UiAssets } from './ui-assets.ts';
import { UiAudio } from './ui-audio.ts';

export interface UiBoot {
  readonly dataVersion: DataVersion;
  readonly source: HttpAssetSource;
  readonly assets: UiAssets;
  readonly fonts: FontSet;
  readonly fontFiles: FontFiles;
  readonly cursors: CursorTable;
  readonly runtime: UiRuntime;
  readonly audio: UiAudio;
  readonly layouts: LayoutLoader;
  readonly text: UiTextService;
  readonly edt: EdtTextCache;
}

export interface BootOptions {
  readonly images?: readonly AssetKey[];
  readonly pauseGame?: (paused: boolean) => void;
}

async function textService(source: HttpAssetSource, version: DataVersion, edt: EdtTextCache): Promise<UiTextService> {
  try {
    const language = loadSettings().language ?? displayLanguageOf(version);
    return new StringsTextService(await loadUiStrings((path) => source.readOptional(path), language), (file, row) => edt.field(file, row));
  } catch {
    return NO_TEXT;
  }
}

export async function bootUi(page: GamePage, options: BootOptions = {}): Promise<UiBoot> {
  const [health, source] = await Promise.all([fetchHealth(), pageAssetSource()]);
  const dataVersion = (health.dataVersion as DataVersion | undefined) ?? STUB_DATA_VERSION;
  page.hook.dataVersion = dataVersion;
  const assets = new UiAssets(page.renderer, source, new AssetCache());
  const [fontFiles, cursors, audioTable, edtLayouts] = await Promise.all([
    assets.json(FONTS_TABLE_PATH).then((json) => parseFontFiles(json)),
    assets.json(CURSORS_TABLE_PATH).then((json) => parseCursorTable(json)),
    assets.json(UiAudio.tablePath()),
    assets.json(EDT_LAYOUTS_PATH).then((json) => EdtLayouts.parse(json)),
  ]);
  const edt = new EdtTextCache(edtLayouts, edtEncodingOf(dataVersion));
  const fontIds = [...new Set(Object.values(fontFiles).map(fontIdOfPath))];
  const [text] = await Promise.all([
    textService(source, dataVersion, edt),
    assets.preload([...(options.images ?? []), ...cursorFilePaths(cursors)], fontIds, glyphTablePath(dataVersion)),
  ]);
  const fonts = assets.fontSet(fontFiles);
  const audio = new UiAudio(source);
  audio.useTable(audioTable);
  const runtime = new UiRuntime({
    fonts,
    images: assets,
    cursors,
    geometry: () => page.geometry(),
    sounds: audio,
    ...(options.pauseGame ? { pauseGame: options.pauseGame } : {}),
  });
  page.attach(runtime);
  page.hook.sounds = audio.requests;
  const layouts = new LayoutLoader((path) => assets.text(path), dataVersion);
  return { dataVersion, source, assets, fonts, fontFiles, cursors, runtime, audio, layouts, text, edt };
}

export async function preloadLayout(boot: UiBoot, model: LayoutModel): Promise<void> {
  const refs = collectReferences(model);
  const edtFiles = [...new Set(refs.edts.map(([file]) => file))].filter((file) => !boot.edt.has(file));
  await Promise.all([
    ...[...refs.assets.values()].map((use) => boot.assets.image(use.asset.path)),
    ...edtFiles.map(async (file) => {
      const bytes = await boot.source.readOptional(file);
      if (bytes) boot.edt.add(file, bytes);
    }),
  ]);
}

export async function loadLayouts<N extends string>(boot: UiBoot, names: readonly N[], skin = ORIGINAL_SKIN): Promise<Map<N, LayoutModel>> {
  const models = await Promise.all(
    names.map(async (name) => {
      const model = await boot.layouts.load(skin, name);
      await preloadLayout(boot, model);
      return [name, model] as const;
    }),
  );
  return new Map(models);
}

import { type DataVersion, displayLanguageOf, glyphTablePath, STUB_DATA_VERSION } from '../../content/text/data-version.ts';
import { loadUiStrings } from '../../content/text/strings.ts';
import { CURSORS_TABLE_PATH, type CursorTable, cursorFilePaths, parseCursorTable } from '../../ui/cursors/cursor-table.ts';
import type { AssetKey } from '../../ui/draw-list.ts';
import { LayoutLoader } from '../../ui/layout/loader.ts';
import type { LayoutModel } from '../../ui/layout/model.ts';
import { collectReferences } from '../../ui/layout/references.ts';
import { UiRuntime } from '../../ui/runtime.ts';
import { fontIdOfPath } from '../../ui/text/bitmap-font.ts';
import { FONTS_TABLE_PATH, type FontFiles, type FontSet, parseFontFiles } from '../../ui/text/fonts.ts';
import { NO_TEXT, StringsTextService, type UiTextService } from '../../ui/text/text-service.ts';
import { AssetCache } from '../assets/asset-cache.ts';
import { HttpAssetSource } from '../assets/asset-source.ts';
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
}

export interface BootOptions {
  readonly images?: readonly AssetKey[];
}

async function textService(source: HttpAssetSource, version: DataVersion): Promise<UiTextService> {
  try {
    const language = loadSettings().language ?? displayLanguageOf(version);
    return new StringsTextService(await loadUiStrings((path) => source.readOptional(path), language));
  } catch {
    return NO_TEXT;
  }
}

export async function bootUi(page: GamePage, options: BootOptions = {}): Promise<UiBoot> {
  const health = await fetchHealth();
  const dataVersion = (health.dataVersion as DataVersion | undefined) ?? STUB_DATA_VERSION;
  page.hook.dataVersion = dataVersion;
  const source = await HttpAssetSource.open();
  const assets = new UiAssets(page.renderer, source, new AssetCache());
  const fontFiles = parseFontFiles(await assets.json(FONTS_TABLE_PATH));
  const cursors = parseCursorTable(await assets.json(CURSORS_TABLE_PATH));
  const fontIds = [...new Set(Object.values(fontFiles).map(fontIdOfPath))];
  await assets.preload([...(options.images ?? []), ...cursorFilePaths(cursors)], fontIds, glyphTablePath(dataVersion));
  const fonts = assets.fontSet(fontFiles);
  const audio = new UiAudio(source);
  audio.useTable(await assets.json(UiAudio.tablePath()));
  const runtime = new UiRuntime({ fonts, images: assets, cursors, geometry: () => page.geometry(), sounds: audio });
  page.attach(runtime);
  page.hook.sounds = audio.requests;
  const layouts = new LayoutLoader((path) => assets.text(path), dataVersion);
  return { dataVersion, source, assets, fonts, fontFiles, cursors, runtime, audio, layouts, text: await textService(source, dataVersion) };
}

export async function preloadLayout(boot: UiBoot, model: LayoutModel): Promise<void> {
  const refs = collectReferences(model);
  await Promise.all([...refs.assets.values()].map((use) => boot.assets.image(use.asset.path)));
}

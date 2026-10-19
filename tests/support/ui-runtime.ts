import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { STUB_DATA_VERSION } from '../../src/content/text/data-version.ts';
import { PROJECT_DATA_DIR } from '../../src/node/repo.ts';
import { StaticImageCatalog, uniformImage } from '../../src/ui/assets.ts';
import { CURSORS_TABLE_PATH, type CursorTable, parseCursorTable } from '../../src/ui/cursors/cursor-table.ts';
import { DrawList } from '../../src/ui/draw-list.ts';
import { MouseButton, type UiPointerEvent } from '../../src/ui/input/events.ts';
import { LayoutLoader } from '../../src/ui/layout/loader.ts';
import { UiRuntime } from '../../src/ui/runtime.ts';
import type { ScreenGeometry } from '../../src/ui/services.ts';
import type { FontSet } from '../../src/ui/text/fonts.ts';
import type { ButtonSoundRequest, UiSoundSink } from '../../src/ui/widgets/button-sounds.ts';
import { stubFontSet } from './ui-fonts.ts';

export const GEOMETRY_640: ScreenGeometry = { width: 640, height: 480, stdX: 0, stdY: 0 };

export class RecordingSounds implements UiSoundSink {
  readonly played: ButtonSoundRequest[] = [];

  play(request: ButtonSoundRequest): void {
    this.played.push(request);
  }

  names(): string[] {
    return this.played.map((r) => ('sample' in r ? r.sample : r.file));
  }
}

export async function cursorTable(): Promise<CursorTable> {
  return parseCursorTable(JSON.parse(await readFile(join(PROJECT_DATA_DIR, CURSORS_TABLE_PATH), 'utf8')));
}

export function projectLayoutLoader(): LayoutLoader {
  return new LayoutLoader(async (path) => {
    try {
      return await readFile(join(PROJECT_DATA_DIR, path), 'utf8');
    } catch {
      return null;
    }
  }, STUB_DATA_VERSION);
}

export interface TestRuntime {
  readonly runtime: UiRuntime;
  readonly images: StaticImageCatalog;
  readonly sounds: RecordingSounds;
  readonly fonts: FontSet;
  now: number;
  list: DrawList;
  frame(ms?: number): void;
  move(x: number, y: number): void;
  down(x: number, y: number, button?: number): void;
  up(x: number, y: number, button?: number): void;
  click(x: number, y: number, button?: number): void;
}

export interface TestRuntimeOptions {
  readonly pauseGame?: (paused: boolean) => void;
}

export async function testRuntime(geometry: ScreenGeometry = GEOMETRY_640, options: TestRuntimeOptions = {}): Promise<TestRuntime> {
  const fonts = await stubFontSet();
  const images = new StaticImageCatalog();
  const sounds = new RecordingSounds();
  const runtime = new UiRuntime({
    fonts,
    images,
    cursors: await cursorTable(),
    geometry: () => geometry,
    sounds,
    ...(options.pauseGame ? { pauseGame: options.pauseGame } : {}),
  });
  const pointer = (kind: UiPointerEvent['kind'], x: number, y: number, button: number): UiPointerEvent => ({
    kind,
    x,
    y,
    button,
    buttons: 0,
    wheel: 0,
    modifiers: 0,
  });
  const t: TestRuntime = {
    runtime,
    images,
    sounds,
    fonts,
    now: 0,
    list: new DrawList(),
    frame(ms = 16) {
      t.now += ms;
      t.list = new DrawList();
      runtime.frame(t.now, t.list);
    },
    move(x, y) {
      runtime.input(pointer('pointerMove', x, y, MouseButton.LEFT));
    },
    down(x, y, button = MouseButton.LEFT) {
      runtime.input(pointer('pointerDown', x, y, button));
    },
    up(x, y, button = MouseButton.LEFT) {
      runtime.input(pointer('pointerUp', x, y, button));
    },
    click(x, y, button = MouseButton.LEFT) {
      t.down(x, y, button);
      t.up(x, y, button);
    },
  };
  return t;
}

export { uniformImage };

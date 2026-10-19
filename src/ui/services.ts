import type { ImageCatalog } from './assets.ts';
import type { UiClock } from './clock.ts';
import type { RegionDispatcher } from './input/regions.ts';
import type { ScreenHost } from './screen.ts';
import type { FontSet } from './text/fonts.ts';
import type { ButtonSystem } from './widgets/button.ts';
import type { UiSoundSink } from './widgets/button-sounds.ts';

export interface ScreenGeometry {
  readonly width: number;
  readonly height: number;
  readonly stdX: number;
  readonly stdY: number;
}

export interface UiServices {
  readonly regions: RegionDispatcher;
  readonly buttons: ButtonSystem;
  readonly fonts: FontSet;
  readonly images: ImageCatalog;
  readonly sounds: UiSoundSink;
  readonly clock: UiClock;
  readonly host: ScreenHost;
  geometry(): ScreenGeometry;
  pauseGame?(paused: boolean): void;
}

import type { CapturedFrame } from '../../render/ui-draw/logical-framebuffer.ts';
import type { UiDrawStats } from '../../render/ui-draw/ui-renderer.ts';
import type { LogicalPoint } from '../../ui/resolution.ts';
import type { CursorReport } from '../../ui/runtime.ts';
import type { ButtonSoundRequest } from '../../ui/widgets/button-sounds.ts';
import type { WidgetInfo } from '../../ui/widgets/widget-info.ts';
import type { MusicHook } from '../net/music.ts';
import type { SequenceMonitor } from '../video/sequence-player.ts';

export interface CapturedPixels {
  readonly width: number;
  readonly height: number;
  readonly rgba: string;
}

export interface UiHook {
  ready: boolean;
  error: string | null;
  screen: string | null;
  modal: string | null;
  scale: number;
  origin: LogicalPoint;
  logical: { width: number; height: number };
  widgets: readonly WidgetInfo[];
  cursor: CursorReport | null;
  sounds: readonly ButtonSoundRequest[];
  frameCount: number;
  session: string | null;
  dataVersion: string | null;
  pointer: LogicalPoint | null;
  presses: number;
  draw: UiDrawStats | null;
  music: MusicHook | null;
  video: SequenceMonitor | null;
  capture(): CapturedPixels | null;
}

declare global {
  interface Window {
    __ja2Ui: UiHook;
  }
}

const BASE64_CHUNK = 0x8000;

export function base64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i += BASE64_CHUNK) binary += String.fromCharCode(...bytes.subarray(i, i + BASE64_CHUNK));
  return btoa(binary);
}

export function createUiHook(capture: () => CapturedFrame | null): UiHook {
  const hook: UiHook = {
    ready: false,
    error: null,
    screen: null,
    modal: null,
    scale: 1,
    origin: { x: 0, y: 0 },
    logical: { width: 0, height: 0 },
    widgets: [],
    cursor: null,
    sounds: [],
    frameCount: 0,
    session: null,
    dataVersion: null,
    pointer: null,
    presses: 0,
    draw: null,
    music: null,
    video: null,
    capture: () => {
      const frame = capture();
      return frame ? { width: frame.width, height: frame.height, rgba: base64(frame.rgba) } : null;
    },
  };
  window.__ja2Ui = hook;
  return hook;
}

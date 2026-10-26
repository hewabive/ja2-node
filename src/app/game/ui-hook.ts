import type { CapturedFrame } from '../../render/ui-draw/logical-framebuffer.ts';
import type { UiDrawStats } from '../../render/ui-draw/ui-renderer.ts';
import type { LogicalPoint } from '../../ui/resolution.ts';
import type { CursorReport } from '../../ui/runtime.ts';
import type { StoryHook } from '../../ui/screens/story/story-layer.ts';
import type { ButtonSoundRequest } from '../../ui/widgets/button-sounds.ts';
import type { WidgetInfo } from '../../ui/widgets/widget-info.ts';
import type { MusicHook } from '../net/music.ts';
import type { SequenceMonitor } from '../video/sequence-player.ts';
import type { HelpHook } from './help-host.ts';
import type { TimeSummary } from './time-samples.ts';

export interface CapturedPixels {
  readonly width: number;
  readonly height: number;
  readonly rgba: string;
}

export interface CommandOutcome {
  readonly ok: boolean;
  readonly reason: string | null;
  readonly refusal: string | null;
}

export interface UiHook {
  ready: boolean;
  error: string | null;
  screen: string | null;
  modal: string | null;
  scale: number;
  origin: LogicalPoint;
  logical: { width: number; height: number };
  readonly widgets: readonly WidgetInfo[];
  cursor: CursorReport | null;
  lastCommand: string | null;
  lastResult: CommandOutcome | null;
  sounds: readonly ButtonSoundRequest[];
  frameCount: number;
  presentedFrames: number;
  readonly frameStats: TimeSummary;
  lagTicks: number;
  session: string | null;
  dataVersion: string | null;
  pointer: LogicalPoint | null;
  presses: number;
  draw: UiDrawStats | null;
  music: MusicHook | null;
  video: SequenceMonitor | null;
  help: HelpHook | null;
  story: StoryHook | null;
  capture(): CapturedPixels | null;
  resetFrameStats(): void;
  skipPlayback(): void;
}

export interface UiHookControls {
  readonly widgets: () => readonly WidgetInfo[];
  readonly capture: () => CapturedFrame | null;
  readonly frameStats: () => TimeSummary;
  readonly resetFrameStats: () => void;
  readonly skipPlayback: () => void;
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

export function createUiHook(controls: UiHookControls): UiHook {
  const hook: UiHook = {
    ready: false,
    error: null,
    screen: null,
    modal: null,
    scale: 1,
    origin: { x: 0, y: 0 },
    logical: { width: 0, height: 0 },
    get widgets() {
      return controls.widgets();
    },
    cursor: null,
    lastCommand: null,
    lastResult: null,
    sounds: [],
    frameCount: 0,
    presentedFrames: 0,
    get frameStats() {
      return controls.frameStats();
    },
    lagTicks: 0,
    session: null,
    dataVersion: null,
    pointer: null,
    presses: 0,
    draw: null,
    music: null,
    video: null,
    help: null,
    story: null,
    capture: () => {
      const frame = controls.capture();
      return frame ? { width: frame.width, height: frame.height, rgba: base64(frame.rgba) } : null;
    },
    resetFrameStats: controls.resetFrameStats,
    skipPlayback: controls.skipPlayback,
  };
  window.__ja2Ui = hook;
  return hook;
}

// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-18. See LICENSE (SFI-SCLA).
// @src src/game/Intro.cc EnterIntroScreen (no cursor, black screen), HandleIntroScreen (a missing video is skipped),
// @src GetIntroScreenUserInput (Escape ends the sequence, Space the video, on key up), BackgroundRegionCallback (any
// @src mouse button ends the video). See docs/27 §4.1, §4.3.

import { IndexedFrameRenderer } from '../../render/indexed-frame.ts';
import { fetchOptionalVfsFile } from '../net/vfs.ts';
import { downloadInOrder } from './download-queue.ts';
import { createDecoderWorker, emptyProgress, type FetchVideo, playVideo, type VideoProgress, type VideoResult } from './player.ts';
import { introVideoPath, type SequencePlan } from './sequences.ts';
import type { VideoSound } from './sound.ts';

export type SequenceOutcome = 'finished' | 'escaped';

export interface SequenceResult {
  readonly plan: SequencePlan;
  readonly outcome: SequenceOutcome;
  readonly videos: readonly VideoResult[];
}

export interface SequenceMonitor {
  playing: SequencePlan | null;
  progress: VideoProgress;
  results: VideoResult[];
  sequences: SequenceResult[];
}

export interface SequenceOptions {
  readonly parent?: HTMLElement;
  readonly sound?: VideoSound | null;
  readonly fetchVideo?: FetchVideo;
  readonly createWorker?: () => Worker;
  readonly monitor?: SequenceMonitor;
  readonly signal?: AbortSignal;
}

const SKIP_VIDEO_KEY = ' ';
const END_SEQUENCE_KEY = 'Escape';
const OVERLAY_Z_INDEX = '1000';

export function createSequenceMonitor(): SequenceMonitor {
  return { playing: null, progress: emptyProgress(), results: [], sequences: [] };
}

function createOverlay(parent: HTMLElement): { overlay: HTMLDivElement; canvas: HTMLCanvasElement } {
  const overlay = document.createElement('div');
  overlay.className = 'ja2-video';
  Object.assign(overlay.style, {
    position: 'fixed',
    inset: '0',
    background: '#000',
    display: 'grid',
    placeItems: 'center',
    cursor: 'none',
    zIndex: OVERLAY_Z_INDEX,
  });
  const canvas = document.createElement('canvas');
  canvas.style.imageRendering = 'pixelated';
  overlay.append(canvas);
  parent.append(overlay);
  return { overlay, canvas };
}

function createRenderer(canvas: HTMLCanvasElement, overlay: HTMLElement, monitor: SequenceMonitor): IndexedFrameRenderer {
  try {
    return new IndexedFrameRenderer(canvas);
  } catch (err) {
    overlay.remove();
    monitor.playing = null;
    throw err;
  }
}

export async function playSequence(plan: SequencePlan, options: SequenceOptions = {}): Promise<SequenceResult> {
  const monitor = options.monitor ?? createSequenceMonitor();
  monitor.playing = plan;
  const { overlay, canvas } = createOverlay(options.parent ?? document.body);
  const renderer = createRenderer(canvas, overlay, monitor);
  renderer.clear();
  let escaped = options.signal?.aborted ?? false;
  let current = new AbortController();
  const endVideo = () => current.abort();
  const endSequence = () => {
    escaped = true;
    current.abort();
  };
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === SKIP_VIDEO_KEY || event.key === END_SEQUENCE_KEY) event.preventDefault();
  };
  const onKeyUp = (event: KeyboardEvent) => {
    if (event.key === END_SEQUENCE_KEY) endSequence();
    else if (event.key === SKIP_VIDEO_KEY) endVideo();
  };
  window.addEventListener('keydown', onKeyDown, { capture: true });
  window.addEventListener('keyup', onKeyUp, { capture: true });
  overlay.addEventListener('mousedown', endVideo);
  options.signal?.addEventListener('abort', endSequence, { once: true });
  const videos: VideoResult[] = [];
  const downloads = downloadInOrder(plan.videos.map(introVideoPath), options.fetchVideo ?? fetchOptionalVfsFile);
  try {
    for (const video of plan.videos) {
      if (escaped) break;
      current = new AbortController();
      const result = await playVideo(introVideoPath(video), {
        surface: { canvas, renderer },
        sound: options.sound ?? null,
        signal: current.signal,
        createWorker: options.createWorker ?? createDecoderWorker,
        fetchVideo: downloads.fetch,
        progress: monitor.progress,
      });
      videos.push(result);
      monitor.results.push(result);
      renderer.clear();
    }
  } finally {
    downloads.stop();
    window.removeEventListener('keydown', onKeyDown, { capture: true });
    window.removeEventListener('keyup', onKeyUp, { capture: true });
    options.signal?.removeEventListener('abort', endSequence);
    renderer.dispose();
    overlay.remove();
    monitor.playing = null;
  }
  const result: SequenceResult = { plan, outcome: escaped ? 'escaped' : 'finished', videos };
  monitor.sequences.push(result);
  return result;
}

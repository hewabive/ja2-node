import type { IndexedFrameRenderer } from '../../render/indexed-frame.ts';
import { unlessAborted } from './download-queue.ts';
import { type ClockSource, frameToFinishDecoding, frameToRequest, type VideoClock, videoFinished, wallClock } from './pacing.ts';
import type { VideoSound } from './sound.ts';
import type { DecoderReply, DecoderRequest, FrameReply, OpenedReply } from './worker-protocol.ts';

export type VideoOutcome = 'ended' | 'skipped' | 'missing' | 'failed';

export interface VideoResult {
  readonly path: string;
  readonly outcome: VideoOutcome;
  readonly frameCount: number;
  readonly framesShown: number;
  readonly framesDecoded: number;
  readonly clock: ClockSource | null;
  readonly audioStarted: boolean;
  readonly maxDecodeMs: number;
  readonly error: string | null;
}

export interface VideoProgress {
  path: string | null;
  frameCount: number;
  framesShown: number;
  framesDecoded: number;
  clock: ClockSource | null;
  audioStarted: boolean;
  maxDecodeMs: number;
}

export interface VideoSurface {
  readonly canvas: HTMLCanvasElement;
  readonly renderer: IndexedFrameRenderer;
}

export type FetchVideo = (path: string) => Promise<Uint8Array | null>;

export interface PlayVideoOptions {
  readonly surface: VideoSurface;
  readonly sound: VideoSound | null;
  readonly signal: AbortSignal;
  readonly createWorker: () => Worker;
  readonly fetchVideo: FetchVideo;
  readonly progress?: VideoProgress;
}

export function emptyProgress(): VideoProgress {
  return { path: null, frameCount: 0, framesShown: 0, framesDecoded: 0, clock: null, audioStarted: false, maxDecodeMs: 0 };
}

export function createDecoderWorker(): Worker {
  return new Worker(new URL('./decoder-worker.ts', import.meta.url), { type: 'module' });
}

export function integerScale(width: number, height: number, availableWidth: number, availableHeight: number): number {
  return Math.max(1, Math.floor(Math.min(availableWidth / width, availableHeight / height)));
}

function fitCanvas(canvas: HTMLCanvasElement, width: number, height: number): void {
  const scale = integerScale(width, height, globalThis.innerWidth, globalThis.innerHeight);
  canvas.width = width * scale;
  canvas.height = height * scale;
  canvas.style.width = `${width * scale}px`;
  canvas.style.height = `${height * scale}px`;
}

class DecoderChannel {
  readonly #worker: Worker;
  readonly #waiting: ((reply: DecoderReply) => void)[] = [];

  constructor(worker: Worker) {
    this.#worker = worker;
    worker.addEventListener('message', (event: MessageEvent<DecoderReply>) => this.#waiting.shift()?.(event.data));
    worker.addEventListener('error', (event) =>
      this.#waiting.shift()?.({ kind: 'error', message: event.message || 'decoder worker failed' }),
    );
  }

  ask(request: DecoderRequest, transfer: Transferable[] = []): Promise<DecoderReply> {
    return new Promise((resolve) => {
      this.#waiting.push(resolve);
      this.#worker.postMessage(request, transfer);
    });
  }

  close(): void {
    this.#worker.terminate();
    for (const resolve of this.#waiting.splice(0)) resolve({ kind: 'error', message: 'closed' });
  }
}

function nextAnimationFrame(signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) {
      resolve();
      return;
    }
    const id = requestAnimationFrame(() => {
      signal.removeEventListener('abort', cancel);
      resolve();
    });
    const cancel = () => {
      cancelAnimationFrame(id);
      resolve();
    };
    signal.addEventListener('abort', cancel, { once: true });
  });
}

function expectReply<K extends DecoderReply['kind']>(reply: DecoderReply, kind: K): Extract<DecoderReply, { kind: K }> {
  if (reply.kind === 'error') throw new Error(reply.message);
  if (reply.kind !== kind) throw new Error(`decoder answered ${reply.kind} instead of ${kind}`);
  return reply as Extract<DecoderReply, { kind: K }>;
}

export async function playVideo(path: string, options: PlayVideoOptions): Promise<VideoResult> {
  const progress = options.progress ?? emptyProgress();
  Object.assign(progress, emptyProgress(), { path });
  const result = (outcome: VideoOutcome, error: string | null = null): VideoResult => ({
    path,
    outcome,
    frameCount: progress.frameCount,
    framesShown: progress.framesShown,
    framesDecoded: progress.framesDecoded,
    clock: progress.clock,
    audioStarted: progress.audioStarted,
    maxDecodeMs: progress.maxDecodeMs,
    error,
  });
  let downloaded: { readonly value: Uint8Array | null } | null;
  try {
    downloaded = await unlessAborted(options.fetchVideo(path), options.signal);
  } catch (err) {
    return result('failed', (err as Error).message);
  }
  if (!downloaded) return result('skipped');
  const bytes = downloaded.value;
  if (!bytes) return result('missing');
  const decoder = new DecoderChannel(options.createWorker());
  let clock: VideoClock | null = null;
  try {
    const buffer =
      bytes.buffer instanceof ArrayBuffer && bytes.byteLength === bytes.buffer.byteLength ? bytes.buffer : bytes.slice().buffer;
    const opened: OpenedReply = expectReply(await decoder.ask({ kind: 'open', bytes: buffer }, [buffer]), 'opened');
    progress.frameCount = opened.frameCount;
    fitCanvas(options.surface.canvas, opened.width, opened.height);
    const record = (reply: DecoderReply): FrameReply => {
      const frame = expectReply(reply, 'frame');
      progress.framesDecoded = frame.decoded;
      progress.maxDecodeMs = Math.max(progress.maxDecodeMs, frame.decodeMs);
      return frame;
    };
    const show = (reply: DecoderReply) => {
      const frame = record(reply);
      options.surface.renderer.draw(opened.width, opened.height, frame.indices, frame.palette);
      progress.framesShown++;
    };
    const decodeTheRest = async (latest: DecoderReply | null) => {
      if (latest) record(latest);
      const last = frameToFinishDecoding(opened, progress.framesDecoded);
      if (last !== null) record(await decoder.ask({ kind: 'frame', target: last }));
    };
    show(await decoder.ask({ kind: 'frame', target: 0 }));
    clock = (opened.audio && options.sound?.start(opened.audio)) || wallClock(() => performance.now());
    progress.clock = clock.source;
    progress.audioStarted = clock.source === 'audio';
    let requested = 0;
    let pending: Promise<DecoderReply> | null = null;
    let arrived: DecoderReply | null = null;
    while (!options.signal.aborted) {
      const elapsed = clock.elapsed();
      if (videoFinished(opened, elapsed)) {
        await decodeTheRest(arrived ?? (await pending));
        return result('ended');
      }
      if (arrived) {
        show(arrived);
        arrived = null;
      }
      const target = frameToRequest(opened, requested, pending !== null, elapsed);
      if (target !== null) {
        requested = target;
        pending = decoder.ask({ kind: 'frame', target });
        void pending.then((reply) => {
          arrived = reply;
          pending = null;
        });
      }
      await nextAnimationFrame(options.signal);
    }
    return result('skipped');
  } catch (err) {
    return result('failed', (err as Error).message);
  } finally {
    clock?.stop();
    decoder.close();
  }
}

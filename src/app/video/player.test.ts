import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { IndexedFrameRenderer } from '../../render/indexed-frame.ts';
import type { VideoClock } from './pacing.ts';
import { playVideo, type VideoSurface } from './player.ts';
import type { VideoSound } from './sound.ts';
import type { DecoderReply, DecoderRequest } from './worker-protocol.ts';

const FRAMES = 30;
const MICROS_PER_FRAME = 66_660;
const WIDTH = 4;
const HEIGHT = 2;
const PALETTE_BYTES = 768;
const SAMPLE_RATE = 22050;
const SECONDS_PER_ANIMATION_FRAME_UNDER_LOAD = 0.3;

class FakeDecoderWorker {
  readonly #listeners: ((event: { data: DecoderReply }) => void)[] = [];
  #decoded = 0;

  addEventListener(type: string, listener: (event: { data: DecoderReply }) => void): void {
    if (type === 'message') this.#listeners.push(listener);
  }

  postMessage(request: DecoderRequest): void {
    const reply = request.kind === 'open' ? this.#open() : this.#decodeUpTo(request.target);
    setTimeout(() => {
      for (const listener of this.#listeners) listener({ data: reply });
    });
  }

  terminate(): void {}

  #open(): DecoderReply {
    return {
      kind: 'opened',
      width: WIDTH,
      height: HEIGHT,
      frameCount: FRAMES,
      microsPerFrame: MICROS_PER_FRAME,
      audio: { sampleRate: SAMPLE_RATE, channels: [] },
    };
  }

  #decodeUpTo(target: number): DecoderReply {
    this.#decoded = Math.max(this.#decoded, Math.min(FRAMES, target + 1));
    const index = this.#decoded - 1;
    return {
      kind: 'frame',
      index,
      decoded: this.#decoded,
      decodeMs: 1,
      indices: new Uint8Array(WIDTH * HEIGHT).fill(index),
      palette: new Uint8Array(PALETTE_BYTES),
    };
  }
}

let elapsed = 0;
let drawn: number[] = [];

const clock: VideoClock = { source: 'audio', elapsed: () => elapsed, stop: () => undefined };
const sound: VideoSound = { start: () => clock };
const surface: VideoSurface = {
  canvas: { style: {} } as HTMLCanvasElement,
  renderer: {
    draw: (_width: number, _height: number, indices: Uint8Array) => {
      drawn.push(indices[0] as number);
    },
  } as unknown as IndexedFrameRenderer,
};

beforeEach(() => {
  elapsed = 0;
  drawn = [];
  vi.stubGlobal('innerWidth', WIDTH);
  vi.stubGlobal('innerHeight', HEIGHT);
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) =>
    setTimeout(() => {
      elapsed += SECONDS_PER_ANIMATION_FRAME_UNDER_LOAD;
      callback(0);
    }),
  );
  vi.stubGlobal('cancelAnimationFrame', clearTimeout);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('video player', () => {
  it('decodes to the last frame, without showing it, before a video ended by its clock reports the end', async () => {
    const played = await playVideo('intro/splashscreen.smk', {
      surface,
      sound,
      signal: new AbortController().signal,
      createWorker: () => new FakeDecoderWorker() as unknown as Worker,
      fetchVideo: async () => new Uint8Array(1),
    });
    expect(played).toMatchObject({ outcome: 'ended', frameCount: FRAMES, framesDecoded: FRAMES, framesShown: drawn.length });
    expect(drawn.length).toBeLessThan(FRAMES);
    expect(drawn).not.toContain(FRAMES - 1);
  });
});

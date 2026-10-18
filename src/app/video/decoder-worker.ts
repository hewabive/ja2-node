import { createFrameReader, decodeAudio, openSmk, type SmkFrameReader } from '../../content/formats/smk.ts';
import type { DecodedAudio, DecoderReply, DecoderRequest } from './worker-protocol.ts';

const INT16_SCALE = 32768;

let reader: SmkFrameReader | null = null;

function reply(message: DecoderReply, transfer: Transferable[] = []): void {
  globalThis.postMessage(message, { transfer });
}

function toFloat(samples: Int16Array): Float32Array<ArrayBuffer> {
  const out = new Float32Array(samples.length);
  for (let i = 0; i < samples.length; i++) out[i] = (samples[i] as number) / INT16_SCALE;
  return out;
}

function open(bytes: ArrayBuffer): void {
  const video = openSmk(new Uint8Array(bytes));
  const [track] = video.audioTracks;
  const audio: DecodedAudio | null = track ? { sampleRate: track.sampleRate, channels: decodeAudio(video, track).map(toFloat) } : null;
  reader = createFrameReader(video);
  reply(
    {
      kind: 'opened',
      width: video.width,
      height: video.height,
      frameCount: video.frameCount,
      microsPerFrame: video.microsPerFrame,
      audio,
    },
    audio ? audio.channels.map((c) => c.buffer) : [],
  );
}

function decodeUpTo(target: number): void {
  if (!reader) throw new Error('no video is open');
  const started = performance.now();
  while (!reader.done && reader.frameIndex <= target) reader.nextFrame();
  const index = reader.frameIndex - 1;
  if (index < 0) throw new Error('no frame decoded');
  const indices = reader.indices.slice();
  const palette = reader.palette.slice();
  reply({ kind: 'frame', index, decoded: reader.frameIndex, decodeMs: performance.now() - started, indices, palette }, [
    indices.buffer,
    palette.buffer,
  ]);
}

globalThis.addEventListener('message', (event: MessageEvent<DecoderRequest>) => {
  try {
    if (event.data.kind === 'open') open(event.data.bytes);
    else decodeUpTo(event.data.target);
  } catch (err) {
    reply({ kind: 'error', message: err instanceof Error ? err.message : String(err) });
  }
});

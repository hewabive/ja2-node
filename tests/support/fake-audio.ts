import type { AudioGraph } from '../../src/audio/engine.ts';

class FakeParam {
  value = 1;
}

export class FakeNode {
  readonly gain = new FakeParam();
  readonly connections: unknown[] = [];
  disconnected = false;

  connect(target: unknown): unknown {
    this.connections.push(target);
    return target;
  }

  disconnect(): void {
    this.disconnected = true;
  }
}

export class FakeBuffer {
  readonly numberOfChannels: number;
  readonly length: number;
  readonly sampleRate: number;
  readonly copied: Float32Array[] = [];

  constructor(channels: number, length: number, sampleRate: number) {
    this.numberOfChannels = channels;
    this.length = length;
    this.sampleRate = sampleRate;
  }

  get duration(): number {
    return this.length / this.sampleRate;
  }

  copyToChannel(samples: Float32Array): void {
    this.copied.push(samples);
  }
}

export class FakeSource extends FakeNode {
  buffer: FakeBuffer | null = null;
  loop = false;
  onended: (() => void) | null = null;
  started = false;
  stoppedAt: number | null = null;

  start(): void {
    this.started = true;
  }

  stop(at = 0): void {
    this.stoppedAt = at;
  }

  finish(): void {
    this.onended?.();
  }
}

export class FakeGraph {
  currentTime = 0;
  state = 'suspended';
  readonly destination = new FakeNode();
  readonly sources: FakeSource[] = [];
  readonly gains: FakeNode[] = [];
  readonly splitters: FakeNode[] = [];

  resume(): Promise<void> {
    this.state = 'running';
    return Promise.resolve();
  }

  createGain(): FakeNode {
    const g = new FakeNode();
    this.gains.push(g);
    return g;
  }

  createBufferSource(): FakeSource {
    const s = new FakeSource();
    this.sources.push(s);
    return s;
  }

  createBuffer(channels: number, length: number, sampleRate: number): FakeBuffer {
    return new FakeBuffer(channels, length, sampleRate);
  }

  createChannelMerger(): FakeNode {
    return new FakeNode();
  }

  createChannelSplitter(): FakeNode {
    const s = new FakeNode();
    this.splitters.push(s);
    return s;
  }

  asGraph(): AudioGraph {
    return this as unknown as AudioGraph;
  }

  playing(): FakeSource[] {
    return this.sources.filter((s) => s.started && !s.disconnected);
  }
}

export function pcmWav(frames: number, channels = 1, sampleRate = 11025): Uint8Array {
  const bytes = 44 + frames * channels * 2;
  const out = new Uint8Array(bytes);
  const view = new DataView(out.buffer);
  const text = (at: number, s: string) => {
    for (let i = 0; i < s.length; i++) out[at + i] = s.charCodeAt(i);
  };
  text(0, 'RIFF');
  view.setUint32(4, bytes - 8, true);
  text(8, 'WAVE');
  text(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, channels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * channels * 2, true);
  view.setUint16(32, channels * 2, true);
  view.setUint16(34, 16, true);
  text(36, 'data');
  view.setUint32(40, frames * channels * 2, true);
  return out;
}

export async function settle(): Promise<void> {
  for (let i = 0; i < 5; i++) await Promise.resolve();
}

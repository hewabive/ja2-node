// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-18. See LICENSE (SFI-SCLA).
// @src src/sgp/SoundMan.cc SOUND_MAX_CHANNELS, SOUND_MAX_CACHED, SoundPlay, SoundGetFreeChannel (a new sound is dropped
// @src when every channel is busy), SoundServiceStreams (linear balance), SoundStartSample (loops). See docs/27 §3.1, §3.3.

import { type Bus, type Cue, mixCue, type Volumes } from '../content/audio/cue.ts';
import { balanceGains, MAX_VOLUME, type ScreenView } from '../content/audio/sound-position.ts';
import { decodeWav } from '../content/formats/wav.ts';
import { LruCache, SOUND_CACHE_ENTRIES } from './buffer-cache.ts';

export const MAX_VOICES = 16;
const BUSES: readonly Bus[] = ['effects', 'speech', 'music', 'ambient'];
const STEREO = 2;

export interface EngineVolumes extends Volumes {
  readonly master: number;
}

export const DEFAULT_ENGINE_VOLUMES: EngineVolumes = { effects: 63, speech: 63, music: 63, ambient: 63, master: MAX_VOLUME };

export interface AudioGraph {
  readonly currentTime: number;
  readonly state: string;
  readonly destination: AudioNode;
  resume(): Promise<void>;
  createGain(): GainNode;
  createBufferSource(): AudioBufferSourceNode;
  createBuffer(channels: number, length: number, sampleRate: number): AudioBuffer;
  createChannelMerger(inputs: number): ChannelMergerNode;
  createChannelSplitter(outputs: number): ChannelSplitterNode;
}

export type LoadFile = (path: string) => Promise<Uint8Array | null>;

export interface EngineOptions {
  readonly createGraph: () => AudioGraph;
  readonly load: LoadFile;
  readonly maxVoices?: number;
  readonly cacheEntries?: number;
}

export interface AudioCounters {
  cuesResolved: number;
  cuesWhileLocked: number;
  voicesStarted: number;
  voicesDropped: number;
  voicesSilent: number;
  filesMissing: number;
  decodeErrors: number;
  activeVoices: number;
  cachedBuffers: number;
}

export interface BufferPlayback {
  readonly startedAt: number;
  elapsed(): number;
  stop(): void;
}

export type VoiceState = 'loading' | 'playing' | 'ended' | 'dropped' | 'missing' | 'silent' | 'stopped';

export interface VoiceHandle {
  readonly cue: Cue;
  readonly state: VoiceState;
  readonly active: boolean;
  onEnded: (() => void) | null;
  stop(): void;
  remix(volume: number, pan: number): void;
}

class Voice implements VoiceHandle {
  readonly cue: Cue;
  state: VoiceState = 'loading';
  onEnded: (() => void) | null = null;
  source: AudioBufferSourceNode | null = null;
  left: GainNode | null = null;
  right: GainNode | null = null;
  readonly #finish: (v: Voice) => void;

  constructor(cue: Cue, finish: (v: Voice) => void) {
    this.cue = cue;
    this.#finish = finish;
  }

  get active(): boolean {
    return this.state === 'loading' || this.state === 'playing';
  }

  settle(state: VoiceState): void {
    if (!this.active) return;
    const wasPlaying = this.state === 'playing';
    this.state = state;
    if (wasPlaying) this.#finish(this);
    this.onEnded?.();
  }

  stop(): void {
    const source = this.source;
    this.settle('stopped');
    try {
      source?.stop();
    } catch {
      return;
    }
  }

  remix(volume: number, pan: number): void {
    const gains = balanceGains(volume, pan);
    if (this.left) this.left.gain.value = gains.left;
    if (this.right) this.right.gain.value = gains.right;
  }
}

export class AudioEngine {
  readonly counters: AudioCounters = {
    cuesResolved: 0,
    cuesWhileLocked: 0,
    voicesStarted: 0,
    voicesDropped: 0,
    voicesSilent: 0,
    filesMissing: 0,
    decodeErrors: 0,
    activeVoices: 0,
    cachedBuffers: 0,
  };
  readonly #options: EngineOptions;
  readonly #maxVoices: number;
  readonly #buffers: LruCache<AudioBuffer>;
  readonly #missing = new Set<string>();
  readonly #loading = new Map<string, Promise<AudioBuffer | null>>();
  readonly #playing = new Set<Voice>();
  #graph: AudioGraph | null = null;
  #master: GainNode | null = null;
  readonly #buses = new Map<Bus, GainNode>();
  #volumes: EngineVolumes = DEFAULT_ENGINE_VOLUMES;
  #listener: ScreenView = { centerX: 0, centerY: 0, width: 640, height: 360 };

  constructor(options: EngineOptions) {
    this.#options = options;
    this.#maxVoices = options.maxVoices ?? MAX_VOICES;
    this.#buffers = new LruCache(options.cacheEntries ?? SOUND_CACHE_ENTRIES);
  }

  get unlocked(): boolean {
    return this.#graph !== null;
  }

  get volumes(): EngineVolumes {
    return this.#volumes;
  }

  get listener(): ScreenView {
    return this.#listener;
  }

  unlock(): void {
    if (!this.#graph) this.#build(this.#options.createGraph());
    const graph = this.#graph;
    if (graph && graph.state !== 'running') void graph.resume().catch(() => undefined);
  }

  #build(graph: AudioGraph): void {
    this.#graph = graph;
    const master = graph.createGain();
    master.connect(graph.destination);
    this.#master = master;
    for (const bus of BUSES) {
      const node = graph.createGain();
      node.connect(master);
      this.#buses.set(bus, node);
    }
    this.#applyMaster();
  }

  setVolumes(volumes: EngineVolumes): void {
    this.#volumes = volumes;
    this.#applyMaster();
  }

  #applyMaster(): void {
    if (this.#master) this.#master.gain.value = this.#volumes.master / MAX_VOLUME;
  }

  setListener(view: ScreenView): void {
    this.#listener = view;
  }

  cachedPaths(): string[] {
    return this.#buffers.keys();
  }

  play(cue: Cue): VoiceHandle {
    this.counters.cuesResolved++;
    const voice = new Voice(cue, (v) => this.#release(v));
    if (!this.#graph) {
      this.counters.cuesWhileLocked++;
      voice.settle('silent');
      return voice;
    }
    if (this.#silent(cue)) {
      this.counters.voicesSilent++;
      voice.settle('silent');
      return voice;
    }
    const cached = this.#buffers.get(cue.file);
    if (cached) this.#start(voice, cached);
    else void this.#buffer(cue.file).then((buffer) => (buffer ? this.#start(voice, buffer) : voice.settle('missing')));
    return voice;
  }

  stopAll(): void {
    for (const v of [...this.#playing]) v.stop();
  }

  playBuffer(bus: Bus, channels: readonly Float32Array<ArrayBuffer>[], sampleRate: number): BufferPlayback | null {
    const graph = this.#graph;
    const node = this.#buses.get(bus);
    const [first] = channels;
    if (!graph || !node || !first || graph.state !== 'running' || this.#volumes.master === 0) return null;
    const buffer = graph.createBuffer(channels.length, Math.max(1, first.length), sampleRate);
    channels.forEach((samples, i) => {
      buffer.copyToChannel(samples, i);
    });
    const source = graph.createBufferSource();
    source.buffer = buffer;
    source.connect(node);
    const startedAt = graph.currentTime;
    source.start(startedAt);
    let stopped = false;
    return {
      startedAt,
      elapsed: () => graph.currentTime - startedAt,
      stop: () => {
        if (stopped) return;
        stopped = true;
        try {
          source.stop();
        } catch {
          return;
        } finally {
          source.disconnect();
        }
      },
    };
  }

  #silent(cue: Cue): boolean {
    if (this.#volumes.master === 0) return true;
    return cue.mix !== 'positionLoop' && mixCue(cue, this.#listener, this.#volumes).volume === 0;
  }

  #buffer(path: string): Promise<AudioBuffer | null> {
    if (this.#missing.has(path)) return Promise.resolve(null);
    const pending = this.#loading.get(path);
    if (pending) return pending;
    const loading = this.#decode(path).finally(() => this.#loading.delete(path));
    this.#loading.set(path, loading);
    return loading;
  }

  async #decode(path: string): Promise<AudioBuffer | null> {
    const graph = this.#graph;
    let bytes: Uint8Array | null = null;
    try {
      bytes = await this.#options.load(path);
    } catch {
      bytes = null;
    }
    if (!bytes || !graph) {
      this.#missing.add(path);
      this.counters.filesMissing++;
      return null;
    }
    try {
      const audio = decodeWav(bytes);
      const buffer = graph.createBuffer(audio.channels.length, Math.max(1, audio.frameCount), audio.sampleRate);
      audio.channels.forEach((samples, i) => {
        buffer.copyToChannel(samples as Float32Array<ArrayBuffer>, i);
      });
      this.#buffers.set(path, buffer);
      this.counters.cachedBuffers = this.#buffers.size;
      return buffer;
    } catch {
      this.#missing.add(path);
      this.counters.decodeErrors++;
      return null;
    }
  }

  #start(voice: Voice, buffer: AudioBuffer): void {
    const graph = this.#graph;
    const bus = this.#buses.get(voice.cue.bus);
    if (!graph || !bus || !voice.active) return;
    if (this.#playing.size >= this.#maxVoices) {
      this.counters.voicesDropped++;
      voice.settle('dropped');
      return;
    }
    const mixed = mixCue(voice.cue, this.#listener, this.#volumes);
    if (this.#silent(voice.cue)) {
      this.counters.voicesSilent++;
      voice.settle('silent');
      return;
    }
    const source = graph.createBufferSource();
    source.buffer = buffer;
    const left = graph.createGain();
    const right = graph.createGain();
    const merger = graph.createChannelMerger(STEREO);
    if (buffer.numberOfChannels >= STEREO) {
      const splitter = graph.createChannelSplitter(STEREO);
      source.connect(splitter);
      splitter.connect(left, 0);
      splitter.connect(right, 1);
    } else {
      source.connect(left);
      source.connect(right);
    }
    left.connect(merger, 0, 0);
    right.connect(merger, 0, 1);
    merger.connect(bus);
    voice.source = source;
    voice.left = left;
    voice.right = right;
    voice.remix(mixed.volume, mixed.pan);
    voice.state = 'playing';
    this.#playing.add(voice);
    this.counters.voicesStarted++;
    this.counters.activeVoices = this.#playing.size;
    source.onended = () => voice.settle('ended');
    const loops = voice.cue.loops;
    if (loops !== 1) source.loop = true;
    source.start();
    if (loops > 1 && Number.isFinite(loops)) source.stop(graph.currentTime + buffer.duration * loops);
  }

  #release(voice: Voice): void {
    this.#playing.delete(voice);
    this.counters.activeVoices = this.#playing.size;
    voice.source?.disconnect();
  }
}

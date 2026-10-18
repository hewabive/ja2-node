import type { AudioEngine } from '../../audio/engine.ts';
import type { Bus } from '../../content/audio/cue.ts';
import type { VideoClock } from './pacing.ts';
import type { DecodedAudio } from './worker-protocol.ts';

export const VIDEO_BUS: Bus = 'music';

export interface VideoSound {
  start(audio: DecodedAudio): VideoClock | null;
}

export function engineSound(engine: AudioEngine): VideoSound {
  return {
    start(audio) {
      const playback = engine.playBuffer(VIDEO_BUS, audio.channels, audio.sampleRate);
      return playback ? { source: 'audio', elapsed: () => playback.elapsed(), stop: () => playback.stop() } : null;
    },
  };
}

export function contextSound(createContext: () => AudioContext = () => new AudioContext()): VideoSound {
  let context: AudioContext | null = null;
  return {
    start(audio) {
      context ??= createContext();
      const [first] = audio.channels;
      if (context.state !== 'running' || !first) return null;
      const graph = context;
      const buffer = graph.createBuffer(audio.channels.length, Math.max(1, first.length), audio.sampleRate);
      audio.channels.forEach((samples, i) => {
        buffer.copyToChannel(samples, i);
      });
      const source = graph.createBufferSource();
      source.buffer = buffer;
      source.connect(graph.destination);
      const startedAt = graph.currentTime;
      source.start(startedAt);
      return {
        source: 'audio',
        elapsed: () => graph.currentTime - startedAt,
        stop: () => {
          source.onended = null;
          source.disconnect();
        },
      };
    },
  };
}

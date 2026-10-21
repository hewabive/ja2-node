import type { AudioEngine, VoiceHandle } from '../../audio/engine.ts';
import { speechCue } from '../../content/audio/speech.ts';
import type { SpeechSettings, SpeechVoice, SpeechVoices } from '../../ui/speech.ts';
import { loadSettings } from '../settings.ts';

const FAILED_STATES: ReadonlySet<VoiceHandle['state']> = new Set(['missing', 'silent', 'dropped']);
const SETTINGS_REFRESH_MS = 250;

class EngineSpeechVoice implements SpeechVoice {
  readonly #handle: VoiceHandle;

  constructor(handle: VoiceHandle) {
    this.#handle = handle;
  }

  get active(): boolean {
    return this.#handle.active;
  }

  get playing(): boolean {
    return this.#handle.state === 'playing';
  }

  get failed(): boolean {
    return FAILED_STATES.has(this.#handle.state);
  }

  get elapsedMs(): number {
    return this.#handle.elapsedMs;
  }

  get file(): string {
    return this.#handle.cue.file;
  }

  stop(): void {
    this.#handle.stop();
  }
}

export function engineSpeechVoices(engine: AudioEngine): SpeechVoices {
  return { play: (path) => new EngineSpeechVoice(engine.play(speechCue(path))) };
}

export function storedSpeechSettings(now: () => number): () => SpeechSettings {
  let cached: SpeechSettings | null = null;
  let at = Number.NEGATIVE_INFINITY;
  return () => {
    const t = now();
    if (!cached || t - at >= SETTINGS_REFRESH_MS) {
      const s = loadSettings();
      cached = { speech: s.speech, subtitles: s.subtitles, keyAdvance: s.keyAdvanceSpeech };
      at = t;
    }
    return cached;
  };
}

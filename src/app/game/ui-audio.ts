import { AudioEngine } from '../../audio/engine.ts';
import { cueOf } from '../../content/audio/cue.ts';
import { parseSoundEffects, SOUND_EFFECTS_PATH, type SoundEffectTable } from '../../content/audio/sound-table.ts';
import type { ButtonSoundRequest, UiSoundSink } from '../../ui/widgets/button-sounds.ts';
import type { AssetSource } from '../assets/asset-source.ts';
import { effectiveMaster, loadSettings } from '../settings.ts';

const FIXED_MIX = 'fixed';

export class UiAudio implements UiSoundSink {
  readonly engine: AudioEngine;
  readonly requests: ButtonSoundRequest[] = [];
  #paths: ReadonlyMap<string, string> = new Map();

  constructor(source: AssetSource) {
    this.engine = new AudioEngine({ createGraph: () => new AudioContext(), load: (path) => source.readOptional(path) });
    const settings = loadSettings();
    this.engine.setVolumes({ ...settings.volumes, master: effectiveMaster(settings) });
  }

  useTable(json: unknown): void {
    const table: SoundEffectTable = parseSoundEffects(json);
    this.#paths = new Map(table.sounds.flatMap((s) => (s.path ? [[s.name, s.path] as const] : [])));
  }

  static tablePath(): string {
    return SOUND_EFFECTS_PATH;
  }

  unlock(): void {
    this.engine.unlock();
  }

  play(request: ButtonSoundRequest): void {
    this.requests.push(request);
    const file = 'sample' in request ? this.#paths.get(request.sample) : request.file;
    if (file) this.engine.play(cueOf(file, FIXED_MIX, request.volume));
  }
}

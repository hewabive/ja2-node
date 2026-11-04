import type { SpeechOwner } from '../../audio/director.ts';
import type { AudioEngine } from '../../audio/engine.ts';
import { reportStoppedLines, type SpeakerBattleSounds, SpeechPresenter, type SpeechSettings } from '../../ui/speech.ts';
import type { SessionClient } from '../net/session-client.ts';
import { engineSpeechVoices, storedSpeechSettings } from '../tactical/speech-voices.ts';

export class SessionSpeech {
  readonly client: SessionClient;
  readonly presenter: SpeechPresenter;
  readonly settings: () => SpeechSettings;
  readonly owner: SpeechOwner;
  readonly #battleSounds: SpeakerBattleSounds[] = [];
  #spoken = 0;

  constructor(client: SessionClient, engine: AudioEngine) {
    this.client = client;
    this.settings = storedSpeechSettings(() => performance.now());
    this.presenter = new SpeechPresenter({
      voices: engineSpeechVoices(engine),
      settings: this.settings,
      battleSounds: { playing: (profile) => this.#battleSounds.some((sounds) => sounds.playing(profile)) },
    });
    this.presenter.onLineStarted(() => {
      this.#spoken++;
    });
    reportStoppedLines(this.presenter, (cmd) => void client.command(cmd));
    this.owner = {
      isTalking: (soldier) => {
        const speaking = this.presenter.speaking;
        return speaking !== null && speaking.speaker === soldier && speaking.playing;
      },
      cut: (soldier) => this.presenter.cutSpeaker(soldier),
    };
  }

  get spoken(): number {
    return this.#spoken;
  }

  addBattleSounds(sounds: SpeakerBattleSounds): void {
    this.#battleSounds.push(sounds);
  }
}

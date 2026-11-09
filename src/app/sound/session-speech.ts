// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-11-09. See LICENSE (SFI-SCLA).
// @src src/game/SaveLoadGame.cc LoadSavedGame (TrashAllSoldiers deletes every soldier's face before EmptyDialogueQueue and
// @src StopAnyCurrentlyTalkingSpeech); Tactical/Faces.cc DeleteSoldierFace wherever the simulation deletes a face
// @src (soldierFaceDeleted: Strategic/Merc_Contract.cc StrategicRemoveMerc, Tactical/Soldier_Profile.cc ChangeSoldierTeam
// @src and SwapLarrysProfiles, 2026-11-09).

import type { SpeechOwner } from '../../audio/director.ts';
import type { AudioEngine } from '../../audio/engine.ts';
import type { ViewFrame } from '../../protocol/view.ts';
import { gameScreenOf } from '../../ui/screens/front-end/flow.ts';
import { TalkingUi } from '../../ui/screens/talk/talking-ui.ts';
import { DialogueHold, reportStoppedLines, type SpeakerBattleSounds, SpeechPresenter, type SpeechSettings } from '../../ui/speech.ts';
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

  followScreen(): void {
    this.presenter.holdDialogue(gameScreenOf(this.client.view) === 'laptop', DialogueHold.LAPTOP);
  }

  frames(frames: readonly ViewFrame[]): void {
    const ui = TalkingUi.of(this.presenter);
    for (const frame of frames)
      for (const event of frame.events ?? []) if (event.type === 'soldierFaceDeleted') ui.deleteSoldierFace(event.profile);
  }

  discardLines(): void {
    TalkingUi.of(this.presenter).deleteSoldierFaces(this.settings().speech);
    this.presenter.discardLines();
  }
}

import { describe, expect, it } from 'vitest';
import { FakeGraph } from '../../../tests/support/fake-audio.ts';
import { AudioEngine } from '../../audio/engine.ts';
import { type SpeechPlacement, SpeechScreen, TalkingUi, type UiPoint } from '../../ui/screens/talk/talking-ui.ts';
import { SpeechSurface } from '../../ui/speech.ts';
import type { SessionClient } from '../net/session-client.ts';
import { SessionSpeech } from './session-speech.ts';

const SCREEN_POPUP: UiPoint = { x: 10, y: 20 };
const MERC_PROFILE = 5;

const tactical: SpeechPlacement = {
  screen: SpeechScreen.TACTICAL,
  textBox: () => ({ x: 110, y: 20, width: 200 }),
  facePopup: () => SCREEN_POPUP,
  carriedPopup: () => SCREEN_POPUP,
};

function sessionSpeech(): SessionSpeech {
  const engine = new AudioEngine({ createGraph: () => new FakeGraph().asGraph(), load: async () => null });
  return new SessionSpeech({ command: async () => ({ ok: true }), view: null } as unknown as SessionClient, engine);
}

function say(speech: SessionSpeech, surface: SpeechSurface, soldier: number | null): void {
  speech.presenter.enqueue({ surface, profile: MERC_PROFILE, soldier, text: 'Hi.', chars: 3, voice: null, sector: null, keyWait: false });
}

describe('the session speech deletes the soldier faces the original deletes (Faces.cc DeleteSoldierFace)', () => {
  it('ends at once the box, the popup and the click region of the line the deletion ended (DeleteFace, HandleDialogueEnd)', () => {
    const SAID_AT = 7;
    const speech = sessionSpeech();
    const presenter = speech.presenter;
    const ui = TalkingUi.of(presenter);
    presenter.enqueue({
      surface: SpeechSurface.TACTICAL,
      profile: MERC_PROFILE,
      soldier: 3,
      text: 'Hi.',
      chars: 3,
      voice: null,
      sector: null,
      keyWait: false,
      saidAt: SAID_AT,
    });
    ui.follow(presenter.current, tactical, true);
    expect([ui.popups, ui.region, ui.textBox === null]).toEqual([[SCREEN_POPUP], SCREEN_POPUP, false]);
    presenter.endDeletedFace(MERC_PROFILE, SAID_AT);
    ui.follow(presenter.current, tactical, true);
    expect([ui.popups, ui.region, ui.textBox]).toEqual([[], null, null]);
  });

  it('ends a soldier face talking as a load discards the lines (LoadSavedGame, TrashAllSoldiers)', () => {
    const speech = sessionSpeech();
    const ui = TalkingUi.of(speech.presenter);
    say(speech, SpeechSurface.TACTICAL, 3);
    ui.follow(speech.presenter.current, tactical, true);
    speech.discardLines();
    expect([speech.presenter.current, ui.region, ui.textBox]).toEqual([null, null, null]);
  });
});

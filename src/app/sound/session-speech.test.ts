import { describe, expect, it } from 'vitest';
import { FakeGraph } from '../../../tests/support/fake-audio.ts';
import { AudioEngine } from '../../audio/engine.ts';
import type { ViewFrame } from '../../protocol/view.ts';
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
  return new SessionSpeech({ command: async () => ({ ok: true }) } as unknown as SessionClient, engine);
}

const map: SpeechPlacement = { screen: SpeechScreen.MAP, textBox: () => null, facePopup: () => null, carriedPopup: () => null };

function say(speech: SessionSpeech, surface: SpeechSurface, soldier: number | null): void {
  speech.presenter.enqueue({ surface, profile: MERC_PROFILE, soldier, text: 'Hi.', chars: 3, voice: null, sector: null, keyWait: false });
}

function mercLeft(profile: number): ViewFrame {
  const left = { type: 'mercLeft', tick: 1, soldier: 3, profile, cause: 'fired', history: 0, equipment: 'here', personnel: 'fired' };
  return { tick: 1, changed: [], removed: [], events: [left as never] };
}

describe('the session speech deletes the soldier faces the original deletes (Faces.cc DeleteSoldierFace)', () => {
  it("hands a merc's departure to the talking UI, which takes down the popup his face left up (StrategicRemoveMerc)", () => {
    const speech = sessionSpeech();
    const presenter = speech.presenter;
    const ui = TalkingUi.of(presenter);
    say(speech, SpeechSurface.TACTICAL, 3);
    ui.follow(presenter.current, map, false);
    ui.follow(presenter.current, tactical, false);
    speech.frames([mercLeft(MERC_PROFILE)]);
    presenter.skip(0, true);
    say(speech, SpeechSurface.EXTERNAL, null);
    ui.follow(presenter.current, tactical, false);
    expect([ui.popups, ui.region]).toEqual([[], SCREEN_POPUP]);
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

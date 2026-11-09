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
  return new SessionSpeech({ command: async () => ({ ok: true }), view: null } as unknown as SessionClient, engine);
}

const map: SpeechPlacement = { screen: SpeechScreen.MAP, textBox: () => null, facePopup: () => null, carriedPopup: () => null };

function say(speech: SessionSpeech, surface: SpeechSurface, soldier: number | null): void {
  speech.presenter.enqueue({ surface, profile: MERC_PROFILE, soldier, text: 'Hi.', chars: 3, voice: null, sector: null, keyWait: false });
}

function faceDeleted(profile: number, saidAt?: number): ViewFrame {
  const deleted = { type: 'soldierFaceDeleted', tick: 1, profile, ...(saidAt !== undefined ? { saidAt } : {}) } as const;
  return { tick: 1, changed: [], removed: [], events: [deleted] };
}

function leaveFacePopupUp(speech: SessionSpeech, profile = MERC_PROFILE): TalkingUi {
  const ui = TalkingUi.of(speech.presenter);
  speech.presenter.enqueue({
    surface: SpeechSurface.TACTICAL,
    profile,
    soldier: 3,
    text: 'Hi.',
    chars: 3,
    voice: null,
    sector: null,
    keyWait: false,
  });
  ui.follow(speech.presenter.current, map, false);
  ui.follow(speech.presenter.current, tactical, false);
  return ui;
}

function popupsAfterTheNextLine(speech: SessionSpeech, ui: TalkingUi): readonly UiPoint[] {
  speech.presenter.skip(0, true);
  say(speech, SpeechSurface.EXTERNAL, null);
  ui.follow(speech.presenter.current, tactical, false);
  return ui.popups;
}

describe('the session speech deletes the soldier faces the original deletes (Faces.cc DeleteSoldierFace)', () => {
  it('takes down the popup a deleted face left up once a line of his still playing is over (soldierFaceDeleted)', () => {
    const speech = sessionSpeech();
    const ui = leaveFacePopupUp(speech);
    speech.frames([faceDeleted(MERC_PROFILE)]);
    expect(ui.popups).toEqual([SCREEN_POPUP]);
    expect(popupsAfterTheNextLine(speech, ui)).toEqual([]);
  });

  it('keeps the popup of a face the simulation did not delete', () => {
    const speech = sessionSpeech();
    const ui = leaveFacePopupUp(speech);
    speech.frames([faceDeleted(MERC_PROFILE + 1)]);
    expect(popupsAfterTheNextLine(speech, ui)).toEqual([SCREEN_POPUP]);
  });

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
    speech.frames([faceDeleted(MERC_PROFILE, SAID_AT)]);
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

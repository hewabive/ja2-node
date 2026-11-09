import { describe, expect, it } from 'vitest';
import { type ActiveLine, type SpeechLine, SpeechPresenter, SpeechSurface } from '../../speech.ts';
import { type SpeechPlacement, SpeechScreen, TalkingUi, type UiPoint } from './talking-ui.ts';

const SCREEN_POPUP: UiPoint = { x: 10, y: 20 };
const TACTICAL_BOX = { x: 110, y: 20, width: 200 };
const MAP_BOX = { x: 110, y: 40, width: 200 };
const EXTERN_PANEL: UiPoint = { x: 320, y: 117 };

const tactical: SpeechPlacement = {
  screen: SpeechScreen.TACTICAL,
  textBox: () => TACTICAL_BOX,
  facePopup: () => SCREEN_POPUP,
  carriedPopup: () => SCREEN_POPUP,
};

const map: SpeechPlacement = {
  screen: SpeechScreen.MAP,
  textBox: (line) => (line.surface === SpeechSurface.EXTERNAL ? { ...EXTERN_PANEL, width: 200 } : MAP_BOX),
  facePopup: (line) => (line.surface === SpeechSurface.EXTERNAL ? EXTERN_PANEL : line.soldier === null ? SCREEN_POPUP : null),
  carriedPopup: (line) => (line.soldier === null ? SCREEN_POPUP : null),
};

function line(surface: SpeechSurface, soldier: number | null, id = 1): ActiveLine {
  const said: SpeechLine = { id, surface, profile: 5, soldier, text: 'Hi.', chars: 3, voice: null, sector: null, keyWait: false };
  return { line: said, startedAt: 0, phase: 'talking', subtitles: true, voice: null };
}

function talkingUi(): TalkingUi {
  return TalkingUi.of(new SpeechPresenter({ voices: null, settings: () => ({ speech: true, subtitles: true, keyAdvance: false }) }));
}

describe('the talking UI of a line across screens (Dialogue_Control.cc CreateTalkingUI, HandleDialogue)', () => {
  it('keeps the subtitle box where the screen the line started on put it, whichever screen it plays on', () => {
    const ui = talkingUi();
    const merc = line(SpeechSurface.TACTICAL, 3);
    ui.follow(merc, tactical, false);
    ui.follow(merc, map, false);
    expect(ui.textBox).toEqual(TACTICAL_BOX);
    const fromMap = line(SpeechSurface.TACTICAL, 3, 2);
    ui.follow(fromMap, map, false);
    ui.follow(fromMap, tactical, false);
    expect(ui.textBox).toEqual(MAP_BOX);
  });

  it('decides the popup by the speech option as the line starts', () => {
    const ui = talkingUi();
    const merc = line(SpeechSurface.TACTICAL, 3);
    ui.follow(merc, tactical, false);
    ui.follow(merc, tactical, true);
    expect([ui.popups, ui.region]).toEqual([[], null]);
  });

  it('takes the popup off a line carried to the map, and leaves one without a soldier an unseen popup whose click region stays', () => {
    const ui = talkingUi();
    const merc = line(SpeechSurface.TACTICAL, 3);
    ui.follow(merc, tactical, true);
    expect([ui.popups, ui.region]).toEqual([[SCREEN_POPUP], SCREEN_POPUP]);
    ui.follow(merc, map, true);
    expect([ui.popups, ui.region]).toEqual([[], null]);
    const skyrider = line(SpeechSurface.EXTERNAL, null, 2);
    ui.follow(skyrider, tactical, true);
    ui.follow(skyrider, map, true);
    expect([ui.popups, ui.region]).toEqual([[], SCREEN_POPUP]);
  });

  it('gives a line carried from the map the popup at 10, 20 with speech off too', () => {
    const ui = talkingUi();
    const merc = line(SpeechSurface.TACTICAL, 3);
    ui.follow(merc, map, false);
    ui.follow(merc, tactical, false);
    expect([ui.popups, ui.region]).toEqual([[SCREEN_POPUP], SCREEN_POPUP]);
  });

  it("drops the map's popup as the map screen closes and keeps its click region for the popup a carried line gets (EndMapScreen)", () => {
    const ui = talkingUi();
    const skyrider = line(SpeechSurface.EXTERNAL, null);
    ui.follow(skyrider, map, true);
    ui.endMapScreen();
    ui.follow(skyrider, tactical, true);
    expect([ui.popups, ui.region]).toEqual([[SCREEN_POPUP], EXTERN_PANEL]);
    ui.follow(null, tactical, true);
    expect([ui.popups, ui.region, ui.textBox]).toEqual([[], null, null]);
  });

  it('keeps for good the popup a face had registered when it registers another (RegisterVideoOverlay into f.video_overlay)', () => {
    const ui = talkingUi();
    const away = line(SpeechSurface.TACTICAL, null);
    ui.follow(away, tactical, true);
    ui.follow(away, map, true);
    ui.follow(line(SpeechSurface.TACTICAL, null, 2), map, true);
    expect(ui.popups).toEqual([SCREEN_POPUP, SCREEN_POPUP]);
    ui.follow(null, map, true);
    ui.follow(line(SpeechSurface.EXTERNAL, null, 3), map, true);
    expect(ui.popups).toEqual([SCREEN_POPUP, EXTERN_PANEL]);
  });

  it('leaves the popup of a line carried from the map up with speech off after it ends, showing every later line in it', () => {
    const ui = talkingUi();
    const merc = line(SpeechSurface.TACTICAL, 3);
    ui.follow(merc, map, false);
    ui.follow(merc, tactical, false);
    ui.follow(null, tactical, false);
    expect([ui.popups, ui.region]).toEqual([[], SCREEN_POPUP]);
    ui.follow(line(SpeechSurface.TACTICAL, 4, 2), tactical, false);
    expect([ui.popups, ui.region]).toEqual([[SCREEN_POPUP], SCREEN_POPUP]);
    ui.follow(line(SpeechSurface.EXTERNAL, null, 3), map, false);
    expect(ui.popups).toEqual([SCREEN_POPUP]);
  });

  it('leaves the unseen popup of a line without a soldier carried to the map registered, so a later popup shows there too', () => {
    const ui = talkingUi();
    const away = line(SpeechSurface.TACTICAL, null);
    ui.follow(away, tactical, true);
    ui.follow(away, map, true);
    ui.follow(null, map, true);
    expect([ui.popups, ui.region]).toEqual([[], SCREEN_POPUP]);
    ui.follow(line(SpeechSurface.EXTERNAL, null, 2), map, true);
    expect([ui.popups, ui.region]).toEqual([[SCREEN_POPUP, EXTERN_PANEL], SCREEN_POPUP]);
    ui.follow(null, map, true);
    expect([ui.popups, ui.region]).toEqual([[], null]);
  });
});

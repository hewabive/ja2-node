// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-11-09. See LICENSE (SFI-SCLA).
// @src src/game/Tactical/Dialogue_Control.cc CreateTalkingUI (the subtitle box and, with SPEECH on, the face popup of the
// @src screen a line starts on, guiScreenIDUsedWhenUICreated), HandleDialogue (a talking face carried from the game screen
// @src to the map screen loses its popup, and one without a soldier gets an unseen popup at 10, 20 whose click region
// @src stays, as gfFacePanelActive is cleared after HandleTacticalSpeechUI; one carried from the map screen to the game
// @src screen gets the popup at 10, 20 whatever the speech option, beside a popup the map screen showed, and keeps the
// @src click region it had), HandleTacticalSpeechUI and HandleExternNPCSpeechFace (RegisterVideoOverlay, the region only
// @src while fExternFaceBoxRegionCreated is clear), ExecuteTacticalTextBox (the box stays where it was created).

import type { ActiveLine, SpeechLine, SpeechPresenter } from '../../speech.ts';
import type { SubtitlePlace } from './subtitle-box.ts';

export const SpeechScreen = { TACTICAL: 'tactical', MAP: 'map' } as const;
export type SpeechScreen = (typeof SpeechScreen)[keyof typeof SpeechScreen];

export interface UiPoint {
  readonly x: number;
  readonly y: number;
}

export interface SpeechPlacement {
  readonly screen: SpeechScreen;
  textBox(line: SpeechLine): SubtitlePlace | null;
  facePopup(line: SpeechLine): UiPoint | null;
  carriedPopup(line: SpeechLine): UiPoint | null;
}

const NO_LINE = -1;
const talkingUis = new WeakMap<SpeechPresenter, TalkingUi>();

export class TalkingUi {
  #line = NO_LINE;
  #screen: SpeechScreen = SpeechScreen.TACTICAL;
  #textBox: SubtitlePlace | null = null;
  #popups: UiPoint[] = [];
  #popupShown = false;
  #region: UiPoint | null = null;

  static of(presenter: SpeechPresenter): TalkingUi {
    let ui = talkingUis.get(presenter);
    if (!ui) {
      ui = new TalkingUi();
      talkingUis.set(presenter, ui);
    }
    return ui;
  }

  get line(): number {
    return this.#line;
  }

  get textBox(): SubtitlePlace | null {
    return this.#textBox;
  }

  get popups(): readonly UiPoint[] {
    return this.#popupShown ? this.#popups : [];
  }

  get region(): UiPoint | null {
    return this.#region;
  }

  follow(current: ActiveLine | null, placement: SpeechPlacement, speechOn: boolean): void {
    if (!current) this.#clear();
    else if (current.line.id !== this.#line) this.#create(current.line, placement, speechOn);
    else if (this.#screen !== placement.screen) this.#carry(current.line, placement);
  }

  #clear(): void {
    this.#line = NO_LINE;
    this.#textBox = null;
    this.#popups = [];
    this.#popupShown = false;
    this.#region = null;
  }

  #create(line: SpeechLine, placement: SpeechPlacement, speechOn: boolean): void {
    this.#clear();
    this.#line = line.id;
    this.#screen = placement.screen;
    this.#textBox = placement.textBox(line);
    const popup = speechOn ? placement.facePopup(line) : null;
    if (popup) this.#register(popup);
  }

  #carry(line: SpeechLine, placement: SpeechPlacement): void {
    if (placement.screen === SpeechScreen.MAP) this.#carryToMap(line, placement);
    else this.#registerIfAny(placement.carriedPopup(line));
    this.#screen = placement.screen;
  }

  #carryToMap(line: SpeechLine, placement: SpeechPlacement): void {
    if (!this.#popupShown) return;
    this.#popups.pop();
    this.#region = null;
    this.#registerIfAny(placement.carriedPopup(line));
    this.#popupShown = false;
  }

  #registerIfAny(popup: UiPoint | null): void {
    if (popup) this.#register(popup);
  }

  #register(popup: UiPoint): void {
    this.#popups.push(popup);
    this.#region ??= popup;
    this.#popupShown = true;
  }
}

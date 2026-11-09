// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-11-09. See LICENSE (SFI-SCLA).
// @src src/game/Tactical/Dialogue_Control.cc CreateTalkingUI (the subtitle box and, with SPEECH on, the face popup of the
// @src screen a line starts on, guiScreenIDUsedWhenUICreated), HandleDialogue (a talking face carried from the game screen
// @src to the map screen loses its popup, and one without a soldier gets an unseen popup at 10, 20 whose click region
// @src stays, as gfFacePanelActive is cleared after HandleTacticalSpeechUI; one carried from the map screen to the game
// @src screen gets the popup at 10, 20 whatever the speech option and keeps the click region it had),
// @src HandleTacticalSpeechUI and HandleExternNPCSpeechFace (RegisterVideoOverlay into the face's one overlay, so a face
// @src that already has one leaves it registered for good; the region only while fExternFaceBoxRegionCreated is clear),
// @src HandleDialogueEnd (with SPEECH on only: the face's overlay and the region go, for a tactical line only while
// @src gfFacePanelActive is set), HandleShutDownOfMapScreenWhileExternfaceIsTalking (the talking face's overlay goes as
// @src the map screen closes while the region exists), RenderFaceOverlay (every registered overlay shows the talking face
// @src while gfFacePanelActive is set), ExecuteTacticalTextBox (the box stays where it was created).

import { type ActiveLine, type SpeechLine, type SpeechPresenter, SpeechSurface } from '../../speech.ts';
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

interface FaceOverlay {
  face: string | null;
  readonly at: UiPoint;
}

const NO_LINE = -1;
const talkingUis = new WeakMap<SpeechPresenter, TalkingUi>();

function faceOf(line: SpeechLine): string {
  return `${line.surface}:${line.profile}`;
}

export class TalkingUi {
  #line: SpeechLine | null = null;
  #screen: SpeechScreen = SpeechScreen.TACTICAL;
  #textBox: SubtitlePlace | null = null;
  #overlays: FaceOverlay[] = [];
  #panelActive = false;
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
    return this.#line?.id ?? NO_LINE;
  }

  get textBox(): SubtitlePlace | null {
    return this.#textBox;
  }

  get popups(): readonly UiPoint[] {
    return this.#panelActive && this.#line ? this.#overlays.map((o) => o.at) : [];
  }

  get region(): UiPoint | null {
    return this.#region;
  }

  follow(current: ActiveLine | null, placement: SpeechPlacement, speechOn: boolean): void {
    const line = this.#line;
    if (line && line.id !== current?.line.id) this.#end(line, speechOn);
    if (!current) return;
    if (!this.#line) this.#create(current.line, placement, speechOn);
    else if (this.#screen !== placement.screen) this.#carry(current.line, placement);
  }

  endMapScreen(): void {
    if (this.#region && this.#line) this.#removeOverlayOf(faceOf(this.#line));
  }

  #create(line: SpeechLine, placement: SpeechPlacement, speechOn: boolean): void {
    this.#line = line;
    this.#screen = placement.screen;
    this.#textBox = placement.textBox(line);
    const popup = speechOn ? placement.facePopup(line) : null;
    if (popup) this.#register(faceOf(line), popup);
  }

  #carry(line: SpeechLine, placement: SpeechPlacement): void {
    if (placement.screen === SpeechScreen.MAP) this.#carryToMap(line, placement);
    else this.#registerIfAny(faceOf(line), placement.carriedPopup(line));
    this.#screen = placement.screen;
  }

  #carryToMap(line: SpeechLine, placement: SpeechPlacement): void {
    if (!this.#panelActive) return;
    const face = faceOf(line);
    this.#removeOverlayOf(face);
    this.#region = null;
    this.#registerIfAny(face, placement.carriedPopup(line));
    this.#panelActive = false;
  }

  #end(line: SpeechLine, speechOn: boolean): void {
    this.#line = null;
    this.#textBox = null;
    if (!speechOn || !this.#endTakesFaceDown(line)) return;
    this.#removeOverlayOf(faceOf(line));
    this.#panelActive = false;
    this.#region = null;
  }

  #endTakesFaceDown(line: SpeechLine): boolean {
    if (line.surface === SpeechSurface.EXTERNAL) return true;
    return line.surface === SpeechSurface.TACTICAL && this.#panelActive;
  }

  #registerIfAny(face: string, popup: UiPoint | null): void {
    if (popup) this.#register(face, popup);
  }

  #register(face: string, popup: UiPoint): void {
    for (const o of this.#overlays) if (o.face === face) o.face = null;
    this.#overlays.push({ face, at: popup });
    this.#region ??= popup;
    this.#panelActive = true;
  }

  #removeOverlayOf(face: string): void {
    this.#overlays = this.#overlays.filter((o) => o.face !== face);
  }
}

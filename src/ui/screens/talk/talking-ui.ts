// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-11-09. See LICENSE (SFI-SCLA).
// @src src/game/Tactical/Dialogue_Control.cc CreateTalkingUI (the subtitle box and, with SPEECH on, the face popup of the
// @src screen a line starts on, guiScreenIDUsedWhenUICreated), HandleDialogue (a talking face carried from the game screen
// @src to the map screen loses its popup and its click region; one carried from the map screen to the game screen gets
// @src the popup at 10, 20 whatever the speech option and keeps the click region it had),
// @src HandleTacticalSpeechUI and HandleExternNPCSpeechFace (RegisterVideoOverlay into the face's one overlay; the region
// @src only while fExternFaceBoxRegionCreated is clear),
// @src HandleDialogueEnd (the face's overlay and the region go, for a tactical line only while gfFacePanelActive is
// @src set; the popup a line carried to the game screen got goes with its region at its end, original-bugs "Carried
// @src popup after its line", 2026-11-17; whatever the speech option, original-bugs "Popup after its line", 2026-11-19),
// @src HandleShutDownOfMapScreenWhileExternfaceIsTalking (the talking face's overlay goes as the map screen closes while
// @src the region exists), RenderFaceOverlay (every registered overlay shows the talking face while gfFacePanelActive
// @src is set), ExecuteTacticalTextBox (the box stays where it was created); Faces.cc DeleteFace (SetAutoFaceInActive
// @src takes the face's overlay down, and a face still talking ends its talking UI as HandleDialogueEnd does) from
// @src DeleteSoldierFace, for every soldier at a load (SaveLoadGame.cc LoadSavedGame, TrashAllSoldiers) and wherever
// @src the simulation deletes a soldier's face, his line ending with it (2026-11-09).

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

const FaceOwner = { SOLDIER: 'soldier', TALK_PANEL: 'talkPanel' } as const;
type FaceOwner = (typeof FaceOwner)[keyof typeof FaceOwner] | SpeechSurface;

interface FaceOverlay {
  readonly face: string;
  readonly owner: FaceOwner;
  readonly at: UiPoint;
}

const NO_LINE = -1;
const talkingUis = new WeakMap<SpeechPresenter, TalkingUi>();

function faceOwner(line: SpeechLine): FaceOwner {
  if (line.surface === SpeechSurface.TACTICAL && line.npcUi !== true) return FaceOwner.SOLDIER;
  return line.npcUi ? FaceOwner.TALK_PANEL : line.surface;
}

function faceKey(owner: FaceOwner, profile: number): string {
  return `${owner}:${profile}`;
}

function faceOf(line: SpeechLine): string {
  return faceKey(faceOwner(line), line.profile);
}

export class TalkingUi {
  #line: SpeechLine | null = null;
  #screen: SpeechScreen = SpeechScreen.TACTICAL;
  #textBox: SubtitlePlace | null = null;
  #overlays: FaceOverlay[] = [];
  #panelActive = false;
  #region: UiPoint | null = null;
  #carriedPopupUp = false;
  readonly #facesToDelete = new Set<string>();

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
    if (line && line.id !== current?.line.id) this.#end(line);
    this.#deleteFacesDoneTalking(current);
    if (!current) return;
    if (!this.#line) this.#create(current.line, placement, speechOn);
    else if (this.#screen !== placement.screen) this.#carry(current.line, placement);
  }

  endMapScreen(): void {
    if (this.#region && this.#line) this.#removeOverlayOf(faceOf(this.#line));
  }

  deleteSoldierFace(profile: number): void {
    this.#facesToDelete.add(faceKey(FaceOwner.SOLDIER, profile));
  }

  deleteSoldierFaces(): void {
    this.#facesToDelete.clear();
    this.#overlays = this.#overlays.filter((o) => o.owner !== FaceOwner.SOLDIER);
    const line = this.#line;
    if (line && faceOwner(line) === FaceOwner.SOLDIER) this.#end(line);
  }

  #deleteFacesDoneTalking(current: ActiveLine | null): void {
    const talking = current ? faceOf(current.line) : null;
    for (const face of this.#facesToDelete) {
      if (face === talking) continue;
      this.#removeOverlayOf(face);
      this.#facesToDelete.delete(face);
    }
  }

  #create(line: SpeechLine, placement: SpeechPlacement, speechOn: boolean): void {
    this.#line = line;
    this.#screen = placement.screen;
    this.#textBox = placement.textBox(line);
    const popup = speechOn ? placement.facePopup(line) : null;
    if (popup) this.#register(line, popup);
  }

  #carry(line: SpeechLine, placement: SpeechPlacement): void {
    if (placement.screen === SpeechScreen.MAP) this.#carryToMap(line);
    else this.#carryToTactical(line, placement.carriedPopup(line));
    this.#screen = placement.screen;
  }

  #carryToTactical(line: SpeechLine, popup: UiPoint | null): void {
    if (!popup) return;
    this.#register(line, popup);
    this.#carriedPopupUp = true;
  }

  #carryToMap(line: SpeechLine): void {
    if (!this.#panelActive) return;
    this.#takeFaceDown(line);
  }

  #end(line: SpeechLine): void {
    const takesFaceDown = this.#carriedPopupUp || this.#lineEndTakesFaceDown(line);
    this.#line = null;
    this.#textBox = null;
    if (takesFaceDown) this.#takeFaceDown(line);
  }

  #lineEndTakesFaceDown(line: SpeechLine): boolean {
    if (line.surface === SpeechSurface.EXTERNAL) return true;
    return line.surface === SpeechSurface.TACTICAL && this.#panelActive;
  }

  #takeFaceDown(line: SpeechLine): void {
    this.#removeOverlayOf(faceOf(line));
    this.#panelActive = false;
    this.#region = null;
    this.#carriedPopupUp = false;
  }

  #register(line: SpeechLine, popup: UiPoint): void {
    const face = faceOf(line);
    this.#removeOverlayOf(face);
    this.#overlays.push({ face, owner: faceOwner(line), at: popup });
    this.#region ??= popup;
    this.#panelActive = true;
  }

  #removeOverlayOf(face: string): void {
    this.#overlays = this.#overlays.filter((o) => o.face !== face);
  }
}

// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-11-03. See LICENSE (SFI-SCLA).
// @src src/game/Strategic/MapScreen.cc MapScreenHandle (HandleDialogue every map screen frame; on entry a face still
// @src talking makes its merc the info character through ContinueDialogue, whatever the speech option), ContinueDialogue
// @src (ChangeSelectedInfoChar with the selection reset, only for a listed merc not selected yet);
// @src src/game/Tactical/Dialogue_Control.cc CreateTalkingUI (the subtitle box when SUBTITLES is on or the line has no
// @src voice), HandleTacticalTextUI (a merc's box on the map screen at getTacticalTextBoxX, getTacticalTextBoxY),
// @src HandleTacticalSpeechUI (with SPEECH on, a merc starting a line on the map screen becomes the info character),
// @src HandleTacticalNPCTextUI (an NPC's line on the map screen goes to the message list alone).
// @src Dialogue_Control.cc HandleExternNPCSpeechFace and DisplayTextForExternalNPC (Skyrider and the head miners in the
// @src popup at the external panel and their box 97 to its right), HandleTacticalSpeechUI (a merc line without a soldier
// @src in the popup at the screen's 10, 20), RenderFaceOverlay (the panel without a soldier: the nickname and the face);
// @src Strategic/Map_Screen_Interface.cc TurnOnSectorLocator (the locator as the line starts, none on Skyrider's
// @src helicopter while the aircraft show), Map_Screen_Helicopter.cc HandleAnimationOfSectors (the yellow locator)
// @src (2026-11-09); MapScreen.cc EndMapScreen (HandleShutDownOfMapScreenWhileExternfaceIsTalking); RenderFaceOverlay (an external speaker with a soldier: the soldier's panel, his name and his sector
// @src when it is not the loaded one), HandleDialogue (a line carried to the map keeps no popup for a speaker with a
// @src soldier, 2026-11-09).

import type { ProfilePresentation } from '../../../content/narrative/profile-presentation.ts';
import { FontColor } from '../../../content/text/font-colors.ts';
import type { ViewFrame } from '../../../protocol/view.ts';
import type { DrawList } from '../../draw-list.ts';
import type { MouseRegion } from '../../input/regions.ts';
import type { UiServices } from '../../services.ts';
import {
  type ActiveLine,
  isQueuedQuoteEvent,
  type QuoteEvent,
  type SpeakingFace,
  type SpeechLine,
  type SpeechPresenter,
  type SpeechRouting,
  SpeechSurface,
  speakerHasSoldier,
  speechLineOf,
} from '../../speech.ts';
import { FontName } from '../../text/fonts.ts';
import { hCenterVCenterAlign } from '../../text/measure.ts';
import { fontColors, mprint } from '../../text/print.ts';
import { reduceStringLength } from '../../text/wrap.ts';
import type { MercTextBoxArt, MercTextBoxFonts } from '../../widgets/merc-text-box.ts';
import type { WidgetInfo } from '../../widgets/widget-info.ts';
import { drawTalkingFace, FaceAnimator } from '../tactical/faces.ts';
import { smallFaceRecord } from '../talk/speech-surfaces.ts';
import { SubtitleBox, type SubtitlePlace, skipRegion } from '../talk/subtitle-box.ts';
import { type SpeechPlacement, SpeechScreen, TalkingUi, type UiPoint } from '../talk/talking-ui.ts';

const OWNER = 'mapSpeech';
const NO_LINE = -1;
const FACE_POPUP_ID = 'speechFacePopup';
const NAME_COLOR = FontColor.MCOLOR_LTGRAY;
const SHADOW_FOR_NAME = 2;

type FrameEvent = NonNullable<ViewFrame['events']>[number];

export type FaceArea = readonly [number, number, number, number];

export interface ExternFaceStyle {
  readonly panel: string;
  readonly panelWithSoldier: string;
  readonly width: number;
  readonly height: number;
  readonly face: UiPoint;
  readonly name: FaceArea;
  readonly nameWithSoldier: FaceArea;
  readonly sector: FaceArea;
  readonly sectorWidth: number;
}

export interface MapSpeechHooks {
  readonly services: UiServices;
  readonly presenter: SpeechPresenter;
  readonly boxArt: MercTextBoxArt;
  readonly boxFonts: () => MercTextBoxFonts;
  readonly place: () => SubtitlePlace;
  readonly externPanel: (line: SpeechLine) => UiPoint;
  readonly externTextOffset: () => number;
  readonly screenPopup: () => UiPoint;
  readonly faceStyle: () => ExternFaceStyle;
  readonly speechOn: () => boolean;
  readonly airspaceShown: () => boolean;
  readonly routing: () => SpeechRouting;
  readonly listed: (soldier: number) => boolean;
  readonly select: (soldier: number) => void;
  readonly profile: (id: number) => ProfilePresentation | null;
  readonly soldierName: (soldier: number) => string | null;
  readonly worldSector: () => string | null;
  readonly ensureImage: (path: string) => boolean;
  readonly gaps: (file: string) => readonly { readonly start: number; readonly end: number }[] | null;
  readonly random: (range: number) => number;
}

function mercLine(line: SpeechLine): boolean {
  return line.surface === SpeechSurface.TACTICAL && line.npcUi !== true;
}

export class MapSpeech {
  readonly #hooks: MapSpeechHooks;
  readonly #box: SubtitleBox;
  #now = 0;
  #seenLine = NO_LINE;
  #locatorLine = NO_LINE;
  #locator: string | null = null;
  #faceRegion: MouseRegion | null = null;
  #faceRegionAt: UiPoint | null = null;
  #popupFace: FaceAnimator | null = null;
  #popupProfile = -1;

  constructor(hooks: MapSpeechHooks) {
    this.#hooks = hooks;
    this.#box = new SubtitleBox({ ...hooks, owner: OWNER, now: () => this.#now });
  }

  get subtitle(): string | null {
    return this.#box.text;
  }

  get talking(): boolean {
    return this.#hooks.presenter.current !== null;
  }

  get boxShown(): boolean {
    return this.#box.text !== null;
  }

  get speaking(): SpeakingFace | null {
    return this.#hooks.presenter.soldierSpeaking;
  }

  get locator(): string | null {
    return this.#locator;
  }

  get facePopupShown(): boolean {
    return this.#ui.popups.length > 0;
  }

  get #ui(): TalkingUi {
    return TalkingUi.of(this.#hooks.presenter);
  }

  readonly #placement: SpeechPlacement = {
    screen: SpeechScreen.MAP,
    textBox: (line) => this.#textBoxPlace(line),
    facePopup: (line) => this.#facePopupPlace(line),
    carriedPopup: (line) => (speakerHasSoldier(line) ? null : this.#hooks.screenPopup()),
  };

  frames(frames: readonly ViewFrame[]): void {
    const presenter = this.#hooks.presenter;
    for (const frame of frames) {
      if (!presenter.takesFrame(frame)) continue;
      for (const event of frame.events ?? []) this.#event(event);
    }
  }

  #event(event: FrameEvent): void {
    const presenter = this.#hooks.presenter;
    if (event.type === 'lineCut') {
      presenter.cut(event.profile, event.saidAt, event.tail);
      return;
    }
    if (!isQueuedQuoteEvent(event)) return;
    const line = speechLineOf(event as QuoteEvent, this.#hooks.routing());
    if (line) presenter.enqueue(line);
  }

  enter(now: number): void {
    this.#now = now;
    const current = this.#hooks.presenter.current;
    this.#seenLine = current?.line.id ?? NO_LINE;
    this.#selectSpeaker(current);
  }

  update(now: number): void {
    this.#now = now;
    const presenter = this.#hooks.presenter;
    presenter.update(now);
    const current = presenter.current;
    if (current && current.line.id !== this.#seenLine) {
      this.#seenLine = current.line.id;
      if (this.#hooks.speechOn()) this.#selectSpeaker(current);
    }
    this.#followLocator(current);
    const ui = this.#ui;
    ui.follow(current, this.#placement, this.#hooks.speechOn());
    const box = ui.textBox;
    this.#box.sync(box && current?.subtitles ? current : null, () => box ?? this.#hooks.place());
    this.#syncFaceRegion(ui.region);
    this.#syncPopupFace(now, ui.popups.length > 0 ? current : null);
  }

  stop(): void {
    this.#hooks.presenter.skip(this.#now, true);
  }

  exit(): void {
    this.#box.dispose();
    this.#faceRegion?.remove();
    this.#faceRegion = null;
    this.#faceRegionAt = null;
    this.#ui.endMapScreen();
  }

  render(list: DrawList): void {
    for (const at of this.#ui.popups) this.#renderFacePopup(list, at);
    this.#box.render(list);
  }

  describe(): readonly WidgetInfo[] {
    const region = this.#faceRegion;
    const popup: WidgetInfo[] = region
      ? [
          {
            id: FACE_POPUP_ID,
            kind: 'region',
            rect: { x: region.x1, y: region.y1, width: region.width, height: region.height },
            visible: this.facePopupShown,
            enabled: true,
            state: null,
            text: null,
            frame: null,
          },
        ]
      : [];
    return [...popup, ...this.#box.describe()];
  }

  #textBoxPlace(line: SpeechLine): SubtitlePlace | null {
    if (mercLine(line)) return this.#hooks.place();
    if (line.surface !== SpeechSurface.EXTERNAL) return null;
    const panel = this.#hooks.externPanel(line);
    return { x: panel.x + this.#hooks.externTextOffset(), y: panel.y, width: this.#hooks.place().width };
  }

  #facePopupPlace(line: SpeechLine): UiPoint | null {
    if (line.surface === SpeechSurface.EXTERNAL) return this.#hooks.externPanel(line);
    return mercLine(line) && line.soldier === null ? this.#hooks.screenPopup() : null;
  }

  #followLocator(current: ActiveLine | null): void {
    if (!current) {
      this.#locatorLine = NO_LINE;
      this.#locator = null;
      return;
    }
    if (current.line.id === this.#locatorLine) return;
    this.#locatorLine = current.line.id;
    const hidden = current.line.helicopter === true && this.#hooks.airspaceShown();
    this.#locator = hidden ? null : current.line.sector;
  }

  #syncFaceRegion(at: UiPoint | null): void {
    if (at === this.#faceRegionAt) return;
    this.#faceRegion?.remove();
    this.#faceRegionAt = at;
    if (!at) {
      this.#faceRegion = null;
      return;
    }
    const style = this.#hooks.faceStyle();
    const hooks = { ...this.#hooks, owner: OWNER, now: () => this.#now };
    this.#faceRegion = skipRegion(hooks, FACE_POPUP_ID, at.x, at.y, style.width, style.height);
  }

  #syncPopupFace(now: number, line: ActiveLine | null): void {
    if (!line) {
      this.#popupFace = null;
      this.#popupProfile = -1;
      return;
    }
    if (this.#popupProfile !== line.line.profile) {
      const profile = this.#hooks.profile(line.line.profile);
      this.#popupFace = profile ? new FaceAnimator(smallFaceRecord(profile), now, this.#hooks.random) : null;
      this.#popupProfile = line.line.profile;
      if (this.#popupFace) this.#hooks.ensureImage(this.#popupFace.record.path);
    }
    const speaking = this.#hooks.presenter.speaking;
    const gaps = speaking?.file ? (this.#hooks.gaps(speaking.file) ?? []) : [];
    this.#popupFace?.update(
      now,
      { life: 100 },
      speaking ? { playing: speaking.playing, elapsedMs: speaking.elapsedMs, gaps } : null,
      this.#hooks.services.images,
    );
  }

  #renderFacePopup(list: DrawList, at: UiPoint): void {
    const current = this.#hooks.presenter.current;
    if (!current) return;
    const style = this.#hooks.faceStyle();
    const soldier = current.line.externalSoldier;
    list.image(soldier === undefined ? style.panel : style.panelWithSoldier, 0, at.x, at.y);
    const nickname = this.#hooks.profile(current.line.profile)?.nickname ?? '';
    if (soldier === undefined) this.#printOnPopup(list, at, style.name, nickname);
    else {
      this.#printOnPopup(list, at, style.nameWithSoldier, this.#hooks.soldierName(soldier) ?? nickname);
      const sector = current.line.sector;
      if (sector && sector !== this.#hooks.worldSector()) this.#printOnPopup(list, at, style.sector, sector, style.sectorWidth);
    }
    const face = this.#popupFace;
    if (face) drawTalkingFace(list, this.#hooks.services.images, face, at.x + style.face.x, at.y + style.face.y);
  }

  #printOnPopup(list: DrawList, at: UiPoint, area: FaceArea, text: string, maxWidth?: number): void {
    const font = this.#hooks.services.fonts.get(FontName.BLOCKFONT2);
    const shown = maxWidth === undefined ? text : reduceStringLength(text, maxWidth, font);
    const [x, y, width, height] = area;
    const to = hCenterVCenterAlign(at.x + x, at.y + y, width, height, shown, font);
    mprint(list, font, to.x, to.y, shown, fontColors(NAME_COLOR, SHADOW_FOR_NAME));
  }

  #mercLine(line: ActiveLine | null): ActiveLine | null {
    const soldier = line?.line.surface === SpeechSurface.TACTICAL ? line.line.soldier : null;
    return line && soldier !== null && this.#hooks.listed(soldier) ? line : null;
  }

  #selectSpeaker(line: ActiveLine | null): void {
    const soldier = this.#mercLine(line)?.line.soldier ?? null;
    if (soldier !== null) this.#hooks.select(soldier);
  }
}

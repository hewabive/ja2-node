// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-20. See LICENSE (SFI-SCLA).
// @src src/game/Tactical/Dialogue_Control.cc CreateTalkingUI (the subtitle box when SUBTITLES is on or the line has no
// @src voice, the face popup when SPEECH is on), HandleTacticalSpeechUI (the popup in tactical for every merc line),
// @src HandleExternNPCSpeechFace (Skyrider and the head miners), RenderFaceOverlay (the panel by speaker, name, sector,
// @src bars, face), ExecuteTacticalTextBox (one box at a time, a click region over it), TextOverlayClickCallback and
// @src FaceOverlayClickCallback (a click shuts the face up after 500 ms), HandleDialogueEnd; src/game/Tactical/Civ_Quotes.cc
// @src BeginCivQuote (the quoted line in a basic box centred on GetSoldierScreenPos, clamped to the screen width and the
// @src viewport), QuoteOverlayClickCallback, ShutDownQuoteBox; src/game/Tactical/Faces.cc GetFaceRelativeCoordinates
// @src (FACE_FORCE_SMALL uses the RPC small face offsets); HandleDialogue (a line carried over from the map screen takes
// @src the popup and keeps the subtitle box and click region where they were, through TalkingUi, 2026-11-09);
// @src RenderFaceOverlay (Skyrider or a head miner with a soldier gets the soldier's panel, 2026-11-09; the bars of the
// @src soldier with the speaker's profile, ours off the map or not ours, from FindSoldierByProfileID); CreateTalkingUI
// @src (DIALOGUE_NPC_UI makes no face popup and HandleTacticalNPCTextUI no subtitle box outside the talk panel).

import type { ProfilePresentation } from '../../../content/narrative/profile-presentation.ts';
import { FontColor } from '../../../content/text/font-colors.ts';
import { idiv } from '../../../core/int.ts';
import type { PlayerView, SoldierView } from '../../../protocol/view.ts';
import type { DrawList } from '../../draw-list.ts';
import { MouseReason, Priority } from '../../input/mouse.ts';
import type { MouseRegion } from '../../input/regions.ts';
import type { ControllerContract } from '../../layout/controller.ts';
import type { LayoutModel } from '../../layout/model.ts';
import type { CustomRenderer } from '../../layout/view.ts';
import type { UiServices } from '../../services.ts';
import {
  type ActiveLine,
  type CivQuoteLine,
  quoted,
  type SpeakerBarsRef,
  type SpeechLine,
  type SpeechPresenter,
  SpeechSurface,
} from '../../speech.ts';
import { FontName } from '../../text/fonts.ts';
import { hCenterVCenterAlign } from '../../text/measure.ts';
import { fontColors, mprint } from '../../text/print.ts';
import { reduceStringLength } from '../../text/wrap.ts';
import { MercTextBox, type MercTextBoxArt, type MercTextBoxFonts } from '../../widgets/merc-text-box.ts';
import type { WidgetInfo } from '../../widgets/widget-info.ts';
import { mercBars } from '../map/merc-soldier.ts';
import type { BarValues } from '../tactical/bars.ts';
import { drawTalkingFace, FaceAnimator, type FaceRecord, faceFileOf } from '../tactical/faces.ts';
import { SubtitleBox, skipRegion } from './subtitle-box.ts';
import { type SpeechPlacement, SpeechScreen, TalkingUi, type UiPoint } from './talking-ui.ts';

export const TACTICAL_SPEECH_SCREEN = 'tacticalSpeech';
export const TACTICAL_SPEECH_LAYOUT = 'tactical-speech';
export const TACTICAL_SPEECH_CONTRACT: ControllerContract = { id: TACTICAL_SPEECH_SCREEN, actions: {}, bindings: {} };

const OWNER = 'tacticalSpeech';
const OUR_TEAM = 0;
const NAME_COLOR = FontColor.MCOLOR_LTGRAY;
const SHADOW_FOR_NAME = 2;

export interface SpeechBounds {
  readonly screenWidth: number;
  readonly viewportTop: number;
  readonly viewportBottom: number;
}

export interface ScreenBoxLike {
  readonly x: number;
  readonly y: number;
}

export interface SpeechSurfaceHooks {
  readonly services: UiServices;
  readonly model: LayoutModel;
  readonly presenter: SpeechPresenter;
  readonly boxArt: MercTextBoxArt;
  readonly boxFonts: () => MercTextBoxFonts;
  readonly random: (range: number) => number;
  readonly view: () => PlayerView | null;
  readonly profile: (id: number) => ProfilePresentation | null;
  readonly ensureImage: (path: string) => boolean;
  readonly gaps: (file: string) => readonly { readonly start: number; readonly end: number }[] | null;
  readonly speechOn: () => boolean;
  readonly bounds: () => SpeechBounds;
  readonly soldierScreenPos: (soldier: number) => ScreenBoxLike | null;
  readonly sectorShown: (sector: string) => boolean;
  readonly drawSoldierFace: (list: DrawList, soldier: SoldierView, x: number, y: number) => void;
  readonly drawBars: (list: DrawList, values: BarValues, x: number, y: number) => void;
  readonly barValues: (soldier: SoldierView) => BarValues;
}

interface PlacedBox {
  readonly id: number;
  readonly box: MercTextBox;
  readonly x: number;
  readonly y: number;
  readonly region: MouseRegion;
}

type Rect4 = readonly [number, number, number, number];

export function civQuotePosition(
  centre: ScreenBoxLike,
  width: number,
  height: number,
  bounds: SpeechBounds,
): { readonly x: number; readonly y: number } {
  let x = centre.x - idiv(width, 2);
  let y = centre.y - idiv(height, 2);
  if (x < 0) x = 0;
  if (x + width > bounds.screenWidth) x = bounds.screenWidth - width;
  if (y < bounds.viewportTop) y = bounds.viewportTop;
  y = Math.min(y, bounds.viewportBottom - height);
  return { x, y };
}

function speakerSoldierId(line: SpeechLine): number | null {
  if (line.surface === SpeechSurface.TACTICAL) return line.soldier;
  return line.surface === SpeechSurface.EXTERNAL ? (line.externalSoldier ?? null) : null;
}

function talkingUiOnTactical(line: SpeechLine): boolean {
  if (line.surface === SpeechSurface.EXTERNAL) return true;
  return line.surface === SpeechSurface.TACTICAL && line.npcUi !== true;
}

export function speakerBarValues(bars: SpeakerBarsRef): BarValues {
  return { ...bars, robot: false, vehicle: false };
}

export function smallFaceRecord(profile: ProfilePresentation): FaceRecord {
  const small = profile.smallFace;
  return {
    path: faceFileOf(profile.faceIndex),
    eyes: small?.eyes ?? profile.eyes,
    mouth: small?.mouth ?? profile.mouth,
    blinkFrequency: profile.blinkFrequency,
    expressionFrequency: profile.expressionFrequency,
  };
}

export class SpeechSurfaces {
  readonly #hooks: SpeechSurfaceHooks;
  readonly #textBox: SubtitleBox;
  #now = 0;
  #civBox: PlacedBox | null = null;
  #faceRegion: MouseRegion | null = null;
  #faceRegionAt: UiPoint | null = null;
  #popupFace: FaceAnimator | null = null;
  #popupProfile = -1;
  #civAnchor: { readonly id: number; readonly x: number; readonly y: number } | null = null;

  constructor(hooks: SpeechSurfaceHooks) {
    this.#hooks = hooks;
    this.#textBox = new SubtitleBox({ ...hooks, owner: OWNER, now: () => this.#now });
  }

  renderers(): Readonly<Record<string, CustomRenderer>> {
    return {
      speechFacePopup: (list, _rect, params) => this.#renderFacePopup(list, params),
      speechTextBox: (list) => this.#renderTextBox(list),
      civQuoteBox: (list) => this.#renderCivBox(list),
    };
  }

  get facePopupShown(): boolean {
    return this.#ui.popups.length > 0;
  }

  get #ui(): TalkingUi {
    return TalkingUi.of(this.#hooks.presenter);
  }

  readonly #placement: SpeechPlacement = {
    screen: SpeechScreen.TACTICAL,
    textBox: (line) => (talkingUiOnTactical(line) ? this.#textBoxPlace() : null),
    facePopup: (line) => (talkingUiOnTactical(line) ? this.#facePopupPlace() : null),
    carriedPopup: () => this.#facePopupPlace(),
  };

  get textBoxText(): string | null {
    return this.#textBox.text;
  }

  get civQuoteText(): string | null {
    return this.#civBox?.box.request.text ?? null;
  }

  update(now: number): void {
    this.#now = now;
    const current = this.#hooks.presenter.current;
    const ui = this.#ui;
    ui.follow(current, this.#placement, this.#hooks.speechOn());
    this.#syncFaceRegion(ui.region);
    const box = ui.textBox;
    this.#textBox.sync(box && current?.subtitles ? current : null, () => box ?? this.#textBoxPlace());
    this.#syncPopupFace(now, ui.popups.length > 0 && !this.#ownSpeaker(current) ? current : null);
    this.#syncCivBox(this.#hooks.presenter.civQuote);
  }

  dispose(): void {
    this.#faceRegion?.remove();
    this.#faceRegion = null;
    this.#faceRegionAt = null;
    this.#textBox.dispose();
    this.#civBox?.region.remove();
    this.#civBox = null;
    this.#civAnchor = null;
  }

  describe(): readonly WidgetInfo[] {
    const out: WidgetInfo[] = [];
    const add = (id: string, x: number, y: number, width: number, height: number, text: string | null) =>
      out.push({ id, kind: 'region', rect: { x, y, width, height }, visible: true, enabled: true, state: null, text, frame: null });
    const face = this.#faceRegion;
    if (face) add('speechFacePopup', face.x1, face.y1, face.width, face.height, null);
    out.push(...this.#textBox.describe());
    const civ = this.#civBox;
    if (civ) add('civQuoteBox', civ.x, civ.y, civ.box.width, civ.box.height, civ.box.request.text);
    return out;
  }

  #speakerSoldier(line: ActiveLine | null): SoldierView | null {
    const id = line ? speakerSoldierId(line.line) : null;
    if (id === null) return null;
    return this.#hooks.view()?.soldiers.find((v) => v.id === id) ?? null;
  }

  #ownSpeaker(line: ActiveLine | null): boolean {
    return this.#speakerSoldier(line)?.team === OUR_TEAM;
  }

  #style(name: string): Readonly<Record<string, unknown>> {
    return this.#hooks.model.style(name) as Readonly<Record<string, unknown>>;
  }

  #number(value: unknown): number {
    return this.#hooks.model.number(value as number | string);
  }

  #rect4(value: unknown): Rect4 {
    return (value as unknown[]).map((v) => this.#number(v)) as unknown as Rect4;
  }

  #textBoxPlace() {
    const s = this.#style('textBox');
    return { x: this.#number(s.x), y: this.#number(s.y), width: this.#number(s.width) };
  }

  #facePopupPlace(): UiPoint {
    const s = this.#style('facePopup');
    return { x: this.#number(s.x), y: this.#number(s.y) };
  }

  #syncFaceRegion(at: UiPoint | null): void {
    if (at === this.#faceRegionAt) return;
    this.#faceRegion?.remove();
    this.#faceRegionAt = at;
    if (!at) {
      this.#faceRegion = null;
      return;
    }
    const s = this.#style('facePopup');
    const hooks = { ...this.#hooks, owner: OWNER, now: () => this.#now };
    this.#faceRegion = skipRegion(hooks, 'speechFacePopup', at.x, at.y, this.#number(s.width), this.#number(s.height));
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

  #syncCivBox(civ: CivQuoteLine | null): void {
    if (!civ) {
      this.#civBox?.region.remove();
      this.#civBox = null;
      this.#civAnchor = null;
      return;
    }
    if (this.#civBox?.id === civ.id) return;
    this.#civBox?.region.remove();
    const s = this.#style('civBox');
    const box = new MercTextBox(
      this.#hooks.boxArt,
      { text: quoted(civ.text), width: this.#number(s.width), marginX: 0, marginTop: 0, marginBottom: 0 },
      this.#hooks.boxFonts(),
    );
    if (this.#civAnchor?.id !== civ.id) {
      const pos = this.#hooks.soldierScreenPos(civ.soldier) ?? { x: 0, y: 0 };
      this.#civAnchor = { id: civ.id, x: pos.x, y: pos.y };
    }
    const at = civQuotePosition(this.#civAnchor, box.width, box.height, this.#hooks.bounds());
    let down = false;
    const region = this.#hooks.services.regions.define({
      x1: at.x,
      y1: at.y,
      x2: at.x + box.width,
      y2: at.y + box.height,
      priority: Priority.HIGHEST,
      cursor: 0,
      owner: OWNER,
      id: 'civQuoteBox',
      onButton: (_r, reason) => {
        if (reason & MouseReason.LBUTTON_DWN) down = true;
        if (reason & MouseReason.LBUTTON_UP && down) this.#hooks.presenter.closeCivQuote(this.#now, false);
      },
      onMove: (_r, reason) => {
        if (reason & MouseReason.LOST_MOUSE) down = false;
      },
    });
    this.#civBox = { id: civ.id, box, x: at.x, y: at.y, region };
  }

  #renderFacePopup(list: DrawList, params: Readonly<Record<string, unknown>>): void {
    const current = this.#hooks.presenter.current;
    if (!current) return;
    for (const at of this.#ui.popups) this.#renderFacePopupAt(list, at, current, params);
  }

  #renderFacePopupAt(list: DrawList, rect: UiPoint, current: ActiveLine, params: Readonly<Record<string, unknown>>): void {
    const s = this.#style('facePopup');
    const soldier = this.#speakerSoldier(current);
    const withSoldier = speakerSoldierId(current.line) !== null;
    const panel = this.#hooks.model.asset(String(withSoldier ? params.panel : params.panelWithoutSoldier)).path;
    list.image(panel, 0, rect.x, rect.y);
    const font = this.#hooks.services.fonts.get(FontName.BLOCKFONT2);
    const colors = fontColors(NAME_COLOR, SHADOW_FOR_NAME);
    const print = (area: Rect4, text: string) => {
      const at = hCenterVCenterAlign(rect.x + area[0], rect.y + area[1], area[2], area[3], text, font);
      mprint(list, font, at.x, at.y, text, colors);
    };
    const [faceX, faceY] = this.#rect4([...(s.face as unknown[]), 0, 0]);
    const nickname = this.#hooks.profile(current.line.profile)?.nickname ?? '';
    if (withSoldier) {
      print(this.#rect4(s.name), soldier?.name ?? nickname);
      const sector = current.line.sector;
      if (sector && !this.#hooks.sectorShown(sector))
        print(this.#rect4(s.sector), reduceStringLength(sector, this.#number(s.sectorWidth), font));
    } else print(this.#rect4(s.nameWithoutSoldier), nickname);
    const bars = this.#speakerBars(current.line, soldier);
    if (bars) {
      const [barsX, barsY] = this.#rect4([...(s.bars as unknown[]), 0, 0]);
      this.#hooks.drawBars(list, bars, rect.x + barsX, rect.y + barsY);
    }
    if (soldier?.team === OUR_TEAM) {
      this.#hooks.drawSoldierFace(list, soldier, rect.x + faceX, rect.y + faceY);
      return;
    }
    const face = this.#popupFace;
    if (face) drawTalkingFace(list, this.#hooks.services.images, face, rect.x + faceX, rect.y + faceY);
  }

  #speakerBars(line: SpeechLine, soldier: SoldierView | null): BarValues | null {
    if (soldier?.team === OUR_TEAM) return this.#hooks.barValues(soldier);
    if (line.bars) return speakerBarValues(line.bars);
    const id = line.surface === SpeechSurface.TACTICAL ? line.soldier : null;
    const merc = id === null ? undefined : this.#hooks.view()?.strategic?.mercs.find((m) => m.id === id);
    return merc ? mercBars(merc) : null;
  }

  #renderTextBox(list: DrawList): void {
    this.#textBox.render(list);
  }

  #renderCivBox(list: DrawList): void {
    const box = this.#civBox;
    if (box) box.box.render(list, box.x, box.y);
  }
}

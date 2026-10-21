// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-20. See LICENSE (SFI-SCLA).
// @src src/game/Tactical/Dialogue_Control.cc CreateTalkingUI (the subtitle box when SUBTITLES is on or the line has no
// @src voice, the face popup when SPEECH is on), HandleTacticalSpeechUI (the popup in tactical for every merc line),
// @src HandleExternNPCSpeechFace (Skyrider and the head miners), RenderFaceOverlay (the panel by speaker, name, sector,
// @src bars, face), ExecuteTacticalTextBox (one box at a time, a click region over it), TextOverlayClickCallback and
// @src FaceOverlayClickCallback (a click shuts the face up after 500 ms), HandleDialogueEnd; src/game/Tactical/Civ_Quotes.cc
// @src BeginCivQuote (the quoted line in a basic box centred on GetSoldierScreenPos, clamped to the screen width and the
// @src viewport), QuoteOverlayClickCallback, ShutDownQuoteBox; src/game/Tactical/Faces.cc GetFaceRelativeCoordinates
// @src (FACE_FORCE_SMALL uses the RPC small face offsets). See docs/28 §5.8.

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
import { type ActiveLine, type CivQuoteLine, quoted, type SpeechPresenter, SpeechSurface } from '../../speech.ts';
import { FontName } from '../../text/fonts.ts';
import { hCenterVCenterAlign } from '../../text/measure.ts';
import { fontColors, mprint } from '../../text/print.ts';
import { reduceStringLength } from '../../text/wrap.ts';
import { MercTextBox, type MercTextBoxArt, type MercTextBoxFonts } from '../../widgets/merc-text-box.ts';
import type { WidgetInfo } from '../../widgets/widget-info.ts';
import type { BarValues } from '../tactical/bars.ts';
import { FaceAnimator, type FaceRecord, faceFileOf } from '../tactical/faces.ts';
import { drawTalkingFace } from './talk-panel.ts';

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
  #now = 0;
  #textBox: PlacedBox | null = null;
  #civBox: PlacedBox | null = null;
  #faceRegion: MouseRegion | null = null;
  #faceLine = -1;
  #popupFace: FaceAnimator | null = null;
  #popupProfile = -1;
  #civAnchor: { readonly id: number; readonly x: number; readonly y: number } | null = null;

  constructor(hooks: SpeechSurfaceHooks) {
    this.#hooks = hooks;
  }

  renderers(): Readonly<Record<string, CustomRenderer>> {
    return {
      speechFacePopup: (list, rect, params) => this.#renderFacePopup(list, rect, params),
      speechTextBox: (list) => this.#renderTextBox(list),
      civQuoteBox: (list) => this.#renderCivBox(list),
    };
  }

  get facePopupShown(): boolean {
    return this.#faceRegion !== null;
  }

  get textBoxText(): string | null {
    return this.#textBox?.box.request.text ?? null;
  }

  get civQuoteText(): string | null {
    return this.#civBox?.box.request.text ?? null;
  }

  update(now: number): void {
    this.#now = now;
    const current = this.#hooks.presenter.current;
    const surface = current?.line.surface;
    const tactical = surface === SpeechSurface.TACTICAL || surface === SpeechSurface.EXTERNAL;
    this.#syncFaceRegion(tactical && this.#hooks.speechOn() ? current : null);
    this.#syncTextBox(tactical && current?.subtitles ? current : null);
    this.#syncPopupFace(now, tactical && !this.#ownSpeaker(current) ? current : null);
    this.#syncCivBox(this.#hooks.presenter.civQuote);
  }

  dispose(): void {
    this.#faceRegion?.remove();
    this.#faceRegion = null;
    this.#textBox?.region.remove();
    this.#textBox = null;
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
    const box = this.#textBox;
    if (box) add('speechTextBox', box.x, box.y, box.box.width, box.box.height, box.box.request.text);
    const civ = this.#civBox;
    if (civ) add('civQuoteBox', civ.x, civ.y, civ.box.width, civ.box.height, civ.box.request.text);
    return out;
  }

  #speakerSoldier(line: ActiveLine | null): SoldierView | null {
    const id = line?.line.surface === SpeechSurface.TACTICAL ? line.line.soldier : null;
    if (id === null || id === undefined) return null;
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

  #skipRegion(id: string, x: number, y: number, width: number, height: number): MouseRegion {
    let down = false;
    return this.#hooks.services.regions.define({
      x1: x,
      y1: y,
      x2: x + width,
      y2: y + height,
      priority: Priority.HIGHEST,
      cursor: 0,
      owner: OWNER,
      id,
      onButton: (_r, reason) => {
        if (reason & MouseReason.LBUTTON_DWN) down = true;
        if (reason & MouseReason.LBUTTON_UP && down) {
          down = false;
          this.#hooks.presenter.skip(this.#now, false);
        }
      },
      onMove: (_r, reason) => {
        if (reason & MouseReason.LOST_MOUSE) down = false;
      },
    });
  }

  #syncFaceRegion(line: ActiveLine | null): void {
    if (!line) {
      this.#faceRegion?.remove();
      this.#faceRegion = null;
      this.#faceLine = -1;
      return;
    }
    if (this.#faceRegion && this.#faceLine === line.line.id) return;
    this.#faceRegion?.remove();
    const s = this.#style('facePopup');
    this.#faceRegion = this.#skipRegion(
      'speechFacePopup',
      this.#number(s.x),
      this.#number(s.y),
      this.#number(s.width),
      this.#number(s.height),
    );
    this.#faceLine = line.line.id;
  }

  #syncTextBox(line: ActiveLine | null): void {
    if (!line) {
      this.#textBox?.region.remove();
      this.#textBox = null;
      return;
    }
    if (this.#textBox?.id === line.line.id) return;
    this.#textBox?.region.remove();
    const s = this.#style('textBox');
    const box = new MercTextBox(
      this.#hooks.boxArt,
      { text: quoted(line.line.text), width: this.#number(s.width), marginX: 0, marginTop: 0, marginBottom: 0 },
      this.#hooks.boxFonts(),
    );
    const x = this.#number(s.x);
    const y = this.#number(s.y);
    this.#textBox = { id: line.line.id, box, x, y, region: this.#skipRegion('speechTextBox', x, y, box.width, box.height) };
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

  #renderFacePopup(list: DrawList, rect: { x: number; y: number }, params: Readonly<Record<string, unknown>>): void {
    if (!this.#faceRegion) return;
    const current = this.#hooks.presenter.current;
    if (!current) return;
    const s = this.#style('facePopup');
    const soldier = this.#speakerSoldier(current);
    const panel = this.#hooks.model.asset(String(soldier ? params.panel : params.panelWithoutSoldier)).path;
    list.image(panel, 0, rect.x, rect.y);
    const font = this.#hooks.services.fonts.get(FontName.BLOCKFONT2);
    const colors = fontColors(NAME_COLOR, SHADOW_FOR_NAME);
    const print = (area: Rect4, text: string) => {
      const at = hCenterVCenterAlign(rect.x + area[0], rect.y + area[1], area[2], area[3], text, font);
      mprint(list, font, at.x, at.y, text, colors);
    };
    const [faceX, faceY] = this.#rect4([...(s.face as unknown[]), 0, 0]);
    if (soldier) {
      print(this.#rect4(s.name), soldier.name);
      const sector = current.line.sector;
      if (sector && !this.#hooks.sectorShown(sector))
        print(this.#rect4(s.sector), reduceStringLength(sector, this.#number(s.sectorWidth), font));
    } else print(this.#rect4(s.nameWithoutSoldier), this.#hooks.profile(current.line.profile)?.nickname ?? '');
    if (soldier?.team === OUR_TEAM) {
      const [barsX, barsY] = this.#rect4([...(s.bars as unknown[]), 0, 0]);
      this.#hooks.drawBars(list, this.#hooks.barValues(soldier), rect.x + barsX, rect.y + barsY);
      this.#hooks.drawSoldierFace(list, soldier, rect.x + faceX, rect.y + faceY);
      return;
    }
    const face = this.#popupFace;
    if (face) drawTalkingFace(list, this.#hooks.services.images, face, rect.x + faceX, rect.y + faceY);
  }

  #renderTextBox(list: DrawList): void {
    const box = this.#textBox;
    if (box) box.box.render(list, box.x, box.y);
  }

  #renderCivBox(list: DrawList): void {
    const box = this.#civBox;
    if (box) box.box.render(list, box.x, box.y);
  }
}

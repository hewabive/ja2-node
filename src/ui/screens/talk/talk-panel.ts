// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-20. See LICENSE (SFI-SCLA).
// @src src/game/Tactical/Interface_Dialogue.cc InitTalkingMenu (the panel centred on the cell origin of the NPC's tile),
// @src InternalInitTalkingMenu (clamped to the screen width and the viewport, the big face with FACE_POTENTIAL_KEYWAIT,
// @src the regions and the Done button), RenderTalkingMenu (the busy shading and disabled regions while the face talks
// @src or the queue is not empty, the subtitle popup built at TALK_PANEL_DEFAULT_SUBTITLE_WIDTH and its click region,
// @src the selection colours, zDealerStrings for a dealer), TalkPanelMoveCallback, TalkPanelClickCallback (the
// @src approaches; "Give" for a non-dealer), TalkPanelBaseRegionClickCallback (a click while talking shuts the face up),
// @src TalkPanelNameRegionClickCallback (who are you), TalkPanelNameRegionMoveCallback, TextRegionClickCallback,
// @src HandleTalkingMenuEscape (Done and Esc close when the queue is empty), HandleTalkingMenuBackspace,
// @src CalculatePopupTextOrientation (bottom, left, top, right; the hard-coded 340 is the top of the inventory panel),
// @src CalculatePopupTextPosition; src/game/Tactical/Faces.cc InitFace (faces/bNN.sti, Elliot's variants).
// @src See docs/28 §5.8.

import type { ProfilePresentation } from '../../../content/narrative/profile-presentation.ts';
import { idiv } from '../../../core/int.ts';
import type { ConversationView } from '../../../protocol/view.ts';
import type { ImageCatalog } from '../../assets.ts';
import type { DrawList } from '../../draw-list.ts';
import type { UiInputEvent } from '../../input/events.ts';
import { MouseReason, Priority } from '../../input/mouse.ts';
import type { MouseRegion } from '../../input/regions.ts';
import { type ControllerContract, ViewModelController } from '../../layout/controller.ts';
import type { LayoutModel } from '../../layout/model.ts';
import { LayoutView } from '../../layout/view.ts';
import type { UiServices } from '../../services.ts';
import { quoted, type SpeechPresenter, SpeechSurface } from '../../speech.ts';
import type { UiTextService } from '../../text/text-service.ts';
import { MercTextBox, type MercTextBoxArt, type MercTextBoxFonts } from '../../widgets/merc-text-box.ts';
import type { SliderSystem } from '../../widgets/slider.ts';
import type { WidgetInfo } from '../../widgets/widget-info.ts';
import { FaceAnimator, type FaceRecord } from '../tactical/faces.ts';

export const TALK_PANEL_SCREEN = 'talkPanel';
export const TALK_PANEL_LAYOUT = 'talk-panel';

export const TALK_PANEL_CONTRACT: ControllerContract = {
  id: TALK_PANEL_SCREEN,
  actions: {
    panelDown: {},
    panelClick: {},
    nameHover: { args: 1 },
    whoAreYou: {},
    optionHover: { args: 2 },
    option: { args: 1 },
    done: {},
  },
  bindings: {
    name: 'string',
    nameColor: 'string',
    options: 'list',
    busy: 'boolean',
    panelWidth: 'number',
    panelHeight: 'number',
  },
};

export const TALK_MENU_APPROACHES = ['repeat', 'friendly', 'direct', 'threaten', 'buySell', 'recruit'] as const;
const BUY_SELL_ENTRY = 4;
const BUY_SELL_PREFIX = 'buySell:';
const DEALER_LABELS: Readonly<Record<string, number>> = { buySell: 0, buy: 1, sell: 2, repair: 3 };
const POPUP_LEFT = 0;
const POPUP_TOP = 1;
const POPUP_BOTTOM = 2;
const POPUP_RIGHT = 3;
const FACES_DIR = 'faces';
const HOVER_ON = 1;
const PANEL_ASSET = 'panel';

export type PopupOrientation = typeof POPUP_LEFT | typeof POPUP_TOP | typeof POPUP_BOTTOM | typeof POPUP_RIGHT;

export interface TalkBounds {
  readonly screenWidth: number;
  readonly viewportTop: number;
  readonly viewportBottom: number;
  readonly inventoryTop: number;
}

export interface PanelRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface TalkOptionModel {
  readonly text: string;
  readonly color: 'normal' | 'hilite';
}

export function placeTalkPanel(anchorX: number, anchorY: number, width: number, height: number, bounds: TalkBounds): PanelRect {
  let x = anchorX - idiv(width, 2);
  if (x + width > bounds.screenWidth) x = bounds.screenWidth - width;
  if (x < 0) x = 0;
  let y = anchorY - idiv(height, 2);
  if (y < bounds.viewportTop) y = bounds.viewportTop;
  y = Math.min(y, bounds.viewportBottom - height);
  return { x, y, width, height };
}

export function popupOrientation(panel: PanelRect, boxWidth: number, boxHeight: number, bounds: TalkBounds): PopupOrientation {
  if (panel.y + boxHeight + panel.height < bounds.inventoryTop) return POPUP_BOTTOM;
  if (panel.x - boxWidth > 0) return POPUP_LEFT;
  if (panel.y - boxHeight > bounds.viewportTop) return POPUP_TOP;
  return POPUP_RIGHT;
}

export function popupPosition(
  panel: PanelRect,
  orientation: PopupOrientation,
  boxWidth: number,
  boxHeight: number,
): { x: number; y: number } {
  switch (orientation) {
    case POPUP_LEFT:
      return { x: panel.x - boxWidth, y: panel.y + idiv(panel.height, 2) - idiv(boxHeight, 2) };
    case POPUP_RIGHT:
      return { x: panel.x + panel.width + 1, y: panel.y + idiv(panel.height, 2) - idiv(boxHeight, 2) };
    case POPUP_BOTTOM:
      return { x: panel.x + idiv(panel.width, 2) - idiv(boxWidth, 2), y: panel.y + panel.height };
    default:
      return { x: panel.x + idiv(panel.width, 2) - idiv(boxWidth, 2), y: panel.y - boxHeight };
  }
}

export function bigFaceRecord(profile: ProfilePresentation, variant: string | null): FaceRecord {
  return {
    path: `${FACES_DIR}/b${String(profile.faceIndex).padStart(2, '0')}${variant ?? ''}.sti`,
    eyes: profile.eyes,
    mouth: profile.mouth,
    blinkFrequency: profile.blinkFrequency,
    expressionFrequency: profile.expressionFrequency,
  };
}

const MOUTH_FRAME_OFFSET = 4;

export function drawTalkingFace(list: DrawList, images: ImageCatalog, face: FaceAnimator, x: number, y: number): void {
  const record = face.record;
  list.image(record.path, 0, x, y);
  if (face.invalidAnim(images)) return;
  if (face.eyeFrame > 0) list.image(record.path, face.eyeFrame, x + record.eyes[0], y + record.eyes[1]);
  if (face.mouthFrame > 0) list.image(record.path, face.mouthFrame + MOUTH_FRAME_OFFSET, x + record.mouth[0], y + record.mouth[1]);
}

export interface TalkPanelHooks {
  readonly services: UiServices;
  readonly sliders: SliderSystem;
  readonly text: UiTextService;
  readonly model: LayoutModel;
  readonly presenter: SpeechPresenter;
  readonly boxArt: MercTextBoxArt;
  readonly boxFonts: () => MercTextBoxFonts;
  readonly random: (range: number) => number;
  readonly profile: (id: number) => ProfilePresentation | null;
  readonly ensureImage: (path: string) => boolean;
  readonly gaps: (file: string) => readonly { readonly start: number; readonly end: number }[] | null;
  approach(kind: string): void;
  close(): Promise<boolean>;
  linesComing(): boolean;
}

interface PopupState {
  readonly lineId: number;
  readonly box: MercTextBox;
  readonly x: number;
  readonly y: number;
  readonly region: MouseRegion;
}

export class TalkPanel {
  readonly #hooks: TalkPanelHooks;
  readonly #controller: ViewModelController;
  readonly #view: LayoutView;
  #conversation: ConversationView | null = null;
  #rect: PanelRect = { x: 0, y: 0, width: 0, height: 0 };
  #bounds: TalkBounds | null = null;
  #face: FaceAnimator | null = null;
  #selected = -1;
  #onName = false;
  #popup: PopupState | null = null;
  #now = 0;
  #open = false;
  #closing = false;

  constructor(hooks: TalkPanelHooks) {
    this.#hooks = hooks;
    this.#controller = new ViewModelController(TALK_PANEL_CONTRACT, this.#emptyModel(), {
      panelDown: () => undefined,
      panelClick: () => this.#panelClick(),
      nameHover: ([on]) => {
        if (!this.#facesTalking()) this.#onName = on === HOVER_ON;
      },
      whoAreYou: () => {
        if (!this.#facesTalking()) this.#hooks.approach('whoAreYou');
      },
      optionHover: ([index = 0, on]) => {
        this.#selected = on === HOVER_ON ? index : -1;
      },
      option: ([index = 0]) => this.#option(index),
      done: () => this.#done(),
    });
    this.#view = new LayoutView({
      model: hooks.model,
      controller: this.#controller,
      services: hooks.services,
      sliders: hooks.sliders,
      text: hooks.text,
      owner: TALK_PANEL_SCREEN,
      origin: () => ({ x: this.#rect.x, y: this.#rect.y }),
      custom: {
        talkFace: (list, rect) => {
          if (this.#face) drawTalkingFace(list, this.#hooks.services.images, this.#face, rect.x, rect.y);
        },
      },
    });
  }

  get open(): boolean {
    return this.#open;
  }

  get profile(): number | null {
    return this.#conversation?.profile ?? null;
  }

  get rect(): PanelRect {
    return this.#rect;
  }

  get busy(): boolean {
    return (this.#conversation?.busy ?? false) || this.#hooks.presenter.busy || this.#hooks.linesComing();
  }

  get face(): FaceAnimator | null {
    return this.#face;
  }

  get controller(): ViewModelController {
    return this.#controller;
  }

  show(conversation: ConversationView, anchor: { x: number; y: number }, bounds: TalkBounds, now: number): void {
    this.#conversation = conversation;
    this.#bounds = bounds;
    this.#now = now;
    const art = this.#hooks.model.asset(PANEL_ASSET).path;
    this.#hooks.ensureImage(art);
    const frame = this.#hooks.services.images.info(art)?.frames[0];
    this.#rect = placeTalkPanel(anchor.x, anchor.y, frame?.width ?? 0, frame?.height ?? 0, bounds);
    const profile = this.#hooks.profile(conversation.profile);
    this.#face = profile ? new FaceAnimator(bigFaceRecord(profile, conversation.faceVariant), now, this.#hooks.random) : null;
    if (this.#face) this.#hooks.ensureImage(this.#face.record.path);
    this.#selected = -1;
    this.#onName = false;
    this.#closing = false;
    this.#open = true;
    this.#controller.model = this.#model();
    this.#view.build();
  }

  sync(conversation: ConversationView): void {
    this.#conversation = conversation;
  }

  hide(): void {
    if (!this.#open) return;
    this.#open = false;
    this.#removePopup();
    this.#view.dispose();
    this.#face = null;
    this.#conversation = null;
  }

  update(now: number): void {
    this.#now = now;
    if (!this.#open) return;
    const presenter = this.#hooks.presenter;
    const speaking = presenter.speaking;
    const mine = speaking && speaking.surface === SpeechSurface.PANEL ? speaking : null;
    if (this.#face) {
      const gaps = mine?.file ? (this.#hooks.gaps(mine.file) ?? []) : [];
      this.#face.update(
        now,
        { life: 100 },
        mine ? { playing: mine.playing, elapsedMs: mine.elapsedMs, gaps } : null,
        this.#hooks.services.images,
      );
    }
    if (this.busy) this.#selected = -1;
    this.#syncPopup();
    this.#controller.model = this.#model();
    this.#view.update();
  }

  render(list: DrawList): void {
    if (!this.#open) return;
    this.#view.render(list);
    const popup = this.#popup;
    if (popup) popup.box.render(list, popup.x, popup.y);
  }

  input(event: UiInputEvent): boolean {
    if (!this.#open || event.kind !== 'keyUp') return false;
    if (event.key === 'Escape') {
      this.#escape();
      return true;
    }
    if (event.key === 'Backspace') {
      this.#hooks.presenter.skip(this.#now, true);
      return true;
    }
    return false;
  }

  describe(): readonly WidgetInfo[] {
    if (!this.#open) return [];
    const popup = this.#popup;
    const extra: WidgetInfo[] = popup
      ? [
          {
            id: 'talkSubtitle',
            kind: 'region',
            rect: { x: popup.x, y: popup.y, width: popup.box.width, height: popup.box.height },
            visible: true,
            enabled: true,
            state: null,
            text: popup.box.request.text,
            frame: null,
          },
        ]
      : [];
    return [...this.#view.describe(), ...extra];
  }

  #facesTalking(): boolean {
    return this.#hooks.presenter.current?.line.surface === SpeechSurface.PANEL;
  }

  #panelClick(): void {
    if (this.#facesTalking()) this.#hooks.presenter.skip(this.#now, false);
  }

  #option(index: number): void {
    if (this.#facesTalking() || this.#closing) return;
    const kind = TALK_MENU_APPROACHES[index];
    if (!kind) return;
    if (kind === 'buySell') {
      const entry = this.#conversation?.menu[BUY_SELL_ENTRY] ?? '';
      this.#hooks.approach(entry.startsWith(BUY_SELL_PREFIX) ? 'buySell' : 'give');
      return;
    }
    this.#hooks.approach(kind);
  }

  #queueEmpty(): boolean {
    return this.#hooks.presenter.queued.length === 0 && !this.#hooks.linesComing();
  }

  #done(): void {
    if (this.#facesTalking()) {
      this.#hooks.presenter.skip(this.#now, true);
      return;
    }
    if (this.#queueEmpty()) this.#requestClose();
  }

  #escape(): void {
    if (!this.#queueEmpty()) return;
    this.#hooks.presenter.flush();
    this.#requestClose();
  }

  #requestClose(): void {
    if (this.#closing) return;
    this.#closing = true;
    void this.#hooks.close().then((ok) => {
      if (!ok) this.#closing = false;
    });
  }

  #syncPopup(): void {
    const current = this.#hooks.presenter.current;
    const showing = current && current.line.surface === SpeechSurface.PANEL && current.subtitles ? current : null;
    if (!showing) {
      this.#removePopup();
      return;
    }
    if (this.#popup?.lineId === showing.line.id) return;
    this.#removePopup();
    const bounds = this.#bounds;
    if (!bounds) return;
    const box = new MercTextBox(
      this.#hooks.boxArt,
      {
        text: quoted(showing.line.text),
        width: this.#hooks.model.number('TALK_PANEL_DEFAULT_SUBTITLE_WIDTH'),
        marginX: 0,
        marginTop: 0,
        marginBottom: 0,
      },
      this.#hooks.boxFonts(),
    );
    const orientation = popupOrientation(this.#rect, box.width, box.height, bounds);
    const at = popupPosition(this.#rect, orientation, box.width, box.height);
    let down = false;
    const region = this.#hooks.services.regions.define({
      x1: at.x,
      y1: at.y,
      x2: at.x + box.width,
      y2: at.y + box.height,
      priority: Priority.HIGHEST,
      cursor: 0,
      owner: TALK_PANEL_SCREEN,
      id: 'talkSubtitle',
      onButton: (_r, reason) => {
        if (reason & MouseReason.LBUTTON_DWN) down = true;
        if (reason & MouseReason.LBUTTON_UP && down) this.#hooks.presenter.skip(this.#now, false);
      },
      onMove: (_r, reason) => {
        if (reason & MouseReason.LOST_MOUSE) down = false;
      },
    });
    this.#popup = { lineId: showing.line.id, box, x: at.x, y: at.y, region };
  }

  #removePopup(): void {
    this.#popup?.region.remove();
    this.#popup = null;
  }

  #emptyModel(): Record<string, unknown> {
    return { name: '', nameColor: 'normal', options: [], busy: false, panelWidth: 0, panelHeight: 0 };
  }

  #model(): Record<string, unknown> {
    const conversation = this.#conversation;
    const text = this.#hooks.text;
    const options: TalkOptionModel[] = TALK_MENU_APPROACHES.map((_, i) => ({
      text: this.#optionText(i, conversation, text),
      color: this.#selected === i ? 'hilite' : 'normal',
    }));
    return {
      name: conversation?.name ?? '',
      nameColor: this.#onName ? 'hilite' : 'normal',
      options,
      busy: this.busy,
      panelWidth: this.#rect.width,
      panelHeight: this.#rect.height,
    };
  }

  #optionText(index: number, conversation: ConversationView | null, text: UiTextService): string {
    const entry = conversation?.menu[BUY_SELL_ENTRY] ?? '';
    if (index === BUY_SELL_ENTRY && entry.startsWith(BUY_SELL_PREFIX)) {
      const label = DEALER_LABELS[entry.slice(BUY_SELL_PREFIX.length)];
      if (label !== undefined) return text.string('zDealerStrings', label) ?? '';
    }
    return text.string('zTalkMenuStrings', index) ?? '';
  }
}

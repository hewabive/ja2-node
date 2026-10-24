// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-24. See LICENSE (SFI-SCLA).
// @src src/game/HelpScreen.cc EnterHelpScreen (the game paused, the first page, the text from the top, the check box set
// @src from fHideHelpInAllScreens), SetSizeAndPropertiesOfHelpScreen (HELP_SCREEN_DEFUALT_LOC_WIDTH or
// @src HELP_SCREEN_SMALL_LOC_WIDTH by HELP_SCREEN_DEFUALT_LOC_HEIGHT, centred on the screen, vertically on the viewport
// @src end gsVIEWPORT_END_Y = screen height − 120 (UILayout.cc), in the laptop on its monitor), ExitHelpScreen (the
// @src check box read, the game unpaused), HandleHelpScreen (the scroll box follows the pointer while the left button is
// @src down), GetAndDisplayHelpScreenText (IanDisplayWrappedString without shadow), RenderSpecificHelpScreen (+ 10
// @src pixels at the end), RenderTextBufferToScreen, ChangeToHelpScreenSubPage (clamped to the pages, the current page
// @src does nothing), CreateScrollAreaButtons (the scroll area region at HLP_SCRN__SCROLL_POSY),
// @src SelectHelpScrollAreaCallBack, SelectHelpScrollAreaMovementCallBack, DisplayHelpScreenTextBufferScrollBox (the
// @src box drawn only when the page scrolls). See docs/28 §4.7.

import { idiv } from '../../../core/int.ts';
import { type Area, DrawList, rgb } from '../../draw-list.ts';
import type { UiInputEvent } from '../../input/events.ts';
import { MouseButtonMask, MouseReason, Priority } from '../../input/mouse.ts';
import type { MouseRegion } from '../../input/regions.ts';
import { type ControllerContract, ViewModelController } from '../../layout/controller.ts';
import type { LayoutModel } from '../../layout/model.ts';
import { LayoutView } from '../../layout/view.ts';
import type { UiRuntime } from '../../runtime.ts';
import type { Modal } from '../../screen.ts';
import { type BitmapFont, fontHeight } from '../../text/bitmap-font.ts';
import type { UiTextService } from '../../text/text-service.ts';
import { ianDisplayWrappedString } from '../../text/wrap.ts';
import type { WidgetInfo } from '../../widgets/widget-info.ts';
import { HELP_SCREENS, type HelpParagraphs, type HelpScreenKind } from './help-pages.ts';
import { HelpScroll, WHEEL_LINES } from './help-scroll.ts';

export const HELP_SCREEN = 'helpScreen';
export const HELP_SCREEN_LAYOUT = 'help-screen';
export const HELP_FILE = 'binarydata/help.edt';
const SCROLL_AREA_OFFSET_Y = 63;
const BUFFER_TAIL_PIXELS = 10;
const VIEWPORT_PANEL_HEIGHT = 'TEAMPANEL_HEIGHT';

export const HELP_SCREEN_CONTRACT: ControllerContract = {
  id: HELP_SCREEN,
  actions: {
    close: {},
    page: { args: 1 },
    lineUp: {},
    lineDown: {},
    pageUp: {},
    pageDown: {},
    prevPage: {},
    nextPage: {},
    toggleDontShowAgain: {},
  },
  bindings: {
    hasButtons: 'boolean',
    titleRecord: 'number',
    cursor: 'string',
    forced: 'boolean',
    dontShowAgain: 'boolean',
    scrollEnabled: 'boolean',
    pageCount: 'number',
    pages: 'list',
  },
};

export interface HelpPoint {
  readonly x: number;
  readonly y: number;
}

export interface HelpOverlayOptions {
  readonly runtime: UiRuntime;
  readonly text: UiTextService;
  readonly model: LayoutModel;
  readonly kind: HelpScreenKind;
  readonly forced: boolean;
  readonly hideAll: boolean;
  readonly closed: (hideAll: boolean | null) => void;
}

interface HelpModel {
  hasButtons: boolean;
  titleRecord: number;
  cursor: string;
  forced: boolean;
  dontShowAgain: boolean;
  scrollEnabled: boolean;
  pageCount: number;
  pages: { label: number; selected: boolean }[];
}

interface TextStyle {
  readonly font: BitmapFont;
  readonly bold: BitmapFont;
  readonly width: number;
  readonly gap: number;
  readonly colors: { readonly foreground: number; readonly shadow: number; readonly background: number };
}

export function helpBoxSize(model: LayoutModel, kind: HelpScreenKind): { width: number; height: number } {
  const hasButtons = HELP_SCREENS[kind].buttons.length > 0;
  return {
    width: model.number(hasButtons ? 'HELP_SCREEN_DEFUALT_LOC_WIDTH' : 'HELP_SCREEN_SMALL_LOC_WIDTH'),
    height: model.number('HELP_SCREEN_DEFUALT_LOC_HEIGHT'),
  };
}

export function helpBoxOrigin(
  model: LayoutModel,
  kind: HelpScreenKind,
  geometry: { width: number; height: number; stdX: number; stdY: number },
): HelpPoint {
  const { width, height } = helpBoxSize(model, kind);
  if (kind === 'laptop')
    return {
      x: geometry.stdX + model.number('LAPTOP_SCREEN_UL_X') + idiv(model.number('LAPTOP_SCREEN_WIDTH') - width, 2),
      y: geometry.stdY + model.number('LAPTOP_SCREEN_UL_Y') + idiv(model.number('LAPTOP_SCREEN_HEIGHT') - height, 2),
    };
  const viewportEnd = geometry.height - model.number(VIEWPORT_PANEL_HEIGHT);
  return { x: idiv(geometry.width - width, 2), y: idiv(viewportEnd - height, 2) };
}

export class HelpOverlay implements Modal {
  readonly id = HELP_SCREEN;
  readonly rendersTooltips = true;
  readonly kind: HelpScreenKind;
  readonly forced: boolean;
  readonly #o: HelpOverlayOptions;
  readonly #model: HelpModel;
  readonly #controller: ViewModelController;
  readonly #view: LayoutView;
  readonly #scroll: HelpScroll;
  readonly #style: TextStyle;
  readonly #origin: HelpPoint;
  #page = 0;
  #dragging = false;
  #region: MouseRegion | null = null;
  #closing = false;

  constructor(options: HelpOverlayOptions) {
    this.#o = options;
    this.kind = options.kind;
    this.forced = options.forced;
    const pages = HELP_SCREENS[options.kind];
    const model = options.model;
    this.#origin = helpBoxOrigin(model, options.kind, options.runtime.geometry());
    this.#model = {
      hasButtons: pages.buttons.length > 0,
      titleRecord: model.number(pages.title),
      cursor: pages.cursor,
      forced: options.forced,
      dontShowAgain: options.hideAll,
      scrollEnabled: false,
      pageCount: pages.buttons.length,
      pages: pages.buttons.map((label, i) => ({ label: model.number(label), selected: i === 0 })),
    };
    this.#controller = new ViewModelController(HELP_SCREEN_CONTRACT, this.#model as unknown as Record<string, unknown>, {
      close: () => this.close(),
      page: ([i]) => this.changePage(i ?? 0),
      lineUp: () => this.#scroll.move(-1),
      lineDown: () => this.#scroll.move(1),
      pageUp: () => this.#scroll.move(-this.#scroll.pageLines),
      pageDown: () => this.#scroll.move(this.#scroll.pageLines),
      prevPage: () => this.changePage(this.#page - 1),
      nextPage: () => this.changePage(this.#page + 1),
      toggleDontShowAgain: () => {
        this.#model.dontShowAgain = !this.#model.dontShowAgain;
      },
    });
    const font = (name: string) => options.runtime.fonts.get(model.font(name));
    this.#style = {
      font: font('HELP_SCREEN_TEXT_BODY_FONT'),
      bold: font('FONT10ARIALBOLD'),
      width: model.number('HLP_SCRN__WIDTH_OF_TEXT_BUFFER') - model.number('HELP_SCREEN_MARGIN_SIZE'),
      gap: model.number('HELP_SCREEN_GAP_BTN_LINES'),
      colors: {
        foreground: model.color('HELP_SCREEN_TEXT_BODY_COLOR', 0),
        shadow: model.color('NO_SHADOW', 0),
        background: model.color('HELP_SCREEN_TEXT_BACKGROUND', 0),
      },
    };
    this.#scroll = new HelpScroll({
      lineHeight: fontHeight(this.#style.font) + this.#style.gap,
      textAreaHeight: model.number('HLP_SCRN__HEIGHT_OF_TEXT_AREA'),
      scrollTop: this.#origin.y + SCROLL_AREA_OFFSET_Y,
      scrollHeight: model.number('HLP_SCRN__HEIGHT_OF_SCROLL_AREA'),
    });
    this.#view = new LayoutView({
      model,
      controller: this.#controller,
      services: options.runtime,
      sliders: options.runtime.sliders,
      text: options.text,
      origin: () => this.#origin,
      owner: this,
      custom: {
        helpText: (list, rect) => this.#renderText(list, rect),
        helpScrollBox: (list, rect, params, view) => this.#renderScrollBox(list, rect, params, view),
      },
    });
  }

  get page(): number {
    return this.#page;
  }

  get top(): number {
    return this.#scroll.top;
  }

  get totalLines(): number {
    return this.#scroll.totalLines;
  }

  get visibleLines(): number {
    return this.#scroll.visibleLines;
  }

  get dontShowAgain(): boolean {
    return this.#model.dontShowAgain;
  }

  get origin(): HelpPoint {
    return this.#origin;
  }

  enter(): void {
    this.#o.runtime.pauseGame(true);
    this.#view.build();
    this.#region = this.#defineScrollArea();
    this.#renderPage();
  }

  exit(): void {
    this.#region?.remove();
    this.#region = null;
    this.#view.dispose();
    this.#o.runtime.pauseGame(false);
  }

  update(): void {
    if (this.#dragging) {
      if (this.#o.runtime.regions.isButtonDown(MouseButtonMask.LEFT)) this.#scroll.drag(this.#o.runtime.regions.mouseY);
      else this.#stopDragging();
    }
    this.#model.scrollEnabled = this.#scroll.enabled;
    this.#view.update();
  }

  input(event: UiInputEvent): boolean {
    this.#view.input(event);
    return true;
  }

  render(list: DrawList): void {
    this.#view.render(list);
  }

  describe(): readonly WidgetInfo[] {
    return this.#view.describe();
  }

  close(): void {
    if (this.#closing) return;
    this.#closing = true;
    this.#o.runtime.host.closeModal(this);
    this.#o.closed(this.forced ? null : this.#model.dontShowAgain);
  }

  changePage(page: number): void {
    const count = this.#model.pageCount;
    let next: number;
    if (page < 0) next = 0;
    else if (page >= count) next = count === 0 ? 0 : count - 1;
    else if (page === this.#page) return;
    else next = page;
    this.#page = next;
    this.#model.pages.forEach((p, i) => {
      p.selected = i === next;
    });
    this.#renderPage();
  }

  #paragraphs(): HelpParagraphs | null {
    return HELP_SCREENS[this.kind].pages[this.#page] ?? null;
  }

  #records(page: HelpParagraphs): string[] {
    const first = this.#o.model.number(page.first);
    return Array.from({ length: page.count }, (_, k) => this.#o.text.edt(HELP_FILE, first + k) ?? '');
  }

  #drawPage(list: DrawList, x: number, y: number): number {
    const page = this.#paragraphs();
    if (!page) return 0;
    const s = this.#style;
    const spacing = page.spaced ? fontHeight(s.font) : 0;
    let at = y;
    let total = 0;
    for (const text of this.#records(page)) {
      const height = ianDisplayWrappedString(list, x, at, s.width, s.gap, s.font, s.colors, text, { bold: s.bold });
      at += height + spacing;
      total += height + spacing;
    }
    return total;
  }

  #renderPage(): void {
    this.#scroll.setContent(this.#drawPage(new DrawList(), 0, 0) + BUFFER_TAIL_PIXELS);
    this.#model.scrollEnabled = this.#scroll.enabled;
  }

  #renderText(list: DrawList, rect: Area): void {
    list.pushClip(rect.x, rect.y, rect.x + rect.width, rect.y + rect.height);
    this.#drawPage(list, rect.x, rect.y - this.#scroll.top * this.#scroll.lineHeight);
    list.popClip();
  }

  #renderScrollBox(list: DrawList, rect: Area, params: Readonly<Record<string, unknown>>, view: LayoutView): void {
    if (!this.#scroll.enabled) return;
    const box = this.#scroll.box();
    const color = (key: string) => view.model.rgbColor(params[key] as readonly [number, number, number], rgb(0, 0, 0));
    const right = rect.x + rect.width;
    const bottom = box.top + box.height - 1;
    list.fill(rect.x, box.top, right, bottom, color('fill'));
    list.line(rect.x, box.top, right, box.top, color('light'));
    list.line(rect.x, box.top, rect.x, bottom, color('light'));
    list.line(rect.x, bottom, right, bottom, color('dark'));
    list.line(right, box.top, right, bottom, color('dark'));
  }

  #defineScrollArea(): MouseRegion {
    const model = this.#o.model;
    const x =
      this.#origin.x +
      model.number('HLP_SCRN__SCROLL_POSX') +
      (this.#model.hasButtons ? model.number('HELP_SCREEN_BUTTON_BORDER_WIDTH') : 0);
    const y = this.#origin.y + SCROLL_AREA_OFFSET_Y;
    return this.#o.runtime.regions.define({
      x1: x,
      y1: y,
      x2: x + model.number('HLP_SCRN__WIDTH_OF_SCROLL_AREA'),
      y2: y + model.number('HLP_SCRN__HEIGHT_OF_SCROLL_AREA'),
      priority: Priority.HIGHEST,
      cursor: model.cursor(this.#model.cursor === 'laptop' ? 'CURSOR_LAPTOP_SCREEN' : 'CURSOR_NORMAL'),
      owner: this,
      id: 'helpScrollArea',
      onMove: (region, reason) => {
        if (reason & MouseReason.MOVE && this.#o.runtime.regions.isButtonDown(MouseButtonMask.LEFT)) this.#scroll.drag(region.mouseY);
      },
      onButton: (region, reason) => {
        if (reason & MouseReason.LBUTTON_UP) this.#stopDragging();
        else if (reason & MouseReason.LBUTTON_DWN) {
          this.#dragging = true;
          this.#scroll.drag(region.mouseY);
        } else if (reason & MouseReason.WHEEL_DOWN) this.#scroll.move(WHEEL_LINES);
        else if (reason & MouseReason.WHEEL_UP) this.#scroll.move(-WHEEL_LINES);
      },
    });
  }

  #stopDragging(): void {
    this.#dragging = false;
    this.#scroll.release();
  }
}

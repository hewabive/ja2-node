// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-11-06. See LICENSE (SFI-SCLA).
// @src src/game/Tactical/Auto_Bandage.cc DisplayAutoBandageUpdatePanel (the medics on top, the patients below, each list
// @src NUMBER_MERC_FACES_AUTOBANDAGE_BOX wide from three faces up and two wide below, the wider list setting the width,
// @src centred over INV_INTERFACE_START_Y; the group_confirm_tactical.sti pieces in their order, zMarksMapScreenText 13
// @src and 14 in TINYFONT1 FONT_WHITE, the names in TINYFONT1 FONT_LTRED; Done enabled only once complete, Stop only
// @src before), HandleAutoBandage (the shadow over the screen at the first frame, then the panel alone; Esc on its
// @src release while not complete, Enter or Space once complete), AutoBandage (the mask at MSYS_PRIORITY_HIGHEST - 1 with
// @src CURSOR_NORMAL; the failure box pDoctorWarningString[1] through DoScreenIndependantMessageBox),
// @src CreateTerminateAutoBandageButton and MakeButton (group_confirm_tactical.sti 7/8 at MSYS_PRIORITY_HIGHEST - 1 in
// @src MAP_SCREEN_FONT, FONT_MCOLOR_BLACK on FONT_BLACK, the second 70 pixels right), StopAutoBandageButtonCallback,
// @src AddFacesToAutoBandageBox (the 65face portraits), RenderSoldierSmallFaceForAutoBandagePanel (the cell is
// @src widgets/update-panel-face.ts); BeginAutoBandage and HandleAutoBandagePending (their OK boxes in
// @src MSG_BOX_BASIC_STYLE, centred on the screen).

import { DEFAULT_SHADOW, FontColor } from '../../../content/text/font-colors.ts';
import { idiv } from '../../../core/int.ts';
import { refusalMessage } from '../../../protocol/refusals.ts';
import type { AutoBandageView, SoldierView, ViewFrame } from '../../../protocol/view.ts';
import { CursorId } from '../../cursors/cursor-ids.ts';
import type { DrawList } from '../../draw-list.ts';
import type { UiInputEvent } from '../../input/events.ts';
import { MouseReason, Priority } from '../../input/mouse.ts';
import type { MouseRegion } from '../../input/regions.ts';
import { INV_INTERFACE_HEIGHT } from '../../layout/frames.ts';
import type { UiServices } from '../../services.ts';
import type { BitmapFont } from '../../text/bitmap-font.ts';
import { FontName } from '../../text/fonts.ts';
import { hCenterVCenterAlign } from '../../text/measure.ts';
import { fontColors, mprint } from '../../text/print.ts';
import type { UiTextService } from '../../text/text-service.ts';
import { eventPrompt, type PromptedText } from '../../viewer-prompts.ts';
import { type Button, twoFrameImage } from '../../widgets/button.ts';
import {
  drawUpdatePanelFace,
  TACT_UPDATE_MERC_FACE_X_HEIGHT,
  TACT_UPDATE_MERC_FACE_X_OFFSET,
  TACT_UPDATE_MERC_FACE_X_WIDTH,
  TACT_UPDATE_MERC_FACE_Y_OFFSET,
} from '../../widgets/update-panel-face.ts';
import type { WidgetInfo } from '../../widgets/widget-info.ts';

const NUMBER_MERC_FACES_AUTOBANDAGE_BOX = 4;
const FEWEST_FACES_FOR_A_FULL_ROW = 3;
const SHORT_ROW = 2;
const CELL_WIDTH = TACT_UPDATE_MERC_FACE_X_WIDTH;
const CELL_HEIGHT = TACT_UPDATE_MERC_FACE_X_HEIGHT;
const TITLE_HEIGHT = 9;
const TITLE_TEXT_ABOVE = 7;
const PATIENTS_TITLE_DY = 2;
const TOP_EDGE_ABOVE = 13;
const BORDER = 4;
const BUTTON_DY = 3;
const BUTTON_SPACING = 70;
const NAME_WIDTH = CELL_WIDTH - 25;
const NAME_DY = 35;
const MASK_PRIORITY = Priority.HIGHEST - 1;
const BUTTON_PRIORITY = Priority.HIGHEST - 1;
const BUTTON_UP = 7;
const BUTTON_DOWN = 8;
const Piece = {
  TOP_LEFT: 0,
  TOP_EDGE: 1,
  TOP_RIGHT: 2,
  LEFT_SIDE: 3,
  RIGHT_SIDE: 5,
  BUTTON_CONTAINER: 6,
  TITLE_LEFT: 11,
  TITLE_RIGHT: 13,
  CELL: 15,
  TITLE_STRIP: 16,
  BOTTOM_LEFT: 17,
  BOTTOM_RIGHT: 18,
} as const;
const MARKS = 'zMarksMapScreenText';
const MEDICS_TITLE = 13;
const PATIENTS_TITLE = 14;
const DONE_TEXT = 15;
const CANCEL_TEXT = 16;
const DOCTOR_WARNINGS = 'pDoctorWarningString';
const NOT_EVERYONE_BANDAGED = 1;
const OWNER = 'autoBandageBox';
const SNAPSHOT = 'autoBandageWorld';
const ESCAPE = 'Escape';
const ENTER = 'Enter';
const SPACE = ' ';
const BOX_REFUSAL = 'box';
const FAILED = 'failed';

type FrameEvent = NonNullable<ViewFrame['events']>[number];

export interface ScreenSize {
  readonly width: number;
  readonly height: number;
}

export interface AutoBandageCell {
  readonly x: number;
  readonly y: number;
  readonly index: number;
}

export interface AutoBandagePanelGeometry {
  readonly wide: number;
  readonly medicRows: number;
  readonly patientRows: number;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly button: { readonly x: number; readonly y: number };
}

function facesWide(count: number): number {
  return Math.min(count, NUMBER_MERC_FACES_AUTOBANDAGE_BOX) < FEWEST_FACES_FOR_A_FULL_ROW ? SHORT_ROW : NUMBER_MERC_FACES_AUTOBANDAGE_BOX;
}

function faceRows(count: number): number {
  return idiv(count, NUMBER_MERC_FACES_AUTOBANDAGE_BOX) + (count % NUMBER_MERC_FACES_AUTOBANDAGE_BOX ? 1 : 0);
}

export function autoBandagePanelGeometry(medics: number, patients: number, screen: ScreenSize): AutoBandagePanelGeometry {
  const wide = Math.max(facesWide(medics), facesWide(patients));
  const medicRows = faceRows(medics);
  const patientRows = faceRows(patients);
  const width = CELL_WIDTH * wide;
  const cellsHeight = (medicRows + patientRows) * CELL_HEIGHT;
  const x = idiv(screen.width - width, 2);
  const y = idiv(screen.height - INV_INTERFACE_HEIGHT - cellsHeight, 2);
  const height = cellsHeight + TITLE_HEIGHT;
  const buttonX = wide === SHORT_ROW ? x : x + CELL_WIDTH;
  return { wide, medicRows, patientRows, x, y, width, height, button: { x: buttonX, y: y + height + BUTTON_DY } };
}

function cells(g: AutoBandagePanelGeometry, rows: number, top: number): AutoBandageCell[] {
  const all: AutoBandageCell[] = [];
  for (let row = 0; row < rows; row++)
    for (let column = 0; column < g.wide; column++)
      all.push({ x: g.x + column * CELL_WIDTH, y: top + row * CELL_HEIGHT, index: row * g.wide + column });
  return all;
}

export function medicCells(g: AutoBandagePanelGeometry): AutoBandageCell[] {
  return cells(g, g.medicRows, g.y);
}

export function patientCells(g: AutoBandagePanelGeometry): AutoBandageCell[] {
  return cells(g, g.patientRows, g.y + TITLE_HEIGHT + g.medicRows * CELL_HEIGHT);
}

export function autoBandageRefusalText(text: UiTextService, token: string | null): string | null {
  const message = token ? refusalMessage(token) : null;
  return message?.shown === BOX_REFUSAL ? (text.string(message.table, message.index) ?? '') : null;
}

export interface AutoBandageNotice extends PromptedText {
  readonly fullScreen: boolean;
}

function notice(event: FrameEvent, text: UiTextService): AutoBandageNotice | null {
  if (event.type === 'autoBandageRefused') {
    const shown = autoBandageRefusalText(text, event.refusal);
    return shown === null ? null : { text: shown, prompt: eventPrompt(event, event.refusal), fullScreen: true };
  }
  if (event.type !== 'autoBandageEnded' || !event.failed) return null;
  const shown = text.string(DOCTOR_WARNINGS, NOT_EVERYONE_BANDAGED) ?? '';
  return { text: shown, prompt: eventPrompt(event, FAILED), fullScreen: false };
}

export function autoBandageNotices(frames: readonly ViewFrame[], text: UiTextService): AutoBandageNotice[] {
  return frames.flatMap((f) => (f.events ?? []).flatMap((e) => notice(e, text) ?? []));
}

export interface AutoBandageArt {
  readonly panel: string;
  readonly faces: string;
  readonly buttonFont: BitmapFont;
}

export interface AutoBandageBoxHost {
  readonly services: Pick<UiServices, 'regions' | 'buttons' | 'fonts' | 'geometry'>;
  readonly text: UiTextService;
  readonly art: () => AutoBandageArt;
  readonly soldier: (id: number) => SoldierView | null;
  readonly portrait: (soldier: SoldierView) => string | null;
  readonly ensure: (path: string) => boolean;
  readonly end: () => void;
}

export class AutoBandageBox {
  readonly #host: AutoBandageBoxHost;
  #view: AutoBandageView | null = null;
  #mask: MouseRegion | null = null;
  #buttons: Button[] = [];
  #captured = false;
  #covering = false;
  #endSent = false;

  constructor(host: AutoBandageBoxHost) {
    this.#host = host;
  }

  get open(): boolean {
    return this.#view !== null;
  }

  get frozen(): boolean {
    return this.#captured;
  }

  get coversScreen(): boolean {
    return this.#covering;
  }

  get complete(): boolean {
    return this.#view?.complete === true;
  }

  update(view: AutoBandageView | null): boolean {
    if (!view) {
      this.close();
      return false;
    }
    if (!this.#view) this.#start(view);
    this.#view = view;
    const [done, cancel] = this.#buttons;
    done?.setEnabled(view.complete);
    cancel?.setEnabled(!view.complete);
    return true;
  }

  #start(view: AutoBandageView): void {
    this.#captured = false;
    this.#covering = false;
    this.#endSent = false;
    this.#mask = this.#host.services.regions.define({
      x1: 0,
      y1: 0,
      x2: 0xffff,
      y2: 0xffff,
      priority: MASK_PRIORITY,
      cursor: CursorId.NORMAL,
      owner: OWNER,
      id: 'autoBandageMask',
    });
    if (view.medics.length > 0 && view.patients.length > 0) this.#createButtons(this.#geometry(view));
  }

  #geometry(view: AutoBandageView): AutoBandagePanelGeometry {
    return autoBandagePanelGeometry(view.medics.length, view.patients.length, this.#host.services.geometry());
  }

  #createButtons(g: AutoBandagePanelGeometry): void {
    const services = this.#host.services;
    const font = this.#host.art().buttonFont;
    const make = (index: number, label: number, id: string): Button =>
      services.buttons.create({
        x: g.button.x + index * BUTTON_SPACING,
        y: g.button.y,
        image: twoFrameImage(this.#host.art().panel, BUTTON_UP, BUTTON_DOWN),
        priority: BUTTON_PRIORITY,
        owner: OWNER,
        id,
        text: { text: this.#host.text.string(MARKS, label) ?? '', font, color: FontColor.MCOLOR_BLACK, shadow: FontColor.BLACK },
        onClick: (_b, reason) => {
          if (reason & MouseReason.LBUTTON_UP) this.#end();
        },
      });
    this.#buttons = [make(0, DONE_TEXT, 'autoBandageBox.done'), make(1, CANCEL_TEXT, 'autoBandageBox.cancel')];
  }

  #end(): void {
    if (this.#endSent) return;
    this.#endSent = true;
    this.#host.end();
  }

  close(): void {
    if (!this.#view) return;
    this.#view = null;
    this.#captured = false;
    this.#covering = false;
    this.#mask?.remove();
    this.#mask = null;
    this.#host.services.buttons.removeOwner(OWNER);
    this.#buttons = [];
  }

  input(event: UiInputEvent): void {
    if (event.kind !== 'keyUp') return;
    const complete = this.complete;
    if ((event.key === ESCAPE && !complete) || ((event.key === ENTER || event.key === SPACE) && complete)) this.#end();
  }

  render(list: DrawList): void {
    const view = this.#view;
    if (!view) return;
    const { width, height } = this.#host.services.geometry();
    const screen = { x: 0, y: 0, width, height };
    if (this.#captured) {
      list.snapshot(SNAPSHOT, screen, screen);
      this.#covering = true;
    } else {
      list.shadow(0, 0, width - 1, height - 1);
      list.capture(SNAPSHOT);
      this.#captured = true;
    }
    if (view.medics.length === 0 || view.patients.length === 0) return;
    this.#renderPanel(list, view, this.#geometry(view));
    this.#host.services.buttons.render(list, OWNER);
  }

  #renderPanel(list: DrawList, view: AutoBandageView, g: AutoBandagePanelGeometry): void {
    const art = this.#host.art();
    const tiny = this.#host.services.fonts.get(FontName.TINYFONT1);
    const white = fontColors(FontColor.WHITE);
    const right = g.x + g.width;
    const patientTitleY = g.y + g.medicRows * CELL_HEIGHT;
    this.#renderCells(list, medicCells(g), view.medics, art, tiny);
    for (let column = 0; column < g.wide; column++) {
      list.image(art.panel, Piece.TITLE_STRIP, g.x + column * CELL_WIDTH, patientTitleY);
      list.image(art.panel, Piece.TITLE_STRIP, g.x + column * CELL_WIDTH, g.y - TITLE_HEIGHT);
    }
    list.image(art.panel, Piece.TITLE_LEFT, g.x - BORDER, patientTitleY);
    list.image(art.panel, Piece.TITLE_RIGHT, right, patientTitleY);
    this.#renderTitle(list, MEDICS_TITLE, g, g.y - TITLE_TEXT_ABOVE, tiny, white);
    const patients = patientCells(g);
    this.#renderCells(list, patients, view.patients, art, tiny);
    for (let row = 0; row < g.patientRows; row++) {
      const y = g.y + TITLE_HEIGHT + (row + g.medicRows) * CELL_HEIGHT;
      list.image(art.panel, Piece.LEFT_SIDE, g.x - BORDER, y);
      list.image(art.panel, Piece.RIGHT_SIDE, right, y);
    }
    for (let row = 0; row < g.medicRows; row++) {
      list.image(art.panel, Piece.LEFT_SIDE, g.x - BORDER, g.y + row * CELL_HEIGHT);
      list.image(art.panel, Piece.RIGHT_SIDE, right, g.y + row * CELL_HEIGHT);
    }
    list.image(art.panel, Piece.TITLE_LEFT, g.x - BORDER, g.y - TITLE_HEIGHT);
    list.image(art.panel, Piece.TITLE_RIGHT, right, g.y - TITLE_HEIGHT);
    for (let column = 0; column < g.wide; column++) list.image(art.panel, Piece.TOP_EDGE, g.x + CELL_WIDTH * column, g.y - TOP_EDGE_ABOVE);
    list.image(art.panel, Piece.TOP_LEFT, g.x - BORDER, g.y - TOP_EDGE_ABOVE);
    list.image(art.panel, Piece.TOP_RIGHT, right, g.y - TOP_EDGE_ABOVE);
    const bottom = g.y + g.height;
    list.image(art.panel, Piece.BOTTOM_LEFT, g.x - BORDER, bottom);
    list.image(art.panel, Piece.BOTTOM_RIGHT, right - CELL_WIDTH, bottom);
    list.image(art.panel, Piece.BUTTON_CONTAINER, g.button.x - BORDER, bottom);
    this.#renderTitle(list, PATIENTS_TITLE, g, patientTitleY + PATIENTS_TITLE_DY, tiny, white);
  }

  #renderCells(list: DrawList, all: readonly AutoBandageCell[], ids: readonly number[], art: AutoBandageArt, tiny: BitmapFont): void {
    for (const cell of all) {
      list.image(art.panel, Piece.CELL, cell.x, cell.y);
      const id = ids[cell.index];
      const soldier = id === undefined ? null : this.#host.soldier(id);
      if (soldier) this.#renderFace(list, soldier, cell, art, tiny);
    }
  }

  #renderFace(list: DrawList, s: SoldierView, cell: AutoBandageCell, art: AutoBandageArt, tiny: BitmapFont): void {
    const x = cell.x + TACT_UPDATE_MERC_FACE_X_OFFSET;
    const y = cell.y + TACT_UPDATE_MERC_FACE_Y_OFFSET;
    const face = this.#host.portrait(s);
    const values = {
      life: s.life ?? 0,
      lifeMax: s.lifeMax ?? 0,
      bleeding: s.bleeding ?? 0,
      breathMax: s.breathMax ?? 0,
      morale: s.morale ?? 0,
    };
    drawUpdatePanelFace(list, art.faces, face && this.#host.ensure(face) ? face : null, values, x, y);
    const at = hCenterVCenterAlign(x, y, NAME_WIDTH, 0, s.name, tiny);
    mprint(list, tiny, at.x, at.y + NAME_DY, s.name, fontColors(FontColor.LTRED, DEFAULT_SHADOW));
  }

  #renderTitle(
    list: DrawList,
    index: number,
    g: AutoBandagePanelGeometry,
    y: number,
    tiny: BitmapFont,
    colors: ReturnType<typeof fontColors>,
  ): void {
    const title = this.#host.text.string(MARKS, index) ?? '';
    mprint(list, tiny, hCenterVCenterAlign(g.x, y, g.width, 0, title, tiny).x, y, title, colors);
  }

  describe(): WidgetInfo[] {
    const view = this.#view;
    if (!view) return [];
    const g = this.#geometry(view);
    return [
      {
        id: OWNER,
        kind: OWNER,
        rect: { x: g.x - BORDER, y: g.y - TOP_EDGE_ABOVE, width: g.width + 2 * BORDER, height: g.height + TOP_EDGE_ABOVE },
        visible: view.medics.length > 0 && view.patients.length > 0,
        enabled: true,
        state: view.complete ? 'complete' : 'running',
        text: null,
        frame: null,
      },
      ...this.#buttons.map((b) => b.describe()),
    ];
  }
}

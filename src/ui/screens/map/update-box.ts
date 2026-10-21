// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-21. See LICENSE (SFI-SCLA).
// @src src/game/Strategic/Map_Screen_Interface.cc AddSoldierToWaitingListQueue, AddReasonToWaitingListQueue and
// @src AddDisplayBoxToWaitingQueue (the reason is one value, the last one set before the box shows), AddSoldierToUpdateBox
// @src (no dead mercs, SIZE_OF_UPDATE_BOX), CreateDestroyTheUpdateBox (the screen mask, the paused game, newbeep.wav),
// @src DisplaySoldierUpdateBox (two columns up to NUMBER_OF_MERCS_FOR_FOUR_WIDTH_UPDATE_PANEL mercs, four above, the
// @src bottom 280 pixels down the map, the group_confirm_tactical.sti pieces, the faces with their names in TINYFONT1
// @src FONT_LTRED, STR_LATE_49 over the button container, the reason from pUpdateMercStrings), RenderSoldierSmallFaceForUpdatePanel
// @src (panels.sti, the 65face portrait, the life, bleeding, breath and morale bars), CreateDestroyUpdatePanelButtons
// @src (group_confirm_tactical.sti 7/8 at MSYS_PRIORITY_HIGHEST - 1, pUpdatePanelButtons, STR_LATE_51 and STR_LATE_52),
// @src EndUpdateBox (Continue restarts time compression, Stop stops it), MoveScreenMaskBtnCallbackSecondary (a right click
// @src closes the box); src/game/Strategic/Assignments.cc AssignmentDone (ASSIGNMENT_FINISHED_FOR_UPDATE),
// @src HandleRestFatigueAndSleepStatus (ASLEEP_GOING_AUTO_FOR_UPDATE and ASSIGNMENT_RETURNING_FOR_UPDATE for mercs off a
// @src squad or vehicle, TOPTION_SLEEPWAKE_NOTIFICATION); src/game/Strategic/Merc_Contract.cc
// @src FindOutIfAnyMercAboutToLeaveIsGonnaRenew (CONTRACT_EXPIRE_WARNING_REASON). See docs/28 §7.10.

import { DEFAULT_SHADOW, FontColor } from '../../../content/text/font-colors.ts';
import { idiv } from '../../../core/int.ts';
import type { StrategicMercView, ViewFrame } from '../../../protocol/view.ts';
import { type DrawList, rgb } from '../../draw-list.ts';
import { MouseReason, NO_CURSOR, Priority } from '../../input/mouse.ts';
import type { MouseRegion } from '../../input/regions.ts';
import type { UiServices } from '../../services.ts';
import type { BitmapFont } from '../../text/bitmap-font.ts';
import { FontName } from '../../text/fonts.ts';
import { fontColors } from '../../text/print.ts';
import type { UiTextService } from '../../text/text-service.ts';
import { displayWrappedString, drawTextToScreen, TextFlag } from '../../text/wrap.ts';
import { type Button, twoFrameImage } from '../../widgets/button.ts';
import type { WidgetInfo } from '../../widgets/widget-info.ts';
import { Assignment } from './character-list.ts';

export const UpdateReason = {
  CONTRACT_FINISHED: 1,
  ASSIGNMENT_FINISHED: 2,
  ASSIGNMENT_RETURNING: 3,
  ASLEEP_GOING_AUTO: 4,
  CONTRACT_EXPIRE_WARNING: 5,
} as const;

export const SIZE_OF_UPDATE_BOX = 20;
const FOUR_WIDE_COLUMNS = 4;
const TWO_WIDE_COLUMNS = 2;
const FOUR_WIDE_ABOVE = 4;
const BLOCK_WIDTH = 70;
const BLOCK_HEIGHT = 49;
const FACE_X_OFFSET = 8;
const FACE_Y_OFFSET = 6;
const REASON_OFFSET_Y = 14;
const MAP_X = 290;
const MAP_WIDTH = 336;
const BOTTOM_Y = 280;
const CORNER = 4;
const SIDE_HEIGHT = 70;
const EDGE_OVERLAP = 3;
const BUTTON_ROW_FROM_BOTTOM = 18;
const CONTAINER_TEXT_DY = 5;
const REASON_DY_FOUR = 6;
const REASON_DY_TWO = 3;
const NAME_DX = -5;
const NAME_DY = 31;
const NAME_WIDTH = 57;
const PORTRAIT_INSET = 2;
const BARS_LEFT = 36;
const BARS_RIGHT = 44;
const BARS_TOP = 2;
const BARS_BOTTOM = 30;
const BAR_BASE = 29;
const BAR_RANGE = 27;
const FULL = 100;
const MASK_PRIORITY = Priority.HIGHEST - 4;
const BUTTON_PRIORITY = Priority.HIGHEST - 1;
const STR_LATE_49 = 48;
const STR_LATE_51 = 50;
const STR_LATE_52 = 51;
const LATE = 'gzLateLocalizedString';
const REASONS = 'pUpdateMercStrings';
const BUTTONS = 'pUpdatePanelButtons';
const BUTTON_UP = 7;
const BUTTON_DOWN = 8;
const OWNER = 'updateBox';
const BLACK = rgb(0, 0, 0);
const Piece = { TOP_LEFT: 0, TOP_EDGE: 1, TOP_RIGHT: 2, LEFT_SIDE: 3, RIGHT_SIDE: 5, CONTAINER: 19, BLOCK: 20 } as const;
const BLEEDING_SHADOW = rgb(107, 107, 57);
const BLEEDING = rgb(222, 181, 115);
const BANDAGED_SHADOW = rgb(156, 57, 57);
const BANDAGED = rgb(222, 132, 132);
const LIFE_SHADOW = rgb(107, 8, 8);
const LIFE = rgb(206, 0, 0);
const BREATH_SHADOW = rgb(8, 8, 132);
const BREATH = rgb(8, 8, 107);
const MORALE_SHADOW = rgb(8, 156, 8);
const MORALE = rgb(8, 107, 8);

type FrameEvent = NonNullable<ViewFrame['events']>[number];
type Point = { readonly x: number; readonly y: number };

export interface UpdateBatch {
  readonly reason: number;
  readonly soldiers: readonly number[];
}

function offSquadAndVehicle(m: StrategicMercView | undefined): boolean {
  return m !== undefined && m.assignment >= Assignment.ON_DUTY && m.assignment !== Assignment.VEHICLE;
}

export class UpdateQueue {
  readonly #batches: UpdateBatch[] = [];

  get pending(): number {
    return this.#batches.length;
  }

  observe(events: readonly FrameEvent[], mercs: readonly StrategicMercView[], notifySleepWake: boolean): void {
    let reason: number | null = null;
    const soldiers: number[] = [];
    const add = (id: number) => {
      const m = mercs.find((x) => x.id === id);
      if (m && m.life > 0 && !soldiers.includes(id) && soldiers.length < SIZE_OF_UPDATE_BOX) soldiers.push(id);
    };
    for (const e of events) {
      if (e.type === 'assignmentDone') {
        reason = UpdateReason.ASSIGNMENT_FINISHED;
        add(e.soldier);
      } else if (e.type === 'fellAsleep' && !e.collapsed && notifySleepWake) {
        reason = UpdateReason.ASLEEP_GOING_AUTO;
        add(e.soldier);
      } else if (e.type === 'wokeUp' && notifySleepWake && offSquadAndVehicle(mercs.find((m) => m.id === e.soldier))) {
        reason = UpdateReason.ASSIGNMENT_RETURNING;
        add(e.soldier);
      } else if (e.type === 'contractsExpiringSoon') {
        for (const id of e.soldiers) add(id);
        reason = UpdateReason.CONTRACT_EXPIRE_WARNING;
      }
    }
    if (reason !== null && soldiers.length > 0) this.#batches.push({ reason, soldiers });
  }

  next(): UpdateBatch | null {
    return this.#batches.shift() ?? null;
  }
}

export interface UpdatePanelGeometry {
  readonly fourWide: boolean;
  readonly wide: number;
  readonly high: number;
  readonly cells: number;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export function updatePanelGeometry(count: number, origin: Point): UpdatePanelGeometry {
  const fourWide = count > FOUR_WIDE_ABOVE;
  const wide = fourWide ? FOUR_WIDE_COLUMNS : TWO_WIDE_COLUMNS;
  const high = idiv(count, wide) + (count % wide ? 1 : 0);
  const cells = count % wide ? count + wide - (count % wide) : count;
  const width = wide * BLOCK_WIDTH;
  const height = (high + 1) * BLOCK_HEIGHT;
  return {
    fourWide,
    wide,
    high,
    cells,
    x: origin.x + MAP_X + idiv(MAP_WIDTH - width, 2),
    y: origin.y + BOTTOM_Y - height,
    width,
    height,
  };
}

export interface UpdateBoxHost {
  readonly services: Pick<UiServices, 'regions' | 'buttons' | 'fonts'>;
  readonly text: UiTextService;
  readonly origin: () => Point;
  readonly mapFont: () => BitmapFont;
  readonly panel: string;
  readonly faces: string;
  readonly merc: (id: number) => StrategicMercView | null;
  readonly face: (id: number) => string | null;
  readonly ensure: (path: string) => boolean;
  readonly beep: () => void;
  readonly finished: (continueTime: boolean | null) => void;
}

export class UpdateBox {
  readonly #host: UpdateBoxHost;
  #batch: UpdateBatch | null = null;
  #mask: MouseRegion | null = null;
  #buttons: Button[] = [];

  constructor(host: UpdateBoxHost) {
    this.#host = host;
  }

  get open(): boolean {
    return this.#batch !== null;
  }

  get batch(): UpdateBatch | null {
    return this.#batch;
  }

  show(batch: UpdateBatch): boolean {
    const soldiers = batch.soldiers.filter((id) => (this.#host.merc(id)?.life ?? 0) > 0);
    if (soldiers.length === 0) return false;
    this.#batch = { reason: batch.reason, soldiers };
    for (const id of soldiers) {
      const face = this.#host.face(id);
      if (face) this.#host.ensure(face);
    }
    this.#defineMask();
    this.#createButtons(updatePanelGeometry(soldiers.length, this.#host.origin()));
    this.#host.beep();
    return true;
  }

  #defineMask(): void {
    this.#mask = this.#host.services.regions.define({
      x1: 0,
      y1: 0,
      x2: 0xffff,
      y2: 0xffff,
      priority: MASK_PRIORITY,
      cursor: NO_CURSOR,
      owner: OWNER,
      id: 'updateBoxMask',
      onButton: (_r, reason) => {
        if (reason & MouseReason.RBUTTON_UP) this.end(null);
      },
    });
  }

  #createButtons(g: UpdatePanelGeometry): void {
    const services = this.#host.services;
    const x = g.x + (g.fourWide ? BLOCK_WIDTH : 0);
    const y = g.y + g.height - BUTTON_ROW_FROM_BOTTOM;
    const font = this.#host.mapFont();
    const make = (index: number, help: number, continueTime: boolean): Button =>
      services.buttons.create({
        x: x + index * BLOCK_WIDTH,
        y,
        image: twoFrameImage(this.#host.panel, BUTTON_UP, BUTTON_DOWN),
        priority: BUTTON_PRIORITY,
        owner: OWNER,
        id: continueTime ? 'updateBox.continue' : 'updateBox.stop',
        tooltip: this.#host.text.string(LATE, help) ?? '',
        text: {
          text: this.#host.text.string(BUTTONS, index) ?? '',
          font,
          color: FontColor.MCOLOR_BLACK,
          shadow: FontColor.BLACK,
        },
        onClick: (_b, reason) => {
          if (reason & MouseReason.LBUTTON_UP) this.end(continueTime);
        },
      });
    this.#buttons = [make(0, STR_LATE_51, true), make(1, STR_LATE_52, false)];
  }

  end(continueTime: boolean | null): void {
    if (!this.#batch) return;
    this.#batch = null;
    this.#mask?.remove();
    this.#mask = null;
    this.#host.services.buttons.removeOwner(OWNER);
    this.#buttons = [];
    this.#host.finished(continueTime);
  }

  render(list: DrawList): void {
    const batch = this.#batch;
    if (!batch) return;
    const g = updatePanelGeometry(batch.soldiers.length, this.#host.origin());
    this.#renderFrame(list, g);
    this.#renderFaces(list, g, batch.soldiers);
    this.#renderTexts(list, g, batch.reason);
    this.#host.services.buttons.render(list, OWNER);
  }

  #renderFrame(list: DrawList, g: UpdatePanelGeometry): void {
    const art = this.#host.panel;
    list.image(art, Piece.TOP_LEFT, g.x - CORNER, g.y - CORNER);
    list.image(art, Piece.TOP_RIGHT, g.x + g.width, g.y - CORNER);
    if (g.fourWide) {
      list.image(art, Piece.LEFT_SIDE, g.x - CORNER, g.y + g.height - EDGE_OVERLAP - SIDE_HEIGHT);
      list.image(art, Piece.RIGHT_SIDE, g.x + g.width, g.y + g.height - EDGE_OVERLAP - SIDE_HEIGHT);
      list.image(art, Piece.TOP_LEFT, g.x - CORNER, g.y + g.height - EDGE_OVERLAP);
      list.image(art, Piece.TOP_RIGHT, g.x + g.width, g.y + g.height - EDGE_OVERLAP);
    }
    for (let i = 0; i < g.cells + g.wide; i++)
      list.image(art, Piece.BLOCK, g.x + (i % g.wide) * BLOCK_WIDTH, g.y + idiv(i, g.wide) * BLOCK_HEIGHT);
    const containerY = g.y + g.high * BLOCK_HEIGHT + REASON_OFFSET_Y + EDGE_OVERLAP;
    list.image(art, Piece.CONTAINER, g.x - CORNER + (g.fourWide ? BLOCK_WIDTH : 0), containerY);
    for (let i = 0; i < g.high; i++) {
      list.image(art, Piece.LEFT_SIDE, g.x - CORNER, g.y + i * BLOCK_HEIGHT);
      list.image(art, Piece.RIGHT_SIDE, g.x + g.width, g.y + i * BLOCK_HEIGHT);
    }
    for (let i = 0; i < g.wide; i++) {
      list.image(art, Piece.TOP_EDGE, g.x + BLOCK_WIDTH * i, g.y - CORNER);
      list.image(art, Piece.TOP_EDGE, g.x + BLOCK_WIDTH * i, g.y + g.height - EDGE_OVERLAP);
    }
  }

  #renderFaces(list: DrawList, g: UpdatePanelGeometry, soldiers: readonly number[]): void {
    const tiny = this.#host.services.fonts.get(FontName.TINYFONT1);
    soldiers.forEach((id, i) => {
      const m = this.#host.merc(id);
      if (!m) return;
      const x = g.x + (i % g.wide) * BLOCK_WIDTH + FACE_X_OFFSET;
      const y = g.y + idiv(i, g.wide) * BLOCK_HEIGHT + REASON_OFFSET_Y + FACE_Y_OFFSET;
      this.#renderFace(list, m, x, y);
      drawTextToScreen(
        list,
        m.name,
        x + NAME_DX,
        y + NAME_DY,
        NAME_WIDTH,
        tiny,
        fontColors(FontColor.LTRED, DEFAULT_SHADOW, FontColor.BLACK),
        TextFlag.CENTER_JUSTIFIED,
      );
    });
  }

  #renderFace(list: DrawList, m: StrategicMercView, x: number, y: number): void {
    list.fill(x + BARS_LEFT, y + BARS_TOP, x + BARS_RIGHT, y + BARS_BOTTOM, BLACK);
    list.image(this.#host.faces, 0, x, y);
    const face = this.#host.face(m.id);
    if (face && this.#host.ensure(face)) list.image(face, 0, x + PORTRAIT_INSET, y + PORTRAIT_INSET);
    if (m.life === 0) return;
    const bottom = y + BAR_BASE;
    const top = (value: number) => bottom - idiv(BAR_RANGE * value, FULL);
    const bar = (dx: number, from: number, shadow: ReturnType<typeof rgb>, colour: ReturnType<typeof rgb>) => {
      list.fill(x + dx, from, x + dx + 1, bottom, shadow);
      list.fill(x + dx + 1, from, x + dx + 2, bottom, colour);
    };
    let start = top(m.lifeMax);
    bar(BARS_LEFT, start, BLEEDING_SHADOW, BLEEDING);
    start += idiv(BAR_RANGE * (m.bleeding ?? 0), FULL);
    bar(BARS_LEFT, start, BANDAGED_SHADOW, BANDAGED);
    bar(BARS_LEFT, top(m.life), LIFE_SHADOW, LIFE);
    bar(BARS_LEFT + 3, top(m.breathMax), BREATH_SHADOW, BREATH);
    bar(BARS_LEFT + 6, top(m.morale ?? 0), MORALE_SHADOW, MORALE);
  }

  #renderTexts(list: DrawList, g: UpdatePanelGeometry, reason: number): void {
    const font = this.#host.mapFont();
    const white = fontColors(FontColor.WHITE, DEFAULT_SHADOW, FontColor.BLACK);
    const containerTextY = g.y + g.high * BLOCK_HEIGHT + CONTAINER_TEXT_DY + REASON_OFFSET_Y + EDGE_OVERLAP;
    const late = this.#host.text.string(LATE, STR_LATE_49) ?? '';
    displayWrappedString(list, g.x, containerTextY, g.width, 0, font, white, late, TextFlag.CENTER_JUSTIFIED);
    const reasonText = this.#host.text.string(REASONS, reason) ?? '';
    displayWrappedString(
      list,
      g.x,
      g.y + (g.fourWide ? REASON_DY_FOUR : REASON_DY_TWO),
      g.width,
      0,
      font,
      white,
      reasonText,
      TextFlag.CENTER_JUSTIFIED,
    );
  }

  describe(): WidgetInfo[] {
    const batch = this.#batch;
    if (!batch) return [];
    const g = updatePanelGeometry(batch.soldiers.length, this.#host.origin());
    return [
      {
        id: 'updateBox',
        kind: 'updateBox',
        rect: { x: g.x, y: g.y, width: g.width, height: g.height },
        visible: true,
        enabled: true,
        state: batch.reason,
        text: this.#host.text.string(REASONS, batch.reason) ?? null,
        frame: null,
      },
      ...this.#buttons.map((b) => b.describe()),
    ];
  }
}

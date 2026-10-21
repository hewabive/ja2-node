// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-21. See LICENSE (SFI-SCLA).
// @src src/game/Strategic/MapScreen.cc DisplayCharacterList and DrawName/DrawAssignment/DrawLocation/DrawDestination/
// @src DrawTimeRemaining (each column centred with FontColor from GetMapscreenMercAssignmentColor and the white row under
// @src the pointer), HandleAssignmentsDoneAndAwaitingFurtherOrders (the idle assignment flashing red every 500 ms),
// @src HandleContractTimeFlashForMercThatIsAboutLeave, the sleep icon at 125 in the sleep column, the selected-character
// @src arrow, HighLightAssigment/Destination/Sleep/Contract and GlowColor (red 25 × i, rows of a
// @src selected set framed together, the vehicle gap closing the frame), HandleCommonGlowTimer (GLOW_DELAY 70 ms between
// @src steps 0..10). See docs/28 §7.2.

import type { Sector } from '../../../content/strategic/sector-ids.ts';
import { DEFAULT_SHADOW, FontColor } from '../../../content/text/font-colors.ts';
import type { StrategicView } from '../../../protocol/view.ts';
import { type DrawList, rgb } from '../../draw-list.ts';
import type { LayoutModel } from '../../layout/model.ts';
import { type BitmapFont, fontHeight } from '../../text/bitmap-font.ts';
import { hCenterVCenterAlign } from '../../text/measure.ts';
import { fontColors, mprint } from '../../text/print.ts';
import type { UiTextService } from '../../text/text-service.ts';
import {
  assignmentString,
  type CharacterList,
  departureText,
  destinationString,
  FIRST_VEHICLE,
  locationString,
  MAX_CHARACTER_COUNT,
  mercById,
  NO_CHARACTER,
  rowColour,
} from './character-list.ts';
import { parseSectorLabel } from './facts.ts';

export const TeamColumn = { NAME: 0, ASSIGNMENT: 1, SLEEP: 2, LOCATION: 3, DESTINATION: 4, CONTRACT: 5 } as const;
export const TEAM_COLUMN_KEYS = ['name', 'assignment', 'sleep', 'location', 'destination', 'departure'] as const;
const COLUMN_CONSTANTS = [
  ['NAME_X', 'NAME_WIDTH'],
  ['ASSIGN_X', 'ASSIGN_WIDTH'],
  ['SLEEP_X', 'SLEEP_WIDTH'],
  ['LOC_X', 'LOC_WIDTH'],
  ['DEST_ETA_X', 'DEST_ETA_WIDTH'],
  ['TIME_REMAINING_X', 'TIME_REMAINING_WIDTH'],
] as const;
const VEHICLE_GAP = 6;
const Y_OFFSET = 2;
const GLOW_DELAY = 70;
const GLOW_STEPS = 10;
const GLOW_RED_STEP = 25;
const STARTING_COLOR_NUM = 5;
const FLASH_MS = 500;
const SLEEP_ICON_X = 125;

export interface TeamGeometry {
  readonly top: number;
  readonly ySize: number;
  readonly columns: readonly (readonly [number, number])[];
  readonly arrowX: number;
}

export function teamGeometry(model: LayoutModel, font: BitmapFont): TeamGeometry {
  return {
    top: model.number('Y_START'),
    ySize: fontHeight(font),
    columns: COLUMN_CONSTANTS.map(([x, w]) => [model.number(x), model.number(w)] as const),
    arrowX: model.number('SELECTED_CHAR_ARROW_X'),
  };
}

export function teamRowY(g: TeamGeometry, row: number): number {
  return g.top + row * (g.ySize + Y_OFFSET) + (row >= FIRST_VEHICLE ? VEHICLE_GAP : 0);
}

export interface Glow {
  readonly line: number;
  readonly column: number;
  colour: number;
  rising: boolean;
}

export interface TeamRenderContext {
  readonly list: DrawList;
  readonly origin: { readonly x: number; readonly y: number };
  readonly font: BitmapFont;
  readonly text: UiTextService;
  readonly strategic: StrategicView;
  readonly characters: CharacterList;
  readonly selected: Sector;
  readonly level: number;
  readonly plottingMercs: boolean;
  readonly sleepIcon: string;
  readonly arrow: string;
}

export class TeamListView {
  readonly geometry: TeamGeometry;
  highLine = NO_CHARACTER;
  #glow: Glow | null = null;
  #glowAt = 0;
  #flash = false;
  #flashAt = 0;

  constructor(geometry: TeamGeometry) {
    this.geometry = geometry;
  }

  get glow(): Glow | null {
    return this.#glow;
  }

  rowY(row: number): number {
    return teamRowY(this.geometry, row);
  }

  startGlow(line: number, column: number): void {
    if (this.#glow?.line === line && this.#glow.column === column) return;
    this.#glow = { line, column, colour: STARTING_COLOR_NUM, rising: false };
  }

  stopGlow(): void {
    this.#glow = null;
  }

  update(now: number): void {
    if (now - this.#flashAt >= FLASH_MS) {
      this.#flashAt = now;
      this.#flash = !this.#flash;
    }
    if (now - this.#glowAt < GLOW_DELAY) return;
    this.#glowAt = now;
    const glow = this.#glow;
    if (!glow) return;
    if (glow.colour === 0 || glow.colour === GLOW_STEPS) glow.rising = !glow.rising;
    glow.colour += glow.rising ? -1 : 1;
  }

  render(ctx: TeamRenderContext): void {
    this.#renderGlow(ctx);
    ctx.characters.slots.forEach((slot, row) => {
      const m = slot.merc !== null ? mercById(ctx.strategic, slot.merc) : null;
      if (!m) return;
      const at = parseSectorLabel(m.sector);
      const colour = rowColour(m, {
        hovered: row === this.highLine,
        plotted: ctx.plottingMercs && ctx.characters.isSelected(row),
        inSelectedSector: at !== null && at.x === ctx.selected.x && at.y === ctx.selected.y && at.z === ctx.level,
      });
      const y = ctx.origin.y + this.rowY(row) + 1;
      const draw = (column: number, text: string, c: number) => {
        if (!text) return;
        const [x, w] = this.geometry.columns[column] ?? [0, 0];
        const p = hCenterVCenterAlign(ctx.origin.x + x + 1, y, w, this.geometry.ySize, text, ctx.font);
        mprint(ctx.list, ctx.font, p.x, p.y, text, fontColors(c, DEFAULT_SHADOW, FontColor.BLACK));
      };
      draw(TeamColumn.NAME, m.name, colour);
      draw(TeamColumn.LOCATION, locationString(ctx.text, m), colour);
      draw(TeamColumn.DESTINATION, destinationString(ctx.strategic, m), colour);
      draw(TeamColumn.ASSIGNMENT, assignmentString(ctx.text, ctx.strategic, m), this.#flash && m.idle === true ? FontColor.RED : colour);
      const departure = departureText(ctx.text, m, this.#flash);
      draw(TeamColumn.CONTRACT, departure.text, colour === FontColor.WHITE ? colour : (departure.colour ?? colour));
      if (m.asleep && m.canChangeSleep !== false)
        ctx.list.image(ctx.sleepIcon, 0, ctx.origin.x + SLEEP_ICON_X, ctx.origin.y + this.rowY(row));
      if (row === ctx.characters.info || slot.selected)
        ctx.list.image(ctx.arrow, 0, ctx.origin.x + this.geometry.arrowX, ctx.origin.y + this.rowY(row) - 1);
    });
  }

  #renderGlow(ctx: TeamRenderContext): void {
    const glow = this.#glow;
    if (!glow) return;
    const [x, w] = this.geometry.columns[glow.column] ?? [0, 0];
    const rows = ctx.characters.isSelected(glow.line) ? ctx.characters.selectedRows() : [glow.line];
    const colour = rgb(GLOW_RED_STEP * glow.colour, 0, 0);
    const h = this.geometry.ySize + Y_OFFSET;
    const left = ctx.origin.x + x;
    for (const row of rows) {
      const y = ctx.origin.y + this.rowY(row) - 1;
      if (row === 0 || !rows.includes(row - 1) || row === FIRST_VEHICLE) ctx.list.line(left, y, left + w, y, colour);
      if (row === MAX_CHARACTER_COUNT - 1 || !rows.includes(row + 1) || row === FIRST_VEHICLE - 1)
        ctx.list.line(left, y + h, left + w, y + h, colour);
      ctx.list.line(left, y, left, y + h, colour);
      ctx.list.line(left + w, y, left + w, y + h, colour);
    }
  }
}

// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-21. See LICENSE (SFI-SCLA).
// @src src/game/Strategic/Map_Screen_Interface_Bottom.cc RenderMapScreenInterfaceBottom (the message list, the slider,
// @src the compression label), DisplayCompressMode (sTimeStrings of the mode while compressing, else of X0, in COMPFONT
// @src at 489, 457); src/game/Strategic/Game_Clock.cc RenderClock (pPausedGameText[0] while the player paused, red in
// @src combat, gpGameClockString with the day, hour and minute); src/game/Strategic/MapScreen.cc DisplayGroundEta (hours
// @src and minutes under a day, else days and hours, at CLOCK_MIN_X_START − 5 and CLOCK_HOUR_X_START − 8 or − 9);
// @src src/game/Strategic/Map_Screen_Interface_Map.cc DisplayDistancesForHelicopter (the box above the bottom rows when
// @src the pointer is on row 13 or lower, pHelicopterEtaStrings 0..4 and 6 right-aligned in MAP_FONT).

import { DEFAULT_SHADOW, FontColor } from '../../../content/text/font-colors.ts';
import { idiv } from '../../../core/int.ts';
import type { ClockView } from '../../../protocol/view.ts';
import type { DrawList } from '../../draw-list.ts';
import { type BitmapFont, fontHeight } from '../../text/bitmap-font.ts';
import { hCenterVCenterAlign, stringPixLength } from '../../text/measure.ts';
import { sprintMoney } from '../../text/money.ts';
import { fontColors, mprint } from '../../text/print.ts';
import type { UiTextService } from '../../text/text-service.ts';
import { compressionLabelIndex } from './compression.ts';
import { at, type LayoutParams } from './layout-params.ts';
import type { MapMessageList } from './message-list.ts';
import type { RouteAnswer } from './plotting.ts';

const TIME_STRINGS = 'sTimeStrings';
const GS_TIME_STRINGS = 'gsTimeStrings';
const PAUSED_TEXT = 'pPausedGameText';
const DAY_STRING = 'gpGameClockString';
const ETA_STRING = 'pEtaString';
const HELI_STRINGS = 'pHelicopterEtaStrings';
const HELI_PASSENGERS = 6;
const HELI_ROWS = [0, 1, 2, 3, 4, HELI_PASSENGERS];
const HELI_UPPER_ROW = 13;
const HELI_MARGIN = 5;
const MESSAGE_X = 20;
const MINUTES_PER_HOUR = 60;
const HOURS_PER_DAY = 24;
const MINUTES_PER_DAY = MINUTES_PER_HOUR * HOURS_PER_DAY;
const MINUTES_SHIFT = 5;
const HOURS_SHIFT = 8;
const DAYS_SHIFT = 9;
const HOUR_UNIT = 0;
const MINUTE_UNIT = 1;
const DAY_UNIT = 3;

type Origin = { readonly x: number; readonly y: number };

export interface BottomState {
  readonly origin: Origin;
  readonly text: UiTextService;
  readonly messages: MapMessageList;
  readonly clock: ClockView | null;
  readonly labelColour: number;
  readonly playerPaused: boolean;
  readonly inCombat: boolean;
}

function centred(list: DrawList, font: BitmapFont, box: readonly number[], origin: Origin, text: string, colour: number): void {
  const p = hCenterVCenterAlign(origin.x + at(box, 0), origin.y + at(box, 1), at(box, 2), at(box, 3), text, font);
  mprint(list, font, p.x, p.y, text, fontColors(colour, DEFAULT_SHADOW));
}

function two(n: number): string {
  return String(n).padStart(2, '0');
}

export function clockText(text: UiTextService, clock: ClockView | null, playerPaused: boolean): string {
  if (playerPaused) return text.string(PAUSED_TEXT, 0) ?? '';
  if (!clock) return '';
  return `${text.string(DAY_STRING, 0) ?? ''} ${clock.day}, ${two(clock.hour)}:${two(clock.minute)}`;
}

export function renderBottomPanel(list: DrawList, p: LayoutParams, s: BottomState): void {
  const o = s.origin;
  s.messages.render(list, p.font('messageFont'), o, { x: o.x + MESSAGE_X, y: o.y + at(p.numbers('messages'), 1) });
  const slider = p.numbers('sliderAt');
  s.messages.renderSlider(list, p.asset('slider'), o.x + at(slider, 0), o.y + at(slider, 1));
  const font = p.font('compressionFont');
  centred(list, font, p.numbers('compressionText'), o, s.text.string(TIME_STRINGS, compressionLabelIndex(s.clock)) ?? '', s.labelColour);
  const clockColour = s.inCombat ? FontColor.MCOLOR_RED : FontColor.LTGREEN;
  centred(list, font, p.numbers('clock'), o, clockText(s.text, s.clock, s.playerPaused), clockColour);
}

function padded(n: number): string {
  return String(n).padStart(2, ' ');
}

export function renderGroundEta(list: DrawList, p: LayoutParams, origin: Origin, text: UiTextService, totalMinutes: number): void {
  const popup = p.numbers('popupAt');
  list.image(p.asset('popup'), 0, origin.x + at(popup, 0), origin.y + at(popup, 1));
  const font = p.font('font');
  const colours = fontColors(FontColor.LTGREEN, DEFAULT_SHADOW);
  const label = p.numbers('label');
  const y = origin.y + at(label, 1);
  mprint(list, font, origin.x + at(label, 0), y, text.string(ETA_STRING, 0) ?? '', colours);
  const unit = (i: number) => text.string(GS_TIME_STRINGS, i) ?? '';
  const minutesX = origin.x + p.number('minutes') - MINUTES_SHIFT;
  const hoursX = origin.x + p.number('hours');
  if (totalMinutes < MINUTES_PER_DAY) {
    mprint(list, font, minutesX, y, `${padded(totalMinutes % MINUTES_PER_HOUR)}${unit(MINUTE_UNIT)}`, colours);
    mprint(list, font, hoursX - HOURS_SHIFT, y, `${padded(idiv(totalMinutes, MINUTES_PER_HOUR))}${unit(HOUR_UNIT)}`, colours);
    return;
  }
  mprint(list, font, minutesX, y, `${padded(idiv(totalMinutes, MINUTES_PER_HOUR) % HOURS_PER_DAY)}${unit(HOUR_UNIT)}`, colours);
  mprint(list, font, hoursX - DAYS_SHIFT, y, `${padded(idiv(totalMinutes, MINUTES_PER_DAY))}${unit(DAY_UNIT)}`, colours);
}

export function heliDistanceValues(text: UiTextService, answer: RouteAnswer | null, passengers: number): string[] {
  const eta = answer?.etaMinutes ?? 0;
  const unit = (i: number) => text.string(GS_TIME_STRINGS, i) ?? '';
  return [
    String(answer?.distance ?? 0),
    String(answer?.safe ?? 0),
    String(answer?.unsafe ?? 0),
    sprintMoney(answer?.cost ?? 0),
    `${idiv(eta, MINUTES_PER_HOUR)}${unit(HOUR_UNIT)} ${eta % MINUTES_PER_HOUR}${unit(MINUTE_UNIT)}`,
    String(answer?.passengers ?? passengers),
  ];
}

export function renderHeliDistances(
  list: DrawList,
  p: LayoutParams,
  origin: Origin,
  text: UiTextService,
  values: readonly string[],
  hoverRow: number | null,
): void {
  const heliAt = p.numbers('heliAt');
  const x0 = origin.x + at(heliAt, 0);
  const y0 = origin.y + (hoverRow !== null && hoverRow >= HELI_UPPER_ROW ? p.number('heliUpperY') : at(heliAt, 1));
  list.image(p.asset('heliPopup'), 0, x0, y0);
  const font = p.font('heliFont');
  const colours = fontColors(FontColor.LTGREEN, DEFAULT_SHADOW);
  const h = fontHeight(font);
  const right = x0 + HELI_MARGIN + p.number('heliWidth');
  HELI_ROWS.forEach((row, i) => {
    const y = y0 + HELI_MARGIN + i * h;
    const value = values[i] ?? '';
    mprint(list, font, x0 + HELI_MARGIN, y, text.string(HELI_STRINGS, row) ?? '', colours);
    mprint(list, font, right - stringPixLength(value, font), y, value, colours);
  });
}

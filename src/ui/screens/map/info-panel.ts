// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-21. See LICENSE (SFI-SCLA).
// @src src/game/Strategic/MapScreen.cc DrawCharacterInfo (nickname and full name centred, the two assignment lines: the
// @src training stat, the trainer's town, the repair target, the ETA of a merc in transit or moving, else the location;
// @src the contract "1.8d/7d" or "{h}h/7d", the M.E.R.C. "{len}d/{hired}d", N/A; the salary by the type of the last
// @src contract, the medical deposit, the morale word), DrawCharHealth (the life in red below 25 %, yellow below 50 %,
// @src metal grey at 0, the maximum flashing after a change, "??" for a prisoner), DrawCharStats and PrintStat (green or
// @src red for CHANGE_STAT_RECENTLY_DURATION after a change), RenderHandPosItem (not with the inventory open or for the
// @src dead), RenderIconsForUpperLeftCornerPiece, ConvertMinTimeToETADayHourMinString; src/game/Strategic/
// @src Map_Screen_Interface.cc RenderMapStatusBars (DrawSoldierUIBars at BAR_INFO_X, BAR_INFO_Y).

import { DEFAULT_SHADOW, FontColor } from '../../../content/text/font-colors.ts';
import { idiv } from '../../../core/int.ts';
import type { StrategicMercView, StrategicView } from '../../../protocol/view.ts';
import type { DrawList } from '../../draw-list.ts';
import type { BitmapFont } from '../../text/bitmap-font.ts';
import { hCenterVCenterAlign, hRightVCenterAlign, stringPixLength } from '../../text/measure.ts';
import { sprintMoney } from '../../text/money.ts';
import { fontColors, mprint } from '../../text/print.ts';
import type { UiTextService } from '../../text/text-service.ts';
import type { StatFlash } from '../tactical/panel-models.ts';
import { STAT_KEYS, type StatKey } from '../tactical/sm-panel.ts';
import {
  Assignment,
  assignmentString,
  CHAR_TEXT_FONT_COLOR,
  groupOfMerc,
  locationString,
  moraleText,
  vehicleOfMerc,
} from './character-list.ts';
import type { LayoutParams } from './layout-params.ts';
import { isMechanical } from './merc-soldier.ts';

export const CHANGE_STAT_RECENTLY_DURATION_MS = 60000;
const ATTRIBUTE_STRINGS = 'pAttributeMenuStrings';
const REPAIR_STRINGS = 'pRepairStrings';
const REPAIR_ITEMS = 0;
const REPAIR_ROBOT = 3;
const SHORT_VEHICLE_STRINGS = 'pShortVehicleStrings';
const TOWN_NAMES = 'strategic-map-town-names';
const POW_STRINGS = 'pPOWStrings';
const POW_UNKNOWN = 1;
const STRATEGIC_STRINGS = 'gpStrategicString';
const STR_PB_NOTAPPLICABLE_ABBREVIATION = 43;
const STR_PB_DAYS_ABBREVIATION = 44;
const STR_PB_HOURS_ABBREVIATION = 45;
const ETA_STRING = 'pEtaString';
const MINUTES_PER_DAY = 1440;
const MINUTES_PER_HOUR = 60;
const HOURS_ROUNDING = 59;
const MINUTES_SHOWN_AS_ZERO = 5;
const AIM = 'aim';
const MERC = 'merc';

export type Box4 = readonly [number, number, number, number];
export type Box3 = readonly [number, number, number];

export interface InfoGeometry {
  readonly nickname: Box4;
  readonly name: Box4;
  readonly assignment1: Box4;
  readonly assignment2: Box4;
  readonly health: Box4;
  readonly morale: Box4;
  readonly contract: Box3;
  readonly salary: Box3;
  readonly medical: Box3;
  readonly stats: readonly (readonly [number, number])[];
  readonly statWidth: number;
}

export interface InfoContext {
  readonly list: DrawList;
  readonly origin: { readonly x: number; readonly y: number };
  readonly font: BitmapFont;
  readonly text: UiTextService;
  readonly strategic: StrategicView;
  readonly fullName: string | null;
  readonly flashes: ReadonlyMap<string, StatFlash> | undefined;
  readonly now: number;
  readonly worldMinutes: number;
}

function box4(values: readonly number[]): Box4 {
  return [values[0] ?? 0, values[1] ?? 0, values[2] ?? 0, values[3] ?? 0];
}

function box3(values: readonly number[]): Box3 {
  return [values[0] ?? 0, values[1] ?? 0, values[2] ?? 0];
}

export function infoGeometry(p: LayoutParams): InfoGeometry {
  return {
    nickname: box4(p.numbers('nickname')),
    name: box4(p.numbers('name')),
    assignment1: box4(p.numbers('assignment1')),
    assignment2: box4(p.numbers('assignment2')),
    health: box4(p.numbers('health')),
    morale: box4(p.numbers('morale')),
    contract: box3(p.numbers('contract')),
    salary: box3(p.numbers('salary')),
    medical: box3(p.numbers('medical')),
    stats: p.pairs('stats'),
    statWidth: p.number('statWidth'),
  };
}

function centred(ctx: InfoContext, box: Box4, text: string, colour: number): void {
  const at = hCenterVCenterAlign(ctx.origin.x + box[0], ctx.origin.y + box[1], box[2], box[3], text, ctx.font);
  mprint(ctx.list, ctx.font, at.x, at.y, text, fontColors(colour, DEFAULT_SHADOW));
}

function right(ctx: InfoContext, box: Box3, text: string, colour: number, height: number): void {
  const at = hRightVCenterAlign(ctx.origin.x + box[0], ctx.origin.y + box[1], box[2], height, text, ctx.font);
  mprint(ctx.list, ctx.font, at.x, at.y, text, fontColors(colour, DEFAULT_SHADOW));
}

function statColour(flash: StatFlash | undefined, now: number): number {
  if (!flash || now >= CHANGE_STAT_RECENTLY_DURATION_MS + flash.at) return CHAR_TEXT_FONT_COLOR;
  return flash.up ? FontColor.LTGREEN : FontColor.RED;
}

export function etaDayHourMinute(text: UiTextService, minutes: number): string {
  const hour = idiv(minutes % MINUTES_PER_DAY, MINUTES_PER_HOUR);
  const minute = minutes % MINUTES_PER_HOUR;
  return `${text.string(ETA_STRING, 0) ?? ''} ${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

function secondAssignmentLine(ctx: InfoContext, m: StrategicMercView, townOf: (sector: string) => number): string {
  const text = ctx.text;
  switch (m.assignment) {
    case Assignment.TRAIN_SELF:
    case Assignment.TRAIN_TEAMMATE:
    case Assignment.TRAIN_BY_OTHER:
      return text.string(ATTRIBUTE_STRINGS, m.trainStat ?? 0) ?? '';
    case Assignment.TRAIN_TOWN: {
      const town = townOf(m.sector);
      return town !== 0 ? (text.string(TOWN_NAMES, town) ?? '') : '';
    }
    case Assignment.REPAIR: {
      if (m.repairRobot) return text.string(REPAIR_STRINGS, REPAIR_ROBOT) ?? '';
      if (m.repairVehicle !== undefined) {
        const v = (ctx.strategic.vehicles ?? []).find((x) => x.id === m.repairVehicle);
        return text.string(SHORT_VEHICLE_STRINGS, v?.type ?? 0) ?? '';
      }
      return text.string(REPAIR_STRINGS, REPAIR_ITEMS) ?? '';
    }
    case Assignment.IN_TRANSIT: {
      const a = m.arrival;
      return a ? etaDayHourMinute(text, a.day * MINUTES_PER_DAY + a.hour * MINUTES_PER_HOUR + a.minute) : '';
    }
    default: {
      const g = groupOfMerc(ctx.strategic, m.id);
      const v = m.assignment === Assignment.VEHICLE ? vehicleOfMerc(ctx.strategic, m) : null;
      const moving = v ? v.betweenSectors || v.path.length > 0 : g ? g.betweenSectors || g.path.length > 0 : false;
      const eta = g?.etaMinutes ?? 0;
      if (moving && (g !== null || v !== null)) return etaDayHourMinute(text, ctx.worldMinutes + eta);
      return locationString(text, m);
    }
  }
}

function contractText(ctx: InfoContext, m: StrategicMercView): string {
  const text = ctx.text;
  const na = text.string(STRATEGIC_STRINGS, STR_PB_NOTAPPLICABLE_ABBREVIATION) ?? '';
  if (m.life <= 0) return na;
  const days = text.string(STRATEGIC_STRINGS, STR_PB_DAYS_ABBREVIATION) ?? '';
  const c = m.contract;
  if (c?.type === AIM) {
    const left = c.minutesLeft ?? c.remaining.days * MINUTES_PER_DAY + c.remaining.hours * MINUTES_PER_HOUR;
    if (left >= MINUTES_PER_DAY) return `${(left / MINUTES_PER_DAY).toFixed(1)}${days}/${c.totalDays}${days}`;
    const hours = idiv(left > MINUTES_SHOWN_AS_ZERO ? left + HOURS_ROUNDING : left, MINUTES_PER_HOUR);
    return `${hours}${text.string(STRATEGIC_STRINGS, STR_PB_HOURS_ABBREVIATION) ?? ''}/${c.totalDays}${days}`;
  }
  if (c?.type === MERC) return `${c.contractLength ?? c.unpaidDays}${days}/${c.daysHired}${days}`;
  return na;
}

function healthColour(life: number, lifeMax: number): number {
  const percent = lifeMax > 0 ? idiv(100 * life, lifeMax) : 0;
  if (percent === 0) return FontColor.METALGRAY;
  if (percent < 25) return FontColor.RED;
  if (percent < 50) return FontColor.YELLOW;
  return CHAR_TEXT_FONT_COLOR;
}

function health(ctx: InfoContext, g: InfoGeometry, m: StrategicMercView): void {
  if (m.assignment === Assignment.ASSIGNMENT_POW) {
    centred(ctx, g.health, ctx.text.string(POW_STRINGS, POW_UNKNOWN) ?? '', CHAR_TEXT_FONT_COLOR);
    return;
  }
  const whole = `${m.life}/${m.lifeMax}`;
  const at = hCenterVCenterAlign(ctx.origin.x + g.health[0], ctx.origin.y + g.health[1], g.health[2], g.health[3], whole, ctx.font);
  let x = at.x;
  const y = ctx.origin.y + g.health[1];
  const life = String(m.life);
  mprint(ctx.list, ctx.font, x, y, life, fontColors(healthColour(m.life, m.lifeMax), DEFAULT_SHADOW));
  x += stringPixLength(life, ctx.font);
  mprint(ctx.list, ctx.font, x, y, '/', fontColors(CHAR_TEXT_FONT_COLOR, DEFAULT_SHADOW));
  x += stringPixLength('/', ctx.font);
  const flash = ctx.flashes?.get('health');
  mprint(ctx.list, ctx.font, x, y, String(m.lifeMax), fontColors(statColour(flash, ctx.now), DEFAULT_SHADOW));
}

export function renderCharacterInfo(ctx: InfoContext, g: InfoGeometry, m: StrategicMercView, townOf: (sector: string) => number): void {
  centred(ctx, g.nickname, m.name, CHAR_TEXT_FONT_COLOR);
  centred(ctx, g.name, ctx.fullName ?? m.name, CHAR_TEXT_FONT_COLOR);
  centred(ctx, g.assignment1, assignmentString(ctx.text, ctx.strategic, m), CHAR_TEXT_FONT_COLOR);
  centred(ctx, g.assignment2, secondAssignmentLine(ctx, m, townOf), CHAR_TEXT_FONT_COLOR);
  health(ctx, g, m);
  if (isMechanical(m)) return;
  const height = g.health[3];
  STAT_KEYS.forEach((key: StatKey, i) => {
    const at = g.stats[i];
    if (!at || !m.stats) return;
    right(ctx, [at[0], at[1], g.statWidth], String(m.stats[key]).padStart(3, ' '), statColour(ctx.flashes?.get(key), ctx.now), height);
  });
  centred(ctx, [g.contract[0], g.contract[1], g.contract[2], height], contractText(ctx, m), CHAR_TEXT_FONT_COLOR);
  if (m.salary !== undefined) right(ctx, g.salary, sprintMoney(m.salary), CHAR_TEXT_FONT_COLOR, height);
  const deposit = m.contract?.type === AIM ? m.contract.medicalDeposit : 0;
  if (deposit > 0) right(ctx, g.medical, sprintMoney(deposit), CHAR_TEXT_FONT_COLOR, height);
  const morale =
    m.assignment === Assignment.ASSIGNMENT_POW
      ? (ctx.text.string(POW_STRINGS, POW_UNKNOWN) ?? '')
      : m.life === 0
        ? ''
        : moraleText(ctx.text, m.morale, false);
  centred(ctx, g.morale, morale, CHAR_TEXT_FONT_COLOR);
}

export function cornerIcons(m: StrategicMercView): number[] {
  const icons: number[] = [];
  const c = m.contract;
  if (c?.type === AIM) icons.push(0);
  else icons.push(-1);
  icons.push(c?.type === AIM && c.insured ? 2 : -1);
  icons.push(c?.type === AIM && c.medicalDeposit > 0 ? 1 : -1);
  return icons;
}

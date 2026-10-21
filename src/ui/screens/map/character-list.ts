// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-21. See LICENSE (SFI-SCLA).
// @src src/game/Strategic/MapScreen.cc AddCharacter (vehicles from FIRST_VEHICLE), ReBuildCharactersList,
// @src SortListOfMercsInTeamPanel (the swap loop over rows 1..FIRST_VEHICLE - 1 against the row's merc as it was when
// @src the row was reached), SwapCharactersInList, CalcLocationValueForChar, GetContractExpiryTime, ChangeSelectedInfoChar,
// @src HandleCtrlOrShiftInTeamPanel, GetMapscreenMercAssignmentString, GetMapscreenMercLocationString,
// @src GetMapscreenMercDestinationString, GetMapscreenMercDepartureString, DisplayCharacterList (the row colours);
// @src src/game/Strategic/Map_Screen_Interface.cc SetEntryInSelectedCharacterList, ResetEntryForSelectedList,
// @src ResetSelectedListForMapScreen, ToggleEntryInSelectedList, BuildSelectedListFromAToB, GetMoraleString,
// @src MultipleCharacterListEntriesSelected. See docs/28 §7.1.

import { FontColor } from '../../../content/text/font-colors.ts';
import { idiv } from '../../../core/int.ts';
import type { StrategicGroupView, StrategicMercView, StrategicVehicleView, StrategicView } from '../../../protocol/view.ts';
import type { UiTextService } from '../../text/text-service.ts';
import { parseSectorLabel } from './facts.ts';

export const MAX_CHARACTER_COUNT = 20;
export const FIRST_VEHICLE = 18;
export const NO_CHARACTER = -1;

export const Assignment = {
  ON_DUTY: 20,
  DOCTOR: 21,
  PATIENT: 22,
  VEHICLE: 23,
  IN_TRANSIT: 24,
  REPAIR: 25,
  TRAIN_SELF: 26,
  TRAIN_TOWN: 27,
  TRAIN_TEAMMATE: 28,
  TRAIN_BY_OTHER: 29,
  ASSIGNMENT_DEAD: 30,
  ASSIGNMENT_POW: 32,
} as const;

export const SortMode = { NAME: 0, ASSIGNMENT: 1, SLEEP: 2, LOCATION: 3, DESTINATION: 4, DEPARTURE: 5 } as const;

const VEHICLE_KIND = 'vehicle';
const AIM_KIND = 'aim';
const SLAY_NAME_FREE_EXPIRY = 999999;
const NO_PATH = 9999;
const SUBLEVEL_WEIGHT = 1000;
const MINUTES_PER_HOUR = 60;
const MINUTES_PER_DAY = 1440;
const MAP_TIME_UNDER_THIS_DISPLAY_AS_HOURS = 4320;
const MINS_TO_FLASH_CONTRACT_TIME = 240;
const HOURS_ROUNDING = 59;
const MINUTES_SHOWN_AS_ZERO = 5;
const STR_PB_NOTAPPLICABLE_ABBREVIATION = 43;
const STR_PB_DAYS_ABBREVIATION = 44;
const STR_PB_HOURS_ABBREVIATION = 45;
const STRATEGIC_STRINGS = 'gpStrategicString';
const ASSIGNMENT_STRINGS = 'pAssignmentStrings';
const SHORT_VEHICLE_STRINGS = 'pShortVehicleStrings';
const POW_STRINGS = 'pPOWStrings';
const POW_UNKNOWN = 1;
const MORALE_STRINGS = 'pMoralStrings';
const MORALE_LIMITS: readonly number[] = [80, 65, 35, 20];
const MORALE_PANIC = 4;
const MORALE_BAD = 5;
const SECTOR_ROWS = 16;
export const FONT_MAP_DKYELLOW = 170;
export const CHAR_TEXT_FONT_COLOR = 5;

export interface CharacterSlot {
  merc: number | null;
  selected: boolean;
}

export function isVehicle(m: StrategicMercView): boolean {
  return m.kind === VEHICLE_KIND;
}

export function isAimOrSlay(m: StrategicMercView): boolean {
  return m.contract?.type === AIM_KIND;
}

export function mercById(view: StrategicView | undefined, id: number | null): StrategicMercView | null {
  if (id === null || !view) return null;
  return view.mercs.find((m) => m.id === id) ?? null;
}

export function groupOfMerc(view: StrategicView, id: number): StrategicGroupView | null {
  return view.groups.find((g) => g.members.includes(id)) ?? null;
}

export function vehicleOfMerc(view: StrategicView, m: StrategicMercView): StrategicVehicleView | null {
  const vehicles = view.vehicles ?? [];
  if (m.vehicle !== undefined) return vehicles.find((v) => v.id === m.vehicle) ?? null;
  return null;
}

export function mercPath(view: StrategicView, m: StrategicMercView): readonly string[] {
  if (m.assignment === Assignment.VEHICLE || isVehicle(m)) {
    const v = vehicleOfMerc(view, m);
    if (v) return v.path;
  }
  return groupOfMerc(view, m.id)?.path ?? [];
}

function lastPathSectorId(view: StrategicView, m: StrategicMercView): number {
  const path = mercPath(view, m);
  const last = path.length > 0 ? parseSectorLabel(path[path.length - 1] as string) : null;
  return last ? (last.y - 1) * SECTOR_ROWS + (last.x - 1) : NO_PATH;
}

function locationValue(m: StrategicMercView): number {
  if (m.assignment === Assignment.ASSIGNMENT_POW) return 0;
  const s = parseSectorLabel(m.sector);
  return s ? (s.y - 1) * SECTOR_ROWS + (s.x - 1) + s.z * SUBLEVEL_WEIGHT : 0;
}

function contractExpiry(m: StrategicMercView): number {
  const c = m.contract;
  if (c?.type !== AIM_KIND) return SLAY_NAME_FREE_EXPIRY;
  return c.endMinutes ?? c.endsAt.day * MINUTES_PER_DAY + c.endsAt.hour * MINUTES_PER_HOUR;
}

function compareLater(mode: number, view: StrategicView, a: StrategicMercView, b: StrategicMercView): boolean {
  switch (mode) {
    case SortMode.NAME:
      return b.name > a.name;
    case SortMode.ASSIGNMENT:
      if (b.assignment > a.assignment) return true;
      return b.assignment === a.assignment && b.assignment === Assignment.VEHICLE && (b.vehicle ?? 0) > (a.vehicle ?? 0);
    case SortMode.SLEEP:
      return b.asleep && !a.asleep;
    case SortMode.LOCATION:
      return locationValue(b) > locationValue(a);
    case SortMode.DESTINATION:
      return lastPathSectorId(view, b) > lastPathSectorId(view, a);
    default:
      return contractExpiry(b) > contractExpiry(a);
  }
}

export class CharacterList {
  slots: CharacterSlot[] = Array.from({ length: MAX_CHARACTER_COUNT }, () => ({ merc: null, selected: false }));
  info = NO_CHARACTER;
  sortMode: number = SortMode.NAME;
  #roster = '';

  merc(view: StrategicView | undefined, row: number): StrategicMercView | null {
    return mercById(view, this.slots[row]?.merc ?? null);
  }

  rowOf(id: number): number {
    return this.slots.findIndex((s) => s.merc === id);
  }

  infoMerc(view: StrategicView | undefined): StrategicMercView | null {
    return this.info === NO_CHARACTER ? null : this.merc(view, this.info);
  }

  selectedRows(): number[] {
    return this.slots.flatMap((s, i) => (s.merc !== null && s.selected ? [i] : []));
  }

  selectedIds(): number[] {
    return this.slots.flatMap((s) => (s.merc !== null && s.selected ? [s.merc] : []));
  }

  multipleSelected(): boolean {
    return this.selectedRows().length > 1;
  }

  needsRebuild(view: StrategicView | undefined): boolean {
    return this.#rosterKey(view) !== this.#roster;
  }

  #rosterKey(view: StrategicView | undefined): string {
    return (view?.mercs ?? [])
      .map((m) => m.id)
      .sort((a, b) => a - b)
      .join(',');
  }

  rebuild(view: StrategicView | undefined, keepInfo = true): void {
    const previous = keepInfo ? (this.slots[this.info]?.merc ?? null) : null;
    this.slots = Array.from({ length: MAX_CHARACTER_COUNT }, () => ({ merc: null, selected: false }));
    const mercs = [...(view?.mercs ?? [])].sort((a, b) => a.id - b.id);
    for (const m of mercs) {
      const start = isVehicle(m) ? FIRST_VEHICLE : 0;
      for (let i = start; i < MAX_CHARACTER_COUNT; i++) {
        const slot = this.slots[i];
        if (slot && slot.merc === null) {
          slot.merc = m.id;
          break;
        }
      }
    }
    this.#roster = this.#rosterKey(view);
    this.info = previous === null ? NO_CHARACTER : this.rowOf(previous);
    this.sort(view, false);
    if (this.info === NO_CHARACTER || this.slots[this.info]?.merc === null)
      this.info = this.slots[0]?.merc !== null && this.slots[0] !== undefined ? 0 : NO_CHARACTER;
    this.resetSelected();
  }

  sort(view: StrategicView | undefined, retainSelected: boolean): void {
    if (!view) return;
    const infoMerc = this.slots[this.info]?.merc ?? null;
    for (let i = 1; i < FIRST_VEHICLE; i++) {
      const a = mercById(view, this.slots[i]?.merc ?? null);
      if (!a) break;
      for (let j = 0; j < FIRST_VEHICLE; j++) {
        const b = mercById(view, this.slots[j]?.merc ?? null);
        if (!b) break;
        if (j < i && compareLater(this.sortMode, view, a, b)) this.#swap(i, j);
      }
    }
    if (infoMerc !== null) this.info = this.rowOf(infoMerc);
    if (!retainSelected) this.resetSelected();
  }

  #swap(a: number, b: number): void {
    const x = this.slots[a];
    const y = this.slots[b];
    if (!x || !y) return;
    this.slots[a] = y;
    this.slots[b] = x;
  }

  resetSelected(): void {
    for (const s of this.slots) s.selected = false;
    const info = this.slots[this.info];
    if (info && info.merc !== null) info.selected = true;
  }

  setSelected(row: number, on = true): void {
    const s = this.slots[row];
    if (s) s.selected = on;
  }

  toggle(row: number): void {
    const s = this.slots[row];
    if (s) s.selected = !s.selected;
  }

  selectRange(a: number, b: number): void {
    this.resetSelected();
    const [start, end] = a > b ? [b, a] : [a, b];
    for (let i = Math.max(0, start); i <= end; i++) this.setSelected(i);
  }

  isSelected(row: number): boolean {
    return this.slots[row]?.selected === true;
  }

  changeInfo(row: number, resetList: boolean): boolean {
    if (row !== NO_CHARACTER && this.slots[row]?.merc === null) return false;
    if (resetList) this.resetSelected();
    if (this.info !== row) {
      if (resetList && this.info !== NO_CHARACTER) this.setSelected(this.info, false);
      this.info = row;
      if (row !== NO_CHARACTER) this.setSelected(row);
    }
    return true;
  }
}

export function moraleText(text: UiTextService, morale: number | undefined, dead: boolean): string {
  if (dead) return text.string(MORALE_STRINGS, MORALE_BAD) ?? '';
  const value = morale ?? 0;
  const at = MORALE_LIMITS.findIndex((limit) => value > limit);
  return text.string(MORALE_STRINGS, at === -1 ? MORALE_PANIC : at) ?? '';
}

export function assignmentString(text: UiTextService, view: StrategicView, m: StrategicMercView): string {
  if (m.assignment === Assignment.VEHICLE) {
    const v = vehicleOfMerc(view, m);
    return text.string(SHORT_VEHICLE_STRINGS, v?.type ?? 0) ?? '';
  }
  return text.string(ASSIGNMENT_STRINGS, m.assignment) ?? '';
}

export function locationString(text: UiTextService, m: StrategicMercView): string {
  if (m.assignment === Assignment.IN_TRANSIT) return '--';
  if (m.assignment === Assignment.ASSIGNMENT_POW) return text.string(POW_STRINGS, POW_UNKNOWN) ?? '';
  return m.betweenSectors ? `(${m.sector.replace('-', '')})` : m.sector.replace('-', '');
}

export function destinationString(view: StrategicView, m: StrategicMercView): string {
  if (m.assignment === Assignment.ASSIGNMENT_DEAD || m.assignment === Assignment.ASSIGNMENT_POW || m.life === 0) return '';
  if (m.assignment === Assignment.IN_TRANSIT) return view.landingZone ?? '';
  const path = mercPath(view, m);
  if (path.length > 0) return (path[path.length - 1] as string).split('-')[0] ?? '';
  if (!m.betweenSectors) return '';
  const g = groupOfMerc(view, m.id) ?? null;
  const next = g?.next ?? vehicleOfMerc(view, m)?.next ?? null;
  return next ? (next.split('-')[0] ?? '') : '';
}

export interface DepartureText {
  readonly text: string;
  readonly colour: number | null;
}

export function departureText(text: UiTextService, m: StrategicMercView, flashOn: boolean): DepartureText {
  const c = m.contract;
  if (c?.type !== AIM_KIND || m.life === 0)
    return { text: text.string(STRATEGIC_STRINGS, STR_PB_NOTAPPLICABLE_ABBREVIATION) ?? '', colour: null };
  const minutes = c.minutesLeft ?? c.remaining.days * MINUTES_PER_DAY + c.remaining.hours * MINUTES_PER_HOUR;
  if (minutes >= MAP_TIME_UNDER_THIS_DISPLAY_AS_HOURS)
    return {
      text: `${idiv(minutes, MINUTES_PER_DAY)}${text.string(STRATEGIC_STRINGS, STR_PB_DAYS_ABBREVIATION) ?? ''}`,
      colour: FontColor.LTGREEN,
    };
  const hours = minutes > MINUTES_SHOWN_AS_ZERO ? idiv(minutes + HOURS_ROUNDING, MINUTES_PER_HOUR) : 0;
  return {
    text: `${hours}${text.string(STRATEGIC_STRINGS, STR_PB_HOURS_ABBREVIATION) ?? ''}`,
    colour: minutes <= MINS_TO_FLASH_CONTRACT_TIME && flashOn ? FontColor.WHITE : FontColor.RED,
  };
}

export function contractLeavesSoon(m: StrategicMercView): boolean {
  const c = m.contract;
  if (c?.type !== AIM_KIND || m.life === 0) return false;
  const minutes = c.minutesLeft ?? c.remaining.days * MINUTES_PER_DAY + c.remaining.hours * MINUTES_PER_HOUR;
  return minutes <= MINS_TO_FLASH_CONTRACT_TIME;
}

export interface RowColourInput {
  readonly hovered: boolean;
  readonly plotted: boolean;
  readonly inSelectedSector: boolean;
}

export function rowColour(m: StrategicMercView, input: RowColourInput): number {
  if (input.hovered) return FontColor.WHITE;
  if (m.life === 0) return FontColor.METALGRAY;
  if (input.plotted) return FontColor.LTBLUE;
  if (!input.inSelectedSector) return CHAR_TEXT_FONT_COLOR;
  if (m.assignment < Assignment.ON_DUTY || m.assignment === Assignment.VEHICLE) return FontColor.YELLOW;
  return FONT_MAP_DKYELLOW;
}

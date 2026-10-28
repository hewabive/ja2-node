// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-24. See LICENSE (SFI-SCLA).
// @src src/game/Laptop/Personnel.cc gubPersonnelInfoState, iCurrentPersonSelectedId, giCurrentUpperLeftPortraitNumber,
// @src fCurrentTeamMode, uiCurrentInventoryIndex, guiSliderPosition, EnterPersonnel and SelectFirstDisplayedMerc,
// @src NextPersonnelFace, PrevPersonnelFace, PersonnelPortraitCallbackPrimary/Secondary, PersonnelCurrentTeamCallback,
// @src PersonnelDepartedTeamCallback, DepartedUpCallBack, DepartedDownCallBack, EnableDisableDeparturesButtons,
// @src SetPersonnelButtonStates, InventoryUp, InventoryDown, EnableDisableInventoryScrollButtons,
// @src FindPositionOfPersInvSlider, HandleSliderBarClickCallback (scroll count x relative y / (203 - 19)),
// @src DisplayTeamStats (min with >=, max with <=, the integer average), DisplayCostOfCurrentTeam,
// @src DisplayEmploymentinformation (the days and hours left of the contract), DisplayCharStats (the KM overrun rule of
// @src the skill texts).

import { idiv } from '../../../../core/int.ts';

export const PERSONNEL_PORTRAIT_NUMBER = 20;
export const PERSONNEL_PORTRAIT_NUMBER_WIDTH = 5;
export const NUMBER_OF_INVENTORY_PERSONNEL = 8;
export const Y_SIZE_OF_PERSONNEL_SCROLL_REGION = 422 - 219;
export const SIZE_OF_PERSONNEL_CURSOR = 19;
export const NO_SELECTION = -1;
const LAST_PORTRAIT = PERSONNEL_PORTRAIT_NUMBER - 1;
const SLIDER_TRAVEL = Y_SIZE_OF_PERSONNEL_SCROLL_REGION - SIZE_OF_PERSONNEL_CURSOR;
const NO_MINIMUM_COST = 999999;
const MINUTES_PER_DAY = 24 * 60;
const MINUTES_PER_HOUR = 60;
const STAT_MINIMUM_START = 100;
const STAT_MAXIMUM_START = 0;

export const PersonnelInfo = { STATS: 0, EMPLOYMENT: 1, INVENTORY: 2 } as const;

export interface PersonnelState {
  currentMode: boolean;
  selected: number;
  info: number;
  inventoryIndex: number;
  sliderPosition: number;
  upperLeft: number;
}

export interface PersonnelCounts {
  readonly team: number;
  readonly past: number;
}

export function initialPersonnelState(counts: PersonnelCounts): PersonnelState {
  return {
    currentMode: true,
    selected: counts.team > 0 ? 0 : NO_SELECTION,
    info: PersonnelInfo.STATS,
    inventoryIndex: 0,
    sliderPosition: 0,
    upperLeft: 0,
  };
}

function resetInventory(s: PersonnelState): void {
  s.inventoryIndex = 0;
  s.sliderPosition = 0;
}

export function nextFace(s: PersonnelState, counts: PersonnelCounts): void {
  if (s.selected === NO_SELECTION) return;
  if (s.currentMode) s.selected = s.selected === counts.team - 1 ? 0 : s.selected + 1;
  else if (s.selected + 1 === counts.past - s.upperLeft) {
    s.upperLeft = 0;
    s.selected = 0;
  } else if (s.selected === LAST_PORTRAIT) {
    s.upperLeft += PERSONNEL_PORTRAIT_NUMBER;
    s.selected = 0;
  } else s.selected++;
}

export function prevFace(s: PersonnelState, counts: PersonnelCounts): void {
  if (s.selected === NO_SELECTION) return;
  if (s.currentMode) s.selected = s.selected === 0 ? counts.team - 1 : s.selected - 1;
  else if (s.selected === 0 && s.upperLeft === 0) {
    s.upperLeft = counts.past - (counts.past % PERSONNEL_PORTRAIT_NUMBER);
    s.selected = (counts.past % PERSONNEL_PORTRAIT_NUMBER) - 1;
  } else if (s.selected === 0) {
    s.upperLeft -= PERSONNEL_PORTRAIT_NUMBER;
    s.selected = LAST_PORTRAIT;
  } else s.selected--;
}

export function stepFace(s: PersonnelState, counts: PersonnelCounts, forward: boolean): void {
  if (forward) nextFace(s, counts);
  else prevFace(s, counts);
  resetInventory(s);
}

export function faceButtonsEnabled(s: PersonnelState, counts: PersonnelCounts): boolean {
  return (s.currentMode ? counts.team : counts.past) > 1;
}

function leaveInventoryForPow(s: PersonnelState, pow: (slot: number) => boolean): void {
  if (s.selected !== NO_SELECTION && pow(s.selected) && s.info === PersonnelInfo.INVENTORY) s.info = PersonnelInfo.STATS;
}

export function selectPortrait(s: PersonnelState, id: number, counts: PersonnelCounts, pow: (slot: number) => boolean): void {
  const old = s.selected;
  if (s.currentMode) {
    if (id >= counts.team) return;
    s.selected = id;
    leaveInventoryForPow(s, pow);
  } else {
    if (id >= counts.past - s.upperLeft) return;
    s.selected = id;
  }
  if (old !== id) resetInventory(s);
}

export function cyclePortrait(s: PersonnelState, id: number, counts: PersonnelCounts, pow: (slot: number) => boolean): void {
  if (!s.currentMode || id >= counts.team) return;
  if (s.selected === id) s.info = s.info < PersonnelInfo.INVENTORY ? s.info + 1 : PersonnelInfo.STATS;
  s.selected = id;
  resetInventory(s);
  leaveInventoryForPow(s, pow);
}

export function showCurrentTeam(s: PersonnelState, counts: PersonnelCounts): void {
  if (s.currentMode) return;
  s.currentMode = true;
  s.selected = counts.team > 0 ? 0 : NO_SELECTION;
}

export function showDepartedTeam(s: PersonnelState, counts: PersonnelCounts): void {
  if (!s.currentMode) return;
  s.currentMode = false;
  s.selected = counts.past > 0 ? 0 : NO_SELECTION;
  s.info = PersonnelInfo.STATS;
}

export function departedUp(s: PersonnelState): void {
  if (s.upperLeft - PERSONNEL_PORTRAIT_NUMBER >= 0) s.upperLeft -= PERSONNEL_PORTRAIT_NUMBER;
}

export function departedDown(s: PersonnelState, counts: PersonnelCounts): void {
  if (counts.past - s.upperLeft <= PERSONNEL_PORTRAIT_NUMBER) return;
  s.upperLeft += PERSONNEL_PORTRAIT_NUMBER;
  if (s.selected >= counts.past - s.upperLeft) s.selected = counts.past - s.upperLeft - 1;
}

export function departedUpEnabled(s: PersonnelState): boolean {
  return s.upperLeft !== 0;
}

export function departedDownEnabled(s: PersonnelState, counts: PersonnelCounts): boolean {
  return counts.past - s.upperLeft > PERSONNEL_PORTRAIT_NUMBER;
}

export function sliderPositionOf(index: number, items: number): number {
  return idiv(SLIDER_TRAVEL * index, items - NUMBER_OF_INVENTORY_PERSONNEL);
}

export function inventoryUpEnabled(s: PersonnelState): boolean {
  return s.inventoryIndex !== 0;
}

export function inventoryDownEnabled(s: PersonnelState, items: number): boolean {
  return s.inventoryIndex < items - NUMBER_OF_INVENTORY_PERSONNEL;
}

export function inventoryUp(s: PersonnelState, items: number): void {
  if (s.inventoryIndex === 0) return;
  s.inventoryIndex--;
  s.sliderPosition = sliderPositionOf(s.inventoryIndex, items);
}

export function inventoryDown(s: PersonnelState, items: number): void {
  if (!inventoryDownEnabled(s, items)) return;
  s.inventoryIndex++;
  s.sliderPosition = sliderPositionOf(s.inventoryIndex, items);
}

export function sliderIndexAt(relativeY: number, items: number): number {
  return Math.trunc(((items - NUMBER_OF_INVENTORY_PERSONNEL) * relativeY) / SLIDER_TRAVEL);
}

export function sliderTo(s: PersonnelState, items: number, relativeY: number): void {
  if (items <= NUMBER_OF_INVENTORY_PERSONNEL) return;
  const index = sliderIndexAt(relativeY, items);
  if (index === s.inventoryIndex) return;
  s.sliderPosition = sliderPositionOf(index, items);
  s.inventoryIndex = index;
}

export interface SliderZone {
  readonly y: number;
  readonly height: number;
}

export function sliderZones(items: number): SliderZone[] {
  if (items <= NUMBER_OF_INVENTORY_PERSONNEL) return [];
  const zones: SliderZone[] = [];
  let start = 0;
  for (let y = 1; y <= Y_SIZE_OF_PERSONNEL_SCROLL_REGION + 1; y++) {
    if (y <= Y_SIZE_OF_PERSONNEL_SCROLL_REGION && sliderIndexAt(y, items) === sliderIndexAt(start, items)) continue;
    zones.push({ y: start, height: y - 1 - start });
    start = y;
  }
  return zones;
}

export function zoneRelativeY(zones: readonly SliderZone[], zone: number): number {
  return zones[zone]?.y ?? 0;
}

export interface TeamCost {
  readonly daily: number;
  readonly highest: number;
  readonly lowest: number;
}

export function teamCost(costs: readonly number[]): TeamCost {
  let lowest = NO_MINIMUM_COST;
  let highest = 0;
  let daily = 0;
  for (const cost of costs) {
    if (cost > highest) highest = cost;
    if (cost < lowest) lowest = cost;
    daily += cost;
  }
  return { daily, highest, lowest: lowest === NO_MINIMUM_COST ? 0 : lowest };
}

export interface TeamStatMember {
  readonly name: string;
  readonly stats: readonly number[];
}

export interface TeamStatRow {
  readonly minName: string;
  readonly minValue: number;
  readonly average: number;
  readonly maxName: string;
  readonly maxValue: number;
}

export function teamStatRow(members: readonly TeamStatMember[], stat: number): TeamStatRow | null {
  let minName = '';
  let maxName = '';
  let minValue = STAT_MINIMUM_START;
  let maxValue = STAT_MAXIMUM_START;
  let sum = 0;
  for (const m of members) {
    const value = m.stats[stat] ?? 0;
    if (minValue >= value) {
      minName = m.name;
      minValue = value;
    }
    if (maxValue <= value) {
      maxName = m.name;
      maxValue = value;
    }
    sum += value;
  }
  if (members.length === 0) return null;
  return { minName, minValue, average: Math.trunc(sum / members.length), maxName, maxValue };
}

export interface ContractAbbreviations {
  readonly days: string;
  readonly hours: string;
}

export function remainingContractText(minutesLeft: number, totalDays: number, a: ContractAbbreviations): string {
  const left = Math.max(0, minutesLeft);
  const days = Math.trunc(left / MINUTES_PER_DAY);
  const hours = Math.trunc((left % MINUTES_PER_DAY) / MINUTES_PER_HOUR);
  const total = `${totalDays}${a.days}`;
  return days > 0 ? `${days}${a.days} ${hours}${a.hours} / ${total}` : `${hours}${a.hours} / ${total}`;
}

export function signedDelta(delta: number): string {
  return delta ? `( ${delta > 0 ? '+' : ''}${delta} )` : '';
}

export function hitPercentage(shotsFired: number, shotsHit: number): number {
  return shotsFired > 0 ? Math.trunc((100 * shotsHit) / shotsFired) : 0;
}

export interface SkillGeometry {
  readonly statX: number;
  readonly valueWidth: number;
  readonly deltaX: number;
  readonly deltaWidth: number;
  readonly minimumX: number;
}

export interface SkillLine {
  readonly x: number;
  readonly text: string;
}

export function skillLines(
  traits: readonly [number, number],
  texts: { readonly skill: (trait: number) => string; readonly expert: string; readonly none: string },
  width: (text: string) => number,
  g: SkillGeometry,
  noTrait: number,
): SkillLine[] {
  let [first, second] = traits;
  if (first === noTrait) {
    first = second;
    second = noTrait;
  }
  const right = (text: string) => g.statX + g.valueWidth - width(text);
  if (first === noTrait) return [{ x: right(texts.none), text: texts.none }];
  if (first === second) {
    const text = `${texts.skill(first)} ${texts.expert}`;
    let x = right(text);
    if (x <= g.minimumX) x = Math.max(g.deltaX + g.deltaWidth - width(text), g.minimumX);
    return [{ x, text }];
  }
  const line = (trait: number): SkillLine => {
    const text = texts.skill(trait);
    return { x: Math.max(right(text), g.minimumX), text };
  };
  return second === noTrait ? [line(first)] : [line(first), line(second)];
}

export function portraitSlot(index: number): { readonly row: number; readonly column: number } {
  return { row: Math.trunc(index / PERSONNEL_PORTRAIT_NUMBER_WIDTH), column: index % PERSONNEL_PORTRAIT_NUMBER_WIDTH };
}

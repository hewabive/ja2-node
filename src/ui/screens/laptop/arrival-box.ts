// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-24. See LICENSE (SFI-SCLA).
// @src src/game/Laptop/AIMMembers.cc DisplayPopUpBoxExplainingMercArrivalLocationAndTime (nickname, sector with its town,
// @src day = arrival / 1440, "HH:00", the German argument order), called by Mercs_Files.cc BtnMercHireButtonCallback.
// @src See docs/28 §9.5.

import { idiv } from '../../../core/int.ts';
import { printf } from '../../text/printf.ts';
import { MessageBoxFlag } from '../../widgets/message-box.ts';
import type { LaptopContext } from './laptop-page.ts';

const MESSAGE_STRINGS = 'pMessageStrings';
const MSG_JUST_HIRED_MERC_ARRIVAL_LOCATION_POPUP = 66;
const TOWN_NAMES = 'strategic-map-town-names';
const MINUTES_PER_DAY = 1440;
const MINUTES_PER_HOUR = 60;
const GERMAN_DATA = 'german';

export interface HiredArrival {
  readonly profile: number;
  readonly arrivalMinute: number;
  readonly sector: string;
}

export function arrivalText(context: LaptopContext, hired: HiredArrival): string {
  const town = context.client.strategic()?.sectors.find((s) => s.sector === hired.sector)?.town ?? 0;
  const sector = town > 0 ? `${hired.sector}: ${context.string(TOWN_NAMES, town)}` : hired.sector;
  const nickname = context.data.profile(hired.profile)?.nickname ?? '';
  const day = idiv(hired.arrivalMinute, MINUTES_PER_DAY);
  const time = `${String(idiv(hired.arrivalMinute % MINUTES_PER_DAY, MINUTES_PER_HOUR)).padStart(2, '0')}:00`;
  const template = context.string(MESSAGE_STRINGS, MSG_JUST_HIRED_MERC_ARRIVAL_LOCATION_POPUP);
  const args = context.dataVersion === GERMAN_DATA ? [nickname, day, time, sector] : [nickname, sector, day, time];
  return printf(template, args);
}

export function showArrivalBox(context: LaptopContext, hired: HiredArrival): void {
  context.messageBox(arrivalText(context, hired), MessageBoxFlag.OK);
}

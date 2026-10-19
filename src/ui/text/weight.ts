// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-19. See LICENSE (SFI-SCLA).
// @src src/game/Utils/Text_Utils.cc GetWeightUnitString, GetWeightBasedOnMetricOption (pounds = weight × 2.2 as a
// @src float); src/game/Utils/Text.h MSG_KILOGRAM_ABBREVIATION, MSG_POUND_ABBREVIATION. See docs/28 §3.4.

import type { UiTextService } from './text-service.ts';

export const MESSAGE_STRINGS = 'pMessageStrings';
export const MSG_KILOGRAM_ABBREVIATION = 16;
export const MSG_POUND_ABBREVIATION = 17;
const POUNDS_PER_UNIT = Math.fround(2.2);

export function weightBasedOnMetricOption(weight: number, metric: boolean): number {
  return metric ? Math.fround(weight) : Math.fround(weight * POUNDS_PER_UNIT);
}

export function weightUnit(text: UiTextService, metric: boolean): string {
  return text.string(MESSAGE_STRINGS, metric ? MSG_KILOGRAM_ABBREVIATION : MSG_POUND_ABBREVIATION) ?? '';
}

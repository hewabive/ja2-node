// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-11-14. See LICENSE (SFI-SCLA).
// @src src/game/Strategic/Town_Militia.cc HandleInterfaceMessageForCostOfTrainingMilitia (pMilitiaConfirmStrings 7 with
// @src the cost of the unpaid sectors), HandleInterfaceMessageForContinuingTrainingMilitia (8 with the town and
// @src MIN_RATING_TO_TRAIN_TOWN, 9 with the town or a wilderness SAM site's detailed GetSectorIDString, 7 with the cost
// @src of one sector), PayMilitiaTrainingYesNoBoxCallback (2 when the money is gone after a yes); all OK boxes on the
// @src screen that is up (DoScreenIndependantMessageBox), [2] through DoMapMessageBox; BuildMilitiaPromotionsString and
// @src PromoteMilitia (green to veteran, green to regular, regular to veteran, the singular line for one, the plural with
// @src the count, joined by spaces), the map screen's box (2026-11-15).

import type { ViewFrame } from '../../../protocol/view.ts';
import { printf } from '../../text/printf.ts';
import type { UiTextService } from '../../text/text-service.ts';

type FrameEvent = NonNullable<ViewFrame['events']>[number];
export type MilitiaRejectedEvent = Extract<FrameEvent, { readonly type: 'militiaTrainingRejected' }>;
export type MilitiaPromotedEvent = Extract<FrameEvent, { readonly type: 'militiaPromoted' }>;

const MILITIA = 'pMilitiaConfirmStrings';
const TOWN_NAMES = 'strategic-map-town-names';
const CANT_AFFORD_IT = 2;
const CANNOT_AFFORD_TRAINING = 7;
const LOYALTY_TOO_LOW_TO_CONTINUE = 8;
const CANNOT_TRAIN_ANY_FURTHER = 9;
const MIN_RATING_TO_TRAIN_TOWN = 20;
const BLANK_SECTOR = 0;
const LATE_STRINGS = 'gzLateLocalizedString';
const STR_LATE_22 = 21;
const STR_LATE_23 = 22;
const STR_LATE_24 = 23;
const STR_LATE_29 = 28;
const STR_LATE_30 = 29;
const STR_LATE_31 = 30;

interface PromotionLine {
  readonly count: 'greenToElite' | 'greenToRegular' | 'regularToElite';
  readonly singular: number;
  readonly plural: number;
}

const PROMOTION_LINES: readonly PromotionLine[] = [
  { count: 'greenToElite', singular: STR_LATE_29, plural: STR_LATE_22 },
  { count: 'greenToRegular', singular: STR_LATE_30, plural: STR_LATE_23 },
  { count: 'regularToElite', singular: STR_LATE_31, plural: STR_LATE_24 },
];

export interface MilitiaBoxSources {
  readonly text: UiTextService;
  readonly sectorName: (label: string) => string;
  readonly townOf: (label: string) => number;
}

function townName(sources: MilitiaBoxSources, town: number): string {
  return town === BLANK_SECTOR ? '' : (sources.text.string(TOWN_NAMES, town) ?? '');
}

export function militiaRejectionText(sources: MilitiaBoxSources, event: MilitiaRejectedEvent): string | null {
  const string = (index: number) => sources.text.string(MILITIA, index) ?? '';
  const town = sources.townOf(event.sector);
  switch (event.reason) {
    case 'declined':
      return null;
    case 'cannotAfford':
      return printf(string(CANNOT_AFFORD_TRAINING), [event.cost]);
    case 'fundsGone':
      return string(CANT_AFFORD_IT);
    case 'loyaltyTooLow':
      return printf(string(LOYALTY_TOO_LOW_TO_CONTINUE), [townName(sources, town), MIN_RATING_TO_TRAIN_TOWN]);
    case 'militiaFull':
      return town === BLANK_SECTOR
        ? printf(string(CANNOT_TRAIN_ANY_FURTHER), [sources.sectorName(event.sector)])
        : printf(string(CANNOT_TRAIN_ANY_FURTHER), [townName(sources, town), MIN_RATING_TO_TRAIN_TOWN]);
  }
}

function promotionLine(text: UiTextService, line: PromotionLine, count: number): string {
  const string = (index: number) => text.string(LATE_STRINGS, index) ?? '';
  return count === 1 ? string(line.singular) : printf(string(line.plural), [count]);
}

export function militiaPromotionsText(text: UiTextService, event: MilitiaPromotedEvent): string {
  return PROMOTION_LINES.reduce((box, line) => {
    const count = event[line.count];
    if (count <= 0) return box;
    const added = promotionLine(text, line, count);
    return box === '' ? added : `${box} ${added}`;
  }, '');
}

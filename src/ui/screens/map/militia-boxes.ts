// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-11-14. See LICENSE (SFI-SCLA).
// @src src/game/Strategic/Town_Militia.cc HandleInterfaceMessageForCostOfTrainingMilitia (pMilitiaConfirmStrings 7 with
// @src the cost of the unpaid sectors), HandleInterfaceMessageForContinuingTrainingMilitia (8 with the town and
// @src MIN_RATING_TO_TRAIN_TOWN, 9 with the town or a wilderness SAM site's detailed GetSectorIDString, 7 with the cost
// @src of one sector), PayMilitiaTrainingYesNoBoxCallback (2 when the money is gone after a yes); all OK boxes on the
// @src screen that is up (DoScreenIndependantMessageBox), [2] through DoMapMessageBox.

import type { ViewFrame } from '../../../protocol/view.ts';
import { printf } from '../../text/printf.ts';
import type { UiTextService } from '../../text/text-service.ts';

type FrameEvent = NonNullable<ViewFrame['events']>[number];
export type MilitiaRejectedEvent = Extract<FrameEvent, { readonly type: 'militiaTrainingRejected' }>;

const MILITIA = 'pMilitiaConfirmStrings';
const TOWN_NAMES = 'strategic-map-town-names';
const CANT_AFFORD_IT = 2;
const CANNOT_AFFORD_TRAINING = 7;
const LOYALTY_TOO_LOW_TO_CONTINUE = 8;
const CANNOT_TRAIN_ANY_FURTHER = 9;
const MIN_RATING_TO_TRAIN_TOWN = 20;
const BLANK_SECTOR = 0;

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

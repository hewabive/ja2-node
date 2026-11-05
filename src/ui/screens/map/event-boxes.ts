// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-31. See LICENSE (SFI-SCLA).
// @src src/game/Strategic/Map_Screen_Interface.cc NotifyPlayerWhenEnemyTakesControlOfImportantSector (pMapErrorString 15
// @src for a SAM site, 16 with the new daily income in SPrintMoney for a mine, 25 for a town, each naming the sector by
// @src the detailed GetSectorIDString); src/game/Strategic/Strategic_Movement.cc ReportVehicleOutOfGas (STR_LATE_05
// @src with pVehicleStrings of the vehicle's type and the sector's short string, 2026-11-05);
// @src src/game/MessageBoxScreen.cc DoScreenIndependantMessageBox (an OK box on the screen that is up when it happens).

import type { PlayerView, ViewFrame } from '../../../protocol/view.ts';
import { sprintMoney } from '../../text/money.ts';
import { braceFormat, printf } from '../../text/printf.ts';
import type { UiTextService } from '../../text/text-service.ts';
import { eventPrompt, type PromptedText } from '../../viewer-prompts.ts';

type FrameEvent = NonNullable<ViewFrame['events']>[number];
export type SectorLostEvent = Extract<FrameEvent, { readonly type: 'sectorLost' }>;

const MAP_ERROR = 'pMapErrorString';
const SAM_SITE_TAKEN = 15;
const MINE_TAKEN = 16;
const TOWN_TAKEN = 25;
const TAKEN_TEXT: Readonly<Record<SectorLostEvent['kind'], number>> = { sam: SAM_SITE_TAKEN, mine: MINE_TAKEN, town: TOWN_TAKEN };
const LATE_STRINGS = 'gzLateLocalizedString';
const STR_LATE_05 = 4;
const VEHICLE_STRINGS = 'pVehicleStrings';
const TACTICAL_FLOW = 'tactical';

export interface EventBoxSources {
  readonly text: UiTextService;
  readonly sectorName: (label: string) => string;
  readonly vehicleType: (vehicle: number) => number | null;
}

export function lostSectorText(text: UiTextService, event: SectorLostEvent, sectorName: (label: string) => string): string {
  const template = text.string(MAP_ERROR, TAKEN_TEXT[event.kind]) ?? '';
  const name = sectorName(event.sector);
  return printf(template, event.kind === 'mine' ? [name, sprintMoney(event.dailyIncome ?? 0)] : [name]);
}

export function outOfGasText(text: UiTextService, vehicleType: number, sector: string): string {
  return braceFormat(text.string(LATE_STRINGS, STR_LATE_05) ?? '', [text.string(VEHICLE_STRINGS, vehicleType) ?? '', sector]);
}

function eventBox(event: FrameEvent, sources: EventBoxSources): PromptedText | null {
  if (event.type === 'sectorLost')
    return { text: lostSectorText(sources.text, event, sources.sectorName), prompt: eventPrompt(event, event.sector) };
  if (event.type !== 'vehicleOutOfGas') return null;
  const type = sources.vehicleType(event.vehicle);
  return type === null ? null : { text: outOfGasText(sources.text, type, event.sector), prompt: eventPrompt(event, event.sector) };
}

export function eventBoxesOf(frames: readonly ViewFrame[], sources: EventBoxSources): PromptedText[] {
  return frames.flatMap((f) => (f.events ?? []).flatMap((e) => eventBox(e, sources) ?? []));
}

export function vehicleTypeIn(view: PlayerView | null): (vehicle: number) => number | null {
  return (vehicle) => view?.strategic?.vehicles?.find((v) => v.id === vehicle)?.type ?? null;
}

export function inTacticalFlow(view: PlayerView | null): boolean {
  return view?.strategic?.flow === TACTICAL_FLOW;
}

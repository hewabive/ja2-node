// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-31. See LICENSE (SFI-SCLA).
// @src src/game/Strategic/Map_Screen_Interface.cc NotifyPlayerWhenEnemyTakesControlOfImportantSector (pMapErrorString 15
// @src for a SAM site, 16 with the new daily income in SPrintMoney for a mine, 25 for a town, each naming the sector by
// @src the detailed GetSectorIDString); src/game/MessageBoxScreen.cc DoScreenIndependantMessageBox (an OK box on the
// @src screen that is up when the sector is lost).

import type { PlayerView, ViewFrame } from '../../../protocol/view.ts';
import { sprintMoney } from '../../text/money.ts';
import { printf } from '../../text/printf.ts';
import type { UiTextService } from '../../text/text-service.ts';

type FrameEvent = NonNullable<ViewFrame['events']>[number];
export type SectorLostEvent = Extract<FrameEvent, { readonly type: 'sectorLost' }>;

const MAP_ERROR = 'pMapErrorString';
const SAM_SITE_TAKEN = 15;
const MINE_TAKEN = 16;
const TOWN_TAKEN = 25;
const TAKEN_TEXT: Readonly<Record<SectorLostEvent['kind'], number>> = { sam: SAM_SITE_TAKEN, mine: MINE_TAKEN, town: TOWN_TAKEN };
const TACTICAL_FLOW = 'tactical';

export function lostSectorText(text: UiTextService, event: SectorLostEvent, sectorName: (label: string) => string): string {
  const template = text.string(MAP_ERROR, TAKEN_TEXT[event.kind]) ?? '';
  const name = sectorName(event.sector);
  return printf(template, event.kind === 'mine' ? [name, sprintMoney(event.dailyIncome ?? 0)] : [name]);
}

export function lostSectorsOf(frames: readonly ViewFrame[]): SectorLostEvent[] {
  return frames.flatMap((f) => (f.events ?? []).filter((e): e is SectorLostEvent => e.type === 'sectorLost'));
}

export function inTacticalFlow(view: PlayerView | null): boolean {
  return view?.strategic?.flow === TACTICAL_FLOW;
}

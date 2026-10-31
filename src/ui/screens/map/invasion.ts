// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-31. See LICENSE (SFI-SCLA).
// @src src/game/Strategic/Map_Screen_Interface.cc NotifyPlayerOfInvasionByEnemyForces (an OK box with pMapErrorString
// @src 22 and the short sector string for a SAM site, 23 and the detailed GetSectorIDString for a town; another sector
// @src only gets a screen message); src/game/Strategic/Strategic_Movement.cc CheckConditionsForBattle (the box comes
// @src before the pre-battle panel, which its callback TriggerPrebattleInterface opens).

import type { ViewFrame } from '../../../protocol/view.ts';
import { printf } from '../../text/printf.ts';
import type { UiTextService } from '../../text/text-service.ts';

type FrameEvent = NonNullable<ViewFrame['events']>[number];
export type InvasionEvent = Extract<FrameEvent, { readonly type: 'invasion' }>;
type BoxedKind = Exclude<InvasionEvent['kind'], 'other'>;

const MAP_ERROR = 'pMapErrorString';
const INVASION_TEXT: Readonly<Record<BoxedKind, number>> = { sam: 22, town: 23 };

function boxed(e: FrameEvent): e is InvasionEvent & { readonly kind: BoxedKind } {
  return e.type === 'invasion' && e.kind !== 'other';
}

export function invasionBoxesOf(frames: readonly ViewFrame[]): InvasionEvent[] {
  return frames.flatMap((f) => (f.events ?? []).filter(boxed));
}

export function invasionText(text: UiTextService, event: InvasionEvent, detailedName: (label: string) => string): string {
  if (event.kind === 'other') return '';
  const name = event.kind === 'town' ? detailedName(event.sector) : event.sector;
  return printf(text.string(MAP_ERROR, INVASION_TEXT[event.kind]) ?? '', [name]);
}

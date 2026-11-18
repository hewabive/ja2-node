// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-11-18. See LICENSE (SFI-SCLA).
// @src src/game/Tactical/Interface_Panels.cc CheckForDisabledForGiveItem (the merc of the single merc panel out of reach of
// @src the merc holding the item, or of the selected merc).

import { panelOutOfReach } from '../tactical/inventory-commands.ts';
import { actingSoldier } from './soldier-check.ts';
import { type HintRequestBase, type HintResult, hintData, refuseHint } from './types.ts';

export interface PanelReach {
  readonly outOfReach: boolean;
}

export interface PanelReachRequest extends HintRequestBase {
  readonly soldier?: unknown;
  readonly source?: unknown;
  readonly itemHeld?: unknown;
}

export function panelReach(world: Parameters<typeof actingSoldier>[0], req: PanelReachRequest): HintResult<PanelReach> {
  const acting = actingSoldier(world, req.soldier);
  if ('refusal' in acting) return acting.refusal;
  const source = req.source === undefined ? null : actingSoldier(world, req.source);
  if (source && 'refusal' in source) return refuseHint('noSuchSource', 'source must be a soldier of yours');
  return hintData({ outOfReach: panelOutOfReach(acting.state, acting.soldier, source?.soldier ?? null, req.itemHeld === true) });
}

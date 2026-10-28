// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-19. See LICENSE (SFI-SCLA).
// @src src/game/Strategic/Map_Screen_Interface_Bottom.cc AllowedToExitFromMapscreenTo (the Tactical button: a battle
// @src elsewhere, a pending decision); StrategicMap.cc CanGoToTacticalInSector.

import type { Sector } from '../../content/strategic/sector-ids.ts';
import { sameSector } from '../../content/strategic/sector-ids.ts';
import { sectorMapPath } from '../../content/strategic/sector-maps.ts';
import { canGoToTacticalInSector } from '../campaign/sector-flow.ts';
import type { KnowledgeWorld } from '../knowledge/knowledge-world.ts';
import type { StrategicKnowledge } from '../knowledge/strategic.ts';
import { sectorFromName } from '../knowledge/strategic-state.ts';
import { sectorParam, strategicOf } from './strategic-check.ts';
import { type HintRequestBase, type HintResult, hintData, refuseHint } from './types.ts';

const DECISION_PROMPTS: ReadonlySet<string> = new Set(['preBattle', 'simultaneousArrival', 'npcOfNote']);

export interface CanEnterSector {
  readonly allowed: boolean;
  readonly reason?: string;
}

export interface CanEnterSectorRequest extends HintRequestBase {
  readonly sector?: unknown;
}

function refusalOf(world: KnowledgeWorld, sk: StrategicKnowledge, sector: Sector): string | null {
  const prompt = world.view.prompt;
  if (prompt) return DECISION_PROMPTS.has(prompt.kind) ? 'decisionPending' : 'promptOpen';
  const loaded = sk.strategic.worldSector;
  if (sk.enemyInLoadedSector && loaded && world.view.mapPath && !sameSector(sectorFromName(loaded), sector)) return 'battleElsewhere';
  if (!canGoToTacticalInSector(sk.ctx.crew.all(), sector)) return 'noMercThere';
  const exists = (path: string) => sk.rules.mapExists(path);
  if (!exists(sectorMapPath(exists, sector, false))) return 'mapNotLoaded';
  return null;
}

export function canEnterSector(world: KnowledgeWorld, req: CanEnterSectorRequest): HintResult<CanEnterSector> {
  const sk = strategicOf(world);
  if ('refusal' in sk) return sk.refusal;
  const sector = sectorParam(req.sector);
  if (!sector) return refuseHint('badSector', "sector must be like 'B9'");
  const reason = refusalOf(world, sk, sector);
  return hintData(reason ? { allowed: false, reason } : { allowed: true });
}

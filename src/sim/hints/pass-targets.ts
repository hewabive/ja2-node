// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-11-04. See LICENSE (SFI-SCLA).
// @src src/game/Strategic/Map_Screen_Interface.cc MapscreenCanPassItemToChar (the mercs ChangeSelectedInfoChar and
// @src ValidSelectableCharForNextOrPrev let the info character change to while an item is held on the map screen).

import { type HeldItemSource, type ItemHolder, mapscreenCanPassItemToChar } from '../campaign/item-passing.ts';
import type { KnowledgeWorld } from '../knowledge/knowledge-world.ts';
import type { StrategicKnowledge } from '../knowledge/strategic.ts';
import { sectorFromName } from '../knowledge/strategic-state.ts';
import type { KnowledgeMerc } from '../knowledge/view.ts';
import { NO_VEHICLE } from '../strategic/forces/constants.ts';
import { sectorParam, strategicOf } from './strategic-check.ts';
import { type HintRefusal, type HintRequestBase, type HintResult, hintData, refuseHint } from './types.ts';

export interface PassTargets {
  readonly mercs: readonly number[];
}

export interface PassTargetsRequest extends HintRequestBase {
  readonly soldier?: unknown;
  readonly sector?: unknown;
}

function holderOf(m: KnowledgeMerc): ItemHolder {
  return {
    sector: sectorFromName(m.sector),
    betweenSectors: m.betweenSectors,
    assignment: m.assignment,
    vehicleId: m.vehicle ?? NO_VEHICLE,
  };
}

function sourceOf(sk: StrategicKnowledge, req: PassTargetsRequest): HeldItemSource | { readonly refusal: HintRefusal } {
  if (req.soldier !== undefined) {
    const m = typeof req.soldier === 'number' ? sk.mercView(req.soldier) : null;
    return m ? { holder: holderOf(m) } : { refusal: refuseHint('noSuchMerc', 'no such merc') };
  }
  const stash = sectorParam(req.sector);
  if (stash) return { stash };
  return { refusal: refuseHint('badSource', "name the soldier the item came from, or the sector of the inventory it came from like 'B9'") };
}

export function passTargets(world: KnowledgeWorld, req: PassTargetsRequest): HintResult<PassTargets> {
  const sk = strategicOf(world);
  if ('refusal' in sk) return sk.refusal;
  const source = sourceOf(sk, req);
  if ('refusal' in source) return source.refusal;
  const takes = (m: KnowledgeMerc) => mapscreenCanPassItemToChar(sk.enemyInLoadedSector, source, holderOf(m));
  return hintData({ mercs: sk.strategic.mercs.filter(takes).map((m) => m.id) });
}

// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-21. See LICENSE (SFI-SCLA).
// @src src/game/Strategic/Map_Screen_Interface.cc SetUpMovingListsForSector (who the move box lists),
// @src CanMoveBoxSoldierMoveStrategically and CanCharacterMoveInStrategic (the reason a merc cannot be picked, for the
// @src squad and vehicle members the box does not list too: SelectSquadForMovement walks the whole squad).
// @src See docs/28 §7.6, docs/04 §6.28.

import { sameSector } from '../../content/strategic/sector-ids.ts';
import type { KnowledgeWorld } from '../knowledge/knowledge-world.ts';
import { Assignment } from '../strategic/forces/constants.ts';
import { movingListForSector } from '../strategic/forces/move-box.ts';
import { canCharacterMoveInStrategic } from '../strategic/forces/move-permission.ts';
import { sectorParam, strategicOf } from './strategic-check.ts';
import { type HintRequestBase, type HintResult, hintData, refuseHint } from './types.ts';

const OUT_OF_PLAY: ReadonlySet<number> = new Set([Assignment.IN_TRANSIT, Assignment.ASSIGNMENT_POW]);

export interface MoveBoxSoldier {
  readonly soldier: number;
  readonly listed: boolean;
  readonly refusal?: string;
}

export interface MoveBoxOptions {
  readonly soldiers: readonly MoveBoxSoldier[];
}

export interface MoveBoxOptionsRequest extends HintRequestBase {
  readonly sector?: unknown;
}

export function moveBoxOptions(world: KnowledgeWorld, req: MoveBoxOptionsRequest): HintResult<MoveBoxOptions> {
  const sk = strategicOf(world);
  if ('refusal' in sk) return sk.refusal;
  const sector = sectorParam(req.sector);
  if (!sector) return refuseHint('badSector', "sector must be like 'D13'");
  if (sector.z !== 0) return refuseHint('underground', 'there is no strategic movement below ground');
  const listed = new Set(movingListForSector(sk.ctx, sector).map((m) => m.id));
  const soldiers = sk.ctx.mercs
    .all()
    .filter((m) => !m.isVehicle && m.life > 0 && sameSector(m.sector, sector) && !OUT_OF_PLAY.has(m.assignment))
    .map((m) => {
      const refusal = canCharacterMoveInStrategic(sk.ctx, m, sk.loaded);
      return { soldier: m.id, listed: listed.has(m.id), ...(refusal ? { refusal } : {}) };
    });
  return hintData({ soldiers });
}

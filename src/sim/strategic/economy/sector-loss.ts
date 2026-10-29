// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-19. See LICENSE (SFI-SCLA).
// @src src/game/Strategic/Map_Screen_Interface.cc NotifyPlayerWhenEnemyTakesControlOfImportantSector (which notice the
// @src original shows; the reduced income of GetProjectedTotalDailyIncome).

import { type Sector, sectorId, sectorShortString } from '../../../content/strategic/sector-ids.ts';
import { isThisSectorASamSector, townIdOfSector } from '../map/control.ts';
import { Town } from './constants.ts';
import { maxDailyRemovalFromMine, mineIndexForSector } from './mine-status.ts';
import { predictIncomeFromPlayerMines, spokenToHeadMiner } from './mines.ts';
import type { EconomyContext } from './ports.ts';

export type ImportantSectorKind = 'sam' | 'mine' | 'town';

export interface ImportantSectorLoss {
  readonly kind: ImportantSectorKind;
  readonly dailyIncome?: number;
}

const NO_MINE = -1;

export function importantSectorLoss(ctx: EconomyContext, s: Sector): ImportantSectorLoss | null {
  if (s.z !== 0) return null;
  if (isThisSectorASamSector(ctx, s)) return { kind: 'sam' };
  const mine = mineIndexForSector(ctx, sectorId(s));
  if (mine !== NO_MINE && maxDailyRemovalFromMine(ctx, mine) > 0 && spokenToHeadMiner(ctx, mine))
    return { kind: 'mine', dailyIncome: predictIncomeFromPlayerMines(ctx) };
  const town = townIdOfSector(ctx, s);
  return town === Town.BLANK || town === Town.SAN_MONA ? null : { kind: 'town' };
}

export function notifyPlayerWhenEnemyTakesControlOfImportantSector(ctx: EconomyContext, s: Sector): void {
  const loss = importantSectorLoss(ctx, s);
  if (loss) ctx.events.push({ type: 'sectorLost', sector: sectorShortString(s), ...loss });
}

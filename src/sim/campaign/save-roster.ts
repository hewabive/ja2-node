import type { SaveGame } from '../../content/formats/savegame.ts';
import { createSavedSoldier } from '../tactical/save-import.ts';
import { NOBODY, Team } from '../tactical/soldier.ts';
import type { TacticalState } from '../tactical/state.ts';
import { createMercRecord } from './merc-record.ts';
import { type Roster, RosterMerc } from './roster.ts';

export function addSavedMercsToRoster(roster: Roster, save: SaveGame, tactical: TacticalState | null): void {
  for (const entry of save.soldiers) {
    const r = entry.soldier;
    if (r.team !== Team.OUR || r.active === 0) continue;
    const soldier = tactical?.soldiers[r.id] ?? createSavedSoldier(save, entry);
    soldier.insertionData = r.strategicInsertionData;
    roster.add(
      new RosterMerc(
        createMercRecord({
          soldier,
          profile: save.profiles[r.profile] ?? null,
          fractLife: r.fractLife,
          kind: r.whatKindOfMercAmI,
          statusFlags: r.statusFlags,
          sector: { ...r.sector },
          betweenSectors: r.betweenSectors,
          groupId: r.groupId,
          prevSectorId: r.prevSectorId,
          insertionCode: r.strategicInsertionCode,
          insertionDirection: r.insertionDirection,
          path: entry.mercPath,
          assignment: r.assignment,
          vehicleId: r.vehicleId,
          asleep: r.mercAsleep,
          contract: r.contract,
          quoteSaidFlags: r.quoteSaidFlags,
          quoteSaidExtFlags: r.quoteSaidExtFlags,
          corpseQuoteTolerance: r.corpseQuoteTolerance,
          remoteHolder: r.robotRemoteHolder === NOBODY ? null : r.robotRemoteHolder,
        }),
      ),
    );
  }
}

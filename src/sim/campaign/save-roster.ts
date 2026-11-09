import type { SaveGame } from '../../content/formats/savegame.ts';
import type { SavedSoldiers } from '../tactical/save-import.ts';
import { NOBODY, SoldierStatusFlags, Team } from '../tactical/soldier.ts';
import { createMercRecord } from './merc-record.ts';
import { type Roster, RosterMerc } from './roster.ts';

const SEATED_FLAGS = SoldierStatusFlags.DRIVER | SoldierStatusFlags.PASSENGER;

export function addSavedMercsToRoster(roster: Roster, save: SaveGame, soldiers: SavedSoldiers): void {
  for (const entry of save.soldiers) {
    const r = entry.soldier;
    if (r.team !== Team.OUR || r.active === 0) continue;
    const soldier = soldiers.get(r.id);
    if (!soldier) throw new Error(`soldier ${r.id} of the save was not created`);
    soldier.insertionData = r.strategicInsertionData;
    const merc = new RosterMerc(
      createMercRecord({
        soldier,
        profile: save.profiles[r.profile] ?? null,
        fractLife: r.fractLife,
        kind: r.whatKindOfMercAmI,
        statusFlags: r.statusFlags & ~SEATED_FLAGS,
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
    );
    roster.add(merc);
  }
}

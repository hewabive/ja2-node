import type { SaveGame } from '../../content/formats/savegame.ts';
import type { SavedSoldier } from '../../content/formats/savegame-soldier.ts';
import { createSavedSoldier } from '../tactical/save-import.ts';
import { NOBODY, SoldierStatusFlags, Team } from '../tactical/soldier.ts';
import type { TacticalState } from '../tactical/state.ts';
import { createMercRecord } from './merc-record.ts';
import { type Roster, RosterMerc } from './roster.ts';

const SEATED_FLAGS = SoldierStatusFlags.DRIVER | SoldierStatusFlags.PASSENGER;

function seatedOffTheLoadedMap(save: SaveGame, r: SavedSoldier, tactical: TacticalState | null): boolean {
  const world = save.tactical.worldSector;
  const inWorld = !r.betweenSectors && r.sector.x === world.x && r.sector.y === world.y && r.sector.z === world.z;
  return tactical !== null && (r.statusFlags & SEATED_FLAGS) !== 0 && inWorld && tactical.soldiers[r.id] === undefined;
}

export function addSavedMercsToRoster(roster: Roster, save: SaveGame, tactical: TacticalState | null): void {
  for (const entry of save.soldiers) {
    const r = entry.soldier;
    if (r.team !== Team.OUR || r.active === 0) continue;
    const soldier = tactical?.soldiers[r.id] ?? createSavedSoldier(save, entry);
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
    merc.offGridInSector = seatedOffTheLoadedMap(save, r, tactical);
    roster.add(merc);
  }
}

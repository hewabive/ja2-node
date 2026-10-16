// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-16. See LICENSE (SFI-SCLA).
// @src src/game/Strategic/Merc_Contract.cc LoadContractRenewalDataFromSaveGameFile; Strategic/Map_Screen_Interface.cc
// @src LoadLeaveItemList; Tactical/LoadSaveMercProfile.cc (uiTotalCostToDate). See docs/22 §0, §10.1.

import type { SaveGame } from '../../../content/formats/savegame.ts';
import { readContractRenewals, readLeaveItemList, readMercAccountStatus } from '../../../content/formats/savegame-contracts.ts';
import { objectFromRecord } from '../../items/object.ts';
import type { StrategicState } from '../../strategic/state.ts';
import { MAX_CONTRACT_RENEWALS } from './contract-state.ts';

export function importContracts(state: StrategicState, save: SaveGame, bytes: Uint8Array): void {
  const contracts = state.contracts;
  const renewals = readContractRenewals(bytes, save.sections);
  const list = contracts.renewal.list;
  list.splice(0, list.length, ...renewals.profiles.slice(0, Math.min(renewals.count, MAX_CONTRACT_RENEWALS)));
  readLeaveItemList(bytes, save.sections).forEach((saved, slot) => {
    const leave = contracts.leaveList[slot];
    if (!leave) return;
    leave.items = saved.items ? saved.items.map(objectFromRecord) : null;
    leave.owner = saved.owner;
  });
  state.laptop.merc.accountStatus = readMercAccountStatus(bytes, save.sections);
  save.profiles.forEach((p, id) => {
    if (p?.totalCostToDate) state.finances.profileCostToDate.set(id, p.totalCostToDate);
  });
}

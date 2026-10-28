// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-16. See LICENSE (SFI-SCLA).
// @src src/game/Tactical/Arms_Dealer_Init.cc LoadArmsDealerInventoryFromSavedGameFile.

import type { SavedDealer, SavedDealerSpecial } from '../../../../content/formats/savegame-merchants.ts';
import { type DealerSpecialItem, MAXITEMS, type MerchantState, resetMerchantState } from './state.ts';

function special(s: SavedDealerSpecial): DealerSpecialItem {
  return {
    info: {
      attachments: [...s.attachments],
      condition: s.condition,
      imprint: s.imprint,
      attachmentStatus: [...s.attachmentStatus],
    },
    repairDoneTime: s.repairDoneTime,
    active: s.active,
    owner: s.owner,
  };
}

export function importMerchants(state: MerchantState, saved: readonly SavedDealer[]): void {
  resetMerchantState(state, saved.length);
  saved.forEach((d, id) => {
    const target = state.dealers[id];
    if (!target) return;
    Object.assign(target.status, {
      cash: d.cash,
      flags: d.flags,
      outOfBusiness: d.outOfBusiness,
      repairDelayUsed: d.repairDelayUsed,
      unusedKnowsPlayer: d.unusedKnowsPlayer,
      lastSkiMinute: d.lastSkiMinute,
    });
    for (let item = 0; item < MAXITEMS; item++) {
      const h = d.headers[item];
      const t = target.headers[item];
      if (!h || !t) continue;
      t.total = h.total;
      t.perfect = h.perfect;
      t.strayAmmo = h.strayAmmo;
      t.orderArrivalDay = h.orderArrivalDay;
      t.qtyOnOrder = h.qtyOnOrder;
      t.previouslyEligible = h.previouslyEligible;
      t.specials.length = 0;
      for (const s of h.specials) t.specials.push(special(s));
    }
  });
}

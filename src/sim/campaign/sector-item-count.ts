// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-11-14. See LICENSE (SFI-SCLA).
// @src src/game/Strategic/Map_Screen_Interface_Map_Inventory.cc IsMapScreenWorldItemVisibleInMapInventory;
// @src Tactical/Tactical_Save.cc SynchronizeItemTempFileVisbleItemsToSectorInfoVisbleItems (every write of a sector's item
// @src file recounts the objects the map inventory shows), GetNumberOfVisibleWorldItemsFromSectorStructureForSector and
// @src UpdateLoadedSectorsItemInventory (the loaded sector is counted from its world items).

import type { ItemTable } from '../../content/items/items.ts';
import { type Sector, sameSector } from '../../content/strategic/sector-ids.ts';
import type { ItemObject } from '../items/object.ts';
import { type StrategicMapState, setVisibleItemCount, storedVisibleItemCount } from '../strategic/map/sectors.ts';
import { Visibility } from '../tactical/world-items.ts';
import type { CampaignSim } from './campaign-sim.ts';
import type { DiffWorldItem } from './sector-diff.ts';

const HIDDEN_IN_MAP_INVENTORY = ['SWITCH', 'ACTION_ITEM'];

interface ShownItem {
  readonly object: ItemObject;
  readonly visible: number;
}

function hiddenInMapInventory(items: ItemTable, item: number): boolean {
  return HIDDEN_IN_MAP_INVENTORY.some((name) => items.byName.get(name)?.index === item);
}

export function isMapScreenWorldItemVisibleInMapInventory(items: ItemTable, wi: ShownItem): boolean {
  return wi.visible === Visibility.VISIBLE && !hiddenInMapInventory(items, wi.object.item) && wi.object.trap <= 0;
}

function shownObjects(items: ItemTable, list: Iterable<ShownItem>): number {
  let n = 0;
  for (const wi of list) if (isMapScreenWorldItemVisibleInMapInventory(items, wi)) n += wi.object.count;
  return n;
}

function existing(records: readonly DiffWorldItem[]): DiffWorldItem[] {
  return records.filter((wi) => wi.exists);
}

export function synchronizeVisibleItemCount(
  map: StrategicMapState,
  items: ItemTable,
  sector: Sector,
  records: readonly DiffWorldItem[],
): void {
  setVisibleItemCount(map, sector, shownObjects(items, existing(records)));
}

export function visibleItemsInSector(campaign: CampaignSim, sector: Sector): number {
  const world = campaign.state.worldSector;
  const t = campaign.tactical?.state;
  if (t && world && sameSector(world, sector)) return shownObjects(t.content.items, t.worldItems);
  return storedVisibleItemCount(campaign.state.map, sector);
}

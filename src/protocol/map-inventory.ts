import type { StashEntryView } from '../sim/campaign/map-inventory.ts';
import type { InventoryItemView } from './view.ts';

export type { StashEntryView };

export interface InventoryQueryMerc {
  readonly id: number;
  readonly name: string;
  readonly accessible: boolean;
  readonly betweenSectors: boolean;
  readonly inventory: readonly InventoryItemView[];
}

export interface InventoryQuery {
  readonly sector: string;
  readonly z: number;
  readonly usable: boolean;
  readonly refusal?: string;
  readonly stash: readonly StashEntryView[];
  readonly mercs: readonly InventoryQueryMerc[];
}

// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-21. See LICENSE (SFI-SCLA).
// @src src/game/Strategic/Map_Screen_Interface_Map_Inventory.cc CreateMapInventoryPoolSlots (the pool mask and the
// @src slot regions with their fast help), CreateMapInventoryButtons, CreateMapInventoryPoolDoneButton,
// @src HandleButtonStatesWhileMapInventoryActive (no page back on the first page, none forward on the last, no Done with
// @src an item in the cursor); src/game/Strategic/MapScreen.cc CreateDestroyMapInvButton (InitInvSlotInterface with
// @src MAPInvClickCallbackPrimary, MAPInvClickCallbackSecondary and MAPInvMoveCallback, gMPanelRegion over the inventory),
// @src CreateDestroyTrashCanRegion (the trash can and the Done button), BltCharInvPanel (the armour, weight and camouflage
// @src values); src/game/Tactical/Interface_Items.cc InitMapKeyRingInterface. See docs/28 §7.8.

import type { ControllerContract, LayoutController } from '../../layout/controller.ts';
import { getPath } from '../../layout/controller.ts';

export const MAP_INVENTORY = 'mapInventory';

export const MAP_INVENTORY_CONTRACT: ControllerContract = {
  id: MAP_INVENTORY,
  actions: {
    mercSlotPrimary: { args: 1 },
    mercSlotSecondary: { args: 1 },
    mercSlotHover: { args: 2 },
    mercDone: {},
    keyRing: {},
    trash: {},
    poolSlotPrimary: { args: 1 },
    poolSlotSecondary: { args: 1 },
    poolPrev: {},
    poolNext: {},
    poolDone: {},
  },
  bindings: {
    poolOpen: 'boolean',
    mercOpen: 'boolean',
    mercPanelShown: 'boolean',
    descriptionOpen: 'boolean',
    mercSlots: 'list',
    poolSlots: 'list',
    location: 'string',
    itemCount: 'string',
    page: 'string',
    poolPrevEnabled: 'boolean',
    poolNextEnabled: 'boolean',
    poolDoneEnabled: 'boolean',
    armour: 'string',
    weight: 'string',
    camo: 'string',
  },
};

export interface SlotTooltip {
  readonly tooltip: string;
}

export interface MapInventoryModel {
  poolOpen: boolean;
  mercOpen: boolean;
  mercPanelShown: boolean;
  descriptionOpen: boolean;
  mercSlots: readonly SlotTooltip[];
  poolSlots: readonly SlotTooltip[];
  location: string;
  itemCount: string;
  page: string;
  poolPrevEnabled: boolean;
  poolNextEnabled: boolean;
  poolDoneEnabled: boolean;
  armour: string;
  weight: string;
  camo: string;
}

export function emptyMapInventoryModel(): MapInventoryModel {
  return {
    poolOpen: false,
    mercOpen: false,
    mercPanelShown: false,
    descriptionOpen: false,
    mercSlots: [],
    poolSlots: [],
    location: '',
    itemCount: '',
    page: '',
    poolPrevEnabled: false,
    poolNextEnabled: false,
    poolDoneEnabled: true,
    armour: '',
    weight: '',
    camo: '',
  };
}

export type MapInventoryAction = keyof typeof MAP_INVENTORY_CONTRACT.actions;

export class MapInventoryController implements LayoutController {
  readonly contract = MAP_INVENTORY_CONTRACT;
  readonly model: MapInventoryModel = emptyMapInventoryModel();
  readonly #handle: (action: MapInventoryAction, args: readonly number[]) => void;

  constructor(handle: (action: MapInventoryAction, args: readonly number[]) => void) {
    this.#handle = handle;
  }

  get(path: string): unknown {
    return getPath(this.model, path);
  }

  invoke(action: string, args: readonly number[]): void {
    if (action in MAP_INVENTORY_CONTRACT.actions) this.#handle(action as MapInventoryAction, args);
  }
}

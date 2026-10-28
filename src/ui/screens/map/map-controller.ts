// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-21. See LICENSE (SFI-SCLA).
// @src src/game/Strategic/MapScreen.cc (the buttons, regions and keys the map screen layout binds), GetMapKeyboardInput.

import type { ControllerContract, LayoutController } from '../../layout/controller.ts';
import { getPath } from '../../layout/controller.ts';

export const MAP_SCREEN = 'mapScreen';

export const MAP_SCREEN_CONTRACT: ControllerContract = {
  id: MAP_SCREEN,
  actions: {
    sort: { args: 1 },
    contract: {},
    prevMerc: {},
    nextMerc: {},
    filter: { args: 1 },
    level: { args: 1 },
    laptop: {},
    tactical: {},
    options: {},
    compressCheck: {},
    compressMore: {},
    compressLess: {},
    explainCompression: {},
    toggleCompression: {},
    togglePause: {},
    messageUp: { args: 1 },
    messageDown: { args: 1 },
    messageHome: {},
    messageEnd: {},
    escape: {},
    levelUp: {},
    levelDown: {},
    toggleInventory: {},
    stopSpeech: {},
    keyCompressMore: {},
    keyCompressLess: {},
    space: {},
    keyA: {},
    keyE: {},
    keyR: {},
    help: {},
    version: {},
    toggleSectorInventory: {},
    saveGame: {},
    loadGame: {},
    quickSave: {},
    quickLoad: {},
    exitGame: {},
    assignmentMenu: {},
  },
  bindings: {
    inventoryOpen: 'boolean',
    sectorInventoryOpen: 'boolean',
    levelMarkerY: 'number',
    mechanical: 'boolean',
    contractEnabled: 'boolean',
    prevNextEnabled: 'boolean',
    townsOn: 'boolean',
    minesOn: 'boolean',
    teamsOn: 'boolean',
    militiaOn: 'boolean',
    airspaceOn: 'boolean',
    itemsOn: 'boolean',
    laptopEnabled: 'boolean',
    tacticalEnabled: 'boolean',
    optionsEnabled: 'boolean',
    newMailShown: 'boolean',
    compressMoreEnabled: 'boolean',
    compressLessEnabled: 'boolean',
    compressionMasked: 'boolean',
    messageUpEnabled: 'boolean',
    messageDownEnabled: 'boolean',
    pauseHelp: 'string',
    balance: 'number',
    income: 'number',
    sectorName: 'string',
    levelHelp: 'list',
  },
};

export interface MapScreenModel {
  inventoryOpen: boolean;
  sectorInventoryOpen: boolean;
  levelMarkerY: number;
  mechanical: boolean;
  contractEnabled: boolean;
  prevNextEnabled: boolean;
  townsOn: boolean;
  minesOn: boolean;
  teamsOn: boolean;
  militiaOn: boolean;
  airspaceOn: boolean;
  itemsOn: boolean;
  laptopEnabled: boolean;
  tacticalEnabled: boolean;
  optionsEnabled: boolean;
  newMailShown: boolean;
  compressMoreEnabled: boolean;
  compressLessEnabled: boolean;
  compressionMasked: boolean;
  messageUpEnabled: boolean;
  messageDownEnabled: boolean;
  pauseHelp: string;
  balance: number;
  income: number;
  sectorName: string;
  levelHelp: readonly string[];
}

export function emptyMapScreenModel(): MapScreenModel {
  return {
    inventoryOpen: false,
    sectorInventoryOpen: false,
    levelMarkerY: 0,
    mechanical: false,
    contractEnabled: false,
    prevNextEnabled: false,
    townsOn: true,
    minesOn: false,
    teamsOn: true,
    militiaOn: false,
    airspaceOn: false,
    itemsOn: false,
    laptopEnabled: false,
    tacticalEnabled: false,
    optionsEnabled: true,
    newMailShown: false,
    compressMoreEnabled: false,
    compressLessEnabled: false,
    compressionMasked: false,
    messageUpEnabled: false,
    messageDownEnabled: false,
    pauseHelp: '',
    balance: 0,
    income: 0,
    sectorName: '',
    levelHelp: [],
  };
}

export type MapAction = keyof typeof MAP_SCREEN_CONTRACT.actions;

export class MapScreenController implements LayoutController {
  readonly contract = MAP_SCREEN_CONTRACT;
  model: MapScreenModel = emptyMapScreenModel();
  readonly #handle: (action: MapAction, args: readonly number[]) => void;

  constructor(handle: (action: MapAction, args: readonly number[]) => void) {
    this.#handle = handle;
  }

  get(path: string): unknown {
    return getPath(this.model, path);
  }

  invoke(action: string, args: readonly number[]): void {
    if (action in MAP_SCREEN_CONTRACT.actions) this.#handle(action as MapAction, args);
  }
}

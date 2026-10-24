// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-24. See LICENSE (SFI-SCLA).
// @src src/game/Laptop/LaptopSave.h iCurrentHistoryPage; Laptop/Files.cc iHighLightFileLine, giFilesPage;
// @src Laptop/Florist_Gallery.cc guiCurrentlySelectedFlower, gubCurFlowerIndex; Laptop/Florist_Cards.cc
// @src gbCurrentlySelectedCard; Laptop/Florist_Order_Form.cc the check boxes, gubCurrentlySelectedFlowerLocation,
// @src gsSentimentTextField, gsNameTextField; Laptop/Insurance_Contract.cc gusCurrentInsuranceMercIndex. See docs/28 §9.3,
// @src §9.8.

export const NO_FILE = -1;
export const NO_CARD = -1;

export interface FloristOrderMemory {
  nextDay: boolean;
  crushed: boolean;
  blackRoses: boolean;
  wilted: boolean;
  fruitCake: boolean;
  destination: number;
  sentiment: string;
  name: string;
}

export interface FloristMemory {
  flower: number;
  galleryIndex: number;
  card: number;
  readonly order: FloristOrderMemory;
}

export interface PagesMemory {
  historyPage: number;
  fileSelected: number;
  filePage: number;
  insuranceMercIndex: number;
  readonly florist: FloristMemory;
}

export function floristOrderMemory(): FloristOrderMemory {
  return {
    nextDay: false,
    crushed: false,
    blackRoses: false,
    wilted: false,
    fruitCake: false,
    destination: 0,
    sentiment: '',
    name: '',
  };
}

export function resetFloristOrder(order: FloristOrderMemory): void {
  Object.assign(order, floristOrderMemory());
}

export function pagesMemory(): PagesMemory {
  return {
    historyPage: 1,
    fileSelected: NO_FILE,
    filePage: 0,
    insuranceMercIndex: 0,
    florist: { flower: 0, galleryIndex: 0, card: NO_CARD, order: floristOrderMemory() },
  };
}

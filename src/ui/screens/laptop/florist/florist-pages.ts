// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-24. See LICENSE (SFI-SCLA).
// @src src/game/Laptop/Florist.cc, src/game/Laptop/Florist_Cards.cc, src/game/Laptop/Florist_Gallery.cc, src/game/Laptop/Florist_Order_Form.cc. See docs/28 §9.

import { type ControllerContract, ViewModelController } from '../../../layout/controller.ts';
import type { LaptopContext, LaptopPage } from '../laptop-page.ts';

export const FLORIST_CHROME_LAYOUT = 'florist-chrome';
export const FLORIST_HOME_LAYOUT = 'florist-home';
export const FLORIST_GALLERY_LAYOUT = 'florist-gallery';
export const FLORIST_ORDER_LAYOUT = 'florist-order';
export const FLORIST_CARDS_LAYOUT = 'florist-cards';

export const FLORIST_CHROME_CONTRACT: ControllerContract = { id: 'floristChrome', actions: {}, bindings: {} };
export const FLORIST_HOME_CONTRACT: ControllerContract = { id: 'floristHome', actions: {}, bindings: {} };
export const FLORIST_GALLERY_CONTRACT: ControllerContract = { id: 'floristGallery', actions: {}, bindings: {} };
export const FLORIST_ORDER_CONTRACT: ControllerContract = { id: 'floristOrder', actions: {}, bindings: {} };
export const FLORIST_CARDS_CONTRACT: ControllerContract = { id: 'floristCards', actions: {}, bindings: {} };

export function floristHomePage(_context: LaptopContext): LaptopPage {
  return {
    layouts: [
      { name: FLORIST_CHROME_LAYOUT, controller: new ViewModelController(FLORIST_CHROME_CONTRACT, {}) },
      { name: FLORIST_HOME_LAYOUT, controller: new ViewModelController(FLORIST_HOME_CONTRACT, {}) },
    ],
    update: () => undefined,
  };
}

export function floristGalleryPage(_context: LaptopContext): LaptopPage {
  return {
    layouts: [
      { name: FLORIST_CHROME_LAYOUT, controller: new ViewModelController(FLORIST_CHROME_CONTRACT, {}) },
      { name: FLORIST_GALLERY_LAYOUT, controller: new ViewModelController(FLORIST_GALLERY_CONTRACT, {}) },
    ],
    update: () => undefined,
  };
}

export function floristOrderPage(_context: LaptopContext): LaptopPage {
  return {
    layouts: [
      { name: FLORIST_CHROME_LAYOUT, controller: new ViewModelController(FLORIST_CHROME_CONTRACT, {}) },
      { name: FLORIST_ORDER_LAYOUT, controller: new ViewModelController(FLORIST_ORDER_CONTRACT, {}) },
    ],
    update: () => undefined,
  };
}

export function floristCardsPage(_context: LaptopContext): LaptopPage {
  return {
    layouts: [
      { name: FLORIST_CHROME_LAYOUT, controller: new ViewModelController(FLORIST_CHROME_CONTRACT, {}) },
      { name: FLORIST_CARDS_LAYOUT, controller: new ViewModelController(FLORIST_CARDS_CONTRACT, {}) },
    ],
    update: () => undefined,
  };
}

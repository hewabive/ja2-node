// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-24. See LICENSE (SFI-SCLA).
// @src src/game/Laptop/Funeral.cc. See docs/28 §9.

import { type ControllerContract, ViewModelController } from '../../../layout/controller.ts';
import type { LaptopContext, LaptopPage } from '../laptop-page.ts';

export const FUNERAL_LAYOUT = 'funeral';

export const FUNERAL_CONTRACT: ControllerContract = { id: 'funeral', actions: {}, bindings: {} };

export function funeralPage(_context: LaptopContext): LaptopPage {
  return { layouts: [{ name: FUNERAL_LAYOUT, controller: new ViewModelController(FUNERAL_CONTRACT, {}) }], update: () => undefined };
}

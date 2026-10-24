// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-24. See LICENSE (SFI-SCLA).
// @src src/game/Laptop/History.cc. See docs/28 §9.

import { type ControllerContract, ViewModelController } from '../../../layout/controller.ts';
import type { LaptopContext, LaptopPage } from '../laptop-page.ts';

export const HISTORY_LAYOUT = 'laptop-history';

export const HISTORY_CONTRACT: ControllerContract = { id: 'laptopHistory', actions: {}, bindings: {} };

export function historyPage(_context: LaptopContext): LaptopPage {
  return { layouts: [{ name: HISTORY_LAYOUT, controller: new ViewModelController(HISTORY_CONTRACT, {}) }], update: () => undefined };
}

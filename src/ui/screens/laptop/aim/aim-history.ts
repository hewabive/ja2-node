// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-24. See LICENSE (SFI-SCLA).
// @src src/game/Laptop/AIMHistory.cc. See docs/28 §9.

import { type ControllerContract, ViewModelController } from '../../../layout/controller.ts';
import type { LaptopContext, LaptopPage } from '../laptop-page.ts';

export const AIM_HISTORY_LAYOUT = 'aim-history';

export const AIM_HISTORY_CONTRACT: ControllerContract = { id: 'aimHistory', actions: {}, bindings: {} };

export function aimHistoryPage(_context: LaptopContext): LaptopPage {
  return {
    layouts: [{ name: AIM_HISTORY_LAYOUT, controller: new ViewModelController(AIM_HISTORY_CONTRACT, {}) }],
    update: () => undefined,
  };
}

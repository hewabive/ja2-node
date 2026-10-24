// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-24. See LICENSE (SFI-SCLA).
// @src src/game/Laptop/Personnel.cc. See docs/28 §9.

import { type ControllerContract, ViewModelController } from '../../../layout/controller.ts';
import type { LaptopContext, LaptopPage } from '../laptop-page.ts';

export const PERSONNEL_LAYOUT = 'laptop-personnel';

export const PERSONNEL_CONTRACT: ControllerContract = { id: 'laptopPersonnel', actions: {}, bindings: {} };

export function personnelPage(_context: LaptopContext): LaptopPage {
  return { layouts: [{ name: PERSONNEL_LAYOUT, controller: new ViewModelController(PERSONNEL_CONTRACT, {}) }], update: () => undefined };
}

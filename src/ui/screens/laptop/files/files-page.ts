// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-24. See LICENSE (SFI-SCLA).
// @src src/game/Laptop/Files.cc. See docs/28 §9.

import { type ControllerContract, ViewModelController } from '../../../layout/controller.ts';
import type { LaptopContext, LaptopPage } from '../laptop-page.ts';

export const FILES_LAYOUT = 'laptop-files';

export const FILES_CONTRACT: ControllerContract = { id: 'laptopFiles', actions: {}, bindings: {} };

export function filesPage(_context: LaptopContext): LaptopPage {
  return { layouts: [{ name: FILES_LAYOUT, controller: new ViewModelController(FILES_CONTRACT, {}) }], update: () => undefined };
}

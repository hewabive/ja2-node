// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-24. See LICENSE (SFI-SCLA).
// @src src/game/Laptop/AIMArchives.cc. See docs/28 §9.

import { type ControllerContract, ViewModelController } from '../../../layout/controller.ts';
import type { LaptopContext, LaptopPage } from '../laptop-page.ts';

export const AIM_ARCHIVES_LAYOUT = 'aim-archives';

export const AIM_ARCHIVES_CONTRACT: ControllerContract = { id: 'aimArchives', actions: {}, bindings: {} };

export function aimArchivesPage(_context: LaptopContext): LaptopPage {
  return {
    layouts: [{ name: AIM_ARCHIVES_LAYOUT, controller: new ViewModelController(AIM_ARCHIVES_CONTRACT, {}) }],
    update: () => undefined,
  };
}

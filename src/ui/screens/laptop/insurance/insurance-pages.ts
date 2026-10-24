// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-24. See LICENSE (SFI-SCLA).
// @src src/game/Laptop/Insurance.cc, src/game/Laptop/Insurance_Comments.cc, src/game/Laptop/Insurance_Contract.cc, src/game/Laptop/Insurance_Info.cc. See docs/28 §9.

import { type ControllerContract, ViewModelController } from '../../../layout/controller.ts';
import type { LaptopContext, LaptopPage } from '../laptop-page.ts';

export const INSURANCE_CHROME_LAYOUT = 'insurance-chrome';
export const INSURANCE_HOME_LAYOUT = 'insurance-home';
export const INSURANCE_INFO_LAYOUT = 'insurance-info';
export const INSURANCE_CONTRACT_LAYOUT = 'insurance-contract';
export const INSURANCE_COMMENTS_LAYOUT = 'insurance-comments';

export const INSURANCE_CHROME_CONTRACT: ControllerContract = { id: 'insuranceChrome', actions: {}, bindings: {} };
export const INSURANCE_HOME_CONTRACT: ControllerContract = { id: 'insuranceHome', actions: {}, bindings: {} };
export const INSURANCE_INFO_CONTRACT: ControllerContract = { id: 'insuranceInfo', actions: {}, bindings: {} };
export const INSURANCE_CONTRACT_CONTRACT: ControllerContract = { id: 'insuranceContract', actions: {}, bindings: {} };
export const INSURANCE_COMMENTS_CONTRACT: ControllerContract = { id: 'insuranceComments', actions: {}, bindings: {} };

export function insuranceHomePage(_context: LaptopContext): LaptopPage {
  return {
    layouts: [
      { name: INSURANCE_CHROME_LAYOUT, controller: new ViewModelController(INSURANCE_CHROME_CONTRACT, {}) },
      { name: INSURANCE_HOME_LAYOUT, controller: new ViewModelController(INSURANCE_HOME_CONTRACT, {}) },
    ],
    update: () => undefined,
  };
}

export function insuranceInfoPage(_context: LaptopContext): LaptopPage {
  return {
    layouts: [
      { name: INSURANCE_CHROME_LAYOUT, controller: new ViewModelController(INSURANCE_CHROME_CONTRACT, {}) },
      { name: INSURANCE_INFO_LAYOUT, controller: new ViewModelController(INSURANCE_INFO_CONTRACT, {}) },
    ],
    update: () => undefined,
  };
}

export function insuranceContractPage(_context: LaptopContext): LaptopPage {
  return {
    layouts: [
      { name: INSURANCE_CHROME_LAYOUT, controller: new ViewModelController(INSURANCE_CHROME_CONTRACT, {}) },
      { name: INSURANCE_CONTRACT_LAYOUT, controller: new ViewModelController(INSURANCE_CONTRACT_CONTRACT, {}) },
    ],
    update: () => undefined,
  };
}

export function insuranceCommentsPage(_context: LaptopContext): LaptopPage {
  return {
    layouts: [
      { name: INSURANCE_CHROME_LAYOUT, controller: new ViewModelController(INSURANCE_CHROME_CONTRACT, {}) },
      { name: INSURANCE_COMMENTS_LAYOUT, controller: new ViewModelController(INSURANCE_COMMENTS_CONTRACT, {}) },
    ],
    update: () => undefined,
  };
}

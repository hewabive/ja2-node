// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-11-09. See LICENSE (SFI-SCLA).
// @src src/game/Laptop/IMP_SkillTraits.cc EnterIMPSkillTrait, BtnIMPSkillTraitAnswerCallback (on the press, after the
// @src toggle has flipped the button), HandleSkillTraitButtonStates (every button set by the picks, only when a press
// @src changed them), ShouldTraitBeSkipped (no Martial Arts for a woman), BtnIMPSkillTraitFinishCallback (on the press).

import type { ControllerContract } from '../../../layout/controller.ts';
import { ViewModelController } from '../../../layout/controller.ts';
import type { LaptopPage } from '../laptop-page.ts';
import { Specialty } from './imp-draft.ts';
import type { ImpContext } from './imp-site.ts';

export const IMP_SKILL_TRAITS_LAYOUT = 'imp-skill-traits';

const FIRST_RIGHT_COLUMN_SPECIALTY = 7;
const RIGHT_COLUMN_SPECIALTIES = Specialty.NONE - FIRST_RIGHT_COLUMN_SPECIALTY;

export const IMP_SKILL_TRAITS_CONTRACT: ControllerContract = {
  id: 'impSkillTraits',
  actions: { pick: { args: 1 }, finish: {} },
  bindings: { specialties: 'list', rightColumnCount: 'number' },
};

export function skillTraitsPage(imp: ImpContext): LaptopPage {
  const { draft } = imp;
  draft.enterSpecialties();
  const pressed = [...draft.specialties];
  const model: Record<string, unknown> = {};
  const refresh = () => {
    model.specialties = draft.specialties.map((on, i) => ({ on, pressed: pressed[i] === true }));
    model.rightColumnCount = draft.male ? RIGHT_COLUMN_SPECIALTIES : RIGHT_COLUMN_SPECIALTIES - 1;
  };
  const controller = new ViewModelController(IMP_SKILL_TRAITS_CONTRACT, model, {
    pick: ([specialty]) => {
      if (specialty === undefined) return;
      pressed[specialty] = !pressed[specialty];
      if (draft.pickSpecialty(specialty)) pressed.splice(0, pressed.length, ...draft.specialties);
      refresh();
    },
    finish: () => draft.specialtiesFinished(),
  });
  refresh();
  return { layouts: [{ name: IMP_SKILL_TRAITS_LAYOUT, controller }], update: refresh };
}

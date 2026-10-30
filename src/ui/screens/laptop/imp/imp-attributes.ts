// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-24. See LICENSE (SFI-SCLA).
// @src src/game/Laptop/IMP_Attribute_Selection.cc EnterIMPAttributeSelection, ExitIMPAttributeSelection,
// @src HandleIMPAttributeSelection (a held drag past either end of the bar steps once per frame, inside it follows the
// @src mouse; the zero warning box), RenderAttributeBoxes (the slider at the value, the value 13, 3 into it), the arrow
// @src callbacks (press and repeat), SliderRegionButtonCallback (a press on the slider starts a drag, a click elsewhere
// @src jumps; the static last attribute and last x survive between drags), MouseXPosToSkillValue, DrawBonusPointsRemaining,
// @src StatAtZeroBoxCallBack; IMP_Attribute_Finish.cc the yes and no buttons.

import { idiv } from '../../../../core/int.ts';
import type { ImpAttributeName } from '../../../../protocol/view.ts';
import { MouseButtonMask } from '../../../input/mouse.ts';
import type { ControllerContract } from '../../../layout/controller.ts';
import { ViewModelController } from '../../../layout/controller.ts';
import { MessageBoxFlag, MessageBoxReturn } from '../../../widgets/message-box.ts';
import type { LaptopPage } from '../laptop-page.ts';
import { DEFAULT_ATTRIBUTE_RULES, type ImpDraft, skillValueAt, sliderOffset } from './imp-draft.ts';
import type { ImpContext } from './imp-site.ts';

export const IMP_ATTRIBUTES_LAYOUT = 'imp-attributes';
export const IMP_ATTRIBUTE_FINISH_LAYOUT = 'imp-attribute-finish';

const SKILL_AT_ZERO_WARNING = 'pSkillAtZeroWarning';
const NO_ATTRIBUTE = -1;
const NO_X = -1;
const VALUE_OFFSET_X = 13;

export const IMP_ATTRIBUTES_CONTRACT: ControllerContract = {
  id: 'impAttributes',
  actions: {
    finish: {},
    decrease: { args: 1 },
    increase: { args: 1 },
    sliderDown: { args: 1 },
    sliderRepeat: { args: 1 },
    sliderUp: { args: 1 },
  },
  bindings: { rows: 'list', bonus: 'string', editing: 'boolean', review: 'boolean' },
};

export const IMP_ATTRIBUTE_FINISH_CONTRACT: ControllerContract = { id: 'impAttributeFinish', actions: { yes: {}, no: {} }, bindings: {} };

export interface SliderGeometry {
  readonly startX: number;
  readonly barWidth: number;
  readonly thumbWidth: number;
  readonly pixelUnit: number;
}

export class AttributeSliders {
  readonly #draft: ImpDraft;
  readonly #geometry: SliderGeometry;
  slideActive = true;
  scrollBox: number = NO_ATTRIBUTE;
  #attribute: number = NO_ATTRIBUTE;
  #oldX: number = NO_X;

  constructor(draft: ImpDraft, geometry: SliderGeometry) {
    this.#draft = draft;
    this.#geometry = geometry;
  }

  #name(row: number): ImpAttributeName | null {
    return this.#draft.rules.order[row] ?? null;
  }

  #valueAt(x: number): number {
    return skillValueAt(x - this.#geometry.startX, this.#draft.rules, this.#geometry.pixelUnit);
  }

  #blocked(row: number): boolean {
    return this.scrollBox !== NO_ATTRIBUTE && this.scrollBox !== row;
  }

  down(row: number, x: number): void {
    const name = this.#name(row);
    if (this.#blocked(row) || !name) return;
    this.#attribute = row;
    const value = this.#draft.current[name];
    const thumbX = Math.max(
      0,
      idiv((value - this.#draft.rules.min) * this.#geometry.pixelUnit, this.#draft.rules.max - this.#draft.rules.min) +
        this.#geometry.startX,
    );
    this.slideActive = x > thumbX && x < thumbX + this.#geometry.thumbWidth;
  }

  repeat(row: number, x: number): void {
    const name = this.#name(row);
    if (this.#blocked(row) || !name || !this.slideActive) return;
    if (row !== this.#attribute) {
      this.#attribute = row;
      this.#oldX = NO_X;
      return;
    }
    this.scrollBox = row;
    if (this.#oldX === NO_X) {
      this.#oldX = x;
      return;
    }
    if (x === this.#oldX) return;
    this.#draft.moveToward(name, this.#valueAt(x));
    this.#oldX = x;
  }

  up(row: number, x: number): void {
    const name = this.#name(row);
    if (this.#blocked(row) || !name) return;
    if (this.slideActive) {
      this.slideActive = false;
      return;
    }
    this.#attribute = row;
    this.#draft.jumpTo(name, this.#valueAt(x));
  }

  frame(leftDown: boolean, x: number): void {
    if (this.#draft.reviewStats) return;
    const name = this.#name(this.scrollBox);
    if (!leftDown || !name) {
      this.scrollBox = NO_ATTRIBUTE;
      return;
    }
    if (x < this.#geometry.startX) this.#draft.decrement(name);
    else if (x > this.#geometry.startX + this.#geometry.barWidth) this.#draft.increment(name);
    else this.#draft.moveToward(name, this.#valueAt(x));
  }
}

export function attributesPage(imp: ImpContext): LaptopPage {
  const { draft, context } = imp;
  draft.enterAttributes(imp.site()?.attributes ?? DEFAULT_ATTRIBUTE_RULES);
  const constant = (name: string) => context.constant(IMP_ATTRIBUTES_LAYOUT, name);
  const pixelUnit = constant('BASE_SKILL_PIXEL_UNIT_SIZE');
  const slideStartX = constant('LAPTOP_SCREEN_UL_X') + constant('SKILL_SLIDE_START_X');
  const sliders = new AttributeSliders(draft, {
    startX: slideStartX,
    barWidth: constant('BAR_WIDTH'),
    thumbWidth: constant('SLIDER_BAR_WIDTH'),
    pixelUnit,
  });
  const regions = context.services.regions;
  const mouseX = () => regions.mouseX - context.services.geometry().stdX;
  const model: Record<string, unknown> = {};
  let warning = false;

  const warnAtZero = () => {
    if (warning) return;
    const name = draft.takeZeroWarning();
    if (!name) return;
    warning = true;
    imp.messageBox(context.string(SKILL_AT_ZERO_WARNING, 0), MessageBoxFlag.YESNO, (result) => {
      warning = false;
      if (result === MessageBoxReturn.NO) draft.increment(name);
    });
  };

  const refresh = () => {
    sliders.frame(regions.isButtonDown(MouseButtonMask.LEFT), mouseX());
    warnAtZero();
    model.rows = draft.rules.order.map((name) => {
      const x = slideStartX + sliderOffset(draft.current[name], draft.rules, pixelUnit);
      return { value: String(draft.current[name]), x, textX: x + VALUE_OFFSET_X };
    });
    model.bonus = String(draft.bonusPoints);
    model.review = draft.reviewStats;
    model.editing = !draft.reviewStats;
  };

  const step = (row: number | undefined, change: (name: ImpAttributeName) => void) => {
    const name = row === undefined ? undefined : draft.rules.order[row];
    if (name) change(name);
  };
  const controller = new ViewModelController(IMP_ATTRIBUTES_CONTRACT, model, {
    finish: () => draft.attributesFinished(),
    decrease: ([row]) => step(row, (name) => draft.decrement(name)),
    increase: ([row]) => step(row, (name) => draft.increment(name)),
    sliderDown: ([row]) => {
      if (row !== undefined) sliders.down(row, mouseX());
    },
    sliderRepeat: ([row]) => {
      if (row !== undefined) sliders.repeat(row, mouseX());
    },
    sliderUp: ([row]) => {
      if (row !== undefined) sliders.up(row, mouseX());
    },
  });
  refresh();
  return { layouts: [{ name: IMP_ATTRIBUTES_LAYOUT, controller }], update: refresh, dispose: () => draft.exitAttributes() };
}

export function attributeFinishPage(imp: ImpContext): LaptopPage {
  const { draft } = imp;
  const controller = new ViewModelController(
    IMP_ATTRIBUTE_FINISH_CONTRACT,
    {},
    { yes: () => draft.attributesAccepted(), no: () => draft.attributesRejected() },
  );
  return { layouts: [{ name: IMP_ATTRIBUTE_FINISH_LAYOUT, controller }], update: () => undefined };
}

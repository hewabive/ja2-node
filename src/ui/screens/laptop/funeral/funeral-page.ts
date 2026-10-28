// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-24. See LICENSE (SFI-SCLA).
// @src src/game/Laptop/Funeral.cc RenderFuneral (each link text centred in its carving over IanWrappedStringHeight),
// @src SelectFuneralLinkRegionCallBack (the first link goes to the florist, the others show the closed sign),
// @src SelectRipSignRegionCallBack.

import { idiv } from '../../../../core/int.ts';
import { type ControllerContract, ViewModelController } from '../../../layout/controller.ts';
import { FontName } from '../../../text/fonts.ts';
import { ianWrappedStringHeight } from '../../../text/wrap.ts';
import { Bookmark } from '../laptop-modes.ts';
import type { LaptopContext, LaptopPage } from '../laptop-page.ts';

export const FUNERAL_LAYOUT = 'funeral';
export const FUNERAL_LINKS = 5;
const FLORIST_LINK = 0;
const LINK_STRINGS = 'sFuneralString';
const FIRST_LINK_STRING = 5;
const LINK_TEXT_GAP = 2;

export const FUNERAL_CONTRACT: ControllerContract = {
  id: 'funeral',
  actions: { link: { args: 1 }, closeSign: {} },
  bindings: { linkTextY: 'list', ripSign: 'boolean' },
};

export function linkTextOffset(linkHeight: number, textHeight: number): number {
  return idiv(linkHeight - textHeight, 2);
}

export function funeralPage(context: LaptopContext): LaptopPage {
  const constant = (name: string) => context.constant(FUNERAL_LAYOUT, name);
  const fonts = context.services.fonts;
  const font = fonts.get(FontName.FONT12ARIAL);
  const bold = fonts.get(FontName.FONT10ARIALBOLD);
  const model: Record<string, unknown> = {
    ripSign: false,
    linkTextY: Array.from({ length: FUNERAL_LINKS }, (_, i) => {
      const text = context.string(LINK_STRINGS, FIRST_LINK_STRING + i);
      const height = ianWrappedStringHeight(constant('FUNERAL_LINK_TEXT_WIDTH'), LINK_TEXT_GAP, font, text, bold);
      return linkTextOffset(constant('FUNERAL_LINK_1_HEIGHT'), height);
    }),
  };
  const controller = new ViewModelController(FUNERAL_CONTRACT, model, {
    link: ([i]) => {
      if (i === FLORIST_LINK) context.shell.goToWebPage(Bookmark.FLORIST);
      else model.ripSign = true;
    },
    closeSign: () => {
      model.ripSign = false;
    },
  });
  return { layouts: [{ name: FUNERAL_LAYOUT, controller }], update: () => undefined };
}

// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-24. See LICENSE (SFI-SCLA).
// @src src/game/Laptop/IMP_Text_System.cc OpenIMPTexts (binarydata/imptext.edt); IMP_MainPage.cc LoadIMPPortait (the
// @src current portrait's face); the pages' DoLapTopMessageBox(MSG_BOX_IMP_STYLE, pImpPopUpStrings[n], ...).

import type { ImpSiteView } from '../../../../protocol/view.ts';
import type { MessageBoxFlag } from '../../../widgets/message-box.ts';
import type { LaptopContext, LaptopPage } from '../laptop-page.ts';
import type { ImpDraft } from './imp-draft.ts';

export const IMP_TEXT_FILE = 'binarydata/imptext.edt';
export const IMP_BUTTON_TEXT = 'pImpButtonText';
export const IMP_POPUP_TEXT = 'pImpPopUpStrings';

export const ImpPopUp = {
  BAD_CODE: 0,
  START_OVER: 1,
  NAME_AND_GENDER: 2,
  FUNDS: 3,
  NOT_YET: 4,
  TEAM_FULL: 5,
  NO_SLOT: 6,
} as const;

export interface ImpContext {
  readonly context: LaptopContext;
  readonly draft: ImpDraft;
  site(): ImpSiteView | null;
  impText(record: number): string;
  popUp(index: number, flags: MessageBoxFlag, onClose?: (result: number) => void): void;
  messageBox(text: string, flags: MessageBoxFlag, onClose?: (result: number) => void): void;
}

export type ImpPageFactory = (imp: ImpContext) => LaptopPage;

export function genderList(imp: ImpContext, lists: 'portraits' | 'voices'): readonly number[] {
  const site = imp.site();
  if (!site) return [];
  return imp.draft.male ? site[lists].male : site[lists].female;
}

export function currentPortraitFace(imp: ImpContext): number | null {
  return genderList(imp, 'portraits')[imp.draft.portraitNumber] ?? null;
}

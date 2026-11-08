// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-11-07. See LICENSE (SFI-SCLA).
// @src src/game/Tactical/Overhead.cc HandleThePlayerBeNotifiedOfSomeoneElseInSector (NS_SOMEONE_ELSE_IN_SECTOR in a
// @src MSG_BOX_BASIC_STYLE OK box on the game screen, no callback); src/externalized/content/NewStrings.h.

import type { PromptView } from '../../../protocol/view.ts';
import type { UiTextService } from '../../text/text-service.ts';

const NEW_STRINGS = 'new-strings';
const NS_SOMEONE_ELSE_IN_SECTOR = 2;

export const SOMEONE_ELSE_ANSWER = 'ok';

export type SomeoneElsePromptView = Extract<PromptView, { readonly kind: 'someoneElseInSector' }>;

export function someoneElsePrompt(prompt: PromptView | null | undefined): SomeoneElsePromptView | null {
  return prompt?.kind === 'someoneElseInSector' ? prompt : null;
}

export function someoneElseText(text: UiTextService): string {
  return text.string(NEW_STRINGS, NS_SOMEONE_ELSE_IN_SECTOR) ?? '';
}

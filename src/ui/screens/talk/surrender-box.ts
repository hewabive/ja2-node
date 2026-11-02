// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-11-02. See LICENSE (SFI-SCLA).
// @src src/game/Tactical/Civ_Quotes.cc ShutDownQuoteBox (the basic YES/NO box with Message[STR_SURRENDER] once the
// @src offer's quote box closes), SurrenderMessageBoxCallBack (YES surrenders, anything else declines).

import type { PromptView } from '../../../protocol/view.ts';
import type { UiTextService } from '../../text/text-service.ts';
import { MessageBoxReturn } from '../../widgets/message-box.ts';

const MESSAGE = 'Message';
const STR_SURRENDER = 54;

export type SurrenderPromptView = Extract<PromptView, { readonly kind: 'surrender' }>;

export function tacticalSurrenderPrompt(prompt: PromptView | null | undefined): SurrenderPromptView | null {
  return prompt?.kind === 'surrender' && prompt.context === 'tactical' ? prompt : null;
}

export function surrenderQuestion(text: UiTextService): string {
  return text.string(MESSAGE, STR_SURRENDER) ?? '';
}

export function surrenderChoice(result: number): 'accept' | 'reject' {
  return result === MessageBoxReturn.YES ? 'accept' : 'reject';
}

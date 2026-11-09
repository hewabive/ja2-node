// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-24. See LICENSE (SFI-SCLA).
// @src src/game/Strategic/Meanwhile.cc BringupMeanwhileBox ("<MSG_MEANWHILE>....." in MSG_BOX_BASIC_STYLE, OK alone for
// @src INTERROGATION or a scene not yet seen, OK and Skip otherwise: the simulation reads the seen flags and asks with the
// @src meanwhile prompt), BeginMeanwhileCallBack (OK or YES starts the scene, anything else skips it).

import type { MeanwhilePromptView } from '../../../protocol/view.ts';
import type { MessageBoxButtons } from '../../message-boxes.ts';
import { MessageString } from '../../text/string-ids.ts';
import type { UiTextService } from '../../text/text-service.ts';
import { MessageBoxReturn } from '../../widgets/message-box.ts';

export const MEANWHILE_BOX = 'meanwhileBox';
const MESSAGE_STRINGS = 'pMessageStrings';
const ELLIPSIS = '.....';
const MEANWHILE_OK = 'ok';
const MEANWHILE_SKIP = 'skip';

export function meanwhileBoxText(text: UiTextService): string {
  return `${text.string(MESSAGE_STRINGS, MessageString.MEANWHILE) ?? ''}${ELLIPSIS}`;
}

export function meanwhileBoxButtons(prompt: MeanwhilePromptView | null): MessageBoxButtons {
  return prompt?.choices.includes(MEANWHILE_SKIP) ? 'okSkip' : 'ok';
}

export function meanwhileBoxChoice(result: number): string {
  return result === MessageBoxReturn.OK || result === MessageBoxReturn.YES ? MEANWHILE_OK : MEANWHILE_SKIP;
}

// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-24. See LICENSE (SFI-SCLA).
// @src src/game/Strategic/Meanwhile.cc BringupMeanwhileBox ("<MSG_MEANWHILE>....." in MSG_BOX_BASIC_STYLE, OK only for
// @src INTERROGATION or a scene not yet seen, OK and Skip otherwise), BeginMeanwhileCallBack; src/game/GameSettings.cc
// @src MeanwhileSceneSeen, SetMeanwhileSceneSeen (set only when a scene has been played, Meanwhile.cc EndMeanwhile).

import { INTERROGATION_SCENE, meanwhileSceneId } from '../../../protocol/meanwhile-scenes.ts';
import type { MessageBoxButtons } from '../../message-boxes.ts';
import { MessageString } from '../../text/string-ids.ts';
import type { UiTextService } from '../../text/text-service.ts';

export const MEANWHILE_BOX = 'meanwhileBox';
const MESSAGE_STRINGS = 'pMessageStrings';
const ELLIPSIS = '.....';

export function meanwhileBoxText(text: UiTextService): string {
  return `${text.string(MESSAGE_STRINGS, MessageString.MEANWHILE) ?? ''}${ELLIPSIS}`;
}

export function meanwhileBoxButtons(scene: string, seen: (scene: number) => boolean): MessageBoxButtons {
  if (scene === INTERROGATION_SCENE) return 'ok';
  const id = meanwhileSceneId(scene);
  return id !== null && seen(id) ? 'okSkip' : 'ok';
}

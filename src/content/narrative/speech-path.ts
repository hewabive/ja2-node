// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-18. See LICENSE (SFI-SCLA).
// @src src/externalized/content/Dialogs.cc GetDialogueVoiceFilename; src/game/Directories.h SPEECHDIR, NPC_SPEECHDIR;
// @src src/game/Tactical/Dialogue_Control.cc GetDialogue (the Russian switch).

import { SharedDialogueFile } from './npc-constants.ts';
import { threeDigits } from './npc-records.ts';

export const SPEECH_DIR = 'speech';
export const NPC_SPEECH_DIR = 'npc_speech';
const ALTERNATE_PREFIX = 'd_';
const RUSSIAN_RPC_PREFIX = 'r_';

export interface SpeechSource {
  readonly profile: number;
  readonly voice: number;
  readonly quote: number;
  readonly alternate: boolean;
  readonly usesNpcFile: boolean;
  readonly recruitedNpcOrRpc: boolean;
}

function sharedNpcFileId(profile: number): number {
  return profile >= SharedDialogueFile.FIRST && profile <= SharedDialogueFile.LAST ? SharedDialogueFile.FIRST : profile;
}

export function dialogueSpeechPath(source: SpeechSource, rpcSpeechPrefixed: boolean): string {
  const quote = threeDigits(source.quote);
  if (source.alternate) return `${NPC_SPEECH_DIR}/${ALTERNATE_PREFIX}${threeDigits(source.profile)}_${quote}.wav`;
  if (source.usesNpcFile) return `${NPC_SPEECH_DIR}/${threeDigits(sharedNpcFileId(source.profile))}_${quote}.wav`;
  const prefix = rpcSpeechPrefixed && source.recruitedNpcOrRpc ? RUSSIAN_RPC_PREFIX : '';
  return `${SPEECH_DIR}/${prefix}${threeDigits(source.voice)}_${quote}.wav`;
}

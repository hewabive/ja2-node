// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-18. See LICENSE (SFI-SCLA).
// @src src/externalized/content/Dialogs.cc GetDialogueVoiceFilename (which file a text key's line is spoken from);
// @src src/game/Tactical/Dialogue_Control.cc (speech at speech volume, middle pan).

import { MERCEDT_DIR, type TextKey } from '../narrative/dialogue-text.ts';
import { NPCDATA_DIR } from '../narrative/npc-records.ts';
import { dialogueSpeechPath } from '../narrative/speech-path.ts';
import { type Cue, cueOf, VolumeLevel } from './cue.ts';

const NPC_FILE = new RegExp(`^${NPCDATA_DIR}/(\\d{3})\\.edt$`, 'i');
const ALTERNATE_FILE = new RegExp(`^${NPCDATA_DIR}/d_(\\d{3})\\.edt$`, 'i');
const MERC_FILE = new RegExp(`^${MERCEDT_DIR}/(\\d{3})\\.edt$`, 'i');

export interface SpokenLine {
  readonly profile: number;
  readonly textKey: TextKey;
  readonly recruitedNpcOrRpc: boolean;
}

export function speechPathForLine(line: SpokenLine, rpcSpeechPrefixed: boolean): string | null {
  const quote = line.textKey.row;
  const file = line.textKey.file;
  const alternate = ALTERNATE_FILE.exec(file);
  if (alternate)
    return dialogueSpeechPath(
      { profile: Number(alternate[1]), voice: 0, quote, alternate: true, usesNpcFile: true, recruitedNpcOrRpc: false },
      false,
    );
  const npc = NPC_FILE.exec(file);
  if (npc)
    return dialogueSpeechPath(
      { profile: Number(npc[1]), voice: 0, quote, alternate: false, usesNpcFile: true, recruitedNpcOrRpc: false },
      false,
    );
  const merc = MERC_FILE.exec(file);
  if (!merc) return null;
  const source = {
    profile: line.profile,
    voice: Number(merc[1]),
    quote,
    alternate: false,
    usesNpcFile: false,
    recruitedNpcOrRpc: line.recruitedNpcOrRpc,
  };
  return dialogueSpeechPath(source, rpcSpeechPrefixed);
}

export function speechCue(path: string): Cue {
  return cueOf(path, 'speech', VolumeLevel.HIGH);
}

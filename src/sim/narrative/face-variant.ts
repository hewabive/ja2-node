// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-19. See LICENSE (SFI-SCLA).
// @src src/game/Tactical/Faces.cc InitFace (Elliot's beaten big faces b135a-e by bNPCData); HandleRenderFaceAdjustments
// @src (the drink icon on Father Walker's or Micky's face without a soldier, 2026-11-04).

import { Npc } from '../strategic/narrative/npc-ids.ts';

export type FaceVariant = 'a' | 'b' | 'c' | 'd' | 'e';

const FIRST_BEATEN = 4;
const VARIANT_LIMITS: readonly (readonly [number, FaceVariant])[] = [
  [7, 'a'],
  [10, 'b'],
  [13, 'c'],
  [16, 'd'],
];
const LAST_VARIANT_DATA = 17;

export function elliotFaceVariant(npcData: number): FaceVariant | null {
  if (npcData < FIRST_BEATEN) return null;
  const found = VARIANT_LIMITS.find(([limit]) => npcData < limit);
  if (found) return found[1];
  return npcData === LAST_VARIANT_DATA ? 'e' : null;
}

const DRUNK_FACES: ReadonlySet<number> = new Set([Npc.FATHER, Npc.MICKY]);
const DRUNK_FACE_DATA = 5;

export function drunkTalkFace(profile: number, npcData: number): boolean {
  return DRUNK_FACES.has(profile) && npcData >= DRUNK_FACE_DATA;
}

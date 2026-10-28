// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-16. See LICENSE (SFI-SCLA).
// @src src/game/Tactical/Soldier_Control.h KEY_ON_RING; Keys.h NUM_KEYS, INVALID_KEY_NUMBER.

export const NUM_KEYS = 64;
const INVALID_KEY_NUMBER = 255;

export interface KeyOnRing {
  keyId: number;
  count: number;
}

export interface PendingDoorAction {
  readonly gridNo: number;
  readonly actionGridNo: number;
  readonly direction: number;
  readonly action: string;
}

export function newKeyRing(): KeyOnRing[] {
  return Array.from({ length: NUM_KEYS }, () => ({ keyId: INVALID_KEY_NUMBER, count: 0 }));
}

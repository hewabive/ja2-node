// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-11-18. See LICENSE (SFI-SCLA).
// @src src/game/Tactical/Keys.cc GetTrapName (the row of pDoorTrapStrings per trap kind)

export const DOOR_TRAP_STRINGS: Readonly<Record<string, number>> = { none: 0, explosion: 1, electric: 2, siren: 3, silentAlarm: 4 };

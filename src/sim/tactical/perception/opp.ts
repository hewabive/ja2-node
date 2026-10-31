// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-15. See LICENSE (SFI-SCLA).
// @src src/game/Tactical/OppList.h opplist values, sight flags, callers; Isometric_Utils.cc atan8; OppList.cc the values of
// @src gfPlayerTeamSawCreatures (2026-10-30)

export const Opp = {
  NOT_HEARD_OR_SEEN: 0,
  SEEN_CURRENTLY: 1,
  SEEN_THIS_TURN: 2,
  SEEN_LAST_TURN: 3,
  SEEN_2_TURNS_AGO: 4,
  SEEN_3_TURNS_AGO: 5,
  HEARD_THIS_TURN: -1,
  HEARD_LAST_TURN: -2,
  HEARD_2_TURNS_AGO: -3,
  HEARD_3_TURNS_AGO: -4,
} as const;

export const SightFlags = { LOOK: 0x01, RADIO: 0x02, INTERRUPT: 0x04 } as const;
export const SeenCreature = { NONE: 0, CREATURE: 1, BLOODCAT: 2 } as const;
export const Caller = { MANLOOKSFOROTHERTEAMS: 0, OTHERTEAMSLOOKFORMAN: 1, VERIFYANDDECAYOPPLIST: 2, UPDATEPUBLIC: 4, UNKNOWN: 5 } as const;

export function atan8(x1: number, y1: number, x2: number, y2: number): number {
  const x = x2 - x1;
  const y = -(y2 - y1);
  if (x === 0 && y === 0) return 2;
  let theta = Math.atan2(y, x);
  if (theta < 0) theta += 2 * Math.PI;
  const index = Math.trunc((8 * theta + Math.PI) / (2 * Math.PI)) % 8;
  return [2, 1, 0, 7, 6, 5, 4, 3][index] ?? 2;
}

export function atan8Of(from: { readonly x: number; readonly y: number }, to: { readonly x: number; readonly y: number }): number {
  return atan8(Math.trunc(from.x), Math.trunc(from.y), Math.trunc(to.x), Math.trunc(to.y));
}

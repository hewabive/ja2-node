// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-11-01. See LICENSE (SFI-SCLA).
// @src src/game/Strategic/Map_Screen_Helicopter.cc AddHelicopterToMaps (where the six pieces stand).

export interface LandedHelicopter {
  readonly gridNo: number;
  readonly firstTile: number;
}

export interface HelicopterPiece {
  readonly gridNo: number;
  readonly tile: number;
}

const NORTH_PIECE_OFFSET = -800;
const PIECE_OFFSETS: readonly number[] = [0, 0, NORTH_PIECE_OFFSET, 0, 0, NORTH_PIECE_OFFSET];

export function helicopterPieces(heli: LandedHelicopter): HelicopterPiece[] {
  return PIECE_OFFSETS.map((offset, k) => ({ gridNo: heli.gridNo + offset, tile: heli.firstTile + k }));
}

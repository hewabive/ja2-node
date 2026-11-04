// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-11-04. See LICENSE (SFI-SCLA).
// @src src/game/Tactical/FOV.cc AddSlantRoofFOVSlot, ExamineSlantRoofFOVSlots, RevealRoofsAndItems (the slanted roof
// @src check); TileEngine/Render_Fun.cc ExamineGridNoForSlantRoofExtraGraphic, SetGridNoRevealedFlag (the slanted roofs
// @src it hides)

import { WORLD_MAX } from '../../../content/world/grid.ts';
import { has, StructureFlags, type StructureInstance } from '../../../content/world/structures.ts';
import type { TacticalState } from '../state.ts';

const NO_ROOM = 0;
const CEILING = 1;
const NO_CEILING = 0;

export class SlantRoofSlots {
  readonly #gridNos: number[] = [];

  addSeenTile(t: TacticalState, gridNo: number): void {
    if (t.world.structures.find(gridNo, StructureFlags.SLANTED_ROOF)) this.#add(gridNo);
  }

  addRoofsHiddenOver(t: TacticalState, gridNo: number): void {
    for (const s of t.world.structures.at(gridNo)) {
      if (!has(s.flags, StructureFlags.SLANTED_ROOF)) continue;
      const base = t.world.structures.findBase(s);
      if (base) this.#add(base.gridNo);
    }
  }

  examine(t: TacticalState, revealed: (gridNo: number) => boolean): void {
    for (const gridNo of this.#gridNos) examineSlantRoof(t, gridNo, revealed);
    this.#gridNos.length = 0;
  }

  #add(gridNo: number): void {
    if (!this.#gridNos.includes(gridNo)) this.#gridNos.push(gridNo);
  }
}

function hiddenByRevealedRoom(t: TacticalState, base: StructureInstance): boolean {
  return base.def.tiles.some((tile) => {
    const room = t.world.level.rooms[base.gridNo + tile.posRelToBase] ?? NO_ROOM;
    return room !== NO_ROOM && t.fog.roomHidden[room] === 0;
  });
}

function examineSlantRoof(t: TacticalState, gridNo: number, revealed: (gridNo: number) => boolean): void {
  const roof = t.world.structures.find(gridNo, StructureFlags.SLANTED_ROOF);
  const base = roof ? t.world.structures.findBase(roof) : null;
  if (!base) return;
  const hidden = hiddenByRevealedRoom(t, base);
  const ceilings = t.fog.slantRoofCeilings;
  for (const tile of base.def.tiles) {
    const at = base.gridNo + tile.posRelToBase;
    if (at < 0 || at >= WORLD_MAX) continue;
    if (revealed(at)) ceilings[at] = NO_CEILING;
    else if (hidden) ceilings[at] = CEILING;
  }
}

export function slantRoofCeilingTiles(t: TacticalState): number[] {
  const tiles: number[] = [];
  t.fog.slantRoofCeilings.forEach((ceiling, gridNo) => {
    if (ceiling === CEILING) tiles.push(gridNo);
  });
  return tiles;
}

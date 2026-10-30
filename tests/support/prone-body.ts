import { AnimStruct } from '../../src/content/anim/structures.ts';
import type { StructureDef, StructureFile, StructureTile } from '../../src/content/formats/jsd.ts';
import { DIRECTION_INCREMENT, WORLD_COLS } from '../../src/content/world/grid.ts';
import { StructureFlags, StructureTileFlags } from '../../src/content/world/structures.ts';
import { syntheticStructure } from '../../src/content/world/synthetic.ts';
import { states } from '../../src/sim/tactical/animation.ts';
import type { TacticalContent } from '../../src/sim/tactical/content.ts';
import { addMercStructure } from '../../src/sim/tactical/person-structure.ts';
import { Body, type Soldier } from '../../src/sim/tactical/soldier.ts';
import type { TacticalState } from '../../src/sim/tactical/state.ts';

const PRONE_BODY_FLAGS = StructureFlags.MOBILE | StructureFlags.TRANSPARENT;
const LOWEST_CUBE = 0b0001;
const PROFILE_CELLS = 25;
const DIRECTIONS = 8;
const RAISED_HEIGHT = 1;

function bodyTile(offset: number, flags: number): StructureTile {
  const y = Math.round(offset / WORLD_COLS);
  return {
    posRelToBase: offset,
    xRelToBase: offset - y * WORLD_COLS,
    yRelToBase: y,
    shape: new Uint8Array(PROFILE_CELLS).fill(LOWEST_CUBE),
    flags,
    vehicleHitLocation: 0,
  };
}

function facingOfStructure(index: number): number {
  return (index + DIRECTIONS - 1) % DIRECTIONS;
}

function proneBody(): StructureFile {
  const structures = Array.from({ length: DIRECTIONS }, (_, index): StructureDef => {
    const behind = -(DIRECTION_INCREMENT[facingOfStructure(index)] ?? 0);
    return {
      ...syntheticStructure(PRONE_BODY_FLAGS),
      number: index,
      tiles: [bodyTile(0, 0), bodyTile(behind, StructureTileFlags.PASSABLE)],
    };
  });
  return { structureCount: structures.length, auxData: null, tileLocations: [], structures };
}

export function withTwoTileProneBody(content: TacticalContent): TacticalContent {
  const animStructures = content.animStructures.map((files, body) =>
    body === Body.REGMALE ? files.map((file, type) => (type === AnimStruct.P ? proneBody() : file)) : files,
  );
  return { ...content, animStructures };
}

export function layProne(t: TacticalState, s: Soldier): void {
  const st = states(t.content.animations);
  s.state = st.PRONE;
  addMercStructure(t, s);
  s.uiMovementMode = st.CRAWLING;
}

export function raiseTiles(t: TacticalState, tiles: readonly number[]): void {
  for (const g of tiles) t.world.level.heights[g] = RAISED_HEIGHT;
}

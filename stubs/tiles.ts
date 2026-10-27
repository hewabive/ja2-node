import { Orientation, type StructureDef } from '../src/content/formats/jsd.ts';
import { StructureFlags } from '../src/content/world/structures.ts';
import { syntheticStructure } from '../src/content/world/synthetic.ts';
import { Rng } from '../src/core/rng.ts';
import { color, type RampName } from './palette.ts';
import { IndexedRaster } from './raster.ts';
import type { StubFrame, StubSprite } from './sprites.ts';

export interface StubSurface {
  readonly type: string;
  readonly sprite: StubSprite;
  readonly structures?: readonly StructureDef[];
}

export const StubMaterial = {
  WOOD_WALL: 1,
  STONE: 11,
  CONCRETE: 12,
  SANDBAG: 18,
  LIGHT_METAL: 21,
  INDESTRUCTABLE_STONE: 24,
} as const;

export const STUB_ITEM_TILE_COUNTS: Readonly<Record<string, number>> = { GUNS: 60, P1ITEMS: 149, P2ITEMS: 45, P3ITEMS: 16 };

const TILE_W = 40;
const TILE_H = 20;
const HALF_W = TILE_W / 2;
const EDGE_RUN = 20;
const WALL_HEIGHT = 50;
const WINDOW_BOTTOM = 16;
const WINDOW_TOP = 36;
const WINDOW_INSET = 4;
const WOOD_FENCE_HEIGHT = 18;
const WIRE_FENCE_HEIGHT = 34;
const WIRE_MESH_STEP = 4;
const WIRE_POST_STEP = 10;
const CUT_FROM = 6;
const CUT_TO = 14;
const CUT_TOP = 22;
const SANDBAG_LAYER = 7;
const ROOF_RIDGE_HEIGHT = 8;
const HIGH_ROOF_RISE = 14;
const CLIFF_FACE = 30;
const LOW_SANDBAG_HEIGHT = 1;
const HIGH_SANDBAG_HEIGHT = 2;
const WOOD_FENCE_CUBES = 2;
const WIRE_FENCE_CUBES = 3;
const WIRE_FENCE_DENSITY = 10;
const SLANTED_ROOF_CUBES = 2;
const TALL_ROOF_CUBES = 4;
const NORMAL_ROOF_CUBES = 1;
const CLIFF_CUBES = 4;
const BULLET_OFFSET_X = 19;
const BULLET_OFFSET_Y = 10;
const BULLET_SHADE = 15;
const BULLET_SHADOW_SHADE = 1;

type Side = 'left' | 'right';
type WallFace = 'solid' | 'window' | 'shattered';

function numbered(defs: readonly StructureDef[]): StructureDef[] {
  return defs.map((d, number) => ({ ...d, number }));
}

function edgeColumn(side: Side, i: number): number {
  return side === 'left' ? i : i + 2;
}

function edgeFrame(side: Side, height: number, paint: (r: IndexedRaster, px: number, i: number, baseY: number) => void): StubFrame {
  const raised = height + 1;
  const r = new IndexedRaster(24, raised + 21);
  for (let i = 0; i <= EDGE_RUN; i++) {
    const baseY = raised + 10 - Math.floor(i / 2);
    paint(r, edgeColumn(side, side === 'left' ? i : EDGE_RUN - i), i, baseY);
  }
  return { raster: r, ox: side === 'left' ? 0 : 18, oy: -raised };
}

function inWindow(i: number, rise: number): boolean {
  return i >= WINDOW_INSET && i <= EDGE_RUN - WINDOW_INSET && rise >= WINDOW_BOTTOM && rise <= WINDOW_TOP;
}

function stoneWall(side: Side, face: WallFace): StubFrame {
  return edgeFrame(side, WALL_HEIGHT, (r, px, i, baseY) => {
    for (let rise = 0; rise <= WALL_HEIGHT; rise++) {
      const y = baseY - rise;
      if (face !== 'solid' && inWindow(i, rise)) {
        const edge = rise === WINDOW_BOTTOM || rise === WINDOW_TOP || i === WINDOW_INSET || i === EDGE_RUN - WINDOW_INSET;
        if (face === 'window') r.set(px, y, color('water', edge ? 4 : 11 + ((i + rise) % 5 === 0 ? 2 : 0)));
        else if (edge && (i + rise) % 3 !== 0) r.set(px, y, color('water', 12));
        continue;
      }
      const mortar = rise % 8 === 0 || (rise % 16 < 8 ? i % 6 === 0 : i % 6 === 3);
      r.set(px, y, color('gray', mortar ? 4 : 7 + (side === 'left' ? 1 : -1)));
    }
    r.set(px, baseY - WALL_HEIGHT, color('gray', 12));
  });
}

function woodFence(side: Side): StubFrame {
  return edgeFrame(side, WOOD_FENCE_HEIGHT, (r, px, i, baseY) => {
    const post = i % 5 === 0;
    for (let rise = 0; rise <= WOOD_FENCE_HEIGHT; rise++) {
      const rail = rise === 5 || rise === 13;
      if (post || rail) r.set(px, baseY - rise, color('brown', post ? 5 : 9));
    }
  });
}

function wireFence(side: Side, cut: boolean): StubFrame {
  return edgeFrame(side, WIRE_FENCE_HEIGHT, (r, px, i, baseY) => {
    const post = i % WIRE_POST_STEP === 0;
    for (let rise = 0; rise <= WIRE_FENCE_HEIGHT; rise++) {
      if (post) {
        r.set(px, baseY - rise, color('steel', 4));
        continue;
      }
      if (cut && i >= CUT_FROM && i <= CUT_TO && rise <= CUT_TOP) continue;
      const mesh = (i + rise) % WIRE_MESH_STEP === 0 || (i - rise + WIRE_FENCE_HEIGHT * WIRE_MESH_STEP) % WIRE_MESH_STEP === 0;
      if (mesh || rise === WIRE_FENCE_HEIGHT) r.set(px, baseY - rise, color('steel', 10));
    }
  });
}

function sandbags(layers: number): StubFrame {
  const top = layers * SANDBAG_LAYER;
  const r = new IndexedRaster(TILE_W, TILE_H + top);
  for (let layer = 0; layer < layers; layer++) {
    const cy = TILE_H / 2 + top - SANDBAG_LAYER / 2 - layer * SANDBAG_LAYER;
    for (let k = 0; k < 4; k++) {
      const cx = 8 + k * 8 + (layer % 2) * 4;
      r.ellipse(cx, cy - k * 2 + 3, 5, 3.5, (nx, ny) => color('sand', 8 - nx * 2 - ny * 3));
    }
  }
  r.outline(color('khaki', 3));
  return { raster: r, ox: 0, oy: -top };
}

function diamond(paint: (x: number, y: number) => number | null, rise = 0): StubFrame {
  const r = new IndexedRaster(TILE_W, TILE_H + rise);
  for (let y = 0; y < TILE_H; y++) {
    const dy = y < TILE_H / 2 ? y : TILE_H - 1 - y;
    const half = 2 + dy * 2;
    for (let x = HALF_W - half; x < HALF_W + half; x++) {
      const c = paint(x, y);
      if (c !== null) r.set(x, y + rise, c);
    }
  }
  return { raster: r, ox: 0, oy: -rise };
}

function flatRoof(): StubFrame {
  return diamond((x, y) => color('steel', (x + y) % 9 === 0 ? 5 : 8));
}

function slantedRoof(ramp: RampName, rise: number): StubFrame {
  const frame = diamond((x, y) => color(ramp, x < HALF_W ? 9 - (y % 3 === 0 ? 1 : 0) : 6), rise);
  const r = frame.raster;
  for (let k = 0; k <= ROOF_RIDGE_HEIGHT + rise; k++) r.set(HALF_W, TILE_H / 2 + rise - k, color(ramp, 12));
  return frame;
}

function bulletDot(c: number): StubFrame {
  const r = new IndexedRaster(1, 1);
  r.set(0, 0, c);
  return { raster: r, ox: BULLET_OFFSET_X, oy: BULLET_OFFSET_Y };
}

function cliffFace(): StubFrame {
  const rng = Rng.fromSeed(41);
  const r = new IndexedRaster(TILE_W, TILE_H + CLIFF_FACE);
  for (let y = 0; y < TILE_H + CLIFF_FACE; y++) {
    for (let x = 0; x < TILE_W; x++) {
      const fromCentre = Math.abs(x - HALF_W);
      const topEdge = Math.floor(fromCentre / 2);
      const bottomEdge = TILE_H + CLIFF_FACE - 1 - Math.floor(fromCentre / 2);
      if (y < topEdge || y > bottomEdge) continue;
      const onTop = y < TILE_H - topEdge;
      r.set(x, y, color(onTop ? 'olive' : 'brown', (onTop ? 8 : x < HALF_W ? 7 : 5) + rng.int(3) - 1));
    }
  }
  return { raster: r, ox: 0, oy: -CLIFF_FACE };
}

function cliffLip(): StubFrame {
  return diamond((x, y) => (y >= TILE_H / 2 - 2 && y <= TILE_H / 2 + 1 ? color('olive', 6 + ((x + y) % 4 === 0 ? 2 : 0)) : null));
}

function rocks(seed: number): StubFrame {
  const rng = Rng.fromSeed(seed);
  const r = new IndexedRaster(TILE_W, TILE_H);
  for (let k = 0; k < 5; k++) {
    const cx = 8 + rng.int(24);
    const cy = 5 + rng.int(10);
    r.ellipse(cx, cy, 1.5 + rng.int(3), 1 + rng.int(2), (nx, ny) => color('gray', 7 - nx * 2 - ny * 2));
  }
  return { raster: r, ox: 0, oy: 0 };
}

const ITEM_RAMPS: readonly RampName[] = ['olive', 'khaki', 'red', 'blue', 'teal', 'sand', 'violet', 'orange'];
const ITEM_RASTER_W = 18;
const ITEM_RASTER_H = 10;
const ITEM_OX = 11;
const ITEM_OY = 5;

function gunTile(k: number): StubFrame {
  const r = new IndexedRaster(ITEM_RASTER_W, ITEM_RASTER_H);
  const barrel = 6 + (k % 5) * 2;
  r.line(2, 6, 2 + barrel, 6 - Math.floor(barrel / 3), color('steel', 4));
  r.line(1, 7, 4, 6, color('brown', 6 + (k % 3)));
  r.set(5, 8, color('steel', 3));
  if (k % 2 === 1) r.set(6, 8, color('steel', 3));
  return { raster: r, ox: ITEM_OX, oy: ITEM_OY };
}

function itemTile(k: number): StubFrame {
  const r = new IndexedRaster(ITEM_RASTER_W, ITEM_RASTER_H);
  const ramp = ITEM_RAMPS[k % ITEM_RAMPS.length] ?? 'khaki';
  const shade = (nx: number, ny: number) => color(ramp, 9 - nx * 2 - ny * 2);
  switch (k % 5) {
    case 0:
      r.rect(5, 3, 8, 5, color(ramp, 8));
      break;
    case 1:
      r.ellipse(9, 5, 4, 3, shade);
      break;
    case 2:
      r.rect(3, 5, 12, 2, color(ramp, 7));
      break;
    case 3:
      r.ellipse(9, 5, 2, 4, shade);
      break;
    default:
      r.ellipse(9, 6, 5, 2.5, shade);
  }
  r.outline(color('gray', 2));
  return { raster: r, ox: ITEM_OX, oy: ITEM_OY };
}

function itemSprite(path: string, count: number, draw: (k: number) => StubFrame): StubSprite {
  return { path, frames: Array.from({ length: count }, (_, k) => draw(k)) };
}

const STONE = { armour: StubMaterial.STONE, edge: true } as const;

const STONE_WALL_STRUCTURES = numbered([
  syntheticStructure(StructureFlags.WALL, Orientation.OUTSIDE_LEFT, STONE),
  syntheticStructure(StructureFlags.WALL, Orientation.OUTSIDE_RIGHT, STONE),
  { ...syntheticStructure(StructureFlags.WALLNWINDOW, Orientation.OUTSIDE_LEFT, STONE), partnerDelta: 1 },
  syntheticStructure(StructureFlags.WALLNWINDOW | StructureFlags.OPEN, Orientation.OUTSIDE_LEFT, STONE),
  { ...syntheticStructure(StructureFlags.WALLNWINDOW, Orientation.OUTSIDE_RIGHT, STONE), partnerDelta: 1 },
  syntheticStructure(StructureFlags.WALLNWINDOW | StructureFlags.OPEN, Orientation.OUTSIDE_RIGHT, STONE),
]);

const WIRE = StructureFlags.WIREFENCE | StructureFlags.TRANSPARENT;
const CUT_WIRE = WIRE | StructureFlags.OPEN | StructureFlags.PASSABLE;
const wireFenceDef = (flags: number, orientation: number) => ({
  ...syntheticStructure(flags, orientation, { armour: StubMaterial.LIGHT_METAL, height: WIRE_FENCE_CUBES, edge: true }),
  density: WIRE_FENCE_DENSITY,
});

const FENCE_STRUCTURES = numbered([
  syntheticStructure(StructureFlags.FENCE, Orientation.OUTSIDE_LEFT, {
    armour: StubMaterial.WOOD_WALL,
    height: WOOD_FENCE_CUBES,
    edge: true,
  }),
  syntheticStructure(StructureFlags.FENCE, Orientation.OUTSIDE_RIGHT, {
    armour: StubMaterial.WOOD_WALL,
    height: WOOD_FENCE_CUBES,
    edge: true,
  }),
  { ...wireFenceDef(WIRE, Orientation.OUTSIDE_LEFT), partnerDelta: 1 },
  wireFenceDef(CUT_WIRE, Orientation.OUTSIDE_LEFT),
  { ...wireFenceDef(WIRE, Orientation.OUTSIDE_RIGHT), partnerDelta: 1 },
  wireFenceDef(CUT_WIRE, Orientation.OUTSIDE_RIGHT),
]);

const SANDBAG_STRUCTURES = numbered([
  syntheticStructure(StructureFlags.GENERIC, Orientation.NONE, { armour: StubMaterial.SANDBAG, height: LOW_SANDBAG_HEIGHT }),
  syntheticStructure(StructureFlags.GENERIC, Orientation.NONE, { armour: StubMaterial.SANDBAG, height: HIGH_SANDBAG_HEIGHT }),
]);

const roofStructures = (flags: number, height: number, armour: number) =>
  numbered([syntheticStructure(flags, Orientation.NONE, { armour, height })]);

export const STUB_TILE_SURFACES: readonly StubSurface[] = [
  {
    type: 'SECONDWALL',
    sprite: {
      path: 'stonewall',
      frames: [
        stoneWall('left', 'solid'),
        stoneWall('right', 'solid'),
        stoneWall('left', 'window'),
        stoneWall('left', 'shattered'),
        stoneWall('right', 'window'),
        stoneWall('right', 'shattered'),
      ],
    },
    structures: STONE_WALL_STRUCTURES,
  },
  {
    type: 'FENCESTRUCT',
    sprite: {
      path: 'fence',
      frames: [
        woodFence('left'),
        woodFence('right'),
        wireFence('left', false),
        wireFence('left', true),
        wireFence('right', false),
        wireFence('right', true),
      ],
    },
    structures: FENCE_STRUCTURES,
  },
  { type: 'SECONDOSTRUCT', sprite: { path: 'sandbags', frames: [sandbags(1), sandbags(2)] }, structures: SANDBAG_STRUCTURES },
  {
    type: 'SECONDROOF',
    sprite: { path: 'flatroof', frames: [flatRoof()] },
    structures: roofStructures(StructureFlags.NORMAL_ROOF, NORMAL_ROOF_CUBES, StubMaterial.CONCRETE),
  },
  {
    type: 'FIRSTSLANTROOF',
    sprite: { path: 'slantroof', frames: [slantedRoof('red', 0)] },
    structures: roofStructures(StructureFlags.SLANTED_ROOF, SLANTED_ROOF_CUBES, StubMaterial.WOOD_WALL),
  },
  {
    type: 'FIRSTHIGHROOF',
    sprite: { path: 'highroof', frames: [slantedRoof('brown', HIGH_ROOF_RISE)] },
    structures: roofStructures(StructureFlags.TALL_ROOF, TALL_ROOF_CUBES, StubMaterial.WOOD_WALL),
  },
  {
    type: 'FIRSTCLIFF',
    sprite: { path: 'cliff', frames: [cliffFace()] },
    structures: numbered([
      syntheticStructure(StructureFlags.GENERIC, Orientation.NONE, { armour: StubMaterial.INDESTRUCTABLE_STONE, height: CLIFF_CUBES }),
    ]),
  },
  { type: 'FIRSTCLIFFHANG', sprite: { path: 'cliffhang', frames: [cliffLip()] } },
  { type: 'DEBRISROCKS', sprite: { path: 'rocks', frames: [rocks(43), rocks(44)] } },
  {
    type: 'BULLETTILE',
    sprite: { path: 'bullet', frames: [bulletDot(color('gray', BULLET_SHADE)), bulletDot(color('gray', BULLET_SHADOW_SHADE))] },
  },
  { type: 'GUNS', sprite: itemSprite('guns', STUB_ITEM_TILE_COUNTS.GUNS ?? 0, gunTile) },
  { type: 'P1ITEMS', sprite: itemSprite('items1', STUB_ITEM_TILE_COUNTS.P1ITEMS ?? 0, itemTile) },
  { type: 'P2ITEMS', sprite: itemSprite('items2', STUB_ITEM_TILE_COUNTS.P2ITEMS ?? 0, (k) => itemTile(k + 2)) },
  { type: 'P3ITEMS', sprite: itemSprite('items3', STUB_ITEM_TILE_COUNTS.P3ITEMS ?? 0, (k) => itemTile(k + 4)) },
];

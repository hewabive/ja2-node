import { Orientation, type StructureDef } from '../src/content/formats/jsd.ts';
import { StructureFlags } from '../src/content/world/structures.ts';
import { syntheticStructure } from '../src/content/world/synthetic.ts';
import { color } from './palette.ts';
import { IndexedRaster } from './raster.ts';
import type { StubFrame } from './sprites.ts';
import { StubMaterial, type StubSurface } from './tiles.ts';

interface Box {
  readonly left: number;
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
}

interface Canvas {
  readonly raster: IndexedRaster;
  readonly left: number;
  readonly top: number;
}

const BODY_LIFT = 16;
const BODY_ROWS = 4;
const ROW_STEP_X = 20;
const ROW_STEP_Y = -10;
const NOSE_X = 10;
const NOSE_Y = 5 - BODY_LIFT;
const BODY_BLOBS = 10;
const ROTOR_HUB_X = 40;
const ROTOR_HUB_Y = -42;
const BODY_CUBES = 3;
const BOOM_CUBES = 2;
const STRUCTURE_FLAGS = StructureFlags.VEHICLE | StructureFlags.MULTI;
const FUSELAGE_TILES: readonly (readonly [number, number])[] = [
  [0, 0],
  [0, -1],
  [0, -2],
  [0, -3],
  [-1, 0],
  [-1, -1],
  [-1, -2],
  [-1, -3],
];
const BOOM_TILES: readonly (readonly [number, number])[] = [
  [0, 0],
  [0, 1],
];
const FUSELAGE = 0;
const TAIL_BOOM = 2;

function canvas(box: Box): Canvas {
  return { raster: new IndexedRaster(box.right - box.left, box.bottom - box.top), left: box.left, top: box.top };
}

function blob(c: Canvas, x: number, y: number, rx: number, ry: number, shade: (nx: number, ny: number) => number): void {
  c.raster.ellipse(x - c.left, y - c.top, rx, ry, shade);
}

function stroke(c: Canvas, x0: number, y0: number, x1: number, y1: number, colour: number): void {
  c.raster.line(x0 - c.left, y0 - c.top, x1 - c.left, y1 - c.top, colour);
}

function finished(c: Canvas): StubFrame {
  c.raster.outline(color('gray', 1));
  return { raster: c.raster, ox: c.left, oy: c.top };
}

function fuselage(): StubFrame {
  const c = canvas({ left: -10, top: -55, right: 90, bottom: 10 });
  for (let k = 0; k <= BODY_BLOBS; k++) {
    const along = k / BODY_BLOBS;
    const x = NOSE_X + along * (BODY_ROWS - 1) * ROW_STEP_X;
    const y = NOSE_Y + along * (BODY_ROWS - 1) * ROW_STEP_Y;
    blob(c, x, y, 14 - along * 4, 10 - along * 3, (nx, ny) => color('olive', 9 - nx * 2 - ny * 3));
  }
  return finished(c);
}

function rotor(): StubFrame {
  const c = canvas({ left: -20, top: -70, right: 100, bottom: -20 });
  stroke(c, ROTOR_HUB_X - 55, ROTOR_HUB_Y + 10, ROTOR_HUB_X + 55, ROTOR_HUB_Y - 10, color('gray', 4));
  stroke(c, ROTOR_HUB_X - 45, ROTOR_HUB_Y - 14, ROTOR_HUB_X + 45, ROTOR_HUB_Y + 14, color('gray', 4));
  blob(c, ROTOR_HUB_X, ROTOR_HUB_Y, 3, 2, () => color('gray', 2));
  return finished(c);
}

function tailBoom(): StubFrame {
  const c = canvas({ left: -40, top: -35, right: 30, bottom: 20 });
  for (let w = -1; w <= 1; w++) stroke(c, -30, 9 + w, 10, -11 + w, color('olive', 7 + w));
  stroke(c, 10, -11, 14, -26, color('olive', 6));
  stroke(c, 14, -26, 19, -24, color('olive', 6));
  stroke(c, 19, -24, 13, -10, color('olive', 6));
  return finished(c);
}

function skids(): StubFrame {
  const c = canvas({ left: -5, top: -25, right: 75, bottom: 20 });
  stroke(c, 0, 6, 50, -19, color('gray', 3));
  stroke(c, 20, 14, 70, -11, color('gray', 3));
  return finished(c);
}

function cockpit(): StubFrame {
  const c = canvas({ left: 0, top: -25, right: 30, bottom: -5 });
  blob(c, 14, -15, 9, 6, (nx, ny) => color('blue', 11 - nx * 2 - ny * 3));
  return finished(c);
}

function tailRotor(): StubFrame {
  const c = canvas({ left: 5, top: -32, right: 20, bottom: -8 });
  blob(c, 12, -20, 2, 8, () => color('gray', 5));
  return finished(c);
}

function vehiclePart(number: number, tiles: readonly (readonly [number, number])[], height: number): StructureDef {
  return { ...syntheticStructure(STRUCTURE_FLAGS, Orientation.NONE, { armour: StubMaterial.LIGHT_METAL, height, tiles }), number };
}

export const STUB_HELICOPTER_SURFACE: StubSurface = {
  type: 'FIRSTOSTRUCT',
  sprite: { path: 'helicopter', frames: [fuselage(), rotor(), tailBoom(), skids(), cockpit(), tailRotor()] },
  structures: [vehiclePart(FUSELAGE, FUSELAGE_TILES, BODY_CUBES), vehiclePart(TAIL_BOOM, BOOM_TILES, BOOM_CUBES)],
};

import { describe, expect, it } from 'vitest';
import { FormatError } from '../binary/errors.ts';
import { BinaryWriter } from '../binary/writer.ts';
import { SaveCursor } from './savegame-cursor.ts';
import { MAX_BOMB_QUEUE, readBullets, readExplosionTable, readItemCursor, readRealObjects } from './savegame-effects.ts';

const ROOF = 1;
const TRAILING_MARKER = 0xab;

function queueEntry(w: BinaryWriter, bomb: number, timestamp: number, exists: number): void {
  w.u32(bomb).u32(timestamp).u8(exists).zeros(3);
}

function explosionRecord(w: BinaryWriter): void {
  w.zeros(4).u8(2).u8(5).u16(131).i16(805).i16(675).i16(0).i16(12867).zeros(1).u8(ROOF).zeros(2).u8(1).zeros(1).i16(7).zeros(12);
}

function table(elements: number, explosions: number): Uint8Array {
  const w = new BinaryWriter().u8(elements).zeros(3);
  queueEntry(w, 3, 900_000, 0);
  queueEntry(w, 1, 901_250, 1);
  queueEntry(w, 7, 5, 1);
  for (let i = 3; i < MAX_BOMB_QUEUE; i++) queueEntry(w, 0, 0, 0);
  w.u32(explosions);
  for (let i = 0; i < explosions; i++) explosionRecord(w);
  return w.u8(TRAILING_MARKER).toBytes();
}

describe('readExplosionTable (Explosion_Control.cc LoadExplosionTableFromSavedGameFile)', () => {
  it('reads all 40 queue slots and keeps the counted ones, then the allocated explosions with their saved frame', () => {
    const c = new SaveCursor(table(2, 1));
    const saved = readExplosionTable(c);
    expect(saved.queue).toEqual([
      { worldBombIndex: 3, timestamp: 900_000, exists: false },
      { worldBombIndex: 1, timestamp: 901_250, exists: true },
    ]);
    expect(saved.explosions).toEqual([
      { ownerId: 2, animationId: 5, item: 131, x: 805, y: 675, z: 0, gridNo: 12867, level: ROOF, frame: 7 },
    ]);
    expect(c.u8()).toBe(TRAILING_MARKER);
  });

  it('rejects a queue count past its 40 slots', () => {
    expect(() => readExplosionTable(new SaveCursor(table(MAX_BOMB_QUEUE + 1, 0)))).toThrow(FormatError);
  });
});

const FIX = 1 << 20;
const KNIFE = 0x0002;
const NOBODY = 156;
const NO_SLOT_BYTE = 255;
const SMALLPOCK1 = 11;
const ARM_ITEM = 1;
const GRENADE_ITEM = 136;

function objectBytes(w: BinaryWriter, item: number, status: number): void {
  w.u16(item).u8(1).zeros(1).u8(status).zeros(31);
}

function bulletRecord(w: BinaryWriter, firer: number, target: number): void {
  w.zeros(4).u8(firer).u8(target).u8(1).u8(2).u32(12867).zeros(2).u16(9);
  w.i32(805 * FIX)
    .i32(675 * FIX)
    .i32(-3 * FIX)
    .i32(FIX)
    .i32(-FIX / 2)
    .i32(0)
    .f64(-0.4636476);
  w.i32(80).i32(67).u8(2).u8(1).u8(1).zeros(1).i32(3).i32(14);
  w.u8(1).u8(0).u8(1).u8(1).u8(1).zeros(3).u32(123_456).u8(1).zeros(1).u16(30).zeros(4);
  w.u32(12860).i16(-25).zeros(2).i32(31).i32(5).i32(240).i32(17).u16(KNIFE).zeros(2).zeros(8).u8(88).zeros(3);
}

function vector(w: BinaryWriter, x: number, y: number, z: number): void {
  w.f32(x).f32(y).f32(z);
}

function realObjectRecord(w: BinaryWriter): void {
  w.u8(1).u8(1).u8(0).zeros(2).u8(1).u8(0).u8(0).u8(0).u8(0).zeros(2).f32(0).zeros(4).f32(0.1);
  vector(w, 805.25, 675.5, 120.3);
  for (let k = 0; k < 7; k++) vector(w, k, -k, k / 3);
  vector(w, 0.7, -0.7, 0);
  w.f32(1.3).i16(12867).zeros(6).zeros(8).i16(2).i16(1).i32(1).f32(40.1).f32(7.2);
  objectBytes(w, GRENADE_ITEM, 97);
  w.u8(0).zeros(1).i16(12866).u8(4).u8(ARM_ITEM).zeros(2).u8(NOBODY).zeros(3).u8(1).zeros(3);
  w.u32(5).u8(0).u8(1).u8(0).u8(1).u8(1).zeros(3);
  vector(w, 803, 671, 0);
  w.u8(1).u8(0).i16(12867).u32(7).u8(23).zeros(3);
}

describe('readBullets (Bullets.cc LoadBulletStructureFromSavedGameFile, LoadSaveBullet.cc)', () => {
  it('reads the counted 128-byte bullets with their firer and target ids, fixed-point flight and saved angle, and drops the saved last update', () => {
    const w = new BinaryWriter().u32(1);
    bulletRecord(w, 4, NOBODY);
    const c = new SaveCursor(w.u8(TRAILING_MARKER).toBytes());
    const [b, ...rest] = readBullets(c);
    expect(rest).toEqual([]);
    expect(b).toEqual({
      firerId: 4,
      targetId: NOBODY,
      startCubesAbove: 1,
      endCubesAbove: 2,
      gridNo: 12867,
      lastStructureHit: 9,
      x: 805 * FIX,
      y: 675 * FIX,
      z: -3 * FIX,
      incX: FIX,
      incY: -FIX / 2,
      incZ: 0,
      horizAngle: -0.4636476,
      tileX: 80,
      tileY: 67,
      losX: 2,
      losY: 1,
      checkForRoof: true,
      cubesZ: 3,
      loop: 14,
      toDelete: false,
      located: true,
      real: true,
      aimed: true,
      tilesPerUpdate: 1,
      msPerUpdate: 30,
      targetGrid: 12860,
      hitBy: -25,
      impact: 31,
      impactReduction: 5,
      range: 240,
      distanceLimit: 17,
      flags: KNIFE,
      itemStatus: 88,
    });
    expect(c.u8()).toBe(TRAILING_MARKER);
  });
});

describe('readRealObjects (Physics.cc LoadPhysicsTableFromSavedGameFile, LoadSaveRealObject.cc)', () => {
  it('reads the counted 256-byte objects, their float fields as float32, their object and the owner and target ids', () => {
    const w = new BinaryWriter().u32(1);
    realObjectRecord(w);
    const c = new SaveCursor(w.u8(TRAILING_MARKER).toBytes());
    const [o] = readRealObjects(c);
    expect(o).toMatchObject({
      alive: true,
      applyFriction: false,
      visible: true,
      appliedMu: Math.fround(0.1),
      position: { x: 805.25, y: 675.5, z: Math.fround(120.3) },
      velocity: { x: 2, y: -2, z: Math.fround(2 / 3) },
      collisionNormal: { x: 6, y: -6, z: 2 },
      collisionVelocity: { x: Math.fround(0.7), y: Math.fround(-0.7), z: 0 },
      collisionElasticity: Math.fround(1.3),
      gridNo: 12867,
      consecutiveCollisions: 2,
      consecutiveZeroVelocityCollisions: 1,
      oldCollisionCode: 1,
      lifeLength: Math.fround(40.1),
      lifeSpan: Math.fround(7.2),
      object: { item: GRENADE_ITEM, count: 1, status: [97, 0, 0, 0, 0, 0, 0, 0] },
      firstTimeMoved: false,
      firstGridNo: 12866,
      ownerId: 4,
      action: ARM_ITEM,
      targetId: NOBODY,
      dropItem: true,
      numTilesMoved: 5,
      catchGood: false,
      attemptedCatch: true,
      catchAnimOn: false,
      catchCheckDone: true,
      endedWithCollisionPositionSet: true,
      endedWithCollisionPosition: { x: 803, y: 671, z: 0 },
      haveHitGround: true,
      lastTargetTakenDamage: 23,
    });
    expect(c.u8()).toBe(TRAILING_MARKER);
  });
});

describe('readItemCursor (Interface_Items.cc LoadItemCursorFromSavedGame)', () => {
  it('reads the object, its holder, the source slot as a signed byte and the active flag', () => {
    const w = new BinaryWriter();
    objectBytes(w, GRENADE_ITEM, 64);
    w.u8(3).u8(SMALLPOCK1).u8(1).zeros(5);
    objectBytes(w, GRENADE_ITEM, 64);
    w.u8(3).u8(NO_SLOT_BYTE).u8(0).zeros(5);
    const c = new SaveCursor(w.u8(TRAILING_MARKER).toBytes());
    expect(readItemCursor(c)).toMatchObject({
      object: { item: GRENADE_ITEM, status: [64, 0, 0, 0, 0, 0, 0, 0] },
      holderId: 3,
      sourceSlot: SMALLPOCK1,
      active: true,
    });
    expect(readItemCursor(c)).toMatchObject({ holderId: 3, sourceSlot: -1, active: false });
    expect(c.u8()).toBe(TRAILING_MARKER);
  });
});

import { describe, expect, it } from 'vitest';
import { BinaryWriter } from '../binary/writer.ts';
import { SaveCursor } from './savegame-cursor.ts';
import { readGroups, readStrategicInfo, readUndergroundSectors, readVehicles } from './savegame-strategic.ts';

const MAP_CELLS = 18 * 18;
const SECTOR_INFO_BYTES = 116;
const A9 = 8;

function strategicInfoBytes(): Uint8Array {
  const w = new BinaryWriter();
  for (let i = 0; i < MAP_CELLS; i++) {
    w.zeros(16)
      .u8(i === 27 ? 1 : 0)
      .u8(i === 27 ? 0 : 1)
      .u8(1)
      .zeros(1)
      .u8(i === 27 ? 77 : 0)
      .zeros(20);
  }
  for (let id = 0; id < 256; id++) {
    if (id !== A9) {
      w.zeros(SECTOR_INFO_BYTES);
      continue;
    }
    w.u32(0x10000020).zeros(1).u8(28).u8(0xff).u8(1).u8(40).u8(3).zeros(4);
    w.u8(5).u8(6).u8(7).u8(8).u8(1).u8(2).u8(3).u8(4).zeros(2);
    w.u32(11).u32(0x10).u8(12).u8(0).u8(1).u8(2).u8(0).zeros(2).u8(0xff).u8(9).zeros(1).u8(70).u8(1).u8(2).u8(3).zeros(6);
    w.u32(1867).zeros(4).u32(111691).u8(1).zeros(3).u32(2).zeros(44);
  }
  w.zeros(MAP_CELLS).u8(1);
  return w.toBytes();
}

describe('strategic savegame sections', () => {
  it('decodes map elements, the 116-byte SECTORINFO records and the Orta flag', () => {
    const info = readStrategicInfo(new SaveCursor(strategicInfoBytes()));
    expect(info.elements[27]).toEqual({ nameId: 1, enemyControlled: false, enemyAirControlled: true, samCondition: 77 });
    expect(info.elements[0]).toMatchObject({ nameId: 0, enemyControlled: true });
    expect(info.sectors[A9]).toEqual({
      flags: 0x10000020,
      garrisonId: 28,
      pendingReinforcements: -1,
      militiaTrainingPaid: true,
      militiaTrainingPercentDone: 40,
      militiaTrainingHundredths: 3,
      numTroops: 5,
      numElites: 6,
      numAdmins: 7,
      numCreatures: 8,
      troopsInBattle: 1,
      elitesInBattle: 2,
      adminsInBattle: 3,
      creaturesInBattle: 4,
      dayOfLastCreatureAttack: 11,
      facilities: 0x10,
      traversability: [12, 0, 1, 2, 0],
      bloodCats: -1,
      bloodCatPlacements: 9,
      travelRating: 70,
      militia: [1, 2, 3],
      timeLastLoaded: 1867,
      timeLastPlayerLiberated: 111691,
      surfaceWasEverPlayerControlled: true,
      visibleItems: 2,
    });
    expect(info.ortaFound).toBe(true);
  });

  it('decodes underground records, full groups with enemy data and waypoints, and vehicles', () => {
    const u = new BinaryWriter();
    u.u32(1)
      .u32(0x40)
      .u8(9)
      .u8(10)
      .u8(1)
      .u8(2)
      .u8(8)
      .u8(0)
      .u8(3)
      .zeros(5)
      .u32(500)
      .zeros(4)
      .u8(4)
      .u8(1)
      .u8(0)
      .u8(1)
      .u8(0)
      .u8(0)
      .zeros(2)
      .u32(6)
      .zeros(36);
    expect(readUndergroundSectors(new SaveCursor(u.toBytes()))).toEqual([
      {
        sector: { x: 9, y: 10, z: 1 },
        flags: 0x40,
        numElites: 2,
        numTroops: 8,
        numAdmins: 0,
        numCreatures: 3,
        timeLastLoaded: 500,
        adjacentSectors: 4,
        creatureHabitat: 1,
        elitesInBattle: 0,
        troopsInBattle: 1,
        adminsInBattle: 0,
        creaturesInBattle: 0,
        visibleItems: 6,
      },
    ]);
    const g = new BinaryWriter();
    g.u32(1);
    g.u8(0).u8(0).u8(0).u8(0).u8(7).u8(3).u8(3).u8(3).u8(0).u8(2).u8(3).u8(3).u8(2).u8(17).u8(1).u8(2).u8(1).zeros(3);
    g.u32(3260).u32(523).zeros(8).u8(1).zeros(3).u32(0x10).u8(32).u8(255).zeros(38);
    g.u8(3).u8(0).u8(1).zeros(1).u8(2).u8(0).u8(4).u8(1).u8(0).zeros(20);
    g.u32(2).u8(2).u8(3).zeros(6).u8(2).u8(2).zeros(6);
    g.zeros(32);
    const [group] = readGroups(new SaveCursor(g.toBytes()));
    expect(group).toMatchObject({
      id: 7,
      player: false,
      size: 3,
      sector: { x: 3, y: 3, z: 0 },
      next: { x: 2, y: 3 },
      prev: { x: 3, y: 2 },
      originalSector: 17,
      betweenSectors: true,
      moveType: 2,
      nextWaypointId: 1,
      arrivalTime: 3260,
      traverseTime: 523,
      transportMask: 1,
      flags: 0x10,
      createdSectorId: 32,
      enemy: { numTroops: 3, numElites: 0, numAdmins: 1, pendingReinforcements: 2, adminsInBattle: 0, intention: 4, troopsInBattle: 1 },
      waypoints: [
        { x: 2, y: 3 },
        { x: 2, y: 2 },
      ],
    });
    const v = new BinaryWriter();
    v.u8(2).u8(0).u8(1);
    v.zeros(4).u8(25).u8(5).i16(13).i16(2).i16(0).u8(0).zeros(3);
    for (let k = 0; k < 10; k++) v.u8(k === 0 ? 57 : 200).zeros(3);
    v.zeros(61).u8(0).zeros(2).u32(0).zeros(1).u8(1).zeros(2);
    v.u32(1).u32(45).zeros(16);
    expect(readVehicles(new SaveCursor(v.toBytes()), 99)).toEqual([
      expect.objectContaining({ slot: 0, valid: false }),
      {
        slot: 1,
        valid: true,
        movementGroup: 25,
        type: 5,
        sector: { x: 13, y: 2, z: 0 },
        betweenSectors: false,
        passengerProfiles: [57],
        destroyed: false,
        path: [45],
      },
    ]);
  });
});

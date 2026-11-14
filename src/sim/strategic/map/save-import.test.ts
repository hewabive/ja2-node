import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { ORIGINAL_DATA_DIR } from '../../../../tests/support/original-data.ts';
import { loadStrategicTestContent, testContext } from '../../../../tests/support/strategic.ts';
import { parseSaveGame, type SaveGame } from '../../../content/formats/savegame.ts';
import { parseSaveEncryptionTable } from '../../../content/formats/savegame-header.ts';
import type { StrategicContent } from '../../../content/strategic/strategic-content.ts';
import { PlacementButton } from '../forces/battle-state.ts';
import { SectorFlag } from '../forces/constants.ts';
import { EventKind } from '../time/constants.ts';
import { importStrategicTime } from '../time/save-import.ts';
import { importStrategicMap } from './save-import.ts';
import { calculateTravelTimeOfGroup } from './travel.ts';

let content: StrategicContent;

beforeAll(async () => {
  content = await loadStrategicTestContent();
});

const D13 = { x: 13, y: 4, z: 0 };
const D13_ID = 3 * 16 + 12;

function sectorRecord(flags = 0) {
  return {
    flags,
    garrisonId: 255,
    pendingReinforcements: 0,
    militiaTrainingPaid: false,
    militiaTrainingPercentDone: 0,
    militiaTrainingHundredths: 0,
    numTroops: 0,
    numElites: 0,
    numAdmins: 0,
    numCreatures: 0,
    troopsInBattle: 0,
    elitesInBattle: 0,
    adminsInBattle: 0,
    creaturesInBattle: 0,
    dayOfLastCreatureAttack: 0,
    facilities: 0,
    traversability: [1, 1, 1, 1, 1],
    bloodCats: -1,
    bloodCatPlacements: 0,
    travelRating: 0,
    militia: [0, 0, 0],
    timeLastLoaded: 0,
    timeLastPlayerLiberated: 0,
    surfaceWasEverPlayerControlled: false,
    visibleItems: 0,
  };
}

function syntheticSave(): SaveGame {
  const group = (id: number, player: boolean, profiles: number[]) => ({
    id,
    debug: false,
    player,
    vehicle: false,
    persistent: player,
    size: player ? profiles.length + 1 : 3,
    sector: D13,
    next: { x: 13, y: 5 },
    prev: { x: 12, y: 4 },
    originalSector: D13_ID,
    betweenSectors: !player,
    moveType: player ? 0 : 2,
    nextWaypointId: 0,
    arrivalTime: 3000,
    traverseTime: 89,
    transportMask: 1,
    flags: 0,
    createdSectorId: D13_ID,
    sectorIdOfLastReassignment: 255,
    playerProfiles: profiles,
    enemy: player
      ? null
      : {
          numTroops: 3,
          numElites: 0,
          numAdmins: 0,
          pendingReinforcements: 0,
          adminsInBattle: 0,
          intention: 3,
          troopsInBattle: 0,
          elitesInBattle: 0,
        },
    waypoints: player ? [] : [{ x: 13, y: 5 }],
  });
  const soldier = (id: number, profile: number, groupId: number) => ({
    soldier: { id, profile, team: 0, groupId, statusFlags: 0, vehicleSlot: -1 },
  });
  return {
    header: { worldLoaded: true },
    tactical: { worldSector: D13 },
    generalInfo: {
      selectedSector: D13,
      foundTixa: true,
      samSitesFound: [false, true, false, false],
      deadSquadMembers: Array.from({ length: 20 }, (_, q) => (q === 1 ? [57, -1, -1, -1, -1, -1] : [-1, -1, -1, -1, -1, -1])),
      helicopterVehicleId: -1,
      helicopterAirborne: false,
      helicopter: {
        setUp: false,
        returningToBase: false,
        hovering: false,
        startHoverMinute: 0,
        totalCost: 0,
        destroyed: false,
        talkState: 0,
        lastMonologueMinute: 0,
        emptyHelpGiven: false,
        hitsTaken: 0,
        saidCongratsOnTakingSam: false,
        progressLastCommentedOn: 0,
        refuelSiteAvailable: [false, false],
      },
      disableMapInterfaceDueToBattle: false,
      placementButton: 1,
    },
    strategicInfo: {
      elements: Array.from({ length: 324 }, () => ({ nameId: 0, enemyControlled: true, enemyAirControlled: false, samCondition: 0 })),
      sectors: Array.from({ length: 256 }, (_, id) =>
        sectorRecord(id === D13_ID ? SectorFlag.MAP_MODIFICATIONS_TEMP_FILE_EXISTS | SectorFlag.ALREADY_VISITED : 0),
      ),
      ortaFound: false,
    },
    undergroundSectors: [],
    soldiers: [soldier(0, 10, 30), soldier(1, 15, 30), soldier(2, 59, 31)],
    groups: [group(1, false, []), group(30, true, [10, 15, 59])],
    squads: [[0, 1], ...Array.from({ length: 19 }, () => [])],
    squadMovementGroups: Array.from({ length: 20 }, (_, q) => 30 + q),
    vehicles: [],
    vehicleMovementGroups: Array.from({ length: 10 }, (_, k) => 50 + k),
  } as unknown as SaveGame;
}

describe('importStrategicMap on a synthetic save', () => {
  it('fills the map, the groups with their members and the squads', () => {
    const ctx = testContext({ content });
    importStrategicMap(ctx, syntheticSave());
    const s = ctx.state;
    expect(s.forces.groups.map((g) => g.id)).toEqual([1, 30]);
    expect(s.forces.groups[1]).toMatchObject({ members: [0, 1], size: 2, next: { x: 13, y: 5, z: 0 } });
    expect(s.forces.groups[0]).toMatchObject({ size: 3, enemy: { numTroops: 3, intention: 3 }, waypoints: [{ x: 13, y: 5, z: 0 }] });
    expect(s.forces.squads[0]).toEqual([0, 1]);
    expect(s.forces.squadGroupIds[19]).toBe(49);
    expect(s.forces.deadSquadMembers[1]?.[0]).toBe(57);
    expect(s.map.secretsFound).toEqual([true, false, false, true, false, false]);
    expect(s.worldSector).toEqual(D13);
    expect(s.map.sectors[D13_ID]?.flags).toBe((SectorFlag.MAP_MODIFICATIONS_TEMP_FILE_EXISTS | SectorFlag.ALREADY_VISITED) >>> 0);
  });

  it("keeps the placement GUI's saved default button, which the next placement opens with (SaveLoadGame.cc:1994 gubDefaultButton)", () => {
    const ctx = testContext({ content });
    expect(ctx.state.battle.placementButton).toBe(PlacementButton.CLEAR);
    importStrategicMap(ctx, syntheticSave());
    expect(ctx.state.battle.placementButton).toBe(PlacementButton.SPREAD);
  });

  it('links each vehicle to the first active soldier who is it, on any team, and refills the list in place for the tactical layer that shares it (Vehicles.cc FindSoldierType)', () => {
    const SOLDIER_VEHICLE = 0x00008000;
    const HUMVEE = 22;
    const ICECREAMTRUCK = 26;
    const vehicle = (slot: number) => ({
      slot,
      valid: true,
      movementGroup: 50 + slot,
      type: slot,
      sector: D13,
      betweenSectors: false,
      passengerProfiles: [],
      passengerSlots: [],
      destroyed: false,
      path: [],
    });
    const vehicleSoldier = (id: number, team: number, bodyType: number, vehicleSlot: number, active = 1) => ({
      soldier: { id, profile: 200, team, groupId: 0, statusFlags: SOLDIER_VEHICLE, bodyType, vehicleSlot, active },
    });
    const base = syntheticSave();
    const save = {
      ...base,
      soldiers: [
        ...base.soldiers,
        vehicleSoldier(18, 0, HUMVEE, 0),
        vehicleSoldier(117, 4, ICECREAMTRUCK, 1, 0),
        vehicleSoldier(120, 4, ICECREAMTRUCK, 1),
        vehicleSoldier(121, 4, ICECREAMTRUCK, 1),
      ],
      vehicles: [vehicle(0), vehicle(1), vehicle(2)],
    } as unknown as SaveGame;
    const ctx = testContext({ content });
    const shared = ctx.state.forces.vehicles;
    importStrategicMap(ctx, save);
    expect(ctx.state.forces.vehicles).toBe(shared);
    expect(shared.map((v) => v.soldierId)).toEqual([18, 120, -1]);
  });
});

const dataDir = ORIGINAL_DATA_DIR;
const savesDir = join(dirname(dataDir), 'SavedGames');
const saveFiles = dataDir && existsSync(savesDir) ? readdirSync(savesDir).filter((f) => f.toLowerCase().endsWith('.sav')) : [];

describe.skipIf(!ORIGINAL_DATA_DIR)('importStrategicMap on the native saves', () => {
  const encryption = parseSaveEncryptionTable(
    JSON.parse(readFileSync(join(import.meta.dirname, '../../../../data/tables/save-encryption.json'), 'utf8')),
  );

  for (const file of saveFiles) {
    it(`imports ${file} consistently`, () => {
      const save = parseSaveGame(new Uint8Array(readFileSync(join(savesDir, file))), encryption);
      const ctx = testContext({ content });
      importStrategicTime(ctx.state, save);
      importStrategicMap(ctx, save);
      const { forces, map, queue } = ctx.state;
      expect(new Set(forces.groups.map((g) => g.id)).size).toBe(forces.groups.length);
      expect(map.sectors.map((s) => s.traversability)).toEqual(save.strategicInfo.sectors.map((s) => s.traversability));
      for (const [q, members] of forces.squads.entries()) {
        const g = forces.groups.find((x) => x.id === forces.squadGroupIds[q]);
        expect(g?.persistent).toBe(true);
        expect(g?.members).toEqual(members);
      }
      for (const g of forces.groups) {
        if (g.betweenSectors) {
          expect(queue.events.some((e) => e.kind === EventKind.GROUP_ARRIVAL && e.param === g.id && e.stamp === g.arrivalTime * 60)).toBe(
            true,
          );
        }
        if (!g.player) expect(Number.isInteger(calculateTravelTimeOfGroup(ctx, g))).toBe(true);
        if (g.player) expect(g.members.length).toBe(g.size);
      }
      expect(map.underground).toHaveLength(content.underground.length);
    });
  }
});

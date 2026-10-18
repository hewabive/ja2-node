import { isVisibleTile } from '../../src/content/world/grid.ts';
import { TacticalSession } from '../../src/server/sandbox.ts';
import { stubMerc } from '../../src/server/stub-mercs.ts';
import { calcDifficultyModifier } from '../../src/sim/strategic/ai/difficulty.ts';
import { Difficulty } from '../../src/sim/strategic/forces/constants.ts';
import type { TacticalContent } from '../../src/sim/tactical/content.ts';
import { createMercFromProfile } from '../../src/sim/tactical/creation.ts';
import { loadMapEdgepoints } from '../../src/sim/tactical/edgepoints.ts';
import {
  addSoldierInitListEnemyDefenceSoldiers,
  addSoldierInitListMilitia,
  addSoldierInitListTeamToWorld,
  buildSoldierInitList,
  drawStandingFrame,
  type PopulationEnv,
} from '../../src/sim/tactical/init-list.ts';
import { addSoldierToSector, Insertion } from '../../src/sim/tactical/insertion.ts';
import { lightSpriteRenderAll } from '../../src/sim/tactical/lighting/lighting.ts';
import { PlacementVerdict } from '../../src/sim/tactical/narrative/placement.ts';
import { firstFreeSoldierId, type Soldier, SoldierClass, Team } from '../../src/sim/tactical/soldier.ts';
import { TacticalSim } from '../../src/sim/tactical/tactical-sim.ts';
import { loadWorldItemsFromMap } from '../../src/sim/tactical/world-items.ts';
import type { Garrison } from './arena.ts';
import type { BenchData } from './data.ts';

export const BENCH_SQUAD: readonly number[] = [0, 3, 4, 7, 14, 16];
const MERC_DIRECTION = 4;
const NO_TOWN = 0;

export interface Sector2 {
  readonly x: number;
  readonly y: number;
}

export interface TacticalPopulation {
  readonly sector: Sector2;
  readonly mercs: number;
  readonly mercGridNos: readonly number[] | null;
  readonly garrison: Garrison;
  readonly militia: number;
}

function population(content: TacticalContent, sector: Sector2): PopulationEnv {
  const inputs = {
    difficulty: Difficulty.MEDIUM,
    highestProgress: 0,
    predictedMineIncome: 0,
    battleSector: sector,
    battleSectorTownId: NO_TOWN,
  };
  return {
    difficultyModifier: (soldierClass) => calcDifficultyModifier(inputs, soldierClass),
    difficulty: Difficulty.MEDIUM,
    bloodcatLair: false,
    locationModifier: 0,
    autoResolveActive: false,
    profileHere: (p) => content.profiles[p]?.sectorX === sector.x && content.profiles[p]?.sectorY === sector.y,
    iceCreamTruckWithheld: () => false,
    civilianPlacement: () => PlacementVerdict.CREATE,
    upgradeEliteToProfiledEnemy: () => {},
    resetProfiledEnemyAdded: () => {},
  };
}

function entryGridNo(sim: TacticalSim): number {
  const info = sim.world.map.info;
  const entry = [info.centerGridNo, info.northGridNo].find((g) => isVisibleTile(g));
  if (entry === undefined) throw new Error(`${sim.mapPath}: no entry point`);
  return entry;
}

function nextMerc(sim: TacticalSim, index: number): Soldier {
  const t = sim.state;
  const id = firstFreeSoldierId((n) => t.soldiers[n] !== undefined, Team.OUR);
  const profiles = t.content.profiles;
  if (profiles.length === 0) return stubMerc(t.content, id);
  const profile = profiles[BENCH_SQUAD[index] ?? -1];
  if (!profile) throw new Error(`no merc profile for squad slot ${index}`);
  return createMercFromProfile(t, id, profile, MERC_DIRECTION);
}

function placeMerc(sim: TacticalSim, s: Soldier, gridNo: number): void {
  const t = sim.state;
  drawStandingFrame(t);
  s.insertionGridNo = gridNo;
  addSoldierToSector(t, s, { code: Insertion.GRIDNO, data: gridNo, direction: s.direction }, {}, true);
}

export function populateTactical(sim: TacticalSim, p: TacticalPopulation): void {
  const t = sim.state;
  const env = population(t.content, p.sector);
  t.campaign = { difficultyModifier: env.difficultyModifier(SoldierClass.ARMY), progress: 0 };
  t.edgepoints = loadMapEdgepoints(t, { ...p.sector, z: 0 });
  t.initList = buildSoldierInitList(sim.world.map);
  loadWorldItemsFromMap(t, sim.world.map.items);
  lightSpriteRenderAll(t);
  const entry = p.mercGridNos ? null : entryGridNo(sim);
  for (let i = 0; i < p.mercs; i++) placeMerc(sim, nextMerc(sim, i), p.mercGridNos?.[i] ?? entry ?? 0);
  addSoldierInitListTeamToWorld(t, Team.CIV, env);
  if (p.militia > 0) addSoldierInitListMilitia(t, 0, p.militia, 0, env);
  addSoldierInitListEnemyDefenceSoldiers(t, p.garrison, env);
}

export async function createTacticalBench(data: BenchData, mapPath: string, seed: number, p: TacticalPopulation): Promise<TacticalSession> {
  const [world, content] = await Promise.all([data.world(mapPath), data.content()]);
  const sim = new TacticalSim(world, content, seed);
  populateTactical(sim, p);
  sim.lookAround();
  return new TacticalSession(sim);
}

export function livingOf(sim: TacticalSim, teams: readonly number[]): number {
  return sim.state.soldiers.filter((s) => s?.placed && teams.includes(s.team) && s.life > 0).length;
}

import { isVisibleTile } from '../content/world/grid.ts';
import { loadTacticalWorld } from '../content/world/tactical-world.ts';
import type { ReadFile } from '../content/world/tileset-loader.ts';
import type { CommandEnvelope } from '../protocol/messages.ts';
import type { PlayerView } from '../protocol/view.ts';
import type { CommandResult } from '../sim/command.ts';
import type { SimEvent } from '../sim/events.ts';
import { createItem, createItems } from '../sim/items/object.ts';
import { calcDifficultyModifier } from '../sim/strategic/ai/difficulty.ts';
import { Difficulty } from '../sim/strategic/forces/constants.ts';
import { states } from '../sim/tactical/animation.ts';
import { createMercFromProfile } from '../sim/tactical/creation.ts';
import { loadMapEdgepoints } from '../sim/tactical/edgepoints.ts';
import {
  addSoldierInitListEnemyDefenceSoldiers,
  addSoldierInitListTeamToWorld,
  buildSoldierInitList,
  drawStandingFrame,
  type PopulationEnv,
} from '../sim/tactical/init-list.ts';
import { addSoldierToSector, Insertion } from '../sim/tactical/insertion.ts';
import { InvSlot } from '../sim/tactical/inventory.ts';
import { lightSpriteRenderAll } from '../sim/tactical/lighting/lighting.ts';
import { loadTacticalContent } from '../sim/tactical/load-content.ts';
import { revealedRooms } from '../sim/tactical/perception/fov.ts';
import { createSoldier, firstFreeSoldierId, type Soldier, SoldierClass, Team } from '../sim/tactical/soldier.ts';
import { teamMembers } from '../sim/tactical/state.ts';
import { TacticalSim } from '../sim/tactical/tactical-sim.ts';
import { loadWorldItemsFromMap } from '../sim/tactical/world-items.ts';
import type { SessionSim } from './session.ts';

export const ORIGINAL_SANDBOX_MAP = 'maps/a9.dat';
export const STUB_SANDBOX_MAP = 'stubs/world/maps/village.dat';
const SANDBOX_SQUAD = [0, 3, 4, 7, 14, 16];
const STUB_SQUAD_SIZE = 4;
const DEFAULT_SEED = 1;

export class TacticalSession implements SessionSim {
  readonly sim: TacticalSim;

  constructor(sim: TacticalSim) {
    this.sim = sim;
  }

  get tick(): number {
    return this.sim.tick;
  }

  isIdle(): boolean {
    return this.sim.isIdle();
  }

  hasPendingDecision(): boolean {
    return this.sim.hasPendingDecision();
  }

  step(): void {
    this.sim.step();
  }

  drainEvents(): SimEvent[] {
    return this.sim.drainEvents();
  }

  dispatch(cmd: CommandEnvelope): CommandResult {
    return this.sim.dispatch(cmd);
  }

  view(): PlayerView {
    return tacticalPlayerView(this.sim, this.sim.tick);
  }
}

export function tacticalPlayerView(sim: TacticalSim, tick: number): PlayerView {
  return {
    tick,
    mapPath: sim.mapPath,
    soldiers: sim.snapshot((s) => s.team === Team.OUR || s.visible >= 0),
    openDoors: sim.openDoors(),
    combat: sim.combatView(),
    revealedRooms: revealedRooms(sim.state),
    items: sim.visibleItems(),
  };
}

function sectorOf(mapPath: string): { x: number; y: number } | null {
  const m = /([a-p])(\d{1,2})\.dat$/i.exec(mapPath);
  return m ? { x: Number(m[2]), y: (m[1] as string).toLowerCase().charCodeAt(0) - 96 } : null;
}

const SANDBOX_SECTOR = { x: 9, y: 1 };
const SANDBOX_GARRISON = { admins: 0, troops: 4, elites: 0 };
const NO_TOWN = 0;

function sandboxPopulation(sim: TacticalSim): PopulationEnv {
  const sector = sectorOf(sim.mapPath) ?? SANDBOX_SECTOR;
  const profiles = sim.state.content.profiles;
  const inputs = {
    difficulty: Difficulty.MEDIUM,
    highestProgress: 0,
    predictedMineIncome: 0,
    battleSector: sector,
    battleSectorTownId: NO_TOWN,
  };
  return {
    difficultyModifier: (soldierClass) => calcDifficultyModifier(inputs, soldierClass),
    locationModifier: 0,
    autoResolveActive: false,
    profileHere: (p) => profiles[p]?.sectorX === sector.x && profiles[p]?.sectorY === sector.y,
    civilianWithheld: () => false,
  };
}

function placeMerc(t: TacticalSim['state'], s: Soldier, entry: number): void {
  drawStandingFrame(t);
  s.insertionGridNo = entry;
  addSoldierToSector(t, s, { code: Insertion.GRIDNO, data: entry, direction: s.direction }, {}, true);
}

const FALLBACK_ENTRY = 12880;

function entryGridNo(sim: TacticalSim): number {
  const info = sim.world.map.info;
  return [info.northGridNo, info.centerGridNo].find((g) => isVisibleTile(g)) ?? FALLBACK_ENTRY;
}

const STUB_MERC_GUN = 'GLOCK_17';
const STUB_MERC_MAGAZINE = 'CLIP9_15';
const STUB_MERC_SPARE_MAGAZINES = 2;

function armStubMerc(sim: TacticalSim, s: Soldier): Soldier {
  const items = sim.state.content.items;
  const gun = items.byName.get(STUB_MERC_GUN);
  const magazine = items.byName.get(STUB_MERC_MAGAZINE);
  if (gun) s.inv[InvSlot.HAND] = createItem(items, gun.index, 100);
  if (magazine) s.inv[InvSlot.BIGPOCK1] = createItems(items, magazine.index, 100, STUB_MERC_SPARE_MAGAZINES);
  return s;
}

function stubMerc(sim: TacticalSim, id: number): Soldier {
  const bodies = [0, 1, 3, 2];
  const vests = ['BLUEVEST', 'GREENVEST', 'YELLOWVEST', 'BROWNVEST'];
  return armStubMerc(
    sim,
    createSoldier({
      id,
      team: Team.OUR,
      name: `Merc ${id + 1}`,
      bodyType: bodies[id % bodies.length] ?? 0,
      palettes: { hair: 'BROWNHEAD', skin: 'TANSKIN', vest: vests[id % vests.length] ?? 'BLUEVEST', pants: 'JEANPANTS' },
      stats: {
        agility: 80,
        dexterity: 80,
        strength: 80,
        wisdom: 80,
        leadership: 50,
        marksmanship: 80,
        mechanical: 30,
        explosives: 30,
        medical: 30,
        experience: 3,
      },
      life: 100,
      gridNo: -1,
      direction: 4,
      state: states(sim.state.content.animations).STANDING,
    }),
  );
}

export function populateSandbox(sim: TacticalSim): void {
  const t = sim.state;
  const entry = entryGridNo(sim);
  const idFor = (team: number) => firstFreeSoldierId((id) => t.soldiers[id] !== undefined, team);
  const profiles = t.content.profiles;
  const env = sandboxPopulation(sim);
  t.campaign = { difficultyModifier: env.difficultyModifier(SoldierClass.ARMY), progress: 0 };
  t.edgepoints = loadMapEdgepoints(t, { ...(sectorOf(sim.mapPath) ?? SANDBOX_SECTOR), z: 0 });
  t.initList = buildSoldierInitList(sim.world.map);
  loadWorldItemsFromMap(t, sim.world.map.items);
  lightSpriteRenderAll(t);
  for (const p of profiles.length > 0 ? SANDBOX_SQUAD : []) {
    const profile = profiles[p];
    if (profile) placeMerc(t, createMercFromProfile(t, idFor(Team.OUR), profile, 4), entry);
  }
  if (teamMembers(t, Team.OUR).length === 0) for (let i = 0; i < STUB_SQUAD_SIZE; i++) placeMerc(t, stubMerc(sim, idFor(Team.OUR)), entry);
  addSoldierInitListTeamToWorld(t, Team.CIV, env);
  addSoldierInitListEnemyDefenceSoldiers(t, SANDBOX_GARRISON, env);
}

export async function createSandboxSession(read: ReadFile, originalData: boolean, seed = DEFAULT_SEED): Promise<TacticalSession> {
  const mapPath = originalData ? ORIGINAL_SANDBOX_MAP : STUB_SANDBOX_MAP;
  const [world, content] = await Promise.all([loadTacticalWorld(read, mapPath), loadTacticalContent(read)]);
  const sim = new TacticalSim(world, content, seed);
  populateSandbox(sim);
  sim.lookAround();
  return new TacticalSession(sim);
}

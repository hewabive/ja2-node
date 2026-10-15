import { isVisibleTile } from '../content/world/grid.ts';
import { loadTacticalWorld } from '../content/world/tactical-world.ts';
import type { ReadFile } from '../content/world/tileset-loader.ts';
import type { CommandEnvelope } from '../protocol/messages.ts';
import type { PlayerView } from '../protocol/view.ts';
import type { CommandResult } from '../sim/command.ts';
import type { SimEvent } from '../sim/events.ts';
import { states } from '../sim/tactical/animation.ts';
import {
  addSoldierToSector,
  chooseEnemyPlacements,
  createFromPlacement,
  createMercFromProfile,
  SANDBOX_POPULATION,
} from '../sim/tactical/creation.ts';
import { loadTacticalContent } from '../sim/tactical/load-content.ts';
import { revealedRooms } from '../sim/tactical/perception/fov.ts';
import { createSoldier, firstFreeSoldierId, NO_PROFILE, type Soldier, Team } from '../sim/tactical/soldier.ts';
import { teamMembers } from '../sim/tactical/state.ts';
import { TacticalSim } from '../sim/tactical/tactical-sim.ts';
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
    return {
      tick: this.sim.tick,
      mapPath: this.sim.mapPath,
      soldiers: this.sim.snapshot((s) => s.team === Team.OUR || s.visible >= 0),
      openDoors: this.sim.openDoors(),
      combat: this.sim.combatView(),
      revealedRooms: revealedRooms(this.sim.state),
    };
  }
}

function sectorOf(mapPath: string): { x: number; y: number } | null {
  const m = /([a-p])(\d{1,2})\.dat$/i.exec(mapPath);
  return m ? { x: Number(m[2]), y: (m[1] as string).toLowerCase().charCodeAt(0) - 96 } : null;
}

const FALLBACK_ENTRY = 12880;

function entryGridNo(sim: TacticalSim): number {
  const info = sim.world.map.info;
  return [info.northGridNo, info.centerGridNo].find((g) => isVisibleTile(g)) ?? FALLBACK_ENTRY;
}

function stubMerc(sim: TacticalSim, id: number): Soldier {
  const bodies = [0, 1, 3, 2];
  const vests = ['BLUEVEST', 'GREENVEST', 'YELLOWVEST', 'BROWNVEST'];
  return createSoldier({
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
  });
}

export function populateSandbox(sim: TacticalSim): void {
  const mapPlacements = sim.world.map.placements;
  const t = sim.state;
  const entry = entryGridNo(sim);
  const idFor = (team: number) => firstFreeSoldierId((id) => t.soldiers[id] !== undefined, team);
  const profiles = t.content.profiles;
  for (const p of profiles.length > 0 ? SANDBOX_SQUAD : []) {
    const profile = profiles[p];
    if (profile) addSoldierToSector(t, createMercFromProfile(t, idFor(Team.OUR), profile, 4), entry);
  }
  if (teamMembers(t, Team.OUR).length === 0)
    for (let i = 0; i < STUB_SQUAD_SIZE; i++) addSoldierToSector(t, stubMerc(sim, idFor(Team.OUR)), entry);
  const sector = sectorOf(sim.mapPath);
  for (const placement of chooseEnemyPlacements(t, mapPlacements, SANDBOX_POPULATION.enemyTroops)) {
    const soldier = createFromPlacement(t, idFor(placement.basic.team), placement, SANDBOX_POPULATION);
    if (soldier) addSoldierToSector(t, soldier, placement.basic.startingGridNo);
  }
  for (const placement of mapPlacements.filter((p) => p.basic.team === Team.CIV)) {
    const soldier = createFromPlacement(t, idFor(Team.CIV), placement, SANDBOX_POPULATION);
    if (!soldier) continue;
    if (soldier.profile !== NO_PROFILE) {
      const profile = profiles[soldier.profile];
      if (!profile || !sector || profile.sectorX !== sector.x || profile.sectorY !== sector.y) continue;
    }
    addSoldierToSector(t, soldier, placement.basic.startingGridNo);
  }
}

export async function createSandboxSession(read: ReadFile, originalData: boolean, seed = DEFAULT_SEED): Promise<TacticalSession> {
  const mapPath = originalData ? ORIGINAL_SANDBOX_MAP : STUB_SANDBOX_MAP;
  const [world, content] = await Promise.all([loadTacticalWorld(read, mapPath), loadTacticalContent(read)]);
  const sim = new TacticalSim(world, content, seed);
  populateSandbox(sim);
  sim.lookAround();
  return new TacticalSession(sim);
}

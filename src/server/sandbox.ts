import { type PresentationTimeline, requireAnimationTimelines } from '../content/anim/timelines.ts';
import { type ProfileFaceRecord, profileFaceRecord } from '../content/narrative/profile-presentation.ts';
import { type DataDecoding, DEFAULT_DATA_DECODING } from '../content/text/data-version.ts';
import { isVisibleTile } from '../content/world/grid.ts';
import { loadTacticalWorld } from '../content/world/tactical-world.ts';
import type { ReadFile } from '../content/world/tileset-loader.ts';
import type { CommandEnvelope } from '../protocol/messages.ts';
import { initialMusic, type MusicFacts, type MusicState } from '../protocol/music.ts';
import { MusicMode } from '../protocol/music-modes.ts';
import type { PlayerView, SoldierView } from '../protocol/view.ts';
import type { CommandResult } from '../sim/command.ts';
import type { SimEvent } from '../sim/events.ts';
import { tacticalViewParts } from '../sim/knowledge/sim-view.ts';
import { calcDifficultyModifier } from '../sim/strategic/ai/difficulty.ts';
import { Difficulty } from '../sim/strategic/forces/constants.ts';
import type { TacticalContent } from '../sim/tactical/content.ts';
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
import { lightSpriteRenderAll } from '../sim/tactical/lighting/lighting.ts';
import { loadTacticalContent } from '../sim/tactical/load-content.ts';
import { PlacementVerdict } from '../sim/tactical/narrative/placement.ts';
import { firstFreeSoldierId, Side, type Soldier, SoldierClass, Team } from '../sim/tactical/soldier.ts';
import { teamMembers } from '../sim/tactical/state.ts';
import { TacticalSim } from '../sim/tactical/tactical-sim.ts';
import { loadWorldItemsFromMap } from '../sim/tactical/world-items.ts';
import { type MessageFacts, tacticalMessageFacts } from './message-facts.ts';
import type { SessionSim } from './session.ts';
import { PROFILE_VOICE, type VoiceOf, withVoices } from './soldier-voice.ts';
import { stubMerc } from './stub-mercs.ts';

export const ORIGINAL_SANDBOX_MAP = 'maps/a9.dat';
export const STUB_SANDBOX_MAP = 'stubs/world/maps/village.dat';
const SANDBOX_SQUAD = [0, 3, 4, 7, 14, 16];
const STUB_SQUAD_SIZE = 4;
const DEFAULT_SEED = 1;

export class TacticalSession implements SessionSim {
  readonly sim: TacticalSim;
  readonly presentation: PresentationTimeline;

  constructor(sim: TacticalSim, presentation: PresentationTimeline) {
    this.sim = sim;
    this.presentation = presentation;
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
    return tacticalPlayerView(this.sim, this.sim.tick, this.presentation);
  }

  tacticalContent(): TacticalContent {
    return this.sim.state.content;
  }

  get initialMusic(): MusicState {
    return initialMusic(this.sim.state.turn.enemyInSector ? MusicMode.TACTICAL_ENEMY_PRESENT : MusicMode.TACTICAL_NOTHING);
  }

  profileFaceRecords(): ProfileFaceRecord[] {
    return this.sim.state.content.profiles.filter((p) => p !== undefined).map(profileFaceRecord);
  }

  messageFacts(): MessageFacts {
    return tacticalMessageFacts(this.sim, (id) => this.sim.state.soldiers[id] ?? null);
  }

  musicFacts(): MusicFacts {
    const t = this.sim.state;
    const hostiles = t.soldiers.filter((s) => s?.placed && s.life > 0 && !s.neutral && s.side !== Side.FRIENDLY && s.team !== Team.OUR);
    return { creature: false, inCombat: t.inCombat, sectorLoaded: true, hostiles: hostiles.length, gameJustStarted: false };
  }
}

const SANDBOX_SQUAD_INDEX = 0;
const SANDBOX_CREW: Pick<SoldierView, 'asleep' | 'squad' | 'vehicle'> = { asleep: false, squad: SANDBOX_SQUAD_INDEX, vehicle: null };

function withSandboxCrew(views: readonly SoldierView[]): SoldierView[] {
  return views.map((v) => (v.team === Team.OUR ? { ...v, ...SANDBOX_CREW } : v));
}

export function tacticalPlayerView(
  sim: TacticalSim,
  tick: number,
  presentation: PresentationTimeline,
  voiceOf: VoiceOf = PROFILE_VOICE,
): PlayerView {
  const parts = tacticalViewParts(sim, presentation);
  return { tick, ...parts, soldiers: withSandboxCrew(withVoices(parts.soldiers, sim.state.soldiers, voiceOf)) };
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
    difficulty: Difficulty.MEDIUM,
    bloodcatLair: false,
    locationModifier: 0,
    autoResolveActive: false,
    profileHere: (p) => profiles[p]?.sectorX === sector.x && profiles[p]?.sectorY === sector.y,
    iceCreamTruckWithheld: () => false,
    civilianPlacement: () => PlacementVerdict.CREATE,
    upgradeEliteToProfiledEnemy: () => {},
    resetProfiledEnemyAdded: () => {},
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
  if (teamMembers(t, Team.OUR).length === 0)
    for (let i = 0; i < STUB_SQUAD_SIZE; i++) placeMerc(t, stubMerc(t.content, idFor(Team.OUR)), entry);
  addSoldierInitListTeamToWorld(t, Team.CIV, env);
  addSoldierInitListEnemyDefenceSoldiers(t, SANDBOX_GARRISON, env);
}

export async function createSandboxSession(
  read: ReadFile,
  originalData: boolean,
  seed = DEFAULT_SEED,
  decoding: DataDecoding = DEFAULT_DATA_DECODING,
): Promise<TacticalSession> {
  const mapPath = originalData ? ORIGINAL_SANDBOX_MAP : STUB_SANDBOX_MAP;
  const [world, content, timelines] = await Promise.all([
    loadTacticalWorld(read, mapPath),
    loadTacticalContent(read, decoding),
    requireAnimationTimelines(read),
  ]);
  const sim = new TacticalSim(world, content, seed);
  populateSandbox(sim);
  sim.lookAround();
  return new TacticalSession(sim, timelines.presentation);
}

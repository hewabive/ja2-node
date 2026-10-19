import type { ItemTable } from '../../content/items/items.ts';
import { type EconomyContent, loadEconomyContent } from '../../content/strategic/economy-content.ts';
import { sameSector } from '../../content/strategic/sector-ids.ts';
import { loadStrategicContent, type StrategicContent } from '../../content/strategic/strategic-content.ts';
import type { ReadFile } from '../../content/world/tileset-loader.ts';
import { updateRobotControllerGivenRobot } from '../campaign/robot-control.ts';
import type { RosterMerc } from '../campaign/roster.ts';
import { createEconomyContext } from '../strategic/economy/context.ts';
import type { CrewMember, EconomyContext } from '../strategic/economy/ports.ts';
import { createStrategicContext, standaloneClockContext } from '../strategic/forces/context.ts';
import { FACT_OK_USE_HUMMER, FACT_OK_USE_ICECREAM, PROF_HUMMER, PROF_ICECREAM } from '../strategic/forces/helicopter.ts';
import type { LoadedSectorStatus } from '../strategic/forces/move-permission.ts';
import { defaultTacticalWorldPort, type HelicopterPort, type TacticalWorldPort } from '../strategic/forces/ports.ts';
import { createStrategicState } from '../strategic/state.ts';
import { type GuardOptions, guardFields, unsupplied } from './guard.ts';
import { crewMemberFromView, isRobotMerc, projectedCrewPort } from './strategic-crew.ts';
import { overlayStrategicState, pathFromNames, STATE_FIELDS, sectorFromName } from './strategic-state.ts';
import type { KnowledgeMerc, KnowledgeStrategic, KnowledgeView } from './view.ts';

const SECONDS_PER_MINUTE = 60;
const MINUTES_PER_HOUR = 60;
const MINUTES_PER_DAY = 1440;
const ROBOT_REMOTE_CONTROL = 'ROBOT_REMOTE_CONTROL';
const UNWILLING = 'skyriderUnwilling';

export interface StrategicRules {
  readonly content: StrategicContent;
  readonly economy: EconomyContent;
  readonly items: ItemTable;
  mapExists(path: string): boolean;
}

export async function loadStrategicRules(read: ReadFile, items: ItemTable, mapExists: (path: string) => boolean): Promise<StrategicRules> {
  const content = await loadStrategicContent(read);
  const economy = await loadEconomyContent(read, content.towns);
  return { content, economy, items, mapExists };
}

export interface StrategicKnowledge {
  readonly view: KnowledgeView;
  readonly strategic: KnowledgeStrategic;
  readonly rules: StrategicRules;
  readonly ctx: EconomyContext;
  readonly loaded: LoadedSectorStatus;
  readonly enemyInLoadedSector: boolean;
  merc(id: number): CrewMember | null;
  mercView(id: number): KnowledgeMerc | null;
}

function worldSeconds(view: KnowledgeView): number {
  const c = view.clock;
  if (!c) return 0;
  return (c.day * MINUTES_PER_DAY + c.hour * MINUTES_PER_HOUR + c.minute) * SECONDS_PER_MINUTE;
}

export function enemyKnownInLoadedSector(view: KnowledgeView): boolean {
  if (view.combat) return true;
  if (view.soldiers.some((s) => s.team !== 0 && s.hostile === true)) return true;
  const world = view.strategic?.worldSector ?? null;
  if (!world || !view.mapPath) return false;
  return view.strategic?.sectors.some((s) => s.sector === world && s.enemies !== null) === true;
}

function worldPort(enemyInSector: boolean, guard: GuardOptions): TacticalWorldPort {
  const blocked = (name: string) => () => unsupplied(`world.${name}`, guard);
  return {
    ...defaultTacticalWorldPort,
    enemyInSector: () => enemyInSector,
    hostileCiviliansPresent: () => {
      unsupplied('world.hostileCiviliansPresent', guard);
      return false;
    },
    checkAndHandleUnloadingOfCurrentWorld: blocked('checkAndHandleUnloadingOfCurrentWorld'),
    sectorLiberated: blocked('sectorLiberated'),
    sectorTakenByEnemy: blocked('sectorTakenByEnemy'),
  };
}

function usableByProfile(rules: StrategicRules, strategic: KnowledgeStrategic, profile: string): boolean {
  return (strategic.vehicles ?? []).some((v) => v.usable === true && rules.content.vehicles[v.type ?? -1]?.profile === profile);
}

function helicopterPort(rules: StrategicRules, strategic: KnowledgeStrategic, guard: GuardOptions): HelicopterPort {
  const blocked = (name: string) => () => unsupplied(`helicopter.${name}`, guard);
  return {
    fact: (id) => {
      if (id === FACT_OK_USE_HUMMER) return usableByProfile(rules, strategic, PROF_HUMMER);
      if (id === FACT_OK_USE_ICECREAM) return usableByProfile(rules, strategic, PROF_ICECREAM);
      unsupplied(`helicopter.fact ${id}`, guard);
      return false;
    },
    setFactTrue: blocked('setFactTrue'),
    skyriderLoyaltyLow: () => strategic.helicopter?.reason === UNWILLING,
    cosmeticChoice: () => 0,
    killInVehicle: () => false,
    scheduleKillChopperMeanwhile: blocked('scheduleKillChopperMeanwhile'),
    skyriderOnGround: blocked('skyriderOnGround'),
    emit: blocked('emit'),
  };
}

function placementOf(strategic: KnowledgeStrategic, view: KnowledgeView, m: KnowledgeMerc) {
  const group = strategic.groups.find((g) => g.members.includes(m.id));
  const vehicle = m.vehicle !== undefined ? (strategic.vehicles ?? []).find((v) => v.id === m.vehicle) : undefined;
  const path = vehicle ? vehicle.path : (group?.path ?? []);
  return {
    sector: sectorFromName(m.sector),
    groupId: group?.id ?? 0,
    path: pathFromNames(path),
    inSector: view.soldiers.some((s) => s.id === m.id && s.team === 0),
    remoteHolder: null,
  };
}

function linkRobotController(rules: StrategicRules, crew: readonly CrewMember[], views: readonly KnowledgeMerc[]): void {
  const remote = rules.items.byName.get(ROBOT_REMOTE_CONTROL)?.index;
  if (remote === undefined) return;
  const robots = crew.filter((_, k) => views[k] !== undefined && isRobotMerc(views[k]));
  const roster = {
    get: (id: number) => crew.find((m) => m.id === id),
    byProfile: (p: number) => crew.find((m) => m.profile === p),
    all: () => crew,
  };
  for (const robot of robots) updateRobotControllerGivenRobot(roster as never, remote, robot as unknown as RosterMerc);
}

export function strategicKnowledge(view: KnowledgeView, rules: StrategicRules | null, guard: GuardOptions): StrategicKnowledge | null {
  const strategic = view.strategic;
  if (!rules || !strategic) return null;
  const state = createStrategicState({ worldSeconds: worldSeconds(view) });
  const enemyInSector = enemyKnownInLoadedSector(view);
  const crew = strategic.mercs.map((m) => crewMemberFromView(rules.items, m, placementOf(strategic, view, m), guard));
  linkRobotController(rules, crew, strategic.mercs);
  const weight = new Map(strategic.mercs.map((m) => [m.id, m.weight ?? 0]));
  const port = projectedCrewPort(crew, weight, guard);
  const inCombat = view.combat !== null && view.combat !== undefined;
  const base = createStrategicContext({
    state,
    content: rules.content,
    mercs: port,
    world: worldPort(enemyInSector, guard),
    helicopter: helicopterPort(rules, strategic, guard),
    clock: { ...standaloneClockContext(state), inCombat: () => inCombat },
  });
  overlayStrategicState(base, strategic, guard);
  const guardedState = guardFields(state, STATE_FIELDS, 'strategic state', guard);
  const ctx = createEconomyContext({ ...base, state: guardedState }, { economy: rules.economy, items: rules.items, crew: port });
  const views = new Map(strategic.mercs.map((m) => [m.id, m]));
  return {
    view,
    strategic,
    rules,
    ctx,
    loaded: { inCombat },
    enemyInLoadedSector: enemyInSector,
    merc: (id) => port.get(id) ?? null,
    mercView: (id) => views.get(id) ?? null,
  };
}

export function sameSectorName(a: string, b: string): boolean {
  return sameSector(sectorFromName(a), sectorFromName(b));
}

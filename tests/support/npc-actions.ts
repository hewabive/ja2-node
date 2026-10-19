import { createNarrativeState } from '../../src/sim/strategic/narrative/facts.ts';
import type { SectorPosition } from '../../src/sim/strategic/state.ts';
import {
  DEFAULT_NPC_ACTION_PARAMS,
  NO_BOXING_ACTIONS,
  NO_HIDEOUT_ACTIONS,
  NO_LAPTOP_ACTIONS,
  NO_MEANWHILE_ACTIONS,
  NO_MINE_ACTIONS,
  NO_RECRUIT_ACTIONS,
  type NpcActionEnv,
  type NpcRequestOpening,
} from '../../src/sim/tactical/narrative/npc-actions/env.ts';
import type { Soldier } from '../../src/sim/tactical/soldier.ts';
import { type FakeHost, type FakeHostOptions, fakeHost } from './narrative.ts';

export interface RecordedEvent {
  readonly kind: 'futureDay' | 'sameDay' | 'strategic';
  readonly minute: number;
  readonly param: number;
  readonly days?: number;
  readonly eventKind?: number;
}

export interface FakeActionEnv extends NpcActionEnv {
  readonly fake: FakeHost;
  readonly events: RecordedEvent[];
  readonly requests: NpcRequestOpening[];
  readonly messages: [string, number | undefined, number | undefined][];
  readonly presented: [string, number | undefined][];
  readonly warps: number[];
  readonly histories: [number, number][];
  readonly calls: string[];
  readonly preDraws: number[];
  readonly quests: Map<number, number>;
  minute: number;
  world: SectorPosition | null;
  sciFiOn: boolean;
  teamFull: boolean;
  mercs: number;
  medicalCost: number;
  assignments: Map<number, number>;
}

export interface FakeActionEnvOptions extends FakeHostOptions {
  readonly preDraws?: readonly number[];
  readonly minute?: number;
  readonly world?: SectorPosition | null;
  readonly params?: Readonly<Record<number, { gridNo?: number; amount?: number }>>;
}

export function fakeActionEnv(options: FakeActionEnvOptions = {}): FakeActionEnv {
  const host = fakeHost(options);
  const facts = host.facts.values;
  const preDraws = [...(options.preDraws ?? [])];
  const narrative = createNarrativeState();
  const quests = new Map<number, number>(Object.entries(options.quests ?? {}).map(([k, v]) => [Number(k), v]));
  const params = options.params ?? {};
  const env: FakeActionEnv = {
    fake: host,
    host,
    events: [],
    requests: [],
    messages: [],
    presented: [],
    warps: [],
    histories: [],
    calls: [],
    preDraws,
    quests,
    minute: options.minute ?? 600,
    world: options.world === undefined ? { x: 1, y: 1, z: 0 } : options.world,
    sciFiOn: false,
    teamFull: false,
    mercs: 1,
    medicalCost: 0,
    assignments: new Map(),
    params: {
      gridNo: (code, fallback) => params[code]?.gridNo ?? DEFAULT_NPC_ACTION_PARAMS.gridNo(code, fallback),
      amount: (code, fallback) => params[code]?.amount ?? DEFAULT_NPC_ACTION_PARAMS.amount(code, fallback),
    },
    hospital: narrative.hospital,
    mines: NO_MINE_ACTIONS,
    boxing: NO_BOXING_ACTIONS,
    recruit: {
      ...NO_RECRUIT_ACTIONS,
      recruitRpc: (npc) => env.calls.push(`recruitRpc ${npc}`),
      unRecruitEpc: (npc) => env.calls.push(`unRecruitEpc ${npc}`),
    },
    meanwhile: NO_MEANWHILE_ACTIONS,
    hideout: NO_HIDEOUT_ACTIONS,
    laptop: { ...NO_LAPTOP_ACTIONS, addTerroristFiles: () => env.calls.push('terroristFiles') },
    random: (n) => host.random(n),
    preRandom: (n) => {
      const v = preDraws.shift() ?? 0;
      env.calls.push(`preRandom ${n}`);
      return v % Math.max(n, 1);
    },
    sciFi: () => env.sciFiOn,
    worldSector: () => env.world,
    minutesInDay: () => env.minute,
    totalMinutes: () => env.minute,
    day: () => host.today,
    checkFact: (id, npc) => host.facts.checkFact(id, npc),
    setFactTrue: (id) => facts.set(id, true),
    setFactFalse: (id) => facts.set(id, false),
    questStatus: (quest) => quests.get(quest) ?? 0,
    startQuest: (quest) => quests.set(quest, 1),
    history: (code, _sector, second = 0) => env.histories.push([code, second]),
    awardExperience: (bonus) => env.calls.push(`experience ${bonus}`),
    loyaltyForNpcAction: (npc) => env.calls.push(`loyalty ${npc}`),
    incrementTownLoyalty: (town, amount) => env.calls.push(`townLoyalty ${town} ${amount}`),
    incrementTownLoyaltyEverywhere: (amount) => env.calls.push(`loyaltyEverywhere ${amount}`),
    loyaltyAmount: (name) => (name === 'BONUS_TERRORISTS_DEALT_WITH' ? 2500 : 10000),
    setTownAsFound: (town) => env.calls.push(`townFound ${town}`),
    addFutureDayNpcEvent: (minute, param, days) => env.events.push({ kind: 'futureDay', minute, param, days }),
    addSameDayNpcEvent: (minute, param) => env.events.push({ kind: 'sameDay', minute, param }),
    addStrategicEvent: (eventKind, minute, param) => env.events.push({ kind: 'strategic', minute, param, eventKind }),
    updateRefuelSiteAvailability: () => env.calls.push('refuelSites'),
    calcMedicalCost: () => env.medicalCost,
    assignment: (s: Soldier) => env.assignments.get(s.id) ?? 0,
    setHospitalAssignment: (s: Soldier, modifier) => {
      env.assignments.set(s.id, 33);
      env.calls.push(`hospital ${s.id} ${modifier}`);
    },
    playerTeamFull: () => env.teamFull,
    mercsOnPlayerTeam: () => env.mercs,
    setCurrentSquad: () => {},
    openShop: (npc) => env.calls.push(`shop ${npc}`),
    shopKeeperShutDown: () => false,
    giveItem: (giver, receiver, slot) => env.calls.push(`give ${giver.id} ${receiver.id} ${slot}`),
    moraleEvent: (s, kind) => env.calls.push(`morale ${s.id} ${kind}`),
    openRequest: (opening) => env.requests.push(opening),
    startCarmenTimer: (ms) => env.calls.push(`carmenTimer ${ms}`),
    setSoldierNeutral: (s) => {
      s.neutral = true;
    },
    message: (kind, profile, amount) => env.messages.push([kind, profile, amount]),
    presentation: (kind, profile) => env.presented.push([kind, profile]),
    warpTimeWithoutEvents: (seconds) => env.warps.push(seconds),
    profileName: (npc) => `Name${npc}`,
    kickOutOfWheelchair: (s) => env.calls.push(`kickout ${s.id}`),
    leatherJacketPrice: () => 950,
    removeObjectFromProfile: (npc, item) => env.calls.push(`removeFromProfile ${npc} ${item}`),
  };
  return env;
}

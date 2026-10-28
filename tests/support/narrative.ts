import { NO_VOICE_LENGTHS, type VoiceLengths } from '../../src/content/audio/speech-lengths.ts';
import {
  emptyNpcRecord,
  FACT_NONE,
  IRRELEVANT,
  NO_MOVE,
  NO_QUEST,
  type NpcRecord,
  NUM_NPC_QUOTE_RECORDS,
} from '../../src/content/formats/npc.ts';
import type { TextKey } from '../../src/content/narrative/dialogue-text.ts';
import { emptyNpcRecordContent, type NpcRecordContent } from '../../src/content/narrative/npc-records.ts';
import { MercType } from '../../src/content/strategic/economy-content.ts';
import { emptyProfile } from '../../src/sim/campaign/laptop/imp.ts';
import type { NarrativeEventWithoutTick } from '../../src/sim/narrative/events.ts';
import type { NarrativeHost } from '../../src/sim/narrative/host.ts';
import { createNpcRecordState } from '../../src/sim/narrative/records.ts';
import { createTalkContext, createTalkState } from '../../src/sim/narrative/talk-state.ts';
import { type ProfileProgress, progressFromProfile } from '../../src/sim/tactical/profiles.ts';
import { createSoldier, type Soldier, Team } from '../../src/sim/tactical/soldier.ts';
import type { TacticalState } from '../../src/sim/tactical/state.ts';

export function liveRecord(fields: Partial<NpcRecord> = {}): NpcRecord {
  return {
    ...emptyNpcRecord(),
    factMustBeTrue: FACT_NONE,
    factMustBeFalse: FACT_NONE,
    quest: NO_QUEST,
    lastDay: IRRELEVANT,
    quoteNum: IRRELEVANT,
    numQuotes: IRRELEVANT,
    startQuest: NO_QUEST,
    endQuest: NO_QUEST,
    triggerNpc: IRRELEVANT,
    triggerNpcRecord: IRRELEVANT,
    setFactTrue: FACT_NONE,
    goToGridNo: NO_MOVE,
    ...fields,
  };
}

export function recordArray(entries: Readonly<Record<number, Partial<NpcRecord>>>): NpcRecord[] {
  return Array.from({ length: NUM_NPC_QUOTE_RECORDS }, (_, i) => {
    const e = entries[i];
    return e ? liveRecord({ identifier: i, ...e }) : emptyNpcRecord();
  });
}

export function testProfile(id: number, fields: Partial<ProfileProgress> = {}): ProfileProgress {
  return Object.assign(progressFromProfile(emptyProfile(id)), { lastQuoteSaid: 255 }, fields);
}

const STATS = {
  agility: 60,
  dexterity: 60,
  strength: 60,
  wisdom: 60,
  leadership: 60,
  marksmanship: 60,
  mechanical: 30,
  explosives: 30,
  medical: 30,
  experience: 3,
};
const WORLD_TILES = 25600;
const PALETTES = { hair: 'BROWNHEAD', skin: 'TANSKIN', vest: 'BLUEVEST', pants: 'JEANPANTS' };

export function testSoldier(id: number, team: number, profile: number, gridNo: number): Soldier {
  const s = createSoldier({
    id,
    team,
    name: `S${id}`,
    profile,
    bodyType: 0,
    palettes: PALETTES,
    stats: STATS,
    life: 80,
    gridNo,
    direction: 0,
    state: 0,
  });
  s.placed = true;
  return s;
}

export interface FakeHostOptions {
  readonly scripts?: Readonly<Record<number, NpcRecord[]>>;
  readonly recruited?: NpcRecord[];
  readonly profiles?: Readonly<Record<number, Partial<ProfileProgress>>>;
  readonly types?: Readonly<Record<number, number>>;
  readonly soldiers?: readonly Soldier[];
  readonly facts?: Readonly<Record<number, boolean>>;
  readonly quests?: Readonly<Record<number, number>>;
  readonly chars?: (key: TextKey) => number;
  readonly voiceMs?: VoiceLengths['ms'];
  readonly day?: number;
  readonly draws?: readonly number[];
  readonly inCombat?: boolean;
  readonly currentTeam?: number;
  readonly sector?: { readonly x: number; readonly y: number; readonly z: number };
  readonly town?: number;
  readonly townRating?: number;
  readonly townUsesLoyalty?: boolean;
  readonly mineControlled?: boolean;
  readonly mercSlots?: readonly Soldier[];
  readonly civilian?: Readonly<Record<number, NpcRecord[]>>;
}

export interface FakeHost extends NarrativeHost {
  readonly emitted: NarrativeEventWithoutTick[];
  readonly factLog: [number, number][];
  readonly actionsRun: [number, number, number][];
  readonly questLog: [string, number][];
  readonly facts: NarrativeHost['facts'] & { readonly values: Map<number, boolean> };
  readonly quests: NarrativeHost['quests'];
  readonly drawsTaken: number[];
  engagedFlag: boolean;
  paused: boolean;
  now: number;
  today: number;
  advance(ticks?: number): void;
}

export function fakeHost(options: FakeHostOptions = {}): FakeHost {
  const content: NpcRecordContent = {
    ...emptyNpcRecordContent(),
    scripts: Array.from({ length: 200 }, (_, id) => options.scripts?.[id] ?? null),
    recruited: options.recruited ?? null,
    civilian: Array.from({ length: 20 }, (_, i) => options.civilian?.[i] ?? null),
    profileTypes: new Map(Object.entries(options.types ?? {}).map(([k, v]) => [Number(k), v])),
  };
  const profiles = new Map<number, ProfileProgress>();
  for (const [k, v] of Object.entries(options.profiles ?? {})) profiles.set(Number(k), testProfile(Number(k), v));
  const soldiers = [...(options.soldiers ?? [])];
  const byId: Soldier[] = [];
  const ground = new Int16Array(WORLD_TILES).fill(-1);
  for (const s of soldiers) {
    byId[s.id] = s;
    ground[s.gridNo] = s.id;
  }
  const tactical = {
    world: {},
    soldiers: byId,
    occupant: [ground, new Int16Array(WORLD_TILES).fill(-1)],
    clockMs: 0,
    inCombat: options.inCombat ?? false,
    turn: { currentTeam: options.currentTeam ?? Team.OUR },
    engagedInConv: false,
    sector: options.sector ?? { x: 1, y: 1, z: 0 },
    mercSlots: [...(options.mercSlots ?? soldiers)],
  } as unknown as TacticalState;
  const values = new Map<number, boolean>(Object.entries(options.facts ?? {}).map(([k, v]) => [Number(k), v]));
  const quests = new Map<number, number>(Object.entries(options.quests ?? {}).map(([k, v]) => [Number(k), v]));
  const draws = [...(options.draws ?? [])];
  const host: FakeHost = {
    emitted: [],
    factLog: [],
    actionsRun: [],
    questLog: [],
    drawsTaken: [],
    engagedFlag: false,
    paused: false,
    now: 0,
    today: options.day ?? 1,
    records: createNpcRecordState(),
    content,
    recruited: (p) => ((profiles.get(p)?.miscFlags ?? 0) & 1) !== 0,
    meanwhile: () => null,
    talk: createTalkState(),
    context: createTalkContext(),
    facts: {
      values,
      checkFact: (fact, npc) => {
        host.factLog.push([fact, npc]);
        return values.get(fact) ?? false;
      },
    },
    quests: {
      startQuest: (q) => {
        host.questLog.push(['start', q]);
        quests.set(q, 1);
      },
      endQuest: (q) => {
        host.questLog.push(['end', q]);
        quests.set(q, 2);
      },
    },
    actions: { handleNpcDoAction: (npc, code, record) => host.actionsRun.push([npc, code, record]) },
    give: { placeObjectInSoldierProfile: () => {}, returnItemToPlayer: () => {}, handleNpcItemGiven: () => {} },
    receive: {
      items: {
        ids: { HEAD_2: 1, HEAD_3: 2, HEAD_5: 3, HEAD_6: 4, HEAD_7: 5, MONEY: 6, SILVER: 7, GOLD: 8, WINE: 9, BEER: 10, ALCOHOL: 11 },
        leatherJacketPrice: 950,
        isGunOfRifleClass: (item) => item === 20,
      },
      hospital: { tempBalance: 0, refund: 0 },
      calcMedicalCost: () => 0,
      frankCash: () => {},
      kingpinInHisHouse: () => false,
      addProfileCost: () => {},
      message: () => {},
    },
    mercLines: { sayLater: () => {}, mikeSaysHi: () => {} },
    civ: {
      townOfSector: () => options.town ?? 0,
      townUsesLoyalty: () => options.townUsesLoyalty ?? true,
      playerControlsMineOf: () => options.mineControlled ?? false,
    },
    quoteLengths: { chars: options.chars ?? (() => 10) },
    voiceLengths: options.voiceMs ? { ms: options.voiceMs } : NO_VOICE_LENGTHS,
    tick: () => host.now,
    day: () => host.today,
    random: (n) => {
      const v = draws.shift() ?? 0;
      host.drawsTaken.push(n);
      return v % Math.max(n, 1);
    },
    tactical: () => tactical,
    profile: (id) => profiles.get(id) ?? null,
    setFact: (fact, value) => values.set(fact, value),
    questValue: (index) => quests.get(index) ?? 0,
    townRating: () => options.townRating ?? 0,
    threat: () => 0,
    voice: (p) => p,
    worldSector: () => options.sector ?? { x: 1, y: 1, z: 0 },
    isEpc: () => false,
    onSquad: (s) => s.team === Team.OUR,
    inMeanwhile: () => false,
    emit: (e) => host.emitted.push(e),
    setEngaged: (on) => {
      host.engagedFlag = on;
      tactical.engagedInConv = on;
    },
    engaged: () => host.engagedFlag,
    pauseForConversation: (on) => {
      host.paused = on;
    },
    selectTalker: () => {},
    isDealer: () => false,
    openShop: () => {},
    shopClosedByScript: () => false,
    teleport: (s, g) => {
      s.gridNo = g;
    },
    advance: (ticks = 1) => {
      host.now += ticks;
      tactical.clockMs += ticks * 5;
    },
  };
  return host;
}

export const NPC_TYPE = MercType.NPC;
export const RPC_TYPE = MercType.RPC;

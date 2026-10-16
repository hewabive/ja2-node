import { describe, expect, it } from 'vitest';
import { testProfile } from '../../../../tests/support/profiles.ts';
import { ProfileMiscFlag2 } from '../../campaign/profiles.ts';
import { MercKind } from '../../campaign/roster.ts';
import type { ProfileProgress } from '../../tactical/profiles.ts';
import { CivilianGroup, Side, Team } from '../../tactical/soldier.ts';
import type { SectorPosition } from '../state.ts';
import {
  checkFact,
  type FactCampaign,
  type FactContext,
  type FactSoldier,
  type FactWorld,
  isComputedFact,
  NO_FACT_BOXING,
  NO_FACT_DIALOGUE,
  NO_FACT_REPAIRS,
  NO_FACT_WORLD,
  NO_TALK,
  type TalkContext,
} from './check-fact.ts';
import { Fact, Quest } from './fact-ids.ts';
import { createNarrativeState, factValue, type NarrativeState, setFact, setQuestStatus } from './facts.ts';
import { Npc } from './npc-ids.ts';

const COLS = 160;
const at = (x: number, y: number) => y * COLS + x;
const A9: SectorPosition = { x: 9, y: 1, z: 0 };

function soldier(id: number, profile: number, gridNo: number, o: Partial<FactSoldier> = {}): FactSoldier {
  const ourTeam = o.ourTeam ?? o.team === Team.OUR;
  return {
    id,
    profile,
    team: ourTeam ? Team.OUR : Team.CIV,
    side: Side.FRIENDLY,
    neutral: !ourTeam,
    civilianGroup: CivilianGroup.NONE,
    life: 80,
    lifeMax: 80,
    bleeding: 0,
    strength: 70,
    gridNo,
    inSector: true,
    cowering: false,
    underFire: false,
    heardGunshot: false,
    assignment: 0,
    kind: ourTeam ? MercKind.AIM_MERC : -1,
    sector: A9,
    ourTeam,
    ...o,
  };
}

interface Fixture {
  readonly n: NarrativeState;
  readonly profiles: Map<number, ProfileProgress>;
  soldiers: FactSoldier[];
  rooms: Map<number, number>;
  talk: TalkContext;
  progress: number;
  wholeTowns: number;
  omertaOurs: boolean;
  loyalty: Map<number, { rating: number; started: boolean; usesLoyalty: boolean }>;
  hostility: Map<number, number>;
  now: number;
  skyrider: { talk: number; last: number };
}

function fixture(): Fixture {
  return {
    n: createNarrativeState(),
    profiles: new Map(),
    soldiers: [],
    rooms: new Map(),
    talk: NO_TALK,
    progress: 0,
    wholeTowns: 0,
    omertaOurs: false,
    loyalty: new Map(),
    hostility: new Map(),
    now: 5000,
    skyrider: { talk: 0, last: 0 },
  };
}

function context(f: Fixture): FactContext {
  const campaign: FactCampaign = {
    sciFi: true,
    now: () => f.now,
    profile: (id) => f.profiles.get(id) ?? null,
    civGroupHostility: (g) => f.hostility.get(g) ?? 0,
    currentProgress: () => f.progress,
    sectorEnemyControlled: () => false,
    sectorVisited: () => false,
    bloodCats: () => -1,
    numEnemiesInAnySector: () => 0,
    bobbyRayOrdersInTransit: () => 0,
    primaryDelivery: () => null,
    timeQuestWasStarted: () => 0,
    skyriderTalkState: () => f.skyrider.talk,
    lastSkyriderMonologue: () => f.skyrider.last,
  };
  const world: FactWorld = {
    ...NO_FACT_WORLD,
    sector: A9,
    soldierByProfile: (p) => f.soldiers.find((s) => s.profile === p) ?? null,
    soldierOnPlayerTeam: (p) => f.soldiers.find((s) => s.profile === p && s.ourTeam) ?? null,
    mercsInSector: () => f.soldiers,
    ourTeam: () => f.soldiers.filter((s) => s.ourTeam),
    room: (g) => f.rooms.get(g) ?? 0,
  };
  return {
    narrative: f.n,
    campaign,
    towns: {
      loyalty: (t) => f.loyalty.get(t) ?? { rating: 0, started: false, usesLoyalty: false },
      townIdOfSector: () => 0,
      wholeTownsUnderControl: () => f.wholeTowns,
      townUnderCompleteControl: () => f.omertaOurs,
    },
    mines: {
      empty: () => false,
      runningOut: () => false,
      producingForSomeTime: () => false,
      disloyal: () => false,
      infested: () => false,
      lostAndRegained: () => false,
      atMaxProduction: () => false,
      predictedDailyIncome: () => 0,
      spokenToHeadMiner: () => false,
      mineIdOfSector: () => -1,
    },
    world,
    talk: f.talk,
    boxing: NO_FACT_BOXING,
    repairs: NO_FACT_REPAIRS,
    dialogue: NO_FACT_DIALOGUE,
    items: { firstHead: -1, lastHead: -1, rocketRifle: -1 },
  };
}

const NPC = Npc.VINCE;

describe('CheckFact (docs/25 §1.3)', () => {
  it('returns stored bytes for ids it does not compute and writes computed results back', () => {
    const f = fixture();
    setFact(f.n, Fact.FACT_38, 1);
    expect(isComputedFact(Fact.FACT_38)).toBe(false);
    expect(checkFact(context(f), Fact.FACT_38, 0)).toBe(true);
    setFact(f.n, Fact.DIMITRI_DEAD, 1);
    expect(checkFact(context(f), Fact.DIMITRI_DEAD, 0)).toBe(false);
    expect(factValue(f.n, Fact.DIMITRI_DEAD)).toBe(0);
    f.profiles.set(Npc.DIMITRI, testProfile(Npc.DIMITRI, { mercStatus: -5 }));
    expect(checkFact(context(f), Fact.DIMITRI_DEAD, 0)).toBe(true);
    expect(factValue(f.n, Fact.DIMITRI_DEAD)).toBe(1);
  });

  it('counts wounded mercs within 9 tiles inclusive, close mercs strictly under 3 and near mercs under 5', () => {
    const f = fixture();
    f.soldiers = [
      soldier(30, NPC, at(50, 50)),
      soldier(0, 1, at(59, 50), { ourTeam: true, life: 40 }),
      soldier(1, 2, at(60, 50), { ourTeam: true, life: 40 }),
      soldier(2, 3, at(52, 50), { ourTeam: true }),
      soldier(3, 4, at(55, 50), { ourTeam: true }),
    ];
    const ctx = context(f);
    expect(checkFact(ctx, Fact.WOUNDED_MERCS_NEARBY, NPC)).toBe(true);
    expect(checkFact(ctx, Fact.ONE_WOUNDED_MERC_NEARBY, NPC)).toBe(true);
    expect(checkFact(ctx, Fact.MULTIPLE_WOUNDED_MERCS_NEARBY, NPC)).toBe(false);
    expect(checkFact(ctx, Fact.SOME_MERCS_CLOSE, NPC)).toBe(true);
    expect(checkFact(ctx, Fact.MULTIPLE_MERCS_CLOSE, NPC)).toBe(false);
    expect(checkFact(ctx, Fact.MERC_NEAR_NPC, NPC)).toBe(true);
    f.soldiers = f.soldiers.filter((s) => s.id !== 2);
    expect(checkFact(context(f), Fact.MERC_NEAR_NPC, NPC)).toBe(false);
  });

  it('reads the talker for strength 84 and the male count within 8, and a female within 10', () => {
    const f = fixture();
    for (const id of [1, 2, 3]) f.profiles.set(id, testProfile(id, { sex: 0 }));
    f.profiles.set(4, testProfile(4, { sex: 1 }));
    const talker = soldier(0, 1, at(50, 52), { ourTeam: true, strength: 84 });
    f.soldiers = [
      soldier(30, NPC, at(50, 50)),
      talker,
      soldier(1, 2, at(58, 50), { ourTeam: true }),
      soldier(2, 4, at(60, 50), { ourTeam: true }),
    ];
    f.talk = { src: talker, dest: null, srcProfile: 1 };
    expect(checkFact(context(f), Fact.PC_STRONG_AND_LESS_THAN_3_MALES_PRESENT, NPC)).toBe(true);
    f.soldiers.push(soldier(3, 3, at(50, 58), { ourTeam: true }));
    expect(checkFact(context(f), Fact.PC_STRONG_AND_3_PLUS_MALES_PRESENT, NPC)).toBe(true);
    expect(checkFact(context(f), Fact.MALE_SPEAKING_FEMALE_PRESENT, NPC)).toBe(true);
    f.talk = { src: { ...talker, strength: 83 }, dest: null, srcProfile: 1 };
    expect(checkFact(context(f), Fact.PC_STRONG_AND_3_PLUS_MALES_PRESENT, NPC)).toBe(false);
  });

  it('picks the source talker before testing the hicks flag (unpropositioned female)', () => {
    const f = fixture();
    f.profiles.set(4, testProfile(4, { sex: 1, miscFlags2: ProfileMiscFlag2.ASKED_BY_HICKS }));
    f.profiles.set(5, testProfile(5, { sex: 1 }));
    const src = soldier(0, 4, at(1, 1), { ourTeam: true });
    const dest = soldier(1, 5, at(2, 1), { ourTeam: true });
    f.talk = { src, dest, srcProfile: 4 };
    expect(checkFact(context(f), Fact.FEMALE_SPEAKING_TO_NPC, 0)).toBe(true);
    expect(checkFact(context(f), Fact.UNPROPOSITIONED_FEMALE_SPEAKING_TO_NPC, 0)).toBe(false);
  });

  it('keeps Brenda in her store within 12 tiles', () => {
    const f = fixture();
    f.profiles.set(Npc.BRENDA, testProfile(Npc.BRENDA));
    f.soldiers = [soldier(30, NPC, at(50, 50)), soldier(31, Npc.BRENDA, at(62, 50))];
    f.rooms.set(at(62, 50), 47);
    expect(checkFact(context(f), Fact.BRENDA_IN_STORE_AND_ALIVE, NPC)).toBe(true);
    f.soldiers[1] = soldier(31, Npc.BRENDA, at(63, 50));
    f.rooms.set(at(63, 50), 47);
    expect(checkFact(context(f), Fact.BRENDA_IN_STORE_AND_ALIVE, NPC)).toBe(false);
  });

  it('counts bartenders by their order counters', () => {
    const f = fixture();
    for (const id of [Npc.HERVE, Npc.PETER, Npc.ALBERTO, Npc.CARLO]) f.profiles.set(id, testProfile(id));
    expect(checkFact(context(f), Fact.FIRST_BARTENDER, Npc.PETER)).toBe(true);
    const herve = f.profiles.get(Npc.HERVE);
    if (herve) herve.npcData = 1;
    expect(checkFact(context(f), Fact.FIRST_BARTENDER, Npc.PETER)).toBe(false);
    expect(checkFact(context(f), Fact.SECOND_BARTENDER, Npc.PETER)).toBe(true);
    expect(checkFact(context(f), Fact.FIRST_BARTENDER, 200)).toBe(false);
  });

  it('reads the loyalty bands 30, 50 and 80 and holds Skyrider back for a day after a monologue', () => {
    const f = fixture();
    f.profiles.set(NPC, testProfile(NPC, { town: 6 }));
    f.profiles.set(Npc.SKYRIDER, testProfile(Npc.SKYRIDER, { town: 6 }));
    const set = (rating: number) => f.loyalty.set(6, { rating, started: true, usesLoyalty: true });
    set(29);
    expect(checkFact(context(f), Fact.LOYALTY_LOW, NPC)).toBe(true);
    expect(checkFact(context(f), Fact.LOYALTY_LOW, Npc.SKYRIDER)).toBe(false);
    f.skyrider = { talk: 1, last: f.now - 1439 };
    expect(checkFact(context(f), Fact.LOYALTY_LOW, Npc.SKYRIDER)).toBe(false);
    f.skyrider = { talk: 1, last: f.now - 1440 };
    expect(checkFact(context(f), Fact.LOYALTY_LOW, Npc.SKYRIDER)).toBe(true);
    set(30);
    expect(checkFact(context(f), Fact.LOYALTY_OKAY, NPC)).toBe(true);
    set(50);
    expect(checkFact(context(f), Fact.LOYALTY_OKAY, NPC)).toBe(false);
    set(80);
    expect(checkFact(context(f), Fact.LOYALTY_HIGH, NPC)).toBe(true);
    f.loyalty.set(6, { rating: 80, started: false, usesLoyalty: true });
    expect(checkFact(context(f), Fact.LOYALTY_HIGH, NPC)).toBe(false);
  });

  it('compares progress strictly and counts whole towns 3, 5 and 6 with Omerta', () => {
    const f = fixture();
    f.progress = 19;
    expect(checkFact(context(f), Fact.PLAYER_DOING_POORLY, 0)).toBe(true);
    f.progress = 50;
    expect(checkFact(context(f), Fact.PLAYER_DOING_WELL, 0)).toBe(false);
    f.progress = 81;
    expect(checkFact(context(f), Fact.PLAYER_DOING_VERY_WELL, 0)).toBe(true);
    f.omertaOurs = true;
    f.wholeTowns = 3;
    expect(checkFact(context(f), Fact.PLAYER_OWNS_2_TOWNS_INCLUDING_OMERTA, 0)).toBe(true);
    f.wholeTowns = 5;
    expect(checkFact(context(f), Fact.PLAYER_OWNS_3_TOWNS_INCLUDING_OMERTA, 0)).toBe(true);
    f.wholeTowns = 7;
    expect(checkFact(context(f), Fact.PLAYER_OWNS_4_TOWNS_INCLUDING_OMERTA, 0)).toBe(true);
    f.omertaOurs = false;
    expect(checkFact(context(f), Fact.PLAYER_OWNS_4_TOWNS_INCLUDING_OMERTA, 0)).toBe(false);
  });

  it('inverts Pablo’s bribe, keeps 245 sticky and reads hostility for the rebels and Kingpin', () => {
    const f = fixture();
    expect(checkFact(context(f), Fact.PABLO_BRIBED, 0)).toBe(true);
    setFact(f.n, Fact.PABLOS_BRIBED, 1);
    expect(checkFact(context(f), Fact.PABLO_BRIBED, 0)).toBe(false);
    f.soldiers = [soldier(0, Npc.MIGUEL, at(1, 1), { ourTeam: true })];
    expect(checkFact(context(f), Fact.FACT_245, 0)).toBe(true);
    f.soldiers = [];
    expect(checkFact(context(f), Fact.FACT_245, 0)).toBe(true);
    f.hostility.set(CivilianGroup.REBEL, 3);
    f.hostility.set(CivilianGroup.KINGPIN, 2);
    expect(checkFact(context(f), Fact.REBELS_HATE_PLAYER, 0)).toBe(true);
    expect(checkFact(context(f), Fact.KINGPIN_IS_ENEMY, 0)).toBe(true);
  });

  it('treats a neutral civilian of a group about to turn hostile as an enemy, and the hostile-quote flag', () => {
    const f = fixture();
    f.profiles.set(NPC, testProfile(NPC));
    f.soldiers = [soldier(30, NPC, at(1, 1), { civilianGroup: CivilianGroup.KINGPIN })];
    expect(checkFact(context(f), Fact.NPC_IS_ENEMY, NPC)).toBe(false);
    f.hostility.set(CivilianGroup.KINGPIN, 2);
    expect(checkFact(context(f), Fact.NPC_IS_ENEMY, NPC)).toBe(true);
    f.hostility.clear();
    f.profiles.set(NPC, testProfile(NPC, { miscFlags2: ProfileMiscFlag2.NEEDS_TO_SAY_HOSTILE_QUOTE }));
    expect(checkFact(context(f), Fact.NPC_IS_ENEMY, NPC)).toBe(true);
    expect(checkFact(context(f), Fact.NPC_HOSTILE_OR_PISSED_OFF, NPC)).toBe(false);
  });

  it('reads the quests for Kingpin’s money and the club, and escorts by merc kind', () => {
    const f = fixture();
    expect(checkFact(context(f), Fact.DONT_OWE_KINGPIN_MONEY, 0)).toBe(true);
    setQuestStatus(f.n, Quest.KINGPIN_MONEY, 1);
    expect(checkFact(context(f), Fact.DONT_OWE_KINGPIN_MONEY, 0)).toBe(false);
    expect(checkFact(context(f), Fact.NO_CLUB_FIGHTING_ALLOWED, 0)).toBe(true);
    f.profiles.set(Npc.MARIA, testProfile(Npc.MARIA));
    f.soldiers = [soldier(5, Npc.MARIA, at(3, 3), { ourTeam: true, kind: MercKind.EPC })];
    f.rooms.set(at(3, 3), 2);
    expect(checkFact(context(f), Fact.MARIA_ESCORTED_AT_LEATHER_SHOP, Npc.MARIA)).toBe(true);
  });

  it('leaves the soldier facts false without a loaded sector', () => {
    const f = fixture();
    const ctx = { ...context(f), world: NO_FACT_WORLD };
    expect(checkFact(ctx, Fact.NPC_WOUNDED, NPC)).toBe(false);
    expect(checkFact(ctx, Fact.SHANK_NOT_IN_SECTOR, 0)).toBe(true);
    expect(checkFact(ctx, Fact.CURRENT_SECTOR_IS_SAFE, NPC)).toBe(true);
  });
});

// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-16. See LICENSE (SFI-SCLA).
// @src src/game/Strategic/Quests.cc CheckFact and its helpers (CheckForNewShipment, CheckNPCWounded, CheckNPCInOkayHealth,
// @src CheckNPCBleeding, CheckNPCWithin, CheckGuyVisible, CheckNPCAt, CheckNPCIsEnemy, NumWoundedMercsNearby, NumMercsNear,
// @src CheckNPCIsEPC, NPCInRoom, NPCInRoomRange, PCInSameRoom, CheckTalkerStrong, CheckTalkerFemale,
// @src CheckTalkerUnpropositionedFemale, NumMalesPresent, FemalePresent, CheckPlayerHasHead, CheckNPCSector, AIMMercWithin,
// @src CheckNPCCowering, CountBartenders, CheckNPCIsUnderFire, NPCHeardShot, InTownSectorWithTrainingLoyalty); Quests.h
// @src LOYALTY_*_THRESHOLD; Interface_Dialogue.h HOSPITAL_PATIENT_DISTANCE; strategic-fact-params.json defaults.
// @src See docs/25 §1.3–§1.4.

import { pythSpacesAway } from '../../../content/world/grid.ts';
import { NUM_PROFILES, ProfileMiscFlag, ProfileMiscFlag2, ProfileMiscFlag3 } from '../../campaign/profiles.ts';
import { MercKind } from '../../campaign/roster.ts';
import { CivGroupHostility } from '../../tactical/narrative/constants.ts';
import { isProfileDead, type ProfileProgress } from '../../tactical/profiles.ts';
import { CivilianGroup, Side } from '../../tactical/soldier.ts';
import { Assignment } from '../economy/constants.ts';
import type { SectorPosition } from '../state.ts';
import { Fact, Quest } from './fact-ids.ts';
import { factValue, type NarrativeState, QuestStatus, questStatus, setFact } from './facts.ts';
import { Npc } from './npc-ids.ts';

export interface FactSoldier {
  readonly id: number;
  readonly profile: number;
  readonly team: number;
  readonly side: number;
  readonly neutral: boolean;
  readonly civilianGroup: number;
  readonly life: number;
  readonly lifeMax: number;
  readonly bleeding: number;
  readonly strength: number;
  readonly gridNo: number;
  readonly inSector: boolean;
  readonly cowering: boolean;
  readonly underFire: boolean;
  readonly heardGunshot: boolean;
  readonly assignment: number;
  readonly kind: number;
  readonly sector: SectorPosition;
  readonly ourTeam: boolean;
}

export interface FactWorld {
  readonly sector: SectorPosition | null;
  soldierByProfile(profile: number): FactSoldier | null;
  soldierOnPlayerTeam(profile: number): FactSoldier | null;
  mercsInSector(): readonly FactSoldier[];
  ourTeam(): readonly FactSoldier[];
  carriesItemInRange(soldier: FactSoldier, first: number, last: number): boolean;
  room(gridNo: number): number;
  seesCurrently(viewer: FactSoldier, target: FactSoldier): boolean;
  enemyInSector(): boolean;
  inCombat(): boolean;
  itemTypeExistsAt(gridNo: number, item: number, level: number): boolean;
  invisibleItemPoolAt(gridNo: number, level: number): boolean;
}

export interface TalkContext {
  readonly src: FactSoldier | null;
  readonly dest: FactSoldier | null;
  readonly srcProfile: number;
}

export interface TownLoyaltyReading {
  readonly rating: number;
  readonly started: boolean;
  readonly usesLoyalty: boolean;
}

export interface FactTowns {
  loyalty(town: number): TownLoyaltyReading;
  townIdOfSector(sector: SectorPosition): number;
  wholeTownsUnderControl(): number;
  townUnderCompleteControl(town: number): boolean;
}

export interface FactMines {
  empty(headMiner: number): boolean;
  runningOut(headMiner: number): boolean;
  producingForSomeTime(headMiner: number): boolean;
  disloyal(headMiner: number): boolean;
  infested(headMiner: number): boolean;
  lostAndRegained(headMiner: number): boolean;
  atMaxProduction(headMiner: number): boolean;
  predictedDailyIncome(mine: number): number;
  spokenToHeadMiner(mine: number): boolean;
  mineIdOfSector(sector: SectorPosition): number;
}

export interface FactCampaign {
  readonly sciFi: boolean;
  now(): number;
  profile(id: number): ProfileProgress | null;
  civGroupHostility(group: number): number;
  currentProgress(): number;
  sectorEnemyControlled(sector: SectorPosition): boolean;
  sectorVisited(sector: SectorPosition): boolean;
  bloodCats(sector: SectorPosition): number;
  numEnemiesInAnySector(sector: SectorPosition): number;
  bobbyRayOrdersInTransit(): number;
  primaryDelivery(): { readonly sector: SectorPosition; readonly gridNo: number } | null;
  timeQuestWasStarted(quest: number): number;
  skyriderTalkState(): number;
  lastSkyriderMonologue(): number;
}

export interface FactBoxing {
  anotherFightPossible(): boolean;
  boxerAvailable(): boolean;
  boxerExists(): boolean;
}

export interface FactRepairs {
  fixingButNoneDone(profile: number): boolean;
}

export interface FactDialogue {
  desireToTalk(npc: number, merc: number, approach: number): number;
}

export interface FactItems {
  readonly firstHead: number;
  readonly lastHead: number;
  readonly rocketRifle: number;
}

export interface FactContext {
  readonly narrative: NarrativeState;
  readonly campaign: FactCampaign;
  readonly towns: FactTowns;
  readonly mines: FactMines;
  readonly world: FactWorld;
  readonly talk: TalkContext;
  readonly boxing: FactBoxing;
  readonly repairs: FactRepairs;
  readonly dialogue: FactDialogue;
  readonly items: FactItems;
}

export const SRC_PROFILE_AT_START = 0;
export const NO_TALK: TalkContext = { src: null, dest: null, srcProfile: SRC_PROFILE_AT_START };

export const NO_FACT_WORLD: FactWorld = {
  sector: null,
  soldierByProfile: () => null,
  soldierOnPlayerTeam: () => null,
  mercsInSector: () => [],
  ourTeam: () => [],
  carriesItemInRange: () => false,
  room: () => 0,
  seesCurrently: () => false,
  enemyInSector: () => false,
  inCombat: () => false,
  itemTypeExistsAt: () => false,
  invisibleItemPoolAt: () => false,
};

export const NO_FACT_BOXING: FactBoxing = {
  anotherFightPossible: () => false,
  boxerAvailable: () => true,
  boxerExists: () => true,
};

export const NO_FACT_REPAIRS: FactRepairs = { fixingButNoneDone: () => false };
export const NO_FACT_DIALOGUE: FactDialogue = { desireToTalk: () => 0 };
export const NO_FACT_ITEMS: FactItems = { firstHead: -1, lastHead: -1, rocketRifle: -1 };

const FEMALE = 1;
const MALE = 0;
const OKLIFE = 15;
const STRONG_TALKER = 84;
const IRA_RANGE = 10;
const BRENDA_RANGE = 12;
const BRENDA_STORE_ROOM = 47;
const MARIA_LEATHER_SHOP_ROOM = 2;
const TONY_BUILDING_ROOM = 50;
const KINGPIN_OFFICE_ROOMS = { first: 30, last: 39 } as const;
const HOSPITAL_PATIENT_DISTANCE = 9;
const CLOSE_RANGE = 3;
const NEAR_RANGE = 5;
const MALES_RANGE = 8;
const FEMALES_RANGE = 10;
const AIM_RANGE = 10;
const DYNAMO_RANGE = 10;
const JOEY_MARTHA_RANGE = 5;
const MAX_MALES_PRESENT = 3;
const DRUNK_LEVEL = 5;
const OKAY_HEALTH_LIFE = 30;
const LOYALTY_LOW_THRESHOLD = 30;
const LOYALTY_OK_THRESHOLD = 50;
const LOYALTY_HIGH_THRESHOLD = 80;
const MIN_RATING_TO_TRAIN_TOWN = 20;
const SKYRIDER_MONOLOGUE_PAUSE_MINUTES = 24 * 60;
const BLOODCAT_QUEST_WAIT_MINUTES = 2 * 24 * 60;
const CARMEN_REWARD_MONEY = 10000;
const SLAY_DAYS_SERVED = 1;
const PROGRESS_POORLY = 20;
const PROGRESS_WELL = 50;
const PROGRESS_VERY_WELL = 80;
const CONRAD_RECRUIT_OPINION = 50;
const APPROACH_RECRUIT = 4;
const BLANK_TOWN = 0;
const OMERTA = 1;
const TOWNS_FOR_TWO = 3;
const TOWNS_FOR_THREE = 5;
const TOWNS_FOR_FOUR = 6;
const HANS_SPOT_GRIDNO = 13523;
const SPIKE_DOOR_GRIDNO = 9817;
const ROCKET_RIFLE_GRIDNO = 10472;
const GROUND_LEVEL = 0;
const MINE_DRASSEN = 0;
const MINE_CAMBRIA = 1;
const MINE_ALMA = 2;
const MINE_GRUMM = 3;
const MINE_CHITZENA = 5;
const BARTENDERS = [Npc.HERVE, Npc.PETER, Npc.ALBERTO, Npc.CARLO] as const;

const IRA_BASEMENT: SectorPosition = { x: 10, y: 1, z: 1 };
const C5: SectorPosition = { x: 5, y: 3, z: 0 };
const G9: SectorPosition = { x: 9, y: 7, z: 0 };
const C13: SectorPosition = { x: 13, y: 3, z: 0 };
const D5: SectorPosition = { x: 5, y: 4, z: 0 };
const J9: SectorPosition = { x: 9, y: 10, z: 0 };
const K4_BASEMENT: SectorPosition = { x: 4, y: 11, z: 1 };
const I16: SectorPosition = { x: 16, y: 9, z: 0 };
const B15: SectorPosition = { x: 15, y: 2, z: 0 };
const C16: SectorPosition = { x: 16, y: 3, z: 0 };
const E14: SectorPosition = { x: 14, y: 5, z: 0 };
const D12: SectorPosition = { x: 12, y: 4, z: 0 };

function sameSector(a: SectorPosition | null, b: SectorPosition): boolean {
  return a !== null && a.x === b.x && a.y === b.y && a.z === b.z;
}

function profileSector(p: ProfileProgress): SectorPosition {
  return { x: p.sectorX, y: p.sectorY, z: p.sectorZ };
}

function dead(ctx: FactContext, profile: number): boolean {
  const p = ctx.campaign.profile(profile);
  return p !== null && isProfileDead(p);
}

function soldier(ctx: FactContext, profile: number): FactSoldier | null {
  return ctx.world.soldierByProfile(profile);
}

function npcWounded(ctx: FactContext, profile: number, byPlayerOnly: boolean): boolean {
  const s = soldier(ctx, profile);
  if (!s || s.life >= s.lifeMax) return false;
  return !byPlayerOnly || ((ctx.campaign.profile(profile)?.miscFlags ?? 0) & ProfileMiscFlag.WOUNDED_BY_PLAYER) !== 0;
}

function npcInOkayHealth(ctx: FactContext, profile: number): boolean {
  const s = soldier(ctx, profile);
  return s !== null && s.life > Math.trunc(s.lifeMax / 2) && s.life > OKAY_HEALTH_LIFE;
}

function npcBleeding(ctx: FactContext, profile: number): boolean {
  const s = soldier(ctx, profile);
  return s !== null && s.life > 0 && s.bleeding > 0;
}

function npcWithin(ctx: FactContext, first: number, second: number, range: number): boolean {
  const a = soldier(ctx, first);
  const b = soldier(ctx, second);
  return a !== null && b !== null && pythSpacesAway(a.gridNo, b.gridNo) <= range;
}

function guyVisible(ctx: FactContext, npc: number, guy: number): boolean {
  const viewer = soldier(ctx, npc);
  const target = soldier(ctx, guy);
  return viewer !== null && target !== null && ctx.world.seesCurrently(viewer, target);
}

function npcAt(ctx: FactContext, npc: number, gridNo: number): boolean {
  return soldier(ctx, npc)?.gridNo === gridNo;
}

function npcIsEnemy(ctx: FactContext, profile: number): boolean {
  const s = soldier(ctx, profile);
  if (!s) return false;
  if (s.side !== Side.FRIENDLY && !s.neutral) return true;
  if (s.civilianGroup === CivilianGroup.NONE) return false;
  return ctx.campaign.civGroupHostility(s.civilianGroup) >= CivGroupHostility.WILL_BECOME_HOSTILE;
}

function numWoundedMercsNearby(ctx: FactContext, profile: number): number {
  const npc = soldier(ctx, profile);
  if (!npc) return 0;
  return ctx.world
    .mercsInSector()
    .filter(
      (s) =>
        s.ourTeam &&
        s.life > 0 &&
        s.life < s.lifeMax &&
        s.assignment !== Assignment.ASSIGNMENT_HOSPITAL &&
        pythSpacesAway(npc.gridNo, s.gridNo) <= HOSPITAL_PATIENT_DISTANCE,
    ).length;
}

function numMercsNear(ctx: FactContext, profile: number, range: number): number {
  const npc = soldier(ctx, profile);
  if (!npc) return 0;
  return ctx.world.mercsInSector().filter((s) => s.ourTeam && s.life >= OKLIFE && pythSpacesAway(npc.gridNo, s.gridNo) < range).length;
}

function npcIsEpc(ctx: FactContext, profile: number): boolean {
  if (dead(ctx, profile)) return false;
  return ctx.world.soldierOnPlayerTeam(profile)?.kind === MercKind.EPC;
}

function npcInRoom(ctx: FactContext, profile: number, room: number): boolean {
  const s = soldier(ctx, profile);
  return s !== null && ctx.world.room(s.gridNo) === room;
}

function npcInRoomRange(ctx: FactContext, profile: number, first: number, last: number): boolean {
  const s = soldier(ctx, profile);
  if (!s) return false;
  const room = ctx.world.room(s.gridNo);
  return room >= first && room <= last;
}

function pcInSameRoom(ctx: FactContext, profile: number): boolean {
  const npc = soldier(ctx, profile);
  if (!npc) return false;
  const room = ctx.world.room(npc.gridNo);
  return ctx.world.ourTeam().some((s) => s.inSector && ctx.world.room(s.gridNo) === room);
}

function talkerStrong(ctx: FactContext): boolean {
  const { src, dest } = ctx.talk;
  if (src?.ourTeam) return src.strength >= STRONG_TALKER;
  if (dest?.ourTeam) return dest.strength >= STRONG_TALKER;
  return false;
}

function profiledOurTalker(s: FactSoldier | null): s is FactSoldier {
  return s?.ourTeam === true && s.profile < NUM_PROFILES;
}

function talkerFemale(ctx: FactContext): boolean {
  const { src, dest } = ctx.talk;
  const talker = profiledOurTalker(src) ? src : profiledOurTalker(dest) ? dest : null;
  return talker !== null && ctx.campaign.profile(talker.profile)?.sex === FEMALE;
}

function talkerUnpropositionedFemale(ctx: FactContext): boolean {
  const { src, dest } = ctx.talk;
  const talker = profiledOurTalker(src) ? src : profiledOurTalker(dest) ? dest : null;
  if (!talker) return false;
  const p = ctx.campaign.profile(talker.profile);
  if (!p || p.miscFlags2 & ProfileMiscFlag2.ASKED_BY_HICKS) return false;
  return p.sex === FEMALE;
}

function profiledOfSexWithin(ctx: FactContext, profile: number, sex: number, range: number): FactSoldier[] {
  const npc = soldier(ctx, profile);
  if (!npc) return [];
  return ctx.world
    .mercsInSector()
    .filter(
      (s) =>
        s.ourTeam &&
        s.life >= OKLIFE &&
        s.profile < NUM_PROFILES &&
        ctx.campaign.profile(s.profile)?.sex === sex &&
        pythSpacesAway(npc.gridNo, s.gridNo) <= range,
    );
}

function playerHasHead(ctx: FactContext): boolean {
  const { firstHead, lastHead } = ctx.items;
  if (firstHead < 0) return false;
  return ctx.world.ourTeam().some((s) => s.life > 0 && ctx.world.carriesItemInRange(s, firstHead, lastHead));
}

function npcSector(ctx: FactContext, profile: number, sector: SectorPosition): boolean {
  const onTeam = ctx.world.soldierOnPlayerTeam(profile);
  if (onTeam) return sameSector(onTeam.sector, sector);
  const p = ctx.campaign.profile(profile);
  return p !== null && sameSector(profileSector(p), sector);
}

function aimMercWithin(ctx: FactContext, gridNo: number, range: number): boolean {
  return ctx.world
    .mercsInSector()
    .some((s) => s.ourTeam && s.life >= OKLIFE && s.kind === MercKind.AIM_MERC && pythSpacesAway(gridNo, s.gridNo) <= range);
}

function countBartenders(ctx: FactContext): number {
  return BARTENDERS.filter((id) => (ctx.campaign.profile(id)?.npcData ?? 0) !== 0).length;
}

function bartender(ctx: FactContext, profile: number, order: number): boolean {
  if (profile >= NUM_PROFILES) return false;
  const data = ctx.campaign.profile(profile)?.npcData ?? 0;
  return data === order || (data === 0 && countBartenders(ctx) === order - 1);
}

function townOf(ctx: FactContext, profile: number): number {
  return profile < NUM_PROFILES ? (ctx.campaign.profile(profile)?.town ?? BLANK_TOWN) : BLANK_TOWN;
}

function trackedTownRating(ctx: FactContext, town: number): number | null {
  if (town === BLANK_TOWN) return null;
  const t = ctx.towns.loyalty(town);
  return t.started && t.usesLoyalty ? t.rating : null;
}

function loyaltyLow(ctx: FactContext, profile: number): boolean {
  const rating = trackedTownRating(ctx, townOf(ctx, profile));
  if (rating === null) return false;
  if (profile === Npc.SKYRIDER) {
    const talkState = ctx.campaign.skyriderTalkState();
    if (talkState === 0 || ctx.campaign.now() - ctx.campaign.lastSkyriderMonologue() < SKYRIDER_MONOLOGUE_PAUSE_MINUTES) return false;
  }
  return rating < LOYALTY_LOW_THRESHOLD;
}

function playerOwnsTownsIncludingOmerta(ctx: FactContext, test: (whole: number) => boolean): boolean {
  return test(ctx.towns.wholeTownsUnderControl()) && ctx.towns.townUnderCompleteControl(OMERTA);
}

function inControlledMine(ctx: FactContext, mine: number): boolean {
  const world = ctx.world.sector;
  return world !== null && ctx.mines.mineIdOfSector(world) === mine && !ctx.campaign.sectorEnemyControlled(world);
}

function enoughLoyaltyToTrainMilitia(ctx: FactContext): boolean {
  const world = ctx.world.sector;
  if (!world) return false;
  const town = ctx.towns.townIdOfSector(world);
  if (town === BLANK_TOWN) return false;
  const t = ctx.towns.loyalty(town);
  return t.usesLoyalty && t.started && t.rating >= MIN_RATING_TO_TRAIN_TOWN;
}

function newShipmentWaiting(ctx: FactContext): boolean {
  const delivery = ctx.campaign.primaryDelivery();
  if (!delivery || !sameSector(ctx.world.sector, delivery.sector)) return false;
  return ctx.world.invisibleItemPoolAt(delivery.gridNo, GROUND_LEVEL);
}

function bobbyRayShipmentFacts(ctx: FactContext): void {
  const n = ctx.narrative;
  const punished =
    factValue(n, Fact.PABLO_PUNISHED_BY_PLAYER) === 1 && factValue(n, Fact.PABLO_RETURNED_GOODS) === 0 && !dead(ctx, Npc.PABLO);
  let inTransit = false;
  let waiting = false;
  if (!punished) {
    if (newShipmentWaiting(ctx)) waiting = true;
    else if (ctx.campaign.bobbyRayOrdersInTransit() > 0) inTransit = factValue(n, Fact.PACKAGE_DAMAGED) !== 1;
  }
  setFact(n, Fact.BOBBYRAY_SHIPMENT_IN_TRANSIT, inTransit);
  setFact(n, Fact.NEW_BOBBYRAY_SHIPMENT_WAITING, waiting);
}

function npcHeardShot(ctx: FactContext, profile: number): boolean {
  return soldier(ctx, profile)?.heardGunshot === true;
}

function npcFlags(ctx: FactContext, profile: number): ProfileProgress | null {
  return profile < NUM_PROFILES ? ctx.campaign.profile(profile) : null;
}

type Rule = (ctx: FactContext, profile: number) => boolean;

const ALIVE_RULES: readonly (readonly [number, number])[] = [
  [Fact.DOREEN_ALIVE, Npc.DOREEN],
  [Fact.WALDO_ALIVE, Npc.WALDO],
  [Fact.PERKO_ALIVE, Npc.PERKO],
  [Fact.TONY_ALIVE, Npc.TONY],
  [Fact.VINCE_ALIVE, Npc.VINCE],
  [Fact.JENNY_ALIVE, Npc.JENNY],
  [Fact.ARNOLD_ALIVE, Npc.ARNIE],
  [Fact.JOEY_ALIVE, Npc.JOEY],
  [Fact.ELGIN_ALIVE, Npc.DRUGGIST],
  [Fact.DYNAMO_ALIVE, Npc.DYNAMO],
  [Fact.MARY_ALIVE, Npc.MARY],
  [Fact.JOHN_ALIVE, Npc.JOHN],
];

const DEAD_RULES: readonly (readonly [number, number])[] = [
  [Fact.DIMITRI_DEAD, Npc.DIMITRI],
  [Fact.BRENDA_DEAD, Npc.BRENDA],
  [Fact.JOEY_DEAD, Npc.JOEY],
  [Fact.QUEEN_DEAD, Npc.QUEEN],
  [Fact.MARY_DEAD, Npc.MARY],
  [Fact.WARDEN_DEAD, Npc.WARDEN],
];

const SECTOR_RULES: readonly (readonly [number, number, SectorPosition])[] = [
  [Fact.CARMEN_IN_C5, Npc.CARMEN, C5],
  [Fact.JOEY_IN_C5, Npc.JOEY, C5],
  [Fact.SKYRIDER_IN_B15, Npc.SKYRIDER, B15],
  [Fact.SKYRIDER_IN_C16, Npc.SKYRIDER, C16],
  [Fact.SKYRIDER_IN_E14, Npc.SKYRIDER, E14],
  [Fact.SKYRIDER_IN_D12, Npc.SKYRIDER, D12],
];

const MINE_SPOKEN_RULES: readonly (readonly [number, number, number])[] = [
  [Fact.PLAYER_SPOKE_TO_DRASSEN_MINER, Fact.PLAYER_IN_CONTROLLED_DRASSEN_MINE, MINE_DRASSEN],
  [Fact.PLAYER_SPOKE_TO_CAMBRIA_MINER, Fact.PLAYER_IN_CONTROLLED_CAMBRIA_MINE, MINE_CAMBRIA],
  [Fact.PLAYER_SPOKE_TO_CHITZENA_MINER, Fact.PLAYER_IN_CONTROLLED_CHITZENA_MINE, MINE_CHITZENA],
  [Fact.PLAYER_SPOKE_TO_ALMA_MINER, Fact.PLAYER_IN_CONTROLLED_ALMA_MINE, MINE_ALMA],
  [Fact.PLAYER_SPOKE_TO_GRUMM_MINER, Fact.PLAYER_IN_CONTROLLED_GRUMM_MINE, MINE_GRUMM],
];

function buildRules(): Map<number, Rule> {
  const rules = new Map<number, Rule>();
  for (const [id, npc] of ALIVE_RULES) rules.set(id, (ctx) => !dead(ctx, npc));
  for (const [id, npc] of DEAD_RULES) rules.set(id, (ctx) => dead(ctx, npc));
  for (const [id, npc, sector] of SECTOR_RULES) rules.set(id, (ctx) => npcSector(ctx, npc, sector));
  for (const [spoken, controlled, mine] of MINE_SPOKEN_RULES) {
    rules.set(spoken, (ctx) => ctx.mines.spokenToHeadMiner(mine));
    rules.set(controlled, (ctx) => inControlledMine(ctx, mine));
  }
  const add = (id: number, rule: Rule) => rules.set(id, rule);
  add(Fact.CURRENT_SECTOR_IS_SAFE, (ctx, p) => !((ctx.world.enemyInSector() && npcHeardShot(ctx, p)) || ctx.world.inCombat()));
  add(Fact.NPC_WOUNDED, (ctx, p) => npcWounded(ctx, p, false));
  add(Fact.NPC_WOUNDED_BY_PLAYER, (ctx, p) => npcWounded(ctx, p, true));
  add(Fact.IRA_NOT_PRESENT, (ctx, p) => !npcWithin(ctx, p, Npc.IRA, IRA_RANGE));
  add(Fact.IRA_TALKING, (ctx) => ctx.talk.srcProfile === Npc.IRA);
  add(Fact.IRA_UNHIRED_AND_ALIVE, (ctx) => {
    const ira = ctx.campaign.profile(Npc.IRA);
    return !dead(ctx, Npc.IRA) && npcSector(ctx, Npc.IRA, IRA_BASEMENT) && !((ira?.miscFlags ?? 0) & ProfileMiscFlag.RECRUITED);
  });
  add(Fact.NPC_BLEEDING, (ctx, p) => npcBleeding(ctx, p));
  add(Fact.NPC_BLEEDING_BUT_OKAY, (ctx, p) => npcBleeding(ctx, p) && npcInOkayHealth(ctx, p));
  add(Fact.PLAYER_HAS_HEAD_AND_CARMEN_IN_SAN_MONA, (ctx) => npcSector(ctx, Npc.CARMEN, C5) && playerHasHead(ctx));
  add(Fact.PLAYER_HAS_HEAD_AND_CARMEN_IN_CAMBRIA, (ctx) => npcSector(ctx, Npc.CARMEN, G9) && playerHasHead(ctx));
  add(Fact.PLAYER_HAS_HEAD_AND_CARMEN_IN_DRASSEN, (ctx) => npcSector(ctx, Npc.CARMEN, C13) && playerHasHead(ctx));
  add(Fact.NPC_OWED_MONEY, (ctx, p) => (npcFlags(ctx, p)?.balance ?? 0) < 0);
  add(Fact.FATHER_DRUNK, (ctx) => (ctx.campaign.profile(Npc.FATHER)?.npcData ?? 0) >= DRUNK_LEVEL);
  add(Fact.MICKY_DRUNK, (ctx) => (ctx.campaign.profile(Npc.MICKY)?.npcData ?? 0) >= DRUNK_LEVEL);
  add(
    Fact.BRENDA_IN_STORE_AND_ALIVE,
    (ctx, p) => !dead(ctx, Npc.BRENDA) && npcInRoom(ctx, Npc.BRENDA, BRENDA_STORE_ROOM) && npcWithin(ctx, p, Npc.BRENDA, BRENDA_RANGE),
  );
  add(
    Fact.NPC_IS_ENEMY,
    (ctx, p) =>
      p < NUM_PROFILES &&
      (npcIsEnemy(ctx, p) || ((ctx.campaign.profile(p)?.miscFlags2 ?? 0) & ProfileMiscFlag2.NEEDS_TO_SAY_HOSTILE_QUOTE) !== 0),
  );
  add(Fact.SPIKE_AT_DOOR, (ctx) => npcAt(ctx, Npc.SPIKE, SPIKE_DOOR_GRIDNO));
  add(Fact.WOUNDED_MERCS_NEARBY, (ctx, p) => numWoundedMercsNearby(ctx, p) > 0);
  add(Fact.ONE_WOUNDED_MERC_NEARBY, (ctx, p) => numWoundedMercsNearby(ctx, p) === 1);
  add(Fact.MULTIPLE_WOUNDED_MERCS_NEARBY, (ctx, p) => numWoundedMercsNearby(ctx, p) > 1);
  add(Fact.HANS_AT_SPOT, (ctx) => npcAt(ctx, Npc.HANS, HANS_SPOT_GRIDNO));
  add(Fact.MULTIPLE_MERCS_CLOSE, (ctx, p) => numMercsNear(ctx, p, CLOSE_RANGE) > 1);
  add(Fact.SOME_MERCS_CLOSE, (ctx, p) => numMercsNear(ctx, p, CLOSE_RANGE) > 0);
  add(Fact.NPC_ESCORTED, (ctx, p) => npcIsEpc(ctx, p));
  add(Fact.MARIA_ESCORTED_AT_LEATHER_SHOP, (ctx) => npcIsEpc(ctx, Npc.MARIA) && npcInRoom(ctx, Npc.MARIA, MARIA_LEATHER_SHOP_ROOM));
  add(
    Fact.PC_STRONG_AND_LESS_THAN_3_MALES_PRESENT,
    (ctx, p) => talkerStrong(ctx) && profiledOfSexWithin(ctx, p, MALE, MALES_RANGE).length < MAX_MALES_PRESENT,
  );
  add(
    Fact.PC_STRONG_AND_3_PLUS_MALES_PRESENT,
    (ctx, p) => talkerStrong(ctx) && profiledOfSexWithin(ctx, p, MALE, MALES_RANGE).length >= MAX_MALES_PRESENT,
  );
  add(Fact.FEMALE_SPEAKING_TO_NPC, (ctx) => talkerFemale(ctx));
  add(
    Fact.JOEY_NEAR_MARTHA,
    (ctx) =>
      npcWithin(ctx, Npc.JOEY, Npc.MARTHA, JOEY_MARTHA_RANGE) &&
      (guyVisible(ctx, Npc.MARTHA, Npc.JOEY) || guyVisible(ctx, Npc.JOEY, Npc.MARTHA)),
  );
  add(Fact.MERC_NEAR_NPC, (ctx, p) => numMercsNear(ctx, p, NEAR_RANGE) > 0);
  add(Fact.REBELS_HATE_PLAYER, (ctx) => ctx.campaign.civGroupHostility(CivilianGroup.REBEL) === CivGroupHostility.HOSTILE);
  add(Fact.CURRENT_SECTOR_G9, (ctx) => sameSector(ctx.world.sector, G9));
  add(Fact.CURRENT_SECTOR_C5, (ctx) => sameSector(ctx.world.sector, C5));
  add(Fact.CURRENT_SECTOR_C13, (ctx) => sameSector(ctx.world.sector, C13));
  add(Fact.CARMEN_HAS_TEN_THOUSAND, (ctx) => (ctx.campaign.profile(Npc.CARMEN)?.money ?? 0) >= CARMEN_REWARD_MONEY);
  add(Fact.SLAY_IN_SECTOR, (ctx) => {
    const slay = ctx.campaign.profile(Npc.SLAY);
    return slay !== null && sameSector(ctx.world.sector, profileSector(slay));
  });
  add(Fact.SLAY_HIRED_AND_WORKED_FOR_48_HOURS, (ctx) => {
    const slay = ctx.campaign.profile(Npc.SLAY);
    return slay !== null && (slay.miscFlags & ProfileMiscFlag.RECRUITED) !== 0 && slay.totalDaysServed > SLAY_DAYS_SERVED;
  });
  add(
    Fact.SHANK_IN_SQUAD_BUT_NOT_SPEAKING,
    (ctx) =>
      ctx.world.soldierOnPlayerTeam(Npc.SHANK) !== null &&
      ((ctx.campaign.profile(Npc.SHANK)?.miscFlags ?? 0) & ProfileMiscFlag.RECRUITED) !== 0 &&
      (ctx.talk.src === null || ctx.talk.src.profile !== Npc.SHANK),
  );
  add(Fact.SHANK_NOT_IN_SECTOR, (ctx) => soldier(ctx, Npc.SHANK) === null);
  add(Fact.MINE_EMPTY, (ctx, p) => ctx.mines.empty(p));
  add(Fact.MINE_RUNNING_OUT, (ctx, p) => ctx.mines.runningOut(p));
  add(Fact.MINE_PRODUCING_BUT_LOYALTY_LOW, (ctx, p) => ctx.mines.producingForSomeTime(p) && ctx.mines.disloyal(p));
  add(Fact.CREATURES_IN_MINE, (ctx, p) => ctx.mines.infested(p));
  add(Fact.PLAYER_LOST_MINE, (ctx, p) => ctx.mines.lostAndRegained(p));
  add(Fact.MINE_AT_FULL_PRODUCTION, (ctx, p) => ctx.mines.atMaxProduction(p));
  add(Fact.DYNAMO_IN_J9, (ctx) => npcSector(ctx, Npc.DYNAMO, J9) && ctx.campaign.numEnemiesInAnySector(J9) > 0);
  add(Fact.DYNAMO_SPEAKING_OR_NEARBY, (ctx) => {
    const src = ctx.talk.src;
    if (!src) return false;
    return (
      src.profile === Npc.DYNAMO || (npcWithin(ctx, src.profile, Npc.DYNAMO, DYNAMO_RANGE) && guyVisible(ctx, src.profile, Npc.DYNAMO))
    );
  });
  add(Fact.JOHN_AND_MARY_EPCS, (ctx) => npcIsEpc(ctx, Npc.JOHN) && npcIsEpc(ctx, Npc.MARY));
  add(Fact.MARY_BLEEDING, (ctx) => npcBleeding(ctx, Npc.MARY));
  add(Fact.JOHN_BLEEDING, (ctx) => npcBleeding(ctx, Npc.JOHN));
  add(Fact.ANOTHER_FIGHT_POSSIBLE, (ctx) => ctx.boxing.anotherFightPossible());
  add(Fact.RECEIVING_INCOME_FROM_DCAC, (ctx) =>
    [MINE_DRASSEN, MINE_ALMA, MINE_CAMBRIA, MINE_CHITZENA].every((mine) => ctx.mines.predictedDailyIncome(mine) > 0),
  );
  add(Fact.PLAYER_BEEN_TO_K4, (ctx) => ctx.campaign.sectorVisited(K4_BASEMENT));
  add(Fact.PLAYER_PAID_FOR_TWO_IN_BROTHEL, (ctx) => (ctx.campaign.profile(Npc.MADAME)?.npcData ?? 0) > 1);
  add(Fact.LOYALTY_OKAY, (ctx, p) => {
    const rating = trackedTownRating(ctx, townOf(ctx, p));
    return rating !== null && rating >= LOYALTY_LOW_THRESHOLD && rating < LOYALTY_OK_THRESHOLD;
  });
  add(Fact.LOYALTY_LOW, (ctx, p) => loyaltyLow(ctx, p));
  add(Fact.LOYALTY_HIGH, (ctx, p) => {
    const rating = trackedTownRating(ctx, townOf(ctx, p));
    return rating !== null && rating >= LOYALTY_HIGH_THRESHOLD;
  });
  add(Fact.SPEAKER_AIM_OR_AIM_NEARBY, (ctx) => ctx.talk.dest !== null && aimMercWithin(ctx, ctx.talk.dest.gridNo, AIM_RANGE));
  add(Fact.MALE_SPEAKING_FEMALE_PRESENT, (ctx, p) => !talkerFemale(ctx) && profiledOfSexWithin(ctx, p, FEMALE, FEMALES_RANGE).length > 0);
  add(Fact.PLAYER_OWNS_2_TOWNS_INCLUDING_OMERTA, (ctx) => playerOwnsTownsIncludingOmerta(ctx, (n) => n === TOWNS_FOR_TWO));
  add(Fact.PLAYER_OWNS_3_TOWNS_INCLUDING_OMERTA, (ctx) => playerOwnsTownsIncludingOmerta(ctx, (n) => n === TOWNS_FOR_THREE));
  add(Fact.PLAYER_OWNS_4_TOWNS_INCLUDING_OMERTA, (ctx) => playerOwnsTownsIncludingOmerta(ctx, (n) => n >= TOWNS_FOR_FOUR));
  add(Fact.PLAYER_FOUGHT_THREE_TIMES_TODAY, (ctx) => !ctx.boxing.boxerAvailable());
  add(Fact.PLAYER_DOING_POORLY, (ctx) => ctx.campaign.currentProgress() < PROGRESS_POORLY);
  add(Fact.PLAYER_DOING_WELL, (ctx) => ctx.campaign.currentProgress() > PROGRESS_WELL);
  add(Fact.PLAYER_DOING_VERY_WELL, (ctx) => ctx.campaign.currentProgress() > PROGRESS_VERY_WELL);
  add(
    Fact.FATHER_DRUNK_AND_SCIFI_OPTION_ON,
    (ctx) => (ctx.campaign.profile(Npc.FATHER)?.npcData ?? 0) >= DRUNK_LEVEL && ctx.campaign.sciFi,
  );
  add(
    Fact.BLOODCAT_QUEST_STARTED_TWO_DAYS_AGO,
    (ctx) =>
      questStatus(ctx.narrative, Quest.BLOODCATS) !== QuestStatus.NOT_STARTED &&
      ctx.campaign.now() - ctx.campaign.timeQuestWasStarted(Quest.BLOODCATS) > BLOODCAT_QUEST_WAIT_MINUTES,
  );
  add(Fact.NOTHING_REPAIRED_YET, (ctx, p) => ctx.repairs.fixingButNoneDone(p));
  add(Fact.NPC_COWERING, (ctx, p) => soldier(ctx, p)?.cowering === true);
  add(
    Fact.TOP_AND_BOTTOM_LEVELS_CLEARED,
    (ctx) => factValue(ctx.narrative, Fact.TOP_LEVEL_CLEARED) !== 0 && factValue(ctx.narrative, Fact.BOTTOM_LEVEL_CLEARED) !== 0,
  );
  add(Fact.FIRST_BARTENDER, (ctx, p) => bartender(ctx, p, 1));
  add(Fact.SECOND_BARTENDER, (ctx, p) => bartender(ctx, p, 2));
  add(Fact.THIRD_BARTENDER, (ctx, p) => bartender(ctx, p, 3));
  add(Fact.FOURTH_BARTENDER, (ctx, p) => bartender(ctx, p, 4));
  add(Fact.NPC_NOT_UNDER_FIRE, (ctx, p) => soldier(ctx, p)?.underFire !== true);
  add(
    Fact.KINGPIN_NOT_IN_OFFICE,
    (ctx) => !(sameSector(ctx.world.sector, D5) && npcInRoomRange(ctx, Npc.KINGPIN, KINGPIN_OFFICE_ROOMS.first, KINGPIN_OFFICE_ROOMS.last)),
  );
  add(Fact.DONT_OWE_KINGPIN_MONEY, (ctx) => questStatus(ctx.narrative, Quest.KINGPIN_MONEY) !== QuestStatus.IN_PROGRESS);
  add(
    Fact.NO_CLUB_FIGHTING_ALLOWED,
    (ctx) => questStatus(ctx.narrative, Quest.KINGPIN_MONEY) === QuestStatus.IN_PROGRESS || ctx.narrative.boxing.resting,
  );
  add(Fact.MADDOG_IS_SPEAKER, (ctx) => ctx.talk.srcProfile === Npc.MADDOG);
  add(
    Fact.PC_HAS_CONRADS_RECRUIT_OPINION,
    (ctx) =>
      ctx.talk.dest !== null &&
      ctx.dialogue.desireToTalk(ctx.talk.dest.profile, ctx.talk.srcProfile, APPROACH_RECRUIT) >= CONRAD_RECRUIT_OPINION,
  );
  add(
    Fact.NPC_HOSTILE_OR_PISSED_OFF,
    (ctx, p) => npcIsEnemy(ctx, p) || ((ctx.campaign.profile(p)?.miscFlags3 ?? 0) & ProfileMiscFlag3.NPC_PISSED_OFF) !== 0,
  );
  add(Fact.TONY_IN_BUILDING, (ctx) => npcSector(ctx, Npc.TONY, C5) && npcInRoom(ctx, Npc.TONY, TONY_BUILDING_ROOM));
  add(Fact.SHANK_SPEAKING, (ctx) => ctx.talk.src?.profile === Npc.SHANK);
  add(
    Fact.ROCKET_RIFLE_EXISTS,
    (ctx) => ctx.items.rocketRifle >= 0 && ctx.world.itemTypeExistsAt(ROCKET_RIFLE_GRIDNO, ctx.items.rocketRifle, GROUND_LEVEL),
  );
  add(Fact.I16_BLOODCATS_KILLED, (ctx) => ctx.campaign.bloodCats(I16) === 0);
  add(
    Fact.NPC_BANDAGED_TODAY,
    (ctx, p) => ((npcFlags(ctx, p)?.miscFlags2 ?? 0) & ProfileMiscFlag2.BANDAGED_TODAY) !== 0 && p < NUM_PROFILES,
  );
  add(Fact.PLAYER_IN_SAME_ROOM, (ctx, p) => pcInSameRoom(ctx, p));
  add(Fact.ENOUGH_LOYALTY_TO_TRAIN_MILITIA, (ctx) => enoughLoyaltyToTrainMilitia(ctx));
  add(Fact.WALKER_AT_BAR, (ctx) => {
    const father = ctx.campaign.profile(Npc.FATHER);
    return father !== null && father.sectorX === C13.x && father.sectorY === C13.y;
  });
  add(Fact.UNPROPOSITIONED_FEMALE_SPEAKING_TO_NPC, (ctx) => talkerUnpropositionedFemale(ctx));
  add(Fact.FACT_84_AND_85_TRUE, (ctx, p) => checkFact(ctx, Fact.FACT_84, p) && checkFact(ctx, Fact.HANS_AT_SPOT, p));
  add(Fact.KINGPIN_IS_ENEMY, (ctx) => ctx.campaign.civGroupHostility(CivilianGroup.KINGPIN) >= CivGroupHostility.WILL_BECOME_HOSTILE);
  add(Fact.DYNAMO_NOT_SPEAKER, (ctx) => !(ctx.talk.src !== null && ctx.talk.src.profile === Npc.DYNAMO));
  add(Fact.PABLO_BRIBED, (ctx, p) => !checkFact(ctx, Fact.PABLOS_BRIBED, p));
  add(
    Fact.VEHICLE_PRESENT,
    (ctx, p) =>
      checkFact(ctx, Fact.OK_USE_HUMMER, p) &&
      (ctx.world.soldierOnPlayerTeam(Npc.PROF_HUMMER) !== null || ctx.world.soldierOnPlayerTeam(Npc.PROF_ICECREAM) !== null),
  );
  add(Fact.PLAYER_KILLED_BOXERS, (ctx) => !ctx.boxing.boxerExists());
  add(Fact.FACT_245, (ctx) => factValue(ctx.narrative, Fact.FACT_245) !== 0 || ctx.world.soldierOnPlayerTeam(Npc.MIGUEL) !== null);
  return rules;
}

const RULES = buildRules();
const SHIPMENT_FACTS: ReadonlySet<number> = new Set([Fact.BOBBYRAY_SHIPMENT_IN_TRANSIT, Fact.NEW_BOBBYRAY_SHIPMENT_WAITING]);

export function isComputedFact(id: number): boolean {
  return RULES.has(id) || SHIPMENT_FACTS.has(id);
}

export function checkFact(ctx: FactContext, id: number, profile: number): boolean {
  const n = ctx.narrative;
  if (SHIPMENT_FACTS.has(id)) bobbyRayShipmentFacts(ctx);
  else {
    const rule = RULES.get(id);
    if (rule) setFact(n, id, rule(ctx, profile));
  }
  return factValue(n, id) !== 0;
}

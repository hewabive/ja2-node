// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-16. See LICENSE (SFI-SCLA).
// @src src/game/Strategic/Quests.cc (the facts and quests of a campaign); Strategic/Game_Event_Hook.cc EVENT_CHECKFORQUESTS,
// @src EVENT_DAILY_EARLY_MORNING_EVENTS, EVENT_SECOND_AIRPORT_ATTENDANT_ARRIVED, EVENT_KEITH_GOING_OUT_OF_BUSINESS,
// @src EVENT_SET_BY_NPC_SYSTEM,
// @src EVENT_REMOVE_ASSASSIN; Strategic/Strategic_Event_Handler.cc AddSecondAirportAttendant, RemoveAssassin;
// @src Strategic/StrategicMap.cc HandleQuestCodeOnSectorEntry, HandleQuestCodeOnSectorExit; Tactical/Overhead.cc
// @src HandleNPCTeamMemberDeath (MakeRemainingTerroristsTougher, MakeRemainingAssassinsTougher, the DYNAMO, KINGPIN and DOREEN
// @src cases); Strategic/Hourly_Update.cc HourlyLarryUpdate (the merc side); Tactical/Soldier_Profile.cc SwapLarrysProfiles
// @src (the soldier side); Strategic/Quests.cc CheckFact (the boxing inputs: AnotherFightPossible, BoxerAvailable, BoxerExists);
// @src StrategicMap.cc HandleQuestCodeOnSectorEntry (gBoxer cleared in D5). See docs/25 §1–§4, §7, §11.12.

import { NOTHING } from '../../../content/items/items.ts';
import { MercType } from '../../../content/strategic/economy-content.ts';
import { sectorFromId, sectorShortString, strategicIndex } from '../../../content/strategic/sector-ids.ts';
import type { SimEvent } from '../../events.ts';
import { copyObjectInto, createItem, createItems, createMoney, emptyObject } from '../../items/object.ts';
import { StrategicAiAction } from '../../strategic/ai/constants.ts';
import { type ProgressMilestones, queenProgress } from '../../strategic/ai/difficulty.ts';
import { executeStrategicAIAction } from '../../strategic/ai/reactions.ts';
import { Assignment, Town } from '../../strategic/economy/constants.ts';
import { findObj, NO_SLOT, Slot, useKitPoints } from '../../strategic/economy/kits.ts';
import { decrementTownLoyalty, incrementTownLoyalty } from '../../strategic/economy/loyalty.ts';
import { dealerIdFromProfile } from '../../strategic/economy/merchants/context.ts';
import { estoniRefuellingBecamePossible } from '../../strategic/economy/merchants/daily.ts';
import { repairmanIsFixingItemsButNoneAreDoneYet } from '../../strategic/economy/merchants/repair.ts';
import { placeHeadMinersOnSectorEntry } from '../../strategic/economy/mines.ts';
import type { PeriodicSlots } from '../../strategic/economy/ports.ts';
import { countAllMilitiaInSector, playerMercsInSector } from '../../strategic/forces/groups.ts';
import { townIdOfSector } from '../../strategic/map/control.ts';
import {
  checkFact,
  type FactBoxing,
  type FactCampaign,
  type FactContext,
  type FactItems,
  type FactSoldier,
  NO_FACT_ITEMS,
  NO_FACT_REPAIRS,
  NO_TALK,
  SRC_PROFILE_AT_START,
  type TalkContext,
} from '../../strategic/narrative/check-fact.ts';
import { civGroupHostility } from '../../strategic/narrative/civ-groups.ts';
import { handleEarlyMorningEvents } from '../../strategic/narrative/early-morning.ts';
import { economyFactCampaign, economyFactMines, economyFactTowns } from '../../strategic/narrative/economy-facts.ts';
import { Fact, Quest } from '../../strategic/narrative/fact-ids.ts';
import { type FactHooks, fact, factValue, QuestStatus, questStatus, setFactFalse, setFactTrue } from '../../strategic/narrative/facts.ts';
import {
  applyProgressMilestones,
  handleSlayDailyEvent,
  hourlyCheckIfSlayAloneSoHeCanLeave,
  hourlyQuestUpdate,
  type SlayContext,
} from '../../strategic/narrative/hourly.ts';
import { hourlyLarryUpdate, type LarryContext, swapLarrysProfileRecords } from '../../strategic/narrative/larry.ts';
import { Npc } from '../../strategic/narrative/npc-ids.ts';
import {
  decideOnAssassin,
  makeRemainingAssassinsTougher,
  makeRemainingTerroristsTougher,
  type ProfileItems,
  type ProfileSoldierInventory,
  removeAssassin,
  setProfileSector,
  type TougheningContext,
} from '../../strategic/narrative/presence.ts';
import {
  checkForQuests,
  endQuest,
  initQuestEngine,
  type QuestContext,
  QuestHistory,
  startQuest,
} from '../../strategic/narrative/quests.ts';
import { awardExperienceBonusToActiveSquad, ExperienceBonus, handleLoyaltyChangeForNpcAction } from '../../strategic/narrative/rewards.ts';
import type { SectorPosition } from '../../strategic/state.ts';
import { EventKind } from '../../strategic/time/constants.ts';
import type { EventDispatch } from '../../strategic/time/dispatch.ts';
import { addStrategicEvent } from '../../strategic/time/event-queue.ts';
import { worldDay, worldHour, worldTotalMinutes } from '../../strategic/time/world-clock.ts';
import type { TacticalContent } from '../../tactical/content.ts';
import type { InsertionContext } from '../../tactical/insertion.ts';
import { anotherFightPossible, boxerAvailable, boxerExists, clearBoxers } from '../../tactical/narrative/boxing.ts';
import type { PlacementNarrative } from '../../tactical/narrative/placement.ts';
import type { ProfileInsertionHooks } from '../../tactical/narrative/profile-insertion.ts';
import { isProfileDead, type ProfileProgress, profileProgress } from '../../tactical/profiles.ts';
import type { Soldier } from '../../tactical/soldier.ts';
import type { CampaignSim } from '../campaign-sim.ts';
import { HistoryCode } from '../contracts/quotes.ts';
import { addTransaction, FinanceCode } from '../finances.ts';
import { addHistory, timeQuestWasStarted } from '../laptop/records.ts';
import type { Roster, RosterMerc } from '../roster.ts';
import type { QuestEventWithoutTick } from './events.ts';
import { campaignFactWorld, factSoldierById } from './fact-world.ts';
import { hospitalSuppliesCheck, kingpinMoneyCheck, npcSystemEvent } from './quest-world.ts';

const RANDOM_ASSASSIN_ROLL = 10;
const ASSASSIN_ROLL_THRESHOLD = 3;
const NO_TOWN = 0;
const BOXING_SECTOR: SectorPosition = { x: 5, y: 4, z: 0 };
const ELLIOT_SECTOR: SectorPosition = { x: 3, y: 16, z: 0 };
const HOSPITAL: SectorPosition = { x: 8, y: 6, z: 0 };
const CONRAD_SECTOR: SectorPosition = { x: 13, y: 8, z: 0 };
const KINGPIN_MONEY_SECTOR: SectorPosition = { x: 5, y: 4, z: 1 };
const NPC_ACTION_FREE_KIDS = 117;

export interface TalkSoldiers {
  src: number | null;
  dest: number | null;
  srcProfile: number;
}

export interface NarrativeSlots {
  dialogueDesireToTalk(npc: number, merc: number, approach: number): number;
  resetOncePerConvoRecords(): void;
  kingpinMoneyCheck(onExit: boolean): void;
  hospitalSupplies(): void;
  boxersCleared(): void;
  scientistAwolMeanwhile(): void;
  hasUnusedRecordWithApproach(profile: number, approach: number): boolean;
  npcReachedDestination(s: Soldier): void;
  npcAction(npc: number, action: number): void;
}

export const NO_NARRATIVE_SLOTS: NarrativeSlots = {
  dialogueDesireToTalk: () => 0,
  resetOncePerConvoRecords: () => {},
  kingpinMoneyCheck: () => {},
  hospitalSupplies: () => {},
  boxersCleared: () => {},
  scientistAwolMeanwhile: () => {},
  hasUnusedRecordWithApproach: () => false,
  npcReachedDestination: () => {},
  npcAction: () => {},
};

function sameSector(a: SectorPosition | null, b: SectorPosition): boolean {
  return a !== null && a.x === b.x && a.y === b.y && a.z === b.z;
}

function sameMapSector(a: SectorPosition, b: SectorPosition): boolean {
  return a.x === b.x && a.y === b.y;
}

function questName(id: number): string {
  return Object.entries(Quest).find(([, q]) => q === id)?.[0] ?? `QUEST_${id}`;
}

export class NarrativeFlow {
  readonly campaign: CampaignSim;
  readonly talk: TalkSoldiers = { src: null, dest: null, srcProfile: SRC_PROFILE_AT_START };
  slots: NarrativeSlots;
  readonly #events: SimEvent[] = [];

  constructor(campaign: CampaignSim) {
    this.campaign = campaign;
    this.slots = {
      ...NO_NARRATIVE_SLOTS,
      kingpinMoneyCheck: (onExit) => kingpinMoneyCheck(campaign, onExit),
      hospitalSupplies: () => hospitalSuppliesCheck(campaign),
      boxersCleared: () => clearBoxers(campaign.state.narrative.boxing),
    };
  }

  get state() {
    return this.campaign.state;
  }

  drainEvents(): SimEvent[] {
    return this.#events.splice(0);
  }

  #emit(e: QuestEventWithoutTick): void {
    this.#events.push({ ...e, tick: this.campaign.tick } as SimEvent);
  }

  content(): TacticalContent | null {
    return this.campaign.battle?.content ?? this.campaign.sectors?.setup.content ?? null;
  }

  roster(): Roster | null {
    return this.campaign.battle?.roster ?? this.campaign.sectors?.setup.roster ?? null;
  }

  profile(id: number): ProfileProgress | null {
    const existing = this.state.profiles.get(id);
    if (existing) return existing;
    const content = this.content();
    return content ? profileProgress({ profiles: this.state.profiles, content }, id) : null;
  }

  factHooks(): FactHooks {
    return {
      estoniRefuellingPossible: () => {
        const merchants = this.campaign.merchants;
        if (merchants) estoniRefuellingBecamePossible(merchants);
      },
    };
  }

  setFactTrue(id: number): void {
    setFactTrue(this.state.narrative, id, this.factHooks());
  }

  setFactFalse(id: number): void {
    setFactFalse(this.state.narrative, id);
  }

  checkFact(id: number, profile = 0): boolean {
    return checkFact(this.factContext(), id, profile);
  }

  #factItems(): FactItems {
    const items = this.content()?.items;
    if (!items) return NO_FACT_ITEMS;
    const id = (name: string) => items.byName.get(name)?.index ?? -1;
    return { firstHead: id('HEAD_2'), lastHead: id('HEAD_7'), rocketRifle: id('ROCKET_RIFLE') };
  }

  #factCampaign(): FactCampaign {
    const s = this.state;
    const laptop = this.campaign.laptop;
    const queen = this.campaign.queen;
    const overrides: Partial<FactCampaign> = {
      profile: (id) => this.profile(id),
      currentProgress: () => (queen ? queenProgress(queen) : 0),
      bobbyRayOrdersInTransit: () => s.laptop.bobbyRay.shipments.filter((sh) => sh.active).length,
      primaryDelivery: () => {
        const primary = laptop?.content.destinations.find((d) => d.isPrimary);
        if (!primary || primary.deliverySector === null) return null;
        const sector = sectorFromId(primary.deliverySector);
        return { sector: { x: sector.x, y: sector.y, z: primary.deliverySectorZ }, gridNo: primary.gridNo };
      },
      timeQuestWasStarted: (quest) => timeQuestWasStarted(s.laptop, quest),
      skyriderTalkState: () => s.forces.helicopter.talkState,
      lastSkyriderMonologue: () => s.forces.helicopter.lastMonologueMinute,
    };
    const economy = this.campaign.economy;
    if (economy) return economyFactCampaign(economy, overrides);
    return {
      sciFi: s.options.sciFi,
      now: () => worldTotalMinutes(s.clock),
      profile: (id) => this.profile(id),
      civGroupHostility: (group) => s.civGroups.hostility[group] ?? 0,
      currentProgress: () => 0,
      sectorEnemyControlled: () => true,
      sectorVisited: () => false,
      bloodCats: () => 0,
      numEnemiesInAnySector: () => 0,
      bobbyRayOrdersInTransit: () => 0,
      primaryDelivery: () => null,
      timeQuestWasStarted: () => 0,
      skyriderTalkState: () => 0,
      lastSkyriderMonologue: () => 0,
      ...overrides,
    };
  }

  #factBoxing(): FactBoxing {
    const record = this.state.narrative.boxing;
    const tactical = () => this.campaign.tactical?.state ?? null;
    return {
      anotherFightPossible: () => anotherFightPossible(record, tactical()),
      boxerAvailable: () => boxerAvailable(record, tactical()),
      boxerExists: () => boxerExists(tactical()),
    };
  }

  #worldSource() {
    return { roster: this.roster(), tactical: this.campaign.tactical?.state ?? null, world: this.state.worldSector };
  }

  talkContext(): TalkContext {
    const source = this.#worldSource();
    const resolve = (id: number | null): FactSoldier | null => (id === null ? null : factSoldierById(source, id));
    if (this.talk.src === null && this.talk.dest === null && this.talk.srcProfile === SRC_PROFILE_AT_START) return NO_TALK;
    return { src: resolve(this.talk.src), dest: resolve(this.talk.dest), srcProfile: this.talk.srcProfile };
  }

  factContext(): FactContext {
    const economy = this.campaign.economy;
    const merchants = this.campaign.merchants;
    const noTowns = {
      loyalty: () => ({ rating: 0, started: false, usesLoyalty: false }),
      townIdOfSector: () => NO_TOWN,
      wholeTownsUnderControl: () => 0,
      townUnderCompleteControl: () => false,
    };
    const noMines = {
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
    };
    return {
      narrative: this.state.narrative,
      campaign: this.#factCampaign(),
      towns: economy ? economyFactTowns(economy) : noTowns,
      mines: economy ? economyFactMines(economy) : noMines,
      world: campaignFactWorld(this.#worldSource()),
      talk: this.talkContext(),
      boxing: this.#factBoxing(),
      repairs: merchants
        ? {
            fixingButNoneDone: (profile) => {
              const dealer = dealerIdFromProfile(merchants, profile);
              return dealer >= 0 && repairmanIsFixingItemsButNoneAreDoneYet(merchants, dealer);
            },
          }
        : NO_FACT_REPAIRS,
      dialogue: { desireToTalk: (npc, merc, approach) => this.slots.dialogueDesireToTalk(npc, merc, approach) },
      items: this.#factItems(),
    };
  }

  history(code: number, secondCode: number, sector: SectorPosition | null): void {
    this.#history(code, secondCode, sector);
  }

  #history(code: number, secondCode: number, sector: SectorPosition | null): void {
    const laptop = this.campaign.laptop;
    if (laptop) laptop.history(code, secondCode, sector);
    else addHistory(this.state.laptop, code, secondCode, worldTotalMinutes(this.state.clock), sector);
    if (code !== QuestHistory.QUEST_STARTED && code !== QuestHistory.QUEST_FINISHED) return;
    const where = sector !== null && sector.x >= 1 && sector.y >= 1 ? sectorShortString(sector) : null;
    const type = code === QuestHistory.QUEST_STARTED ? 'questStarted' : 'questFinished';
    this.#emit({ type, quest: questName(secondCode), id: secondCode, sector: where });
  }

  questContext(): QuestContext {
    return {
      narrative: this.state.narrative,
      sciFi: this.state.options.sciFi,
      history: (code, secondCode, sector) => this.#history(code, secondCode, sector),
      madame: () => this.profile(Npc.MADAME),
    };
  }

  startQuest(quest: number, sector: SectorPosition | null): void {
    startQuest(this.questContext(), quest, sector);
  }

  endQuest(quest: number, sector: SectorPosition | null): void {
    endQuest(this.questContext(), quest, sector);
  }

  initQuestEngine(): void {
    initQuestEngine(this.questContext());
  }

  awardExperience(bonus: number): void {
    const economy = this.campaign.economy;
    if (economy) awardExperienceBonusToActiveSquad(economy, bonus);
  }

  loyaltyForNpcAction(npc: number): void {
    const economy = this.campaign.economy;
    if (economy) handleLoyaltyChangeForNpcAction(economy, npc, this.profile(Npc.JOEY)?.mercStatus ?? 0);
  }

  profileItems(): ProfileItems | null {
    const content = this.content();
    if (!content) return null;
    return { table: content.items, soldier: (profile) => this.#profileSoldier(profile) };
  }

  #profileSoldier(profile: number): ProfileSoldierInventory | null {
    const content = this.content();
    const t = this.campaign.tactical?.state;
    const roster = this.roster();
    const s = roster?.byProfile(profile)?.soldier ?? t?.soldiers.find((x) => x?.placed && x.profile === profile) ?? null;
    if (!s || !content) return null;
    return {
      slotEmpty: (slot) => (s.inv[slot]?.item ?? 0) === 0,
      put: (slot, item, status, count) => {
        const target = s.inv[slot];
        if (target) copyObjectInto(target, createItems(content.items, item, status, count));
      },
      putMoney: (slot, amount) => {
        const target = s.inv[slot];
        if (target) copyObjectInto(target, createMoney(content.items, amount));
      },
      remove: (item) => {
        const slot = s.inv.findIndex((o) => o.item === item);
        const target = s.inv[slot];
        if (target) copyObjectInto(target, emptyObject());
      },
    };
  }

  #npcOrRpcProfiles(): ProfileProgress[] {
    const types = this.campaign.economy?.economy.mercTypes;
    if (!types) return [];
    const ids = [...types.entries()].filter(([, t]) => t === MercType.RPC || t === MercType.NPC).map(([id]) => id);
    return ids
      .sort((a, b) => a - b)
      .map((id) => this.profile(id))
      .filter((p): p is ProfileProgress => p !== null);
  }

  #placementSectors(profile: number): readonly number[] {
    return this.campaign.strategic?.content.npcPlacements.find((p) => p.profile === profile)?.sectors ?? [];
  }

  earlyMorning(): void {
    const items = this.profileItems();
    if (!items) return;
    const s = this.state;
    const content = this.content();
    const id = (name: string) => content?.items.byName.get(name)?.index ?? -1;
    handleEarlyMorningEvents({
      narrative: s.narrative,
      world: s.worldSector,
      items,
      heads: { first: id('HEAD_1'), last: id('HEAD_7') },
      random: (n) => s.rng.int(n),
      preRandom: (n) => s.pre.int(n),
      profile: (pid) => this.profile(pid),
      npcOrRpcProfiles: () => this.#npcOrRpcProfiles(),
      placementSectors: (pid) => this.#placementSectors(pid),
      onPlayerTeam: (pid) => this.roster()?.byProfile(pid) !== undefined,
      clearDefaultResponses: (p) => {
        p.friendlyOrDirectDefaultResponseUsedRecently = 0;
        p.recruitDefaultResponseUsedRecently = 0;
        p.threatenDefaultResponseUsedRecently = 0;
      },
      checkForMissingHospitalSupplies: () => this.slots.hospitalSupplies(),
    });
  }

  #slayContext(): SlayContext {
    const strategic = this.campaign.strategic;
    return {
      slay: () => {
        const m = this.roster()?.byProfile(Npc.SLAY);
        return m
          ? {
              life: m.life,
              betweenSectors: m.betweenSectors,
              sector: m.sector,
              assignment: m.assignment,
              contractEnd: m.contract.contractEnd,
            }
          : null;
      },
      playerMercsInSector: (sector) => (strategic ? playerMercsInSector(strategic, sector) : 0),
      chance: (percent) => this.state.rng.int(100) < percent,
      leaves: () => {
        const m = this.roster()?.byProfile(Npc.SLAY);
        if (!m) return;
        m.contract.leaveHistoryCode = HistoryCode.SLAY_MYSTERIOUSLY_LEFT;
        this.state.contracts.pendingEndings.push({ kind: 'withoutEquipment', soldier: m.id });
      },
    };
  }

  #larryMerc(): RosterMerc | null {
    const roster = this.roster();
    return roster?.byProfile(Npc.LARRY_NORMAL) ?? roster?.byProfile(Npc.LARRY_DRUNK) ?? null;
  }

  #larryContext(): LarryContext {
    const s = this.state;
    const items = this.content()?.items;
    const itemId = (name: string) => items?.byName.get(name)?.index ?? NOTHING;
    return {
      narrative: s.narrative,
      larry: () => {
        const m = this.#larryMerc();
        if (!m || !items) return null;
        const inv = m.soldier.inv;
        return {
          profile: m.profile,
          assignment: m.assignment,
          betweenSectors: m.betweenSectors,
          inLoadedSector: m.soldier.placed,
          sector: m.sector,
          findItem: (name) => findObj(inv, itemId(name)),
          emptySlotForBooze: () => {
            for (let slot = Slot.HAND; slot <= Slot.SMALLPOCK8; slot++) if ((inv[slot]?.item ?? NOTHING) === NOTHING) return slot;
            return NO_SLOT;
          },
          giveFullItem: (slot, name, status) => {
            const target = inv[slot];
            if (target) copyObjectInto(target, createItem(items, itemId(name), status));
          },
          useKitPoints: (slot, points) => {
            const target = inv[slot];
            if (target) useKitPoints(target, points);
          },
        };
      },
      enemyInLoadedSectorOrTactical: () => this.campaign.tactical?.state.turn.enemyInSector === true || s.flow === 'tactical',
      balance: () => s.finances.balance,
      alcoholPrice: () => items?.byName.get('ALCOHOL')?.price ?? 0,
      payForBooze: (profile, amount) => {
        const record = addTransaction(s.finances, FinanceCode.TRANSFER_FUNDS_TO_MERC, profile, worldTotalMinutes(s.clock), -amount);
        this.campaign.laptop?.emitMoney(record);
      },
      normalProfile: () => this.profile(Npc.LARRY_NORMAL),
      random: (n) => s.rng.int(n),
      swapProfiles: () => this.#swapLarrysProfiles(),
      onDutyAssignment: Assignment.ON_DUTY,
    };
  }

  #swapLarrysProfiles(): void {
    const m = this.#larryMerc();
    const content = this.content();
    if (!m || !content) return;
    const fromId = m.profile;
    const toId = fromId === Npc.LARRY_NORMAL ? Npc.LARRY_DRUNK : Npc.LARRY_NORMAL;
    const from = this.profile(fromId);
    const to = this.profile(toId);
    const record = content.profiles[toId] ?? null;
    if (!from || !to) return;
    swapLarrysProfileRecords(this.state.narrative, from, to);
    m.swapProfile(toId, record, to.stats);
  }

  slayDailyEvent(): void {
    handleSlayDailyEvent(this.#slayContext(), worldDay(this.state.clock), Assignment.IN_TRANSIT, Assignment.ASSIGNMENT_POW);
  }

  periodicSlots(progress: (() => ProgressMilestones) | null): PeriodicSlots {
    return {
      hourlyProgressUpdate: () => {
        if (!progress) return;
        applyProgressMilestones(
          {
            narrative: this.state.narrative,
            profile: (id) => this.profile(id),
            scientistAwolMeanwhile: () => this.slots.scientistAwolMeanwhile(),
          },
          progress(),
        );
      },
      hourlyQuestUpdate: () => hourlyQuestUpdate(this.state.narrative, worldHour(this.state.clock)),
      hourlyLarryUpdate: () => hourlyLarryUpdate(this.#larryContext()),
      hourlyCheckIfSlayAloneSoHeCanLeave: () => hourlyCheckIfSlayAloneSoHeCanLeave(this.#slayContext()),
    };
  }

  register(dispatch: EventDispatch<CampaignSim>): void {
    dispatch.register(EventKind.CHECKFORQUESTS, () => checkForQuests(this.questContext()));
    dispatch.register(EventKind.DAILY_EARLY_MORNING_EVENTS, () => this.earlyMorning());
    dispatch.register(EventKind.SECOND_AIRPORT_ATTENDANT_ARRIVED, () => this.#secondAirportAttendant());
    dispatch.register(EventKind.KEITH_GOING_OUT_OF_BUSINESS, () => {
      if (!this.checkFact(Fact.HILLBILLIES_KILLED, Npc.KEITH)) this.setFactTrue(Fact.KEITH_OUT_OF_BUSINESS);
    });
    dispatch.register(EventKind.SET_BY_NPC_SYSTEM, (c, e) => npcSystemEvent(c, e.param));
    dispatch.register(EventKind.REMOVE_ASSASSIN, (_, e) => {
      const p = this.profile(e.param);
      if (p) removeAssassin(p);
    });
  }

  #secondAirportAttendant(): void {
    const sal = this.profile(Npc.SAL);
    const strategic = this.campaign.strategic;
    if (sal && strategic) setProfileSector(sal, sectorFromId(strategic.content.shipping.primaryDeliverySector));
  }

  #tougheningContext(): TougheningContext | null {
    const items = this.profileItems();
    const content = this.content();
    if (!items || !content) return null;
    const id = (name: string) => content.items.byName.get(name)?.index ?? 0;
    return {
      items,
      toughening: {
        miniGrenade: id('MINI_GRENADE'),
        handGrenade: id('HAND_GRENADE'),
        mustardGrenade: id('MUSTARD_GRENADE'),
        rocketLauncher: id('ROCKET_LAUNCHER'),
      },
      difficulty: this.state.options.difficulty,
      profile: (pid) => this.profile(pid),
      slayOnPlayerTeam: () => this.roster()?.byProfile(Npc.SLAY) !== undefined,
    };
  }

  terroristKilled(): void {
    const ctx = this.#tougheningContext();
    if (ctx) makeRemainingTerroristsTougher(ctx, this.state.terrorists.count);
  }

  assassinKilled(): void {
    const ctx = this.#tougheningContext();
    if (ctx) makeRemainingAssassinsTougher(ctx);
  }

  handleQuestCodeOnSectorEntry(sector: SectorPosition): void {
    if (this.checkFact(Fact.ALL_TERRORISTS_KILLED, 0)) {
      const carmen = this.profile(Npc.CARMEN);
      this.endQuest(Quest.KILL_TERRORISTS, carmen ? { x: carmen.sectorX, y: carmen.sectorY, z: carmen.sectorZ } : null);
      if (carmen) setProfileSector(carmen, null);
    }
    const economy = this.campaign.economy;
    if (economy) placeHeadMinersOnSectorEntry(economy, sector);
    if (!this.checkFact(Fact.ROBOT_RECRUITED_AND_MOVED, 0) && this.roster()?.byProfile(Npc.ROBOT))
      this.setFactTrue(Fact.ROBOT_RECRUITED_AND_MOVED);
    if (this.#anyMercCarries('CHALICE')) this.setFactTrue(Fact.CHALICE_STOLEN);
    this.#maybeSendAssassin(sector);
    if (sameMapSector(sector, BOXING_SECTOR)) this.slots.boxersCleared();
    if (sameMapSector(sector, ELLIOT_SECTOR)) {
      const elliot = this.profile(Npc.ELLIOT);
      if (elliot && !isProfileDead(elliot)) elliot.life = elliot.stats.lifeMax;
    }
    this.slots.resetOncePerConvoRecords();
  }

  #anyMercCarries(name: string): boolean {
    const item = this.content()?.items.byName.get(name)?.index;
    if (item === undefined) return false;
    return (this.roster()?.all() ?? []).some((m) => m.soldier.inv.some((o) => o.item === item));
  }

  #maybeSendAssassin(sector: SectorPosition): void {
    const s = this.state;
    const strategic = this.campaign.strategic;
    if (!strategic) return;
    if (questStatus(s.narrative, Quest.KINGPIN_MONEY) !== QuestStatus.IN_PROGRESS || !this.checkFact(Fact.KINGPIN_CAN_SEND_ASSASSINS, 0))
      return;
    const town = townIdOfSector(strategic, { x: sector.x, y: sector.y, z: 0 });
    if (town === NO_TOWN) return;
    if (s.rng.int(RANDOM_ASSASSIN_ROLL + countAllMilitiaInSector(strategic, sector)) >= ASSASSIN_ROLL_THRESHOLD) return;
    decideOnAssassin({
      world: sector,
      town,
      now: worldTotalMinutes(s.clock),
      random: (n) => s.rng.int(n),
      profile: (pid) => this.profile(pid),
      removeAssassinAt: (minute, pid) => addStrategicEvent(s.queue, EventKind.REMOVE_ASSASSIN, minute, pid),
    });
  }

  handleQuestCodeOnSectorExit(old: SectorPosition): void {
    if (sameSector(old, KINGPIN_MONEY_SECTOR)) this.slots.kingpinMoneyCheck(true);
    if (sameSector(old, CONRAD_SECTOR) && this.checkFact(Fact.CONRAD_SHOULD_GO, 0)) {
      const conrad = this.profile(Npc.CONRAD);
      if (conrad) setProfileSector(conrad, null);
    }
    if (sameSector(old, HOSPITAL)) this.slots.hospitalSupplies();
    this.setFactFalse(Fact.MUSEUM_ALARM_WENT_OFF);
  }

  fact(id: number): boolean {
    return fact(this.state.narrative, id);
  }

  profileDied(profile: number): void {
    const world = this.state.worldSector;
    if (profile === Npc.DYNAMO) {
      if (questStatus(this.state.narrative, Quest.FREE_DYNAMO) === QuestStatus.IN_PROGRESS) this.endQuest(Quest.FREE_DYNAMO, world);
    } else if (profile === Npc.KINGPIN) this.#kingpinDied(world);
    else if (profile === Npc.DOREEN) this.#doreenDied(world);
  }

  #kingpinDied(world: SectorPosition | null): void {
    if (questStatus(this.state.narrative, Quest.KINGPIN_MONEY) === QuestStatus.IN_PROGRESS) {
      this.endQuest(Quest.KINGPIN_MONEY, world);
      this.awardExperience(ExperienceBonus.AVERAGE);
    }
    this.setFactTrue(Fact.KINGPIN_DEAD);
    const queen = this.campaign.queen;
    if (queen) executeStrategicAIAction(queen, StrategicAiAction.KINGPIN_DEAD, null);
  }

  #doreenDied(world: SectorPosition | null): void {
    const economy = this.campaign.economy;
    const amounts = economy?.economy.loyalty.amounts;
    if (economy && this.checkFact(Fact.DOREEN_HAD_CHANGE_OF_HEART, 0))
      decrementTownLoyalty(economy, Town.DRASSEN, amounts?.BONUS_CHILDREN_FREED_DOREEN_SPARED ?? 0);
    if (economy) incrementTownLoyalty(economy, Town.DRASSEN, amounts?.BONUS_CHILDREN_FREED_DOREEN_KILLED ?? 0);
    this.setFactTrue(Fact.DOREEN_HAD_CHANGE_OF_HEART);
    this.endQuest(Quest.FREE_CHILDREN, world);
    if (!this.checkFact(Fact.KIDS_ARE_FREE, 0)) this.slots.npcAction(Npc.DOREEN, NPC_ACTION_FREE_KIDS);
  }

  placementNarrative(world: SectorPosition): PlacementNarrative {
    const s = this.state;
    return {
      world,
      profile: (id) => this.profile(id),
      profileOnPlayerTeam: (id) => this.roster()?.byProfile(id) !== undefined,
      civGroupHostility: (group) => civGroupHostility(s.civGroups, group),
      questStatus: (quest) => questStatus(s.narrative, quest),
      checkFact: (id, profile) => this.checkFact(id, profile),
      rawFact: (id) => factValue(s.narrative, id),
      inMeanwhile: () => this.campaign.strategic?.world.inMeanwhile() ?? false,
      useAlternateQueenPosition: () => s.queen.useAlternateQueenPosition,
      sectorEnemyControlled: (sector) => s.map.elements[strategicIndex(sector)]?.enemyControlled ?? true,
      random: (n) => s.rng.int(n),
      preRandom: (n) => s.pre.int(n),
    };
  }

  #insertedProfileIds(): number[] {
    const types = this.campaign.economy?.economy.mercTypes;
    if (!types) return [];
    return [...types.entries()]
      .filter(([, t]) => t === MercType.RPC || t === MercType.NPC || t === MercType.VEHICLE)
      .map(([id]) => id)
      .sort((a, b) => a - b);
  }

  profileInsertionHooks(insertion: () => InsertionContext): ProfileInsertionHooks {
    const types = this.campaign.economy?.economy.mercTypes;
    return {
      profile: (id) => this.profile(id),
      insertedProfileIds: () => this.#insertedProfileIds(),
      isPlayerMerc: (profile) => {
        const t = types?.get(profile);
        return t === MercType.AIM || t === MercType.MERC || t === MercType.IMP;
      },
      insertionContext: insertion,
      reachedDestination: (s) => this.slots.npcReachedDestination(s),
      hasUnusedRecordWithApproach: (profile, approach) => this.slots.hasUnusedRecordWithApproach(profile, approach),
    };
  }

  placeHeadMiner(profile: number, sector: SectorPosition, town: number): void {
    const p = this.profile(profile);
    if (!p) return;
    setProfileSector(p, sector);
    p.town = town;
  }

  headMinerTown(profile: number): number {
    return this.profile(profile)?.town ?? 0;
  }

  headMinerAlive(profile: number): boolean {
    const p = this.profile(profile);
    return p !== null && !isProfileDead(p);
  }
}

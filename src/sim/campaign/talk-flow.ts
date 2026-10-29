// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-16. See LICENSE (SFI-SCLA).
// @src src/game/Tactical/Handle_UI.cc HandleTalkInit, GetRangeFromGridNoDiff; Soldier_Control.cc PlayerSoldierStartTalking;
// @src Interface_Dialogue.cc TalkPanelClickCallback, TalkPanelNameRegionClickCallback, HandleTalkingMenuEscape and
// @src DeleteTalkingMenu (Esc closes once the queue is empty and cuts the NPC's line short; the talk
// @src panel as a modal session); Dialogue_Control.cc HandleDialogue (ENGAGED_IN_CONV pause lock, LOCK_PAUSE_ENGAGED_IN_CONV);
// @src GameScreen.cc (HandleWaitTimerForNPCTrigger before, HandleDialogue after ExecuteOverhead); Soldier_Tile.cc
// @src TeleportSoldier; Scheduling.cc BumpAnyExistingMerc; Interface_Items.cc HandleItemPointerClick (the give branch,
// @src SetEngagedInConvFromPCAction for a profiled target that is no team member); Strategic/Assignments.cc UnEscortEPC
// @src (the assignment menu's "remove escort"); Dialogue_Control.cc StopAnyCurrentlyTalkingSpeech (Backspace cuts the
// @src line short).

import { NO_VOICE_LENGTHS, type VoiceLengths } from '../../content/audio/speech-lengths.ts';
import type { MercProfile } from '../../content/formats/prof.ts';
import { ItemClass, type ItemTable, WEAPON_CLASSES, WeaponClass } from '../../content/items/items.ts';
import type { QuoteLengths } from '../../content/narrative/dialogue-text.ts';
import { Approach, NPC_TALK_RADIUS } from '../../content/narrative/npc-constants.ts';
import type { NpcRecordContent } from '../../content/narrative/npc-records.ts';
import { type NarrativeScenes, NO_NARRATIVE_SCENES } from '../../content/narrative/scenes.ts';
import { MercType } from '../../content/strategic/economy-content.ts';
import { sameSector } from '../../content/strategic/sector-ids.ts';
import type { CommandResult } from '../command.ts';
import type { SimEvent } from '../events.ts';
import { beginCivQuote, type CivQuoteSaid, startCivQuote } from '../narrative/civ-quotes.ts';
import {
  closestPC,
  converse,
  deleteTalkingMenu,
  finishTalkingFace,
  handleTalkingMenuEscape,
  handleWaitTimerForNpcTrigger,
  initiateConversationFull,
  npcConsiderInitiatingConv,
  npcHasUnusedHostileRecord,
  npcHasUnusedRecordWithGivenApproach,
  npcReachedDestination,
  panelSoldier,
  pcDoesFirstAidOnNpc,
  pcsNearNpc,
  selectEnv,
  shutUpTalkingFace,
  stepDialogue,
  talkerSoldier,
  talkMenuBuySell,
  talkMenuGive,
  triggerNpcRecord,
  triggerNpcWithGivenApproach,
  triggerNpcWithIHateYouQuote,
} from '../narrative/converse.ts';
import {
  cutTalkingFace,
  delayedTacticalCharacterDialogue,
  dialogueTextKey,
  soldierByProfile,
  tacticalCharacterDialogue,
} from '../narrative/dialogue-queue.ts';
import { elliotFaceVariant, type FaceVariant } from '../narrative/face-variant.ts';
import { dealerTakesGive, giveToNpc, handleNpcItemGiven, returnItemToPlayer, takeGivenObject } from '../narrative/give.ts';
import type { FactSource, NarrativeHost, NpcActionPort, QuestPort } from '../narrative/host.ts';
import { ASSASSIN_PROFILES, NarrativeProfile, ProfileFlag, ProfileFlag2 } from '../narrative/narrative-ids.ts';
import { type ShipmentDelivery, stuffMissingFromShipment } from '../narrative/nearby-quotes.ts';
import {
  isNpcOrRpc,
  isPlayerMerc,
  profileType,
  replaceLocationInNpcData,
  resetOncePerConvoRecordsForAllNpcsInLoadedSector,
} from '../narrative/records.ts';
import { calcDesireToTalk, calcThreateningEffectiveness } from '../narrative/select.ts';
import { dialogueIdle, dialogueQueueIsEmptyAndNobodyIsTalking, type SpokenLine, type TalkState } from '../narrative/talk-state.ts';
import {
  CivType,
  getCivType,
  isRobotSoldier,
  type TalkableKind,
  type TalkableRules,
  talkableKind,
  talkableRefusal,
} from '../narrative/talkable.ts';
import { dealerIdFromProfile, isMercADealer } from '../strategic/economy/merchants/context.ts';
import { dealerState } from '../strategic/economy/merchants/state.ts';
import { shopKind } from '../strategic/economy/merchants/view.ts';
import { mineIdForSector, playerControlsMine } from '../strategic/economy/mine-status.ts';
import { fatigueCharacter } from '../strategic/economy/rest.ts';
import { NUMBER_OF_SQUADS } from '../strategic/forces/constants.ts';
import { townIdOfSector } from '../strategic/map/control.ts';
import { MikeGreeting } from '../strategic/narrative/facts.ts';
import { Npc } from '../strategic/narrative/npc-ids.ts';
import { Warp } from '../strategic/time/constants.ts';
import { lockPauseState, pauseGame, unLockPauseState, unPauseGame, warpGameTime, worldDay } from '../strategic/time/world-clock.ts';
import { cancelAIAction } from '../tactical/ai/control.ts';
import { setDesiredDirection } from '../tactical/animation.ts';
import { findAdjacentGridEx } from '../tactical/combat/melee-reach.ts';
import { findGridNoFromSweetSpot } from '../tactical/creation.ts';
import { setEngagedInConvFromPcAction, soldierGiveItem } from '../tactical/give.ts';
import { InvSlot } from '../tactical/inventory.ts';
import { directionToward, getNewSoldierPath, setSoldierPosition, stopMerc } from '../tactical/movement.ts';
import { addToShouldBecomeHostileOrSayQuoteList } from '../tactical/narrative/civ-hostility.ts';
import { triggerFriendWithHostileQuote } from '../tactical/narrative/npc-actions/generic.ts';
import { sexSceneWarpSeconds } from '../tactical/narrative/npc-actions/san-mona.ts';
import type { NarrativePort } from '../tactical/narrative/port.ts';
import { talkLineOfSight, talkRange, talkWalkUp } from '../tactical/narrative/talk-reach.ts';
import { revealRoofsAndItems } from '../tactical/perception/fov.ts';
import { handleSight } from '../tactical/perception/sight.ts';
import { deductPoints, enoughPoints } from '../tactical/points.ts';
import { type ProfileProgress, profileProgress } from '../tactical/profiles.ts';
import { effectiveLeadership, effectiveStrength } from '../tactical/skills.ts';
import { NO_PROFILE, NOWHERE, type Soldier, Team } from '../tactical/soldier.ts';
import { sectorMapOf, type TacticalState, whoIsThere } from '../tactical/state.ts';
import { selectSoldier } from '../tactical/turns/turns.ts';
import type { CampaignCommand, CampaignSim } from './campaign-sim.ts';
import { giveApRefusal, giveRequest, giverRefusal } from './give-flow.ts';
import { MoraleEvent } from './morale.ts';
import { campaignMeanwhileActions } from './narrative/meanwhile-actions.ts';
import type { NarrativeSlots } from './narrative/narrative-flow.ts';
import { NpcActionFlow, type NpcActionPorts } from './narrative/npc-action-flow.ts';
import { medicalCostAt, primaryDelivery } from './narrative/quest-world.ts';
import { MercKind, type RosterMerc } from './roster.ts';

export const AP_TALK = 6;
const LOCK_PAUSE_ENGAGED_IN_CONV = 14;
const OPPOSITE = 4;
const DIRECTIONS = 8;
const VALIDATED_TALK_RANGE = NPC_TALK_RADIUS * 2;
const QUEST_ARRAY_LENGTH = 30;
const OVERRUN_QUEST_VALUE = 0;
const BUMP_RADIUS = 5;
const SIGHT_LOOK_AND_RADIO = 3;
const ON_DUTY = 20;
const KINGPIN_HOUSE_ROOMS = { first: 30, last: 39 } as const;
const KINGPIN_SECTOR = { x: 5, y: 4, z: 0 } as const;
const ATTITUDE_NORMAL = 0;
const PLAYER_CHARACTER_MIN_PROFILE = 51;
const PLAYER_CHARACTER_MAX_PROFILE = 56;
const OwnMercBark = { NEGATIVE_COMPANY: 41, SOCIAL_TRAIT: 44, PASSING_DISLIKE: 45 } as const;
const MercQuote = { AIM_SEEN_MIKE: 55, SPOTTED_JOEY: 63 } as const;
const QUOTE_SAID_EXT_MIKE = 0x0010;
const TALK_COMMANDS: ReadonlySet<string> = new Set(['talk', 'approach', 'closeTalk', 'give', 'unescort', 'skipLine']);
const QUEUE_AT_ONCE_BUDGET = 1000;
const NEEDED_ITEMS = ['HEAD_2', 'HEAD_3', 'HEAD_5', 'HEAD_6', 'HEAD_7', 'MONEY', 'SILVER', 'GOLD', 'WINE', 'BEER', 'ALCOHOL'] as const;

const MENU_APPROACHES: Readonly<Record<string, number>> = {
  repeat: Approach.REPEAT,
  friendly: Approach.FRIENDLY,
  direct: Approach.DIRECT,
  threaten: Approach.THREATEN,
  recruit: Approach.RECRUIT,
  whoAreYou: Approach.NPC_WHOAREYOU,
};

const REFUSAL_TEXT: Readonly<Record<string, string>> = {
  notInTactical: 'conversations happen in the loaded sector',
  promptOpen: 'a prompt is open, answer it first',
  shopOpen: 'a shop is open, closeShop first',
  sessionOpen: 'a conversation is already open, closeTalk first',
  conversationOpen: 'a conversation is open, use approach or closeTalk',
  scriptedSequence: 'a scripted sequence is running, advance until it ends',
  noSuchTarget: 'there is nobody to talk to there',
  notTalkable: 'that soldier cannot be talked to',
  targetHidden: 'the squad does not see that soldier',
  targetMoving: 'the target is moving',
  talkerIsRobot: 'the robot cannot talk',
  noLineOfSight: 'the soldier cannot see the target',
  targetCollapsed: 'the target is unconscious',
  refusesToTalk: 'he does not want to talk',
  noPath: 'cannot get close enough',
  notEnoughAP: `not enough APs: ${AP_TALK} needed`,
  noConversation: 'no conversation is open',
  busy: 'the conversation is still running',
  unknownApproach: 'kind must be repeat, friendly, direct, threaten, recruit, whoAreYou, buySell or give',
  notADealer: 'this NPC does not trade, use give',
  isADealer: 'this NPC trades, use buySell',
  needItemOrMoney: 'give a slot (optionally with count) or an amount of money',
  noSlot: 'slot must be 0..18 or "hand"',
  emptySlot: 'that slot is empty',
  badCount: 'count must be 1 or the whole stack in the slot',
  badMoney: 'money is split off a pocket in steps of 10; give a whole pocket with slot',
  notEnoughMoney: 'no money pocket of this soldier holds that much',
  giverCannotGive: 'this soldier cannot hand anything over (escort, dying or in deep water)',
  giverBusy: 'the soldier is busy with an item, a door or another give',
  robotReload: 'reloading the robot is not supported yet',
  laptopOpen: 'the laptop is open, closeLaptop first',
  noSuchSoldier: 'no such soldier of yours',
  notAnEpc: 'that soldier is not an escort',
  notInSector: 'the escort is not in the loaded sector, release him from the map screen',
  notAvailable: 'escorts are released on the map screen or in the loaded sector',
};

export interface NarrativeSetup {
  readonly records: NpcRecordContent;
  readonly texts: QuoteLengths;
  readonly voices?: VoiceLengths;
  readonly items: ItemTable;
  readonly profiles: readonly MercProfile[];
  readonly scenes?: NarrativeScenes;
  readonly facts?: (campaign: CampaignSim) => FactSource;
  readonly quests?: (campaign: CampaignSim) => QuestPort;
  readonly actions?: (campaign: CampaignSim, catalog: NpcActionPort) => NpcActionPort;
  readonly npcActions?: NpcActionPorts;
}

export interface ConversationLineView {
  readonly profile: number;
  readonly quote: number;
  readonly record?: number;
  readonly textKey: SpokenLine['textKey'];
  readonly chars: number;
}

export interface ConversationView {
  readonly npc: number | null;
  readonly profile: number;
  readonly faceVariant: FaceVariant | null;
  readonly name: string;
  readonly talker: number | null;
  readonly initiatedBy: 'player' | 'npc';
  readonly menu: readonly string[];
  readonly lastQuotes: readonly ConversationLineView[];
  readonly busy: boolean;
}

type Json = Readonly<Record<string, unknown>>;

class Refusal extends Error {
  readonly code: string;

  constructor(code: string, text?: string) {
    super(`${code}: ${text ?? REFUSAL_TEXT[code] ?? 'refused'}`);
    this.code = code;
  }
}

const refuse = (code: string, text?: string): never => {
  throw new Refusal(code, text);
};

const GIVE_AP_TEXT = 'not enough APs: the walk plus 1 to give';
const SEX_FATIGUE_STEPS = 4;

const isInt = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v);

function civQuoteView(said: CivQuoteSaid): Json {
  return { soldier: said.soldier, quote: said.quote, entry: said.entry, hint: said.hint, textKey: said.textKey };
}

const rangeBetween = talkRange;

export class TalkFlow {
  readonly host: NarrativeHost;
  readonly npcActions: NpcActionFlow;
  readonly #campaign: CampaignSim;
  readonly #setup: NarrativeSetup;
  readonly #events: SimEvent[] = [];
  #skipsSpeech = false;

  constructor(campaign: CampaignSim, setup: NarrativeSetup) {
    this.#campaign = campaign;
    this.#setup = setup;
    this.host = this.#createHost();
    const ports = setup.npcActions ?? {};
    const meanwhile = { ...campaignMeanwhileActions(campaign, this.host), ...ports.meanwhile };
    this.npcActions = new NpcActionFlow(campaign, this.host, { ...ports, meanwhile }, (e) => this.#emit(e));
  }

  get talk(): TalkState {
    return this.#campaign.state.talk.dialogue;
  }

  get #scripted(): boolean {
    return this.#campaign.state.talk.scripted;
  }

  set #scripted(scripted: boolean) {
    this.#campaign.state.talk.scripted = scripted;
  }

  get #civQuote(): CivQuoteSaid | null {
    return this.#campaign.state.talk.civQuote;
  }

  set #civQuote(said: CivQuoteSaid | null) {
    this.#campaign.state.talk.civQuote = said;
  }

  get #t(): TacticalState | null {
    return this.#campaign.tactical?.state ?? null;
  }

  get scenes(): NarrativeScenes {
    return this.#setup.scenes ?? NO_NARRATIVE_SCENES;
  }

  #profile(id: number): ProfileProgress | null {
    return profileProgress({ profiles: this.#campaign.state.profiles, content: { profiles: this.#setup.profiles } }, id);
  }

  #recruited(profile: number): boolean {
    return ((this.#profile(profile)?.miscFlags ?? 0) & ProfileFlag.RECRUITED) !== 0;
  }

  #isEpc(s: Soldier): boolean {
    const flagged = ((this.#profile(s.profile)?.miscFlags ?? 0) & ProfileFlag.EPCACTIVE) !== 0;
    return flagged || (this.#campaign.battle?.roster.get(s.id)?.isEpc ?? false);
  }

  #onSquad(s: Soldier): boolean {
    if (s.team !== Team.OUR) return false;
    const merc = this.#campaign.strategic?.mercs.get(s.id);
    return merc ? merc.assignment < ON_DUTY : true;
  }

  #emit(e: Record<string, unknown> & { readonly type: string }): void {
    this.#events.push({ ...e, tick: this.#campaign.tick } as SimEvent);
  }

  #itemFacts(): NarrativeHost['receive']['items'] {
    const items = this.#setup.items;
    const id = (name: string) => items.byName.get(name)?.index ?? -1;
    const ids = Object.fromEntries(NEEDED_ITEMS.map((n) => [n, id(n)])) as Record<(typeof NEEDED_ITEMS)[number], number>;
    const rocketLauncher = id('ROCKET_LAUNCHER');
    return {
      ids,
      leatherJacketPrice: items.byName.get('LEATHER_JACKET_W_KEVLAR')?.price ?? 0,
      isGunOfRifleClass: (item) => {
        const def = items.byIndex.get(item);
        const cls = def?.weapon?.weaponClass;
        return def?.itemClass === ItemClass.GUN && item !== rocketLauncher && (cls === WeaponClass.RIFLE || cls === WeaponClass.MG);
      },
    };
  }

  #kingpinInHisHouse(): boolean {
    const t = this.#t;
    const kingpin = soldierByProfile(this.host, NarrativeProfile.KINGPIN);
    const sector = t?.sector;
    if (!t || !kingpin || !sector || sector.x !== KINGPIN_SECTOR.x || sector.y !== KINGPIN_SECTOR.y || sector.z !== 0) return false;
    const room = sectorMapOf(t).rooms[kingpin.gridNo] ?? 0;
    return room >= KINGPIN_HOUSE_ROOMS.first && room <= KINGPIN_HOUSE_ROOMS.last;
  }

  #threat(merc: number): number {
    const t = this.#t;
    const s = t?.soldiers.find((x) => x?.placed && x.team === Team.OUR && x.profile === merc) ?? null;
    if (!s || !t) return 0;
    const hand = t.content.items.byIndex.get(s.inv[InvSlot.HAND]?.item ?? 0);
    const isWeapon = hand !== undefined && (hand.itemClass & WEAPON_CLASSES) !== 0;
    return calcThreateningEffectiveness({
      effectiveLeadership: effectiveLeadership(s),
      effectiveStrength: effectiveStrength(s),
      deadliness: isWeapon ? (hand?.weapon?.deadliness ?? 0) : 0,
    });
  }

  #teleport(s: Soldier, gridNo: number): void {
    const t = this.#t;
    if (!t) return;
    const occupant = t.soldiers.find((x) => x?.placed && x !== s && x.gridNo === gridNo && x.level === 0) ?? null;
    if (occupant) {
      const spot = findGridNoFromSweetSpot(t, occupant, gridNo, BUMP_RADIUS);
      if (spot !== NOWHERE) setSoldierPosition(t, occupant, spot);
    }
    setSoldierPosition(t, s, gridNo);
    s.finalDestination = gridNo;
    revealRoofsAndItems(t, s, true);
    handleSight(t, s, SIGHT_LOOK_AND_RADIO);
  }

  #frankCash(amount: number): void {
    const merchants = this.#campaign.merchants;
    if (!merchants) return;
    const id = dealerIdFromProfile(merchants, Npc.FRANK);
    if (id < 0) return;
    const status = dealerState(merchants.state, id).status;
    status.cash = (status.cash + amount) >>> 0;
  }

  #receivesAsTeamMember(s: Soldier): boolean {
    return (s.profile !== NO_PROFILE && isPlayerMerc(this.host, s.profile)) || this.#recruited(s.profile);
  }

  #sexEffects(s: Soldier): void {
    const merc = this.#campaign.battle?.roster.get(s.id) ?? null;
    const sector = this.#campaign.state.worldSector;
    if (merc && sector) this.#campaign.battle?.moraleEvent(merc, MoraleEvent.SEX, sector);
    const economy = this.#campaign.economy;
    const crew = economy?.crew.get(s.id);
    if (economy && crew) for (let k = 0; k < SEX_FATIGUE_STEPS; k++) fatigueCharacter(economy, crew);
    const rng = this.#campaign.state.rng;
    warpGameTime(
      this.#campaign.clockContext,
      sexSceneWarpSeconds((n) => rng.int(n)),
      Warp.NO_PROCESSING,
    );
  }

  #createHost(): NarrativeHost {
    const campaign = this.#campaign;
    const state = campaign.state;
    const setup = this.#setup;
    const tactical = () => this.#t;
    const catalog: NpcActionPort = {
      handleNpcDoAction: (npc, code, record) => {
        this.npcActions.handle(npc, code, record);
      },
    };
    const host: NarrativeHost = {
      records: state.npcRecords,
      content: setup.records,
      recruited: (p) => this.#recruited(p),
      meanwhile: () => (campaign.strategic?.world.inMeanwhile() ? state.meanwhile.current.id : null),
      talk: this.talk,
      context: campaign.narrative.talk,
      facts: setup.facts?.(campaign) ?? { checkFact: (id, npc) => campaign.narrative.checkFact(id, npc) },
      quests: setup.quests?.(campaign) ?? {
        startQuest: (quest, sector) => campaign.narrative.startQuest(quest, sector),
        endQuest: (quest, sector) => campaign.narrative.endQuest(quest, sector),
      },
      actions: setup.actions?.(campaign, catalog) ?? catalog,
      give: {
        placeObjectInSoldierProfile: (npc, object, giver) => takeGivenObject(host, npc, object, giver),
        returnItemToPlayer: (merc, object) => returnItemToPlayer(host, merc, object),
        handleNpcItemGiven: (npc, slot) => handleNpcItemGiven(host, npc, slot),
      },
      receive: {
        items: this.#itemFacts(),
        hospital: state.narrative.hospital,
        calcMedicalCost: (npc) => medicalCostAt(campaign, npc),
        frankCash: (amount) => this.#frankCash(amount),
        kingpinInHisHouse: () => this.#kingpinInHisHouse(),
        addProfileCost: (profile, amount) => {
          const costs = state.finances.profileCostToDate;
          costs.set(profile, ((costs.get(profile) ?? 0) + amount) >>> 0);
        },
        message: (m) => this.#emit({ type: 'npcMessage', kind: m.kind, profile: m.profile, amount: m.amount }),
      },
      mercLines: { sayLater: () => {}, mikeSaysHi: () => this.#mikeSaysHi() },
      civ: {
        townOfSector: (sector) => (campaign.economy ? townIdOfSector(campaign.economy, { x: sector.x, y: sector.y, z: 0 }) : 0),
        townUsesLoyalty: (town) => campaign.economy?.economy.loyalty.usesLoyalty[town] === true,
        playerControlsMineOf: (sector) => {
          const economy = campaign.economy;
          if (!economy) return false;
          const mine = mineIdForSector(economy, sector);
          return mine >= 0 && playerControlsMine(economy, mine);
        },
      },
      quoteLengths: setup.texts,
      voiceLengths: setup.voices ?? NO_VOICE_LENGTHS,
      tick: () => campaign.tick,
      day: () => worldDay(state.clock),
      random: (n) => state.rng.int(n),
      tactical,
      profile: (id) => this.#profile(id),
      setFact: (id, value) => (value ? campaign.narrative.setFactTrue(id) : campaign.narrative.setFactFalse(id)),
      questValue: (index) => (index < QUEST_ARRAY_LENGTH ? (state.narrative.quests[index] ?? 0) : OVERRUN_QUEST_VALUE),
      townRating: (town) => state.economy.towns[town]?.rating ?? 0,
      threat: (merc) => this.#threat(merc),
      voice: (profile) => state.laptop.imp.voices.get(profile) ?? profile,
      worldSector: () => state.worldSector,
      isEpc: (s) => this.#isEpc(s),
      onSquad: (s) => this.#onSquad(s),
      mercAsleep: (s) => campaign.strategic?.mercs.get(s.id)?.asleep ?? false,
      inMeanwhile: () => campaign.strategic?.world.inMeanwhile() ?? false,
      emit: (e) => this.#emit(e),
      setEngaged: (on) => {
        const t = this.#t;
        if (t) t.engagedInConv = on;
      },
      engaged: () => this.#t?.engagedInConv === true,
      pauseForConversation: (on) => {
        if (on) {
          pauseGame(state.clock);
          lockPauseState(state.clock, LOCK_PAUSE_ENGAGED_IN_CONV);
        } else {
          unLockPauseState(state.clock);
          unPauseGame(state.clock);
        }
      },
      selectTalker: (s) => {
        const t = this.#t;
        const merc = campaign.strategic?.mercs.get(s.id);
        if (merc && merc.assignment >= 0 && merc.assignment < NUMBER_OF_SQUADS) state.forces.currentSquad = merc.assignment;
        if (t) selectSoldier(t, s);
      },
      isDealer: (profile) => (campaign.merchants ? isMercADealer(campaign.merchants, profile) : false),
      openShop: (dealer) => {
        const talker = campaign.narrative.talk.src;
        if (talker !== null) campaign.shop?.openFromTalk(dealer, talker);
      },
      shopClosedByScript: (dealer) => campaign.merchants?.hooks.shopClosedByScript(dealer) ?? false,
      teleport: (s, gridNo) => this.#teleport(s, gridNo),
      releaseEscort: (npc) => this.npcActions.recruitFlow.removeEpc(npc),
      offSectorPlayerSoldier: (profile) => {
        const merc = campaign.battle?.roster.byProfile(profile);
        return merc && !merc.soldier.placed ? merc.soldier : null;
      },
      dialogueCallback: (name) => campaign.endgame.dialogueCallback(name),
      skipsSpeech: () => this.#skipsSpeech,
    };
    return host;
  }

  drainEvents(): SimEvent[] {
    return this.#events.splice(0);
  }

  isOpen(): boolean {
    return this.talk.inPanel;
  }

  dialogueIdle(): boolean {
    return dialogueIdle(this.talk);
  }

  scriptedSequence(): boolean {
    const talk = this.talk;
    return !talk.inPanel && (this.host.engaged() || talk.pending !== null || talk.waitingForTrigger);
  }

  frozen(): boolean {
    return this.talk.inPanel && dialogueIdle(this.talk) && !this.#campaign.state.meanwhile.inScene;
  }

  isIdle(): boolean {
    return dialogueIdle(this.talk) && !this.scriptedSequence();
  }

  hasPendingDecision(): boolean {
    return this.frozen() || this.requestOpen();
  }

  modalRefusal(): string | null {
    return this.frozen() ? new Refusal('conversationOpen').message : null;
  }

  beforeTacticalStep(): void {
    handleWaitTimerForNpcTrigger(this.host);
  }

  afterStrategicStep(): void {
    stepDialogue(this.host);
    this.#syncScripted();
  }

  afterTacticalStep(): void {
    stepDialogue(this.host);
    this.#openShopAfterOpening();
    this.npcActions.afterTacticalStep();
    this.#syncScripted();
  }

  requestOpen(): boolean {
    return this.npcActions.requestOpen();
  }

  #syncScripted(): void {
    const scripted = this.scriptedSequence();
    if (scripted === this.#scripted) return;
    this.#scripted = scripted;
    this.#emit({ type: 'scriptedSequence', active: scripted });
  }

  narrativePortHooks(): Partial<NarrativePort> {
    const host = this.host;
    return {
      isDealer: (profile) => host.isDealer(profile),
      dealerTakesGive: (giver, dealer, object, slot) =>
        dealerTakesGive(host, giver, dealer, object, slot, (profile, merc) => this.#campaign.shop?.openFromTalk(profile, merc.id)),
      receivesAsTeamMember: (target) => this.#receivesAsTeamMember(target),
      giveToNpc: (giver, target, object) => giveToNpc(host, giver, target, object),
      triggerDoneGivingItem: (profile) => {
        triggerNpcWithGivenApproach(host, profile, Approach.DONE_GIVING_ITEM);
      },
      isNpcProfile: (profile) => profileType(host, profile) === MercType.NPC,
      isNpcOrRpcProfile: (profile) => {
        const type = profileType(host, profile);
        return type === MercType.NPC || type === MercType.RPC;
      },
      sexEffects: (s) => this.#sexEffects(s),
      triggerNpcRecord: (profile, record) => triggerNpcRecord(host, profile, record),
      triggerNpcWithGivenApproach: (profile, approach) => {
        triggerNpcWithGivenApproach(host, profile, approach);
      },
      hasUnusedHostileRecord: (profile) => npcHasUnusedHostileRecord(host, profile),
      hasUnusedRecordWithApproach: (profile, approach) => npcHasUnusedRecordWithGivenApproach(host, profile, approach),
      sayHostileQuote: (s) => {
        triggerNpcWithIHateYouQuote(host, s.profile);
      },
      dialogueBusy: () => this.talk.queue.length > 0 || this.talk.inPanel || this.talk.waitingForTrigger,
      dialogueQueueIsEmptyAndNobodyIsTalking: () => dialogueQueueIsEmptyAndNobodyIsTalking(this.talk),
      startTalking: (s, target) => this.#startTalkingOnArrival(s, target),
      npcReachedDestination: (s) => npcReachedDestination(host, s, false),
      replaceLocationInNpcData: (profile, oldGridNo, newGridNo) => replaceLocationInNpcData(host, profile, oldGridNo, newGridNo),
      firstSightingRecord: (profile, record) => this.#firstSightingRecord(profile, record),
      mercSeesProfile: (merc, profile) => this.#mercSeesProfile(merc, profile),
      beginCivQuote: (s, quote, entry) => {
        beginCivQuote(host, s, quote, entry);
      },
      offerSurrender: (s) => this.#offerSurrender(s),
      pcsNearNpc: (profile) => pcsNearNpc(host, profile),
      pcDoesFirstAidOnNpc: (profile) => pcDoesFirstAidOnNpc(host, profile),
      npcConsiderInitiatingConv: (s) => npcConsiderInitiatingConv(host, s),
      triggerFriendWithHostileQuote: (profile) => triggerFriendWithHostileQuote(this.npcActions.env, profile),
      stuffMissingFromShipment: (gridNo) => stuffMissingFromShipment(host, gridNo, this.#shipmentDelivery()),
      sayQuote: (s, quote, delayed) => {
        if (delayed) delayedTacticalCharacterDialogue(host, s, quote);
        else tacticalCharacterDialogue(host, s, quote);
      },
    };
  }

  #shipmentDelivery(): ShipmentDelivery | null {
    const delivery = primaryDelivery(this.#campaign);
    const world = this.#campaign.state.worldSector;
    if (!delivery) return null;
    return { gridNo: delivery.gridNo, loadedHere: world !== null && sameSector(world, delivery.sector) };
  }

  #firstSightingRecord(profile: number, record: number): boolean {
    const p = this.#profile(profile);
    if (!p || p.miscFlags2 & ProfileFlag2.SAID_FIRSTSEEN_QUOTE) return false;
    triggerNpcRecord(this.host, profile, record);
    p.miscFlags2 |= ProfileFlag2.SAID_FIRSTSEEN_QUOTE;
    return true;
  }

  #mercSeesProfile(merc: Soldier, profile: number): void {
    const n = this.#campaign.state.narrative;
    if (profile === NarrativeProfile.MIKE) {
      const m = this.#campaign.battle?.roster.get(merc.id);
      if (!m || m.kind !== MercKind.AIM_MERC || m.quoteSaidExtFlags & QUOTE_SAID_EXT_MIKE) return;
      if (n.mikeShouldSayHi === MikeGreeting.NOT_YET) n.mikeShouldSayHi = MikeGreeting.PENDING;
      tacticalCharacterDialogue(this.host, merc, MercQuote.AIM_SEEN_MIKE);
      m.quoteSaidExtFlags |= QUOTE_SAID_EXT_MIKE;
      return;
    }
    if (n.playerTeamSawJoey) return;
    tacticalCharacterDialogue(this.host, merc, MercQuote.SPOTTED_JOEY);
    n.playerTeamSawJoey = true;
  }

  #mikeSaysHi(): void {
    const n = this.#campaign.state.narrative;
    const t = this.#t;
    if (n.mikeShouldSayHi !== MikeGreeting.PENDING || !t) return;
    const mike = soldierByProfile(this.host, NarrativeProfile.MIKE);
    if (!mike) return;
    const g = closestPC(this.host, mike);
    const player = g === NOWHERE ? null : whoIsThere(t, g, 0);
    if (!player) return;
    initiateConversationFull(this.host, mike, player, Approach.NPC_INITIAL_QUOTE, 0, null, 'npc');
    const p = this.#profile(NarrativeProfile.MIKE);
    if (p) p.miscFlags2 |= ProfileFlag2.SAID_FIRSTSEEN_QUOTE;
    n.mikeShouldSayHi = MikeGreeting.DONE;
  }

  #offerSurrender(s: Soldier): boolean {
    if (!startCivQuote(this.host, s)) return false;
    return this.#campaign.battle?.offerTacticalSurrender(s.id) ?? false;
  }

  narrativeSlots(): Pick<
    NarrativeSlots,
    'dialogueDesireToTalk' | 'resetOncePerConvoRecords' | 'hasUnusedRecordWithApproach' | 'npcReachedDestination' | 'npcAction'
  > {
    const host = this.host;
    const s = this.#campaign.state;
    return {
      dialogueDesireToTalk: (npc, merc, approach) => calcDesireToTalk(selectEnv(host), npc, merc, approach),
      resetOncePerConvoRecords: () =>
        resetOncePerConvoRecordsForAllNpcsInLoadedSector(host, s.worldSector, (profile) => {
          const p = s.profiles.get(profile);
          return p ? { x: p.sectorX, y: p.sectorY, z: p.sectorZ } : null;
        }),
      hasUnusedRecordWithApproach: (profile, approach) => npcHasUnusedRecordWithGivenApproach(host, profile, approach),
      npcReachedDestination: (soldier) => npcReachedDestination(host, soldier, false),
      npcAction: (npc, action) => {
        this.npcActions.handle(npc, action, 0);
      },
    };
  }

  dispatch(cmd: CampaignCommand): CommandResult | null {
    if (cmd.type === 'answer' && this.requestOpen()) return this.#answerRequest(cmd);
    const intercept = TALK_COMMANDS.has(cmd.type) || (cmd.type === 'openShop' && this.#campaign.shop !== null);
    try {
      if (!intercept) {
        if (this.frozen()) refuse('conversationOpen');
        if (this.scriptedSequence()) refuse('scriptedSequence');
        return null;
      }
      switch (cmd.type) {
        case 'talk':
          return this.#talkCommand(cmd);
        case 'approach':
          return this.#approach(cmd);
        case 'closeTalk':
          return this.#closeTalk();
        case 'give':
          return this.#give(cmd);
        case 'unescort':
          return this.#unescort(cmd);
        case 'skipLine':
          return this.#skipLine(cmd);
        default:
          return this.#openShop(cmd);
      }
    } catch (e) {
      if (e instanceof Refusal) return { ok: false, reason: e.message, data: { refusal: e.code } };
      throw e;
    }
  }

  #rules(): TalkableRules {
    return {
      isNpcOrRpc: (p) => isNpcOrRpc(this.host, p),
      recruited: (p) => this.#recruited(p),
      isEpc: (s) => this.#isEpc(s),
    };
  }

  #resolveTarget(value: unknown): Soldier | null {
    const t = this.#t;
    if (!t) return null;
    if (isInt(value)) return t.soldiers[value] ?? null;
    if (typeof value !== 'object' || value === null) return null;
    const npc = (value as Json).npc;
    const profile = isInt(npc) ? npc : typeof npc === 'string' ? this.#profileByName(npc) : null;
    return profile === null ? null : soldierByProfile(this.host, profile);
  }

  #profileByName(name: string): number | null {
    const upper = name.toUpperCase();
    const byInternal = this.#setup.records.profileIds.get(upper);
    if (byInternal !== undefined) return byInternal;
    const p = this.#setup.profiles.find((x) => x && (x.nickname.toUpperCase() === upper || x.name.toUpperCase() === upper));
    return p ? p.id : null;
  }

  #commonRefusals(): void {
    const campaign = this.#campaign;
    if (campaign.state.flow !== 'tactical' || !campaign.tactical) refuse('notInTactical');
    if (campaign.battle?.hasPendingDecision()) refuse('promptOpen');
    if (campaign.shop?.isOpen()) refuse('shopOpen');
    if (this.talk.inPanel) refuse('sessionOpen');
    if (this.scriptedSequence()) refuse('scriptedSequence');
  }

  #hasLineOfSight(t: TacticalState, merc: Soldier, target: Soldier): boolean {
    return talkLineOfSight(t, merc, target);
  }

  #talkCommand(cmd: CampaignCommand): CommandResult {
    this.#commonRefusals();
    const tactical = this.#campaign.tactical;
    const t = this.#t as TacticalState;
    const merc = tactical?.soldier(cmd.soldier) ?? null;
    if (!merc || merc.team !== Team.OUR) return refuse('noSuchTarget');
    const turn = tactical?.canAct(merc) ?? null;
    if (turn) return { ok: false, reason: turn, data: { refusal: 'canAct' } };
    const target = this.#resolveTarget(cmd.target);
    if (!target) return refuse('noSuchTarget');
    const talkable = talkableRefusal(t, this.#rules(), merc, target, { give: false, mercs: true, collapsed: false });
    if (talkable) refuse(talkable);
    if (target !== merc && !this.#hasLineOfSight(t, merc, target)) {
      this.#emit({ type: 'npcMessage', kind: 'noLineOfSight', profile: target.profile });
      refuse('noLineOfSight');
    }
    if (target.collapsed) {
      this.#emit({ type: 'npcMessage', kind: 'targetCollapsed', profile: target.profile });
      refuse('targetCollapsed');
    }
    if (target.team === Team.OUR && !this.#isEpc(target)) return this.#ownMercBark(target);
    if (rangeBetween(merc.gridNo, target.gridNo) > NPC_TALK_RADIUS) return this.#walkUp(t, merc, target);
    if (!enoughPoints(t.inCombat, merc, AP_TALK)) refuse('notEnoughAP');
    if (getCivType(t, target) !== CivType.NA) return this.#civilianTalk(merc, target);
    return this.#runAndReply(() => this.#playerSoldierStartTalking(merc, target, false));
  }

  #civilianTalk(merc: Soldier, target: Soldier): CommandResult {
    this.#civQuote = null;
    this.#playerSoldierStartTalking(merc, target, false);
    const said = this.#civQuote as CivQuoteSaid | null;
    return { ok: true, data: { civQuote: said ? civQuoteView(said) : null } };
  }

  #walkUp(t: TacticalState, merc: Soldier, target: Soldier): CommandResult {
    const walkUp = talkWalkUp(t, merc, target);
    if (!walkUp) {
      this.#emit({ type: 'npcMessage', kind: 'noPath' });
      refuse('noPath');
    }
    if (!enoughPoints(t.inCombat, merc, AP_TALK)) refuse('notEnoughAP');
    const to = walkUp?.to ?? NOWHERE;
    selectSoldier(t, merc);
    merc.pendingTalk = target.id;
    if (!getNewSoldierPath(t, merc, to, merc.uiMovementMode, 1, merc.noAPToFinishMove)) {
      merc.pendingTalk = null;
      refuse('noPath');
    }
    return { ok: true, data: { walking: true, to } };
  }

  #ownMercBark(target: Soldier): CommandResult {
    if (target.profile === NarrativeProfile.DIMITRI) return refuse('refusesToTalk');
    const p = this.#profile(target.profile);
    const roll = this.talk.fx.int((p?.attitude ?? ATTITUDE_NORMAL) !== ATTITUDE_NORMAL ? 3 : 2);
    const playerCharacter = target.profile >= PLAYER_CHARACTER_MIN_PROFILE && target.profile <= PLAYER_CHARACTER_MAX_PROFILE;
    let quote: number = roll === 2 && !playerCharacter ? OwnMercBark.SOCIAL_TRAIT : OwnMercBark.NEGATIVE_COMPANY;
    if (target.profile === NarrativeProfile.IRA) quote = OwnMercBark.PASSING_DISLIKE;
    this.#emit({ type: 'mercQuote', soldier: target.id, profile: target.profile, quote: `quote${quote}`, id: quote });
    return { ok: true, data: { bark: quote } };
  }

  #startTalkingOnArrival(merc: Soldier, targetId: number): void {
    const t = this.#t;
    const target = t?.soldiers[targetId] ?? null;
    if (!t || !target) return;
    const started = this.#playerSoldierStartTalking(merc, target, true);
    if (started === false) this.#emit({ type: 'talkAborted', soldier: merc.id, reason: 'targetUnavailable' });
  }

  #playerSoldierStartTalking(merc: Soldier, target: Soldier, validate: boolean): boolean | 'civilian' {
    const t = this.#t;
    if (!t) return false;
    if (validate) {
      if (talkableKind(t, this.#rules(), target, { give: false, mercs: false, talkMode: false }) === null) return false;
      if (talkableRefusal(t, this.#rules(), null, target, { give: false, mercs: false, collapsed: false })) return false;
      if (rangeBetween(merc.gridNo, target.gridNo) > VALIDATED_TALK_RANGE) return false;
    }
    deductPoints(t.inCombat, merc, AP_TALK, 0);
    const facing = directionToward(merc.gridNo, target.gridNo);
    setDesiredDirection(t, merc, facing);
    setDesiredDirection(t, target, (facing + OPPOSITE) % DIRECTIONS);
    stopMerc(t, merc);
    if (getCivType(t, target) !== CivType.NA) {
      this.#civQuote = startCivQuote(this.host, target);
      return 'civilian';
    }
    if (target.profile !== NO_PROFILE && this.#campaign.battle?.roster.get(target.id)?.isEpc)
      return initiateConversationFull(this.host, target, merc, Approach.EPC_WHO_IS_RECRUITED, 0, null, 'player');
    if (!target.neutral) return initiateConversationFull(this.host, target, merc, Approach.ENEMY_NPC_QUOTE, 0, null, 'player');
    if (ASSASSIN_PROFILES.has(target.profile)) {
      deleteTalkingMenu(this.host, 'script');
      cancelAIAction(t, target);
      addToShouldBecomeHostileOrSayQuoteList(t, target);
      return true;
    }
    return initiateConversationFull(this.host, target, merc, Approach.NPC_INITIAL_QUOTE, 0, null, 'player');
  }

  #runAndReply(action: () => unknown): CommandResult {
    action();
    this.#syncScripted();
    return { ok: true, data: this.#reply() };
  }

  #reply(): Json {
    const shop = this.#campaign.shop?.isOpen() ? { shop: this.#campaign.shop.view() } : {};
    const request = this.npcActions.requestView();
    return {
      conversation: this.view(),
      ...(dialogueIdle(this.talk) ? {} : { pending: true }),
      ...(this.scriptedSequence() ? { scriptedSequence: true } : {}),
      ...shop,
      ...(request ? { npcRequest: request } : {}),
    };
  }

  #skipLine(cmd: CampaignCommand): CommandResult {
    const face = this.talk.face;
    const differs = (wanted: unknown, actual: number) => isInt(wanted) && wanted !== actual;
    if (!face || differs(cmd.profile, face.speaker) || differs(cmd.tick, face.saidAt)) return { ok: true, data: { skipped: false } };
    const skipped = cmd.talkEnded === true ? finishTalkingFace(this.host) : shutUpTalkingFace(this.host);
    return { ok: true, data: { skipped } };
  }

  get skipsSpeech(): boolean {
    return this.#skipsSpeech;
  }

  skipSpeech(skip: boolean): void {
    this.#skipsSpeech = skip;
  }

  #answerRequest(cmd: CampaignCommand): CommandResult {
    const prompt = this.#campaign.state.battle.prompt;
    if (!prompt) return { ok: false, reason: 'no prompt is open' };
    if (cmd.prompt !== undefined && cmd.prompt !== prompt.id) return { ok: false, reason: `the open prompt is ${prompt.id}` };
    const choice = String(cmd.choice ?? '');
    let answered: CommandResult = { ok: true };
    const result = this.#runAndReply(() => {
      answered = this.npcActions.answer(prompt, choice);
    });
    return answered.ok ? result : answered;
  }

  #giveRefusals(): void {
    const campaign = this.#campaign;
    if (campaign.state.flow !== 'tactical' || !campaign.tactical) refuse('notInTactical');
    if (campaign.battle?.hasPendingDecision()) refuse('promptOpen');
    if (campaign.shop?.isOpen()) refuse('shopOpen');
    if (this.scriptedSequence()) refuse('scriptedSequence');
    if (!this.talk.inPanel) return;
    if (!dialogueIdle(this.talk)) refuse('busy');
    if (this.host.isDealer(this.talk.charNum)) refuse('isADealer');
  }

  #give(cmd: CampaignCommand): CommandResult {
    this.#giveRefusals();
    const tactical = this.#campaign.tactical;
    const t = this.#t as TacticalState;
    const merc = tactical?.soldier(cmd.soldier) ?? null;
    if (!merc || merc.team !== Team.OUR) return refuse('noSuchTarget');
    const turn = tactical?.canAct(merc) ?? null;
    if (turn) return { ok: false, reason: turn, data: { refusal: 'canAct' } };
    const target = this.#resolveTarget(cmd.target);
    if (!target || target === merc) return refuse('noSuchTarget');
    const giver = giverRefusal(t, merc, this.#isEpc(merc));
    if (giver) refuse(giver);
    const request = giveRequest(t, merc, cmd);
    if (typeof request === 'string') return refuse(request);
    const talkable = talkableRefusal(t, this.#rules(), merc, target, { give: true, mercs: true, collapsed: true });
    if (talkable) refuse(talkable);
    if (isRobotSoldier(target)) refuse('robotReload');
    const ap = giveApRefusal(t, merc, target, findAdjacentGridEx(t, merc, target.gridNo, false)?.actionGridNo ?? null);
    if (ap === 'noPath') this.#emit({ type: 'npcMessage', kind: 'noPath' });
    if (ap) refuse(ap, ap === 'notEnoughAP' ? GIVE_AP_TEXT : undefined);
    const approach = findAdjacentGridEx(t, merc, target.gridNo, true);
    if (!approach) return refuse('noPath');
    if (this.talk.inPanel) talkMenuGive(this.host);
    const object = request.take();
    this.talk.lines.length = 0;
    selectSoldier(t, merc);
    soldierGiveItem(t, merc, target, object, request.slot);
    if (target.profile !== NO_PROFILE && !this.#receivesAsTeamMember(target)) setEngagedInConvFromPcAction(t, merc);
    this.#syncScripted();
    const walking = merc.pendingGive !== null && !merc.pendingGive.begun;
    return { ok: true, data: walking ? { walking: true, to: approach.actionGridNo } : { giving: true } };
  }

  #requireOpenAndIdle(): void {
    if (!this.talk.inPanel) refuse('noConversation');
    if (!dialogueIdle(this.talk)) refuse('busy');
  }

  #approach(cmd: CampaignCommand): CommandResult {
    this.#requireOpenAndIdle();
    const kind = cmd.kind;
    if (kind === 'buySell') {
      if (!this.host.isDealer(this.talk.charNum)) refuse('notADealer');
      return this.#runAndReply(() => talkMenuBuySell(this.host));
    }
    if (kind === 'give') {
      if (this.host.isDealer(this.talk.charNum)) refuse('isADealer');
      return this.#runAndReply(() => talkMenuGive(this.host));
    }
    const approach = typeof kind === 'string' ? MENU_APPROACHES[kind] : undefined;
    if (approach === undefined) return refuse('unknownApproach');
    return this.#runAndReply(() => converse(this.host, this.talk.charNum, this.host.context.srcProfile, approach));
  }

  #closeTalk(): CommandResult {
    const talk = this.talk;
    if (!talk.inPanel) refuse('noConversation');
    if (talk.queue.length > 0 || talk.waitingForTrigger || talk.pending !== null) refuse('busy');
    if (talk.face?.speaker === talk.charNum) shutUpTalkingFace(this.host);
    handleTalkingMenuEscape(this.host);
    this.#syncScripted();
    return { ok: true };
  }

  #openShop(cmd: CampaignCommand): CommandResult {
    const shop = this.#campaign.shop;
    if (!shop) return refuse('notADealer');
    if (shop.isOpen()) return { ok: false, reason: 'a shop is already open' };
    this.#commonRefusals();
    const checked = shop.checkOpen(cmd);
    if ('ok' in checked) return checked;
    const { merc, dealer } = checked;
    this.#playerSoldierStartTalking(merc, dealer, false);
    this.#campaign.state.talk.shopAfterOpening = dealer.id;
    this.#openShopAfterOpening();
    this.#syncScripted();
    return shop.isOpen() ? { ok: true, data: shop.view() } : { ok: true, data: this.#reply() };
  }

  #openShopAfterOpening(): void {
    const state = this.#campaign.state.talk;
    const dealer = state.shopAfterOpening ?? null;
    if (dealer === null || !dialogueIdle(this.talk)) return;
    state.shopAfterOpening = null;
    if (this.frozen() && this.host.context.dest === dealer) talkMenuBuySell(this.host);
  }

  #unescort(cmd: CampaignCommand): CommandResult {
    const campaign = this.#campaign;
    if (this.frozen()) refuse('conversationOpen');
    if (this.scriptedSequence()) refuse('scriptedSequence');
    if (campaign.battle?.hasPendingDecision()) refuse('promptOpen');
    if (campaign.shop?.isOpen()) refuse('shopOpen');
    if (campaign.laptop?.isOpen()) refuse('laptopOpen');
    const merc = isInt(cmd.soldier) ? campaign.battle?.roster.get(cmd.soldier) : undefined;
    if (!merc) return refuse('noSuchSoldier');
    if (!merc.isEpc) refuse('notAnEpc');
    if (campaign.state.flow === 'strategic') return this.#unescortOnMap(merc);
    if (campaign.state.flow !== 'tactical' || !this.#t) return refuse('notAvailable');
    if (!merc.soldier.placed) refuse('notInSector');
    let triggered = false;
    const result = this.#runAndReply(() => {
      triggered = this.npcActions.recruitFlow.triggerWrongSectorRecord(merc);
    });
    return { ...result, data: { ...(result.data as Json), triggered } };
  }

  #unescortOnMap(merc: RosterMerc): CommandResult {
    const recruit = this.npcActions.recruitFlow;
    const partner = recruit.partnerOf(merc);
    const before = this.talk.lines.length;
    const released = [recruit.internalUnescortEpc(merc)];
    if (partner) released.push(recruit.internalUnescortEpc(partner));
    this.#runQueueAtOnce();
    const lines = this.talk.lines.slice(before).map((l) => this.#lineView(l));
    return { ok: true, data: { released, lines } };
  }

  #runQueueAtOnce(): void {
    const talk = this.talk;
    for (let budget = QUEUE_AT_ONCE_BUDGET; budget > 0 && !dialogueQueueIsEmptyAndNobodyIsTalking(talk); budget--) {
      cutTalkingFace(talk, this.#campaign.tick);
      stepDialogue(this.host);
    }
  }

  #lineView(l: SpokenLine): ConversationLineView {
    return {
      profile: l.profile,
      quote: l.quote,
      ...(l.record !== undefined ? { record: l.record } : {}),
      textKey: l.textKey,
      chars: l.chars,
    };
  }

  quoteText(profile: number, quote: number): { readonly textKey: SpokenLine['textKey']; readonly chars: number } {
    const textKey = dialogueTextKey(this.host, profile, quote, false);
    return { textKey, chars: this.#setup.texts.chars(textKey) };
  }

  #faceVariant(profile: number): FaceVariant | null {
    return profile === NarrativeProfile.ELLIOT ? elliotFaceVariant(this.host.profile(profile)?.npcData ?? 0) : null;
  }

  #menu(): string[] {
    const npc = this.talk.charNum;
    const ctx = this.#campaign.merchants;
    const dealer = ctx && isMercADealer(ctx, npc) ? ctx.content.dealers.find((d) => d.profile === npc) : undefined;
    const trade = dealer ? `buySell:${shopKind(dealer.type)}` : 'give';
    return ['repeat', 'friendly', 'direct', 'threaten', trade, 'recruit', 'whoAreYou'];
  }

  view(): ConversationView | null {
    if (!this.talk.inPanel) return null;
    const dest = panelSoldier(this.host);
    const profile = this.talk.charNum;
    return {
      npc: dest?.id ?? null,
      profile,
      faceVariant: this.#faceVariant(profile),
      name: dest?.name ?? this.#setup.profiles[profile]?.nickname ?? String(profile),
      talker: talkerSoldier(this.host)?.id ?? null,
      initiatedBy: this.talk.initiatedBy,
      menu: this.#menu(),
      lastQuotes: this.talk.lines.map((l) => this.#lineView(l)),
      busy: !dialogueIdle(this.talk),
    };
  }

  talkableLabel(s: Soldier): TalkableKind | null {
    const t = this.#t;
    if (!t || s.team === Team.OUR) return null;
    return talkableKind(t, this.#rules(), s, { give: false, mercs: false, talkMode: true });
  }
}

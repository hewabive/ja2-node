// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-16. See LICENSE (SFI-SCLA).
// @src src/game/Strategic/PreBattle_Interface.cc AutoResolveBattleCallback, GoToSectorCallback, RetreatMercsCallback,
// @src HandlePreBattleInterfaceStates, ActivateAutomaticAutoResolveStart; Auto_Resolve.cc EnterAutoResolveMode,
// @src AutoResolveScreenHandle (entry), RenderAutoResolve (the end-of-battle block), RetreatButtonCallback,
// @src MercCellMouseClickCallback, AcceptSurrenderCallback, RejectSurrenderCallback, BandageButtonCallback,
// @src RemoveAutoResolveInterface (orchestration); MapScreen.cc HandlePostAutoresolveMessages;
// @src Strategic_Town_Loyalty.cc HandleLoyaltyImplicationsOfMercRetreat; Tactical/Overhead.cc CheckForEndOfBattle and
// @src CheckForLosingEndOfBattle (the strategic consequences), HandlePlayerTeamMemberDeath (strategic call);
// @src Strategic/StrategicMap.cc HandlePotentialBringUpAutoresolveToFinishBattle; Strategic_Movement.cc
// @src PlanSimultaneousGroupArrivalCallback; Queen_Command.cc EndCaptureSequence (ScheduleMeanwhileEvent INTERROGATION at
// @src minute 10); Tactical/Civ_Quotes.cc ShutDownQuoteBox (the surrender box), SurrenderMessageBoxCallBack.

import { type Sector, sameSector, sectorFromId, sectorShortString, strategicIndex } from '../../content/strategic/sector-ids.ts';
import { spacesAway } from '../../content/world/grid.ts';
import { u8 } from '../../core/int.ts';
import type { CommandResult } from '../command.ts';
import type { SimEvent } from '../events.ts';
import { queenProgress } from '../strategic/ai/difficulty.ts';
import { handleFirstBattleEndingWhileInTown, scheduleInterrogation } from '../strategic/ai/meanwhile.ts';
import { clearCreatureMusicAtVictory } from '../strategic/creatures/creatures.ts';
import { clearSurfaceCreatures, determineCreatureTownComposition } from '../strategic/creatures/town-attack.ts';
import { reEvaluateEveryonesNothingToDo } from '../strategic/economy/assignment-done.ts';
import { Assignment, LoyaltyEvent } from '../strategic/economy/constants.ts';
import { handleGlobalLoyaltyEvent } from '../strategic/economy/loyalty.ts';
import { countAllMilitiaInSector } from '../strategic/economy/militia-rules.ts';
import type { EconomyContext } from '../strategic/economy/ports.ts';
import { importantSectorLoss } from '../strategic/economy/sector-loss.ts';
import { answerPendingMilitiaPrompt } from '../strategic/economy/set-assignment.ts';
import type { EconomyPrompt } from '../strategic/economy/state.ts';
import { autoBandageMercs, type BandageRefusal, bandageRefusal, canBandage } from '../strategic/forces/autoresolve/bandage.ts';
import { closeAutoresolve } from '../strategic/forces/autoresolve/close.ts';
import { answerSurrender, orderRetreat } from '../strategic/forces/autoresolve/end.ts';
import { runAutoresolve } from '../strategic/forces/autoresolve/loop.ts';
import { endOfBattle } from '../strategic/forces/autoresolve/outcome.ts';
import { enterAutoresolve } from '../strategic/forces/autoresolve/setup.ts';
import {
  type ArEvent,
  type ArRng,
  type AutoresolveEnv,
  type AutoresolveState,
  BattleStatus,
  createAutoresolveState,
  robotCell,
} from '../strategic/forces/autoresolve/state.ts';
import {
  type AutoresolveSession,
  type BattlePrompt,
  PbiChoice as Choice,
  encounterName,
  nextPromptId,
  type PbiChoice,
  PromptKind,
} from '../strategic/forces/battle-state.ts';
import { EncounterCode, InsertionCode } from '../strategic/forces/constants.ts';
import { answerSimultaneousArrival } from '../strategic/forces/encounters.ts';
import { getGroup, groupAtFinalDestination } from '../strategic/forces/groups.ts';
import { answerNpcOfNotePrompt, resetMovementForEnemyGroupsInLocation } from '../strategic/forces/movement.ts';
import {
  calculateNonPersistentPbiInfo,
  clearMovementForAllInvolvedPlayerGroups,
  initPreBattleInterface,
  nonPersistentAutoresolveRefusal,
  type PreBattleOpening,
  playerMercInvolvedInThisCombat,
  putNonSquadMercsInBattleSectorOnSquads,
  retreatAllInvolvedPlayerGroups,
  wakeUpAllMercsInSectorUnderAttack,
} from '../strategic/forces/pre-battle.ts';
import { numberOfPeopleInSquad } from '../strategic/forces/squads.ts';
import { setThisSectorAsEnemyControlled, setThisSectorAsPlayerControlled } from '../strategic/map/control.ts';
import { EnemyKnowledge, whatPlayerKnowsAboutEnemiesInSector } from '../strategic/map/knowledge.ts';
import { Fact, Quest } from '../strategic/narrative/fact-ids.ts';
import { fact, QuestStatus, questStatus, setFactFalse, setFactTrue } from '../strategic/narrative/facts.ts';
import { Npc } from '../strategic/narrative/npc-ids.ts';
import type { QuestContext } from '../strategic/narrative/quests.ts';
import type { StrategicState } from '../strategic/state.ts';
import { EventKind, Warp } from '../strategic/time/constants.ts';
import { addStrategicEvent } from '../strategic/time/event-queue.ts';
import {
  CompressionStop,
  stopTimeCompression,
  unLockPauseState,
  warpGameTime,
  worldDay,
  worldTotalMinutes,
} from '../strategic/time/world-clock.ts';
import { actionDone } from '../tactical/ai/control.ts';
import { handleSoldierDeath } from '../tactical/combat/death.ts';
import type { TacticalContent } from '../tactical/content.ts';
import { healthCategory } from '../tactical/health.ts';
import { profileProgress } from '../tactical/profiles.ts';
import { removeSoldierFromTacticalSector } from '../tactical/sector-presence.ts';
import { Body, NO_PROFILE, OKLIFE, Side, type Soldier, Team } from '../tactical/soldier.ts';
import { type TacticalState, teamMembers } from '../tactical/state.ts';
import { battleFought, endBattleAfterSurrender, lastMercKillWasMonster } from '../tactical/turns/turns.ts';
import {
  type ArStrategicContext,
  associateWithStrategicGroups,
  buildAutoresolveInput,
  type CreatureComposition,
  eliminateAllEnemies,
  strategicClosePort,
} from './autoresolve-strategic.ts';
import { hourlyCamouflageUpdate } from './camouflage.ts';
import type { CampaignSim } from './campaign-sim.ts';
import {
  beginCaptureSequence,
  CaptureFlag,
  type DeathBookkeeping,
  endCaptureSequence,
  enemyCapturesPlayerSoldier,
  type FateContext,
  strategicHandlePlayerTeamMercDeath,
} from './merc-fate.ts';
import { ECONOMY_MORALE_EVENTS, handleMoraleEvent, type MoraleContext, MoraleEvent } from './morale.ts';
import { preBattlePanel } from './pre-battle-panel.ts';
import { type Roster, type RosterMerc, registeredInTactical } from './roster.ts';
import { enterMapScreen } from './screens.ts';
import { addDeadSoldierToUnloadedSector, removeRandomItemsInSector } from './sector-loot.ts';
import { decayTacticalMoraleModifiers, hourlyMoraleUpdate, type TeamMoraleContext, updateBuddyAndHatedCounters } from './team-morale.ts';

export const TICKS_PER_AUTORESOLVE_SLICE = 200;
const NPC_OF_NOTE_STOP = 'stop';
const NPC_OF_NOTE_ON_THE_WAY: readonly string[] = ['continue', NPC_OF_NOTE_STOP];
const NPC_OF_NOTE_AT_DESTINATION: readonly string[] = ['ok'];
const PACOS_FIRST_BATTLE_RECORD = 18;
const NO_TACTICAL: Pick<TacticalState, 'soldiers'> = { soldiers: [] };
const CREATURE_COMPOSITION_KEYS: Readonly<Record<number, keyof CreatureComposition>> = {
  [Body.ADULTFEMALEMONSTER]: 'adultFemales',
  [Body.AM_MONSTER]: 'adultMales',
  [Body.YAF_MONSTER]: 'youngFemales',
  [Body.YAM_MONSTER]: 'youngMales',
};
const PBI_RETREAT_WARP_SECONDS = 300;
const LOST_BATTLE_UNLOAD_DELAY_MS = 10_000;
const MAX_CAPTURED_REAL_MERCS = 4;
const MIN_CAPTURED_REAL_MERCS = 1;

const STATUS_NAMES: Readonly<Record<number, string>> = {
  [BattleStatus.IN_PROGRESS]: 'inProgress',
  [BattleStatus.VICTORY]: 'victory',
  [BattleStatus.DEFEAT]: 'defeat',
  [BattleStatus.RETREAT]: 'retreat',
  [BattleStatus.SURRENDERED]: 'surrendered',
  [BattleStatus.CAPTURED]: 'captured',
};

export function battleStatusName(status: number): string {
  return STATUS_NAMES[status] ?? 'inProgress';
}

export const ShowBattleRefusal = { NO_BATTLE: 'noBattle', ONLY_HOSTILE_CIVILIANS: 'onlyHostileCivilians' } as const;
type ShowBattleRefusal = (typeof ShowBattleRefusal)[keyof typeof ShowBattleRefusal];

const SHOW_BATTLE_REASONS: Readonly<Record<ShowBattleRefusal, string>> = {
  noBattle: 'no battle is in progress',
  onlyHostileCivilians: 'only hostile civilians are left in the sector',
};

function showBattleRefusal(refusal: ShowBattleRefusal, sector?: string): CommandResult {
  return { ok: false, reason: SHOW_BATTLE_REASONS[refusal], data: { refusal, ...(sector ? { sector } : {}) } };
}

function promptOpenRefusal(prompt: BattlePrompt): CommandResult {
  return { ok: false, reason: `answer the ${prompt.kind} prompt first`, data: { refusal: 'promptOpen' } };
}

function anyNonNeutralOfTeamInSector(t: TacticalState, team: number): boolean {
  return teamMembers(t, team).some((s) => s.placed && s.life !== 0 && !s.neutral);
}

export function onlyHostileCiviliansInSector(t: TacticalState): boolean {
  if (!anyNonNeutralOfTeamInSector(t, Team.CIV)) return false;
  return ![Team.ENEMY, Team.CREATURE, Team.MILITIA].some((team) => anyNonNeutralOfTeamInSector(t, team));
}

export interface BattleSetup {
  readonly content: TacticalContent;
  readonly roster: Roster;
}

type EventWithoutTick = SimEvent extends infer E ? (E extends SimEvent ? Omit<E, 'tick'> : never) : never;

const isMechanical = (m: RosterMerc) => m.isVehicle || m.isRobot;

export class BattleFlow implements FateContext {
  readonly campaign: CampaignSim;
  readonly content: TacticalContent;
  readonly roster: Roster;
  readonly #events: SimEvent[] = [];

  constructor(campaign: CampaignSim, setup: BattleSetup) {
    this.campaign = campaign;
    this.content = setup.content;
    this.roster = setup.roster;
  }

  get state(): StrategicState {
    return this.campaign.state;
  }

  get economy(): EconomyContext {
    const economy = this.campaign.economy;
    if (!economy) throw new Error('the battle flow needs the economy');
    return economy;
  }

  get prompt(): BattlePrompt | null {
    return this.state.battle.prompt;
  }

  get session(): AutoresolveSession | null {
    return this.state.battle.autoresolve;
  }

  get bookkeeping(): DeathBookkeeping | null {
    return this.campaign.contracts;
  }

  #arContext(): ArStrategicContext {
    return { economy: this.economy, queen: this.campaign.queen, content: this.content, roster: this.roster };
  }

  eliminateAllEnemiesIn(sector: Sector): void {
    eliminateAllEnemies(this.economy, sector, null);
  }

  #logBattleResults(victory: boolean, sector: Sector): void {
    this.campaign.laptop?.logBattleResults(victory, this.state.encounter.code, sector);
  }

  emit(event: EventWithoutTick): void {
    this.#events.push({ ...event, tick: this.campaign.tick } as SimEvent);
  }

  drainEvents(): SimEvent[] {
    return this.#events.splice(0);
  }

  questContext(): QuestContext {
    return this.campaign.narrative.questContext();
  }

  interrogationMeanwhile(): void {
    const queen = this.campaign.queen;
    if (queen) scheduleInterrogation(queen);
  }

  moraleContext(): MoraleContext {
    const queen = this.campaign.queen;
    const team = this.roster.all();
    for (const m of team)
      if (m.profile !== NO_PROFILE) profileProgress({ profiles: this.state.profiles, content: this.content }, m.profile);
    return {
      team,
      profiles: this.state.profiles,
      progress: queen ? queenProgress(queen) : this.state.status.highestProgress,
      enemyInSector: this.campaign.tactical?.state.turn.enemyInSector === true,
      status: this.state.status,
      sayQuote: (m, quote) => this.campaign.contracts?.say(m, quote),
    };
  }

  #teamMoraleContext(): TeamMoraleContext {
    const economy = this.economy;
    return {
      ...this.moraleContext(),
      groupInMotion: (id) => getGroup(economy, id)?.betweenSectors === true,
      squadSize: (squad) => numberOfPeopleInSquad(economy, squad),
      spacesAway,
      morale: this.state.teamMorale,
      emit: (e) => this.campaign.contracts?.teamMoraleEvent(e),
      stopTimeCompression: () => stopTimeCompression(this.campaign.clockContext, CompressionStop.COMPLAINT),
    };
  }

  hourlyMoraleUpdate(): void {
    hourlyMoraleUpdate(this.#teamMoraleContext());
  }

  updateBuddyAndHatedCounters(): void {
    updateBuddyAndHatedCounters(this.#teamMoraleContext());
  }

  decayTacticalMoraleModifiers(): void {
    decayTacticalMoraleModifiers(this.#teamMoraleContext());
  }

  hourlyCamouflageUpdate(): void {
    const events = this.economy.events;
    hourlyCamouflageUpdate(
      this.roster.all().map((m) => m.soldier),
      (s) => events.push({ type: 'camoWornOff', soldier: s.id }),
    );
  }

  moraleEvent(subject: RosterMerc | null, event: number, sector: Sector): void {
    handleMoraleEvent(this.moraleContext(), subject, event, sector);
  }

  economyMoraleEvent(kind: string, sector: Sector): void {
    const event = ECONOMY_MORALE_EVENTS[kind];
    if (event !== undefined) this.moraleEvent(null, event, sector);
  }

  removeRandomItemsInSector(sector: Sector, chance: number): void {
    removeRandomItemsInSector(this.state, this.campaign.tactical?.state ?? null, sector, chance, this.state.rng);
  }

  #loyalty(event: number, sector: Sector): void {
    handleGlobalLoyaltyEvent(this.economy, event, sector);
  }

  hasPendingDecision(): boolean {
    return this.state.battle.prompt !== null;
  }

  isModal(): boolean {
    return this.state.battle.prompt !== null || this.state.flow === 'autoresolve';
  }

  autoresolveIdle(): boolean {
    const ar = this.session?.ar;
    return !ar || ar.status !== BattleStatus.IN_PROGRESS || ar.pendingSurrender;
  }

  #openMilitiaPrompt(p: EconomyPrompt): void {
    if (p.kind === 'militiaPayment') this.#openPrompt(PromptKind.MILITIA_PAYMENT, { trainer: p.trainer, sectors: p.sectors, cost: p.cost });
    else this.#openPrompt(PromptKind.MILITIA_CONTINUE, { trainer: p.trainer, sector: p.sector, cost: p.cost });
  }

  #answerMilitia(choice: string): CommandResult {
    if (choice !== 'yes' && choice !== 'no') return { ok: false, reason: 'choose one of yes, no' };
    this.state.battle.prompt = null;
    const outcome = answerPendingMilitiaPrompt(this.economy, choice === 'yes');
    if (outcome === null) return { ok: true };
    this.settle();
    return { ok: true, data: { outcome } };
  }

  #openPrompt(kind: PromptKind, extra: Partial<BattlePrompt> = {}): BattlePrompt {
    const battle = this.state.battle;
    const prompt = { id: nextPromptId(battle, kind), kind, ...extra } as BattlePrompt;
    battle.prompt = prompt;
    return prompt;
  }

  settle(): void {
    for (let guard = 0; guard < 8; guard++) {
      const s = this.state;
      if (s.battle.prompt || s.flow === 'autoresolve') return;
      if (s.encounter.simultaneousArrival) {
        this.#openPrompt(PromptKind.SIMULTANEOUS_ARRIVAL);
        return;
      }
      if (s.movement.groupPrompting !== null) {
        this.#openPrompt(PromptKind.NPC_OF_NOTE);
        return;
      }
      if (s.battle.enterPreBattlePending) this.#openNonPersistent();
      else if (s.encounter.preBattle) this.#openFromHandoff();
      else {
        const militia = s.economy.prompts[0];
        if (militia) this.#openMilitiaPrompt(militia);
        return;
      }
    }
  }

  afterStep(): void {
    this.#unloadAfterLostBattle();
    this.settle();
  }

  #unloadAfterLostBattle(): void {
    const battle = this.state.battle;
    const t = this.campaign.tactical?.state;
    if (battle.lostBattleUnloadAtMs === null || !t || t.clockMs < battle.lostBattleUnloadAtMs) return;
    battle.lostBattleUnloadAtMs = null;
    this.campaign.sectors?.checkAndHandleUnloadingOfCurrentWorld();
  }

  #emitPreBattle(opening: PreBattleOpening, autoStart: boolean, prompt: string | null): void {
    const battle = this.state.battle;
    const code = battle.persistent ? this.state.encounter.code : this.state.encounter.explicitCode;
    const panel = autoStart ? preBattlePanel(this.campaign, opening.sector, this.#enemiesKnown(opening.sector)) : null;
    this.emit({
      type: 'preBattle',
      sector: sectorShortString(opening.sector),
      encounter: encounterName(code),
      persistent: battle.persistent,
      autoStart,
      prompt,
      ...(panel ? { panel } : {}),
    });
  }

  #openFromHandoff(): void {
    const s = this.state;
    const handoff = s.encounter.preBattle;
    if (!handoff) return;
    s.encounter.preBattle = null;
    s.movement.disableMapInterfaceDueToBattle = false;
    unLockPauseState(s.clock);
    if (handoff.tacticalTraversal) return;
    const group = getGroup(this.economy, handoff.battleGroupId) ?? null;
    const opening = initPreBattleInterface(this.economy, group, true);
    if (!opening) return;
    if (s.encounter.delayAutoResolveStart) {
      s.encounter.delayAutoResolveStart = false;
      this.#emitPreBattle(opening, true, null);
      this.#startAutoresolve();
      return;
    }
    const prompt = this.#openPrompt(PromptKind.PRE_BATTLE, { options: opening.options, enemiesKnown: this.#enemiesKnown(opening.sector) });
    this.#emitPreBattle(opening, false, prompt.id);
  }

  openCreatureAttack(autoStart: boolean): void {
    const s = this.state;
    s.battle.sector = sectorFromId(s.creatures.attack.sectorId, 0);
    const opening = initPreBattleInterface(this.economy, null, true);
    if (!opening) return;
    if (autoStart) {
      this.#emitPreBattle(opening, true, null);
      this.#startAutoresolve();
      return;
    }
    const prompt = this.#openPrompt(PromptKind.PRE_BATTLE, { options: opening.options, enemiesKnown: this.#enemiesKnown(opening.sector) });
    this.#emitPreBattle(opening, false, prompt.id);
  }

  #creatureComposition(transfer: boolean): CreatureComposition {
    const s = this.state;
    const attack = s.creatures.attack;
    if (!transfer) return determineCreatureTownComposition(s.rng, attack.numAttacking);
    const counts = { youngMales: 0, youngFemales: 0, adultMales: 0, adultFemales: 0 };
    const world = s.worldSector;
    if (world) clearSurfaceCreatures(this.economy, world);
    attack.numAttacking = 0;
    for (const c of teamMembers(this.campaign.tactical?.state ?? NO_TACTICAL, Team.CREATURE)) {
      if (!c.life) continue;
      const key = CREATURE_COMPOSITION_KEYS[c.bodyType];
      if (!key) continue;
      counts[key]++;
      attack.numAttacking = u8(attack.numAttacking + 1);
    }
    return counts;
  }

  #enemiesKnown(sector: Sector): boolean {
    const code = this.state.encounter.code;
    if (code === EncounterCode.CREATURE_ATTACK || code === EncounterCode.BLOODCAT_AMBUSH || code === EncounterCode.ENTERING_BLOODCAT_LAIR)
      return false;
    return whatPlayerKnowsAboutEnemiesInSector(this.economy, sector) === EnemyKnowledge.HOW_MANY;
  }

  #openNonPersistent(): void {
    const battle = this.state.battle;
    battle.enterPreBattlePending = false;
    const opening = initPreBattleInterface(this.economy, null, false);
    if (!opening || !battle.autoStart) {
      battle.autoStart = false;
      return;
    }
    battle.autoStart = false;
    this.#emitPreBattle(opening, true, null);
    this.#startAutoresolve();
  }

  requestMilitiaHandOff(world: Sector): void {
    const battle = this.state.battle;
    const enc = this.state.encounter;
    battle.autoStart = true;
    battle.enterPreBattlePending = true;
    enc.usePersistentPBI = false;
    battle.sector = { ...world };
    battle.locator = true;
    battle.transferTacticalOpposition = true;
    if (enc.code !== EncounterCode.CREATURE_ATTACK) enc.code = EncounterCode.ENEMY_INVASION;
  }

  #arEnv(session: Pick<AutoresolveSession, 'sector' | 'rng'>): AutoresolveEnv {
    const s = this.state;
    return {
      content: this.content,
      profiles: s.profiles,
      rng: session.rng ?? { pre: s.pre, main: s.rng, fx: s.cosmetic.autoresolve },
      world: { day: worldDay(s.clock), playerCapturedForRescue: (s.status.flags & CaptureFlag.FOR_RESCUE) !== 0 },
      hooks: {
        surrender: () => null,
        beginCaptureSequence: () => beginCaptureSequence(this),
        killedEnemy: (merc) => {
          const m = this.roster.get(merc.id);
          if (m && m.soldier === merc) this.moraleEvent(m, MoraleEvent.KILLED_ENEMY, session.sector);
        },
        battleRetreat: () => this.retreatFromAutoresolve(session.sector),
      },
      experienceHooks: this.campaign.experienceHooks,
    };
  }

  retreatFromAutoresolve(sector: Sector): void {
    wakeUpAllMercsInSectorUnderAttack(this.economy, sector);
    const groups = retreatAllInvolvedPlayerGroups(this.economy, sector);
    this.emit({ type: 'retreated', sector: sectorShortString(sector), groups, via: 'autoresolve' });
  }

  #installSession(ar: AutoresolveState, sector: Sector, rng: ArRng | null): AutoresolveSession {
    const s = this.state;
    const battle = s.battle;
    const world = s.worldSector;
    const loadedHere = world !== null && sameSector(world, sector) && this.campaign.tactical !== null;
    if (loadedHere && sector.z === 0) this.campaign.sectors?.unloadForAutoresolve();
    else battle.locator = false;
    const session: AutoresolveSession = {
      ar,
      sector: { ...sector },
      rng,
      ticks: 0,
      ended: false,
    };
    battle.autoresolve = session;
    s.flow = 'autoresolve';
    this.emit({
      type: 'arStarted',
      sector: sectorShortString(sector),
      mercs: ar.mercs.length,
      militia: ar.militia.length,
      enemies: ar.enemies.length,
    });
    return session;
  }

  #startAutoresolve(): void {
    const s = this.state;
    const battle = s.battle;
    const sector = battle.sector;
    if (!sector) throw new Error('no battle sector for autoresolve');
    battle.prompt = null;
    const transfer = battle.transferTacticalOpposition;
    const creatures = s.encounter.code === EncounterCode.CREATURE_ATTACK ? this.#creatureComposition(transfer) : undefined;
    battle.transferTacticalOpposition = false;
    const world = s.worldSector;
    const loadedHere = world !== null && sameSector(world, sector) && this.campaign.tactical !== null;
    const ctx = this.#arContext();
    const input = buildAutoresolveInput(ctx, {
      sector,
      encounter: s.encounter.code,
      persistent: battle.persistent,
      tactical: loadedHere ? (this.campaign.tactical?.state ?? null) : null,
      ...(creatures ? { creatures } : {}),
    });
    const ar = createAutoresolveState(input);
    associateWithStrategicGroups(ctx, ar, sector);
    const session = this.#installSession(ar, sector, null);
    enterAutoresolve(this.#arEnv(session), ar);
  }

  adoptAutoresolve(ar: AutoresolveState, sector: Sector, rng: ArRng | null): void {
    this.state.battle.prompt = null;
    this.state.battle.sector = { ...sector };
    this.#installSession(ar, sector, rng);
  }

  useAutoresolveRng(rng: ArRng | null): void {
    const session = this.session;
    if (session) session.rng = rng;
  }

  settleAutoresolve(): void {
    const session = this.session;
    if (session) this.#afterSlice(session);
  }

  stepAutoresolve(): void {
    const session = this.session;
    if (!session || this.state.battle.prompt) return;
    session.ticks++;
    if (session.ticks % TICKS_PER_AUTORESOLVE_SLICE !== 0) return;
    runAutoresolve(this.#arEnv(session), session.ar, { maxSlices: 1 });
    this.#afterSlice(session);
  }

  #afterSlice(session: AutoresolveSession): void {
    this.#drainArEvents(session);
    const ar = session.ar;
    if (ar.pendingSurrender && !this.state.battle.prompt) {
      this.#openPrompt(PromptKind.SURRENDER);
      this.emit({ type: 'arSurrenderOffered', battleMs: ar.elapsedMs });
      return;
    }
    if (ar.status !== BattleStatus.IN_PROGRESS && !session.ended) this.#endBattle(session);
  }

  #drainArEvents(session: AutoresolveSession): void {
    const ar = session.ar;
    for (const e of ar.events.splice(0)) this.emit(this.#projectArEvent(ar, e));
    for (const e of ar.statEvents.splice(0)) this.emit({ type: 'statChanged', soldier: e.soldier, stat: e.stat, change: e.change });
  }

  #projectArEvent(ar: AutoresolveState, e: ArEvent): EventWithoutTick {
    switch (e.type) {
      case 'arHit': {
        const cell = (e.target.side === 'merc' ? ar.mercs : e.target.side === 'militia' ? ar.militia : ar.enemies)[e.target.index];
        const melee = e.melee ? { melee: true as const } : {};
        if (e.target.side === 'merc')
          return { type: 'arHit', battleMs: e.battleMs, target: e.target, damage: e.damage, life: e.life, ...melee };
        return {
          type: 'arHit',
          battleMs: e.battleMs,
          target: e.target,
          health: healthCategory(e.life, cell?.soldier.lifeMax ?? e.life),
          ...melee,
        };
      }
      case 'arBattleOver':
        return { type: 'arBattleOver', battleMs: e.battleMs, status: battleStatusName(e.status) };
      default:
        return e;
    }
  }

  #firstBattleEnded(sector: Sector, won: boolean, fromAutoresolve: boolean): void {
    const n = this.state.narrative;
    setFactTrue(n, Fact.FIRST_BATTLE_FOUGHT);
    if (won) setFactTrue(n, Fact.FIRST_BATTLE_WON);
    if (!fromAutoresolve) setFactFalse(n, Fact.FIRST_BATTLE_BEING_FOUGHT);
    if (this.state.economy.firstBattleSector === 0) this.state.economy.firstBattleSector = strategicIndex(sector);
    const queen = this.campaign.queen;
    if (queen) handleFirstBattleEndingWhileInTown(queen, sector, fromAutoresolve);
  }

  #retreatImplications(sector: Sector): void {
    if (countAllMilitiaInSector(this.economy, sector)) this.#loyalty(LoyaltyEvent.ABANDON_MILITIA, sector);
    this.moraleEvent(null, MoraleEvent.RAN_AWAY, sector);
  }

  #controller(sector: Sector): 'player' | 'enemy' {
    return this.state.map.elements[strategicIndex(sector)]?.enemyControlled ? 'enemy' : 'player';
  }

  #emitControlChange(sector: Sector, before: 'player' | 'enemy'): 'player' | 'enemy' | null {
    const after = this.#controller(sector);
    if (after === before) return null;
    const loss = after === 'enemy' ? importantSectorLoss(this.economy, sector) : null;
    this.emit({ type: 'sectorControlChanged', sector: sectorShortString(sector), controller: after, ...(loss ?? {}) });
    return after;
  }

  #captureMorale(sector: Sector): void {
    for (const m of this.roster.all()) {
      if (m.life === 0 || isMechanical(m) || !playerMercInvolvedInThisCombat(this.economy, m, sector)) continue;
      this.moraleEvent(m, MoraleEvent.MERC_CAPTURED, sector);
    }
  }

  #endBattle(session: AutoresolveSession): void {
    session.ended = true;
    const ar = session.ar;
    const s = { x: session.sector.x, y: session.sector.y, z: 0 };
    const battle = this.state.battle;
    const creatures = this.state.encounter.code === EncounterCode.CREATURE_ATTACK;
    endOfBattle(ar);
    if (!fact(this.state.narrative, Fact.FIRST_BATTLE_FOUGHT)) this.#firstBattleEnded(s, ar.status === BattleStatus.VICTORY, true);
    const controlBefore = this.#controller(s);
    switch (ar.status) {
      case BattleStatus.VICTORY:
        this.moraleEvent(null, MoraleEvent.BATTLE_WON, s);
        this.#loyalty(LoyaltyEvent.BATTLE_WON, s);
        setThisSectorAsPlayerControlled(this.economy, s, true);
        clearCreatureMusicAtVictory(this.state);
        this.#logBattleResults(true, s);
        this.emit({ type: 'battleResult', sector: sectorShortString(s), result: 'victory', via: 'autoresolve' });
        break;
      case BattleStatus.SURRENDERED:
      case BattleStatus.CAPTURED:
        this.#captureMorale(s);
        this.moraleEvent(null, MoraleEvent.HEARD_BATTLE_LOST, s);
        this.#loyalty(LoyaltyEvent.BATTLE_LOST, s);
        battle.enemyGainedControlOf = s;
        break;
      case BattleStatus.DEFEAT:
        this.moraleEvent(null, MoraleEvent.HEARD_BATTLE_LOST, s);
        this.#loyalty(LoyaltyEvent.BATTLE_LOST, s);
        battle.enemyGainedControlOf = s;
        if (creatures) battle.civiliansEaten = ar.aliveEnemies;
        this.#logBattleResults(false, s);
        this.emit({ type: 'battleResult', sector: sectorShortString(s), result: 'defeat', via: 'autoresolve' });
        break;
      case BattleStatus.RETREAT:
        this.#retreatImplications(s);
        if (!creatures) battle.enemyGainedControlOf = s;
        else if (ar.aliveEnemies) {
          battle.enemyGainedControlOf = s;
          battle.civiliansEaten = ar.aliveEnemies;
        }
        break;
    }
    this.#emitControlChange(s, controlBefore);
    this.#openPrompt(PromptKind.AUTORESOLVE_DONE);
  }

  canBandage(): boolean {
    const session = this.session;
    return session !== null && canBandage(this.#arEnv(session), session.ar);
  }

  bandageRefusal(): BandageRefusal | null {
    const session = this.session;
    return session === null ? null : bandageRefusal(this.#arEnv(session), session.ar);
  }

  #bandage(session: AutoresolveSession): boolean {
    const result = autoBandageMercs(this.#arEnv(session), session.ar);
    this.#drainArEvents(session);
    this.#openPrompt(PromptKind.AUTORESOLVE_DONE);
    return result.complete;
  }

  #closeAutoresolve(session: AutoresolveSession): void {
    const s = this.state;
    const battle = s.battle;
    const ar = session.ar;
    const sector = session.sector;
    battle.prompt = null;
    const captured: number[] = [];
    const env = this.#arEnv(session);
    const port = strategicClosePort(this.#arContext(), ar, sector, {
      mercDied: (soldier) => {
        const m = this.roster.get(soldier.id);
        if (m) strategicHandlePlayerTeamMercDeath(this, m);
      },
      mercCaptured: (soldier) => {
        const m = this.roster.get(soldier.id);
        if (m && enemyCapturesPlayerSoldier(this, m, env.rng.main)) {
          captured.push(m.id);
          this.emit({ type: 'mercCaptured', soldier: m.id, sector: sectorShortString(m.sector) });
        }
      },
      endCaptureSequence: () => endCaptureSequence(this),
    });
    const wounded = ar.mercs.filter((c) => c.soldier.life !== 0 && c.soldier.life < c.soldier.lifeMax).map((c) => c.soldier.id);
    const controlBefore = this.#controller(sector);
    const result = closeAutoresolve(env, ar, port);
    const robot = robotCell(ar);
    if (robot) this.roster.updateRobotControllerGivenRobot(robot.soldier.id);
    if (result.bandageEvent) addStrategicEvent(s.queue, EventKind.BANDAGE_BLEEDING_MERCS, worldTotalMinutes(s.clock) + 1, 0);
    for (const soldier of result.mercsAtCenter) {
      const m = this.roster.get(soldier.id);
      if (m) m.insertionCode = InsertionCode.CENTER;
    }
    for (const record of result.corpses) addDeadSoldierToUnloadedSector(s, this.content, sector, record);
    reEvaluateEveryonesNothingToDo(this.economy);
    warpGameTime(this.campaign.clockContext, result.warpSeconds, Warp.NO_PROCESSING);
    battle.autoresolve = null;
    s.encounter.battleGroup = null;
    if (s.encounter.code === EncounterCode.CREATURE_ATTACK) {
      s.creatures.attack.numAttacking = 0;
      s.creatures.attack.sectorId = 0;
    }
    this.#returnToMapOrTactical();
    this.#handlePostAutoresolveMessages();
    const control = this.#emitControlChange(sector, controlBefore);
    this.emit({
      type: 'arSummary',
      sector: sectorShortString(sector),
      status: battleStatusName(result.status),
      battleSeconds: Math.trunc(ar.elapsedMs / 1000),
      worldSecondsWarped: result.warpSeconds,
      mercs: { died: result.mercsDied.map((x) => x.id), captured, wounded },
      militia: { died: result.militiaDied.length, promoted: result.promotions.total },
      enemiesKilled: result.enemiesKilled.length,
      sectorControl: control,
      itemsDropped: result.corpses.reduce((n, c) => n + c.items.length, 0),
    });
  }

  #returnToMapOrTactical(): void {
    enterMapScreen(this.campaign);
  }

  #handlePostAutoresolveMessages(): void {
    const battle = this.state.battle;
    if (battle.civiliansEaten > 0) {
      const eaten = battle.civiliansEaten;
      const where = battle.enemyGainedControlOf;
      battle.civiliansEaten = 0;
      battle.enemyGainedControlOf = null;
      if (where) this.campaign.creatures?.creaturesEatCivilians(where, eaten);
      return;
    }
    const sector = battle.enemyGainedControlOf;
    if (!sector) return;
    battle.enemyGainedControlOf = null;
    setThisSectorAsEnemyControlled(this.economy, sector);
  }

  #answerPreBattle(choice: PbiChoice): CommandResult {
    switch (choice) {
      case Choice.AUTORESOLVE:
        this.#startAutoresolve();
        return { ok: true };
      case Choice.ENTER_SECTOR:
        return this.#enterSector();
      case Choice.RETREAT:
        this.#retreat();
        return { ok: true };
      case Choice.CLOSE:
        return this.#closeSummary();
      default:
        return { ok: false, reason: 'that choice is not offered' };
    }
  }

  #closeSummary(): CommandResult {
    const battle = this.state.battle;
    if (battle.persistent) return { ok: false, reason: 'only the battle summary closes without a choice' };
    battle.prompt = null;
    this.state.encounter.battleGroup = null;
    return { ok: true };
  }

  #enterSector(): CommandResult {
    const s = this.state;
    const battle = s.battle;
    const flow = this.campaign.sectors;
    const sector = battle.sector;
    if (!flow || !sector) return { ok: false, reason: 'no sector flow' };
    const target = { x: sector.x, y: sector.y, z: 0 };
    if (!flow.setup.worlds.world(flow.mapPathOf(target))) return { ok: false, reason: 'sector map is not loaded' };
    const enc = s.encounter;
    const group = getGroup(this.economy, enc.battleGroup ?? -1);
    const placement =
      battle.persistent &&
      group?.player === true &&
      enc.code !== EncounterCode.ENEMY_AMBUSH &&
      enc.code !== EncounterCode.CREATURE_ATTACK &&
      enc.code !== EncounterCode.BLOODCAT_AMBUSH;
    if (battle.persistent) {
      putNonSquadMercsInBattleSectorOnSquads(this.economy, true, sector);
      clearMovementForAllInvolvedPlayerGroups(this.economy, sector);
    } else enc.battleGroup = null;
    battle.prompt = null;
    if (!flow.setCurrentWorldSector(target, { autoPlacement: placement, battleLocatorShown: battle.locator }))
      return { ok: false, reason: 'sector map is not loaded' };
    return { ok: true, data: { sector: sectorShortString(target) } };
  }

  #retreat(): void {
    const s = this.state;
    const battle = s.battle;
    const sector = battle.sector;
    if (!sector) return;
    const groups = retreatAllInvolvedPlayerGroups(this.economy, sector);
    this.#retreatImplications(sector);
    this.emit({ type: 'retreated', sector: sectorShortString(sector), groups, via: 'preBattle' });
    if (countAllMilitiaInSector(this.economy, sector)) {
      this.#startAutoresolve();
      return;
    }
    warpGameTime(this.campaign.clockContext, PBI_RETREAT_WARP_SECONDS, Warp.NO_PROCESSING);
    resetMovementForEnemyGroupsInLocation(this.economy, sector);
    battle.prompt = null;
    stopTimeCompression(this.campaign.clockContext, CompressionStop.BATTLE);
    s.encounter.battleGroup = null;
    battle.locator = false;
    const world = s.worldSector;
    if (world && sameSector(world, sector) && s.flow === 'tactical') this.campaign.sectors?.checkAndHandleUnloadingOfCurrentWorld();
    this.#returnToMapOrTactical();
  }

  #answer(cmd: { readonly [key: string]: unknown }): CommandResult {
    const prompt = this.state.battle.prompt;
    if (!prompt) return { ok: false, reason: 'no prompt is open' };
    if (cmd.prompt !== undefined && cmd.prompt !== prompt.id) return { ok: false, reason: `the open prompt is ${prompt.id}` };
    const choice = String(cmd.choice ?? '');
    switch (prompt.kind) {
      case PromptKind.PRE_BATTLE: {
        const option = prompt.options.find((o) => o.choice === choice);
        if (!option) return { ok: false, reason: `choose one of ${prompt.options.map((o) => o.choice).join(', ')}` };
        if (!option.enabled) return { ok: false, reason: option.reason ?? 'that choice is disabled' };
        return this.#answerPreBattle(option.choice);
      }
      case PromptKind.SURRENDER:
        return this.#answerSurrender(choice);
      case PromptKind.AUTORESOLVE_DONE:
        return this.#answerDone(choice);
      case PromptKind.SIMULTANEOUS_ARRIVAL:
        return this.#answerSimultaneous(choice);
      case PromptKind.NPC_OF_NOTE:
        return this.#answerNpcOfNote(choice);
      case PromptKind.CONTRACT_RENEWAL:
      case PromptKind.MERC_DEPARTURE:
      case PromptKind.INSURANCE_EXTENSION:
        return this.campaign.contracts?.answer(prompt, choice) ?? { ok: false, reason: 'contracts are not available' };
      case PromptKind.NPC_REQUEST:
        return this.campaign.talk?.npcActions.answer(prompt, choice) ?? { ok: false, reason: 'conversations are not available' };
      case PromptKind.MILITIA_PAYMENT:
      case PromptKind.MILITIA_CONTINUE:
        return this.#answerMilitia(choice);
    }
  }

  offerTacticalSurrender(soldier: number): boolean {
    if (this.state.battle.prompt) return false;
    const prompt = this.#openPrompt(PromptKind.SURRENDER, { context: 'tactical', soldier });
    this.emit({ type: 'surrenderOffered', soldier, prompt: prompt.id });
    return true;
  }

  #captureSurrenderedMercs(t: TacticalState): void {
    const ours = this.roster
      .all()
      .filter((m) => registeredInTactical(t, m) && m.soldier.placed && m.soldier.life !== 0)
      .sort((a, b) => a.id - b.id);
    beginCaptureSequence(this);
    for (const m of ours) {
      if (enemyCapturesPlayerSoldier(this, m, this.state.rng))
        this.emit({ type: 'mercCaptured', soldier: m.id, sector: sectorShortString(m.sector) });
      removeSoldierFromTacticalSector(t, m.soldier);
    }
    endCaptureSequence(this);
    endBattleAfterSurrender(t);
  }

  #answerTacticalSurrender(soldier: number | undefined, choice: string): CommandResult {
    if (choice !== 'accept' && choice !== 'reject') return { ok: false, reason: "choose 'accept' or 'reject'" };
    this.state.battle.prompt = null;
    const t = this.campaign.tactical?.state;
    if (!t) return { ok: true };
    if (choice === 'accept') this.#captureSurrenderedMercs(t);
    const offering = soldier === undefined ? null : (t.soldiers[soldier] ?? null);
    if (offering) actionDone(t, offering);
    return { ok: true, data: { surrendered: choice === 'accept' } };
  }

  #answerSurrender(choice: string): CommandResult {
    const prompt = this.state.battle.prompt;
    if (prompt?.kind === PromptKind.SURRENDER && prompt.context === 'tactical')
      return this.#answerTacticalSurrender(prompt.soldier, choice);
    const session = this.session;
    if (!session || (choice !== 'accept' && choice !== 'reject')) return { ok: false, reason: "choose 'accept' or 'reject'" };
    this.state.battle.prompt = null;
    answerSurrender(this.#arEnv(session), session.ar, choice === 'accept');
    this.#afterSlice(session);
    return { ok: true };
  }

  #answerDone(choice: string): CommandResult {
    const session = this.session;
    if (!session) return { ok: false, reason: 'no autoresolve is open' };
    if (choice === 'bandage') {
      if (!this.canBandage()) return { ok: false, reason: 'nobody can bandage', data: { refusal: this.bandageRefusal() ?? 'noDoctor' } };
      return { ok: true, data: { bandaged: this.#bandage(session) ? 'complete' : 'incomplete' } };
    }
    if (choice !== 'done') return { ok: false, reason: "choose 'done' or 'bandage'" };
    this.#closeAutoresolve(session);
    this.settle();
    return { ok: true };
  }

  #answerSimultaneous(choice: string): CommandResult {
    if (choice !== 'coordinate' && choice !== 'separately') return { ok: false, reason: "choose 'coordinate' or 'separately'" };
    this.state.battle.prompt = null;
    answerSimultaneousArrival(this.economy, choice === 'coordinate');
    this.settle();
    return { ok: true };
  }

  npcOfNoteChoices(): readonly string[] {
    const g = getGroup(this.economy, this.state.movement.groupPrompting ?? -1);
    return g && groupAtFinalDestination(g) ? NPC_OF_NOTE_AT_DESTINATION : NPC_OF_NOTE_ON_THE_WAY;
  }

  #answerNpcOfNote(choice: string): CommandResult {
    const choices = this.npcOfNoteChoices();
    if (!choices.includes(choice)) return { ok: false, reason: `choose ${choices.map((c) => `'${c}'`).join(' or ')}` };
    this.state.battle.prompt = null;
    answerNpcOfNotePrompt(this.economy, choice !== NPC_OF_NOTE_STOP);
    this.settle();
    return { ok: true };
  }

  #autoresolveRetreat(cmd: { readonly [key: string]: unknown }): CommandResult {
    const session = this.session;
    if (!session || this.state.flow !== 'autoresolve') return { ok: false, reason: 'no autoresolve battle is running' };
    if (this.state.battle.prompt) return promptOpenRefusal(this.state.battle.prompt);
    const ar = session.ar;
    if (ar.status !== BattleStatus.IN_PROGRESS) return { ok: false, reason: 'the battle is over' };
    let index: number | null = null;
    if (cmd.soldier !== undefined) {
      index = ar.mercs.findIndex((c) => c.soldier.id === cmd.soldier);
      if (index < 0) return { ok: false, reason: 'that soldier is not in this battle' };
      if (index === ar.robot) return { ok: false, reason: 'the robot retreats with its controller' };
    } else if (ar.mercs.length === 0) return { ok: false, reason: 'no merc of yours is in this battle' };
    if (!orderRetreat(ar, index)) return { ok: false, reason: 'already retreating' };
    return { ok: true };
  }

  #autoresolveBattle(): CommandResult {
    const s = this.state;
    const world = s.worldSector;
    const t = this.campaign.tactical?.state;
    if (s.flow !== 'tactical' || !t || !world) return { ok: false, reason: 'no tactical battle is loaded' };
    if (!t.turn.enemyInSector && !t.inCombat) return { ok: false, reason: 'no battle is in progress' };
    calculateNonPersistentPbiInfo(this.economy);
    const battle = s.battle;
    if (!battle.locator || !battle.sector || !sameSector(battle.sector, world)) return { ok: false, reason: 'no battle is in progress' };
    const opening = initPreBattleInterface(this.economy, null, false);
    if (!opening) return { ok: false, reason: 'no battle is in progress' };
    const refusal = nonPersistentAutoresolveRefusal(s.encounter.explicitCode);
    if (refusal) return { ok: false, reason: refusal };
    s.encounter.battleGroup = null;
    this.#emitPreBattle(opening, false, null);
    this.#startAutoresolve();
    return { ok: true };
  }

  #showBattle(): CommandResult {
    const s = this.state;
    const world = s.worldSector;
    const t = this.campaign.tactical?.state;
    if (s.battle.prompt) return promptOpenRefusal(s.battle.prompt);
    if (s.flow !== 'strategic' || !t || !world) return showBattleRefusal(ShowBattleRefusal.NO_BATTLE);
    const inBattle = t.inCombat || t.turn.enemyInSector;
    if (!s.battle.locator && !inBattle) return showBattleRefusal(ShowBattleRefusal.NO_BATTLE);
    if (inBattle && onlyHostileCiviliansInSector(t))
      return showBattleRefusal(ShowBattleRefusal.ONLY_HOSTILE_CIVILIANS, sectorShortString(world));
    calculateNonPersistentPbiInfo(this.economy);
    const opening = initPreBattleInterface(this.economy, null, false);
    if (!opening) return showBattleRefusal(ShowBattleRefusal.NO_BATTLE);
    const prompt = this.#openPrompt(PromptKind.PRE_BATTLE, { options: opening.options, enemiesKnown: this.#enemiesKnown(opening.sector) });
    this.#emitPreBattle(opening, false, prompt.id);
    return { ok: true, data: { prompt: prompt.id } };
  }

  dispatch(cmd: { readonly type: string; readonly [key: string]: unknown }): CommandResult | null {
    switch (cmd.type) {
      case 'answer':
        return this.#answer(cmd);
      case 'autoresolveRetreat':
        return this.#autoresolveRetreat(cmd);
      case 'autoresolveBattle':
        return this.#autoresolveBattle();
      case 'showBattle':
        return this.#showBattle();
      default:
        if (this.state.battle.prompt) return promptOpenRefusal(this.state.battle.prompt);
        if (this.state.flow === 'autoresolve') return { ok: false, reason: 'an autoresolve battle is running' };
        return null;
    }
  }

  mercDiedInTactical(soldier: Soldier): void {
    const m = this.roster.get(soldier.id);
    if (!m || m.soldier !== soldier || m.assignment === Assignment.ASSIGNMENT_DEAD) return;
    strategicHandlePlayerTeamMercDeath(this, m);
  }

  pendingEnemies(): boolean {
    return (this.state.worldSector?.z ?? 0) === 0 && this.state.encounter.pendingEnemies;
  }

  militiaFinishBattle(t: TacticalState): boolean {
    const world = this.state.worldSector;
    if (!world) return false;
    const enemies = t.soldiers.some((x) => x?.placed && x.life !== 0 && (x.team === Team.ENEMY || x.team === Team.CREATURE));
    const militia = teamMembers(t, Team.MILITIA).some((x) => x.life !== 0 && x.side === Side.FRIENDLY);
    if (!enemies || !militia) return false;
    this.requestMilitiaHandOff(world);
    return true;
  }

  #captureAllowed(t: TacticalState, ours: readonly RosterMerc[]): boolean {
    const notOkReal = ours.filter((m) => m.life !== 0 && m.life < OKLIFE && !m.isEpc && !m.isRobot).length;
    if (notOkReal >= MAX_CAPTURED_REAL_MERCS || notOkReal <= MIN_CAPTURED_REAL_MERCS) return false;
    if (teamMembers(t, Team.ENEMY).length === 0) return false;
    const n = this.state.narrative;
    const alma = questStatus(n, Quest.HELD_IN_ALMA);
    return (
      alma === QuestStatus.NOT_STARTED || (alma === QuestStatus.DONE && questStatus(n, Quest.INTERROGATION) === QuestStatus.NOT_STARTED)
    );
  }

  battleLost(t: TacticalState): void {
    const ours = this.roster.all().filter((m) => registeredInTactical(t, m) && m.soldier.placed);
    const capture = this.#captureAllowed(t, ours);
    if (capture) beginCaptureSequence(this);
    for (const m of ours) {
      const s = m.soldier;
      if (((s.life !== 0 && s.life < OKLIFE) || m.isEpc || m.isRobot) && !capture) {
        s.life = 0;
        handleSoldierDeath(t, s);
      }
      if (s.life !== 0 && capture && enemyCapturesPlayerSoldier(this, m, this.state.rng)) {
        removeSoldierFromTacticalSector(t, s);
        this.emit({ type: 'mercCaptured', soldier: m.id, sector: sectorShortString(m.sector) });
      }
    }
    if (capture) endCaptureSequence(this);
  }

  tacticalBattleEnded(t: TacticalState, won: boolean): void {
    const world = this.state.worldSector;
    if (!world) return;
    const battle = this.state.battle;
    const controlBefore = this.#controller(world);
    if (won) battle.lastBattleWon = true;
    if (won) this.#tacticalVictory(t, world);
    else this.#tacticalDefeat(t, world);
    battle.locator = false;
    if (world.z === 0) this.#emitControlChange(world, controlBefore);
  }

  #tacticalVictory(t: TacticalState, world: Sector): void {
    if (battleFought(t)) {
      this.moraleEvent(null, MoraleEvent.BATTLE_WON, world);
      this.#loyalty(LoyaltyEvent.BATTLE_WON, world);
      if (!lastMercKillWasMonster(t)) clearCreatureMusicAtVictory(this.state);
    }
    this.#logBattleResults(true, world);
    this.emit({ type: 'battleResult', sector: sectorShortString(world), result: 'victory', via: 'tactical' });
    setThisSectorAsPlayerControlled(this.economy, world, true);
    if (fact(this.state.narrative, Fact.FIRST_BATTLE_BEING_FOUGHT)) {
      t.narrative.triggerNpcRecord(Npc.PACOS, PACOS_FIRST_BATTLE_RECORD);
      this.#firstBattleEnded(world, true, false);
    }
  }

  #tacticalDefeat(t: TacticalState, world: Sector): void {
    this.moraleEvent(null, MoraleEvent.HEARD_BATTLE_LOST, world);
    this.#loyalty(LoyaltyEvent.BATTLE_LOST, world);
    this.state.battle.lostBattleUnloadAtMs = t.clockMs + LOST_BATTLE_UNLOAD_DELAY_MS;
    if (fact(this.state.narrative, Fact.FIRST_BATTLE_BEING_FOUGHT)) this.#firstBattleEnded(world, false, false);
    const enemiesLeft = t.soldiers.some(
      (s) => s?.placed && s.life > 0 && !s.neutral && s.side !== Side.FRIENDLY && s.team !== Team.CREATURE,
    );
    if (enemiesLeft) setThisSectorAsEnemyControlled(this.economy, world);
    this.#logBattleResults(false, world);
    this.emit({ type: 'battleResult', sector: sectorShortString(world), result: 'defeat', via: 'tactical' });
  }
}

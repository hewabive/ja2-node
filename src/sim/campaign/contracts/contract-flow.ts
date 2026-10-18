// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-16. See LICENSE (SFI-SCLA).
// @src src/game/Strategic/Game_Event_Hook.cc ExecuteStrategicEvent (the contract events); Strategic/Merc_Contract.cc
// @src HandleContractRenewalSequence, MakeCharacterDialogueEventContractEnding, MercDepartEquipmentBoxCallBack,
// @src HandleExtendMercsContract, ExtendMercInsuranceContractCallBack; Strategic/Assignments.cc ContractMenuBtnCallbackPrimary,
// @src MercDismissConfirmCallBack, RemoveMercMenuBtnCallback; Tactical/Dialogue_Control.cc CanSayQuote; Tactical/Campaign.cc
// @src ChangeStat (salary and the M.E.R.C. level-up email event); Strategic/Strategic_Merc_Handler.cc
// @src StrategicHandlePlayerTeamMercDeath (history, insurance, M.E.R.C. contract end); Strategic/Strategic.cc
// @src HandleSoldierDeadComments; Tactical/Overhead.cc HandlePlayerTeamMemberDeath (buddy quotes). See docs/22 §3, §4, §9.

import { sectorFromId, sectorShortString } from '../../../content/strategic/sector-ids.ts';
import { u32 } from '../../../core/int.ts';
import type { CommandResult } from '../../command.ts';
import type { SimEvent } from '../../events.ts';
import { Assignment } from '../../strategic/economy/constants.ts';
import type { EconomyContext } from '../../strategic/economy/ports.ts';
import { type BattlePrompt, nextPromptId, PromptKind } from '../../strategic/forces/battle-state.ts';
import { removeCharacterFromSquads } from '../../strategic/forces/squads.ts';
import type { StrategicState } from '../../strategic/state.ts';
import { EventKind } from '../../strategic/time/constants.ts';
import type { EventDispatch } from '../../strategic/time/dispatch.ts';
import { addStrategicEvent } from '../../strategic/time/event-queue.ts';
import {
  type ClockContext,
  interruptTime,
  lockPauseState,
  pauseGame,
  unLockPauseState,
  unPauseGame,
  worldTotalMinutes,
} from '../../strategic/time/world-clock.ts';
import type { ExperienceHooks } from '../../tactical/combat/context.ts';
import type { TacticalContent } from '../../tactical/content.ts';
import type { ProfileProgress } from '../../tactical/profiles.ts';
import { Body, NO_PROFILE, OKLIFE, type Soldier } from '../../tactical/soldier.ts';
import type { CampaignSim } from '../campaign-sim.ts';
import type { MoraleContext } from '../morale.ts';
import { campaignProfile, loadMercProfiles } from '../profiles.ts';
import { BuddySlot, whichBuddy } from '../relations/relations.ts';
import { MercKind, type Roster, type RosterMerc } from '../roster.ts';
import { enterMapScreen } from '../screens.ts';
import type { TeamMoraleEvent } from '../team-morale.ts';
import {
  type ContractContext,
  type ContractEventWithoutTick,
  type ContractHooks,
  type ContractRandom,
  NO_CONTRACT_HOOKS,
} from './context.ts';
import type { ContractState, PendingEnding } from './contract-state.ts';
import { mercComplainAboutEquipment, mercDailyUpdate } from './daily.ts';
import {
  beginRemoveMercFromContract,
  canBeRemovedFromContract,
  type DepartureChoice,
  departureOptions,
  handleEquipmentLeft,
  handleLeavingOfEquipmentInCurrentSector,
  handleMercLeavingEquipment,
  PRIMARY_AIRPORT_LEAVE_EQUIP_GRIDNO,
  primaryAirportSector,
  primaryAirportUnderPlayerControl,
  START_SECTOR_LEAVE_EQUIP_GRIDNO,
  strategicRemoveMerc,
} from './departure.ts';
import { type ExtensionResult, mercContractHandling } from './extension.ts';
import { hireContract, mercArrived } from './hire-contract.ts';
import { dailyUpdateOfMercSite } from './merc-account.ts';
import { HistoryCode, Quote, type QuoteName, quoteKey, SpecialProfile } from './quotes.ts';
import {
  canExtendContractForSoldier,
  checkIfSalaryIncreasedAndSayQuote,
  contractOptions,
  dismissRefusal,
  EXTENSION_CHOICES,
  type ExtensionChoice,
  endCurrentContractRenewal,
  findOutIfAnyMercAboutToLeaveIsGonnaRenew,
  mercContractIsExpiring,
  renewalCandidateExpiring,
  startRenewalQuotes,
  willMercRenew,
} from './renewal.ts';
import { rpcWhineAboutNoPay } from './rpc-pay.ts';
import { raiseSalaries } from './salary.ts';

const LOCK_PAUSE_CONTRACT_RENEWAL = 7;
const LOCK_PAUSE_CONTRACT_ENDING = 8;
const LEVEL_EMAIL_DELAY_MINUTES = 60;
const LEVEL_EMAIL_DELAY_SPREAD = 60;
const SETTLE_GUARD = 64;
const BUDDY_KILLED_QUOTES: Readonly<Record<number, QuoteName>> = {
  [BuddySlot.SLOT1]: 'BUDDY_ONE_KILLED',
  [BuddySlot.SLOT2]: 'BUDDY_TWO_KILLED',
  [BuddySlot.LEARNED_TO_LIKE]: 'LEARNED_TO_LIKE_MERC_KILLED',
};
const VERY_SUSPICIOUS_DEATH = 2;
const SUSPICIOUS_DEATH = 1;
const SUSPICIOUS_INSURANCE_WINDOW_MINUTES = 60;

export interface ContractSetup {
  readonly roster: Roster;
  readonly content: TacticalContent;
  readonly hooks?: Partial<ContractHooks>;
}

type Command = { readonly type: string; readonly [key: string]: unknown };
export type RenewalStep = { readonly kind: 'off' | 'finished' | 'next' } | { readonly kind: 'waiting' | 'menu'; readonly merc: RosterMerc };
type PromptWithoutId = BattlePrompt extends infer P ? (P extends BattlePrompt ? Omit<P, 'id'> : never) : never;

function soldierArg(cmd: Command): number | null {
  return typeof cmd.soldier === 'number' && Number.isInteger(cmd.soldier) ? cmd.soldier : null;
}

function canSayQuote(m: RosterMerc): boolean {
  return (
    m.profile !== NO_PROFILE && m.life >= OKLIFE && m.soldier.bodyType !== Body.ROBOTNOWEAPON && m.assignment !== Assignment.ASSIGNMENT_POW
  );
}

export class ContractFlow implements ContractContext {
  readonly campaign: CampaignSim;
  readonly roster: Roster;
  readonly content: TacticalContent;
  readonly hooks: ContractHooks;
  readonly experienceHooks: ExperienceHooks;
  rng: ContractRandom;
  readonly #events: SimEvent[] = [];

  constructor(campaign: CampaignSim, setup: ContractSetup) {
    this.campaign = campaign;
    this.roster = setup.roster;
    this.content = setup.content;
    this.hooks = { ...NO_CONTRACT_HOOKS, ...setup.hooks };
    this.rng = { main: campaign.state.rng, pre: campaign.state.pre };
    this.experienceHooks = { levelGained: (p, s, levels) => this.#levelGained(p, s, levels) };
  }

  get state(): StrategicState {
    return this.campaign.state;
  }

  get economy(): EconomyContext {
    const economy = this.campaign.economy;
    if (!economy) throw new Error('contracts need the economy');
    return economy;
  }

  get clockContext(): ClockContext {
    return this.campaign.clockContext;
  }

  get contracts(): ContractState {
    return this.state.contracts;
  }

  get sequenceOn(): boolean {
    return this.contracts.renewal.on;
  }

  useRandom(rng: ContractRandom | null): void {
    this.rng = rng ?? { main: this.state.rng, pre: this.state.pre };
  }

  team(): readonly RosterMerc[] {
    return this.roster.all();
  }

  profile(id: number): ProfileProgress | null {
    if (id === NO_PROFILE) return null;
    return campaignProfile({ profiles: this.state.profiles, content: this.content }, id);
  }

  mercType(profile: number): number | undefined {
    return this.economy.economy.mercTypes.get(profile);
  }

  moraleContext(): MoraleContext {
    const battle = this.campaign.battle;
    if (!battle) throw new Error('contracts need the battle flow');
    return battle.moraleContext();
  }

  say(m: RosterMerc, quote: QuoteName, subject?: number): void {
    if (!canSayQuote(m)) return;
    this.emit({
      type: 'mercQuote',
      soldier: m.id,
      profile: m.profile,
      quote: quoteKey(quote),
      id: Quote[quote],
      ...(subject !== undefined && subject >= 0 ? { subject } : {}),
    });
  }

  emit(e: ContractEventWithoutTick): void {
    this.hooks.contractEvent(e);
    this.#events.push({ ...e, tick: this.campaign.tick } as SimEvent);
  }

  drainEvents(): SimEvent[] {
    return this.#events.splice(0);
  }

  history(code: number, profile: number, sector: { x: number; y: number; z: number } | null): void {
    const valid = sector !== null && sector.x >= 1 && sector.y >= 1;
    this.hooks.history(code, profile, valid ? { x: sector.x, y: sector.y, z: sector.z } : null);
    this.emit({ type: 'historyAdded', code, profile, sector: valid ? sectorShortString(sector) : null });
  }

  removeFromWorld(m: RosterMerc): void {
    removeCharacterFromSquads(this.economy, m.id);
    this.roster.removeFromTacticalSector(m.id);
    this.roster.remove(m.id);
    this.campaign.sectors?.checkAndHandleUnloadingOfCurrentWorld();
  }

  enterMapScreen(): void {
    if (this.state.flow === 'tactical') enterMapScreen(this.campaign);
  }

  register(d: EventDispatch<CampaignSim>): void {
    d.register(EventKind.MERC_DAILY_UPDATE, () => mercDailyUpdate(this));
    d.register(EventKind.MERC_ABOUT_TO_LEAVE, () => this.#aboutToLeave());
    d.register(EventKind.BEGIN_CONTRACT_RENEWAL_SEQUENCE, () => this.beginRenewalSequence());
    d.register(EventKind.RPC_WHINE_ABOUT_PAY, (_, e) => rpcWhineAboutNoPay(this, e.param));
    d.register(EventKind.MERC_COMPLAIN_EQUIPMENT, (_, e) => mercComplainAboutEquipment(this, e.param));
    d.register(EventKind.MERC_LEAVE_EQUIP_IN_DRASSEN, (_, e) =>
      handleEquipmentLeft(this, e.param, primaryAirportSector(this), PRIMARY_AIRPORT_LEAVE_EQUIP_GRIDNO, this.campaign.tactical),
    );
    d.register(EventKind.MERC_LEAVE_EQUIP_IN_OMERTA, (_, e) =>
      handleEquipmentLeft(
        this,
        e.param,
        sectorFromId(this.economy.content.policy.startSector),
        START_SECTOR_LEAVE_EQUIP_GRIDNO,
        this.campaign.tactical,
      ),
    );
    d.register(EventKind.DAILY_UPDATE_OF_MERC_SITE, () => dailyUpdateOfMercSite(this));
    d.register(EventKind.MERC_MERC_WENT_UP_LEVEL_EMAIL_DELAY, (_, e) =>
      this.emit({ type: 'mailDue', mail: 'mercWentUpALevel', profile: mercMercProfileFromEmailIndex(e.param) }),
    );
  }

  #aboutToLeave(): void {
    const before = this.#events.length;
    findOutIfAnyMercAboutToLeaveIsGonnaRenew(this);
    if (this.#events.slice(before).some((e) => e.type === 'contractsExpiringSoon')) this.campaign.stopCompression('contract');
  }

  beginRenewalSequence(): void {
    if (!renewalCandidateExpiring(this)) return;
    const seq = this.contracts.renewal;
    seq.on = true;
    seq.current = 0;
    seq.inProgress = false;
    const clock = this.state.clock;
    pauseGame(clock);
    lockPauseState(clock, LOCK_PAUSE_CONTRACT_RENEWAL);
    interruptTime(clock);
  }

  settle(): void {
    for (let guard = 0; guard < SETTLE_GUARD; guard++) {
      const s = this.state;
      if (s.battle.prompt || s.flow === 'autoresolve') return;
      const ending = this.contracts.pendingEndings.shift();
      if (ending) this.#processEnding(ending);
      else if (!this.#advanceRenewalSequence()) return;
    }
  }

  #processEnding(e: PendingEnding): void {
    const m = this.roster.get(e.soldier);
    if (!m) return;
    switch (e.kind) {
      case 'enterMapScreen':
        this.enterMapScreen();
        return;
      case 'withoutEquipment':
        strategicRemoveMerc(this, m, 'carried');
        return;
      case 'departure':
        this.#openDeparture(m, e.rehire);
        return;
    }
  }

  renewalStep(): RenewalStep {
    const seq = this.contracts.renewal;
    if (!seq.on) return { kind: 'off' };
    if (seq.current >= seq.list.length) {
      seq.list.length = 0;
      seq.on = false;
      unLockPauseState(this.state.clock);
      return { kind: 'finished' };
    }
    const m = this.roster.byProfile(seq.list[seq.current] ?? NO_PROFILE);
    if (!m) {
      endCurrentContractRenewal(seq);
      return { kind: 'next' };
    }
    if (seq.inProgress) return { kind: 'waiting', merc: m };
    if (!mercContractIsExpiring(this, m)) {
      endCurrentContractRenewal(seq);
      return { kind: 'next' };
    }
    seq.inProgress = true;
    startRenewalQuotes(this, m);
    return { kind: 'menu', merc: m };
  }

  #advanceRenewalSequence(): boolean {
    if (!this.contracts.renewal.on) return false;
    this.enterMapScreen();
    for (let guard = 0; guard < SETTLE_GUARD; guard++) {
      const step = this.renewalStep();
      switch (step.kind) {
        case 'next':
          continue;
        case 'finished':
          this.campaign.refreshPauseState();
          return false;
        case 'waiting':
          this.#openRenewal(step.merc);
          return false;
        case 'menu':
          this.#openRenewalMenu(step.merc);
          return false;
        default:
          return false;
      }
    }
    return false;
  }

  #openRenewalMenu(m: RosterMerc): void {
    if (willMercRenew(this, m, false)) checkIfSalaryIncreasedAndSayQuote(this, m);
    this.contracts.renewal.fromSequence = true;
    this.#openRenewal(m);
  }

  #openPrompt(prompt: PromptWithoutId): void {
    const battle = this.state.battle;
    battle.prompt = { ...prompt, id: nextPromptId(battle, prompt.kind) } as BattlePrompt;
  }

  #openRenewal(m: RosterMerc): void {
    this.#openPrompt({ kind: PromptKind.CONTRACT_RENEWAL, soldier: m.id, fromSequence: this.contracts.renewal.fromSequence });
  }

  #openDeparture(m: RosterMerc, rehire: boolean): void {
    const clock = this.state.clock;
    interruptTime(clock);
    pauseGame(clock);
    lockPauseState(clock, LOCK_PAUSE_CONTRACT_ENDING);
    this.hooks.mercLeavingTeam(m);
    if (m.kind === MercKind.EPC) return;
    const options = departureOptions(this, m, rehire);
    this.#openPrompt({ kind: PromptKind.MERC_DEPARTURE, soldier: m.id, choices: options.choices, elsewhere: options.elsewhere });
  }

  #closeMessageBox(): void {
    const clock = this.state.clock;
    unLockPauseState(clock);
    unPauseGame(clock);
  }

  #endIfFromSequence(): void {
    const seq = this.contracts.renewal;
    if (seq.fromSequence) endCurrentContractRenewal(seq);
  }

  #inCombat(): boolean {
    return this.campaign.tactical?.state.inCombat === true;
  }

  #afterExtension(m: RosterMerc, result: ExtensionResult): void {
    if (!result.extended) return;
    switch (result.insurance.kind) {
      case 'none':
        this.#endIfFromSequence();
        return;
      case 'unaffordable':
        this.emit({ type: 'insuranceUnaffordable', soldier: m.id, cost: result.insurance.cost });
        this.#closeMessageBox();
        this.#endIfFromSequence();
        return;
      case 'offer':
        this.#openPrompt({ kind: PromptKind.INSURANCE_EXTENSION, soldier: m.id, days: result.days, cost: result.insurance.cost });
        return;
    }
  }

  answer(prompt: BattlePrompt, choice: string): CommandResult {
    switch (prompt.kind) {
      case PromptKind.CONTRACT_RENEWAL:
        return this.#answerRenewal(prompt.soldier, choice);
      case PromptKind.MERC_DEPARTURE:
        return this.#answerDeparture(prompt.soldier, prompt.choices, choice);
      case PromptKind.INSURANCE_EXTENSION:
        return this.#answerInsurance(prompt.soldier, prompt.days, choice);
      default:
        return { ok: false, reason: 'not a contract prompt' };
    }
  }

  #answerRenewal(soldier: number, choice: string): CommandResult {
    const m = this.roster.get(soldier);
    if (!m) return { ok: false, reason: 'no such merc' };
    const option = contractOptions(this, m, this.#inCombat()).find((o) => o.choice === choice);
    if (!option) return { ok: false, reason: "choose 'day', 'week', 'twoWeeks', 'dismiss' or 'letGo'" };
    if (!option.enabled) return { ok: false, reason: option.reason ?? 'that choice is disabled' };
    this.state.battle.prompt = null;
    const seq = this.contracts.renewal;
    if ((choice === 'dismiss' || choice === 'letGo') && seq.fromSequence && !canBeRemovedFromContract(m)) {
      endCurrentContractRenewal(seq);
      return { ok: true };
    }
    if (choice === 'dismiss') {
      if (!seq.fromSequence) this.#closeMessageBox();
      m.contract.leaveHistoryCode = HistoryCode.MERC_FIRED;
      beginRemoveMercFromContract(this, m);
      return { ok: true };
    }
    if (choice === 'letGo') {
      if (seq.fromSequence) beginRemoveMercFromContract(this, m);
      return { ok: true };
    }
    const result = mercContractHandling(this, m, choice as ExtensionChoice);
    this.#afterExtension(m, result);
    return { ok: true, data: result };
  }

  #answerDeparture(soldier: number, choices: readonly string[], choice: string): CommandResult {
    const m = this.roster.get(soldier);
    if (!m) return { ok: false, reason: 'no such merc' };
    if (!choices.includes(choice)) return { ok: false, reason: `choose one of ${choices.join(', ')}` };
    this.state.battle.prompt = null;
    this.#closeMessageBox();
    const carries = m.soldier.inv.some((o) => o && o.item !== 0 && o.count > 0);
    switch (choice as DepartureChoice) {
      case 'here':
        handleLeavingOfEquipmentInCurrentSector(this, m, this.campaign.tactical);
        strategicRemoveMerc(this, m, carries ? 'here' : 'none');
        break;
      case 'elsewhere':
        handleMercLeavingEquipment(this, m, primaryAirportUnderPlayerControl(this));
        strategicRemoveMerc(this, m, carries ? 'elsewhere' : 'none');
        break;
      case 'rehire':
        this.enterMapScreen();
        checkIfSalaryIncreasedAndSayQuote(this, m);
        this.#openRenewal(m);
        break;
    }
    this.campaign.refreshPauseState();
    return { ok: true };
  }

  #answerInsurance(soldier: number, days: number, choice: string): CommandResult {
    if (choice !== 'yes' && choice !== 'no') return { ok: false, reason: "choose 'yes' or 'no'" };
    this.state.battle.prompt = null;
    this.#closeMessageBox();
    const m = this.roster.get(soldier);
    if (m && choice === 'yes') this.hooks.purchaseOrExtendInsurance(m, days);
    this.#endIfFromSequence();
    this.campaign.refreshPauseState();
    return { ok: true };
  }

  dispatch(cmd: Command): CommandResult | null {
    switch (cmd.type) {
      case 'extendContract':
        return this.#extendCommand(cmd);
      case 'dismiss':
        return this.#dismissCommand(cmd);
      case 'removeMerc':
        return this.#removeMercCommand(cmd);
      case 'contractOptions':
        return this.#optionsQuery(cmd);
      default:
        return null;
    }
  }

  #mercFor(cmd: Command, mapScreenOnly: boolean): RosterMerc | string {
    if (mapScreenOnly && this.state.flow !== 'strategic') return 'mapScreenOnly';
    const id = soldierArg(cmd);
    const m = id === null ? undefined : this.roster.get(id);
    return m ?? 'no such merc';
  }

  #extendCommand(cmd: Command): CommandResult {
    const m = this.#mercFor(cmd, true);
    if (typeof m === 'string') return { ok: false, reason: m };
    const choice = cmd.length as ExtensionChoice;
    if (!EXTENSION_CHOICES.includes(choice)) return { ok: false, reason: "length must be 'day', 'week' or 'twoWeeks'" };
    if (!canExtendContractForSoldier(m)) return { ok: false, reason: 'cannotExtend' };
    const option = contractOptions(this, m, this.#inCombat()).find((o) => o.choice === choice);
    if (option && !option.enabled) return { ok: false, reason: option.reason ?? 'cannotExtend' };
    const result = mercContractHandling(this, m, choice);
    this.#afterExtension(m, result);
    return { ok: true, data: result };
  }

  #dismissCommand(cmd: Command): CommandResult {
    const m = this.#mercFor(cmd, true);
    if (typeof m === 'string') return { ok: false, reason: m };
    if (!canExtendContractForSoldier(m)) return { ok: false, reason: 'cannotExtend' };
    if (m.life <= 0) return { ok: false, reason: 'dead' };
    const refusal = dismissRefusal(m, this.#inCombat());
    if (refusal) return { ok: false, reason: refusal };
    this.#closeMessageBox();
    m.contract.leaveHistoryCode = HistoryCode.MERC_FIRED;
    beginRemoveMercFromContract(this, m);
    return { ok: true };
  }

  #removeMercCommand(cmd: Command): CommandResult {
    const m = this.#mercFor(cmd, true);
    if (typeof m === 'string') return { ok: false, reason: m };
    if (m.life > 0 && m.assignment !== Assignment.ASSIGNMENT_POW) return { ok: false, reason: 'notDeadOrCaptured' };
    strategicRemoveMerc(this, m, 'none');
    return { ok: true };
  }

  #optionsQuery(cmd: Command): CommandResult {
    const m = this.#mercFor(cmd, false);
    if (typeof m === 'string') return { ok: false, reason: m };
    if (!canExtendContractForSoldier(m)) return { ok: false, reason: 'cannotExtend' };
    return { ok: true, data: { balance: this.state.finances.balance, options: contractOptions(this, m, this.#inCombat()) } };
  }

  loadMercProfiles(dialogueProfiles?: ReadonlySet<number>): void {
    const content = dialogueProfiles ? { ...this.content, dialogueProfiles } : this.content;
    loadMercProfiles({ profiles: this.state.profiles, content }, this.state.options.gunNut);
  }

  hireContract(m: RosterMerc, length: number): number {
    return hireContract(this, m, length);
  }

  mercArrived(id: number): void {
    const m = this.roster.get(id);
    if (m) mercArrived(this, m);
  }

  teamMoraleEvent(e: TeamMoraleEvent): void {
    const m = this.roster.get(e.soldier);
    if (!m) return;
    this.say(m, e.quote, e.about);
    if (e.type !== 'quit') return;
    this.contracts.pendingEndings.push({ kind: 'departure', soldier: m.id, rehire: false });
    m.contract.leaveHistoryCode = HistoryCode.MERC_QUIT;
  }

  #levelGained(p: ProfileProgress, s: Soldier | null, levels: number): void {
    if (!s) {
      raiseSalaries(p, levels);
      return;
    }
    const m = this.roster.get(s.id);
    if (!m || m.soldier !== s) return;
    if (m.kind === MercKind.AIM_MERC) m.contract.contractPriceIncreased = true;
    else if (m.kind === MercKind.MERC) {
      const minute = worldTotalMinutes(this.state.clock) + LEVEL_EMAIL_DELAY_MINUTES + this.rng.main.int(LEVEL_EMAIL_DELAY_SPREAD);
      addStrategicEvent(this.state.queue, EventKind.MERC_MERC_WENT_UP_LEVEL_EMAIL_DELAY, minute, mercMercEmailIndex(m.profile));
    } else return;
    raiseSalaries(p, levels);
  }

  deathBookkeeping(m: RosterMerc): void {
    if (m.profile === NO_PROFILE) return;
    const world = this.state.worldSector;
    const sector = m.sector.x >= 1 && m.sector.y >= 1 ? m.sector : world;
    const killedByUs = m.soldier.attacker?.team === 0;
    this.history(killedByUs ? HistoryCode.MERC_KILLED_CHARACTER : HistoryCode.MERC_KILLED, m.profile, sector);
  }

  lifeInsuranceOnDeath(m: RosterMerc, p: ProfileProgress): void {
    if (!m.contract.lifeInsurance) return;
    if (this.state.flow !== 'autoresolve') {
      const now = worldTotalMinutes(this.state.clock);
      const start = m.contract.startTimeOfInsuranceContract;
      const enemyInSector = this.campaign.tactical?.state.turn.enemyInSector === true;
      if (now >= start && u32(now - start) < SUSPICIOUS_INSURANCE_WINDOW_MINUTES) p.suspiciousDeath = VERY_SUSPICIOUS_DEATH;
      else if (m.soldier.attacker?.team === 0 || !enemyInSector) p.suspiciousDeath = SUSPICIOUS_DEATH;
    }
    this.hooks.addLifeInsurancePayout(m);
  }

  mercMercDied(m: RosterMerc): void {
    if (m.kind !== MercKind.MERC) return;
    m.contract.contractEnd = worldTotalMinutes(this.state.clock);
    this.hooks.mercMercLost();
  }

  buddyKilledQuotes(dead: RosterMerc): void {
    const flow = this.state.flow;
    if (flow !== 'tactical' && flow !== 'strategic') return;
    for (const m of this.team()) {
      if (m.life < OKLIFE || (flow === 'tactical' && !m.inSector)) continue;
      const p = this.profile(m.profile);
      const quote = p ? BUDDY_KILLED_QUOTES[whichBuddy(p, dead.profile)] : undefined;
      if (quote) this.say(m, quote, dead.profile);
    }
  }
}

const LARRY_DRUNK_INDEX = SpecialProfile.LARRY_DRUNK - SpecialProfile.BIFF;

function mercMercEmailIndex(profile: number): number {
  const index = profile - SpecialProfile.BIFF;
  return index >= LARRY_DRUNK_INDEX ? index - 1 : index;
}

function mercMercProfileFromEmailIndex(index: number): number {
  return SpecialProfile.BIFF + (index >= LARRY_DRUNK_INDEX ? index + 1 : index);
}

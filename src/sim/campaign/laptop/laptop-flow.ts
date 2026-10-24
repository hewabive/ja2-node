// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-16. See LICENSE (SFI-SCLA).
// @src src/game/Laptop/Laptop.cc EnterLaptop (pause, AIM bookmark), HandleExit, LeaveLapTopScreen, HaventMadeImpMercEmailCallBack,
// @src LaptopScreenInit, InitLaptopAndLaptopScreens; Strategic/Map_Screen_Interface_Bottom.cc AllowedToExitFromMapscreenTo (the
// @src state-based checks); Strategic/Game_Init.cc InitNewGame (the laptop mails); Strategic/Game_Event_Hook.cc
// @src ExecuteStrategicEvent (the laptop events); Tactical/Merc_Hiring.cc MercArrivesCallback; Strategic/Map_Screen_Interface.cc
// @src HandleTimeCompressWithTeamJackedInAndGearedToGo (Enrico's mail); Strategic/Strategic_Status.cc HandleEnricoEmail (the
// @src mails and history); Strategic/Strategic_Merc_Handler.cc MercDailyUpdate (the reply mail), StrategicHandlePlayerTeamMercDeath
// @src (Speck's lost-merc flag); Strategic/Merc_Contract.cc CalculateMedicalDepositRefund (the mails), StrategicRemoveMerc
// @src (personnel lists); Laptop/Mercs.cc DailyUpdateOfMercSite (the mails); Tactical/Campaign.cc MERCMercWentUpALevelSendEmail,
// @src HandleUnhiredMercDeaths (the mail); Strategic/PreBattle_Interface.cc LogBattleResults; Laptop/Files.cc
// @src AddFilesAboutTerrorists; Laptop/BobbyR.cc EnterBobbyR, Laptop/Mercs.cc EnterMercs, Laptop/Funeral.cc EnterFuneral,
// @src Laptop/Florist.cc EnterFlorist, Laptop/Insurance.cc EnterInsurance (the effects of entering a site: visitSite);
// @src Laptop/Laptop.cc LeaveLapTopScreen (fNewMailFlag cleared). See docs/21 §1, §6, §8, §10.

import type { MercProfile } from '../../../content/formats/prof.ts';
import type { LaptopContent } from '../../../content/strategic/laptop-content.ts';
import type { MerchantContent } from '../../../content/strategic/merchant-content.ts';
import { parseSectorString, type Sector, sameSector, sectorFromId, sectorShortString } from '../../../content/strategic/sector-ids.ts';
import type { CommandResult } from '../../command.ts';
import type { SimEvent } from '../../events.ts';
import { handleEnricoEmail } from '../../strategic/economy/inactivity.ts';
import type { EconomyContext } from '../../strategic/economy/ports.ts';
import { EncounterCode, InsertionCode } from '../../strategic/forces/constants.ts';
import { addCharacterToAnySquad } from '../../strategic/forces/squads.ts';
import type { StrategicState } from '../../strategic/state.ts';
import { EventKind } from '../../strategic/time/constants.ts';
import type { EventDispatch } from '../../strategic/time/dispatch.ts';
import { addFutureDayStrategicEvent } from '../../strategic/time/event-queue.ts';
import { type ClockContext, CompressionStop, stopTimeCompression, worldDay, worldTotalMinutes } from '../../strategic/time/world-clock.ts';
import type { TacticalContent } from '../../tactical/content.ts';
import { MercStatus, type ProfileProgress, profileProgress } from '../../tactical/profiles.ts';
import { NO_PROFILE } from '../../tactical/soldier.ts';
import type { CampaignCommand, CampaignSim } from '../campaign-sim.ts';
import type { ContractEventWithoutTick, ContractHooks } from '../contracts/context.ts';
import { mercArrivalTimeOfDay } from '../contracts/contract-times.ts';
import type { MailKind } from '../contracts/events.ts';
import { SpecialProfile } from '../contracts/quotes.ts';
import type { FinanceRecord } from '../finances.ts';
import { initProfileFromContent, ProfileMiscFlag3 } from '../profiles.ts';
import type { Roster, RosterMerc } from '../roster.ts';
import { openTacticalScreen } from '../screens.ts';
import {
  AIM_CONTRACT_LENGTHS,
  aimCharge,
  aimContact,
  aimHire,
  aimHireCheck,
  aimLeaveMessageRefusal,
  decideActiveTerrorists,
  defaultGear,
  isAimMerc,
  startSomeMercsOnAssignment,
} from './aim.ts';
import {
  addFreshBobbyRayInventory,
  addJohnsGunShipment,
  bobbyRayPurchaseEvent,
  bobbyRaySiteAccessible,
  dailyUpdateOfBobbyRaysInventory,
  initBobbyRayInventory,
  type OrderRequest,
  placeOrder,
  quoteOrderForm,
  visitBobbyRay,
} from './bobby-ray.ts';
import type { LaptopContext, LaptopRandom, MailOptions } from './context.ts';
import type { LaptopEventWithoutTick } from './events.ts';
import { type FlowerOrder, orderFlowers } from './florist.ts';
import { checkForValidArrivalSector, type HireHooks, handleAirspaceControlUpdated, setLandingZone } from './hire.ts';
import { canCreateAnotherImpCharacter, emptyProfile, type ImpRequest, impCheckCode, impCreate, impPreview } from './imp.ts';
import {
  addLifeInsurancePayout,
  dailyUpdateOfInsuredMercs,
  endInsuranceInvestigation,
  insuranceLength,
  insurancePremium,
  isInsurable,
  payLifeInsuranceForDeadMerc,
  purchaseOrExtendInsurance,
  startInsuranceInvestigation,
} from './insurance.ts';
import {
  Bookmark,
  bookmarkNames,
  type Email,
  type LaptopState,
  MercAccountStatus,
  resetLaptopState,
  SpeckQuoteFlag,
  setBookmark,
} from './laptop-state.ts';
import { addEmail, deleteEmail, findEmail, type MailSpec, mailSpec, mailType, readEmail, sender } from './mail.ts';
import {
  enterMercSite,
  getMercSiteBackOnline,
  larryRelapsed,
  makeNewMercsAvailable,
  mercCommandRefusal,
  mercHire,
  mercHireQuotes,
  mercHireRefusalQuotes,
  mercPaymentQuotes,
  mercSiteDailyUpdate,
  openMercAccount,
  SpeckQuote,
  settleMercAccounts,
  speckOpening,
} from './merc-site.ts';
import { addFile, addHistory, addToPersonnelList, ENRICO_BACKGROUND_FILE, History, type HistorySector } from './records.ts';

const LAPTOP_COMMANDS: ReadonlySet<string> = new Set([
  'closeLaptop',
  'visitSite',
  'readEmail',
  'deleteEmail',
  'aimHire',
  'aimLeaveMessage',
  'mercOpenAccount',
  'mercHire',
  'mercPay',
  'impCreate',
  'bobbyRayOrder',
  'insure',
  'orderFlowers',
]);
const QUERIES: ReadonlySet<string> = new Set([
  'aimQuote',
  'hireCheck',
  'bobbyRayQuote',
  'insuranceQuote',
  'impPreview',
  'arrivalTime',
  'impCheckCode',
]);
const SITE_BOOKMARKS: Readonly<Record<string, number>> = {
  funeral: Bookmark.FUNERAL,
  florist: Bookmark.FLORIST,
  insurance: Bookmark.INSURANCE,
};
export const LAPTOP_REFUSAL = 'laptop: the laptop is open, closeLaptop first';
const IMP_REMINDER_FIRST_HOUR = 8;
const IMP_REMINDER_HOURS = 4;
const MINUTES_PER_HOUR = 60;
const FIRST_TERRORIST_FILE = 1;
const LAST_TERRORIST_FILE = 6;
const REPLY_SENDER_BASE = 'BARRY_MAIL';
const NO_DESTINATION = -1;
const STARTING_MAILS = ['OLD_ENRICO_1', 'OLD_ENRICO_2', 'RIS_REPORT', 'OLD_ENRICO_3'] as const;
const STARTING_SENDERS: Readonly<Record<(typeof STARTING_MAILS)[number], string>> = {
  OLD_ENRICO_1: 'MAIL_ENRICO',
  OLD_ENRICO_2: 'MAIL_ENRICO',
  RIS_REPORT: 'RIS_EMAIL',
  OLD_ENRICO_3: 'MAIL_ENRICO',
};
const ENRICO_MAILS: Readonly<Record<string, string>> = {
  creatures: 'ENRICO_CREATURES',
  progress20: 'ENRICO_PROG_20',
  progress55: 'ENRICO_PROG_55',
  progress80: 'ENRICO_PROG_80',
  majorSetback: 'ENRICO_SETBACK',
  minorSetback: 'ENRICO_SETBACK_2',
  lackOfProgress1: 'LACK_PLAYER_PROGRESS_1',
  lackOfProgress2: 'LACK_PLAYER_PROGRESS_2',
  lackOfProgress3: 'LACK_PLAYER_PROGRESS_3',
};
const LACK_OF_PROGRESS = /^lackOfProgress/;
const ACCOUNT_MAILS: Readonly<Record<string, readonly [string, boolean]>> = {
  mercAccountFirstWarning: ['MERC_FIRST_WARNING', true],
  mercAccountSuspended: ['MERC_WARNING', true],
  mercAccountInvalid: ['MERC_INVALID', false],
};
const REFUND_MAILS: Readonly<Record<string, string>> = {
  medicalDepositRefund: 'AIM_MEDICAL_DEPOSIT_REFUND',
  medicalDepositPartialRefund: 'AIM_MEDICAL_DEPOSIT_PARTIAL_REFUND',
  medicalDepositNoRefund: 'AIM_MEDICAL_DEPOSIT_NO_REFUND',
};
type Command = CampaignCommand;

const isInt = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v);

export interface LaptopSetup {
  readonly content: LaptopContent;
  readonly dialogueProfiles?: ReadonlySet<number>;
  readonly merchants?: MerchantContent;
}

export interface LaptopWiring {
  readonly roster: Roster;
  readonly tactical: TacticalContent;
}

export class LaptopFlow implements LaptopContext {
  readonly campaign: CampaignSim;
  readonly content: LaptopContent;
  readonly roster: Roster;
  readonly tactical: TacticalContent;
  readonly dialogueProfiles: ReadonlySet<number> | undefined;
  readonly merchants: MerchantContent | undefined;
  rng: LaptopRandom;
  readonly #events: SimEvent[] = [];

  constructor(campaign: CampaignSim, setup: LaptopSetup, wiring: LaptopWiring) {
    this.campaign = campaign;
    this.content = setup.content;
    this.dialogueProfiles = setup.dialogueProfiles;
    this.merchants = setup.merchants;
    this.roster = wiring.roster;
    this.tactical = wiring.tactical;
    this.rng = { main: campaign.state.rng, pre: campaign.state.pre };
  }

  useRandom(rng: LaptopRandom | null): void {
    this.rng = rng ?? { main: this.state.rng, pre: this.state.pre };
  }

  get state(): StrategicState {
    return this.campaign.state;
  }

  get laptop(): LaptopState {
    return this.state.laptop;
  }

  get clockContext(): ClockContext {
    return this.campaign.clockContext;
  }

  get #economy(): EconomyContext {
    const economy = this.campaign.economy;
    if (!economy) throw new Error('the laptop needs the economy');
    return economy;
  }

  now(): number {
    return worldTotalMinutes(this.state.clock);
  }

  day(): number {
    return worldDay(this.state.clock);
  }

  profile(id: number): ProfileProgress | null {
    if (id === NO_PROFILE) return null;
    return profileProgress({ profiles: this.state.profiles, content: this.tactical }, id);
  }

  profileRecord(id: number): MercProfile | null {
    const record = this.laptop.imp.profiles.get(id) ?? this.tactical.profiles[id] ?? null;
    if (record && !this.laptop.imp.profiles.has(id) && this.mercType(id) === undefined) return emptyProfile(id);
    return record;
  }

  mercType(id: number): number | undefined {
    return this.#economy.economy.mercTypes.get(id);
  }

  team(): readonly RosterMerc[] {
    return this.roster.all();
  }

  startSector(): number {
    return this.#economy.content.policy.startSector;
  }

  emit(e: LaptopEventWithoutTick): void {
    this.#events.push({ ...e, tick: this.campaign.tick } as SimEvent);
  }

  drainEvents(): SimEvent[] {
    return this.#events.splice(0);
  }

  mail(spec: MailSpec, from: number, options: MailOptions = {}): Email {
    const mail = addEmail(this.laptop, spec, from, this.now(), options.firstData ?? 0, options.secondData ?? 0, options.read ?? false);
    this.emit({ type: 'emailReceived', id: mail.id, mail: mailType(this.content, mail.offset).type, sender: mail.sender });
    return mail;
  }

  history(code: number, secondCode: number, sector: Sector | null): void {
    addHistory(this.laptop, code, secondCode, this.now(), sector);
    const valid = sector !== null && sector.x >= 1 && sector.y >= 1;
    this.emit({ type: 'historyAdded', code, profile: secondCode, sector: valid ? sectorShortString(sector) : null });
  }

  emitMoney(record: FinanceRecord): void {
    this.emit({ type: 'moneyChanged', code: record.code, amount: record.amount, balance: record.balanceAfter });
  }

  isOpen(): boolean {
    return this.state.flow === 'laptop';
  }

  hireHooks(): HireHooks {
    return {
      hireContract: (merc, length) =>
        this.campaign.contracts?.hireContract(merc, length) ?? (this.state.didGameJustStart ? 0 : mercArrivalTimeOfDay(this.now())),
    };
  }

  contractHooks(): Partial<ContractHooks> {
    return {
      insuranceExtensionCost: (m, days) => {
        const p = this.profile(m.profile);
        return p ? insurancePremium(this, days, m, p) : null;
      },
      purchaseOrExtendInsurance: (m, days) => {
        purchaseOrExtendInsurance(this, m, days);
      },
      addLifeInsurancePayout: (m) => addLifeInsurancePayout(this, m),
      mercSiteDailyUpdate: () => mercSiteDailyUpdate(this),
      larryRelapsed: () => larryRelapsed(this),
      mercMercLost: () => {
        this.laptop.merc.speckCanSayPlayersLostQuote = 1;
      },
      history: (code, profile, sector) => addHistory(this.laptop, code, profile, this.now(), sector),
      contractEvent: (e) => this.#contractEvent(e),
    };
  }

  economyHistory(code: number, secondCode: number, sector: HistorySector | null): void {
    this.history(code, secondCode, sector ? { x: sector.x, y: sector.y, z: sector.z } : null);
  }

  #contractEvent(e: ContractEventWithoutTick): void {
    if (e.type === 'mailDue') this.#contractMail(e.mail, e.profile ?? 0, e.amount ?? 0);
    else if (e.type === 'mercLeft') addToPersonnelList(this.laptop, e.personnel === 'fired' ? 'left' : e.personnel, e.profile);
  }

  #contractMail(kind: MailKind, profile: number, amount: number): void {
    const c = this.content;
    const account = ACCOUNT_MAILS[kind];
    if (account) {
      const [name, complain] = account;
      this.mail(mailSpec(c, name), sender(c, 'SPECK_FROM_MERC'));
      if (complain) this.laptop.merc.speckQuoteFlags |= SpeckQuoteFlag.SENT_EMAIL_ABOUT_LACK_OF_PAYMENT;
      return;
    }
    const refund = REFUND_MAILS[kind];
    if (refund) {
      this.mail(mailSpec(c, refund), sender(c, 'AIM_SITE'), { firstData: amount, secondData: profile });
      return;
    }
    if (kind === 'mercBackFromAssignment') this.mail(mailSpec(c, 'AIM_REPLY_BARRY', profile), sender(c, REPLY_SENDER_BASE) + profile);
    else if (kind === 'mercDiedOnOtherAssignment')
      this.mail(mailSpec(c, 'MERC_DIED_ON_OTHER_ASSIGNMENT'), sender(c, 'AIM_SITE'), { secondData: profile });
    else if (kind === 'mercWentUpALevel')
      this.mail(mailSpec(c, 'MERC_UP_LEVEL_BIFF', mercMercMailIndex(profile)), sender(c, 'SPECK_FROM_MERC'));
  }

  register(d: EventDispatch<CampaignSim>): void {
    const c = this.content;
    d.register(EventKind.DAY3_ADD_EMAIL_FROM_SPECK, () => this.mail(mailSpec(c, 'MERC_INTRO'), sender(c, 'SPECK_FROM_MERC')));
    d.register(EventKind.DAY2_ADD_EMAIL_FROM_IMP, (_, e) => {
      if (c.imp.sendsProfileResultsEmail)
        this.mail(mailSpec(c, 'IMP_EMAIL_PROFILE_RESULTS'), sender(c, 'IMP_PROFILE_RESULTS'), { firstData: e.param });
    });
    d.register(EventKind.HAVENT_MADE_IMP_CHARACTER_EMAIL, () => this.#haventMadeImpCharacter());
    d.register(EventKind.AIM_RESET_MERC_ANNOYANCE, (_, e) => this.#resetMercAnnoyance(e.param));
    d.register(EventKind.BOBBYRAY_PURCHASE, (_, e) => bobbyRayPurchaseEvent(this, e.param, this.campaign.tactical));
    d.register(EventKind.UPDATE_BOBBY_RAY_INVENTORY, (_, e) => addFreshBobbyRayInventory(this, e.param));
    d.register(EventKind.MERC_SITE_BACK_ONLINE, () => getMercSiteBackOnline(this));
    d.register(EventKind.MERC_SITE_NEW_MERC_AVAILABLE, () => makeNewMercsAvailable(this, true));
    d.register(EventKind.HANDLE_INSURED_MERCS, () => dailyUpdateOfInsuredMercs(this));
    d.register(EventKind.PAY_LIFE_INSURANCE_FOR_DEAD_MERC, (_, e) => payLifeInsuranceForDeadMerc(this, e.param));
    d.register(EventKind.INSURANCE_INVESTIGATION_STARTED, (_, e) => startInsuranceInvestigation(this, e.param));
    d.register(EventKind.INSURANCE_INVESTIGATION_OVER, (_, e) => endInsuranceInvestigation(this, e.param));
    d.register(EventKind.DELAYED_HIRING_OF_MERC, (_, e) => this.mercArrives(e.param));
    d.register(EventKind.ENRICO_MAIL, () => this.#enricoMail());
  }

  bobbyRayDaily(): void {
    if (this.merchants) dailyUpdateOfBobbyRaysInventory(this, this.merchants);
  }

  addJohnsGunShipment(): void {
    addJohnsGunShipment(this);
  }

  terroristFiles(): void {
    for (let code = FIRST_TERRORIST_FILE; code <= LAST_TERRORIST_FILE; code++) addFile(this.laptop, code);
  }

  #haventMadeImpCharacter(): void {
    const imp = this.laptop.imp;
    if (!canCreateAnotherImpCharacter(this) || imp.sentImpWarningAlready) return;
    imp.sentImpWarningAlready = true;
    this.mail(mailSpec(this.content, 'IMP_EMAIL_AGAIN'), sender(this.content, 'CHAR_PROFILE_SITE'));
  }

  #resetMercAnnoyance(profile: number): void {
    let id = profile;
    if (id === SpecialProfile.LARRY_NORMAL && larryRelapsed(this)) id = SpecialProfile.LARRY_DRUNK;
    else if (id === SpecialProfile.LARRY_DRUNK && !larryRelapsed(this)) id = SpecialProfile.LARRY_NORMAL;
    const p = this.profile(id);
    if (p && (p.mercStatus === MercStatus.ANNOYED_BUT_CAN_STILL_CONTACT || p.mercStatus === MercStatus.ANNOYED_WONT_CONTACT))
      p.mercStatus = MercStatus.OK;
  }

  #enricoMail(): void {
    const outcome = handleEnricoEmail(this.#economy);
    const name = outcome.mail ? ENRICO_MAILS[outcome.mail] : undefined;
    if (!name) return;
    this.mail(mailSpec(this.content, name), sender(this.content, 'MAIL_ENRICO'));
    if (outcome.mail && LACK_OF_PROGRESS.test(outcome.mail)) this.history(History.ENRICO_COMPLAINED, 0, null);
  }

  resetForNewGame(): void {
    resetLaptopState(this.laptop, this.startSector());
    makeNewMercsAvailable(this, false);
    addFile(this.laptop, ENRICO_BACKGROUND_FILE);
    this.state.atLeastOneMercHired = false;
  }

  initNewGameProfiles(): void {
    this.#clearUndeclaredProfiles();
    decideActiveTerrorists(this);
    startSomeMercsOnAssignment(this);
  }

  #clearUndeclaredProfiles(): void {
    for (const [id, p] of this.state.profiles) {
      if (this.mercType(id) !== undefined) continue;
      const hasDialogue = p.mercStatus !== MercStatus.HAS_NO_TEXT_FILE;
      this.state.profiles.set(id, initProfileFromContent(emptyProfile(id), this.tactical.items, this.state.options.gunNut, hasDialogue));
    }
  }

  initBobbyRay(): void {
    const br = this.laptop.bobbyRay;
    br.inventory.length = 0;
    br.used.length = 0;
    if (this.merchants) initBobbyRayInventory(this, this.merchants);
  }

  initLaptopScreens(): void {
    this.laptop.imp.completed = false;
    this.laptop.bobbyRay.siteCanBeAccessed = false;
  }

  sendNewGameMails(): void {
    const c = this.content;
    this.laptop.newGameLaptop = true;
    for (const name of STARTING_MAILS) this.mail(mailSpec(c, name), sender(c, STARTING_SENDERS[name]), { read: true });
    if (canCreateAnotherImpCharacter(this)) this.mail(mailSpec(c, 'IMP_EMAIL_INTRO'), sender(c, 'CHAR_PROFILE_SITE'));
  }

  mercOnlineNow(): void {
    this.mail(mailSpec(this.content, 'MERC_INTRO'), sender(this.content, 'SPECK_FROM_MERC'));
  }

  firstLanding(): void {
    this.mail(mailSpec(this.content, 'ENRICO_CONGRATS'), sender(this.content, 'MAIL_ENRICO'));
  }

  openForNewGame(): void {
    this.state.flow = 'laptop';
    setBookmark(this.laptop, Bookmark.AIM);
    this.laptop.mercSiteOpenedThisSession = false;
    this.emit({ type: 'laptopOpened' });
  }

  surfaceSectorTaken(sector: Sector): void {
    bobbyRaySiteAccessible(this, sector);
  }

  airspaceControlUpdated(): void {
    handleAirspaceControlUpdated(this);
  }

  logBattleResults(victory: boolean, encounter: number, sector: Sector): void {
    const code = battleHistoryCode(victory, encounter);
    if (code !== null) this.history(code, 0, sector);
  }

  mercArrives(id: number): void {
    const m = this.roster.get(id);
    const strategic = this.campaign.strategic;
    if (!m || !strategic) return;
    const s = this.state;
    const start = sectorFromId(this.startSector());
    const zone = sectorFromId(this.laptop.mercArriveSector);
    const world = s.worldSector;
    if (!s.didGameJustStart && sameSector(zone, start) && !(world && sameSector(world, start)))
      this.campaign.battle?.eliminateAllEnemiesIn(start);
    checkForValidArrivalSector(this);
    stopTimeCompression(this.clockContext, CompressionStop.MERC_ARRIVED);
    addCharacterToAnySquad(strategic, id);
    if (m.contract.useLandingZone) m.sector = sectorFromId(this.laptop.mercArriveSector);
    if (world && sameSector(world, m.sector)) {
      if (m.insertionCode !== InsertionCode.CHOPPER && sameSector(m.sector, start)) {
        m.insertionCode = InsertionCode.CHOPPER;
        if (s.flow === 'strategic') openTacticalScreen(this.campaign);
      }
      strategic.mercs.updateMercInSector(id, m.sector);
    } else m.insertionCode = InsertionCode.NORTH;
    this.campaign.contracts?.mercArrived(id);
    this.emit({ type: 'mercArrived', soldier: id, profile: m.profile, sector: sectorShortString(m.sector) });
  }

  openRefusal(): string | null {
    const s = this.state;
    if (s.flow === 'laptop') return 'laptopOpen';
    if (s.flow !== 'strategic') return 'mapScreenOnly';
    if (s.battle.prompt) return 'promptOpen';
    if (s.encounter.preBattle) return 'battlePending';
    if (this.campaign.contracts?.sequenceOn) return 'renewalSequence';
    return null;
  }

  dispatch(cmd: Command): CommandResult | null {
    if (cmd.type === 'openLaptop') return this.#open();
    if (cmd.type === 'setLandingZone') return this.#setLandingZone(cmd);
    if (QUERIES.has(cmd.type)) return this.#query(cmd);
    if (!LAPTOP_COMMANDS.has(cmd.type)) return this.isOpen() ? { ok: false, reason: LAPTOP_REFUSAL } : null;
    if (!this.isOpen()) return { ok: false, reason: 'laptopClosed' };
    switch (cmd.type) {
      case 'closeLaptop':
        return this.#close();
      case 'visitSite':
        return this.#visitSite(cmd);
      case 'readEmail':
        return this.#readEmail(cmd);
      case 'deleteEmail':
        return this.#deleteEmail(cmd);
      case 'aimHire':
        return this.#aimHire(cmd);
      case 'aimLeaveMessage':
        return this.#aimLeaveMessage(cmd);
      case 'mercOpenAccount':
        return this.#mercOpenAccount();
      case 'mercHire':
        return this.#mercHire(cmd);
      case 'mercPay':
        return this.#mercPay();
      case 'impCreate':
        return this.#impCreate(cmd);
      case 'bobbyRayOrder':
        return this.#bobbyRayOrder(cmd);
      case 'insure':
        return this.#insure(cmd);
      default:
        return this.#orderFlowers(cmd);
    }
  }

  #open(): CommandResult {
    const refusal = this.openRefusal();
    if (refusal) return { ok: false, reason: refusal };
    stopTimeCompression(this.clockContext, CompressionStop.REQUESTED);
    this.state.flow = 'laptop';
    setBookmark(this.laptop, Bookmark.AIM);
    this.laptop.mercSiteOpenedThisSession = false;
    this.emit({ type: 'laptopOpened' });
    return { ok: true };
  }

  #close(): CommandResult {
    const l = this.laptop;
    const s = this.state;
    if (l.newGameLaptop && canCreateAnotherImpCharacter(this) && !l.imp.sentImpWarningAlready) {
      const minute = (IMP_REMINDER_FIRST_HOUR + this.rng.main.int(IMP_REMINDER_HOURS)) * MINUTES_PER_HOUR;
      addFutureDayStrategicEvent(s.queue, s.clock, EventKind.HAVENT_MADE_IMP_CHARACTER_EMAIL, minute, 0, 1);
    }
    if (s.atLeastOneMercHired && l.newGameLaptop) l.newGameLaptop = false;
    l.newMail = false;
    s.flow = 'strategic';
    this.emit({ type: 'laptopClosed' });
    return { ok: true };
  }

  #setLandingZone(cmd: Command): CommandResult {
    if (this.state.flow !== 'strategic') return { ok: false, reason: 'mapScreenOnly' };
    let sector: Sector;
    try {
      sector = parseSectorString(String(cmd.sector ?? ''));
    } catch {
      return { ok: false, reason: 'badSector' };
    }
    const refusal = setLandingZone(this, sector);
    return refusal ? { ok: false, reason: refusal } : { ok: true, data: { sector: sectorShortString(sector) } };
  }

  #visitSite(cmd: Command): CommandResult {
    const site = typeof cmd.site === 'string' ? cmd.site : '';
    if (site === 'merc') return this.#visitMercSite();
    if (site === 'bobbyRay') visitBobbyRay(this);
    else {
      const bookmark = SITE_BOOKMARKS[site];
      if (bookmark === undefined) return { ok: false, reason: 'badSite' };
      setBookmark(this.laptop, bookmark);
    }
    return { ok: true, data: { site, bookmarks: bookmarkNames(this.laptop) } };
  }

  #visitMercSite(): CommandResult {
    const refusal = mercCommandRefusal(this);
    if (refusal) return { ok: false, reason: refusal };
    enterMercSite(this);
    const speck = this.#mercOpening();
    return { ok: true, data: { site: 'merc', bookmarks: bookmarkNames(this.laptop), ...(speck ? { speck } : {}) } };
  }

  #mercOpening(): number[] | null {
    if (this.laptop.mercSiteOpenedThisSession) return null;
    this.laptop.mercSiteOpenedThisSession = true;
    return speckOpening(this);
  }

  #readEmail(cmd: Command): CommandResult {
    const mail = isInt(cmd.id) ? findEmail(this.laptop, cmd.id) : undefined;
    if (!mail) return { ok: false, reason: 'noSuchMail' };
    readEmail(this.content, this.laptop, mail);
    return { ok: true, data: { id: mail.id, ...mailType(this.content, mail.offset), bookmarks: [...this.laptop.bookmarks] } };
  }

  #deleteEmail(cmd: Command): CommandResult {
    return isInt(cmd.id) && deleteEmail(this.laptop, cmd.id) ? { ok: true } : { ok: false, reason: 'noSuchMail' };
  }

  #aimHire(cmd: Command): CommandResult {
    if (!isInt(cmd.profile) || !isInt(cmd.contract)) return { ok: false, reason: 'profile and contract (1, 7 or 14) are required' };
    if (cmd.gear !== undefined && typeof cmd.gear !== 'boolean') return { ok: false, reason: 'gear must be true or false' };
    const result = aimHire(this, { profile: cmd.profile, contract: cmd.contract, gear: cmd.gear }, this.hireHooks());
    if (!result.ok) {
      const data = {
        ...(result.hated !== undefined ? { hated: result.hated } : {}),
        ...(result.charge ? { charge: result.charge } : {}),
        ...(result.quote ? { quote: result.quote } : {}),
      };
      return { ok: false, reason: result.reason, ...(Object.keys(data).length > 0 ? { data } : {}) };
    }
    this.#hired('aim', result.merc, result.arrival);
    return {
      ok: true,
      data: {
        soldier: result.merc.id,
        profile: result.merc.profile,
        charge: result.charge,
        arrival: this.#arrival(result.merc, result.arrival),
        quote: result.quote,
      },
    };
  }

  #arrival(m: RosterMerc, minute: number): { readonly minute: number; readonly shownMinute: number; readonly sector: string } {
    return { minute, shownMinute: m.contract.timeWillArrive, sector: sectorShortString(m.sector) };
  }

  #hired(site: 'aim' | 'merc' | 'imp', m: RosterMerc, arrival: number): void {
    this.emit({ type: 'mercHired', site, profile: m.profile, soldier: m.id, arrivalMinute: arrival, sector: sectorShortString(m.sector) });
  }

  #aimLeaveMessage(cmd: Command): CommandResult {
    if (!isInt(cmd.profile) || !isAimMerc(this, cmd.profile)) return { ok: false, reason: 'notAimMerc' };
    const p = this.profile(cmd.profile) as ProfileProgress;
    const refusal = aimLeaveMessageRefusal(p);
    if (refusal) return { ok: false, reason: refusal };
    p.miscFlags3 |= ProfileMiscFlag3.PLAYER_LEFT_MSG_FOR_MERC_AT_AIM;
    return { ok: true };
  }

  #mercSession(): string | null {
    const refusal = mercCommandRefusal(this);
    if (refusal) return refusal;
    if (!this.laptop.mercSiteOpenedThisSession) enterMercSite(this);
    this.#mercOpening();
    return null;
  }

  #mercOpenAccount(): CommandResult {
    const refusal = this.#mercSession();
    if (refusal) return { ok: false, reason: refusal };
    if (this.laptop.merc.accountStatus !== MercAccountStatus.NO_ACCOUNT) return { ok: false, reason: 'hasAccount' };
    openMercAccount(this);
    return { ok: true, data: { accountNumber: this.laptop.merc.accountNumber, quotes: [SpeckQuote.THANK_PLAYER_FOR_OPENING_ACCOUNT] } };
  }

  #mercHire(cmd: Command): CommandResult {
    if (!isInt(cmd.profile)) return { ok: false, reason: 'profile is required' };
    const refusal = this.#mercSession();
    if (refusal) return { ok: false, reason: refusal };
    const result = mercHire(this, cmd.profile, this.hireHooks());
    if (!result.ok) {
      const quotes = mercHireRefusalQuotes(this, cmd.profile, result.reason);
      return { ok: false, reason: result.reason, ...(quotes.length > 0 ? { data: { quotes } } : {}) };
    }
    this.#hired('merc', result.merc, result.arrival);
    return {
      ok: true,
      data: {
        soldier: result.merc.id,
        profile: result.merc.profile,
        arrival: this.#arrival(result.merc, result.arrival),
        quotes: mercHireQuotes(this, result.merc.profile),
      },
    };
  }

  #mercPay(): CommandResult {
    const refusal = this.#mercSession();
    if (refusal) return { ok: false, reason: refusal };
    const result = settleMercAccounts(this);
    if (!result.ok) return { ok: false, reason: result.reason };
    return { ok: true, data: { paid: result.paid, full: result.full, quotes: mercPaymentQuotes(result.full) } };
  }

  #impCreate(cmd: Command): CommandResult {
    const result = impCreate(this, cmd as unknown as ImpRequest, this.hireHooks());
    if (!result.ok) return { ok: false, reason: result.reason };
    this.#hired('imp', result.merc, result.arrival);
    return {
      ok: true,
      data: {
        soldier: result.merc.id,
        profile: result.profile,
        skills: result.skills,
        personality: result.personality,
        attitude: result.attitude,
        arrival: this.#arrival(result.merc, result.arrival),
      },
    };
  }

  #orderRequest(cmd: Command, destinationOptional = false): OrderRequest | null {
    if (!Array.isArray(cmd.lines) || !isInt(cmd.speed)) return null;
    const unset = cmd.destination === undefined || cmd.destination === null || cmd.destination === NO_DESTINATION;
    if (!isInt(cmd.destination) && !(destinationOptional && unset)) return null;
    const lines = cmd.lines.map((l) => {
      const o = (l ?? {}) as Record<string, unknown>;
      return { item: isInt(o.item) ? o.item : -1, used: o.used === true, quantity: isInt(o.quantity) ? o.quantity : 0 };
    });
    const destination = unset ? null : (cmd.destination as number);
    return { lines, destination, speed: cmd.speed };
  }

  #bobbyRayOrder(cmd: Command): CommandResult {
    const request = this.#orderRequest(cmd);
    if (!request) return { ok: false, reason: 'lines, destination and speed are required' };
    const result = placeOrder(this, request);
    if (!result.ok) return { ok: false, reason: result.reason, ...(result.quote ? { data: result.quote } : {}) };
    return { ok: true, data: { ...result.quote, shipment: result.shipment } };
  }

  #insure(cmd: Command): CommandResult {
    const m = isInt(cmd.soldier) ? this.roster.get(cmd.soldier) : undefined;
    if (!m || !isInsurable(this, m)) return { ok: false, reason: 'notInsurable' };
    const length = insuranceLength(this, m);
    if (length === 0) return { ok: false, reason: 'notInsurable' };
    const result = purchaseOrExtendInsurance(this, m, length);
    if (!result.bought && !result.extended) return { ok: false, reason: 'funds', data: { cost: result.cost, length } };
    return { ok: true, data: { length, cost: result.cost, insuredDays: m.contract.totalLengthOfInsuranceContract } };
  }

  #orderFlowers(cmd: Command): CommandResult {
    const order: FlowerOrder = {
      bouquet: isInt(cmd.bouquet) ? cmd.bouquet : -1,
      destination: isInt(cmd.destination) ? cmd.destination : -1,
      nextDay: cmd.nextDay === true,
      extras: Array.isArray(cmd.extras) ? cmd.extras.map(String) : [],
    };
    const result = orderFlowers(this, order, {
      flowersMeanwhile: (code) => this.campaign.scheduleFlowersMeanwhile(code),
    });
    return typeof result === 'string' ? { ok: false, reason: result } : { ok: true, data: result };
  }

  #query(cmd: Command): CommandResult {
    switch (cmd.type) {
      case 'aimQuote':
        return this.#aimQuote(cmd);
      case 'hireCheck': {
        const check = isInt(cmd.profile) ? aimHireCheck(this, cmd.profile) : null;
        return check ? { ok: true, data: check } : { ok: false, reason: 'notAimMerc' };
      }
      case 'bobbyRayQuote': {
        const request = this.#orderRequest(cmd, true);
        if (!request) return { ok: false, reason: 'lines and speed are required' };
        const quote = quoteOrderForm(this, request);
        return typeof quote === 'string' ? { ok: false, reason: quote } : { ok: true, data: quote };
      }
      case 'impCheckCode':
        return { ok: true, data: { result: impCheckCode(this, typeof cmd.code === 'string' ? cmd.code : '') } };
      case 'insuranceQuote': {
        const m = isInt(cmd.soldier) ? this.roster.get(cmd.soldier) : undefined;
        const p = m ? this.profile(m.profile) : null;
        if (!m || !p || !isInsurable(this, m)) return { ok: false, reason: 'notInsurable' };
        const length = insuranceLength(this, m);
        return { ok: true, data: { length, cost: insurancePremium(this, length, m, p), insured: m.contract.lifeInsurance !== 0 } };
      }
      case 'impPreview': {
        const answers = Array.isArray(cmd.answers) ? cmd.answers.map(Number) : [];
        return { ok: true, data: impPreview(this, answers, cmd.gender !== 'female') };
      }
      default: {
        const minute = mercArrivalTimeOfDay(this.now());
        return { ok: true, data: { minute, sector: sectorShortString(sectorFromId(this.laptop.mercArriveSector)) } };
      }
    }
  }

  #aimQuote(cmd: Command): CommandResult {
    if (!isInt(cmd.profile) || !isAimMerc(this, cmd.profile)) return { ok: false, reason: 'notAimMerc' };
    const p = this.profile(cmd.profile) as ProfileProgress;
    const contract = isInt(cmd.contract) ? cmd.contract : 7;
    if (!(AIM_CONTRACT_LENGTHS as readonly number[]).includes(contract)) return { ok: false, reason: 'badContract' };
    const gear = typeof cmd.gear === 'boolean' ? cmd.gear : defaultGear(p);
    const charge = aimCharge(p, contract, gear);
    return {
      ok: true,
      data: { charge, withGear: gear, contract, contact: aimContact(p), affordable: this.state.finances.balance >= charge.total },
    };
  }
}

const BATTLE_HISTORY: Readonly<Record<number, readonly [number, number]>> = {
  [EncounterCode.ENEMY_INVASION]: [History.DEFENDEDTOWNSECTOR, History.LOSTTOWNSECTOR],
  [EncounterCode.ENEMY_ENCOUNTER]: [History.WONBATTLE, History.LOSTBATTLE],
  [EncounterCode.ENEMY_AMBUSH]: [History.WIPEDOUTENEMYAMBUSH, History.FATALAMBUSH],
  [EncounterCode.ENTERING_ENEMY_SECTOR]: [History.SUCCESSFULATTACK, History.UNSUCCESSFULATTACK],
  [EncounterCode.CREATURE_ATTACK]: [History.CREATURESATTACKED, History.CREATURESATTACKED],
  [EncounterCode.BLOODCAT_AMBUSH]: [History.SLAUGHTEREDBLOODCATS, History.KILLEDBYBLOODCATS],
  [EncounterCode.ENTERING_BLOODCAT_LAIR]: [History.SLAUGHTEREDBLOODCATS, History.KILLEDBYBLOODCATS],
};

function battleHistoryCode(victory: boolean, encounter: number): number | null {
  const codes = BATTLE_HISTORY[encounter];
  return codes ? codes[victory ? 0 : 1] : null;
}

const LARRY_DRUNK_INDEX = SpecialProfile.LARRY_DRUNK - SpecialProfile.BIFF;

function mercMercMailIndex(profile: number): number {
  const index = profile - SpecialProfile.BIFF;
  return index >= LARRY_DRUNK_INDEX ? index - 1 : index;
}

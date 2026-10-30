import { ItemClass } from '../content/items/items.ts';
import { MercType } from '../content/strategic/economy-content.ts';
import { sectorFromId, sectorShortString } from '../content/strategic/sector-ids.ts';
import type { UiStrings } from '../content/text/strings.ts';
import { idiv } from '../core/int.ts';
import type {
  AimMercView,
  BobbyRayCatalogue,
  BobbyRayShipmentView,
  BobbyRayView,
  ImpGenderListsView,
  ImpSiteView,
  InsuranceOfferView,
  InTransitView,
  LaptopItemView,
  LaptopStatsView,
  LaptopTimeView,
  LaptopView,
  MercSiteView,
} from '../protocol/view.ts';
import type { CampaignSim } from '../sim/campaign/campaign-sim.ts';
import { mercAccountStatusName } from '../sim/campaign/contracts/merc-account.ts';
import { financeSummary } from '../sim/campaign/finance-summary.ts';
import { aimContact, aimFace, aimMessageLeft, contractSalary } from '../sim/campaign/laptop/aim.ts';
import { bobbyRayItemPrice, bobbyRayUnitPrice, shippingCost } from '../sim/campaign/laptop/bobby-ray.ts';
import {
  COST_OF_PROFILE,
  canCreateAnotherImpCharacter,
  IMP_ATTRIBUTE_PAGE_ORDER,
  IMP_ZEROABLE_ATTRIBUTES,
  impBeginRefusal,
  impCharactersCreated,
  START_ATTRIBUTE,
} from '../sim/campaign/laptop/imp.ts';
import { contractDaysLeft, insuranceDaysLeft, insuranceLength, insurancePremium, isInsurable } from '../sim/campaign/laptop/insurance.ts';
import type { LaptopFlow } from '../sim/campaign/laptop/laptop-flow.ts';
import { Bookmark, bookmarkNames, type Shipment, type StoreSlot } from '../sim/campaign/laptop/laptop-state.ts';
import { mailType } from '../sim/campaign/laptop/mail.ts';
import {
  advertiseQuote,
  floMarried,
  isMercListed,
  isMercSiteDown,
  listingProfile,
  mercAccountRows,
  mercSiteSlowLoad,
  owedToSpeck,
} from '../sim/campaign/laptop/merc-site.ts';
import { isMercDead } from '../sim/campaign/laptop/profile-state.ts';
import { MercKind } from '../sim/campaign/roster.ts';
import { Assignment } from '../sim/strategic/economy/constants.ts';
import { predictIncomeFromPlayerMines } from '../sim/strategic/economy/mines.ts';
import { NUM_MIN_IN_DAY, NUM_MIN_IN_HOUR } from '../sim/strategic/time/constants.ts';
import type { ProfileProgress } from '../sim/tactical/profiles.ts';
import type { TextSource } from './campaign-session.ts';
import { financeRowText } from './finance-labels.ts';
import { historyRowView } from './history-labels.ts';
import { mailSubject } from './mail-text.ts';
import { personnelCurrent, personnelDeparted } from './personnel-view.ts';

export interface LaptopViewText {
  readonly texts: TextSource | null;
  readonly labels: UiStrings | null;
}

const NO_TEXT: LaptopViewText = { texts: null, labels: null };
const NO_ITEM = 0;
const AIM_PROFILES = 40;
const BOBBY_GUNS = ItemClass.GUN | ItemClass.LAUNCHER;
const BOBBY_MISC =
  ItemClass.GRENADE |
  ItemClass.BOMB |
  ItemClass.MISC |
  ItemClass.MEDKIT |
  ItemClass.KIT |
  ItemClass.BLADE |
  ItemClass.THROWING_KNIFE |
  ItemClass.PUNCH |
  ItemClass.FACE;

function time(minutes: number): LaptopTimeView {
  const day = idiv(minutes, NUM_MIN_IN_DAY);
  const inDay = minutes - day * NUM_MIN_IN_DAY;
  return { day, hour: idiv(inDay, NUM_MIN_IN_HOUR), minute: inDay % NUM_MIN_IN_HOUR };
}

function stats(p: ProfileProgress): LaptopStatsView {
  const s = p.stats;
  return {
    health: s.lifeMax,
    agility: s.agility,
    dexterity: s.dexterity,
    strength: s.strength,
    leadership: s.leadership,
    wisdom: s.wisdom,
    experience: s.experience,
    marksmanship: s.marksmanship,
    mechanical: s.mechanical,
    explosives: s.explosives,
    medical: s.medical,
  };
}

function itemName(flow: LaptopFlow, item: number): string {
  return flow.tactical.items.byIndex.get(item)?.name ?? String(item);
}

function kit(flow: LaptopFlow, p: ProfileProgress): { readonly items: readonly LaptopItemView[]; readonly cost: number } | null {
  if (p.optionalGearCost === 0) return null;
  const items = p.inventory.flatMap((item, slot) =>
    item === NO_ITEM ? [] : [{ item, name: itemName(flow, item), count: p.inventoryCount[slot] ?? 1 }],
  );
  return { items, cost: p.optionalGearCost };
}

export interface AimListingSource {
  readonly aimListings: readonly number[];
  mercType(id: number): number | undefined;
}

export function aimListingOrder(source: AimListingSource): number[] {
  const isAim = (id: number) => source.mercType(id) === MercType.AIM;
  const listed = source.aimListings.filter(isAim);
  const rest = Array.from({ length: AIM_PROFILES }, (_, id) => id).filter((id) => isAim(id) && !listed.includes(id));
  return [...new Set(listed), ...rest];
}

function aimView(flow: LaptopFlow): AimMercView[] {
  const out: AimMercView[] = [];
  for (const id of aimListingOrder({ aimListings: flow.content.aimListings, mercType: (id) => flow.mercType(id) })) {
    const p = flow.profile(id);
    const record = flow.profileRecord(id);
    if (!p || !record) continue;
    out.push({
      profile: id,
      name: record.name,
      nickname: record.nickname,
      stats: stats(p),
      salary: { day: contractSalary(p, 1), week: contractSalary(p, 7), twoWeeks: contractSalary(p, 14) },
      medicalDeposit: p.medicalDeposit ? p.medicalDepositAmount : null,
      kit: kit(flow, p),
      face: aimFace(flow, id, p),
      contact: aimContact(p),
      messageLeft: aimMessageLeft(p),
    });
  }
  return out;
}

function mercView(flow: LaptopFlow): MercSiteView {
  const merc = flow.laptop.merc;
  const bookmarked = flow.laptop.bookmarks.includes(Bookmark.MERC);
  const listed = flow.content.mercListings.flatMap((listing) => {
    if (!bookmarked || !isMercListed(flow, listing)) return [];
    const id = listingProfile(flow, listing);
    const p = flow.profile(id);
    const record = flow.profileRecord(id);
    if (!p || !record) return [];
    return [
      {
        profile: id,
        name: record.name,
        nickname: record.nickname,
        stats: stats(p),
        dailyFee: p.salary,
        state: aimFace(flow, id, p),
        unpaidDays: p.mercMercContractLength,
        owed: p.salary * p.mercMercContractLength,
        advertiseQuote: advertiseQuote(listing),
        married: floMarried(flow, id),
      },
    ];
  });
  const account = bookmarked ? mercAccountRows(flow).map((row) => ({ ...row, name: flow.profileRecord(row.profile)?.name ?? '' })) : [];
  return {
    bookmarked,
    siteDown: isMercSiteDown(flow),
    accountStatus: mercAccountStatusName(merc.accountStatus),
    accountNumber: merc.accountStatus === 0 ? null : merc.accountNumber,
    listed,
    totalOwed: owedToSpeck(flow),
    account,
    slowLoad: mercSiteSlowLoad(flow),
  };
}

function catalogueOf(flow: LaptopFlow, item: number, used: boolean): BobbyRayCatalogue | null {
  if (used) return 'used';
  const itemClass = flow.tactical.items.byIndex.get(item)?.itemClass ?? 0;
  if (itemClass & BOBBY_GUNS) return 'guns';
  if (itemClass & ItemClass.AMMO) return 'ammo';
  if (itemClass & ItemClass.ARMOUR) return 'armour';
  if (itemClass & BOBBY_MISC) return 'misc';
  return null;
}

function stockView(flow: LaptopFlow, slots: readonly StoreSlot[], used: boolean): BobbyRayView['newStock'] {
  return slots.flatMap((s, slot) =>
    s.onHand > 0
      ? [
          {
            item: s.item,
            name: itemName(flow, s.item),
            price: bobbyRayUnitPrice(flow, s, used),
            quantity: s.onHand,
            quality: used ? s.quality : 100,
            slot,
            catalogue: catalogueOf(flow, s.item, used),
          },
        ]
      : [],
  );
}

function shipmentView(flow: LaptopFlow, s: Shipment, index: number): BobbyRayShipmentView {
  const lines = s.displayedOnShipmentsPage
    ? s.lines.map((l) => ({
        item: l.item,
        name: itemName(flow, l.item),
        count: l.count,
        used: l.used,
        quality: l.quality,
        unitPrice: bobbyRayItemPrice(flow, l.item, l.quality, l.used),
      }))
    : [];
  const subtotal = lines.reduce((sum, l) => sum + l.unitPrice * l.count, 0);
  const shipping = s.displayedOnShipmentsPage ? shippingCost(flow.content.destinations[s.destination], s.speed, s.weight) : 0;
  return {
    index,
    active: s.active,
    displayed: s.displayedOnShipmentsPage,
    destination: s.destination,
    speed: s.speed,
    orderDay: s.orderDay,
    units: s.lines.reduce((n, l) => n + l.count, 0),
    weight: s.weight,
    lines,
    subtotal,
    shipping,
    total: subtotal + shipping,
  };
}

function bobbyRayView(flow: LaptopFlow): BobbyRayView {
  const br = flow.laptop.bobbyRay;
  return {
    open: br.siteCanBeAccessed,
    newStock: br.siteCanBeAccessed ? stockView(flow, br.inventory, false) : [],
    usedStock: br.siteCanBeAccessed ? stockView(flow, br.used, true) : [],
    shipments: br.shipments.map((s, index) => shipmentView(flow, s, index)),
    destinations: flow.content.destinations.map((d, id) => ({
      id,
      name: d.internalName,
      rates: d.rates,
      flowers: { nextDay: d.flowersNextDayCost, whenItGetsThere: d.flowersWhenItGetsThereCost },
      canDeliver: d.canDeliver,
      primary: d.isPrimary,
    })),
  };
}

function genderLists<T extends { readonly male: boolean }>(entries: readonly T[], value: (e: T) => number): ImpGenderListsView {
  return { male: entries.filter((e) => e.male).map(value), female: entries.filter((e) => !e.male).map(value) };
}

function impView(flow: LaptopFlow): ImpSiteView {
  const imp = flow.content.imp;
  return {
    bookmarked: flow.laptop.bookmarks.includes(Bookmark.IMP),
    charactersLeft: Math.max(0, imp.maxCharacters - impCharactersCreated(flow)),
    canCreate: canCreateAnotherImpCharacter(flow),
    cost: COST_OF_PROFILE,
    pickSkillsDirectly: imp.pickSkillsDirectly,
    beginRefusal: impBeginRefusal(flow),
    attributes: {
      start: START_ATTRIBUTE,
      min: imp.minAttributePoints,
      max: imp.maxAttributePoints,
      bonus: imp.bonusAttributePoints,
      zeroBonus: imp.zeroAttributePointsBonus,
      order: IMP_ATTRIBUTE_PAGE_ORDER,
      zeroable: IMP_ZEROABLE_ATTRIBUTES,
    },
    portraits: genderLists(imp.portraits, (p) => p.face),
    voices: genderLists(imp.voices, (v) => v.profile),
    quizAnswers: flow.content.impQuiz.map((question) => question.length),
  };
}

function insuranceView(flow: LaptopFlow): InsuranceOfferView[] {
  return flow.team().flatMap((m) => {
    const p = flow.profile(m.profile);
    if (!p || !isInsurable(flow, m)) return [];
    const length = insuranceLength(flow, m);
    return [
      {
        soldier: m.id,
        profile: m.profile,
        name: m.soldier.name,
        contractDaysLeft: contractDaysLeft(flow, m),
        insuredDaysLeft: insuranceDaysLeft(flow, m),
        insured: m.contract.lifeInsurance !== 0,
        offeredLength: length,
        premium: insurancePremium(flow, length, m, p),
        nickname: flow.profileRecord(m.profile)?.nickname ?? m.soldier.name,
        dead: isMercDead(p),
        contractLength: m.contract.totalContractLength,
      },
    ];
  });
}

function aimMercsOnTeam(flow: LaptopFlow): boolean {
  return flow.team().some((m) => m.kind === MercKind.AIM_MERC);
}

function inTransitView(flow: LaptopFlow): InTransitView[] {
  return flow
    .team()
    .filter((m) => m.assignment === Assignment.IN_TRANSIT)
    .map((m) => ({
      soldier: m.id,
      profile: m.profile,
      name: m.soldier.name,
      arrival: time(m.contract.timeWillArrive),
      sector: sectorShortString(m.sector),
    }));
}

export function laptopView(campaign: CampaignSim, text: LaptopViewText = NO_TEXT): LaptopView | null {
  const flow = campaign.laptop;
  if (!flow?.isOpen()) return null;
  const l = flow.laptop;
  const f = campaign.state.finances;
  const projectedIncome = campaign.economy ? predictIncomeFromPlayerMines(campaign.economy) : 0;
  return {
    balance: f.balance,
    newMail: l.newMail,
    bookmarks: bookmarkNames(l),
    emails: l.emails.map((m) => ({
      id: m.id,
      ...mailType(flow.content, m.offset),
      offset: m.offset,
      length: m.length,
      subject: mailSubject(campaign, m, text.texts),
      sender: m.sender,
      date: time(m.date),
      read: m.read,
      firstData: m.firstData,
      secondData: m.secondData,
    })),
    history: l.history.map((h) => historyRowView(campaign, text, h, time(h.date))),
    finances: f.ledger.map((r) => ({
      code: r.code,
      secondCode: r.secondCode,
      date: time(r.minute),
      amount: r.amount,
      balanceAfter: r.balanceAfter,
      text: financeRowText(campaign, text.labels, r.code, r.secondCode),
    })),
    financeSummary: financeSummary(f.ledger, flow.now(), f.balance, projectedIncome),
    files: l.files.map((file) => ({ code: file.code, read: file.read })),
    personnel: {
      dead: l.personnel.dead.filter((p) => p >= 0),
      left: l.personnel.left.filter((p) => p >= 0),
      other: l.personnel.other.filter((p) => p >= 0),
      current: personnelCurrent(flow),
      departed: personnelDeparted(flow),
    },
    aim: aimView(flow),
    merc: mercView(flow),
    imp: impView(flow),
    bobbyRay: bobbyRayView(flow),
    insurance: insuranceView(flow),
    inTransit: inTransitView(flow),
    landingZone: sectorShortString(sectorFromId(l.mercArriveSector)),
    aimMercsOnTeam: aimMercsOnTeam(flow),
    florist: { orderNumber: l.floristOrderNumber, bouquetPrices: flow.content.bouquetPrices },
  };
}

export function laptopSummary(campaign: CampaignSim): {
  readonly landingZone?: string;
  readonly unreadMail?: number;
  readonly newMail?: boolean;
} {
  const flow = campaign.laptop;
  if (!flow) return {};
  const l = flow.laptop;
  return {
    landingZone: sectorShortString(sectorFromId(l.mercArriveSector)),
    unreadMail: l.emails.filter((m) => !m.read).length,
    newMail: l.newMail,
  };
}

export function arrivalTime(campaign: CampaignSim, id: number): LaptopTimeView | null {
  const m = campaign.laptop?.roster.get(id);
  return m && m.assignment === Assignment.IN_TRANSIT ? time(m.contract.timeWillArrive) : null;
}

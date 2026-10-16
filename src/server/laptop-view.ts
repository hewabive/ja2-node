import { MercType } from '../content/strategic/economy-content.ts';
import { sectorFromId, sectorShortString } from '../content/strategic/sector-ids.ts';
import type {
  AimMercView,
  BobbyRayView,
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
import { aimFace, contractSalary } from '../sim/campaign/laptop/aim.ts';
import { bobbyRayUnitPrice } from '../sim/campaign/laptop/bobby-ray.ts';
import { COST_OF_PROFILE, canCreateAnotherImpCharacter, impCharactersCreated } from '../sim/campaign/laptop/imp.ts';
import { contractDaysLeft, insuranceDaysLeft, insuranceLength, insurancePremium, isInsurable } from '../sim/campaign/laptop/insurance.ts';
import type { LaptopFlow } from '../sim/campaign/laptop/laptop-flow.ts';
import { Bookmark, type StoreSlot } from '../sim/campaign/laptop/laptop-state.ts';
import { mailType } from '../sim/campaign/laptop/mail.ts';
import { isMercListed, isMercSiteDown, listingProfile, owedToSpeck } from '../sim/campaign/laptop/merc-site.ts';
import { Assignment } from '../sim/strategic/economy/constants.ts';
import { NUM_MIN_IN_DAY, NUM_MIN_IN_HOUR } from '../sim/strategic/time/constants.ts';
import type { ProfileProgress } from '../sim/tactical/profiles.ts';

const BOOKMARK_NAMES: Readonly<Record<number, string>> = {
  [Bookmark.AIM]: 'aim',
  [Bookmark.BOBBYR]: 'bobbyRay',
  [Bookmark.IMP]: 'imp',
  [Bookmark.MERC]: 'merc',
  [Bookmark.FUNERAL]: 'funeral',
  [Bookmark.FLORIST]: 'florist',
  [Bookmark.INSURANCE]: 'insurance',
};
const NO_ITEM = 0;
const AIM_PROFILES = 40;

function time(minutes: number): LaptopTimeView {
  const day = Math.trunc(minutes / NUM_MIN_IN_DAY);
  const inDay = minutes - day * NUM_MIN_IN_DAY;
  return { day, hour: Math.trunc(inDay / NUM_MIN_IN_HOUR), minute: inDay % NUM_MIN_IN_HOUR };
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

function aimView(flow: LaptopFlow): AimMercView[] {
  const out: AimMercView[] = [];
  for (let id = 0; id < AIM_PROFILES; id++) {
    if (flow.mercType(id) !== MercType.AIM) continue;
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
      },
    ];
  });
  return {
    bookmarked,
    siteDown: isMercSiteDown(flow),
    accountStatus: mercAccountStatusName(merc.accountStatus),
    accountNumber: merc.accountStatus === 0 ? null : merc.accountNumber,
    listed,
    totalOwed: owedToSpeck(flow),
  };
}

function stockView(flow: LaptopFlow, slots: readonly StoreSlot[], used: boolean): BobbyRayView['newStock'] {
  return slots
    .filter((s) => s.onHand > 0)
    .map((s) => ({
      item: s.item,
      name: itemName(flow, s.item),
      price: bobbyRayUnitPrice(flow, s, used),
      quantity: s.onHand,
      quality: used ? s.quality : 100,
    }));
}

function bobbyRayView(flow: LaptopFlow): BobbyRayView {
  const br = flow.laptop.bobbyRay;
  return {
    open: br.siteCanBeAccessed,
    newStock: br.siteCanBeAccessed ? stockView(flow, br.inventory, false) : [],
    usedStock: br.siteCanBeAccessed ? stockView(flow, br.used, true) : [],
    shipments: br.shipments.flatMap((s, index) =>
      s.displayedOnShipmentsPage
        ? [
            {
              index,
              active: s.active,
              destination: s.destination,
              speed: s.speed,
              orderDay: s.orderDay,
              lines: s.lines.map((l) => ({ item: l.item, name: itemName(flow, l.item), count: l.count, used: l.used })),
            },
          ]
        : [],
    ),
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
      },
    ];
  });
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

export function laptopView(campaign: CampaignSim): LaptopView | null {
  const flow = campaign.laptop;
  if (!flow?.isOpen()) return null;
  const l = flow.laptop;
  const f = campaign.state.finances;
  const imp = flow.content.imp;
  return {
    balance: f.balance,
    bookmarks: l.bookmarks.map((b) => BOOKMARK_NAMES[b] ?? String(b)),
    emails: l.emails.map((m) => ({
      id: m.id,
      ...mailType(flow.content, m.offset),
      sender: m.sender,
      date: time(m.date),
      read: m.read,
      firstData: m.firstData,
      secondData: m.secondData,
    })),
    history: l.history.map((h) => ({
      code: h.code,
      secondCode: h.secondCode,
      date: time(h.date),
      sector: h.x >= 1 && h.y >= 1 ? sectorShortString(h) : null,
    })),
    finances: f.ledger.map((r) => ({
      code: r.code,
      secondCode: r.secondCode,
      date: time(r.minute),
      amount: r.amount,
      balanceAfter: r.balanceAfter,
    })),
    files: l.files.map((file) => ({ code: file.code, read: file.read })),
    personnel: {
      dead: l.personnel.dead.filter((p) => p >= 0),
      left: l.personnel.left.filter((p) => p >= 0),
      other: l.personnel.other.filter((p) => p >= 0),
    },
    aim: aimView(flow),
    merc: mercView(flow),
    imp: {
      bookmarked: l.bookmarks.includes(Bookmark.IMP),
      charactersLeft: Math.max(0, imp.maxCharacters - impCharactersCreated(flow)),
      canCreate: canCreateAnotherImpCharacter(flow),
      cost: COST_OF_PROFILE,
      pickSkillsDirectly: imp.pickSkillsDirectly,
    },
    bobbyRay: bobbyRayView(flow),
    insurance: insuranceView(flow),
    inTransit: inTransitView(flow),
    landingZone: sectorShortString(sectorFromId(l.mercArriveSector)),
  };
}

export function laptopSummary(campaign: CampaignSim): { readonly landingZone?: string; readonly unreadMail?: number } {
  const flow = campaign.laptop;
  if (!flow) return {};
  const l = flow.laptop;
  return {
    landingZone: sectorShortString(sectorFromId(l.mercArriveSector)),
    unreadMail: l.emails.filter((m) => !m.read).length,
  };
}

export function arrivalTime(campaign: CampaignSim, id: number): LaptopTimeView | null {
  const m = campaign.laptop?.roster.get(id);
  return m && m.assignment === Assignment.IN_TRANSIT ? time(m.contract.timeWillArrive) : null;
}

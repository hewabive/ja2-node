// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-16. See LICENSE (SFI-SCLA).
// @src src/game/Strategic/Strategic_Event_Handler.cc HandleNPCSystemEvent, CheckForKingpinsMoneyMissing,
// @src CheckForMissingHospitalSupplies, HandleDelayedItemsArrival (the loaded and unloaded delivery sector);
// @src Tactical/Interface_Dialogue.cc CalcMedicalCost; Tactical/Handle_Items.cc MoveItemPools.

import { sameSector, sectorFromId } from '../../../content/strategic/sector-ids.ts';
import { pythSpacesAway } from '../../../content/world/grid.ts';
import { u8, u32 } from '../../../core/int.ts';
import { createItem, createItems } from '../../items/object.ts';
import { Assignment } from '../../strategic/economy/constants.ts';
import { setCivGroupHostility } from '../../strategic/narrative/civ-groups.ts';
import { questStatus } from '../../strategic/narrative/facts.ts';
import {
  calcMedicalCost,
  checkForMissingHospitalSupplies,
  HOSPITAL_PATIENT_DISTANCE,
  type HospitalPatient,
  MEDICAL_SUPPLY_ITEMS,
  SUPPLIES_FULL_STATUS,
} from '../../strategic/narrative/hospital.ts';
import { checkForKingpinsMoneyMissing, type KingpinMoneyContext } from '../../strategic/narrative/kingpin.ts';
import {
  type DeliveryWorld,
  handleNpcSystemEvent,
  type NpcSystemEventContext,
  PABLOS_STOLEN_DEST_GRIDNO,
  type StolenGood,
} from '../../strategic/narrative/npc-events.ts';
import { Npc } from '../../strategic/narrative/npc-ids.ts';
import type { SectorPosition } from '../../strategic/state.ts';
import { EventKind } from '../../strategic/time/constants.ts';
import { addFutureDayStrategicEvent, addSameDayStrategicEvent } from '../../strategic/time/event-queue.ts';
import { worldMinutesInDay } from '../../strategic/time/world-clock.ts';
import { CivGroupHostility } from '../../tactical/narrative/constants.ts';
import { CivilianGroup, Team } from '../../tactical/soldier.ts';
import type { TacticalState } from '../../tactical/state.ts';
import { addItemToPool, itemsAt, removeWorldItem, Visibility } from '../../tactical/world-items.ts';
import type { CampaignSim } from '../campaign-sim.ts';
import { mailSpec, sender } from '../laptop/mail.ts';
import { sectorKey } from '../sector-diff.ts';
import { addItemsToUnloadedSector } from '../sector-loot.ts';

export interface Delivery {
  readonly sector: SectorPosition;
  readonly gridNo: number;
}

function loadedTactical(campaign: CampaignSim): TacticalState | null {
  return campaign.tactical?.state ?? null;
}

export function addNpcEventTomorrow(campaign: CampaignSim, minuteOfDay: number, param: number, days: number): void {
  const s = campaign.state;
  addFutureDayStrategicEvent(s.queue, s.clock, EventKind.SET_BY_NPC_SYSTEM, minuteOfDay, param, days);
}

export function addNpcEventToday(campaign: CampaignSim, minuteOfDay: number, param: number): void {
  const s = campaign.state;
  addSameDayStrategicEvent(s.queue, s.clock, EventKind.SET_BY_NPC_SYSTEM, minuteOfDay, param);
}

export function medicalCostAt(campaign: CampaignSim, doctor: number): number {
  const t = loadedTactical(campaign);
  const npc = t?.soldiers.find((s) => s?.placed && s.profile === doctor) ?? null;
  if (!t || !npc) return 0;
  const roster = campaign.battle?.roster;
  const patients: HospitalPatient[] = [];
  for (const s of t.soldiers) {
    if (!s?.placed || s.team !== Team.OUR || s.life <= 0 || s.life >= s.lifeMax) continue;
    const merc = roster?.get(s.id);
    if (merc?.assignment === Assignment.ASSIGNMENT_HOSPITAL) continue;
    if (pythSpacesAway(npc.gridNo, s.gridNo) > HOSPITAL_PATIENT_DISTANCE) continue;
    patients.push({ life: s.life, lifeMax: s.lifeMax, bleeding: s.bleeding, hospitalPriceModifier: merc?.hospitalPriceModifier ?? 0 });
  }
  return calcMedicalCost(patients, campaign.state.narrative.hospital.priceModifier);
}

export function countHospitalSupplies(t: TacticalState): number {
  const items = t.content.items;
  const id = (name: string) => items.byName.get(name)?.index ?? -1;
  const ownership = id('OWNERSHIP');
  const medical = new Set(MEDICAL_SUPPLY_ITEMS.map(id));
  let count = 0;
  for (const marker of t.worldItems) {
    if (marker.object.item !== ownership || marker.object.gunAmmoType !== CivilianGroup.DOCTORS) continue;
    for (const wi of itemsAt(t, marker.gridNo, 0)) {
      if ((wi.object.status[0] ?? 0) > SUPPLIES_FULL_STATUS && medical.has(wi.object.item)) count = u8(count + 1);
    }
  }
  return count;
}

export function hospitalSuppliesCheck(campaign: CampaignSim): void {
  const t = loadedTactical(campaign);
  const narrative = campaign.narrative;
  const facts = {
    checkFact: (id: number) => narrative.checkFact(id, 0),
    setFactTrue: (id: number) => narrative.setFactTrue(id),
    setFactFalse: (id: number) => narrative.setFactFalse(id),
  };
  checkForMissingHospitalSupplies(facts, campaign.state.narrative.cambriaMedicalObjects, t ? countHospitalSupplies(t) : 0);
}

function worldMoney(campaign: CampaignSim) {
  const t = loadedTactical(campaign);
  const item = t?.content.items.byName.get('MONEY')?.index;
  return t && item !== undefined ? t.worldItems.filter((wi) => wi.object.item === item) : [];
}

function kingpinContext(campaign: CampaignSim): KingpinMoneyContext {
  const s = campaign.state;
  const narrative = campaign.narrative;
  return {
    worldMoney: () => worldMoney(campaign).reduce((sum, wi) => u32(sum + wi.object.money), 0),
    removeAllWorldMoney: () => {
      const t = loadedTactical(campaign);
      if (t) for (const wi of worldMoney(campaign)) removeWorldItem(t, wi);
    },
    checkFact: (id) => narrative.checkFact(id, 0),
    setFactTrue: (id) => narrative.setFactTrue(id),
    history: (code, sector) => narrative.history(code, 0, sector),
    worldSector: () => s.worldSector,
    addFutureDayNpcEvent: (minute, param, days) => addNpcEventTomorrow(campaign, minute, param, days),
    random: (n) => s.rng.int(n),
    kingpin: () => narrative.profile(Npc.KINGPIN),
  };
}

export function kingpinMoneyCheck(campaign: CampaignSim, firstCheck: boolean): void {
  checkForKingpinsMoneyMissing(kingpinContext(campaign), firstCheck);
}

function mail(campaign: CampaignSim, name: string, from: string): void {
  const laptop = campaign.laptop;
  if (laptop) laptop.mail(mailSpec(laptop.content, name), sender(laptop.content, from));
}

export function primaryDelivery(campaign: CampaignSim): Delivery | null {
  const primary = campaign.laptop?.content.destinations.find((d) => d.isPrimary);
  if (primary?.deliverySector === null || primary?.deliverySector === undefined) return null;
  return { sector: sectorFromId(primary.deliverySector, primary.deliverySectorZ), gridNo: primary.gridNo };
}

function deliveryWorld(campaign: CampaignSim): DeliveryWorld {
  const s = campaign.state;
  return {
    deliverySectorLoaded: () => {
      const d = primaryDelivery(campaign);
      return d !== null && s.worldSector !== null && sameSector(s.worldSector, d.sector) && loadedTactical(campaign) !== null;
    },
    addHiddenAtDelivery: (good: StolenGood, loaded: boolean) => {
      const d = primaryDelivery(campaign);
      const items = campaign.battle?.content.items ?? loadedTactical(campaign)?.content.items;
      const item = items?.byName.get(good.item)?.index;
      if (!d || !items || item === undefined) return;
      const o = good.count > 1 ? createItems(items, item, good.status, good.count) : createItem(items, item, good.status);
      const t = loadedTactical(campaign);
      if (loaded && t) addItemToPool(t, d.gridNo, o, Visibility.INVISIBLE, 0, 0, 0);
      else addItemsToUnloadedSector(s, d.sector, d.gridNo, [o], 0, 0, Visibility.INVISIBLE);
    },
    moveLoadedPool: (from) => {
      const d = primaryDelivery(campaign);
      const t = loadedTactical(campaign);
      if (!d || !t) return;
      for (const wi of itemsAt(t, from, 0)) {
        removeWorldItem(t, wi);
        addItemToPool(t, d.gridNo, wi.object, Visibility.INVISIBLE, wi.level, wi.flags, wi.zHeight);
      }
    },
    moveUnloadedItemsAtStolenGridNo: () => {
      const d = primaryDelivery(campaign);
      const items = d ? s.sectorDiffs.get(sectorKey(d.sector))?.items : null;
      if (!d || !items) return;
      items.forEach((wi, k) => {
        if (wi.gridNo === PABLOS_STOLEN_DEST_GRIDNO) items[k] = { ...wi, gridNo: d.gridNo };
      });
    },
  };
}

function systemEventContext(campaign: CampaignSim): NpcSystemEventContext {
  const s = campaign.state;
  const narrative = campaign.narrative;
  return {
    checkFact: (id, npc = 0) => narrative.checkFact(id, npc),
    setFactTrue: (id) => narrative.setFactTrue(id),
    setFactFalse: (id) => narrative.setFactFalse(id),
    questStatus: (quest) => questStatus(s.narrative, quest),
    startQuest: (quest, sector) => narrative.startQuest(quest, sector),
    endQuest: (quest, sector) => narrative.endQuest(quest, sector),
    profile: (id) => narrative.profile(id),
    minutesInDay: () => worldMinutesInDay(s.clock),
    addFutureDayNpcEvent: (minute, param, days) => addNpcEventTomorrow(campaign, minute, param, days),
    addSameDayNpcEvent: (minute, param) => addNpcEventToday(campaign, minute, param),
    random: (n) => s.rng.int(n),
    kingpinMoneyCheck: (first) => kingpinMoneyCheck(campaign, first),
    kingpinLetter: () => mail(campaign, 'KING_PIN_LETTER', 'KING_PIN'),
    enricoMiguelEmail: () => mail(campaign, 'ENRICO_MIGUEL', 'MAIL_ENRICO'),
    kingpinGroupWillBecomeHostile: () => setCivGroupHostility(s.civGroups, CivilianGroup.KINGPIN, CivGroupHostility.WILL_BECOME_HOSTILE),
    handleNpcDoAction: (npc, code, record) => {
      campaign.talk?.npcActions.handle(npc, code, record);
    },
    soldierInLoadedSector: (profile) => loadedTactical(campaign)?.soldiers.some((x) => x?.placed && x.profile === profile) ?? false,
    delivery: deliveryWorld(campaign),
  };
}

export function npcSystemEvent(campaign: CampaignSim, param: number): void {
  handleNpcSystemEvent(systemEventContext(campaign), param);
}

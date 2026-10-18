// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-16. See LICENSE (SFI-SCLA).
// @src src/game/Tactical/Soldier_Profile.cc RecruitRPC, RecruitEPC, UnRecruitEPC, ChangeSoldierTeam (the team bookkeeping),
// @src FindSoldierByProfileID; Tactical/Soldier_Create.cc InternalTacticalRemoveSoldier (RemoveCharacterFromSquads,
// @src RemovePlayerFromTeamSlot); Tactical/Interface_Dialogue.cc HandleStuffForNPCEscorted, NPC_ACTION_REMOVE_MERC_FOR_MARRIAGE
// @src (the team change); TacticalAI/NPC.cc UpdateDarrelScriptToGoTo, GetInfoForAbandoningEPC; Tactical/Soldier_Add.cc
// @src FindGridNoFromSweetSpotExcludingSweetSpot; Strategic/Assignments.cc InternalUnescortEPC, UnEscortEPC; Laptop/Personnel.cc
// @src AddCharacterToOtherList, RemoveNewlyHiredMercFromPersonnelDepartedList; Strategic/Strategic_Town_Loyalty.cc
// @src HandleTownLoyaltyForNPCRecruitment. See docs/24 §9, docs/25 §9.

import { isTwoHanded, WEAPON_CLASSES } from '../../../content/items/items.ts';
import { Approach } from '../../../content/narrative/npc-constants.ts';
import type { Sector } from '../../../content/strategic/sector-ids.ts';
import { swapObjects } from '../../items/object.ts';
import { deleteTalkingMenu, getInfoForAbandoningEpc, triggerNpcRecord, triggerNpcWithGivenApproach } from '../../narrative/converse.ts';
import { soldierByProfile, tacticalCharacterDialogue } from '../../narrative/dialogue-queue.ts';
import type { NarrativeHost } from '../../narrative/host.ts';
import { ProfileFlag } from '../../narrative/narrative-ids.ts';
import { updateDarrelScriptToGoTo } from '../../narrative/records.ts';
import { handleTownLoyaltyForNpcRecruitment } from '../../strategic/economy/loyalty.ts';
import { Assignment, InsertionCode, NUMBER_OF_SQUADS } from '../../strategic/forces/constants.ts';
import { removePlayerFromGroup } from '../../strategic/forces/groups.ts';
import {
  addCharacterToAnySquad,
  addCharacterToSquad,
  removeCharacterFromSquads,
  resetDeadSquadMemberList,
} from '../../strategic/forces/squads.ts';
import { takeSoldierOutOfVehicle } from '../../strategic/forces/vehicles.ts';
import { Fact, Quest } from '../../strategic/narrative/fact-ids.ts';
import { QuestStatus, questStatus } from '../../strategic/narrative/facts.ts';
import { NarrativeHistory } from '../../strategic/narrative/history-codes.ts';
import { Npc } from '../../strategic/narrative/npc-ids.ts';
import { worldTotalMinutes } from '../../strategic/time/world-clock.ts';
import { findObjClass } from '../../tactical/combat/reload.ts';
import { soldierSlotTaken } from '../../tactical/init-list.ts';
import { Insertion } from '../../tactical/insertion.ts';
import { autoPlaceObject, InvSlot, itemIn, NO_SLOT } from '../../tactical/inventory.ts';
import type { RecruitActions } from '../../tactical/narrative/npc-actions/env.ts';
import { setupProfileInsertionDataForSoldier } from '../../tactical/narrative/profile-insertion.ts';
import { changeSoldierTeam } from '../../tactical/narrative/team-change.ts';
import { kickOutWheelchair } from '../../tactical/narrative/wheelchair.ts';
import type { ProfileProgress } from '../../tactical/profiles.ts';
import { CivilianGroup, firstFreeSoldierId, NO_PROFILE, NOWHERE, type Soldier, Team } from '../../tactical/soldier.ts';
import { soldierInventoryContext } from '../../tactical/soldier-inventory.ts';
import type { TacticalState } from '../../tactical/state.ts';
import { findGridNoFromSweetSpotExcludingSweetSpot } from '../../tactical/sweet-spots.ts';
import type { CampaignSim } from '../campaign-sim.ts';
import { addToPersonnelList, removeNewlyHiredMercFromPersonnelDepartedList } from '../laptop/records.ts';
import { createMercRecord } from '../merc-record.ts';
import { MercKind, type Roster, RosterMerc } from '../roster.ts';

type Emit = (e: Record<string, unknown> & { readonly type: string }) => void;

const NO_VEHICLE = -1;
const NO_PREVIOUS_SECTOR = 255;
const FIRST_SQUAD = 0;
const SLAY_CONTRACT_MINUTES = 7 * 24 * 60;
const IRA_RECRUITED_RECORD = 0;
const DARREL_SWEET_SPOT_RADII: readonly number[] = [5, 10];
const PERMANENT_INSERTION_CODE = 0x02;

export type RecruitKind = 'rpc' | 'epc';

export interface EscortRelease {
  readonly profile: number;
  readonly quote: number | null;
}

export class RecruitFlow {
  readonly #campaign: CampaignSim;
  readonly #host: NarrativeHost;
  readonly #emit: Emit;
  reservedSoldierSlot: (id: number) => boolean = () => false;

  constructor(campaign: CampaignSim, host: NarrativeHost, emit: Emit) {
    this.#campaign = campaign;
    this.#host = host;
    this.#emit = emit;
  }

  actions(): RecruitActions {
    return {
      recruitRpc: (npc) => void this.recruitRpc(npc),
      recruitEpc: (npc) => void this.recruitEpc(npc),
      unRecruitEpc: (npc) => void this.unRecruitEpc(npc),
      handleStuffForNpcEscorted: (npc) => this.handleStuffForNpcEscorted(npc),
      turnIntoAnonymousCivilian: (s) => this.turnIntoAnonymousCivilian(s),
      addToOtherList: (profile) => this.addToOtherList(profile),
      updateDarrelScriptToGoTo: (merc) => this.updateDarrelScriptToGoTo(merc),
    };
  }

  get #roster(): Roster | null {
    return this.#campaign.battle?.roster ?? null;
  }

  get #t(): TacticalState | null {
    return this.#campaign.tactical?.state ?? null;
  }

  #profile(id: number): ProfileProgress | null {
    return this.#campaign.narrative.profile(id);
  }

  findSoldierByProfile(profile: number): Soldier | null {
    const merc = this.#roster?.byProfile(profile);
    if (merc) return merc.soldier;
    return soldierByProfile(this.#host, profile);
  }

  playerSoldierOf(profile: number): RosterMerc | null {
    return this.#roster?.byProfile(profile) ?? null;
  }

  #soldierSector(s: Soldier): Sector | null {
    const merc = this.#roster?.get(s.id);
    if (merc?.soldier === s) return merc.sector;
    return this.#campaign.state.worldSector;
  }

  #freeSoldierId(t: TacticalState, team: number): number {
    const roster = this.#roster;
    const taken = (n: number) =>
      soldierSlotTaken(t, n) || this.reservedSoldierSlot(n) || (team === Team.OUR && roster?.get(n) !== undefined);
    return firstFreeSoldierId(taken, team);
  }

  #leaveTeam(m: RosterMerc): void {
    const ctx = this.#campaign.strategic;
    if (ctx) {
      if (m.assignment === Assignment.VEHICLE && m.vehicleId !== NO_VEHICLE) takeSoldierOutOfVehicle(ctx, m.id);
      removeCharacterFromSquads(ctx, m.id);
      if (m.groupId !== 0) removePlayerFromGroup(ctx, m.id);
    }
    this.#roster?.remove(m.id);
  }

  #changeTeam(old: Soldier, team: number): Soldier | null {
    if (this.#host.talk.inPanel) deleteTalkingMenu(this.#host, 'script');
    const t = this.#t;
    const leaving = this.#roster?.get(old.id);
    if (leaving?.soldier === old) this.#leaveTeam(leaving);
    if (!t) return null;
    return changeSoldierTeam(t, old, team, { freeSoldierId: (to) => this.#freeSoldierId(t, to) });
  }

  #join(fresh: Soldier, kind: number, sector: Sector): RosterMerc | null {
    const roster = this.#roster;
    if (!roster) return null;
    const merc = new RosterMerc(
      createMercRecord({
        soldier: fresh,
        profile: this.#campaign.battle?.content.profiles[fresh.profile] ?? null,
        kind,
        statusFlags: 0,
        sector: { ...sector },
        betweenSectors: false,
        groupId: 0,
        prevSectorId: NO_PREVIOUS_SECTOR,
        insertionCode: InsertionCode.NORTH,
        insertionDirection: fresh.direction,
        path: [],
        assignment: FIRST_SQUAD,
        vehicleId: NO_VEHICLE,
        asleep: false,
      }),
    );
    merc.lastAssignmentChangeMin = worldTotalMinutes(this.#campaign.state.clock);
    roster.add(merc);
    return merc;
  }

  #addToSquads(merc: RosterMerc): void {
    const ctx = this.#campaign.strategic;
    if (!ctx) return;
    const current = this.#campaign.state.forces.currentSquad;
    const valid = current >= 0 && current < NUMBER_OF_SQUADS;
    if (!valid || !addCharacterToSquad(ctx, merc.id, current)) addCharacterToAnySquad(ctx, merc.id);
    resetDeadSquadMemberList(ctx, merc.assignment);
  }

  #swapFirstWeaponIntoHand(t: TacticalState, s: Soldier): void {
    const items = t.content.items;
    if (itemIn(s.inv, InvSlot.HAND) !== 0) return;
    const slot = findObjClass(items, s, WEAPON_CLASSES);
    if (slot === NO_SLOT) return;
    const secondHand = s.inv[InvSlot.SECOND_HAND];
    if (isTwoHanded(items, itemIn(s.inv, slot)) && slot !== InvSlot.SECOND_HAND && secondHand && secondHand.item !== 0)
      autoPlaceObject(soldierInventoryContext(t, s), s, secondHand);
    const from = s.inv[slot];
    const hand = s.inv[InvSlot.HAND];
    if (from && hand) swapObjects(from, hand);
  }

  #recruitedEvent(merc: RosterMerc, kind: RecruitKind): void {
    const salary = kind === 'rpc' ? (this.#profile(merc.profile)?.salary ?? 0) : 0;
    this.#emit({ type: 'npcRecruited', profile: merc.profile, soldier: merc.id, kind, salary });
  }

  recruitRpc(npc: number): boolean {
    const old = this.findSoldierByProfile(npc);
    if (!old) return false;
    const p = this.#profile(npc);
    if (p) p.miscFlags |= ProfileFlag.RECRUITED;
    const sector = this.#soldierSector(old) ?? { x: 0, y: 0, z: 0 };
    const fresh = this.#changeTeam(old, Team.OUR);
    const merc = fresh ? this.#join(fresh, MercKind.NPC, sector) : null;
    const t = this.#t;
    if (!fresh || !merc || !t) return false;
    const narrative = this.#campaign.narrative;
    if (npc === Npc.SLAY) {
      merc.contract.contractEnd = worldTotalMinutes(this.#campaign.state.clock) + SLAY_CONTRACT_MINUTES;
      kickOutWheelchair(t, fresh);
    } else if (npc === Npc.DYNAMO && questStatus(this.#campaign.state.narrative, Quest.FREE_DYNAMO) === QuestStatus.IN_PROGRESS) {
      narrative.endQuest(Quest.FREE_DYNAMO, sector);
    }
    const economy = this.#campaign.economy;
    if (economy && p) handleTownLoyaltyForNpcRecruitment(economy, merc.sector, p.town, p.townAttachment);
    this.#addToSquads(merc);
    this.#swapFirstWeaponIntoHand(t, fresh);
    if (npc === Npc.IRA) triggerNpcRecord(this.#host, Npc.IRA, IRA_RECRUITED_RECORD);
    narrative.history(NarrativeHistory.RPC_JOINED_TEAM, fresh.profile, merc.sector);
    removeNewlyHiredMercFromPersonnelDepartedList(this.#campaign.state.laptop, npc);
    this.#recruitedEvent(merc, 'rpc');
    return true;
  }

  recruitEpc(npc: number): boolean {
    const old = this.findSoldierByProfile(npc);
    if (!old) return false;
    const p = this.#profile(npc);
    if (p) {
      p.miscFlags |= ProfileFlag.EPCACTIVE;
      p.miscFlags3 &= ~PERMANENT_INSERTION_CODE;
    }
    const sector = this.#soldierSector(old) ?? { x: 0, y: 0, z: 0 };
    const fresh = this.#changeTeam(old, Team.OUR);
    const merc = fresh ? this.#join(fresh, MercKind.EPC, sector) : null;
    if (!merc) return false;
    this.#addToSquads(merc);
    if (merc.isRobot) this.#roster?.updateRobotControllerGivenRobot(merc.id);
    this.#recruitedEvent(merc, 'epc');
    return true;
  }

  unRecruitEpc(npc: number): boolean {
    const merc = this.playerSoldierOf(npc);
    if (!merc || merc.kind !== MercKind.EPC) return false;
    const ctx = this.#campaign.strategic;
    if (ctx && merc.assignment < Assignment.ON_DUTY) resetDeadSquadMemberList(ctx, merc.assignment);
    const p = this.#profile(npc);
    const gridNo = merc.soldier.gridNo;
    if (p) {
      p.miscFlags &= ~ProfileFlag.EPCACTIVE;
      p.sectorX = merc.sector.x;
      p.sectorY = merc.sector.y;
      p.sectorZ = merc.sector.z;
      p.miscFlags3 |= PERMANENT_INSERTION_CODE;
      p.insertionCode = Insertion.GRIDNO;
      p.insertionData = gridNo;
      p.useProfileInsertion = true;
    }
    const fresh = this.#changeTeam(merc.soldier, Team.CIV);
    this.#emit({ type: 'epcReleased', profile: npc, soldier: fresh?.placed ? fresh.id : null });
    return true;
  }

  handleStuffForNpcEscorted(npc: number): void {
    const n = this.#campaign.state.narrative;
    const world = this.#campaign.state.worldSector;
    if (npc === Npc.SKYRIDER) {
      this.#campaign.narrative.setFactTrue(Fact.SKYRIDER_EVER_ESCORTED);
      if (questStatus(n, Quest.ESCORT_SKYRIDER) === QuestStatus.NOT_STARTED)
        this.#campaign.narrative.startQuest(Quest.ESCORT_SKYRIDER, world);
      return;
    }
    if (npc !== Npc.JOHN && npc !== Npc.MARY) return;
    const partner = npc === Npc.JOHN ? Npc.MARY : Npc.JOHN;
    this.recruitEpc(partner);
    const s = this.playerSoldierOf(partner);
    if (s) this.#emit({ type: 'npcMessage', kind: 'nowEscorted', profile: partner, amount: s.assignment + 1 });
    if (questStatus(n, Quest.ESCORT_TOURISTS) === QuestStatus.NOT_STARTED)
      this.#campaign.narrative.startQuest(Quest.ESCORT_TOURISTS, world);
  }

  changeTeam(s: Soldier, team: number): Soldier | null {
    return this.#changeTeam(s, team);
  }

  turnIntoAnonymousCivilian(s: Soldier): void {
    const fresh = this.#changeTeam(s, Team.CIV);
    if (!fresh) return;
    fresh.profile = NO_PROFILE;
    fresh.civilianGroup = CivilianGroup.NONE;
  }

  addToOtherList(profile: number): void {
    addToPersonnelList(this.#campaign.state.laptop, 'other', profile);
  }

  updateDarrelScriptToGoTo(merc: Soldier): void {
    const t = this.#t;
    const darrel = soldierByProfile(this.#host, Npc.DARREL);
    if (!t || !darrel) return;
    for (const radius of DARREL_SWEET_SPOT_RADII) {
      const gridNo = findGridNoFromSweetSpotExcludingSweetSpot(t, darrel, merc.gridNo, radius);
      if (gridNo === NOWHERE) continue;
      updateDarrelScriptToGoTo(this.#host, gridNo, merc.profile);
      return;
    }
  }

  partnerOf(merc: RosterMerc): RosterMerc | null {
    if (merc.profile === Npc.JOHN) return this.playerSoldierOf(Npc.MARY);
    if (merc.profile === Npc.MARY) return this.playerSoldierOf(Npc.JOHN);
    return null;
  }

  internalUnescortEpc(merc: RosterMerc): EscortRelease {
    const narrative = this.#campaign.narrative;
    const hooks = narrative.profileInsertionHooks(() => ({
      worldSector: this.#campaign.state.worldSector ?? merc.sector,
      mercSector: merc.sector,
      startSector: merc.sector,
      usingEdgepoints: false,
    }));
    setupProfileInsertionDataForSoldier(merc.soldier, { inSector: merc.soldier.placed, strategicInsertionCode: merc.insertionCode }, hooks);
    const info = getInfoForAbandoningEpc(this.#host, merc.profile);
    const p = this.#profile(merc.profile);
    if (info) {
      if (p) p.miscFlags |= ProfileFlag.FORCENPCQUOTE;
      tacticalCharacterDialogue(this.#host, merc.soldier, info.quote);
      narrative.setFactTrue(info.fact);
    }
    this.#host.talk.queue.push({ kind: 'removeEpc', npc: merc.profile });
    return { profile: merc.profile, quote: info ? info.quote : null };
  }

  removeEpc(npc: number): void {
    const p = this.#profile(npc);
    if (p) p.miscFlags &= ~ProfileFlag.FORCENPCQUOTE;
    this.unRecruitEpc(npc);
  }

  triggerWrongSectorRecord(merc: RosterMerc): boolean {
    return triggerNpcWithGivenApproach(this.#host, merc.profile, Approach.EPC_IN_WRONG_SECTOR);
  }
}

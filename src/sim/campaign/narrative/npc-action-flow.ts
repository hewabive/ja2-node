// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-16. See LICENSE (SFI-SCLA).
// @src src/game/Tactical/Interface_Dialogue.cc HandleNPCDoAction (the campaign side of the actions),
// @src StartDialogueMessageBox, DialogueMessageBoxCallBack, DoneFadeOutActionBasement, DoneFadeOutActionLeaveBasement,
// @src CarmenLeavesSectorCallback (on game time); Tactical/Boxing.cc CheckOnBoxers, ExitBoxing, BoxerAvailable (the boxing
// @src actions); Tactical/Overhead.cc SetSoldierNeutral; Tactical/Handle_Items.cc
// @src SoldierGiveItemFromAnimation (the NPC-to-merc branch, immediate); Strategic/StrategicMap_Secrets.cc SetTownAsFound.
// @src See docs/25 §3, §13.2.

import type { CommandResult } from '../../command.ts';
import { cloneObject, deleteObject } from '../../items/object.ts';
import type { NarrativeHost } from '../../narrative/host.ts';
import { incrementTownLoyalty, incrementTownLoyaltyEverywhere } from '../../strategic/economy/loyalty.ts';
import { mineStatus, restartMineProduction, shutOffMineProduction } from '../../strategic/economy/mine-status.ts';
import { headMinersMineIndex, playerSpokeToHeadMiner, resetQueenRetookMine } from '../../strategic/economy/mines.ts';
import { setSoldierAssignmentHospital } from '../../strategic/economy/set-assignment.ts';
import { type BattlePrompt, nextPromptId, PromptKind } from '../../strategic/forces/battle-state.ts';
import { NUMBER_OF_SQUADS } from '../../strategic/forces/constants.ts';
import { getGroup, setGroupSectorValue } from '../../strategic/forces/groups.ts';
import { updateRefuelSiteAvailability } from '../../strategic/forces/helicopter.ts';
import { calculateNonPersistentPbiInfo } from '../../strategic/forces/pre-battle.ts';
import { markSecretFoundAt } from '../../strategic/map/control.ts';
import { NOT_BOXING } from '../../strategic/narrative/facts.ts';
import { removeObjectFromProfile } from '../../strategic/narrative/presence.ts';
import type { SectorPosition } from '../../strategic/state.ts';
import { Warp } from '../../strategic/time/constants.ts';
import { addStrategicEvent } from '../../strategic/time/event-queue.ts';
import { warpGameTime, worldDay, worldMinutesInDay, worldTotalMinutes } from '../../strategic/time/world-clock.ts';
import { initNewSoldierAnim } from '../../tactical/animation.ts';
import { Insertion } from '../../tactical/insertion.ts';
import { autoPlaceObject } from '../../tactical/inventory.ts';
import { boxerAvailable, checkOnBoxers, exitBoxing, startBoxingMatch } from '../../tactical/narrative/boxing.ts';
import { handleNpcDoAction } from '../../tactical/narrative/npc-actions/catalog.ts';
import {
  type BoxingActions,
  type ExitGridTarget,
  type MeanwhileActions,
  type MineActions,
  NO_MEANWHILE_ACTIONS,
  NO_MINE_ACTIONS,
  type NpcActionEnv,
  type NpcRequestOpening,
  type RecruitActions,
} from '../../tactical/narrative/npc-actions/env.ts';
import {
  answerNpcRequest,
  type NpcRequestChoice,
  type NpcRequestDetails,
  npcRequestDetails,
  playerTeamFull,
} from '../../tactical/narrative/npc-actions/requestors.ts';
import { carmenLeavesSector } from '../../tactical/narrative/npc-actions/san-mona.ts';
import { kickOutWheelchair } from '../../tactical/narrative/wheelchair.ts';
import { OKLIFE, type Soldier, Team } from '../../tactical/soldier.ts';
import { soldierInventoryContext } from '../../tactical/soldier-inventory.ts';
import { WaitForMercs } from '../../tactical/state.ts';
import { addItemToPool, Visibility } from '../../tactical/world-items.ts';
import type { CampaignSim } from '../campaign-sim.ts';
import { numberOfMercsOnPlayerTeam } from '../laptop/hire.ts';
import { MoraleEvent } from '../morale.ts';
import { addNpcEventToday, addNpcEventTomorrow, medicalCostAt } from './quest-world.ts';
import { RecruitFlow } from './recruit-flow.ts';

export interface NpcActionPorts {
  readonly boxing?: Partial<BoxingActions>;
  readonly recruit?: Partial<RecruitActions>;
  readonly meanwhile?: Partial<MeanwhileActions>;
  readonly giveItem?: (giver: Soldier, receiver: Soldier, slot: number) => void;
}

type Emit = (e: Record<string, unknown> & { readonly type: string }) => void;

export interface NpcRequestView {
  readonly id: string;
  readonly kind: 'npcRequest';
  readonly request: string;
  readonly npc: number;
  readonly name: string;
  readonly merc?: number;
  readonly amount?: number;
  readonly pair?: boolean;
  readonly choices: readonly string[];
}

const NO_GROUP = 0;

export class NpcActionFlow {
  readonly #campaign: CampaignSim;
  readonly #host: NarrativeHost;
  readonly #ports: NpcActionPorts;
  readonly #emit: Emit;
  readonly recruitFlow: RecruitFlow;
  readonly env: NpcActionEnv;

  constructor(campaign: CampaignSim, host: NarrativeHost, ports: NpcActionPorts, emit: Emit) {
    this.#campaign = campaign;
    this.#host = host;
    this.#ports = ports;
    this.#emit = emit;
    this.recruitFlow = new RecruitFlow(campaign, host, emit);
    this.env = this.#createEnv();
  }

  get #state() {
    return this.#campaign.state;
  }

  get carmenTimerAtMs(): number | null {
    return this.#state.talk.carmenTimerAtMs;
  }

  set carmenTimerAtMs(at: number | null) {
    this.#state.talk.carmenTimerAtMs = at;
  }

  handle(npc: number, code: number, record: number): boolean {
    return handleNpcDoAction(this.env, npc, code, record);
  }

  afterTacticalStep(): void {
    const at = this.carmenTimerAtMs;
    const t = this.#host.tactical();
    if (at === null || !t || t.clockMs < at) return;
    this.carmenTimerAtMs = null;
    carmenLeavesSector(this.env);
  }

  requestOpen(): boolean {
    return this.#state.battle.prompt?.kind === PromptKind.NPC_REQUEST;
  }

  requestView(): NpcRequestView | null {
    const prompt = this.#state.battle.prompt;
    if (prompt?.kind !== PromptKind.NPC_REQUEST) return null;
    const name = this.#campaign.battle?.content.profiles[prompt.npc]?.nickname ?? String(prompt.npc);
    return {
      id: prompt.id,
      kind: PromptKind.NPC_REQUEST,
      request: prompt.request,
      npc: prompt.npc,
      name,
      ...(prompt.request === 'marryDaryl' ? { merc: prompt.src } : {}),
      ...(prompt.amount !== undefined ? { amount: prompt.amount } : {}),
      ...(prompt.pair !== undefined ? { pair: prompt.pair } : {}),
      choices: prompt.choices,
    };
  }

  #openRequest(opening: NpcRequestOpening): void {
    const battle = this.#state.battle;
    const details = npcRequestDetails(this.env, opening.code, opening.npc, opening.record);
    const prompt = { ...details, id: nextPromptId(battle, PromptKind.NPC_REQUEST), kind: PromptKind.NPC_REQUEST } as const;
    battle.prompt = prompt as BattlePrompt;
    const { kind: _kind, ...view } = this.requestView() as NpcRequestView;
    this.#emit({ ...view, type: 'npcRequest' });
  }

  answer(prompt: BattlePrompt, choice: string): CommandResult {
    if (prompt.kind !== PromptKind.NPC_REQUEST) return { ok: false, reason: 'not an NPC request' };
    if (!prompt.choices.includes(choice)) return { ok: false, reason: `choose one of ${prompt.choices.join(', ')}` };
    this.#state.battle.prompt = null;
    const details: NpcRequestDetails = {
      request: prompt.request as NpcRequestDetails['request'],
      code: prompt.code,
      npc: prompt.npc,
      src: prompt.src,
      record: prompt.record,
      choices: prompt.choices as readonly NpcRequestChoice[],
    };
    answerNpcRequest(this.env, details, choice as NpcRequestChoice);
    return { ok: true };
  }

  #giveItem(giver: Soldier, receiver: Soldier, slot: number): void {
    const custom = this.#ports.giveItem;
    if (custom) {
      custom(giver, receiver, slot);
      return;
    }
    const t = this.#host.tactical();
    const o = giver.inv[slot];
    if (!t || !o) return;
    const given = cloneObject(o);
    deleteObject(o);
    if (autoPlaceObject(soldierInventoryContext(t, receiver), receiver, given)) {
      this.#emit({ type: 'npcGaveItem', npc: giver.profile, to: receiver.id, item: given.item });
      return;
    }
    addItemToPool(t, giver.gridNo, given, Visibility.VISIBLE, giver.level, 0, -1);
    this.#emit({ type: 'npcMessage', kind: 'itemPlacedOnGround', profile: giver.profile });
  }

  #mines(): MineActions {
    const economy = this.#campaign.economy;
    if (!economy) return NO_MINE_ACTIONS;
    return {
      headMinersMine: (npc) => headMinersMineIndex(economy, npc),
      playerSpokeToHeadMiner: (npc) => playerSpokeToHeadMiner(economy, npc),
      isMineShutDown: (mine) => mineStatus(economy, mine).shutDown,
      restartMineProduction: (mine) => restartMineProduction(economy, mine),
      shutOffMineProduction: (mine) => shutOffMineProduction(economy, mine),
      resetQueenRetookMine: (npc) => resetQueenRetookMine(economy, npc),
    };
  }

  #moveMercs(sector: SectorPosition, insertionGridNos: readonly number[], currentSquadOnly: boolean): void {
    const ctx = this.#campaign.strategic;
    const t = this.#host.tactical();
    const roster = this.#campaign.battle?.roster;
    if (!ctx || !t || !roster) return;
    const traversal = this.#state.movement.tacticalTraversal;
    let done = 0;
    for (const s of t.soldiers) {
      if (!s?.placed || s.team !== Team.OUR || s.life < OKLIFE) continue;
      const m = roster.get(s.id);
      if (!m || (currentSquadOnly && m.assignment !== this.#state.forces.currentSquad)) continue;
      traversal.active = true;
      const group = getGroup(ctx, m.groupId);
      if (group && group.id !== NO_GROUP) setGroupSectorValue(ctx, sector, group);
      if (done < insertionGridNos.length) {
        m.sector = sector;
        m.insertionCode = Insertion.GRIDNO;
        m.soldier.insertionData = insertionGridNos[done] as number;
      }
      done++;
    }
  }

  #loadSector(sector: SectorPosition): void {
    const flow = this.#campaign.sectors;
    if (!flow) return;
    flow.setCurrentWorldSector(sector);
    const traversal = this.#state.movement.tacticalTraversal;
    traversal.active = false;
    traversal.groupId = 0;
    traversal.chosenSoldier = -1;
  }

  #setTownAsFound(town: number): void {
    const ctx = this.#campaign.strategic;
    const def = ctx?.content.towns.find((x) => x.townId === town);
    if (!ctx || !def || def.sectors.length === 0) return;
    markSecretFoundAt(ctx, Math.min(...def.sectors));
    this.#emit({ type: 'townDiscovered', town });
  }

  #setSoldierNeutral(s: Soldier): void {
    s.neutral = true;
    const t = this.#host.tactical();
    const economy = this.#campaign.economy;
    if (!t || !economy || this.env.boxing.inMatch()) return;
    if (!economy.world.hostileCiviliansPresent()) calculateNonPersistentPbiInfo(economy);
  }

  #kickOutOfWheelchair(s: Soldier): void {
    const t = this.#host.tactical();
    if (!t) return;
    const state = t.content.animations.controls.findIndex((c) => c?.id === 'CRIPPLE_KICKOUT');
    if (state >= 0) initNewSoldierAnim(t, s, state, 0, true);
    else kickOutWheelchair(t, s);
  }

  #boxingActions(): BoxingActions {
    const record = this.#state.narrative.boxing;
    const tactical = () => this.#host.tactical();
    return {
      checkOnBoxers: () => checkOnBoxers(record, tactical()),
      startMatch: () => {
        const t = tactical();
        if (t) startBoxingMatch(t);
      },
      exitBoxing: () => {
        const t = tactical();
        if (t) exitBoxing(t);
      },
      boxerAvailable: () => boxerAvailable(record, tactical()),
      lastMatchWonByPlayer: () => record.lastMatchWonByPlayer,
      inMatch: () => record.state !== NOT_BOXING,
    };
  }

  #createEnv(): NpcActionEnv {
    const campaign = this.#campaign;
    const s = this.#state;
    const narrative = campaign.narrative;
    const host = this.#host;
    const params = () => campaign.strategic?.content.npcActionParams;
    const economy = () => campaign.economy;
    const roster = () => campaign.battle?.roster;
    return {
      host,
      params: {
        gridNo: (code, fallback) => params()?.get(code)?.gridNo ?? fallback,
        amount: (code, fallback) => params()?.get(code)?.amount ?? fallback,
      },
      hospital: s.narrative.hospital,
      mines: this.#mines(),
      boxing: { ...this.#boxingActions(), ...this.#ports.boxing },
      recruit: { ...this.recruitFlow.actions(), ...this.#ports.recruit },
      meanwhile: { ...NO_MEANWHILE_ACTIONS, ...this.#ports.meanwhile },
      hideout: {
        addExitGrid: (_gridNo: number, _target: ExitGridTarget) => {},
        moveMercs: (sector, gridNos, currentSquadOnly) => this.#moveMercs(sector, gridNos, currentSquadOnly),
        loadSector: (sector) => this.#loadSector(sector),
        uncoverTrapdoor: () => {},
        leavingSector: () => (host.tactical()?.mercsWaiting?.code ?? WaitForMercs.NONE) !== WaitForMercs.NONE,
      },
      laptop: {
        addTerroristFiles: () => campaign.laptop?.terroristFiles(),
        addJohnsGunShipment: () => campaign.laptop?.addJohnsGunShipment(),
      },
      random: (n) => s.rng.int(n),
      preRandom: (n) => s.pre.int(n),
      sciFi: () => s.options.sciFi,
      worldSector: () => s.worldSector,
      minutesInDay: () => worldMinutesInDay(s.clock),
      totalMinutes: () => worldTotalMinutes(s.clock),
      day: () => worldDay(s.clock),
      checkFact: (id, npc) => narrative.checkFact(id, npc),
      setFactTrue: (id) => narrative.setFactTrue(id),
      setFactFalse: (id) => narrative.setFactFalse(id),
      questStatus: (quest) => s.narrative.quests[quest] ?? 0,
      startQuest: (quest, sector) => narrative.startQuest(quest, sector),
      history: (code, sector, secondCode = 0) => narrative.history(code, secondCode, sector),
      awardExperience: (bonus) => narrative.awardExperience(bonus),
      loyaltyForNpcAction: (npc) => narrative.loyaltyForNpcAction(npc),
      incrementTownLoyalty: (town, amount) => {
        const e = economy();
        if (e) incrementTownLoyalty(e, town, amount);
      },
      incrementTownLoyaltyEverywhere: (amount) => {
        const e = economy();
        if (e) incrementTownLoyaltyEverywhere(e, amount);
      },
      loyaltyAmount: (name) => economy()?.economy.loyalty.amounts[name] ?? 0,
      setTownAsFound: (town) => this.#setTownAsFound(town),
      addFutureDayNpcEvent: (minute, param, days) => addNpcEventTomorrow(campaign, minute, param, days),
      addSameDayNpcEvent: (minute, param) => addNpcEventToday(campaign, minute, param),
      addStrategicEvent: (kind, minute, param) => addStrategicEvent(s.queue, kind, minute, param),
      updateRefuelSiteAvailability: () => {
        if (campaign.strategic) updateRefuelSiteAvailability(campaign.strategic);
      },
      calcMedicalCost: (npc) => medicalCostAt(campaign, npc),
      assignment: (soldier) => roster()?.get(soldier.id)?.assignment ?? -1,
      setHospitalAssignment: (soldier, modifier) => {
        const m = roster()?.get(soldier.id);
        const e = economy();
        if (!m || !e) return;
        setSoldierAssignmentHospital(e, m);
        m.hospitalPriceModifier = modifier;
      },
      playerTeamFull: () => playerTeamFull(this.#mercsOnPlayerTeam()),
      mercsOnPlayerTeam: () => this.#mercsOnPlayerTeam(),
      setCurrentSquad: (soldier) => {
        const squad = roster()?.get(soldier.id)?.assignment ?? -1;
        if (squad >= 0 && squad < NUMBER_OF_SQUADS) s.forces.currentSquad = squad;
      },
      openShop: (npc) => host.openShop(npc),
      shopKeeperShutDown: (npc) => host.shopClosedByScript(npc),
      giveItem: (giver, receiver, slot) => this.#giveItem(giver, receiver, slot),
      moraleEvent: (soldier, kind) => {
        const m = roster()?.get(soldier.id) ?? null;
        const event = (MoraleEvent as Readonly<Record<string, number>>)[kind];
        if (event !== undefined && s.worldSector) campaign.battle?.moraleEvent(m, event, s.worldSector);
      },
      openRequest: (opening) => this.#openRequest(opening),
      startCarmenTimer: (ms) => {
        const t = host.tactical();
        this.carmenTimerAtMs = (t?.clockMs ?? 0) + ms;
      },
      setSoldierNeutral: (soldier) => this.#setSoldierNeutral(soldier),
      message: (kind, profile, amount) =>
        this.#emit({
          type: 'npcMessage',
          kind,
          ...(profile !== undefined ? { profile } : {}),
          ...(amount !== undefined ? { amount } : {}),
        }),
      presentation: (kind, profile) => this.#emit({ type: kind, ...(profile !== undefined ? { npc: profile } : {}) }),
      warpTimeWithoutEvents: (seconds) => warpGameTime(campaign.clockContext, seconds, Warp.NO_PROCESSING),
      profileName: (npc) => campaign.battle?.content.profiles[npc]?.name ?? '',
      kickOutOfWheelchair: (soldier) => this.#kickOutOfWheelchair(soldier),
      leatherJacketPrice: () => host.tactical()?.content.items.byName.get('LEATHER_JACKET_W_KEVLAR')?.price ?? 0,
      removeObjectFromProfile: (npc, item) => {
        const items = narrative.profileItems();
        const p = narrative.profile(npc);
        if (items && p) removeObjectFromProfile(items, p, item);
      },
    };
  }

  #mercsOnPlayerTeam(): number {
    const roster = this.#campaign.battle?.roster;
    return roster ? numberOfMercsOnPlayerTeam({ roster }) : 0;
  }
}

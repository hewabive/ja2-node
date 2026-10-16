// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-16. See LICENSE (SFI-SCLA).
// @src src/game/Tactical/End_Game.cc BeginHandleDeidrannaDeath, HandleDeidrannaDeath, DoneFadeOutKilledQueen,
// @src DoneFadeInKilledQueen, EndQueenDeathEndgameBeginEndCimenatic, EndQueenDeathEndgame, DoneFadeOutEndCinematic,
// @src BeginHandleQueenBitchDeath, HandleQueenBitchDeath; Tactical/Interface_Dialogue.cc NPC_ACTION_ENDGAME_STATE_1,
// @src NPC_ACTION_ENDGAME_STATE_2; Intro.cc (the ending's Miguel and Skyrider variants). See docs/26 §6, §7.

import { type NarrativeScenes, NO_NARRATIVE_SCENES } from '../../content/narrative/scenes.ts';
import { type Sector, sectorShortString } from '../../content/strategic/sector-ids.ts';
import { u8 } from '../../core/int.ts';
import type { SimEvent } from '../events.ts';
import { deleteTalkingMenu, triggerNpcRecordImmediately } from '../narrative/converse.ts';
import { addDialogueEvent, soldierByProfile, tacticalCharacterDialogue } from '../narrative/dialogue-queue.ts';
import type { NarrativeHost } from '../narrative/host.ts';
import { StrategicAiAction } from '../strategic/ai/constants.ts';
import { processQueenCmdImplicationsOfDeath } from '../strategic/ai/queen-command.ts';
import { executeStrategicAIAction } from '../strategic/ai/reactions.ts';
import { LoyaltyEvent } from '../strategic/economy/constants.ts';
import { handleGlobalLoyaltyEvent } from '../strategic/economy/loyalty.ts';
import { InsertionCode } from '../strategic/forces/constants.ts';
import { getGroup, setGroupSectorValue } from '../strategic/forces/groups.ts';
import { setThisSectorAsPlayerControlled } from '../strategic/map/control.ts';
import { sectorInfo } from '../strategic/map/sectors.ts';
import { Fact } from '../strategic/narrative/fact-ids.ts';
import { QuestStatus } from '../strategic/narrative/facts.ts';
import { Npc } from '../strategic/narrative/npc-ids.ts';
import { changeNpcToDifferentSector } from '../strategic/narrative/presence.ts';
import { worldDay } from '../strategic/time/world-clock.ts';
import { eventSoldierGotHit } from '../tactical/combat/hit.ts';
import { soldierTo3DLocationLos } from '../tactical/combat/positions.ts';
import { Special } from '../tactical/combat/types.ts';
import { isGassed } from '../tactical/explosions/smoke.ts';
import { distanceVisible } from '../tactical/perception/sight.ts';
import { isProfileDead } from '../tactical/profiles.ts';
import { OKLIFE, Side, type Soldier, Team } from '../tactical/soldier.ts';
import { teamMembers } from '../tactical/state.ts';
import { exitCombatMode } from '../tactical/turns/turns.ts';
import type { CampaignSim } from './campaign-sim.ts';
import { EndgamePhase, type EndingState } from './ending-state.ts';
import { MoraleEvent } from './morale.ts';
import type { StoryEventWithoutTick } from './narrative/story-events.ts';

const DEIDRANNA_TIMER_TICKS = 400;
const QUEEN_BUG_TIMER_TICKS = 600;
const QUOTE_KILLING_DEIDRANNA = 37;
const QUOTE_KILLING_QUEEN = 38;
const QUOTE_END_GAME_COMMENT = 69;
const UPSTAIRS: Sector = { x: 3, y: 16, z: 0 };
const UPSTAIRS_INSERTION_GRIDNO = 5687;
const NORTHWEST = 7;
const INSERTION_DIRECTION_FORCED = 100;
const DEREK_AFTER_QUEEN_RECORD = 6;
const DEREK_CREATURES_RECORD = 8;
const CREATURE_QUEST_INDEX = 15;
const ELLIOT_REMOVED_SECTOR_X = 1;
const CREATURE_KILL_DAMAGE = 10_000;
const CREATURE_KILL_RANGE = 320;
const DIRECTION_IRRELEVANT = -1;
const LOS_CUBE_LEVEL = 3;
const ON_DUTY = 20;
const CALLBACK_DEIDRANNA_QUOTES = 'endgame:deidrannaQuotesDone';
const CALLBACK_END_COMMENTS = 'endgame:endCommentsDone';

export class EndgameFlow {
  readonly #campaign: CampaignSim;
  readonly #events: SimEvent[] = [];

  constructor(campaign: CampaignSim) {
    this.#campaign = campaign;
  }

  get #state(): EndingState {
    return this.#campaign.state.ending;
  }

  get #host(): NarrativeHost | null {
    return this.#campaign.talk?.host ?? null;
  }

  get #scenes(): NarrativeScenes {
    return this.#campaign.talk?.scenes ?? NO_NARRATIVE_SCENES;
  }

  drainEvents(): SimEvent[] {
    return this.#events.splice(0);
  }

  #emit(e: StoryEventWithoutTick): void {
    this.#events.push({ ...e, tick: this.#campaign.tick } as SimEvent);
  }

  active(): boolean {
    const phase = this.#state.phase;
    return phase !== EndgamePhase.NONE && phase !== EndgamePhase.ENDED;
  }

  ended(): boolean {
    return this.#state.victory !== null;
  }

  #lockConversation(): void {
    const talk = this.#campaign.talk;
    if (!talk) return;
    talk.host.setEngaged(true);
    talk.talk.referenceCount = 1;
  }

  #unlockConversation(): void {
    const talk = this.#campaign.talk;
    if (!talk) return;
    talk.host.setEngaged(false);
    talk.talk.referenceCount = 0;
  }

  #worldName(): string {
    const w = this.#campaign.state.worldSector;
    return w ? sectorShortString(w) : '';
  }

  deidrannaDied(killer: Soldier | null, gridNo: number, level: number): void {
    const e = this.#state;
    e.killer = killer?.id ?? null;
    e.gridNo = gridNo;
    e.level = level;
    this.#lockConversation();
    e.inDeidrannaEndgame = true;
    e.phase = EndgamePhase.DEIDRANNA_TIMER;
    e.dueTick = this.#campaign.tick + DEIDRANNA_TIMER_TICKS;
    this.#emit({ type: 'queenKilled', sector: this.#worldName(), gridNo, level, killer: e.killer });
  }

  creatureQueenDied(killer: Soldier | null, gridNo: number, level: number): void {
    const e = this.#state;
    const t = this.#campaign.tactical?.state;
    e.killer = killer?.id ?? null;
    e.gridNo = gridNo;
    e.level = level;
    this.#lockConversation();
    e.phase = EndgamePhase.CREATURE_TIMER;
    e.dueTick = this.#campaign.tick + QUEEN_BUG_TIMER_TICKS;
    this.#emit({ type: 'creatureQueenKilled', killer: e.killer });
    if (!t) return;
    for (const s of teamMembers(t, Team.CREATURE)) {
      if (s.life <= 0) continue;
      t.turn.attackBusyCount = u8(t.turn.attackBusyCount + 1);
      eventSoldierGotHit(t, s, 0, CREATURE_KILL_DAMAGE, 0, s.direction, CREATURE_KILL_RANGE, null, Special.NONE, s.aimShotLocation);
    }
  }

  afterStep(): void {
    const e = this.#state;
    if (e.phase !== EndgamePhase.DEIDRANNA_TIMER && e.phase !== EndgamePhase.CREATURE_TIMER) return;
    if (this.#campaign.tick < e.dueTick) return;
    if (e.phase === EndgamePhase.DEIDRANNA_TIMER) this.#handleDeidrannaDeath();
    else this.#handleQueenBugDeath();
  }

  #soldier(id: number | null): Soldier | null {
    if (id === null) return null;
    return this.#campaign.tactical?.state.soldiers[id] ?? null;
  }

  #say(s: Soldier, quote: number): void {
    const host = this.#host;
    if (host) tacticalCharacterDialogue(host, s, quote);
  }

  #seesDeathTile(s: Soldier): boolean {
    const t = this.#campaign.tactical?.state;
    const e = this.#state;
    if (!t) return false;
    const visible = distanceVisible(t, s, DIRECTION_IRRELEVANT, DIRECTION_IRRELEVANT, e.gridNo, e.level);
    return soldierTo3DLocationLos(t, s, e.gridNo, e.level, LOS_CUBE_LEVEL, u8(visible), true) !== 0;
  }

  #isEpc(s: Soldier): boolean {
    return this.#campaign.battle?.roster.get(s.id)?.isEpc ?? false;
  }

  #okControllable(s: Soldier): boolean {
    const assignment = this.#campaign.battle?.roster.get(s.id)?.assignment ?? 0;
    return s.life >= OKLIFE && s.placed && s.team === Team.OUR && assignment < ON_DUTY;
  }

  #sayKillQuotes(quote: number, witnesses: ReadonlySet<number>): void {
    const t = this.#campaign.tactical?.state;
    const killer = this.#soldier(this.#state.killer);
    if (killer) this.#say(killer, quote);
    if (!t) return;
    for (const s of teamMembers(t, Team.OUR)) {
      if (s === killer || !this.#okControllable(s) || isGassed(t, s) || this.#isEpc(s)) continue;
      if (witnesses.has(s.profile) && this.#seesDeathTile(s)) this.#say(s, quote);
    }
  }

  #queueCallback(name: string): void {
    const host = this.#host;
    if (host) addDialogueEvent(host, { kind: 'callback', name });
    else this.dialogueCallback(name);
  }

  #handleDeidrannaDeath(): void {
    const c = this.#campaign;
    this.#sayKillQuotes(QUOTE_KILLING_DEIDRANNA, this.#scenes.deidrannaWitnesses);
    c.narrative.setFactTrue(Fact.QUEEN_DEAD);
    if (c.queen) executeStrategicAIAction(c.queen, StrategicAiAction.QUEEN_DEAD, null);
    this.#state.phase = EndgamePhase.DEIDRANNA_QUOTES;
    this.#queueCallback(CALLBACK_DEIDRANNA_QUOTES);
  }

  #handleQueenBugDeath(): void {
    this.#sayKillQuotes(QUOTE_KILLING_QUEEN, this.#scenes.queenBugWitnesses);
    if (this.#campaign.narrative.checkFact(Fact.QUEEN_DEAD, 0)) this.#beginEndCinematic();
    else {
      this.#unlockConversation();
      this.#state.phase = EndgamePhase.NONE;
    }
  }

  dialogueCallback(name: string): void {
    if (name === CALLBACK_DEIDRANNA_QUOTES) this.#doneFadeOutKilledQueen();
    else if (name === CALLBACK_END_COMMENTS) this.#doneFadeOutEndCinematic();
  }

  #moveCurrentSquadUpstairs(): number[] {
    const c = this.#campaign;
    const t = c.tactical?.state;
    const ctx = c.strategic;
    const roster = c.battle?.roster;
    const moved: number[] = [];
    if (!t || !ctx || !roster) return moved;
    for (const s of teamMembers(t, Team.OUR)) {
      const m = roster.get(s.id);
      if (!m || s.life < OKLIFE || m.assignment !== c.state.forces.currentSquad) continue;
      c.state.movement.tacticalTraversal.active = true;
      const group = getGroup(ctx, m.groupId);
      if (group) setGroupSectorValue(ctx, UPSTAIRS, group);
      m.sector = { ...UPSTAIRS };
      m.insertionCode = InsertionCode.GRIDNO;
      m.soldier.insertionData = UPSTAIRS_INSERTION_GRIDNO;
      m.insertionDirection = INSERTION_DIRECTION_FORCED + NORTHWEST;
      moved.push(s.id);
    }
    return moved;
  }

  #killEnemiesStrategically(): void {
    const c = this.#campaign;
    const t = c.tactical?.state;
    const q = c.queen;
    const flow = c.sectors;
    if (!t || !q || !flow) return;
    for (const s of teamMembers(t, Team.ENEMY)) {
      if (s.neutral || s.side === Side.FRIENDLY) continue;
      processQueenCmdImplicationsOfDeath(q, flow.deadEnemyRecord(s));
    }
  }

  #doneFadeOutKilledQueen(): void {
    const c = this.#campaign;
    const s = c.state;
    const t = c.tactical?.state;
    const moved = this.#moveCurrentSquadUpstairs();
    this.#killEnemiesStrategically();
    if (t) {
      exitCombatMode(t);
      t.turn.enemyInSector = false;
    }
    s.battle.lastBattleWon = true;
    c.battle?.moraleEvent(null, MoraleEvent.QUEEN_BATTLE_WON, UPSTAIRS);
    if (c.economy) handleGlobalLoyaltyEvent(c.economy, LoyaltyEvent.QUEEN_BATTLE_WON, UPSTAIRS);
    const world = s.worldSector;
    if (world && c.strategic) setThisSectorAsPlayerControlled(c.strategic, world, true);
    if (world) s.worldSector = { x: world.x, y: world.y, z: 1 };
    const p3 = sectorInfo(s.map, UPSTAIRS);
    p3.numAdmins = 0;
    p3.numTroops = 0;
    p3.numElites = 0;
    p3.adminsInBattle = 0;
    p3.troopsInBattle = 0;
    p3.elitesInBattle = 0;
    const elliot = c.narrative.profile(Npc.ELLIOT);
    if (elliot) elliot.sectorX = ELLIOT_REMOVED_SECTOR_X;
    for (const npc of [Npc.DEREK, Npc.OLIVER]) {
      const p = c.narrative.profile(npc);
      if (p) changeNpcToDifferentSector(p, UPSTAIRS);
    }
    c.sectors?.setCurrentWorldSector(UPSTAIRS);
    const traversal = s.movement.tacticalTraversal;
    traversal.active = false;
    traversal.groupId = 0;
    traversal.chosenSoldier = -1;
    this.#emit({ type: 'squadMovedUpstairs', soldiers: moved, sector: sectorShortString(UPSTAIRS) });
    this.#doneFadeInKilledQueen();
  }

  #doneFadeInKilledQueen(): void {
    const host = this.#host;
    this.#state.phase = EndgamePhase.DEREK;
    if (host && soldierByProfile(host, Npc.DEREK)) triggerNpcRecordImmediately(host, Npc.DEREK, DEREK_AFTER_QUEEN_RECORD);
    else this.endgameState(1);
  }

  endgameState(state: 1 | 2): void {
    const host = this.#host;
    if (state === 2) {
      if (host) deleteTalkingMenu(host, 'script');
      this.#endQueenDeathEndgame();
      this.#state.phase = EndgamePhase.NONE;
      return;
    }
    if ((this.#campaign.state.narrative.quests[CREATURE_QUEST_INDEX] ?? 0) === QuestStatus.IN_PROGRESS) {
      if (host) triggerNpcRecordImmediately(host, Npc.DEREK, DEREK_CREATURES_RECORD);
      this.#endQueenDeathEndgame();
      this.#state.phase = EndgamePhase.NONE;
      this.#emit({ type: 'endgameDeferred', reason: 'creatures' });
      return;
    }
    if (host) deleteTalkingMenu(host, 'script');
    this.#beginEndCinematic();
  }

  #endQueenDeathEndgame(): void {
    this.#unlockConversation();
    this.#state.inDeidrannaEndgame = false;
  }

  #beginEndCinematic(): void {
    const c = this.#campaign;
    const e = this.#state;
    e.inEndgameSequence = true;
    e.phase = EndgamePhase.END_COMMENTS;
    for (const m of c.battle?.roster.all() ?? []) {
      if (m.life < OKLIFE || m.isEpc) continue;
      this.#say(m.soldier, QUOTE_END_GAME_COMMENT);
    }
    this.#queueCallback(CALLBACK_END_COMMENTS);
  }

  #profileAlive(id: number): boolean {
    const p = this.#campaign.narrative.profile(id);
    return p === null || !isProfileDead(p);
  }

  #doneFadeOutEndCinematic(): void {
    const c = this.#campaign;
    const s = c.state;
    const e = this.#state;
    this.#endQueenDeathEndgame();
    e.inEndgameSequence = false;
    e.phase = EndgamePhase.ENDED;
    const ending = { miguelAlive: this.#profileAlive(Npc.MIGUEL), skyriderAlive: this.#profileAlive(Npc.SKYRIDER) };
    const day = worldDay(s.clock);
    e.victory = { at: s.clock.seconds, day, ending, mercDeaths: s.status.mercDeaths };
    this.#emit({
      type: 'campaignWon',
      day,
      worldTime: s.clock.seconds,
      difficulty: s.options.difficulty,
      sciFi: s.options.sciFi,
      ending,
      mercDeaths: s.status.mercDeaths,
    });
  }
}

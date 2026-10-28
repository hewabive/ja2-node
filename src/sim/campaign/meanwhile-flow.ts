// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-16. See LICENSE (SFI-SCLA).
// @src src/game/Strategic/Meanwhile.cc CheckForMeanwhileOKStart, BeginMeanwhileCallBack, StartMeanwhile, SetNPCMeanwhile,
// @src DoneFadeOutMeanwhile, DoneFadeInMeanwhile, EndMeanwhile, RestoreNPCMeanwhile, DoneFadeOutMeanwhileOnceDone;
// @src Tactical/Tactical_Save.cc ChangeNpcToDifferentSector; Tactical/Interface_Dialogue.cc NPC_ACTION_SHOOT_ELLIOT (Elliot's
// @src counter); Strategic/MapScreen.cc (the compression mode lost after a played scene on the map).

import { sectorFromStrategicIndex, sectorShortString } from '../../content/strategic/sector-ids.ts';
import { i8 } from '../../core/int.ts';
import type { SimEvent } from '../events.ts';
import { triggerNpcRecordImmediately } from '../narrative/converse.ts';
import { emptyDialogueQueue } from '../narrative/dialogue-queue.ts';
import { reloadQuoteFile } from '../narrative/records.ts';
import { dialogueQueueIsEmptyAndNobodyIsTalking } from '../narrative/talk-state.ts';
import { ELLIOT_MAX_SLAPS, Meanwhile, Town } from '../strategic/ai/constants.ts';
import {
  handleFirstMeanwhileSetUpWithTrashWorld,
  INTERROGATION_SECTOR,
  MEDUNA_QUEEN_SECTOR,
  meanwhileSceneName,
  processImplicationsOfMeanwhile,
} from '../strategic/ai/meanwhile.ts';
import type { MeanwhileContext, MeanwhileNpcSave, MeanwhileSector } from '../strategic/ai/queen-state.ts';
import { numberOfWholeTownsUnderControlExcluding, townOf } from '../strategic/economy/towns.ts';
import { isThereAFunctionalSamSiteInSector, numberOfSamSitesUnderPlayerControl } from '../strategic/map/sam.ts';
import { Npc } from '../strategic/narrative/npc-ids.ts';
import { changeNpcToDifferentSector } from '../strategic/narrative/presence.ts';
import { CompressMode } from '../strategic/time/constants.ts';
import {
  CompressionStop,
  setGameTimeCompressionLevel,
  stopTimeCompression,
  unLockPauseState,
  unPauseGame,
} from '../strategic/time/world-clock.ts';
import type { CampaignSim } from './campaign-sim.ts';
import type { StoryEventWithoutTick } from './narrative/story-events.ts';

const MEDUNA_SCENE_NPCS: readonly number[] = [Npc.QUEEN, Npc.ELLIOT];
const INTERROGATION_NPCS: readonly number[] = [Npc.QUEEN, Npc.ELLIOT, Npc.JOE];

function sceneNpcs(id: number): readonly number[] {
  if (id === Meanwhile.INTERROGATION) return INTERROGATION_NPCS;
  return id === Meanwhile.OUTSKIRTS_MEDUNA ? [...MEDUNA_SCENE_NPCS, Npc.JOE] : MEDUNA_SCENE_NPCS;
}

function sceneSector(id: number): MeanwhileSector {
  return id === Meanwhile.INTERROGATION ? INTERROGATION_SECTOR : MEDUNA_QUEEN_SECTOR;
}

export class MeanwhileFlow {
  readonly #campaign: CampaignSim;
  readonly #events: SimEvent[] = [];

  constructor(campaign: CampaignSim) {
    this.#campaign = campaign;
  }

  get #state() {
    return this.#campaign.state.meanwhile;
  }

  drainEvents(): SimEvent[] {
    return this.#events.splice(0);
  }

  #emit(e: StoryEventWithoutTick): void {
    this.#events.push({ ...e, tick: this.#campaign.tick } as SimEvent);
  }

  inScene(): boolean {
    return this.#state.inScene;
  }

  sceneView(): { readonly seq: number; readonly scene: string } | null {
    if (!this.#state.inScene) return null;
    return { seq: this.#state.log.length + 1, scene: meanwhileSceneName(this.#state.current.id) };
  }

  #gatesPass(): boolean {
    const c = this.#campaign;
    if (c.battle?.hasPendingDecision()) return false;
    const talk = c.talk?.talk;
    return !talk || dialogueQueueIsEmptyAndNobodyIsTalking(talk);
  }

  afterStep(): void {
    const m = this.#state;
    const flow = this.#campaign.state.flow;
    if (!m.trying || (flow !== 'tactical' && flow !== 'strategic')) return;
    if (!this.#gatesPass()) return;
    m.trying = false;
    if (m.current.id === Meanwhile.INTERROGATION) this.#startInterrogation();
    else this.#resolveMeduna(m.current.id);
  }

  #stopCompressionOnMap(lostMode: boolean): void {
    const c = this.#campaign;
    if (c.state.flow !== 'strategic') return;
    stopTimeCompression(c.clockContext, CompressionStop.MEANWHILE);
    if (lostMode) setGameTimeCompressionLevel(c.clockContext, CompressMode.X0);
  }

  #reloadRecords(profile: number): void {
    const host = this.#campaign.talk?.host;
    if (host) reloadQuoteFile(host, profile);
  }

  setNpcMeanwhile(profile: number, sector: MeanwhileSector): void {
    const p = this.#campaign.narrative.profile(profile);
    if (!p) return;
    this.#state.npcSaves.push({ profile, sector: { x: p.sectorX, y: p.sectorY, z: p.sectorZ }, gridNo: p.gridNo });
    this.#reloadRecords(profile);
    changeNpcToDifferentSector(p, { x: sector.x, y: sector.y, z: 0 });
  }

  restoreNpcMeanwhile(): void {
    const saves: MeanwhileNpcSave[] = this.#state.npcSaves;
    for (const save of saves) {
      const p = this.#campaign.narrative.profile(save.profile);
      if (!p) continue;
      p.sectorX = save.sector.x;
      p.sectorY = save.sector.y;
      p.sectorZ = save.sector.z;
      p.gridNo = i8(save.gridNo);
      this.#reloadRecords(save.profile);
    }
  }

  #elliotData(): number {
    return this.#campaign.narrative.profile(Npc.ELLIOT)?.npcData ?? 0;
  }

  firstBattleTown(): number {
    const ctx = this.#campaign.strategic;
    if (!ctx) return Town.BLANK_SECTOR;
    return townOf(ctx, sectorFromStrategicIndex(this.#campaign.state.economy.firstBattleSector));
  }

  wholeTownsUnderControlExceptOmerta(): number {
    const economy = this.#campaign.economy;
    return economy ? numberOfWholeTownsUnderControlExcluding(economy, Town.OMERTA) : 0;
  }

  samSitesUnderPlayerControl(): number {
    const ctx = this.#campaign.strategic;
    return ctx ? numberOfSamSitesUnderPlayerControl(ctx) : 0;
  }

  functionalSamSiteInLastBattleSector(): boolean {
    const ctx = this.#campaign.strategic;
    const last = this.#campaign.state.battle.lastBattleSector;
    return ctx !== null && last !== null && isThereAFunctionalSamSiteInSector(ctx, { x: last.x, y: last.y, z: 0 });
  }

  #sceneContext(elliotBefore: number, elliotAfter: number): MeanwhileContext {
    const s = this.#campaign.state;
    const town = this.firstBattleTown();
    return {
      wholeTownsExceptOmerta: this.wholeTownsUnderControlExceptOmerta(),
      samSitesControlled: this.samSitesUnderPlayerControl(),
      lastBattleWon: s.battle.lastBattleWon,
      functionalSamInLastBattleSector: this.functionalSamSiteInLastBattleSector(),
      firstBattleTown: town === Town.DRASSEN ? 'drassen' : town === Town.CAMBRIA ? 'cambria' : 'other',
      sciFi: s.options.sciFi,
      elliotBefore,
      elliotAfter,
    };
  }

  #emptyDialogueQueue(): void {
    const host = this.#campaign.talk?.host;
    if (host) emptyDialogueQueue(host);
  }

  #releasePause(): void {
    const clock = this.#campaign.state.clock;
    unLockPauseState(clock);
    unPauseGame(clock);
  }

  #resolveMeduna(id: number): void {
    const c = this.#campaign;
    const q = c.queen;
    const m = this.#state;
    this.#stopCompressionOnMap(true);
    if (q) handleFirstMeanwhileSetUpWithTrashWorld(q);
    m.inScene = true;
    for (const profile of sceneNpcs(id)) this.setNpcMeanwhile(profile, sceneSector(id));
    const elliotBefore = this.#elliotData();
    if (id === Meanwhile.OUTSKIRTS_MEDUNA) this.#shootElliot();
    const context = this.#sceneContext(elliotBefore, this.#elliotData());
    this.#emptyDialogueQueue();
    if (q) processImplicationsOfMeanwhile(q, id);
    m.inScene = false;
    this.#releasePause();
    this.restoreNpcMeanwhile();
    this.#logScene(id, context, 'meanwhile');
  }

  #shootElliot(): void {
    const elliot = this.#campaign.narrative.profile(Npc.ELLIOT);
    if (elliot) elliot.npcData = ELLIOT_MAX_SLAPS;
  }

  #logScene(id: number, context: MeanwhileContext | null, kind: 'meanwhile' | 'interrogation'): number {
    const s = this.#campaign.state;
    const seq = this.#state.log.length + 1;
    this.#state.log.push({ seq, id, at: s.clock.seconds, context });
    const scene = meanwhileSceneName(id);
    if (kind === 'meanwhile')
      this.#emit({ type: 'meanwhile', seq, scene, sector: sectorShortString(sceneSector(id)), at: s.clock.seconds });
    return seq;
  }

  #startInterrogation(): void {
    const c = this.#campaign;
    const m = this.#state;
    const q = c.queen;
    this.#stopCompressionOnMap(false);
    if (q && !c.tactical) handleFirstMeanwhileSetUpWithTrashWorld(q);
    m.inScene = true;
    for (const profile of INTERROGATION_NPCS) this.setNpcMeanwhile(profile, INTERROGATION_SECTOR);
    const seq = m.log.length + 1;
    this.#emit({ type: 'meanwhileStarted', seq, scene: meanwhileSceneName(Meanwhile.INTERROGATION) });
    const loaded = c.sectors?.setCurrentWorldSector({ x: INTERROGATION_SECTOR.x, y: INTERROGATION_SECTOR.y, z: 0 }) ?? false;
    const host = c.talk?.host;
    if (!loaded || !host || !c.talk) {
      this.endMeanwhile();
      return;
    }
    host.setEngaged(true);
    c.talk.talk.referenceCount = 1;
    triggerNpcRecordImmediately(host, m.current.npc, m.current.trigger);
  }

  endMeanwhile(): void {
    const c = this.#campaign;
    const m = this.#state;
    if (!m.inScene) return;
    const q = c.queen;
    const id = m.current.id;
    this.#emptyDialogueQueue();
    if (q) processImplicationsOfMeanwhile(q, id);
    m.inScene = false;
    if (c.talk) {
      c.talk.talk.referenceCount = 0;
      c.talk.host.setEngaged(false);
    }
    this.#releasePause();
    this.restoreNpcMeanwhile();
    const seq = this.#logScene(id, null, 'interrogation');
    this.#emit({ type: 'meanwhileEnded', seq, scene: meanwhileSceneName(id) });
  }
}

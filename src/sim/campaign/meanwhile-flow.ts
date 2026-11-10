// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-16. See LICENSE (SFI-SCLA).
// @src src/game/Strategic/Meanwhile.cc CheckForMeanwhileOKStart, BeginMeanwhileCallBack, StartMeanwhile, SetNPCMeanwhile,
// @src DoneFadeOutMeanwhile, DoneFadeInMeanwhile, EndMeanwhile, RestoreNPCMeanwhile, DoneFadeOutMeanwhileOnceDone;
// @src Tactical/Tactical_Save.cc ChangeNpcToDifferentSector; Strategic/MapScreen.cc (compression stopped after a played
// @src scene on the map); the pending auto-bandage that CheckForMeanwhileOKStart's LeaveTacticalScreen clears
// @src (2026-11-06), with the customizable timer of a won battle's look for someone else (2026-11-07); StartMeanwhile,
// @src DoneFadeOutMeanwhile and DoneFadeOutMeanwhileOnceDone (the round trip to P3_m and back, 2026-11-09);
// @src MessageBoxScreen.cc ExitMsgBox (the box's OK lifts the pause lock and the pause before BeginMeanwhileCallBack),
// @src DoneFadeInMeanwhile (SHOW_ALL_MERCS and the Queen's record 0 for every palace scene), EndMeanwhile (the way back
// @src after its fade, once the step or the command is done), StrategicMap.cc SetCurrentWorldSector
// @src (StopAnyCurrentlyTalkingSpeech as the way back loads the old sector, only in the load branch; EnterSector's
// @src EndMapScreen with no screen pending, which keeps the compression mode of a scene from the map, 2026-11-09),
// @src Tactical/Turn_Based_Input.cc GetKeyboardInput
// @src (Esc ends a meanwhile but the interrogation: DeleteTalkingMenu, EndMeanwhile) (2026-11-09); BringupMeanwhileBox
// @src (OK and Skip for a scene seen before, but the interrogation), BeginMeanwhileCallBack (Skip: the implications, the
// @src pause lock and the pause lifted, nothing else) and EndMeanwhile's SetMeanwhileSceneSeen (2026-11-09);
// @src DoneFadeOutMeanwhile's camera gridno, gusMeanWhileGridNo indexed by ubCurrentMeanWhileId, the meanwhile scheduled
// @src last, and CheckForMeanwhileOKStart's guiOldScreen, which decides whether the game screen is entered after the load
// @src (2026-11-09).

import { NO_NARRATIVE_SCENES, sceneCameraGridNo } from '../../content/narrative/scenes.ts';
import { sectorFromStrategicIndex } from '../../content/strategic/sector-ids.ts';
import { i8 } from '../../core/int.ts';
import type { CommandResult } from '../command.ts';
import type { SimEvent } from '../events.ts';
import { deleteTalkingMenu, shutUpTalkingFace, triggerNpcRecordImmediately } from '../narrative/converse.ts';
import { emptyDialogueQueue } from '../narrative/dialogue-queue.ts';
import { reloadQuoteFile } from '../narrative/records.ts';
import { dialogueQueueIsEmptyAndNobodyIsTalking } from '../narrative/talk-state.ts';
import { Meanwhile, Town } from '../strategic/ai/constants.ts';
import {
  INTERROGATION_SECTOR,
  MEDUNA_QUEEN_SECTOR,
  meanwhileSceneName,
  processImplicationsOfMeanwhile,
} from '../strategic/ai/meanwhile.ts';
import {
  type MeanwhileLogEntry,
  type MeanwhileNpcSave,
  type MeanwhileReturnTrip,
  type MeanwhileSector,
  meanwhileUnderWay,
} from '../strategic/ai/queen-state.ts';
import { numberOfWholeTownsUnderControlExcluding, townOf } from '../strategic/economy/towns.ts';
import { type BattlePrompt, nextPromptId, PromptKind } from '../strategic/forces/battle-state.ts';
import { isThereAFunctionalSamSiteInSector, numberOfSamSitesUnderPlayerControl } from '../strategic/map/sam.ts';
import { Npc } from '../strategic/narrative/npc-ids.ts';
import { changeNpcToDifferentSector } from '../strategic/narrative/presence.ts';
import { CompressionStop, stopTimeCompression, unLockPauseState, unPauseGame } from '../strategic/time/world-clock.ts';
import { setAutoBandagePending } from '../tactical/auto-bandage.ts';
import { refuse } from '../tactical/refusal.ts';
import { setShowAllMercs } from '../tactical/state.ts';
import type { CampaignSim } from './campaign-sim.ts';
import { type InstallationSettings, NO_INSTALLATION } from './installation.ts';
import type { StoryEventWithoutTick } from './narrative/story-events.ts';
import { leaveTacticalScreenForTheMap } from './screens.ts';
import { forgetSomeoneElseInSector } from './someone-else-in-sector.ts';

const MEDUNA_SCENE_NPCS: readonly number[] = [Npc.QUEEN, Npc.ELLIOT];
const INTERROGATION_NPCS: readonly number[] = [Npc.QUEEN, Npc.ELLIOT, Npc.JOE];
const SCRIPTED_SCENE_NPCS: readonly number[] = [Npc.QUEEN, Npc.ELLIOT];
const NO_PALACE_SCENE = 'noPalaceScene';
const NO_PALACE_SCENE_TEXT = 'endMeanwhile (the Esc key) ends a palace meanwhile scene under way; the interrogation cannot be cut short';
const MEANWHILE_SKIP = 'skip';
export const MEANWHILE_CHOICES: readonly string[] = ['ok', MEANWHILE_SKIP];

type MeanwhilePrompt = Extract<BattlePrompt, { readonly kind: typeof PromptKind.MEANWHILE }>;

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
  #installation: InstallationSettings = NO_INSTALLATION;

  constructor(campaign: CampaignSim) {
    this.#campaign = campaign;
  }

  get #state() {
    return this.#campaign.state.meanwhile;
  }

  get installation(): InstallationSettings {
    return this.#installation;
  }

  useInstallation(installation: InstallationSettings): void {
    this.#installation = installation;
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

  underWay(): boolean {
    return meanwhileUnderWay(this.#state);
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
    this.#checkForMeanwhileOkStart();
    this.settle();
  }

  settle(): void {
    const m = this.#state;
    if (m.inScene || m.returnTrip === null) return;
    this.returnFromThePalace();
    this.#emitEnded();
  }

  #checkForMeanwhileOkStart(): void {
    const m = this.#state;
    const flow = this.#campaign.state.flow;
    if (!m.trying || (flow !== 'tactical' && flow !== 'strategic')) return;
    if (!this.#gatesPass()) return;
    m.trying = false;
    setAutoBandagePending(this.#campaign.state.sectorFlow.autoBandage, false);
    forgetSomeoneElseInSector(this.#campaign.state.battle);
    this.#bringUpMeanwhileBox();
  }

  #bringUpMeanwhileBox(): void {
    if (this.#skipOffered()) {
      this.#openBox();
      return;
    }
    this.#releasePause();
    this.#startScene(null);
  }

  #skipOffered(): boolean {
    const id = this.#state.current.id;
    return id !== Meanwhile.INTERROGATION && this.#installation.meanwhileSceneSeen(id);
  }

  #openBox(): void {
    const battle = this.#campaign.state.battle;
    battle.prompt = { id: nextPromptId(battle, PromptKind.MEANWHILE), kind: PromptKind.MEANWHILE };
  }

  answer(prompt: MeanwhilePrompt, choice: string): CommandResult {
    if (!MEANWHILE_CHOICES.includes(choice)) return refuse('badChoice', `choose ${MEANWHILE_CHOICES.map((c) => `'${c}'`).join(' or ')}`);
    this.#campaign.state.battle.prompt = null;
    this.#releasePause();
    const skipped = choice === MEANWHILE_SKIP;
    if (skipped) this.#skipScene(prompt.id);
    else this.#startScene(prompt.id);
    return { ok: true, data: { scene: meanwhileSceneName(this.#state.current.id), skipped } };
  }

  #skipScene(prompt: string): void {
    const q = this.#campaign.queen;
    const id = this.#state.current.id;
    if (q) processImplicationsOfMeanwhile(q, id);
    this.#releasePause();
    const entry = this.#logScene(id, true);
    this.#emit({ type: 'meanwhileSkipped', seq: entry.seq, scene: meanwhileSceneName(id), prompt });
  }

  #startScene(prompt: string | null): void {
    const c = this.#campaign;
    const m = this.#state;
    const id = m.current.id;
    this.#emit({
      type: 'meanwhileStarted',
      seq: m.log.length + 1,
      scene: meanwhileSceneName(id),
      ...this.#sceneCamera(),
      ...(prompt !== null ? { prompt } : {}),
    });
    const loaded = id === Meanwhile.INTERROGATION ? this.#goToTheInterrogation() : this.goToThePalace();
    if (!loaded) m.returnTrip = null;
    const talk = c.talk;
    if (!loaded || !talk || !this.#sceneRecordsLoaded()) {
      this.endMeanwhile();
      return;
    }
    talk.host.setEngaged(true);
    talk.talk.referenceCount = 1;
    const t = c.tactical?.state;
    if (t && id !== Meanwhile.INTERROGATION) setShowAllMercs(t, true);
    triggerNpcRecordImmediately(talk.host, m.current.npc, m.current.trigger);
  }

  #sceneCamera(): { readonly gridNo?: number; readonly mapScreen?: true } {
    const c = this.#campaign;
    const gridNo = sceneCameraGridNo(c.talk?.scenes ?? NO_NARRATIVE_SCENES, this.#state.currentId);
    return { ...(gridNo !== null ? { gridNo } : {}), ...(c.state.flow === 'strategic' ? { mapScreen: true as const } : {}) };
  }

  #sceneRecordsLoaded(): boolean {
    const arrays = this.#campaign.talk?.host.records.arrays;
    return arrays !== undefined && SCRIPTED_SCENE_NPCS.every((profile) => arrays[profile] !== null);
  }

  #stopCompressionOnMap(): void {
    const c = this.#campaign;
    if (c.state.flow === 'strategic') stopTimeCompression(c.clockContext, CompressionStop.MEANWHILE);
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

  #emptyDialogueQueue(): void {
    const host = this.#campaign.talk?.host;
    if (host) emptyDialogueQueue(host);
  }

  #releasePause(): void {
    const clock = this.#campaign.state.clock;
    unLockPauseState(clock);
    unPauseGame(clock);
  }

  #goToTheInterrogation(): boolean {
    this.#stopCompressionOnMap();
    this.#state.inScene = true;
    for (const profile of INTERROGATION_NPCS) this.setNpcMeanwhile(profile, INTERROGATION_SECTOR);
    return this.#campaign.sectors?.setCurrentWorldSector({ x: INTERROGATION_SECTOR.x, y: INTERROGATION_SECTOR.y, z: 0 }) ?? false;
  }

  goToThePalace(): boolean {
    const m = this.#state;
    const id = m.current.id;
    this.#stopCompressionOnMap();
    m.returnTrip = this.#returnTrip();
    m.inScene = true;
    const palace = sceneSector(id);
    for (const profile of sceneNpcs(id)) this.setNpcMeanwhile(profile, palace);
    return this.#campaign.sectors?.setCurrentWorldSector({ x: palace.x, y: palace.y, z: 0 }) ?? false;
  }

  #returnTrip(): MeanwhileReturnTrip {
    const c = this.#campaign;
    const s = c.state;
    const world = c.tactical ? s.worldSector : null;
    return {
      sector: world ? { x: world.x, y: world.y, z: world.z } : null,
      selectedSector: { ...s.map.selectedSector },
      screen: s.flow === 'tactical' ? 'tactical' : 'strategic',
    };
  }

  returnFromThePalace(): void {
    const m = this.#state;
    const trip = m.returnTrip;
    m.returnTrip = null;
    if (trip) this.#restoreTheOldWorld(trip);
    this.restoreNpcMeanwhile();
    if (trip?.screen === 'strategic') leaveTacticalScreenForTheMap(this.#campaign);
  }

  #restoreTheOldWorld(trip: MeanwhileReturnTrip): void {
    const c = this.#campaign;
    if (trip.sector) {
      if (!c.sectors?.isLoaded(trip.sector)) this.#stopAnyCurrentlyTalkingSpeech();
      c.sectors?.setCurrentWorldSector(trip.sector);
    } else c.sectors?.trashWorld();
    c.state.map.selectedSector = { ...trip.selectedSector };
  }

  #stopAnyCurrentlyTalkingSpeech(): void {
    const host = this.#campaign.talk?.host;
    if (host) shutUpTalkingFace(host);
  }

  #logScene(id: number, skipped: boolean): MeanwhileLogEntry {
    const entry = { seq: this.#state.log.length + 1, id, at: this.#campaign.state.clock.seconds, skipped };
    this.#state.log.push(entry);
    return entry;
  }

  #emitEnded(): void {
    const m = this.#state;
    const last = m.log.at(-1);
    if (last) this.#emit({ type: 'meanwhileEnded', seq: last.seq, scene: meanwhileSceneName(last.id) });
  }

  endByThePlayer(): CommandResult {
    const m = this.#state;
    if (!m.inScene || m.current.id === Meanwhile.INTERROGATION)
      return refuse(NO_PALACE_SCENE, `${NO_PALACE_SCENE}: ${NO_PALACE_SCENE_TEXT}`);
    const host = this.#campaign.talk?.host;
    if (host) deleteTalkingMenu(host, 'script');
    this.endMeanwhile();
    return { ok: true };
  }

  endMeanwhile(): void {
    const c = this.#campaign;
    const m = this.#state;
    if (!m.inScene) return;
    const q = c.queen;
    const id = m.current.id;
    this.#emptyDialogueQueue();
    if (q) processImplicationsOfMeanwhile(q, id);
    this.#installation.setMeanwhileSceneSeen(id);
    this.#logScene(id, false);
    m.inScene = false;
    if (c.talk) {
      c.talk.talk.referenceCount = 0;
      c.talk.host.setEngaged(false);
    }
    this.#releasePause();
    const t = c.tactical?.state;
    if (t && id !== Meanwhile.INTERROGATION) setShowAllMercs(t, false);
    if (m.returnTrip !== null) return;
    this.restoreNpcMeanwhile();
    this.#emitEnded();
  }
}

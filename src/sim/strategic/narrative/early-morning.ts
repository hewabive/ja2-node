// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-16. See LICENSE (SFI-SCLA).
// @src src/game/Strategic/Strategic_Event_Handler.cc HandleEarlyMorningEvents; externalized/strategic/NpcPlacementModel.cc
// @src pickPlacementSector; Strategic/Strategic_Event_Handler.h HOSPITAL_SECTOR_*. See docs/25 §4.3.

import { sectorFromId } from '../../../content/strategic/sector-ids.ts';
import { i8 } from '../../../core/int.ts';
import type { ProfileProgress } from '../../tactical/profiles.ts';
import type { SectorPosition } from '../state.ts';
import { Fact } from './fact-ids.ts';
import { type NarrativeState, setFactFalse, setFactTrue } from './facts.ts';
import { Npc } from './npc-ids.ts';
import { type ProfileItems, profileInSector, removeObjectFromProfile, setMoneyInProfile, setProfileSector } from './presence.ts';

const BANDAGED_TODAY = 0x04;
const DONT_ADD_TO_SECTOR = 0x01;
const FATHER_DRUNK_LEVELS = 4;
const FATHER_MOVE_DIE = 2;
const TONY_AWAY_DIE = 4;
const DEVIN_PATIENCE = 3;
const DARREN_DAILY_MONEY = 15000;
const CARMEN_CASH_THRESHOLD = 10000;
const CARMEN_HEAD_REWARD = 10000;
const CARMEN_DAILY_MONEY = 5000;
const DAVE_GAS_DIE = 3;
const BAR_COLUMN = 13;
const ROW_C = 3;
const ROW_D = 4;

const C13: SectorPosition = { x: 13, y: 3, z: 0 };
const D13: SectorPosition = { x: 13, y: 4, z: 0 };
const C5: SectorPosition = { x: 5, y: 3, z: 0 };
const HOSPITAL: SectorPosition = { x: 8, y: 6, z: 0 };

export interface EarlyMorningContext {
  readonly narrative: NarrativeState;
  readonly world: SectorPosition | null;
  readonly items: ProfileItems;
  readonly heads: { readonly first: number; readonly last: number };
  random(n: number): number;
  preRandom(n: number): number;
  profile(id: number): ProfileProgress | null;
  npcOrRpcProfiles(): readonly ProfileProgress[];
  placementSectors(profile: number): readonly number[];
  onPlayerTeam(profile: number): boolean;
  clearDefaultResponses(profile: ProfileProgress): void;
  checkForMissingHospitalSupplies(): void;
}

function worldIs(ctx: EarlyMorningContext, s: SectorPosition): boolean {
  const w = ctx.world;
  return w !== null && w.x === s.x && w.y === s.y && w.z === s.z;
}

function loaded(ctx: EarlyMorningContext, p: ProfileProgress): boolean {
  return profileInSector(p, ctx.world);
}

function pickPlacementSector(ctx: EarlyMorningContext, profile: number): SectorPosition {
  const sectors = ctx.placementSectors(profile);
  return sectorFromId(sectors[ctx.random(sectors.length)] ?? 0);
}

function moveFather(ctx: EarlyMorningContext): void {
  const father = ctx.profile(Npc.FATHER);
  if (father) father.npcData = ctx.random(FATHER_DRUNK_LEVELS);
  else ctx.random(FATHER_DRUNK_LEVELS);
  if (!ctx.random(FATHER_MOVE_DIE) || worldIs(ctx, C13) || worldIs(ctx, D13) || !father) return;
  father.sectorX = BAR_COLUMN;
  father.sectorY = father.sectorY === ROW_C ? ROW_D : ROW_C;
}

function moveTony(ctx: EarlyMorningContext): void {
  const tony = ctx.profile(Npc.TONY);
  if (!tony || tony.lastDateSpokenTo === 0 || worldIs(ctx, C5)) return;
  if (ctx.random(TONY_AWAY_DIE)) {
    setFactFalse(ctx.narrative, Fact.TONY_NOT_AVAILABLE);
    setProfileSector(tony, C5);
  } else {
    setFactTrue(ctx.narrative, Fact.TONY_NOT_AVAILABLE);
    setProfileSector(tony, null);
  }
}

function moveDevin(ctx: EarlyMorningContext): void {
  const devin = ctx.profile(Npc.DEVIN);
  if (devin?.lastDateSpokenTo !== 0) return;
  devin.npcData = i8(devin.npcData + 1);
  if (devin.npcData > DEVIN_PATIENCE && !loaded(ctx, devin)) setProfileSector(devin, pickPlacementSector(ctx, Npc.DEVIN));
}

function moveHamous(ctx: EarlyMorningContext): void {
  const hamous = ctx.profile(Npc.HAMOUS);
  if (!hamous || hamous.life <= 0 || ctx.onPlayerTeam(Npc.HAMOUS) || ctx.onPlayerTeam(Npc.PROF_ICECREAM) || loaded(ctx, hamous)) return;
  const sector = pickPlacementSector(ctx, Npc.HAMOUS);
  setProfileSector(hamous, sector);
  const truck = ctx.profile(Npc.PROF_ICECREAM);
  if (truck) setProfileSector(truck, sector);
}

function emptyPockets(ctx: EarlyMorningContext): void {
  for (const id of [Npc.VINCE, Npc.STEVE, Npc.JENNY]) {
    const p = ctx.profile(id);
    if (p) setMoneyInProfile(ctx.items, p, 0);
  }
  setFactFalse(ctx.narrative, Fact.VINCE_EXPECTING_MONEY);
  const darren = ctx.profile(Npc.DARREN);
  if (!darren) return;
  darren.balance = 0;
  setMoneyInProfile(ctx.items, darren, DARREN_DAILY_MONEY);
}

function carmenCollectsHeads(ctx: EarlyMorningContext, carmen: ProfileProgress): void {
  if (carmen.npcData2 <= 0) return;
  const kept = carmen.money < CARMEN_CASH_THRESHOLD ? 0 : carmen.money;
  setMoneyInProfile(ctx.items, carmen, kept + CARMEN_HEAD_REWARD * carmen.npcData2);
  carmen.npcData2 = 0;
  for (let item = ctx.heads.first; item <= ctx.heads.last && item >= 0; item++) removeObjectFromProfile(ctx.items, carmen, item);
}

function moveCarmen(ctx: EarlyMorningContext): void {
  const carmen = ctx.profile(Npc.CARMEN);
  if (!carmen) return;
  if (carmen.miscFlags2 & DONT_ADD_TO_SECTOR) {
    carmen.miscFlags2 &= ~DONT_ADD_TO_SECTOR;
    setProfileSector(carmen, C13);
    carmenCollectsHeads(ctx, carmen);
    return;
  }
  if (loaded(ctx, carmen)) return;
  setProfileSector(carmen, pickPlacementSector(ctx, Npc.CARMEN));
  if (carmen.money < CARMEN_DAILY_MONEY) setMoneyInProfile(ctx.items, carmen, CARMEN_DAILY_MONEY);
}

export function handleEarlyMorningEvents(ctx: EarlyMorningContext): void {
  for (const p of ctx.npcOrRpcProfiles()) {
    ctx.clearDefaultResponses(p);
    p.miscFlags2 &= ~BANDAGED_TODAY;
  }
  moveFather(ctx);
  moveTony(ctx);
  moveDevin(ctx);
  moveHamous(ctx);
  const rat = ctx.profile(Npc.RAT);
  if (rat && rat.npcData !== 0) setProfileSector(rat, null);
  emptyPockets(ctx);
  moveCarmen(ctx);
  if (ctx.preRandom(DAVE_GAS_DIE) === 0) setFactTrue(ctx.narrative, Fact.DAVE_HAS_GAS);
  else setFactFalse(ctx.narrative, Fact.DAVE_HAS_GAS);
  if (worldIs(ctx, HOSPITAL)) ctx.checkForMissingHospitalSupplies();
}

// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-16. See LICENSE (SFI-SCLA).
// @src src/game/Tactical/Tactical_Save.cc SaveCurrentSectorsInformationToTempItemFile, LoadCurrentSectorsInformationFromTempItemsFile,
// @src LoadAndAddWorldItemsFromTempFile, LoadRottingCorpsesFromTempCorpseFile; Rotting_Corpses.cc AddRottingCorpse (aging);
// @src Enemy_Soldier_Save.cc NewWayOfSavingEnemyAndCivliansToTempFile, NewWayOfLoadingCiviliansFromTempFile;
// @src TileEngine/SaveLoadMap.cc revealed status; SmokeEffects.cc, LightEffects.cc temp files. See docs/16 §5.11, §5.12, §5.14.

import type { MapDoor } from '../../content/formats/map.ts';
import type { DetailedPlacement } from '../../content/formats/placement.ts';
import { WORLD_MAX } from '../../content/world/grid.ts';
import { has, StructureFlags } from '../../content/world/structures.ts';
import { Terrain } from '../../content/world/terrain.ts';
import { cloneObject, type ItemObject, objectToRecord } from '../items/object.ts';
import { addCorpseStructure, type Corpse } from '../tactical/combat/death.ts';
import { isDoorOpenAt, swapStructureForPartner } from '../tactical/doors.ts';
import { restoreLightEffect } from '../tactical/explosions/light.ts';
import { restoreSmokeCloud } from '../tactical/explosions/smoke.ts';
import { findSoldierInitNodeBySoldier, type SoldierInitNode } from '../tactical/init-list.ts';
import { applyMapChanges, type MapChange } from '../tactical/map-changes.ts';
import { NO_PROFILE, type Soldier, TEAM_FIRST_ID, TEAM_SIZES, Team } from '../tactical/soldier.ts';
import type { TacticalState } from '../tactical/state.ts';
import { addItemToPool, Visibility, WorldItemFlags } from '../tactical/world-items.ts';

export interface DiffWorldItem {
  readonly exists: boolean;
  readonly gridNo: number;
  readonly level: number;
  readonly object: ItemObject;
  readonly flags: number;
  readonly zHeight: number;
  readonly visible: number;
}

export interface DiffDoorStatus {
  readonly gridNo: number;
  readonly open: boolean;
  readonly perceivedOpen: boolean;
}

export interface DiffSmoke {
  readonly gridNo: number;
  readonly item: number;
  readonly type: number;
  readonly duration: number;
  readonly radius: number;
  readonly age: number;
  readonly flags: number;
  readonly lastUpdate: number;
}

export interface DiffLight {
  readonly gridNo: number;
  readonly radius: number;
  readonly duration: number;
  readonly age: number;
  readonly lastUpdate: number;
}

export interface PreservedSoldiers {
  readonly savedMinute: number;
  readonly links: readonly (readonly [number, number])[];
  readonly records: readonly DetailedPlacement[];
}

export interface RevealedState {
  readonly revealed: Uint8Array;
  readonly roomHidden: Uint8Array;
}

export interface SectorDiff {
  items: DiffWorldItem[] | null;
  corpses: Corpse[] | null;
  mapChanges: MapChange[] | null;
  doorTable: MapDoor[] | null;
  revealed: RevealedState | null;
  doorStatus: DiffDoorStatus[] | null;
  enemies: PreservedSoldiers | null;
  civilians: PreservedSoldiers | null;
  smoke: DiffSmoke[] | null;
  lights: DiffLight[] | null;
}

export function emptySectorDiff(): SectorDiff {
  return {
    items: null,
    corpses: null,
    mapChanges: null,
    doorTable: null,
    revealed: null,
    doorStatus: null,
    enemies: null,
    civilians: null,
    smoke: null,
    lights: null,
  };
}

export interface SectorKeyed {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

export function sectorKey(s: SectorKeyed): string {
  return `${s.x},${s.y},${s.z}`;
}

export const ROTTING_STAGE2 = 44;
const LAST_FRESH_MERC_CORPSE = 24;
const DELAY_UNTIL_ROTTING_MINUTES = 1440;
const DELAY_UNTIL_DONE_ROTTING_MINUTES = 3 * 1440;
const INDOOR_CORPSE_MAX_AGE_MINUTES = 30;
const CIVILIAN_HEAL_MINUTES_PER_POINT = 15;

export function captureWorldItems(t: TacticalState): DiffWorldItem[] {
  return t.worldItems.map((wi) => ({
    exists: true,
    gridNo: wi.gridNo,
    level: wi.level,
    object: cloneObject(wi.object),
    flags: wi.flags,
    zHeight: wi.zHeight,
    visible: wi.visible,
  }));
}

export function visibleItemCount(items: readonly DiffWorldItem[]): number {
  let n = 0;
  for (const wi of items) if (wi.exists && wi.visible === Visibility.VISIBLE) n += wi.object.count;
  return n;
}

export function captureDoorStatus(t: TacticalState): DiffDoorStatus[] {
  return [...t.doorStatus.entries()].map(([gridNo, status]) => ({
    gridNo,
    open: isDoorOpenAt(t, gridNo),
    perceivedOpen: status.perceivedOpen,
  }));
}

export function captureRevealed(t: TacticalState): RevealedState {
  return { revealed: Uint8Array.from(t.fog.revealed), roomHidden: Uint8Array.from(t.fog.roomHidden) };
}

export function captureSmoke(t: TacticalState): DiffSmoke[] {
  const out: DiffSmoke[] = [];
  for (const c of t.explosives.smokeClouds) {
    if (!c) continue;
    out.push({
      gridNo: c.gridNo,
      item: c.item,
      type: c.type,
      duration: c.duration,
      radius: c.radius,
      age: c.age,
      flags: c.flags,
      lastUpdate: c.lastUpdate,
    });
  }
  return out;
}

export function captureLights(t: TacticalState): DiffLight[] {
  const out: DiffLight[] = [];
  for (const l of t.explosives.lights) {
    if (!l) continue;
    out.push({ gridNo: l.gridNo, radius: l.radius, duration: l.duration, age: l.age, lastUpdate: l.lastUpdate });
  }
  return out;
}

function teamIds(first: number, last: number): number[] {
  const from = TEAM_FIRST_ID[first] ?? 0;
  const to = (TEAM_FIRST_ID[last] ?? 0) + (TEAM_SIZES[last] ?? 0);
  return Array.from({ length: to - from }, (_, k) => from + k);
}

function preservable(t: TacticalState, id: number): { soldier: Soldier; node: SoldierInitNode } | null {
  const s = t.soldiers[id];
  if (!s?.placed || s.life === 0 || s.profile !== NO_PROFILE) return null;
  const node = findSoldierInitNodeBySoldier(t, s);
  return node ? { soldier: s, node } : null;
}

function preservedRecord(t: TacticalState, s: Soldier, node: SoldierInitNode): DetailedPlacement {
  const useCurrent = t.pre.int(2) !== 0;
  const previous = node.detail;
  const st = s.stats;
  return {
    isStatic: previous?.isStatic ?? false,
    profile: NO_PROFILE,
    direction: s.direction,
    insertionGridNo: useCurrent ? s.gridNo : node.basic.startingGridNo,
    team: s.team,
    bodyType: s.bodyType,
    attitude: s.ai.attitude,
    orders: s.ai.orders,
    stats: {
      lifeMax: s.lifeMax,
      life: s.life,
      agility: st.agility,
      dexterity: st.dexterity,
      experience: st.experience,
      marksmanship: st.marksmanship,
      medical: st.medical,
      mechanical: st.mechanical,
      explosives: st.explosives,
      leadership: st.leadership,
      strength: st.strength,
      wisdom: st.wisdom,
      morale: s.morale,
      aiMorale: s.ai.morale,
    },
    inventory: s.inv.map(objectToRecord),
    palettes: { hair: s.palettes.hair, pants: s.palettes.pants, vest: s.palettes.vest, skin: s.palettes.skin },
    patrolGrid: [...s.ai.patrolGrid],
    patrolCount: s.ai.patrolCount,
    visible: previous?.visible ?? false,
    name: s.name,
    soldierClass: s.soldierClass,
    onRoof: useCurrent ? s.level > 0 : node.basic.onRoof,
    civilianGroup: s.civilianGroup,
    scheduleId: previous?.scheduleId ?? 0,
    hasKeys: s.hasKeys,
  };
}

export function preserveSoldiers(t: TacticalState, enemies: boolean, nowMinute: number): PreservedSoldiers | null {
  const ids = enemies ? teamIds(Team.ENEMY, Team.CREATURE) : teamIds(Team.CIV, Team.CIV);
  const kept = ids.map((id) => preservable(t, id)).filter((x): x is { soldier: Soldier; node: SoldierInitNode } => x !== null);
  if (kept.length === 0) return null;
  for (const { soldier, node } of kept) {
    node.detail = preservedRecord(t, soldier, node);
    node.detailed = true;
  }
  const links = t.initList.map((n) => [n.index, n.hasSoldier && t.soldiers[n.soldierId]?.placed ? n.soldierId : 0] as const);
  const records = kept.map(({ node }) => node.detail as DetailedPlacement);
  return { savedMinute: nowMinute, links, records };
}

export function restoreWorldItems(t: TacticalState, items: readonly DiffWorldItem[], centerGridNo: number): void {
  t.worldItems.length = 0;
  for (const wi of items) {
    if (!wi.exists) continue;
    const gridNo = wi.flags & WorldItemFlags.GRIDNO_NOT_SET_USE_ENTRY_POINT ? centerGridNo : wi.gridNo;
    addItemToPool(t, gridNo, wi.object, wi.visible, wi.level, wi.flags, wi.zHeight);
  }
}

export interface CorpseAging {
  readonly nowMinute: number;
  readonly inTown: boolean;
  readonly loadingSave: boolean;
}

export function agedCorpse(corpse: Corpse, nowMinute: number, loadingSave: boolean): Corpse | null {
  if (loadingSave) return corpse;
  const age = nowMinute - corpse.timeOfDeath;
  if (age > DELAY_UNTIL_DONE_ROTTING_MINUTES) return null;
  if (age > DELAY_UNTIL_ROTTING_MINUTES && corpse.type < ROTTING_STAGE2 && corpse.type <= LAST_FRESH_MERC_CORPSE)
    return { ...corpse, type: ROTTING_STAGE2 };
  return corpse;
}

export function restoreCorpses(t: TacticalState, corpses: readonly Corpse[], aging: CorpseAging): void {
  t.corpses.length = 0;
  const maybeDrop = !aging.loadingSave && aging.inTown;
  for (const c of corpses) {
    if (c.gridNo < 0 || c.gridNo >= WORLD_MAX) continue;
    const indoors = t.world.terrain[c.gridNo] === Terrain.FLAT_FLOOR;
    if (maybeDrop && indoors && aging.nowMinute - c.timeOfDeath >= INDOOR_CORPSE_MAX_AGE_MINUTES) continue;
    const corpse = agedCorpse(c, aging.nowMinute, aging.loadingSave);
    if (!corpse) continue;
    t.corpses.push(corpse);
    addCorpseStructure(t, corpse.gridNo, corpse.level, corpse.type, corpse.direction);
  }
}

export function restoreRevealed(t: TacticalState, revealed: RevealedState): void {
  t.fog.revealed.set(revealed.revealed);
  t.fog.roomHidden.set(revealed.roomHidden);
}

export function restoreDoorStatus(t: TacticalState, statuses: readonly DiffDoorStatus[]): void {
  t.doorStatus.clear();
  for (const d of statuses) {
    t.doorStatus.set(d.gridNo, { perceivedOpen: d.perceivedOpen });
    const door = t.world.structures.find(d.gridNo, StructureFlags.ANYDOOR);
    if (!door || has(door.flags, StructureFlags.OPEN) === d.open) continue;
    const base = t.world.structures.findBase(door);
    if (base) swapStructureForPartner(t, base);
  }
}

export function restoreSmoke(t: TacticalState, smoke: readonly DiffSmoke[]): void {
  t.explosives.smokeClouds.length = 0;
  for (const s of smoke) restoreSmokeCloud(t, { ...s, owner: null });
}

export function restoreLights(t: TacticalState, lights: readonly DiffLight[]): void {
  t.explosives.lights.length = 0;
  for (const l of lights) restoreLightEffect(t, l);
}

export function restoreMapChanges(t: TacticalState, changes: readonly MapChange[]): void {
  applyMapChanges(t, changes);
}

function applyPreservedRecord(node: SoldierInitNode, record: DetailedPlacement): void {
  node.priorityExistence = true;
  node.detailed = true;
  node.basic.direction = record.direction;
  node.basic.orders = record.orders;
  node.basic.attitude = record.attitude;
  node.basic.bodyType = record.bodyType;
  node.basic.onRoof = record.onRoof;
  node.soldierClass = record.soldierClass;
  node.basic.civilianGroup = record.civilianGroup;
  node.basic.hasKeys = record.hasKeys;
  if (record.insertionGridNo >= 0 && record.insertionGridNo < WORLD_MAX) node.basic.startingGridNo = record.insertionGridNo;
  const count = Math.max(record.patrolCount, 0);
  node.basic.patrolCount = record.patrolCount;
  node.basic.patrolGrid = [...record.patrolGrid.slice(0, count), ...node.basic.patrolGrid.slice(count)];
  node.detail = { ...record, insertionGridNo: node.basic.startingGridNo };
}

export function applyPreservedEnemyRecord(node: SoldierInitNode, record: DetailedPlacement): void {
  applyPreservedRecord(node, record);
}

export function loadPreservedCivilians(t: TacticalState, preserved: PreservedSoldiers, nowMinute: number): void {
  if (preserved.records.length === 0) return;
  for (const n of t.initList) if (n.priorityExistence && n.team === Team.CIV) n.priorityExistence = false;
  const minutesAway = nowMinute - preserved.savedMinute;
  let lastTeam: number = Team.CIV;
  for (const record of preserved.records) {
    lastTeam = record.team;
    for (const node of t.initList) {
      if (node.priorityExistence || node.team !== record.team) continue;
      if (node.detail && node.detail.profile !== NO_PROFILE) continue;
      const healed =
        record.stats.life < record.stats.lifeMax
          ? Math.min(record.stats.life + Math.trunc(minutesAway / CIVILIAN_HEAL_MINUTES_PER_POINT), record.stats.lifeMax)
          : record.stats.life;
      applyPreservedRecord(node, { ...record, stats: { ...record.stats, life: healed } });
      if (node.team === Team.CIV) break;
    }
  }
  t.initList = t.initList.filter(
    (n) => n.priorityExistence || n.team !== lastTeam || (n.detail !== null && n.detail.profile !== NO_PROFILE),
  );
}

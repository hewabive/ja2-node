// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-15. See LICENSE (SFI-SCLA).
// @src src/game/Tactical/OppList.cc MovementNoise, DoorOpeningNoise, MakeNoise, ProcessNoise, CalcEffVolume, DecideHearing,
// @src HearNoise, TellPlayerAboutNoise (with QUOTE_HEARD_SOMETHING); Overhead.cc TeamMemberNear; SkillCheck.cc
// @src EffectiveExpLevel, EffectiveDexterity.

import { pythSpacesAway, WORLD_COLS } from '../../../content/world/grid.ts';
import { Terrain } from '../../../content/world/terrain.ts';
import { idiv, u8 } from '../../../core/int.ts';
import { endHeight, states } from '../animation.ts';
import { losWorldOf, soldierToSoldierLos } from '../combat/positions.ts';
import { findObjWithin, InvSlot, NUM_INV_SLOTS, wearsHeadGear } from '../inventory.ts';
import { directionToward } from '../movement.ts';
import { isWater } from '../pathfinding.ts';
import { effectiveDexterity, effectiveExpLevel, effectiveLife } from '../skills.ts';
import { AlertStatus, Body, isMonster, isTank, NO_INTERRUPT, numSkillTraits, OKLIFE, SkillTrait, type Soldier, Team } from '../soldier.ts';
import type { TacticalState } from '../state.ts';
import { InterruptKind, resolveInterruptsVs } from '../turns/turns.ts';
import { keptApartInBloodcatArena } from './bloodcat-arena.ts';
import { AUTOMATIC_INTERRUPT, calcInterruptDuelPts, standardInterruptConditionsMet } from './duel.ts';
import { type HeightClass, soldierToLocationLineOfSight } from './los.ts';
import { Caller, SightFlags } from './opp.ts';
import {
  addDoorNoiseSighting,
  atan8,
  distanceVisible,
  hostile,
  manSeesMan,
  Opp,
  ourTeamRadiosRandomlyAbout,
  publicOpp,
  resolveBestSightingAfterNoise,
  seesMuzzleFlashWithoutTurning,
  updatePersonal,
  updatePublic,
  validForSightings,
} from './sight.ts';

export const NoiseKind = {
  UNKNOWN: 0,
  MOVEMENT: 1,
  CREAKING: 2,
  SPLASHING: 3,
  BULLET_IMPACT: 4,
  GUNFIRE: 5,
  EXPLOSION: 6,
  SCREAM: 7,
  ROCK_IMPACT: 8,
  GRENADE_IMPACT: 9,
  WINDOW_SMASHING: 10,
  DOOR_SMASHING: 11,
  SILENT_ALARM: 12,
} as const;

const HIDDEN_SOURCE_KINDS: ReadonlySet<number> = new Set([
  NoiseKind.ROCK_IMPACT,
  NoiseKind.BULLET_IMPACT,
  NoiseKind.GRENADE_IMPACT,
  NoiseKind.EXPLOSION,
]);
const UNTOLD_KINDS: ReadonlySet<number> = new Set([
  NoiseKind.GUNFIRE,
  NoiseKind.BULLET_IMPACT,
  NoiseKind.ROCK_IMPACT,
  NoiseKind.GRENADE_IMPACT,
  NoiseKind.SILENT_ALARM,
]);
const WAKING_NOISE_KINDS: ReadonlySet<number> = new Set([
  NoiseKind.BULLET_IMPACT,
  NoiseKind.GUNFIRE,
  NoiseKind.EXPLOSION,
  NoiseKind.SCREAM,
  NoiseKind.WINDOW_SMASHING,
  NoiseKind.DOOR_SMASHING,
]);
const MAX_NOISE_VOLUME = 12;
const DOOR_NOISE_VOLUME = 2;
const MAX_MOVEMENT_NOISE = 9;
const STEALTH_PER_MOVEMENT_NOISE = 16;
const BLOODCAT_STEALTH_BONUS = 50;
const STEALTHY_TRAIT_BONUS = 25;
const RED_ALERT_VOLUME = 3;
const IRRELEVANT = -1;
const NO_ITEM = -2;

function stealthRollWithSecondChance(t: TacticalState, stealth: number): number {
  const first = t.pre.int(100);
  return first < stealth ? first : t.pre.int(100);
}

export function movementNoise(t: TacticalState, s: Soldier): number {
  if (s.team === Team.ENEMY) return MAX_MOVEMENT_NOISE - t.pre.int(2);
  let stealth = 20 + 4 * effectiveExpLevel(s) + idiv(effectiveDexterity(s) * 4, 10);
  stealth += s.bodyType === Body.BLOODCAT ? BLOODCAT_STEALTH_BONUS : STEALTHY_TRAIT_BONUS * numSkillTraits(s, SkillTrait.STEALTHY);
  const life = effectiveLife(s);
  if (life < 50) stealth -= idiv(stealth * (50 - life), 100);
  if (s.breath < 50) stealth -= idiv(stealth * (50 - s.breath), 100);
  if (isWater(t.pathWorld, s.gridNo)) stealth -= s.overTerrain === Terrain.DEEP_WATER ? 20 : 10;
  stealth = Math.max(stealth, 0);
  const st = states(t.content.animations);
  if (!s.stealthMode) {
    let max = u8(MAX_MOVEMENT_NOISE - idiv(stealth, STEALTH_PER_MOVEMENT_NOISE));
    if (isWater(t.pathWorld, s.gridNo)) max++;
    if (s.state === st.CRAWLING) max = max <= 2 ? 0 : max - 2;
    else if (s.state === st.SWATTING) max = max <= 1 ? 0 : max - 1;
    else if (s.state === st.RUNNING) max += 3;
    return max < 2 ? max : 1 + t.pre.int(max);
  }
  const roll = stealthRollWithSecondChance(t, stealth);
  if (roll < stealth) return 0;
  let volume = 1 + idiv(roll - stealth + 1, STEALTH_PER_MOVEMENT_NOISE);
  if (s.state === st.CRAWLING) volume = volume <= 2 ? 0 : volume - 2;
  else if (s.state === st.SWATTING) volume -= 1;
  else if (s.state === st.RUNNING) volume += 3;
  return volume;
}

export function doorOpeningNoise(t: TacticalState, s: Soldier): number {
  return movementNoise(t, s) === 0 ? 0 : DOOR_NOISE_VOLUME;
}

const TANK_HEARING = -5;
const MONSTER_HEARING = -10;
const EAR_STATUS_PER_HEARING = 20;

const itemIndex = (t: TacticalState, name: string) => t.content.items.byName.get(name)?.index ?? NO_ITEM;

function extendedEarHearing(t: TacticalState, s: Soldier): number {
  const slot = findObjWithin(s.inv, itemIndex(t, 'EXTENDEDEAR'), 0, NUM_INV_SLOTS - 1);
  if (slot !== InvSlot.HEAD1 && slot !== InvSlot.HEAD2) return 0;
  return idiv(s.inv[slot]?.status[0] ?? 0, EAR_STATUS_PER_HEARING) + 1;
}

function darknessHearing(t: TacticalState, s: Soldier): number {
  const ambient = t.lighting.ambient;
  if (ambient === 8 || ambient === 9) return 1;
  if (ambient === 10) return 2;
  if (ambient >= 11 && ambient <= 15) return 3 + numSkillTraits(s, SkillTrait.NIGHTOPS);
  return 0;
}

function decideHearing(t: TacticalState, s: Soldier): number {
  if (isTank(s)) return TANK_HEARING;
  if (isMonster(s)) return MONSTER_HEARING;
  const experienced = s.stats.experience > 3 ? 1 : 0;
  return experienced + numSkillTraits(s, SkillTrait.NIGHTOPS) + extendedEarHearing(t, s) + darknessHearing(t, s);
}

function calcEffVolume(t: TacticalState, l: Soldier, g: number, level: number, base: number, sourceTerrain: number): number {
  if (wearsHeadGear(l.inv, itemIndex(t, 'WALKMAN'))) return 0;
  if (t.inCombat && t.turn.currentTeam === l.team) return 0;
  let eff = base + decideHearing(t, l) - l.ai.oppCount - (pythSpacesAway(l.gridNo, g) - 1);
  if (l.state === states(t.content.animations).RUNNING) eff -= 5;
  if (level > l.level) eff += 5;
  else if (level < l.level) eff -= 5;
  if (eff > 0 && (l.overTerrain === Terrain.FLAT_FLOOR) !== (sourceTerrain === Terrain.FLAT_FLOOR)) eff -= 5;
  return Math.max(eff, 0);
}

const SIGHTINTERRUPT_READ_AS_LOOK_FLAG = SightFlags.LOOK;

function raiseToRed(t: TacticalState, l: Soldier): void {
  if (l.ai.alertStatus < AlertStatus.RED) {
    l.ai.alertStatus = AlertStatus.RED;
    t.perceptionHooks.checkForChangingOrders(l);
  }
}

function rememberNoise(t: TacticalState, l: Soldier, g: number, level: number, volume: number): void {
  if (volume < l.ai.noiseVolume) return;
  l.ai.noiseGridNo = g;
  l.ai.noiseLevel = level;
  l.ai.noiseVolume = Math.min(volume, MAX_NOISE_VOLUME);
  t.perceptionHooks.setNewSituation(l);
}

function hearNoise(t: TacticalState, l: Soldier, source: Soldier | null, g: number, level: number, volume: number, kind: number): boolean {
  const noiseDirection = atan8(Math.trunc(l.x), Math.trunc(l.y), (g % WORLD_COLS) * 10 + 5, idiv(g, WORLD_COLS) * 10 + 5);
  const flashInView = kind !== NoiseKind.GUNFIRE || !source?.muzzleFlash || seesMuzzleFlashWithoutTurning(l, noiseDirection);
  const d = distanceVisible(t, l, IRRELEVANT, IRRELEVANT, g, level, flashInView);
  const losWorld = losWorldOf(t);
  const eye = {
    gridNo: l.gridNo,
    level: l.level,
    heightClass: endHeight(t.content, l.state) as (typeof HeightClass)[keyof typeof HeightClass],
  };
  const occupant = t.occupant[level > 0 ? 1 : 0][g] ?? -1;
  const target = occupant >= 0 ? t.soldiers[occupant] : undefined;
  const hadToTurn = l.direction !== noiseDirection;
  let sourceSeen = false;
  if (pythSpacesAway(l.gridNo, g) <= d) {
    const los = target
      ? soldierToSoldierLos(t, l, target, u8(d), true)
      : soldierToLocationLineOfSight(losWorld, eye, g, level, u8(d), t.perception.disallowSight);
    sourceSeen = los !== 0;
  }
  const hooks = t.perceptionHooks;
  let seen = false;
  if (source) {
    const oldOpp = l.oppList[source.id] ?? 0;
    const gunshot = (kind === NoiseKind.GUNFIRE || kind === NoiseKind.BULLET_IMPACT) && volume >= RED_ALERT_VOLUME;
    if (sourceSeen) {
      manSeesMan(t, l, source, Caller.UNKNOWN);
      if (l.team !== Team.OUR) l.newOppCnt = 0;
      seen = true;
      if (l.neutral && gunshot) raiseToRed(t, l);
    } else {
      hooks.setNewSituation(l);
      if (gunshot) raiseToRed(t, l);
      updatePersonal(l, source, Opp.HEARD_THIS_TURN, g, level);
      rememberNoise(t, l, g, level, volume);
    }
    if (l.ai.asleep && WAKING_NOISE_KINDS.has(kind)) l.ai.asleep = false;
    if (hostile(l, source)) {
      if (t.turn.delayResolvingBestSightingDueToDoor) {
        if (
          sourceSeen &&
          (!t.inCombat || (t.turn.sightFlags & SIGHTINTERRUPT_READ_AS_LOOK_FLAG && standardInterruptConditionsMet(t, l, source, oldOpp)))
        ) {
          const points = calcInterruptDuelPts(t, l, source, true);
          if (points !== NO_INTERRUPT && (l.team !== Team.OUR || source.life >= OKLIFE))
            addDoorNoiseSighting(t, l, u8(points + idiv(volume, 2)));
        }
      } else if (t.inCombat) {
        l.interruptDuelPts = standardInterruptConditionsMet(t, l, source, oldOpp) ? calcInterruptDuelPts(t, l, source, true) : NO_INTERRUPT;
      } else if (sourceSeen) resolveBestSightingAfterNoise(t);
    }
  } else {
    if (l.team !== Team.OUR && (kind === NoiseKind.EXPLOSION || kind === NoiseKind.SILENT_ALARM) && volume >= RED_ALERT_VOLUME)
      raiseToRed(t, l);
    if (!sourceSeen || (kind === NoiseKind.ROCK_IMPACT && hadToTurn) || kind === NoiseKind.SILENT_ALARM)
      rememberNoise(t, l, g, level, volume);
    else {
      hooks.setNewSituation(l);
      raiseToRed(t, l);
    }
  }
  if (t.perception.bestSize === 0 && t.inCombat && kind === NoiseKind.ROCK_IMPACT) {
    l.interruptDuelPts = standardInterruptConditionsMet(t, l, null, 0) ? AUTOMATIC_INTERRUPT : NO_INTERRUPT;
  }
  return seen;
}

const STRAIGHT = 13;
const FAINT = 0;
const HEARD_SOMETHING_QUOTE = 6;
const HEARD_NOISE_PAUSE_TURNS_IN_COMBAT = 2;
const HEARD_NOISE_PAUSE_TURNS = 5;
const DIRECTION_AT_ANY_LEVEL: ReadonlySet<number> = new Set([
  NoiseKind.EXPLOSION,
  NoiseKind.SCREAM,
  NoiseKind.ROCK_IMPACT,
  NoiseKind.GRENADE_IMPACT,
]);

const isVehicle = (s: Soldier) => s.bodyType >= Body.HUMVEE && s.bodyType <= Body.JEEP;
const gassed = (t: TacticalState, s: Soldier) => (t.explosives.gassed[s.id] ?? 0) !== 0;

function listens(l: Soldier): boolean {
  return validForSightings(l) && l.life >= OKLIFE && l.bodyType !== Body.LARVAE_MONSTER && !(l.team === Team.OUR && isVehicle(l));
}

function teamMemberNear(t: TacticalState, team: number, g: number, range: number): boolean {
  return t.soldiers.some((s) => s?.placed && s.team === team && s.life >= OKLIFE && !gassed(t, s) && pythSpacesAway(s.gridNo, g) <= range);
}

export type HeardDirection = number | 'above' | 'below';

function heardDirection(kind: number, level: number, listener: Soldier, direction: number): HeardDirection {
  if (level === listener.level || DIRECTION_AT_ANY_LEVEL.has(kind)) return direction;
  return level > listener.level ? 'above' : 'below';
}

function tellPlayerAboutNoise(t: TacticalState, by: Soldier, level: number, eff: number, kind: number, direction: number): void {
  const loudness = volumeClass(eff);
  t.events.push({
    type: 'noiseHeard',
    listener: by.id,
    kind,
    volumeClass: loudness,
    direction: heardDirection(kind, level, by, direction),
  });
  if (loudness !== FAINT || t.narrative.inMeanwhile() || t.engagedInConv || by.turnsUntilCanSayHeardNoise !== 0) return;
  t.narrative.sayQuote(by, HEARD_SOMETHING_QUOTE);
  by.turnsUntilCanSayHeardNoise = t.inCombat ? HEARD_NOISE_PAUSE_TURNS_IN_COMBAT : HEARD_NOISE_PAUSE_TURNS;
}

export interface Heard {
  readonly by: number;
  readonly direction: HeardDirection;
  readonly volumeClass: number;
}

export function squadHears(t: TacticalState, g: number, level: number, base: number, kind: number): Heard | null {
  if (base === 0) return null;
  const sourceTerrain = t.world.terrain[g] ?? 0;
  let loudest = 0;
  let by: Soldier | null = null;
  for (const l of teamMembersById(t, Team.OUR)) {
    if (!l.placed || !listens(l)) continue;
    const eff = calcEffVolume(t, l, g, level, base, sourceTerrain);
    if (eff > loudest) {
      loudest = eff;
      by = l;
    }
  }
  if (!by) return null;
  return { by: by.id, direction: heardDirection(kind, level, by, directionToward(by.gridNo, g)), volumeClass: volumeClass(loudest) };
}

function teamMembersById(t: TacticalState, team: number): Soldier[] {
  return t.soldiers.filter((s): s is Soldier => s?.team === team).sort((a, b) => a.id - b.id);
}

function volumeClass(eff: number): number {
  if (eff >= 12) return 3;
  if (eff >= 8) return 2;
  if (eff >= 4) return 1;
  return 0;
}

export function makeNoise(t: TacticalState, maker: Soldier | null, g: number, level: number, base: number, kind: number): void {
  if (t.turn.attackBusyCount > 0) {
    t.turn.deferredNoises.push({ maker: maker?.id ?? -1, gridNo: g, level, volume: base, kind });
    return;
  }
  ourNoise(t, maker, g, level, base, kind);
}

export function dequeueDeferredNoises(t: TacticalState): void {
  for (const n of t.turn.deferredNoises.splice(0))
    ourNoise(t, n.maker >= 0 ? (t.soldiers[n.maker] ?? null) : null, n.gridNo, n.level, n.volume, n.kind);
}

function ourNoise(t: TacticalState, maker: Soldier | null, g: number, level: number, base: number, kind: number): void {
  processNoise(t, maker, g, level, base, kind);
  if (maker && t.inCombat && !t.turn.delayResolvingBestSightingDueToDoor) resolveInterruptsVs(t, maker, InterruptKind.NOISE);
}

function makesNoNoise(maker: Soldier, kind: number): boolean {
  if (kind === NoiseKind.EXPLOSION) return false;
  if (!maker.placed || maker.dead) return true;
  return maker.life === 0 && kind !== NoiseKind.SCREAM;
}

function processNoise(t: TacticalState, maker: Soldier | null, g: number, level: number, base: number, kind: number): void {
  if (base === 0) return;
  if (maker && makesNoNoise(maker, kind)) return;
  const sourceTerrain = t.world.terrain[g] ?? 0;
  const source = HIDDEN_SOURCE_KINDS.has(kind) ? null : maker;
  const placed = t.soldiers.filter((s) => s?.placed);
  const enemyInSector = placed.some((s) => s.team !== Team.OUR && s.team !== Team.MILITIA && !s.neutral && s.life >= OKLIFE);
  for (let team = 0; team <= 5; team++) {
    const members = placed.filter((s) => s.team === team);
    if (members.length === 0) continue;
    if (maker && (team === maker.team || (team === Team.OUR && publicOpp(t, team, maker) === Opp.SEEN_CURRENTLY))) continue;
    let tell = enemyInSector && (!t.inCombat || t.turn.currentTeam !== Team.OUR);
    if (UNTOLD_KINDS.has(kind)) tell = false;
    if (kind === NoiseKind.EXPLOSION && teamMemberNear(t, team, g, STRAIGHT)) tell = false;
    if (maker) {
      const known = publicOpp(t, team, maker);
      if (known === Opp.SEEN_CURRENTLY || known === Opp.SEEN_THIS_TURN || known === Opp.HEARD_THIS_TURN || maker.life === 0) tell = false;
    }
    let heard = false;
    let seen = false;
    let loudest = 0;
    let by: Soldier | null = null;
    let loudestDir = 0;
    let lastListenerDirection = 0;
    for (const l of members.sort((a, b) => a.id - b.id)) {
      if (!listens(l)) continue;
      if (maker) {
        if (l.oppList[maker.id] === Opp.SEEN_CURRENTLY && !(l.neutral && kind === NoiseKind.GUNFIRE)) continue;
        if (l.team === Team.MILITIA && maker.team === Team.OUR) continue;
        if (l.team === Team.OUR && maker.team === Team.MILITIA) continue;
        if (keptApartInBloodcatArena(t, l, maker)) continue;
      }
      if (l.team === Team.CIV && (kind === NoiseKind.GUNFIRE || kind === NoiseKind.EXPLOSION)) l.heardGunshot = true;
      const eff = calcEffVolume(t, l, g, level, base, sourceTerrain);
      if (eff <= 0) continue;
      if (hearNoise(t, l, source, g, level, eff, kind)) seen = true;
      heard = true;
      const dir = directionToward(l.gridNo, g);
      lastListenerDirection = dir;
      if (kind !== NoiseKind.MOVEMENT || team !== Team.OUR || l.interruptDuelPts !== NO_INTERRUPT || !(l.movementNoiseHeard & (1 << dir))) {
        if (eff > loudest) {
          loudest = eff;
          by = l;
          loudestDir = dir;
        }
      }
    }
    if (heard && team === Team.OUR && tell && by) {
      tellPlayerAboutNoise(t, by, level, loudest, kind, loudestDir);
      if (kind === NoiseKind.MOVEMENT) by.movementNoiseHeard |= 1 << lastListenerDirection;
    }
    if (source && team === Team.OUR) {
      if (seen) ourTeamRadiosRandomlyAbout(t, source);
      else if (heard) updatePublic(t, team, source, Opp.HEARD_THIS_TURN, g, level);
    }
  }
}

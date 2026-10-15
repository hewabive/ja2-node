// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-15. See LICENSE (SFI-SCLA).
// @src src/game/Tactical/OppList.cc MovementNoise, DoorOpeningNoise, MakeNoise, ProcessNoise, CalcEffVolume, DecideHearing,
// @src HearNoise, TellPlayerAboutNoise; SkillCheck.cc EffectiveExpLevel, EffectiveDexterity. See docs/08 §3.

import { pythSpacesAway, WORLD_COLS } from '../../../content/world/grid.ts';
import { Terrain } from '../../../content/world/terrain.ts';
import { endHeight, states } from '../animation.ts';
import { directionToward } from '../movement.ts';
import { isWater } from '../pathfinding.ts';
import { effectiveDexterity, effectiveExpLevel, effectiveLife } from '../skills.ts';
import { AlertStatus, OKLIFE, type Soldier, Team } from '../soldier.ts';
import type { TacticalState } from '../state.ts';
import { type HeightClass, soldierToLocationLineOfSight, soldierToSoldierLineOfSight } from './los.ts';
import {
  atan8,
  distanceVisible,
  manSeesMan,
  Opp,
  ourTeamRadiosRandomlyAbout,
  publicOpp,
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
const MAX_NOISE_VOLUME = 12;
const DOOR_NOISE_VOLUME = 2;
const ARMY_FOOTSTEP = 9;
const RED_ALERT_VOLUME = 3;
const IRRELEVANT = -1;

export function movementNoise(t: TacticalState, s: Soldier): number {
  if (s.team === Team.ENEMY) return ARMY_FOOTSTEP - t.pre.int(2);
  let stealth = 20 + 4 * effectiveExpLevel(s) + Math.trunc((effectiveDexterity(s) * 4) / 10);
  const life = effectiveLife(s);
  if (life < 50) stealth -= Math.trunc((stealth * (50 - life)) / 100);
  if (s.breath < 50) stealth -= Math.trunc((stealth * (50 - s.breath)) / 100);
  if (isWater(t.pathWorld, s.gridNo)) stealth -= s.overTerrain === Terrain.DEEP_WATER ? 20 : 10;
  stealth = Math.max(stealth, 0);
  const st = states(t.content.animations);
  if (!s.stealthMode) {
    let max = (9 - Math.trunc(stealth / 16)) & 0xff;
    if (isWater(t.pathWorld, s.gridNo)) max++;
    if (s.state === st.CRAWLING) max = max <= 2 ? 0 : max - 2;
    else if (s.state === st.SWATTING) max = max <= 1 ? 0 : max - 1;
    else if (s.state === st.RUNNING) max += 3;
    return max < 2 ? max : 1 + t.pre.int(max);
  }
  let roll = t.pre.int(100);
  if (roll >= stealth) roll = t.pre.int(100);
  if (roll < stealth) return 0;
  let volume = 1 + Math.trunc((roll - stealth + 1) / 16);
  if (s.state === st.CRAWLING) volume = volume <= 2 ? 0 : volume - 2;
  else if (s.state === st.SWATTING) volume -= 1;
  else if (s.state === st.RUNNING) volume += 3;
  return volume;
}

export function doorOpeningNoise(t: TacticalState, s: Soldier): number {
  return movementNoise(t, s) === 0 ? 0 : DOOR_NOISE_VOLUME;
}

function decideHearing(t: TacticalState, s: Soldier): number {
  let hearing = s.stats.experience > 3 ? 1 : 0;
  const ambient = t.perception.ambientLight;
  if (ambient >= 8 && ambient <= 9) hearing += 1;
  else if (ambient === 10) hearing += 2;
  else if (ambient >= 11) hearing += 3;
  return hearing;
}

function calcEffVolume(t: TacticalState, l: Soldier, g: number, level: number, base: number, sourceTerrain: number): number {
  if (t.inCombat) return 0;
  let eff = base + decideHearing(t, l) - l.ai.oppCount - (pythSpacesAway(l.gridNo, g) - 1);
  if (l.state === states(t.content.animations).RUNNING) eff -= 5;
  if (level > l.level) eff += 5;
  else if (level < l.level) eff -= 5;
  if (eff > 0 && (l.overTerrain === Terrain.FLAT_FLOOR) !== (sourceTerrain === Terrain.FLAT_FLOOR)) eff -= 5;
  return Math.max(eff, 0);
}

function hearNoise(t: TacticalState, l: Soldier, source: Soldier | null, g: number, level: number, volume: number, kind: number): boolean {
  const d = distanceVisible(t, l, IRRELEVANT, IRRELEVANT, g, level);
  const losWorld = { structures: t.world.structures, heights: t.world.level.heights };
  const eye = {
    gridNo: l.gridNo,
    level: l.level,
    heightClass: endHeight(t.content, l.state) as (typeof HeightClass)[keyof typeof HeightClass],
  };
  const occupant = t.occupant[level > 0 ? 1 : 0][g] ?? -1;
  const target = occupant >= 0 ? t.soldiers[occupant] : undefined;
  const los = target
    ? soldierToSoldierLineOfSight(
        losWorld,
        eye,
        {
          gridNo: target.gridNo,
          level: target.level,
          heightClass: endHeight(t.content, target.state) as (typeof HeightClass)[keyof typeof HeightClass],
        },
        d & 0xff,
        true,
        t.perception.disallowSight,
      )
    : soldierToLocationLineOfSight(losWorld, eye, g, level, d & 0xff, t.perception.disallowSight);
  const sourceSeen = pythSpacesAway(l.gridNo, g) <= d && los !== 0;
  const hadToTurn = l.direction !== atan8(Math.trunc(l.x), Math.trunc(l.y), (g % WORLD_COLS) * 10 + 5, Math.trunc(g / WORLD_COLS) * 10 + 5);
  const hooks = t.perceptionHooks;
  let seen = false;
  if (source) {
    if (sourceSeen) {
      manSeesMan(t, l, source, 5);
      if (l.team !== Team.OUR) l.newOppCnt = 0;
      seen = true;
      if (
        l.neutral &&
        (kind === NoiseKind.GUNFIRE || kind === NoiseKind.BULLET_IMPACT) &&
        volume >= RED_ALERT_VOLUME &&
        l.ai.alertStatus < AlertStatus.RED
      )
        l.ai.alertStatus = AlertStatus.RED;
    } else {
      hooks.setNewSituation(l);
      if ((kind === NoiseKind.GUNFIRE || kind === NoiseKind.BULLET_IMPACT) && volume >= RED_ALERT_VOLUME)
        l.ai.alertStatus = AlertStatus.RED;
      updatePersonal(l, source, Opp.HEARD_THIS_TURN, g);
      if (volume >= l.ai.noiseVolume) {
        l.ai.noiseGridNo = g;
        l.ai.noiseLevel = level;
        l.ai.noiseVolume = Math.min(volume, MAX_NOISE_VOLUME);
        hooks.setNewSituation(l);
      }
    }
  } else if (!sourceSeen || (kind === NoiseKind.ROCK_IMPACT && hadToTurn) || kind === NoiseKind.SILENT_ALARM) {
    if (volume >= l.ai.noiseVolume) {
      l.ai.noiseGridNo = g;
      l.ai.noiseLevel = level;
      l.ai.noiseVolume = Math.min(volume, MAX_NOISE_VOLUME);
      hooks.setNewSituation(l);
    }
  } else {
    hooks.setNewSituation(l);
    if (l.ai.alertStatus < AlertStatus.RED) l.ai.alertStatus = AlertStatus.RED;
  }
  return seen;
}

function volumeClass(eff: number): number {
  if (eff >= 12) return 3;
  if (eff >= 8) return 2;
  if (eff >= 4) return 1;
  return 0;
}

export function makeNoise(t: TacticalState, maker: Soldier | null, g: number, level: number, base: number, kind: number): void {
  if (base === 0) return;
  if (maker && kind !== NoiseKind.EXPLOSION && (!validForSightings(maker) || (maker.life === 0 && kind !== NoiseKind.SCREAM))) return;
  const sourceTerrain = t.world.terrain[g] ?? 0;
  const source = HIDDEN_SOURCE_KINDS.has(kind) ? null : maker;
  const placed = t.soldiers.filter((s) => s?.placed);
  const enemyInSector = placed.some((s) => s.team !== Team.OUR && s.team !== Team.MILITIA && !s.neutral && s.life >= OKLIFE);
  for (let team = 0; team <= 5; team++) {
    const members = placed.filter((s) => s.team === team);
    if (members.length === 0) continue;
    if (maker && (team === maker.team || (team === Team.OUR && publicOpp(t, team, maker) === Opp.SEEN_CURRENTLY))) continue;
    let tell = enemyInSector && !t.inCombat;
    if (UNTOLD_KINDS.has(kind)) tell = false;
    if (maker) {
      const known = publicOpp(t, team, maker);
      if (known === Opp.SEEN_CURRENTLY || known === Opp.SEEN_THIS_TURN || known === Opp.HEARD_THIS_TURN || maker.life === 0) tell = false;
    }
    let heard = false;
    let seen = false;
    let loudest = 0;
    let by: Soldier | null = null;
    let loudestDir = 0;
    let lastDir = 0;
    for (const l of members.sort((a, b) => a.id - b.id)) {
      if (l.life < OKLIFE) continue;
      if (maker) {
        if (l.oppList[maker.id] === Opp.SEEN_CURRENTLY && !(l.neutral && kind === NoiseKind.GUNFIRE)) continue;
        if (l.team === Team.MILITIA && maker.team === Team.OUR) continue;
        if (l.team === Team.OUR && maker.team === Team.MILITIA) continue;
      }
      const eff = calcEffVolume(t, l, g, level, base, sourceTerrain);
      if (eff <= 0) continue;
      if (hearNoise(t, l, source, g, level, eff, kind)) seen = true;
      heard = true;
      const dir = directionToward(l.gridNo, g);
      lastDir = dir;
      if (kind !== NoiseKind.MOVEMENT || team !== Team.OUR || !(l.movementNoiseHeard & (1 << dir))) {
        if (eff > loudest) {
          loudest = eff;
          by = l;
          loudestDir = dir;
        }
      }
    }
    if (heard && team === Team.OUR && tell && by) {
      t.events.push({
        type: 'noiseHeard',
        listener: by.id,
        kind,
        volumeClass: volumeClass(loudest),
        direction:
          level === by.level || kind === NoiseKind.EXPLOSION || kind === NoiseKind.SCREAM
            ? loudestDir
            : level > by.level
              ? 'above'
              : 'below',
      });
      if (kind === NoiseKind.MOVEMENT) by.movementNoiseHeard |= 1 << lastDir;
    }
    if (source && team === Team.OUR) {
      if (seen) ourTeamRadiosRandomlyAbout(t, source);
      else if (heard) updatePublic(t, team, source, Opp.HEARD_THIS_TURN, g);
    }
  }
}

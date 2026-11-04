// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-11-04. See LICENSE (SFI-SCLA).
// @src src/game/Tactical/Items.cc ActivateXRayDevice, TurnOffXRayEffects; Items.h XRAY_RANGE, XRAY_TIME;
// @src Soldier_Control.cc EVENT_BeginMercTurn (the turn-off in combat); Tactical_Turns.cc HandleTacticalEndTurn (the
// @src turn-off after XRAY_TIME); TileEngine/Radar_Screen.cc RenderRadarScreen (x-rayed soldiers on the radar and the
// @src colour each one gets).

import { NOTHING } from '../../content/items/items.ts';
import { pythSpacesAway } from '../../content/world/grid.ts';
import { i8, u32 } from '../../core/int.ts';
import { findAttachment, type ItemObject } from '../items/object.ts';
import { worldSeconds } from './explosions/state.ts';
import { InvSlot } from './inventory.ts';
import { Body, NO_PROFILE, OKLIFE, Side, type Soldier, shownToPlayer, Team } from './soldier.ts';
import { mercs, type TacticalState } from './state.ts';

const XRAY_RANGE = 40;
const XRAY_TIME = 5;
const BATTERY_DRAIN_MIN = 8;
const BATTERY_DRAIN_SPREAD = 5;
const NOT_ACTIVATED = 0;

export type RadarContactKind = 'enemy' | 'creature' | 'militia' | 'civilian' | 'hostileCivilian' | 'namedCivilian' | 'unconscious';

export interface RadarContactView {
  readonly gridNo: number;
  readonly kind: RadarContactKind;
}

const TEAM_CONTACT_KINDS: Readonly<Record<number, RadarContactKind>> = {
  [Team.ENEMY]: 'enemy',
  [Team.CREATURE]: 'creature',
  [Team.MILITIA]: 'militia',
  [Team.CIV]: 'civilian',
};

function itemIndex(t: TacticalState, name: string): number {
  return t.content.items.byName.get(name)?.index ?? -2;
}

function drainBatteries(t: TacticalState, device: ItemObject): boolean {
  const slot = findAttachment(device, itemIndex(t, 'BATTERIES'));
  const batteries = device.attachments[slot];
  if (!batteries) return false;
  batteries.status = i8(batteries.status - i8(BATTERY_DRAIN_MIN + t.rng.int(BATTERY_DRAIN_SPREAD)));
  if (batteries.status <= 0) {
    batteries.item = NOTHING;
    batteries.status = 0;
  }
  return true;
}

function clearXRayedBy(t: TacticalState, s: Soldier): void {
  for (const tgt of mercs(t)) if (tgt.xrayedBy === s) tgt.xrayedBy = null;
}

export function activateXRayDevice(t: TacticalState, s: Soldier): void {
  if (!drainBatteries(t, s.inv[InvSlot.HAND] as ItemObject)) return;
  clearXRayedBy(t, s);
  for (const tgt of mercs(t)) if (tgt.team !== s.team && pythSpacesAway(s.gridNo, tgt.gridNo) < XRAY_RANGE) tgt.xrayedBy = s;
  s.xrayActivatedTime = worldSeconds(t);
}

export function turnOffXRayEffects(t: TacticalState, s: Soldier): void {
  if (s.xrayActivatedTime === NOT_ACTIVATED) return;
  clearXRayedBy(t, s);
  s.xrayActivatedTime = NOT_ACTIVATED;
}

export function turnOffXRayAtCombatTurnStart(t: TacticalState, s: Soldier): void {
  if (s.xrayActivatedTime !== NOT_ACTIVATED) turnOffXRayEffects(t, s);
}

export function turnOffExpiredXRay(t: TacticalState, s: Soldier, now: number): void {
  if (s.xrayActivatedTime !== NOT_ACTIVATED && now > u32(s.xrayActivatedTime + XRAY_TIME)) turnOffXRayEffects(t, s);
}

function contactKind(s: Soldier): RadarContactKind {
  if (s.team !== Team.OUR && s.life < OKLIFE) return 'unconscious';
  if (s.team === Team.CIV && !s.neutral && s.side !== Side.FRIENDLY) return 'hostileCivilian';
  if (s.team === Team.CIV && s.profile !== NO_PROFILE) return 'namedCivilian';
  return TEAM_CONTACT_KINDS[s.team] ?? 'enemy';
}

function radarContact(s: Soldier): boolean {
  return s.placed && s.xrayedBy !== null && !shownToPlayer(s) && !s.dead && s.bodyType !== Body.CROW;
}

export function radarContacts(t: TacticalState): RadarContactView[] {
  return t.soldiers
    .filter((s): s is Soldier => s !== undefined && s !== null && radarContact(s))
    .map((s) => ({ gridNo: s.gridNo, kind: contactKind(s) }));
}

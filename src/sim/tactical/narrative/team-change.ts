// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-16. See LICENSE (SFI-SCLA).
// @src src/game/Tactical/Soldier_Profile.cc ChangeSoldierTeam; Tactical/Soldier_Create.cc InternalTacticalRemoveSoldier (the
// @src tactical part), TacticalCreateSoldier (through tacticalCreateSoldier); Tactical/Soldier_Control.cc CreateSoldierCommon
// @src (the standing frame draw); Tactical/Soldier_Add.cc AddSoldierToSectorNoCalculateDirectionUseAnimation;
// @src Tactical/Soldier_Ani.cc HandleCheckForDeathCommonCode (gfPotentialTeamChangeDuringDeath).

import { emptyObject } from '../../items/object.ts';
import { ProfileFlag } from '../../narrative/narrative-ids.ts';
import { handleCheckForDeathCommonCode } from '../combat/death.ts';
import { tacticalCreateSoldier } from '../creation.ts';
import { drawStandingFrame, NEUTRAL_POPULATION } from '../init-list.ts';
import { addSoldierToSector, Insertion } from '../insertion.ts';
import { SightFlags } from '../perception/opp.ts';
import { handleSight } from '../perception/sight.ts';
import { removeSoldierFromTacticalSector } from '../sector-presence.ts';
import { type Soldier, Team } from '../soldier.ts';
import type { TacticalState } from '../state.ts';
import { profileSoldierCreate } from './profile-insertion.ts';

const NO_SELECTION = -1;

export interface TeamChangeSlots {
  freeSoldierId(team: number): number;
  soldierRemoved?(old: Soldier): void;
}

function copyVitalStats(from: Soldier, to: Soldier): void {
  to.life = from.life;
  to.lifeMax = from.lifeMax;
  to.stats.agility = from.stats.agility;
  to.stats.leadership = from.stats.leadership;
  to.stats.dexterity = from.stats.dexterity;
  to.stats.strength = from.stats.strength;
  to.stats.wisdom = from.stats.wisdom;
  to.stats.experience = from.stats.experience;
  to.stats.marksmanship = from.stats.marksmanship;
  to.stats.medical = from.stats.medical;
  to.stats.mechanical = from.stats.mechanical;
  to.stats.explosives = from.stats.explosives;
  to.lastRenderVisible = from.lastRenderVisible;
  to.visible = from.visible;
  to.camo = from.camo;
  to.level = from.level;
}

function moveInventory(from: Soldier, to: Soldier): void {
  for (let slot = 0; slot < to.inv.length; slot++) {
    to.inv[slot] = from.inv[slot] ?? emptyObject();
    from.inv[slot] = emptyObject();
  }
}

function retargetAttackers(t: TacticalState, old: Soldier, fresh: Soldier): void {
  for (const s of t.mercSlots) if (s?.target === old) s.target = fresh;
}

function markRecruited(t: TacticalState, s: Soldier, team: number): void {
  const p = t.profiles.get(s.profile);
  if (!p) return;
  if (team === Team.OUR) p.miscFlags |= ProfileFlag.RECRUITED;
  else p.miscFlags &= ~ProfileFlag.RECRUITED;
}

export function changeSoldierTeam(t: TacticalState, old: Soldier, team: number, slots: TeamChangeSlots): Soldier | null {
  const oldGridNo = old.gridNo;
  const wasInSector = old.placed;
  if (t.turn.selected === old.id) t.turn.selected = NO_SELECTION;
  slots.soldierRemoved?.(old);
  if (wasInSector) removeSoldierFromTacticalSector(t, old);
  const id = slots.freeSoldierId(team);
  if (id < 0) return null;
  const fresh = tacticalCreateSoldier(t, profileSoldierCreate(old.profile, team, old.direction), id, NEUTRAL_POPULATION);
  if (!fresh) return null;
  drawStandingFrame(t);
  copyVitalStats(old, fresh);
  if (team === Team.OUR) fresh.visible = 1;
  retargetAttackers(t, old, fresh);
  fresh.insertionGridNo = oldGridNo;
  if (t.turn.potentialTeamChangeDuringDeath) handleCheckForDeathCommonCode(t, old);
  moveInventory(old, fresh);
  if (wasInSector) {
    const animation = { state: old.state, code: old.pc };
    addSoldierToSector(t, fresh, { code: Insertion.NORTH, data: oldGridNo, direction: fresh.direction }, {}, false, animation);
    handleSight(t, fresh, SightFlags.LOOK | SightFlags.RADIO);
  }
  markRecruited(t, fresh, team);
  return fresh;
}

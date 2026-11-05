// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-16. See LICENSE (SFI-SCLA).
// @src src/game/Tactical/Soldier_Profile.cc ChangeSoldierTeam (the vehicle branch, 2026-11-04); Tactical/Soldier_Create.cc
// @src InternalTacticalRemoveSoldier (the tactical part), TacticalCreateSoldier (through tacticalCreateSoldier);
// @src Tactical/Soldier_Control.cc CreateSoldierCommon (the standing frame draw); Tactical/Soldier_Add.cc
// @src AddSoldierToSectorNoCalculateDirectionUseAnimation; Tactical/Soldier_Ani.cc HandleCheckForDeathCommonCode
// @src (gfPotentialTeamChangeDuringDeath).

import { emptyObject } from '../../items/object.ts';
import { ProfileFlag } from '../../narrative/narrative-ids.ts';
import { isVehicleBody } from '../../vehicles/vehicle-list.ts';
import { handleCheckForDeathCommonCode } from '../combat/death.ts';
import { type SoldierCreate, tacticalCreateSoldier } from '../creation.ts';
import { drawStandingFrame, NEUTRAL_POPULATION } from '../init-list.ts';
import { addSoldierToSector, Insertion } from '../insertion.ts';
import { SightFlags } from '../perception/opp.ts';
import { handleSight } from '../perception/sight.ts';
import { SECOND_LEVEL_Z_OFFSET, setUnplacedSoldierHeight } from '../roofs.ts';
import { removeSoldierFromTacticalSector } from '../sector-presence.ts';
import { NO_SELECTION } from '../selection.ts';
import { NO_PROFILE, type Soldier, Team } from '../soldier.ts';
import type { TacticalState } from '../state.ts';
import { profileSoldierCreate } from './profile-insertion.ts';

const SECOND_LEVEL = 1;

export interface TeamChangeSlots {
  freeSoldierId(team: number, bodyType: number): number;
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
  if (from.level === SECOND_LEVEL) setUnplacedSoldierHeight(to, SECOND_LEVEL_Z_OFFSET);
}

function moveInventory(from: Soldier, to: Soldier): void {
  for (let slot = 0; slot < to.inv.length; slot++) {
    to.inv[slot] = from.inv[slot] ?? emptyObject();
    from.inv[slot] = emptyObject();
  }
}

function retargetAttackers(t: TacticalState, old: Soldier, fresh: Soldier): void {
  for (const s of t.mercSlots) if (s.target === old) s.target = fresh;
}

function teamChangeCreate(old: Soldier, team: number): SoldierCreate {
  const create = { ...profileSoldierCreate(old.profile, team, old.direction), bodyType: old.bodyType };
  if (!isVehicleBody(old.bodyType)) return create;
  return { ...create, profile: NO_PROFILE, givenVehicleId: old.vehicleId };
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
  const create = teamChangeCreate(old, team);
  const id = slots.freeSoldierId(team, create.bodyType);
  if (id < 0) return null;
  const fresh = tacticalCreateSoldier(t, create, id, NEUTRAL_POPULATION);
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

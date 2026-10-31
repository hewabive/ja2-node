// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-31. See LICENSE (SFI-SCLA).
// @src src/game/Strategic/Assignments.cc PutMercInAsleepState, PutMercInAwakeState, AssignmentDone,
// @src MakeSoldiersTacticalAnimationReflectAssignment (the gfWorldLoaded, bInSector and GAME_SCREEN tests).

import type { EconomyHooks } from '../strategic/economy/ports.ts';
import { animateAssignmentDone, animateFallingAsleep, animateWakingUp, reflectAssignment } from '../tactical/assignment-animations.ts';
import type { Soldier } from '../tactical/soldier.ts';
import type { TacticalState } from '../tactical/state.ts';
import type { CampaignSim } from './campaign-sim.ts';
import { registeredInTactical } from './roster.ts';

type AssignmentAnimationHooks = Pick<
  EconomyHooks,
  'animateFallingAsleep' | 'animateWakingUp' | 'animateAssignmentDone' | 'animateAssignment'
>;

interface MercInLoadedSector {
  readonly t: TacticalState;
  readonly soldier: Soldier;
  readonly assignment: number;
}

function mercInLoadedSector(campaign: CampaignSim, id: number): MercInLoadedSector | null {
  const t = campaign.tactical?.state;
  const merc = campaign.battle?.roster.get(id);
  if (!t || !merc || !registeredInTactical(t, merc) || !merc.soldier.placed) return null;
  return { t, soldier: merc.soldier, assignment: merc.assignment };
}

export function assignmentAnimationHooks(campaign: CampaignSim): AssignmentAnimationHooks {
  const onTacticalScreen = () => campaign.state.flow === 'tactical';
  const inSector = (id: number, animate: (merc: MercInLoadedSector) => void) => {
    const merc = mercInLoadedSector(campaign, id);
    if (merc) animate(merc);
  };
  return {
    animateFallingAsleep: (id) => inSector(id, (m) => animateFallingAsleep(m.t, m.soldier, onTacticalScreen())),
    animateWakingUp: (id) => inSector(id, (m) => animateWakingUp(m.t, m.soldier, onTacticalScreen())),
    animateAssignmentDone: (id) => inSector(id, (m) => animateAssignmentDone(m.t, m.soldier, m.assignment, onTacticalScreen())),
    animateAssignment: (id) => inSector(id, (m) => reflectAssignment(m.t, m.soldier, m.assignment)),
  };
}

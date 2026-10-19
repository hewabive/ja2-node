// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-19. See LICENSE (SFI-SCLA).
// @src src/game/Strategic/Assignments.cc ShowAssignmentBox (the remove-merc, EPC and assignment boxes),
// @src HandleShadingOfLinesForAssignmentMenus, HandleShadingOfLinesForSquadMenu, GetLastSquadListedInSquadMenu,
// @src HandleShadingOfLinesForVehicleMenu, HandleShadingOfLinesForRepairMenu, DisplayRepairMenu,
// @src HandleShadingOfLinesForTrainingMenu, HandleShadingOfLinesForAttributeMenus; Utils/PopUpBox.h PopUpShade.
// @src See docs/28 §7.4.

import type { KnowledgeWorld } from '../knowledge/knowledge-world.ts';
import {
  basicCanCharacterDoctor,
  basicCanCharacterTrainMilitia,
  canCharacterBeTrainedByOther,
  canCharacterDoctor,
  canCharacterOnDuty,
  canCharacterPatient,
  canCharacterPractise,
  canCharacterSquad,
  canCharacterTrainMilitia,
  canCharacterTrainStat,
  canCharacterTrainTeammates,
  JoinSquad,
} from '../strategic/economy/conditions.ts';
import { NUM_TRAINABLE_STATS } from '../strategic/economy/constants.ts';
import type { CrewMember, EconomyContext } from '../strategic/economy/ports.ts';
import {
  basicCanCharacterRepair,
  canCharacterRepair,
  canCharacterRepairRobot,
  canCharacterRepairVehicle,
  doesCharacterHaveAnyItemsToRepair,
  FINAL_REPAIR_PASS,
  isRobotInThisSector,
} from '../strategic/economy/repair-rules.ts';
import { canCharacterVehicle, isVehicleAccessibleToSoldier } from '../strategic/economy/vehicle-assignment.ts';
import { Assignment, NUMBER_OF_SQUADS } from '../strategic/forces/constants.ts';
import { isEnoughSpaceInVehicle, isHelicopter } from '../strategic/forces/vehicles.ts';
import { mercOf, strategicOf } from './strategic-check.ts';
import { type HintRequestBase, type HintResult, hintData } from './types.ts';

export type PopUpShade = 'none' | 'gray' | 'yellow';

export interface AssignmentLine {
  readonly line: string;
  readonly enabled: boolean;
  readonly shade: PopUpShade;
  readonly reason?: string;
  readonly target?: number;
}

export interface AttributeLines {
  readonly self: readonly AssignmentLine[];
  readonly teammate: readonly AssignmentLine[];
  readonly byOther: readonly AssignmentLine[];
}

export interface AssignmentOptions {
  readonly box: 'assignment' | 'epc' | 'removeMerc';
  readonly lines: readonly AssignmentLine[];
  readonly squads: readonly AssignmentLine[];
  readonly vehicles: readonly AssignmentLine[];
  readonly repair: readonly AssignmentLine[];
  readonly training: readonly AssignmentLine[];
  readonly attributes: AttributeLines;
}

export interface AssignmentOptionsRequest extends HintRequestBase {
  readonly soldier?: unknown;
}

const STAT_LINES = ['strength', 'dexterity', 'agility', 'health', 'marksmanship', 'medical', 'mechanical', 'leadership', 'explosives'];

const SQUAD_REASONS: Readonly<Record<number, string>> = {
  [JoinSquad.ALREADY_IN_IT]: 'alreadyInSquad',
  [JoinSquad.SQUAD_MOVING]: 'squadMoving',
  [JoinSquad.MOVING]: 'moving',
  [JoinSquad.VEHICLE]: 'squadHasVehicle',
  [JoinSquad.TOO_FAR]: 'squadElsewhere',
  [JoinSquad.FULL]: 'squadFull',
  [JoinSquad.CANT]: 'cannotJoinSquad',
};

function line(name: string, shade: PopUpShade, reason?: string, target?: number): AssignmentLine {
  return {
    line: name,
    enabled: shade === 'none',
    shade,
    ...(shade !== 'none' && reason ? { reason } : {}),
    ...(target !== undefined ? { target } : {}),
  };
}

function grayUnless(name: string, ok: boolean, reason: string, target?: number): AssignmentLine {
  return line(name, ok ? 'none' : 'gray', reason, target);
}

function twoLevel(name: string, basic: boolean, full: boolean, grayReason: string, yellowReason: string): AssignmentLine {
  if (!basic) return line(name, 'gray', grayReason);
  return full ? line(name, 'none') : line(name, 'yellow', yellowReason);
}

function lastSquadListed(ctx: EconomyContext): number {
  const squads = ctx.state.forces.squads;
  let last = 0;
  squads.forEach((members, q) => {
    if (members.length > 0) last = q;
  });
  return Math.min(last + 1, NUMBER_OF_SQUADS - 1);
}

function squadLines(ctx: EconomyContext, s: CrewMember): AssignmentLine[] {
  const lines: AssignmentLine[] = [];
  for (let q = 0; q <= lastSquadListed(ctx); q++) {
    const code = canCharacterSquad(ctx, s, q);
    const shade: PopUpShade = code === JoinSquad.CANT ? 'gray' : code === JoinSquad.CAN ? 'none' : 'yellow';
    lines.push(line('squad', shade, SQUAD_REASONS[code], q));
  }
  return lines;
}

function vehicleLines(ctx: EconomyContext, s: CrewMember): AssignmentLine[] {
  return ctx.state.forces.vehicles.flatMap((v, id) =>
    v?.valid && isVehicleAccessibleToSoldier(ctx, s, v)
      ? [line('vehicle', isEnoughSpaceInVehicle(ctx, v) ? 'none' : 'yellow', 'vehicleFull', id)]
      : [],
  );
}

function repairLines(ctx: EconomyContext, s: CrewMember): AssignmentLine[] {
  const lines: AssignmentLine[] = [];
  if (s.sector.z === 0)
    ctx.state.forces.vehicles.forEach((v, id) => {
      if (!v?.valid || isHelicopter(ctx, v) || !isVehicleAccessibleToSoldier(ctx, s, v)) return;
      lines.push(grayUnless('repairVehicle', canCharacterRepairVehicle(ctx, s, id), 'notRepairable', id));
    });
  if (isRobotInThisSector(ctx, s.sector)) lines.push(grayUnless('repairRobot', canCharacterRepairRobot(ctx, s), 'notRepairable'));
  lines.push(grayUnless('repairItems', doesCharacterHaveAnyItemsToRepair(ctx, s, FINAL_REPAIR_PASS), 'nothingToRepair'));
  return lines;
}

function trainingLines(ctx: EconomyContext, s: CrewMember): AssignmentLine[] {
  return [
    grayUnless('practice', canCharacterPractise(ctx, s), 'notEligible'),
    twoLevel('militia', basicCanCharacterTrainMilitia(ctx, s), canCharacterTrainMilitia(ctx, s), 'noMilitiaHere', 'notEligible'),
    grayUnless('trainer', canCharacterTrainTeammates(ctx, s), 'notEligible'),
    grayUnless('student', canCharacterBeTrainedByOther(ctx, s), 'notEligible'),
  ];
}

function attributeLines(ctx: EconomyContext, s: CrewMember, trainSelf: boolean, trainTeammate: boolean): AssignmentLine[] {
  return Array.from({ length: NUM_TRAINABLE_STATS }, (_, stat) =>
    grayUnless(STAT_LINES[stat] ?? 'stat', canCharacterTrainStat(ctx, s, stat, trainSelf, trainTeammate), 'cannotTrainStat', stat),
  );
}

function mainLines(ctx: EconomyContext, s: CrewMember): AssignmentLine[] {
  if (s.isEpc)
    return [
      grayUnless('onDuty', canCharacterOnDuty(ctx, s), 'notEligible'),
      grayUnless('patient', canCharacterPatient(ctx, s), 'notEligible'),
      grayUnless('vehicle', canCharacterVehicle(ctx, s), 'notEligible'),
      line('unescort', 'none'),
      line('cancel', 'none'),
    ];
  return [
    grayUnless('onDuty', canCharacterOnDuty(ctx, s), 'notEligible'),
    twoLevel('doctor', basicCanCharacterDoctor(ctx, s), canCharacterDoctor(ctx, s), 'notEligible', 'noMedKit'),
    grayUnless('patient', canCharacterPatient(ctx, s), 'notEligible'),
    grayUnless('vehicle', canCharacterVehicle(ctx, s), 'notEligible'),
    twoLevel('repair', basicCanCharacterRepair(ctx, s), canCharacterRepair(ctx, s), 'notEligible', 'noToolKit'),
    grayUnless('train', canCharacterPractise(ctx, s), 'notEligible'),
    line('cancel', 'none'),
  ];
}

const NO_ATTRIBUTES: AttributeLines = { self: [], teammate: [], byOther: [] };

export function assignmentOptionsFor(ctx: EconomyContext, s: CrewMember): AssignmentOptions {
  if (s.life === 0 || s.assignment === Assignment.ASSIGNMENT_POW)
    return {
      box: 'removeMerc',
      lines: [line('removeMerc', 'none'), line('cancel', 'none')],
      squads: [],
      vehicles: [],
      repair: [],
      training: [],
      attributes: NO_ATTRIBUTES,
    };
  return {
    box: s.isEpc ? 'epc' : 'assignment',
    lines: mainLines(ctx, s),
    squads: squadLines(ctx, s),
    vehicles: vehicleLines(ctx, s),
    repair: s.isEpc ? [] : repairLines(ctx, s),
    training: s.isEpc ? [] : trainingLines(ctx, s),
    attributes: s.isEpc
      ? NO_ATTRIBUTES
      : {
          self: attributeLines(ctx, s, true, false),
          teammate: attributeLines(ctx, s, false, true),
          byOther: attributeLines(ctx, s, true, false),
        },
  };
}

export function assignmentOptions(world: KnowledgeWorld, req: AssignmentOptionsRequest): HintResult<AssignmentOptions> {
  const sk = strategicOf(world);
  if ('refusal' in sk) return sk.refusal;
  const m = mercOf(sk, req.soldier);
  if ('refusal' in m) return m.refusal;
  return hintData(assignmentOptionsFor(sk.ctx, m));
}

// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-16. See LICENSE (SFI-SCLA).
// @src src/game/Strategic/StrategicMap.cc OKForSectorExit, UndergroundTacticalTraversalTime, JumpIntoAdjacentSector,
// @src AllMercsHaveWalkedOffSector, SetupTacticalTraversalInformation, SetInsertionDataFromAdjacentMoveDirection,
// @src DoneFadeOutAdjacentSector, AllMercsWalkedToExitGrid, DoneFadeOutExitGridSector;
// @src Tactical/Strategic_Exit_GUI.cc InternalInitSectorExitMenu, SingleMoveAction, AllMoveAction, RemoveSectorExitMenu.
// @src See docs/16 §5.9.

import { type Sector, sectorId, sectorShortString } from '../../content/strategic/sector-ids.ts';
import { Direction } from '../../content/world/grid.ts';
import type { CommandResult } from '../command.ts';
import { Assignment, InsertionCode } from '../strategic/forces/constants.ts';
import {
  countAllMilitiaInSector,
  type Group,
  getGroup,
  numEnemiesInAnySector,
  playerMercsInSector,
  setGroupSectorValue,
} from '../strategic/forces/groups.ts';
import {
  addWaypointToPGroup,
  clearMercPathsAndWaypointsForAllInGroup,
  resetMovementForEnemyGroupsInLocation,
} from '../strategic/forces/movement.ts';
import { plotPathForCharacter } from '../strategic/forces/routes.ts';
import {
  addCharacterToUniqueSquad,
  handleSoldierLeavingSectorByThemSelf,
  numberOfPlayerControllableMercsInSquad,
  removeCharacterFromSquads,
} from '../strategic/forces/squads.ts';
import { getSectorMvtTimeForGroup, TRAVERSE_TIME_IMPOSSIBLE } from '../strategic/map/travel.ts';
import { Warp } from '../strategic/time/constants.ts';
import { warpGameTime } from '../strategic/time/world-clock.ts';
import { states } from '../tactical/animation.ts';
import { calcMapEdgepointClassInsertionCode } from '../tactical/edgepoints.ts';
import { getNewSoldierPath, setSoldierPosition } from '../tactical/movement.ts';
import {
  DIRECTION_EXITGRID,
  ExitDirection,
  exitGridAt,
  findGridNoFromSweetSpotCloseToExitGrid,
  mirrorGridNo,
  pickGridNoNearestEdge,
  pickGridNoToWalkIn,
  setActionToDoOnceMercsGetToLocation,
  soldierOKForSectorExit,
} from '../tactical/sector-exit.ts';
import { NOWHERE, OKLIFE, type Soldier } from '../tactical/soldier.ts';
import { sectorMapOf, WaitForMercs } from '../tactical/state.ts';
import { type RosterMerc, registeredInTactical } from './roster.ts';
import type { SectorFlow } from './sector-flow.ts';

export const JumpCode = { ALL_LOAD_NEW: 0, ALL_NO_LOAD: 1, SINGLE_LOAD_NEW: 2, SINGLE_NO_LOAD: 3 } as const;

export interface AdjacentJump {
  readonly groupId: number;
  readonly jumpCode: number;
  readonly traverseMinutes: number;
  readonly direction: number;
  readonly additional: number;
  readonly target: Sector;
}

export interface ExitCheck {
  readonly result: 0 | 1 | 2;
  readonly minutes: number;
  readonly invalidTraversal: boolean;
  readonly loneEpc: boolean;
  readonly abandonedEpcs: number;
  readonly uncontrolledRobot: boolean;
}

export interface ExitMenu {
  readonly loadOffered: boolean;
  readonly allMoveDisabled: boolean;
  readonly singleMoveDisabled: boolean;
  readonly multipleSquads: boolean;
  readonly peopleOnSquad: number;
  singleMove: boolean;
  allMove: boolean;
  gotoSector: boolean;
  gotoSectorDisabled: boolean;
}

const QUICK_TRAVERSAL_MINUTES = 5;
const RETREAT_WARP_SECONDS = 300;
const SECONDS_PER_MINUTE = 60;
const EXIT_SWEET_SPOT_RADIUS = 10;
const UNDERGROUND_WARP_MINUTES = 1;

const STRATEGIC_MOVE_OF: Readonly<Record<number, number>> = {
  [Direction.NORTH]: ExitDirection.NORTH,
  [Direction.EAST]: ExitDirection.EAST,
  [Direction.SOUTH]: ExitDirection.SOUTH,
  [Direction.WEST]: ExitDirection.WEST,
};

const ENTRY_CODE_OF: Readonly<Record<number, number>> = {
  [Direction.NORTH]: InsertionCode.SOUTH,
  [Direction.SOUTH]: InsertionCode.NORTH,
  [Direction.EAST]: InsertionCode.WEST,
  [Direction.WEST]: InsertionCode.EAST,
};

const SECTOR_STEP: Readonly<Record<number, readonly [number, number]>> = {
  [Direction.NORTH]: [0, -1],
  [Direction.EAST]: [1, 0],
  [Direction.SOUTH]: [0, 1],
  [Direction.WEST]: [-1, 0],
};

const DIRECTION_NAMES: Readonly<Record<string, number>> = {
  north: Direction.NORTH,
  east: Direction.EAST,
  south: Direction.SOUTH,
  west: Direction.WEST,
};

function soldierOf(flow: SectorFlow, m: RosterMerc): Soldier | null {
  const t = flow.campaign.tactical?.state;
  return t && registeredInTactical(t, m) && m.soldier.placed ? m.soldier : null;
}

function okControllable(flow: SectorFlow, m: RosterMerc): boolean {
  return soldierOf(flow, m) !== null && m.life >= OKLIFE && m.assignment < Assignment.ON_DUTY;
}

function undergroundTraversalTime(flow: SectorFlow, exitDirection: number): number {
  const t = flow.campaign.tactical?.state;
  if (!t) return TRAVERSE_TIME_IMPOSSIBLE;
  const info = sectorMapOf(t).info;
  const g = [info.northGridNo, info.eastGridNo, info.southGridNo, info.westGridNo][exitDirection] ?? -1;
  return g !== -1 ? 0 : TRAVERSE_TIME_IMPOSSIBLE;
}

function traverseTime(flow: SectorFlow, g: Group | undefined, exitDirection: number, anyUnderground: boolean): number {
  const world = flow.world;
  if (!world || !g) return TRAVERSE_TIME_IMPOSSIBLE;
  if (world.z === 0) return getSectorMvtTimeForGroup(flow.ctx, sectorId(g.sector), exitDirection, g);
  if (anyUnderground ? world.z > 0 : world.z > 1) return undergroundTraversalTime(flow, exitDirection);
  return TRAVERSE_TIME_IMPOSSIBLE;
}

export function okForSectorExit(flow: SectorFlow, exitDirection: number, exitGridNo: number, selected: RosterMerc): ExitCheck {
  const t = flow.campaign.tactical?.state;
  const refuse = (extra: Partial<ExitCheck> = {}): ExitCheck => ({
    result: 0,
    minutes: 0,
    invalidTraversal: false,
    loneEpc: false,
    abandonedEpcs: 0,
    uncontrolledRobot,
    ...extra,
  });
  let uncontrolledRobot = false;
  if (!t || !soldierOf(flow, selected)) return refuse();
  let atLeast = 0;
  let onlySelected = false;
  let valid: RosterMerc | null = null;
  let mercs = 0;
  let epcs = 0;
  let minutes = 0;
  for (const m of flow.setup.roster.all()) {
    if (!okControllable(flow, m) || m.assignment !== selected.assignment) continue;
    valid = m;
    if (m.isEpc) {
      epcs++;
      if (m.isRobot && !flow.setup.roster.canRobotBeControlled(m.id)) {
        uncontrolledRobot = true;
        continue;
      }
    } else mercs++;
    if (soldierOKForSectorExit(t, m.soldier, exitDirection, exitGridNo)) {
      atLeast++;
      if (m === selected) onlySelected = true;
    } else if (exitDirection !== ExitDirection.EXIT_GRID) {
      minutes = traverseTime(flow, getGroup(flow.ctx, valid.groupId), exitDirection, false);
      if (minutes === TRAVERSE_TIME_IMPOSSIBLE) return refuse({ minutes, invalidTraversal: true });
    } else minutes = 0;
  }
  if (atLeast === 0) return refuse({ minutes });
  const squadCount = numberOfPlayerControllableMercsInSquad(flow.ctx, selected.assignment);
  if (atLeast <= squadCount) {
    if (selected.isEpc) {
      if (atLeast < squadCount || atLeast === 1) return refuse({ minutes, loneEpc: true });
    } else if (epcs && mercs === 1 && atLeast < squadCount) return refuse({ minutes, abandonedEpcs: epcs });
  }
  if (exitDirection !== ExitDirection.EXIT_GRID) {
    minutes = traverseTime(flow, valid ? getGroup(flow.ctx, valid.groupId) : undefined, exitDirection, true);
    if (minutes === TRAVERSE_TIME_IMPOSSIBLE) return refuse({ minutes, invalidTraversal: true });
  } else minutes = 0;
  let result: 0 | 1 | 2 = 0;
  if (onlySelected) result = 1;
  if (atLeast === squadCount) result = 2;
  return { result, minutes, invalidTraversal: false, loneEpc: false, abandonedEpcs: 0, uncontrolledRobot };
}

function multipleSquadsInSector(flow: SectorFlow, selected: RosterMerc): boolean {
  const world = flow.world;
  if (!world) return false;
  return flow.setup.roster
    .all()
    .some(
      (m) =>
        m !== selected &&
        !m.betweenSectors &&
        m.sector.x === world.x &&
        m.sector.y === world.y &&
        m.sector.z === world.z &&
        m.life >= OKLIFE &&
        m.assignment !== selected.assignment &&
        m.assignment !== Assignment.ASSIGNMENT_POW &&
        m.assignment !== Assignment.IN_TRANSIT &&
        m.assignment !== Assignment.ASSIGNMENT_DEAD,
    );
}

function controllableCount(flow: SectorFlow): number {
  return flow.setup.roster.all().filter((m) => okControllable(flow, m)).length;
}

export function exitMenu(flow: SectorFlow, check: ExitCheck, selected: RosterMerc): ExitMenu {
  const t = flow.campaign.tactical?.state;
  const world = flow.world;
  const enemyInSector = t?.turn.enemyInSector === true;
  const allMoveDisabled = check.result === 1;
  const singleMove = check.result === 1;
  let allMoveOn = check.result === 2;
  const allMove = check.result === 2;
  let gotoSectorDisabled = t?.inCombat === true && controllableCount(flow) !== 1;
  let gotoSector = allMoveOn;
  let singleMoveDisabled = false;
  const peopleOnSquad = numberOfPlayerControllableMercsInSquad(flow.ctx, selected.assignment);
  const multipleSquads = multipleSquadsInSector(flow, selected);
  if (selected.isEpc) {
    if (peopleOnSquad > 1) allMoveOn = true;
    singleMoveDisabled = true;
  } else {
    let mercs = 1;
    let epcs = 0;
    for (const m of flow.setup.roster.all()) {
      if (m === selected || m.assignment !== selected.assignment) continue;
      if (m.isEpc) epcs++;
      else {
        mercs++;
        break;
      }
    }
    if (mercs === 1 && epcs >= 1) {
      allMoveOn = true;
      singleMoveDisabled = true;
    }
  }
  if (enemyInSector) {
    if (multipleSquads || (world && countAllMilitiaInSector(flow.ctx, world))) {
      gotoSectorDisabled = true;
      gotoSector = false;
    }
    if (!multipleSquads && !allMoveOn) {
      gotoSectorDisabled = true;
      gotoSector = false;
    }
  }
  if (!multipleSquads && allMoveOn) gotoSectorDisabled = true;
  return {
    loadOffered: check.minutes <= QUICK_TRAVERSAL_MINUTES,
    allMoveDisabled,
    singleMoveDisabled,
    multipleSquads,
    peopleOnSquad,
    singleMove,
    allMove,
    gotoSector,
    gotoSectorDisabled,
  };
}

export function singleMoveAction(flow: SectorFlow, menu: ExitMenu): void {
  if (!menu.multipleSquads) {
    if (flow.campaign.tactical?.state.turn.enemyInSector) {
      menu.gotoSectorDisabled = true;
      menu.gotoSector = false;
    } else menu.gotoSectorDisabled = false;
  } else menu.gotoSector = false;
  menu.singleMove = true;
  menu.allMove = false;
}

export function allMoveAction(menu: ExitMenu): void {
  if (!menu.multipleSquads) {
    menu.gotoSectorDisabled = true;
    menu.gotoSector = true;
  }
  menu.singleMove = false;
  menu.allMove = true;
}

export function jumpCodeOf(menu: ExitMenu): number | null {
  const load = menu.gotoSector && menu.loadOffered;
  if (menu.allMove) return load ? JumpCode.ALL_LOAD_NEW : JumpCode.ALL_NO_LOAD;
  if (menu.singleMove) return load ? JumpCode.SINGLE_LOAD_NEW : JumpCode.SINGLE_NO_LOAD;
  return null;
}

const isLoadJump = (code: number) => code === JumpCode.ALL_LOAD_NEW || code === JumpCode.SINGLE_LOAD_NEW;
const isNoLoadJump = (code: number) => code === JumpCode.ALL_NO_LOAD || code === JumpCode.SINGLE_NO_LOAD;

function groupMercs(flow: SectorFlow, g: Group): RosterMerc[] {
  return g.members.map((id) => flow.setup.roster.get(id)).filter((m): m is RosterMerc => m !== undefined);
}

export function jumpIntoAdjacentSector(
  flow: SectorFlow,
  direction: number,
  jumpCode: number,
  additional: number,
  selected: RosterMerc,
): boolean {
  const t = flow.campaign.tactical?.state;
  const world = flow.world;
  if (!t || !world) return false;
  let valid: RosterMerc | null = null;
  if (jumpCode === JumpCode.ALL_LOAD_NEW || jumpCode === JumpCode.ALL_NO_LOAD) {
    valid = flow.setup.roster.all().find((m) => okControllable(flow, m) && m.assignment === selected.assignment) ?? null;
  } else {
    valid = selected;
    if (jumpCode === JumpCode.SINGLE_NO_LOAD) handleSoldierLeavingSectorByThemSelf(flow.ctx, selected.id);
    else addCharacterToUniqueSquad(flow.ctx, selected.id);
  }
  const group = valid ? getGroup(flow.ctx, valid.groupId) : undefined;
  if (!valid || !group) return false;
  let minutes = 0;
  if (direction !== DIRECTION_EXITGRID) minutes = traverseTime(flow, group, STRATEGIC_MOVE_OF[direction] ?? 0, true);
  let target: Sector;
  if (direction !== DIRECTION_EXITGRID) {
    const [dx, dy] = SECTOR_STEP[direction] ?? [0, 0];
    target = { x: world.x + dx, y: world.y + dy, z: valid.sector.z };
  } else {
    const exit = exitGridAt(t, additional);
    if (!exit) return false;
    target = exit.sector;
  }
  flow.jump = { groupId: group.id, jumpCode, traverseMinutes: minutes, direction, additional, target };
  const walking = states(t.content.animations).WALKING;
  const leaving = groupMercs(flow, group).filter((m) => okControllable(flow, m));
  setActionToDoOnceMercsGetToLocation(
    t,
    direction === DIRECTION_EXITGRID ? WaitForMercs.WALK_TO_GRIDNO : WaitForMercs.WALKOFF_SCREEN,
    leaving.length,
  );
  for (const m of leaving) {
    const s = m.soldier;
    if (direction !== DIRECTION_EXITGRID) {
      const g = pickGridNoNearestEdge(t, s, direction);
      s.preTraversalGridNo = s.gridNo;
      if (g === NOWHERE) continue;
      s.waitActionToDo = 2;
      s.pendingActionData1 = direction;
      getNewSoldierPath(t, s, g, walking);
    } else {
      const g = findGridNoFromSweetSpotCloseToExitGrid(t, s, additional, EXIT_SWEET_SPOT_RADIUS);
      s.waitActionToDo = 1;
      if (g !== NOWHERE) getNewSoldierPath(t, s, g, walking);
    }
  }
  for (const m of groupMercs(flow, group)) if (!okControllable(flow, m)) removeCharacterFromSquads(flow.ctx, m.id);
  return true;
}

function setInsertionDataFromAdjacentMoveDirection(flow: SectorFlow, m: RosterMerc, direction: number, additional: number): void {
  if (direction === DIRECTION_EXITGRID) {
    const t = flow.campaign.tactical?.state;
    const exit = t ? exitGridAt(t, additional) : null;
    m.insertionCode = InsertionCode.GRIDNO;
    m.soldier.insertionData = exit?.gridNo ?? additional;
    m.soldier.useExitGridForReentryDirection = true;
    return;
  }
  m.insertionCode = ENTRY_CODE_OF[direction] ?? InsertionCode.WEST;
}

function clearTraversal(flow: SectorFlow): void {
  const tt = flow.campaign.state.movement.tacticalTraversal;
  tt.active = false;
  tt.groupId = 0;
  tt.chosenSoldier = -1;
}

function setupTacticalTraversalInformation(flow: SectorFlow, jump: AdjacentJump, group: Group): void {
  const t = flow.campaign.tactical?.state;
  for (const m of groupMercs(flow, group)) {
    setInsertionDataFromAdjacentMoveDirection(flow, m, jump.direction, jump.additional);
    plotPathForCharacter(flow.ctx, m.id, jump.target, { tacticalTraversal: true });
    if (jump.traverseMinutes > QUICK_TRAVERSAL_MINUTES || !t) continue;
    m.soldier.pendingActionData2 = mirrorGridNo(t, m.soldier, jump.direction);
    m.soldier.insertionData = m.insertionCode;
    m.insertionCode = calcMapEdgepointClassInsertionCode(t, m.soldier.preTraversalGridNo, jump.direction);
    if (isLoadJump(jump.jumpCode)) flow.usingEdgepointsForEntry = true;
  }
  if (isNoLoadJump(jump.jumpCode)) clearTraversal(flow);
}

export function allMercsHaveWalkedOffSector(flow: SectorFlow): void {
  const jump = flow.jump;
  const world = flow.world;
  const group = jump ? getGroup(flow.ctx, jump.groupId) : undefined;
  if (!jump || !world || !group) return;
  const enemies = numEnemiesInAnySector(flow.ctx, world) > 0;
  if (enemies) flow.handleLoyaltyImplicationsOfMercRetreat(true, world);
  const movement = flow.campaign.state.movement;
  const quick = jump.traverseMinutes <= QUICK_TRAVERSAL_MINUTES;
  if (quick) {
    movement.tacticalTraversal.active = true;
    movement.tacticalTraversal.groupId = group.id;
    if (jump.target.z > 0) movement.undergroundTacticalTraversal = true;
  }
  clearMercPathsAndWaypointsForAllInGroup(flow.ctx, group);
  addWaypointToPGroup(flow.ctx, group, jump.target);
  if (jump.target.z > 0 && quick) movement.undergroundTacticalTraversal = true;
  setupTacticalTraversalInformation(flow, jump, group);
  const toMapScreen = !isNoLoadJump(jump.jumpCode) && !quick;
  flow.events.push({
    type: 'mercsLeftSector',
    sector: sectorShortString(world),
    to: sectorShortString(jump.target),
    ...(toMapScreen ? { mapScreen: true as const } : {}),
    tick: flow.campaign.tick,
  });
  if (isNoLoadJump(jump.jumpCode)) {
    for (const m of groupMercs(flow, group)) flow.removeMercFromTacticalSector(m);
    return;
  }
  const clock = flow.campaign.clockContext;
  if (enemies) {
    resetMovementForEnemyGroupsInLocation(flow.ctx, world);
    if (!quick) warpGameTime(clock, RETREAT_WARP_SECONDS, Warp.NO_PROCESSING);
  }
  if (quick) {
    const seconds = flow.campaign.state.clock.seconds;
    const minutes = jump.target.z ? UNDERGROUND_WARP_MINUTES : QUICK_TRAVERSAL_MINUTES;
    const warp = (Math.trunc(seconds / SECONDS_PER_MINUTE) + minutes) * SECONDS_PER_MINUTE - seconds;
    warpGameTime(clock, warp, Warp.TARGET_TIME_FIRST);
    doneFadeOutAdjacentSector(flow, jump);
  } else if (flow.campaign.tactical) flow.checkAndHandleUnloadingOfCurrentWorld();
}

function doneFadeOutAdjacentSector(flow: SectorFlow, jump: AdjacentJump): void {
  flow.setCurrentWorldSector(jump.target);
  const entryCode = ENTRY_CODE_OF[jump.direction] ?? InsertionCode.EAST;
  clearTraversal(flow);
  const t = flow.campaign.tactical?.state;
  const group = getGroup(flow.ctx, jump.groupId);
  if (!t || !group) return;
  if (t.world.map?.ambient?.caves) t.ignoreAllObstacles = true;
  const walking = states(t.content.animations).WALKING;
  let n = 0;
  for (const m of groupMercs(flow, group)) {
    const s = m.soldier;
    if (!s.placed || s.gridNo === NOWHERE) continue;
    const picked = pickGridNoToWalkIn(t, s, entryCode);
    let g = picked.gridNo;
    if (g === NOWHERE && picked.attempts === 200) g = s.gridNo;
    if (g === NOWHERE) continue;
    s.waitActionToDo = 1;
    const old = s.gridNo;
    setSoldierPosition(t, s, g);
    if (g !== old) getNewSoldierPath(t, s, old, walking);
    n++;
  }
  setActionToDoOnceMercsGetToLocation(t, WaitForMercs.WALKON_SCREEN, n);
}

export function allMercsWalkedToExitGrid(flow: SectorFlow): void {
  const jump = flow.jump;
  const group = jump ? getGroup(flow.ctx, jump.groupId) : undefined;
  if (!jump || !group) return;
  flow.handlePotentialMoraleHitForSkimmingSectors(group.id);
  const world = flow.world;
  if (isNoLoadJump(jump.jumpCode)) {
    for (const m of groupMercs(flow, group)) {
      setInsertionDataFromAdjacentMoveDirection(flow, m, jump.direction, jump.additional);
      flow.removeMercFromTacticalSector(m);
    }
    setGroupSectorValue(flow.ctx, jump.target, group);
  } else {
    const tt = flow.campaign.state.movement.tacticalTraversal;
    tt.active = true;
    tt.groupId = group.id;
    for (const m of groupMercs(flow, group)) if (m.life < OKLIFE) addCharacterToUniqueSquad(flow.ctx, m.id);
    for (const m of groupMercs(flow, group)) setInsertionDataFromAdjacentMoveDirection(flow, m, jump.direction, jump.additional);
    flow.overrideInsertionWithExitGrid = null;
    setGroupSectorValue(flow.ctx, jump.target, group);
    flow.setCurrentWorldSector(jump.target);
    clearTraversal(flow);
  }
  if (!playerMercsInSector(flow.ctx, jump.target)) flow.handleLoyaltyImplicationsOfMercRetreat(true, jump.target);
  if (isNoLoadJump(jump.jumpCode)) clearTraversal(flow);
  if (world)
    flow.events.push({
      type: 'mercsLeftSector',
      sector: sectorShortString(world),
      to: sectorShortString(jump.target),
      tick: flow.campaign.tick,
    });
}

function parseDirection(value: unknown): number | null {
  return typeof value === 'string' ? (DIRECTION_NAMES[value] ?? null) : null;
}

export interface ExitPlan {
  readonly check: ExitCheck;
  readonly menu: ExitMenu | null;
}

export function exitCheck(flow: SectorFlow, selected: RosterMerc, direction: number, exitGridNo: number): ExitPlan {
  const exitDirection = direction === DIRECTION_EXITGRID ? ExitDirection.EXIT_GRID : (STRATEGIC_MOVE_OF[direction] ?? 0);
  const check = okForSectorExit(flow, exitDirection, exitGridNo, selected);
  return { check, menu: check.result === 0 ? null : exitMenu(flow, check, selected) };
}

function refusalOf(check: ExitCheck): string {
  if (check.invalidTraversal) return 'invalidTraversal';
  if (check.uncontrolledRobot) return 'uncontrolledRobot';
  if (check.loneEpc) return 'loneEPC';
  if (check.abandonedEpcs) return 'abandonEPC';
  return 'tooFar';
}

export function exitSectorCommand(flow: SectorFlow, cmd: { readonly [key: string]: unknown }): CommandResult {
  const sim = flow.campaign.tactical;
  if (!sim) return { ok: false, reason: 'no sector is loaded' };
  if (sim.state.mercsWaiting) return { ok: false, reason: 'mercs are already leaving the sector' };
  const selected = typeof cmd.soldier === 'number' ? flow.setup.roster.get(cmd.soldier) : undefined;
  if (!selected || !soldierOf(flow, selected)) return { ok: false, reason: 'no such soldier of yours in this sector' };
  const refusal = sim.canAct(selected.soldier);
  if (refusal) return { ok: false, reason: refusal };
  const direction = cmd.exitGrid !== undefined ? DIRECTION_EXITGRID : parseDirection(cmd.direction);
  if (direction === null) return { ok: false, reason: "give direction 'north'|'east'|'south'|'west' or exitGrid: gridNo" };
  const exitGridNo = typeof cmd.exitGrid === 'number' ? cmd.exitGrid : 0;
  if (direction === DIRECTION_EXITGRID && !exitGridAt(sim.state, exitGridNo)) return { ok: false, reason: 'no exit grid at that gridNo' };
  const plan = exitCheck(flow, selected, direction, exitGridNo);
  if (!plan.menu) return { ok: false, reason: refusalOf(plan.check), data: { minutes: plan.check.minutes } };
  const menu = plan.menu;
  if (cmd.who === 'squad' && !menu.allMove) {
    if (menu.allMoveDisabled) return { ok: false, reason: 'squadNotAllowed' };
    allMoveAction(menu);
  } else if (cmd.who === 'merc' && !menu.singleMove) {
    if (menu.singleMoveDisabled) return { ok: false, reason: 'mercNotAllowed' };
    singleMoveAction(flow, menu);
  }
  if (typeof cmd.load === 'boolean' && cmd.load !== menu.gotoSector) {
    if (menu.gotoSectorDisabled) return { ok: false, reason: 'loadDisabled' };
    menu.gotoSector = cmd.load;
  }
  if (selected.isEpc && menu.peopleOnSquad === 0) return { ok: false, reason: 'loneEPC' };
  const jumpCode = jumpCodeOf(menu);
  if (jumpCode === null) return { ok: false, reason: menu.allMoveDisabled ? 'mercNotAllowed' : 'squadNotAllowed' };
  if (!jumpIntoAdjacentSector(flow, direction, jumpCode, exitGridNo, selected)) return { ok: false, reason: 'cannot leave from here' };
  const target = flow.jump?.target ?? flow.world ?? { x: 1, y: 1, z: 0 };
  return {
    ok: true,
    data: {
      minutes: plan.check.minutes,
      who: menu.allMove ? 'squad' : 'merc',
      load: isLoadJump(jumpCode),
      target: sectorShortString(target),
      level: target.z,
    },
  };
}

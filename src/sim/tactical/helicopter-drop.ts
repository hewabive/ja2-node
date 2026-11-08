// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-11-08. See LICENSE (SFI-SCLA).
// @src src/game/Tactical/Merc_Entering.cc ubHeliScripts, AddMercToHeli, StartHelicopterRun, HandleHeliDrop (its Esc
// @src branch, the script step, the fades, the drop of a seat and the rounds); HandleFirstHeliDropOfGame and the lock's
// @src pause are the sector flow's; UILayout.cc and rust/stracciatella/src/config/resolution.rs REPEAT_HELI_MOVEAWAY at
// @src the reference 640x480; Utils/Sound_Control.h HIGHVOLUME.

import { CELL_X_SIZE, CELL_Y_SIZE } from '../../content/world/grid.ts';
import { i16, idiv, u32 } from '../../core/int.ts';
import { anim } from './anim-states.ts';
import { initNewSoldierAnim } from './animation.ts';
import { type HelicopterDrop, type HeliShadow, HeliState } from './helicopter-drop-state.ts';
import { Insertion, updateMercInSector } from './insertion.ts';
import { soldierAssignment } from './narrative/assignment.ts';
import { rebuildCurrentSquad, SelectFlags, selectSoldier, setCurrentSquad } from './selection.ts';
import { cellCentre, inSector, type Soldier } from './soldier.ts';
import type { SectorHooks, TacticalState } from './state.ts';

const HeliCode = {
  REST: 0,
  MOVE_DOWN: 1,
  MOVE_UP: 2,
  MOVESMALL_DOWN: 3,
  MOVESMALL_UP: 4,
  MOVEY: 5,
  MOVELARGERY: 6,
  SHOW_HELI: 7,
  GOTO_BEGINDROP: 8,
  GOTO_DROP: 9,
  GOTO_EXIT: 10,
  GOTO_MOVETO: 11,
  GOTO_MOVEAWAY: 12,
  DONE: 13,
} as const;

const MAX_MERC_IN_HELI = 20;
const MAX_HELI_SCRIPT = 30;
const ME_SCRIPT_DELAY = 100;
const NUM_PER_HELI_RUN = 6;
const REFERENCE_STD_SCREEN_X = 0;
const MOVEAWAY_REPEAT_DIVISOR = 7;
const REPEAT_HELI_MOVEAWAY = idiv(REFERENCE_STD_SCREEN_X, MOVEAWAY_REPEAT_DIVISOR);
const HIGHVOLUME = 127;
const VOLUME_STEP = 5;
const HELI_OFFSET_X = 2 * CELL_X_SIZE;
const HELI_OFFSET_Y = 10 * CELL_Y_SIZE;
const MOVEY_STEP = 4;
const MOVELARGERY_STEP = 6;
const MOVE_STEP = 1;
const MOVESMALL_STEP = 0.25;
const EXIT_COUNT = 2;
const EXIT_COUNT_TO_LEAVE = 1;
const RESTART_SCRIPT = -1;
const HOVER_STEPS = 5;
const LAST_HOVER_STEPS = 4;
const STEPS_BEFORE_A_JUMP = MAX_HELI_SCRIPT - 1;
const NO_SECTOR = { x: 0, y: 0, z: 0 } as const;

const repeat = (code: number, count: number): number[] => Array.from({ length: count }, () => code);

const HOVER = [
  ...repeat(HeliCode.MOVESMALL_UP, HOVER_STEPS),
  ...repeat(HeliCode.MOVESMALL_DOWN, HOVER_STEPS),
  ...repeat(HeliCode.MOVESMALL_UP, HOVER_STEPS),
  ...repeat(HeliCode.MOVESMALL_DOWN, HOVER_STEPS),
  ...repeat(HeliCode.MOVESMALL_UP, HOVER_STEPS),
  ...repeat(HeliCode.MOVESMALL_DOWN, LAST_HOVER_STEPS),
];

const HELI_SCRIPTS: readonly (readonly number[])[] = [
  [...repeat(HeliCode.REST, STEPS_BEFORE_A_JUMP), HeliCode.GOTO_MOVETO],
  [HeliCode.SHOW_HELI, ...repeat(HeliCode.MOVEY, STEPS_BEFORE_A_JUMP - 1), HeliCode.GOTO_BEGINDROP],
  [...repeat(HeliCode.MOVE_DOWN, STEPS_BEFORE_A_JUMP), HeliCode.GOTO_DROP],
  [...HOVER, HeliCode.GOTO_DROP],
  [...repeat(HeliCode.MOVE_UP, STEPS_BEFORE_A_JUMP), HeliCode.GOTO_MOVEAWAY],
  [...repeat(HeliCode.MOVELARGERY, STEPS_BEFORE_A_JUMP), HeliCode.GOTO_EXIT],
  [...repeat(HeliCode.REST, STEPS_BEFORE_A_JUMP), HeliCode.DONE],
];

export function addMercToHeli(drop: HelicopterDrop, id: number): void {
  if (drop.seats.length >= MAX_MERC_IN_HELI || drop.seats.includes(id)) return;
  drop.seats.push(id);
}

export function startHelicopterRun(t: TacticalState, sweetSpot: number): boolean {
  const d = t.helicopterDrop;
  d.sweetSpot = sweetSpot;
  if (d.seats.length === 0) return false;
  d.z = 0;
  d.script = 0;
  d.curDrop = 0;
  d.exitCount = 0;
  d.round = 1;
  d.state = HeliState.APPROACH;
  d.lastStepMs = t.clockMs;
  d.volume = 0;
  d.fadingIn = true;
  d.running = true;
  d.firstGuyDown = true;
  return true;
}

function someoneInHelidrop(t: TacticalState): boolean {
  const helidrop = anim(t.content, 'HELIDROP');
  return t.mercSlots.some((s) => inSector(s) && s.state === helidrop);
}

export function helicopterDropStalled(t: TacticalState): boolean {
  const d = t.helicopterDrop;
  return d.running && d.state === HeliState.DROP && d.engagedInDrop && !someoneInHelidrop(t);
}

function seatSoldier(t: TacticalState, id: number | undefined): Soldier | null {
  return id === undefined ? null : t.sectorHooks.helicopterSeat(t, id);
}

function runEnded(t: TacticalState): void {
  t.events.push({ type: 'helicopterDropEnded', first: t.helicopterDrop.firstHeliRun });
  t.sectorHooks.helicopterRunEnded(t);
}

function endOfTheRun(t: TacticalState, d: HelicopterDrop): void {
  d.running = false;
  d.seats.length = 0;
  rebuildCurrentSquad(t);
  runEnded(t);
}

function stepEngineFade(t: TacticalState, d: HelicopterDrop): void {
  if (d.fadingIn) {
    d.volume = Math.min(HIGHVOLUME, d.volume + VOLUME_STEP);
    if (d.volume === HIGHVOLUME) d.fadingIn = false;
  } else if (d.fadingOut) {
    d.volume = Math.max(0, d.volume - VOLUME_STEP);
    if (d.volume !== 0) return;
    d.fadingOut = false;
    endOfTheRun(t, d);
  }
}

function dropSeat(t: TacticalState, d: HelicopterDrop): void {
  const s = seatSoldier(t, d.seats[d.curDrop]);
  if (s) {
    initNewSoldierAnim(t, s, anim(t.content, 'HELIDROP'), 0, false);
    t.sectorHooks.placeHelicopterSeat(t, s);
  }
  if (d.firstGuyDown) {
    d.firstGuyDown = false;
    if (s) setCurrentSquad(t, soldierAssignment(t, s), true);
  }
  d.curDrop++;
  d.engagedInDrop = true;
}

function countDownToTheClimb(d: HelicopterDrop): void {
  if (d.exitCount === 0) {
    d.exitCount = EXIT_COUNT;
    return;
  }
  d.exitCount--;
  if (d.exitCount === EXIT_COUNT_TO_LEAVE) jumpTo(d, HeliState.ENDDROP);
}

function dropOrClimb(t: TacticalState, d: HelicopterDrop): void {
  const roundEnd = Math.min(d.round * NUM_PER_HELI_RUN, d.seats.length);
  if (d.curDrop < roundEnd) dropSeat(t, d);
  else countDownToTheClimb(d);
}

function moveShadowZ(d: HelicopterDrop, by: number): void {
  d.z += by;
  if (d.shadow) d.shadow.z = i16(d.z);
}

function moveShadowY(d: HelicopterDrop, by: number): void {
  if (d.shadow) d.shadow.y = i16(d.shadow.y + by);
}

function showShadow(d: HelicopterDrop): void {
  if (d.shadow) d.strandedShadows.push(d.shadow);
  const centre = cellCentre(d.sweetSpot);
  const shadow: HeliShadow = {
    gridNo: d.sweetSpot,
    x: centre.x - HELI_OFFSET_X,
    y: centre.y - HELI_OFFSET_Y,
    z: i16(d.z),
  };
  d.shadow = shadow;
}

function jumpTo(d: HelicopterDrop, state: number): void {
  d.script = RESTART_SCRIPT;
  d.state = state;
}

function moveAway(d: HelicopterDrop): void {
  if (d.moveAwayRepeated < REPEAT_HELI_MOVEAWAY) {
    d.moveAwayRepeated++;
    d.script--;
  }
  moveShadowY(d, MOVELARGERY_STEP);
}

function exitOrNextRound(t: TacticalState, d: HelicopterDrop): void {
  d.shadow = null;
  if (d.curDrop < d.seats.length) {
    d.z = 0;
    d.script = 0;
    d.exitCount = 0;
    d.state = HeliState.APPROACH;
    d.round++;
    return;
  }
  jumpTo(d, HeliState.EXIT);
  const first = seatSoldier(t, d.seats[0]);
  if (first) selectSoldier(t, first, SelectFlags.FORCE_RESELECT);
}

function runCode(t: TacticalState, d: HelicopterDrop, code: number): void {
  switch (code) {
    case HeliCode.MOVE_DOWN:
      moveShadowZ(d, -MOVE_STEP);
      break;
    case HeliCode.MOVE_UP:
      moveShadowZ(d, MOVE_STEP);
      break;
    case HeliCode.MOVESMALL_DOWN:
      moveShadowZ(d, -MOVESMALL_STEP);
      break;
    case HeliCode.MOVESMALL_UP:
      moveShadowZ(d, MOVESMALL_STEP);
      break;
    case HeliCode.MOVEY:
      moveShadowY(d, MOVEY_STEP);
      break;
    case HeliCode.MOVELARGERY:
      moveAway(d);
      break;
    case HeliCode.GOTO_BEGINDROP:
      jumpTo(d, HeliState.BEGINDROP);
      break;
    case HeliCode.SHOW_HELI:
      showShadow(d);
      break;
    case HeliCode.GOTO_DROP:
      moveShadowZ(d, -MOVESMALL_STEP);
      jumpTo(d, HeliState.DROP);
      break;
    case HeliCode.GOTO_MOVETO:
      jumpTo(d, HeliState.MOVETO);
      break;
    case HeliCode.GOTO_MOVEAWAY:
      jumpTo(d, HeliState.MOVEAWAY);
      break;
    case HeliCode.GOTO_EXIT:
      exitOrNextRound(t, d);
      break;
    case HeliCode.DONE:
      d.fadingOut = true;
      break;
  }
}

export function handleHeliDrop(t: TacticalState): void {
  const d = t.helicopterDrop;
  if (!d.running) return;
  if (u32(t.clockMs - d.lastStepMs) <= ME_SCRIPT_DELAY) return;
  d.lastStepMs = t.clockMs;
  stepEngineFade(t, d);
  if (d.script === MAX_HELI_SCRIPT) return;
  const code = HELI_SCRIPTS[d.state]?.[d.script] ?? HeliCode.REST;
  if (d.state === HeliState.DROP && !d.engagedInDrop) dropOrClimb(t, d);
  runCode(t, d, code);
  d.script++;
}

export function skipHelicopterDrop(t: TacticalState): boolean {
  const d = t.helicopterDrop;
  if (!d.running) return false;
  for (let seat = d.curDrop; seat < d.seats.length; seat++) {
    const s = seatSoldier(t, d.seats[seat]);
    if (!s) continue;
    t.sectorHooks.placeHelicopterSeat(t, s);
    t.sectorHooks.mercArrivesQuotes(t, s);
  }
  d.shadow = null;
  rebuildCurrentSquad(t);
  d.running = false;
  const first = seatSoldier(t, d.seats[0]);
  d.seats.length = 0;
  if (first) selectSoldier(t, first, SelectFlags.FORCE_RESELECT);
  runEnded(t);
  return true;
}

export function placeHelicopterSeatAtTheNorthEntry(t: TacticalState, s: Soldier): void {
  const sector = t.sector ?? NO_SECTOR;
  const order = { code: Insertion.NORTH, data: s.insertionData, direction: s.direction };
  updateMercInSector(t, s, order, { worldSector: sector, mercSector: sector, startSector: sector, usingEdgepoints: false });
}

export const SANDBOX_HELICOPTER_SEATS: Pick<SectorHooks, 'helicopterSeat' | 'placeHelicopterSeat'> = {
  helicopterSeat: (t, id) => t.soldiers[id] ?? null,
  placeHelicopterSeat: placeHelicopterSeatAtTheNorthEntry,
};

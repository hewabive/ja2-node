// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-19. See LICENSE (SFI-SCLA).
// @src src/game/Tactical/Turn_Based_Input.cc HandleCheckForExitArrowsInput (OKForSectorExit decides the arrow colour);
// @src Tactical/Strategic_Exit_GUI.cc InternalInitSectorExitMenu (the dialog's toggles); Strategic/StrategicMap.cc
// @src OKForSectorExit. See docs/28 §6.1.

import { Direction } from '../../content/world/grid.ts';
import {
  decideSectorExit,
  type ExitCheck,
  type ExitMenu,
  type ExitMerc,
  type ExitWorld,
  exitCheck,
  exitResultData,
  exitTarget,
  exitTraverseTime,
} from '../campaign/sector-exits.ts';
import { preservingFields } from '../knowledge/guard.ts';
import type { KnowledgeWorld, TacticalKnowledge } from '../knowledge/knowledge-world.ts';
import type { StrategicKnowledge } from '../knowledge/strategic.ts';
import { countAllMilitiaInSector } from '../strategic/economy/militia-rules.ts';
import { getGroup } from '../strategic/forces/groups.ts';
import { numberOfPlayerControllableMercsInSquad } from '../strategic/forces/squads.ts';
import { DIRECTION_EXITGRID } from '../tactical/sector-exit.ts';
import { createSoldier, type Soldier } from '../tactical/soldier.ts';
import { actingSoldier } from './soldier-check.ts';
import { type HintRefusal, type HintRequestBase, type HintResult, hintData, refuseHint } from './types.ts';

const DIRECTIONS: Readonly<Record<string, number>> = {
  north: Direction.NORTH,
  east: Direction.EAST,
  south: Direction.SOUTH,
  west: Direction.WEST,
};
const UNPLACED_PALETTES = { hair: '', skin: '', vest: '', pants: '' };
const NO_STATS = {
  agility: 0,
  dexterity: 0,
  strength: 0,
  wisdom: 0,
  leadership: 0,
  marksmanship: 0,
  mechanical: 0,
  medical: 0,
  explosives: 0,
  experience: 0,
};

export interface ExitSectorRequest extends HintRequestBase {
  readonly soldier?: unknown;
  readonly direction?: unknown;
  readonly exitGrid?: unknown;
  readonly who?: unknown;
  readonly load?: unknown;
}

export interface ExitSectorDryRun {
  readonly minutes: number;
  readonly who: string;
  readonly load: boolean;
  readonly target: string;
  readonly level: number;
}

export interface ExitSectorOptions extends Omit<ExitCheck, 'result'> {
  readonly result: number;
  readonly menu: ExitMenu | null;
}

function unplacedSoldier(id: number, team: number): Soldier {
  return createSoldier({
    id,
    team,
    name: '',
    bodyType: 0,
    palettes: UNPLACED_PALETTES,
    stats: NO_STATS,
    life: 0,
    gridNo: 0,
    direction: 0,
    state: 0,
  });
}

function projectedExitWorld(sk: StrategicKnowledge, tactical: TacticalKnowledge): ExitWorld {
  const ctx = sk.ctx;
  const world = ctx.state.worldSector;
  const mercs: ExitMerc[] = ctx.crew.all().map((m) => ({
    id: m.id,
    life: m.life,
    assignment: m.assignment,
    isEpc: m.isEpc,
    isRobot: m.isRobot,
    groupId: m.groupId,
    betweenSectors: m.betweenSectors,
    sector: m.sector,
    soldier: tactical.ownSoldier(m.id) ?? unplacedSoldier(m.id, 0),
  }));
  return {
    tactical: tactical.state,
    world,
    enemyInSector: sk.enemyInLoadedSector,
    mercs: () => mercs,
    inTactical: (m) => tactical.ownSoldier(m.id) !== null,
    canRobotBeControlled: (id) => sk.mercView(id)?.controlled === true,
    traverseTime: (groupId, exitDirection, anyUnderground) =>
      exitTraverseTime(ctx, world, tactical.state, groupId === null ? undefined : getGroup(ctx, groupId), exitDirection, anyUnderground),
    controllableInSquad: (squad) => numberOfPlayerControllableMercsInSquad(ctx, squad),
    militiaInWorld: () => (world ? countAllMilitiaInSector(ctx, world) : 0),
  };
}

interface ExitSubject {
  readonly world: ExitWorld;
  readonly selected: ExitMerc;
  readonly tactical: TacticalKnowledge;
}

function exitSubject(world: KnowledgeWorld, req: ExitSectorRequest): ExitSubject | { readonly refusal: HintRefusal } {
  const sk = world.strategic;
  const tactical = world.tactical;
  if (!sk || !tactical) return { refusal: refuseHint('noSector', 'no sector is loaded') };
  const acting = actingSoldier(world, req.soldier);
  if ('refusal' in acting) return acting;
  const exitWorld = projectedExitWorld(sk, tactical);
  const selected = exitWorld.mercs().find((m) => m.id === acting.soldier.id);
  if (!selected) return { refusal: refuseHint('noSuchSoldier', 'no such soldier of yours in this sector') };
  if (acting.blocked) return { refusal: refuseHint(acting.blocked, acting.blocked) };
  return { world: exitWorld, selected, tactical };
}

function withMovementModesKept<R>(tactical: TacticalKnowledge, world: ExitWorld, run: () => R): R {
  const soldiers = world
    .mercs()
    .map((m) => tactical.ownSoldier(m.id))
    .filter((s): s is Soldier => s !== null);
  const keep = (k: number): R => {
    const s = soldiers[k];
    return s ? preservingFields(s, ['uiMovementMode'], () => keep(k + 1)) : run();
  };
  return keep(0);
}

export function exitSectorDryRun(world: KnowledgeWorld, req: ExitSectorRequest): HintResult<ExitSectorDryRun> {
  const subject = exitSubject(world, req);
  if ('refusal' in subject) return subject.refusal;
  const decision = withMovementModesKept(subject.tactical, subject.world, () => decideSectorExit(subject.world, subject.selected, req));
  if (!decision.ok) {
    const refused = refuseHint(decision.refusal, decision.reason);
    return decision.minutes === undefined ? refused : { ...refused, data: { ...refused.data, minutes: decision.minutes } };
  }
  const target = exitTarget(subject.world, decision.direction, decision.exitGridNo);
  if (!target) return refuseHint('noSector', 'no sector is loaded');
  return hintData(exitResultData(decision.check, decision.menu, decision.jumpCode, target));
}

function directionOf(req: ExitSectorRequest): number | null {
  if (req.exitGrid !== undefined) return DIRECTION_EXITGRID;
  return typeof req.direction === 'string' ? (DIRECTIONS[req.direction] ?? null) : null;
}

export function exitSectorOptions(world: KnowledgeWorld, req: ExitSectorRequest): HintResult<ExitSectorOptions> {
  const subject = exitSubject(world, req);
  if ('refusal' in subject) return subject.refusal;
  const direction = directionOf(req);
  if (direction === null) return refuseHint('badDirection', "give direction 'north'|'east'|'south'|'west' or exitGrid: gridNo");
  const exitGridNo = typeof req.exitGrid === 'number' ? req.exitGrid : 0;
  const plan = withMovementModesKept(subject.tactical, subject.world, () =>
    exitCheck(subject.world, subject.selected, direction, exitGridNo),
  );
  return hintData({ ...plan.check, menu: plan.menu });
}

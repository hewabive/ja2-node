// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-11-10. See LICENSE (SFI-SCLA).
// @src src/game/Tactical/Handle_UI.cc SetUIMouseCursor (the exit arrows at the map's edges and the exit grid cursor, both
// @src for the selected merc); Strategic/StrategicMap.cc OKForSectorExit, SoldierOKForSectorExit (the screen band a merc
// @src leaves an edge from).

import { isValidSector, type Sector, sectorShortString } from '../../content/strategic/sector-ids.ts';
import { Direction, WORLD_COLS, WORLD_MAX, WORLD_ROWS } from '../../content/world/grid.ts';
import { idiv } from '../../core/int.ts';
import { adjacentSector, decideSectorExit, type ExitMerc, edgeTraverseMinutes, exitSquad } from '../campaign/sector-exits.ts';
import type { KnowledgeWorld } from '../knowledge/knowledge-world.ts';
import { TRAVERSE_TIME_IMPOSSIBLE } from '../strategic/map/travel.ts';
import { ABSMAX_TRAIL_TREE, findBestPath, NOWHERE, newOKDestination, PathCopy, PathFlags } from '../tactical/pathfinding.ts';
import { atExitEdge, ExitDirection, soldierOKForSectorExit } from '../tactical/sector-exit.ts';
import type { Soldier } from '../tactical/soldier.ts';
import { onVisibleWorldTile, type TacticalState } from '../tactical/state.ts';
import { type ExitSubject, exitSubjectOf, withMovementModesKept } from './exit-sector.ts';
import { shownExitGrids } from './shown-map.ts';
import { type HintRequestBase, type HintResult, hintData, refuseHint } from './types.ts';

export type EdgeName = 'north' | 'east' | 'south' | 'west';
export type BandAxis = 'x-y' | 'x+y';

export interface ExitBand {
  readonly of: BandAxis;
  readonly min?: number;
  readonly max?: number;
}

export interface EdgeExit {
  readonly edge: EdgeName;
  readonly to: string | null;
  readonly minutes: number | null;
  readonly exit: string;
  readonly band: ExitBand;
  readonly inBand: readonly number[];
  readonly walkTo: Readonly<Record<string, number>>;
}

export interface ExitGridExit {
  readonly to: string;
  readonly level: number;
  readonly gridNos: readonly number[];
  readonly exit: string;
}

export interface SectorExits {
  readonly sector: string;
  readonly level: number;
  readonly soldier: number;
  readonly edges: readonly EdgeExit[];
  readonly exitGrids: readonly ExitGridExit[];
}

export interface SectorExitsRequest extends HintRequestBase {
  readonly soldier?: unknown;
}

interface Edge {
  readonly edge: EdgeName;
  readonly direction: number;
  readonly exitDirection: number;
  readonly of: BandAxis;
  readonly bound: 'min' | 'max';
}

const EDGES: readonly Edge[] = [
  { edge: 'north', direction: Direction.NORTH, exitDirection: ExitDirection.NORTH, of: 'x+y', bound: 'max' },
  { edge: 'east', direction: Direction.EAST, exitDirection: ExitDirection.EAST, of: 'x-y', bound: 'min' },
  { edge: 'south', direction: Direction.SOUTH, exitDirection: ExitDirection.SOUTH, of: 'x+y', bound: 'min' },
  { edge: 'west', direction: Direction.WEST, exitDirection: ExitDirection.WEST, of: 'x-y', bound: 'max' },
];

const OK = 'ok';
const SUMS_ON_THE_MIDDLE_SCREEN_ROWS = [WORLD_COLS, WORLD_COLS + 1];
const DIFFERENCES_ON_THE_MIDDLE_SCREEN_COLUMNS = [0, 1];

function axisValue(g: number, of: BandAxis): number {
  const x = g % WORLD_COLS;
  const y = idiv(g, WORLD_COLS);
  return of === 'x-y' ? x - y : x + y;
}

function tilesAcrossTheMiddleOfTheScreen(of: BandAxis): number[] {
  const across = of === 'x-y' ? SUMS_ON_THE_MIDDLE_SCREEN_ROWS : DIFFERENCES_ON_THE_MIDDLE_SCREEN_COLUMNS;
  const tiles: number[] = [];
  for (const k of across)
    for (let x = 0; x < WORLD_COLS; x++) {
      const y = of === 'x-y' ? k - x : x - k;
      if (y >= 0 && y < WORLD_ROWS) tiles.push(y * WORLD_COLS + x);
    }
  return tiles;
}

function exitBand(t: TacticalState, e: Edge): ExitBand {
  let bound: number | null = null;
  for (const g of tilesAcrossTheMiddleOfTheScreen(e.of)) {
    if (!onVisibleWorldTile(t, g) || !atExitEdge(t, g, e.exitDirection)) continue;
    const v = axisValue(g, e.of);
    if (bound === null || (e.bound === 'min' ? v < bound : v > bound)) bound = v;
  }
  return { of: e.of, [e.bound]: bound ?? 0 };
}

function bandTiles(t: TacticalState, band: ExitBand): number[] {
  const tiles: number[] = [];
  for (let g = 0; g < WORLD_MAX; g++) {
    const v = axisValue(g, band.of);
    const inBand = band.min !== undefined ? v >= band.min : v <= (band.max ?? v);
    if (inBand && onVisibleWorldTile(t, g)) tiles.push(g);
  }
  return tiles;
}

function squaredDistance(a: number, b: number): number {
  const dx = (a % WORLD_COLS) - (b % WORLD_COLS);
  const dy = idiv(a, WORLD_COLS) - idiv(b, WORLD_COLS);
  return dx * dx + dy * dy;
}

function exitAnswer(subject: ExitSubject, cmd: { readonly [key: string]: unknown }): string {
  if (subject.blocked) return subject.blocked;
  const decision = withMovementModesKept(subject.tactical, subject.world, () => decideSectorExit(subject.world, subject.selected, cmd));
  return decision.ok ? OK : decision.refusal;
}

function reachableFrom(t: TacticalState, s: Soldier): Uint8Array | null {
  const flood = findBestPath(t.pathEnv, s, NOWHERE, s.level, {
    copy: PathCopy.REACHABLE,
    flags: PathFlags.THROUGH_PEOPLE,
    maxTrailTree: ABSMAX_TRAIL_TREE,
  });
  return flood.reachable ?? null;
}

interface Walker {
  readonly merc: ExitMerc;
  readonly reachable: Uint8Array | null;
}

function walkers(t: TacticalState, squad: readonly ExitMerc[]): Walker[] {
  const floods: Uint8Array[] = [];
  return squad.map((merc) => {
    const s = merc.soldier;
    if (s.level > 0) return { merc, reachable: null };
    const shared = floods.find((reached) => reached[s.gridNo] === 1);
    if (shared) return { merc, reachable: shared };
    const own = reachableFrom(t, s);
    if (own) floods.push(own);
    return { merc, reachable: own };
  });
}

function nearestFreeBandTile(t: TacticalState, w: Walker, tiles: readonly number[], taken: ReadonlySet<number>): number {
  const s = w.merc.soldier;
  const reachable = w.reachable;
  let nearest = NOWHERE;
  let nearestDistance = Number.POSITIVE_INFINITY;
  if (!reachable) return nearest;
  for (const g of tiles) {
    if (!reachable[g] || taken.has(g)) continue;
    const distance = squaredDistance(s.gridNo, g);
    if (distance >= nearestDistance || !newOKDestination(t.pathEnv, s, g, true, s.level)) continue;
    nearest = g;
    nearestDistance = distance;
  }
  return nearest;
}

function walkTargets(
  t: TacticalState,
  squad: readonly Walker[],
  inBand: readonly number[],
  tiles: readonly number[],
): Record<string, number> {
  const targets: Record<string, number> = {};
  const taken = new Set<number>();
  for (const w of squad) {
    if (inBand.includes(w.merc.id)) continue;
    const g = nearestFreeBandTile(t, w, tiles, taken);
    if (g === NOWHERE) continue;
    targets[w.merc.id] = g;
    taken.add(g);
  }
  return targets;
}

function edgeTarget(world: Sector, direction: number, crossable: boolean): string | null {
  const target = adjacentSector(world, direction);
  if (!isValidSector(target) || (world.z > 0 && !crossable)) return null;
  return sectorShortString(target);
}

interface EdgeContext {
  readonly subject: ExitSubject;
  readonly world: Sector;
  readonly squad: readonly Walker[];
}

function edgeExit(c: EdgeContext, e: Edge): EdgeExit {
  const t = c.subject.tactical.state;
  const minutes = isValidSector(adjacentSector(c.world, e.direction))
    ? edgeTraverseMinutes(c.subject.world, c.subject.selected, e.direction)
    : TRAVERSE_TIME_IMPOSSIBLE;
  const crossable = minutes !== TRAVERSE_TIME_IMPOSSIBLE;
  const band = exitBand(t, e);
  const inBand = c.squad.filter((w) => soldierOKForSectorExit(t, w.merc.soldier, e.exitDirection, 0)).map((w) => w.merc.id);
  return {
    edge: e.edge,
    to: edgeTarget(c.world, e.direction, crossable),
    minutes: crossable ? minutes : null,
    exit: exitAnswer(c.subject, { direction: e.edge }),
    band,
    inBand,
    walkTo: crossable ? walkTargets(t, c.squad, inBand, bandTiles(t, band)) : {},
  };
}

function sectorKey(s: Sector): string {
  return `${s.x},${s.y},${s.z}`;
}

function exitGridExits(subject: ExitSubject, world: KnowledgeWorld): ExitGridExit[] {
  const groups = new Map<string, { readonly sector: Sector; readonly gridNos: number[] }>();
  for (const e of shownExitGrids(subject.tactical.state, world.view)) {
    const key = sectorKey(e.sector);
    const group = groups.get(key) ?? { sector: e.sector, gridNos: [] };
    group.gridNos.push(e.gridNo);
    groups.set(key, group);
  }
  return [...groups.values()].map((g) => ({
    to: sectorShortString(g.sector),
    level: g.sector.z,
    gridNos: g.gridNos,
    exit: exitAnswer(subject, { exitGrid: g.gridNos[0] }),
  }));
}

export function sectorExits(world: KnowledgeWorld, req: SectorExitsRequest): HintResult<SectorExits> {
  const subject = exitSubjectOf(world, req.soldier ?? world.view.selected);
  if ('refusal' in subject) return subject.refusal;
  const sector = subject.world.world;
  if (!sector) return refuseHint('noSector', 'no sector is loaded');
  const t = subject.tactical.state;
  const context = { subject, world: sector, squad: walkers(t, exitSquad(subject.world, subject.selected)) };
  return hintData({
    sector: sectorShortString(sector),
    level: sector.z,
    soldier: subject.selected.id,
    edges: EDGES.map((e) => edgeExit(context, e)),
    exitGrids: exitGridExits(subject, world),
  });
}

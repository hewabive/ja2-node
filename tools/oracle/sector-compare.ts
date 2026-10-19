import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseJsoncBytes } from '../../src/content/strategic/jsonc.ts';
import { type BloodCatSpawn, parseBloodCatSpawns } from '../../src/content/strategic/map-tables.ts';
import { parseSectorString, type Sector } from '../../src/content/strategic/sector-ids.ts';
import { STRATEGIC_CONTENT_PATHS } from '../../src/content/strategic/strategic-content.ts';
import type { ReadFile } from '../../src/content/world/tileset-loader.ts';
import { createSaveSession, type SaveSession } from '../../src/server/save-session.ts';
import type { FileExists } from '../../src/server/world-cache.ts';
import { flowExitWorld, okForSectorExit } from '../../src/sim/campaign/sector-exits.ts';
import { addSoldierInitListEnemyDefenceSoldiers, sortSoldierInitList } from '../../src/sim/strategic/ai/defence-placement.ts';
import type { RollSource } from '../../src/sim/strategic/forces/ports.ts';
import { anim } from '../../src/sim/tactical/anim-states.ts';
import { initNewSoldierAnim } from '../../src/sim/tactical/animation.ts';
import {
  calcMapEdgepointClassInsertionCode,
  type EdgepointList,
  generateMapEdgepoints,
  loadMapEdgepoints,
  type MapEdgepoints,
} from '../../src/sim/tactical/edgepoints.ts';
import {
  buildSoldierInitList,
  placeBloodcatsFromInitList,
  placeCreaturesFromInitList,
  type SoldierInitNode,
} from '../../src/sim/tactical/init-list.ts';
import { setSoldierPosition } from '../../src/sim/tactical/movement.ts';
import {
  absoluteScreenXY,
  mirrorGridNo,
  pickGridNoNearestEdge,
  pickGridNoToWalkIn,
  soldierOKForSectorExit,
} from '../../src/sim/tactical/sector-exit.ts';
import { createSoldier, NOWHERE, type Soldier, Team } from '../../src/sim/tactical/soldier.ts';
import { registerSoldier, unregisterSoldier } from '../../src/sim/tactical/state.ts';
import type { TacticalSim } from '../../src/sim/tactical/tactical-sim.ts';

type Json = Record<string, unknown>;
type Draw = readonly [string, number, number, number];
type NodeRow = readonly number[];

export const SECTOR_PROBES: ReadonlySet<string> = new Set([
  'edgepoints',
  'walkoff',
  'walkin',
  'mirror',
  'soldierexit',
  'exitcheck',
  'move',
  'initlist',
  'defence',
  'creatureplacement',
  'bloodcatplacement',
]);

const ORACLE_NOWHERE = 25601;
const PROBE_SOLDIER_ID = 0;
const MAIN_STREAM = 'm';
const MARK_STREAM = 'k';
const MARK_PLACEMENT_BEGIN = 1000;
const MARK_PLACEMENT_END = 999;
const UNSET_MINUTES = -1;
const SEED = 1;
const STANCE_STATE: Readonly<Record<string, string>> = { stand: 'STANDING', crouch: 'CROUCHING', prone: 'PRONE' };

const grid = (g: unknown) => (Number(g) === ORACLE_NOWHERE ? NOWHERE : Number(g));
const sameJson = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

function report(label: string, same: boolean, detail: string): number {
  console.log(`${label}: ${same ? 'ok' : 'MISMATCH'} ${detail}`);
  return same ? 0 : 1;
}

class ReplayMismatch extends Error {}

class PlacementDecisionRolls implements RollSource {
  readonly #draws: Draw[] = [];
  #at = 0;

  constructor(trace: readonly Draw[]) {
    let inPlacement = false;
    for (const d of trace) {
      if (d[0] === MARK_STREAM) inPlacement = d[1] >= MARK_PLACEMENT_BEGIN ? true : d[1] === MARK_PLACEMENT_END ? false : inPlacement;
      else if (!inPlacement) this.#draws.push(d);
    }
  }

  get left(): number {
    return this.#draws.length - this.#at;
  }

  int(n: number): number {
    if (n === 0) return 0;
    const d = this.#draws[this.#at];
    if (!d) throw new ReplayMismatch(`decision draw #${this.#at}: native log exhausted, ja2-node wants range ${n}`);
    if (d[0] !== MAIN_STREAM || d[1] !== n)
      throw new ReplayMismatch(`decision draw #${this.#at}: ja2-node wants Random(${n}), native drew ${JSON.stringify(d)}`);
    this.#at++;
    return d[2];
  }

  chance(percent: number): boolean {
    return this.int(100) < percent;
  }
}

function placementOrder(trace: readonly Draw[]): number[] {
  return trace.filter((d) => d[0] === MARK_STREAM && d[1] >= MARK_PLACEMENT_BEGIN).map((d) => d[1] - MARK_PLACEMENT_BEGIN);
}

function nodeRow(n: SoldierInitNode): NodeRow {
  return [n.index, n.team, n.soldierClass, n.priorityExistence ? 1 : 0, n.detailed ? 1 : 0, n.hasSoldier ? 1 : 0];
}

function nativeNodeRow(row: NodeRow): NodeRow {
  return [...row.slice(0, 5), (row[5] ?? -1) >= 0 ? 1 : 0];
}

function sectorOf(p: Json): Sector {
  return parseSectorString(String(p.sector), Number(p.z ?? 0));
}

function edgepointsJson(e: MapEdgepoints): Json {
  const side = (l: EdgepointList | undefined) => ({ middle: l?.middle ?? 0, gridNos: l?.gridNos ?? [] });
  return { primary: e.primary.map(side), secondary: e.secondary.map(side) };
}

function probeSoldier(sim: TacticalSim, info: Json): Soldier {
  const t = sim.state;
  const state = anim(t.content, STANCE_STATE[String(info.stance ?? 'stand')] ?? 'STANDING');
  const s = createSoldier({
    id: PROBE_SOLDIER_ID,
    team: Number(info.team ?? Team.OUR),
    name: 'probe',
    bodyType: Number(info.body ?? 0),
    palettes: { hair: 'BLACKHEAD', skin: 'PINKSKIN', vest: 'BLUEVEST', pants: 'JEANPANTS' },
    stats: {
      agility: 50,
      dexterity: 50,
      strength: 50,
      wisdom: 50,
      leadership: 50,
      marksmanship: 50,
      mechanical: 50,
      explosives: 50,
      medical: 50,
      experience: 1,
    },
    life: 50,
    gridNo: Number(info.gridNo),
    direction: 4,
    state,
  });
  s.level = Number(info.level ?? 0);
  registerSoldier(t, s);
  setSoldierPosition(t, s, s.gridNo);
  initNewSoldierAnim(t, s, state, 0, true);
  return s;
}

function withProbeSoldier<T>(sim: TacticalSim, p: Json, use: (s: Soldier) => T): T {
  const s = probeSoldier(sim, p.soldier as Json);
  try {
    return use(s);
  } finally {
    unregisterSoldier(sim.state, s);
  }
}

export class SectorComparer {
  readonly #read: ReadFile;
  readonly #exists: FileExists;
  #sim: TacticalSim | null = null;
  #sector: Sector | null = null;
  #nodes: SoldierInitNode[] = [];
  #saveBytes: Uint8Array | null = null;
  #save: SaveSession | null = null;
  #bloodcatSpawns: readonly BloodCatSpawn[] | null = null;

  constructor(read: ReadFile, exists: FileExists) {
    this.#read = read;
    this.#exists = exists;
  }

  loadSector(sim: TacticalSim, p: Json): void {
    const sector = sectorOf(p);
    this.#sim = sim;
    this.#sector = sector;
    sim.state.edgepoints = loadMapEdgepoints(sim.state, sector);
    this.#nodes = buildSoldierInitList(sim.world.map);
    this.#saveBytes = null;
    this.#save = null;
  }

  loadSave(savesDir: string, name: string): void {
    this.#saveBytes = new Uint8Array(readFileSync(join(savesDir, `${name}.sav`)));
    this.#save = null;
    this.#sim = null;
  }

  async compare(p: Json): Promise<number> {
    const label = `${p.probe} line ${p.line}`;
    if (p.probe === 'exitcheck') return this.#compareExitCheck(label, p);
    if (p.probe === 'move') return this.#move(label, p);
    const sim = this.#sim;
    const sector = this.#sector;
    if (!sim || !sector) return report(label, false, 'no sector loaded');
    if (p.probe === 'bloodcatplacement' && !this.#bloodcatSpawns) {
      const bytes = await this.#read(STRATEGIC_CONTENT_PATHS.bloodCatSpawns);
      this.#bloodcatSpawns = bytes ? parseBloodCatSpawns(parseJsoncBytes(bytes)) : [];
    }
    try {
      if (p.probe === 'edgepoints') return this.#compareEdgepoints(label, sim, sector, p);
      if (p.probe === 'initlist') return this.#compareInitList(label, p);
      if (p.probe === 'defence') return this.#compareDefence(label, p);
      if (p.probe === 'creatureplacement' || p.probe === 'bloodcatplacement') return this.#compareCreaturePlacement(label, p);
      return withProbeSoldier(sim, p, (s) => this.#compareWithSoldier(label, sim, s, p));
    } catch (e) {
      return report(label, false, e instanceof Error ? e.message : String(e));
    }
  }

  #compareEdgepoints(label: string, sim: TacticalSim, sector: Sector, p: Json): number {
    const t = sim.state;
    if (p.generated) t.edgepoints = generateMapEdgepoints(t, sector);
    const ours = edgepointsJson(t.edgepoints ?? loadMapEdgepoints(t, sector));
    const native = { primary: p.primary, secondary: p.secondary };
    const counts = (e: Json) => (e.primary as Json[]).map((l) => (l.gridNos as unknown[]).length).join(',');
    return report(
      label,
      sameJson(ours, native),
      `${p.generated ? 'generated' : 'loaded'} primary ${counts(native)} secondary ${(native.secondary as Json[]).map((l) => (l.gridNos as unknown[]).length).join(',')}${sameJson(ours, native) ? '' : ` ja2-node primary ${counts(ours)}`}`,
    );
  }

  #compareWithSoldier(label: string, sim: TacticalSim, s: Soldier, p: Json): number {
    const t = sim.state;
    if (p.probe === 'walkoff') {
      const g = pickGridNoNearestEdge(t, s, Number(p.direction));
      return report(label, g === grid(p.gridNo), `from ${s.gridNo} dir ${p.direction}: native ${grid(p.gridNo)} ja2-node ${g}`);
    }
    if (p.probe === 'walkin') {
      const r = pickGridNoToWalkIn(t, s, Number(p.insertionCode));
      const same = r.gridNo === grid(p.gridNo) && r.attempts === Number(p.attempts);
      return report(
        label,
        same,
        `from ${s.gridNo} code ${p.insertionCode}: native ${grid(p.gridNo)}/${p.attempts} ja2-node ${r.gridNo}/${r.attempts}`,
      );
    }
    if (p.probe === 'mirror') {
      const direction = Number(p.direction);
      const g = mirrorGridNo(t, s, direction);
      const code = calcMapEdgepointClassInsertionCode(t, s.gridNo, direction);
      const same = g === grid(p.gridNo) && code === Number(p.classCode);
      return report(
        label,
        same,
        `from ${s.gridNo} dir ${direction}: native ${grid(p.gridNo)} class ${p.classCode} ja2-node ${g} class ${code}`,
      );
    }
    const { x, y } = absoluteScreenXY(t, s.gridNo);
    const ok = soldierOKForSectorExit(t, s, Number(p.exitDirection), Number(p.exitGrid));
    const same = ok === p.ok && x === Number(p.screenX) && y === Number(p.screenY);
    return report(
      label,
      same,
      `from ${s.gridNo} exit ${p.exitDirection}/${p.exitGrid}: native ${p.ok} (${p.screenX},${p.screenY}) ja2-node ${ok} (${x},${y})`,
    );
  }

  #compareInitList(label: string, p: Json): number {
    const before = this.#nodes.map(nodeRow);
    const nativeBefore = (p.before as NodeRow[]).map(nativeNodeRow);
    this.#nodes = sortSoldierInitList(this.#nodes);
    const sorted = this.#nodes.map(nodeRow);
    const nativeSorted = (p.sorted as NodeRow[]).map(nativeNodeRow);
    const same = sameJson(before, nativeBefore) && sameJson(sorted, nativeSorted);
    return report(
      label,
      same,
      `${sorted.length} nodes, order ${nativeSorted.map((r) => r[0]).join(' ')}${same ? '' : ` ja2-node ${sorted.map((r) => r[0]).join(' ')}`}`,
    );
  }

  #compareDefence(label: string, p: Json): number {
    const before = this.#nodes.map(nodeRow);
    if (!sameJson(before, (p.before as NodeRow[]).map(nativeNodeRow))) return report(label, false, 'init list differs before the call');
    const trace = p.draws as Draw[];
    const nativeNodes = p.nodes as NodeRow[];
    const nativePlaced = new Set(nativeNodes.filter((r) => (r[5] ?? -1) >= 0).map((r) => r[0]));
    const rolls = new PlacementDecisionRolls(trace);
    const offered: number[] = [];
    const list = sortSoldierInitList(this.#nodes);
    const totals = { admins: Number(p.admins), troops: Number(p.troops), elites: Number(p.elites) };
    try {
      addSoldierInitListEnemyDefenceSoldiers(list, totals, rolls, (n) => {
        offered.push(n.index);
        return nativePlaced.has(n.index);
      });
    } catch (e) {
      if (e instanceof ReplayMismatch) return report(label, false, e.message);
      throw e;
    }
    this.#nodes = list;
    const order = placementOrder(trace);
    const after = list.map(nodeRow);
    const nativeAfter = nativeNodes.map(nativeNodeRow);
    const classesMatch = nativeNodes.every((r) => (r[6] ?? -1) < 0 || r[6] === r[2]);
    const same = sameJson(offered, order) && sameJson(after, nativeAfter) && rolls.left === 0 && classesMatch;
    const detail = `${totals.admins}/${totals.troops}/${totals.elites}: placed ${order.length} (${order.join(' ')})`;
    if (same) return report(label, true, detail);
    return report(
      label,
      false,
      `${detail}; ja2-node offered ${offered.join(' ')}, draws left ${rolls.left}, nodes ${sameJson(after, nativeAfter) ? 'same' : 'differ'}`,
    );
  }

  #compareCreaturePlacement(label: string, p: Json): number {
    const row = (n: SoldierInitNode) => [
      n.index,
      n.team,
      n.soldierClass,
      n.priorityExistence ? 1 : 0,
      n.detailed ? 1 : 0,
      n.hasSoldier ? 1 : 0,
      n.basic.bodyType,
    ];
    const native = (r: NodeRow) => [...r.slice(0, 5), (r[5] ?? -1) >= 0 ? 1 : 0, r[6] ?? -1];
    if (!sameJson(this.#nodes.map(row), (p.before as NodeRow[]).map(native)))
      return report(label, false, 'init list differs before the call');
    const trace = p.draws as Draw[];
    const nativeNodes = p.nodes as NodeRow[];
    const nativePlaced = new Set(nativeNodes.filter((r) => (r[5] ?? -1) >= 0).map((r) => r[0]));
    const rolls = new PlacementDecisionRolls(trace);
    const offered: number[] = [];
    const place = (n: SoldierInitNode) => {
      offered.push(n.index);
      if (!nativePlaced.has(n.index)) return false;
      n.hasSoldier = true;
      return true;
    };
    let sectorOut: unknown = null;
    try {
      if (p.probe === 'creatureplacement') {
        const [larvae = 0, infants = 0, youngMales = 0, youngFemales = 0, adultMales = 0, adultFemales = 0] = (p.counts as number[]).map(
          Number,
        );
        this.#nodes = sortSoldierInitList(this.#nodes);
        const counts = { larvae, infants, youngMales, youngFemales, adultMales, adultFemales };
        placeCreaturesFromInitList(this.#nodes, p.queen === true, counts, rolls, place);
      } else {
        const [cats = 0, placements = 0] = (p.in as number[]).map(Number);
        const sector = { bloodCats: cats, bloodCatPlacements: placements };
        const spawns = (this.#bloodcatSpawns ?? []).some((b) => b.sector === Number(p.sector));
        this.#nodes = [...placeBloodcatsFromInitList(this.#nodes, sector, spawns, rolls, place)];
        sectorOut = [sector.bloodCats, sector.bloodCatPlacements];
      }
    } catch (e) {
      if (e instanceof ReplayMismatch) return report(label, false, e.message);
      throw e;
    }
    const order = placementOrder(trace);
    const after = this.#nodes.map(row);
    const nativeAfter = nativeNodes.map(native);
    const sectorSame = p.probe !== 'bloodcatplacement' || sameJson(sectorOut, p.out);
    const same = sameJson(offered, order) && sameJson(after, nativeAfter) && rolls.left === 0 && sectorSame;
    const detail = `placed ${order.length} (${order.join(' ')})`;
    if (same) return report(label, true, detail);
    return report(
      label,
      false,
      `${detail}; ja2-node offered ${offered.join(' ')}, draws left ${rolls.left}, nodes ${sameJson(after, nativeAfter) ? 'same' : 'differ'}, sector ${JSON.stringify(sectorOut)} vs ${JSON.stringify(p.out)}`,
    );
  }

  async #session(): Promise<SaveSession | null> {
    if (this.#save) return this.#save;
    if (!this.#saveBytes) return null;
    this.#save = await createSaveSession(this.#read, this.#saveBytes, SEED, this.#exists);
    return this.#save;
  }

  async #move(label: string, p: Json): Promise<number> {
    const session = await this.#session();
    const t = session?.session.campaign.tactical?.state;
    const s = t?.soldiers[Number(p.who)];
    if (!t || !s) return report(label, false, 'no save soldier to move');
    setSoldierPosition(t, s, Number(p.gridNo));
    return report(label, s.gridNo === Number(p.gridNo), `soldier ${p.who} to ${p.gridNo}`);
  }

  async #compareExitCheck(label: string, p: Json): Promise<number> {
    const session = await this.#session();
    const flow = session?.session.campaign.sectors;
    const roster = session?.session.roster;
    const t = session?.session.campaign.tactical?.state;
    const selected = roster?.get(Number(p.who));
    if (!flow || !roster || !t || !selected) return report(label, false, 'no save session with a sector flow');
    const direction = Number(p.exitDirection);
    const exitGrid = Number(p.exitGrid);
    const check = okForSectorExit(flowExitWorld(flow), direction, exitGrid, selected);
    const soldiers = roster
      .all()
      .filter((m) => m.soldier.placed && t.soldiers[m.id] === m.soldier)
      .sort((a, b) => a.id - b.id)
      .map((m) => [m.id, m.assignment, soldierOKForSectorExit(t, m.soldier, direction, exitGrid) ? 1 : 0]);
    const minutesSame = Number(p.minutes) === UNSET_MINUTES || check.minutes === Number(p.minutes);
    const same =
      check.result === Number(p.result) &&
      minutesSame &&
      check.invalidTraversal === p.invalidTraversal &&
      check.loneEpc === p.loneEpc &&
      check.abandonedEpcs === Number(p.abandonedEpcs) &&
      sameJson(soldiers, p.soldiers);
    const native = `${p.result}/${p.minutes} min`;
    return report(
      label,
      same,
      `who ${p.who} exit ${direction}/${exitGrid}: native ${native} ja2-node ${check.result}/${check.minutes} min${sameJson(soldiers, p.soldiers) ? '' : ` soldiers ${JSON.stringify(soldiers)} vs ${JSON.stringify(p.soldiers)}`}`,
    );
  }
}

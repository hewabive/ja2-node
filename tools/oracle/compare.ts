import { readFileSync } from 'node:fs';
import { loadTacticalWorld } from '../../src/content/world/tactical-world.ts';
import { openDataVfs } from '../../src/node/data-vfs.ts';
import { DEFAULT_STUBS_DIR, PROJECT_DATA_DIR } from '../../src/node/repo.ts';
import { plotPathCost } from '../../src/sim/tactical/ai/utils.ts';
import { anim } from '../../src/sim/tactical/anim-states.ts';
import { initNewSoldierAnim } from '../../src/sim/tactical/animation.ts';
import { soldierToSoldierLos } from '../../src/sim/tactical/combat/positions.ts';
import { loadTacticalContent } from '../../src/sim/tactical/load-content.ts';
import { setSoldierPosition } from '../../src/sim/tactical/movement.ts';
import { findBestPath, type MoveMode } from '../../src/sim/tactical/pathfinding.ts';
import { landHeightUnits, lineOfSightTest } from '../../src/sim/tactical/perception/los.ts';
import { createSoldier, type Soldier, Team } from '../../src/sim/tactical/soldier.ts';
import { registerSoldier, unregisterSoldier } from '../../src/sim/tactical/state.ts';
import { TacticalSim } from '../../src/sim/tactical/tactical-sim.ts';

type Json = Record<string, unknown>;

const MAP = 'maps/a9.dat';
const HEIGHT_UNITS = 256;
const STANCE_STATE: Readonly<Record<string, string>> = { stand: 'STANDING', crouch: 'CROUCHING', prone: 'PRONE' };
const STANCE_Z: Readonly<Record<string, number>> = { stand: 175, crouch: 111, prone: 31 };
const TREE_REDUCTION: Readonly<Record<string, number>> = { stand: 6, crouch: 7, prone: 8 };
const MODE: Readonly<Record<string, MoveMode>> = { walk: 'WALKING', run: 'RUNNING', swat: 'SWATTING', crawl: 'CRAWLING' };
const TEAM: Readonly<Record<string, number>> = {
  enemy: Team.ENEMY,
  player: Team.OUR,
  militia: Team.MILITIA,
  civ: Team.CIV,
  creature: Team.CREATURE,
};

function readLines(path: string): Json[] {
  return readFileSync(path, 'utf8')
    .split('\n')
    .filter((l) => l.trim())
    .map((l) => JSON.parse(l) as Json);
}

function fnv1a32(bytes: Uint8Array): number {
  let h = 0x811c9dc5;
  for (const b of bytes) h = Math.imul(h ^ b, 0x01000193) >>> 0;
  return h;
}

function probeSoldier(sim: TacticalSim, id: number, team: number, info: Json): Soldier {
  const t = sim.state;
  const stance = String(info.stance ?? 'stand');
  const state = anim(t.content, STANCE_STATE[stance] ?? 'STANDING');
  const s = createSoldier({
    id,
    team,
    name: `probe${id}`,
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

function comparePaths(sim: TacticalSim, lines: Json[]): number {
  const t = sim.state;
  let failures = 0;
  for (const p of lines.filter((l) => l.probe === 'path')) {
    const soldier = p.soldier as Json;
    const s = probeSoldier(sim, Number(soldier.id), Number(soldier.team), soldier);
    const mode = MODE[String(p.mode)] ?? 'WALKING';
    const route = findBestPath(t.pathEnv, s, Number(p.to), Number(p.toLevel ?? 0), { mode, flags: Number(p.flags ?? 0) });
    const apCost = route.length === 0 ? 0 : plotPathCost(t, s, Number(p.to), anim(t.content, mode));
    const expected = (p.directions as number[] | undefined) ?? [];
    const same = route.length === Number(p.length) && route.steps.every((d, i) => d === expected[i]) && apCost === Number(p.apCost);
    if (!same) failures++;
    console.log(
      `path line ${p.line} ${p.from}→${p.to} ${p.mode}: ${same ? 'ok' : 'MISMATCH'} length ${route.length}/${p.length} ap ${apCost}/${p.apCost}`,
    );
    unregisterSoldier(t, s);
  }
  return failures;
}

function compareLos(sim: TacticalSim, lines: Json[]): number {
  const t = sim.state;
  const world = { structures: t.world.structures, heights: t.world.level.heights };
  let failures = 0;
  for (const p of lines.filter((l) => l.probe === 'los')) {
    const from = Number(p.from);
    const to = Number(p.to);
    const fromZ = (STANCE_Z[String(p.stance)] ?? 175) + Number(p.level ?? 0) * HEIGHT_UNITS + landHeightUnits(world, from);
    const toZ = (STANCE_Z[String(p.toStance)] ?? 175) + Number(p.toLevel ?? 0) * HEIGHT_UNITS + landHeightUnits(world, to);
    const treeReduction = TREE_REDUCTION[String(p.toStance)] ?? 6;
    const options = {
      tileLimit: Number(p.tileLimit ?? 255),
      treeReduction,
      aware: Number(p.aware ?? 1) !== 0,
      camo: 0,
      disallowSight: false,
    };
    const los = lineOfSightTest(world, from, fromZ, to, toZ, options);
    let s2s: number | null = null;
    if (p.viewer && p.target) {
      const viewer = probeSoldier(sim, Number((p.viewer as Json).id), TEAM.enemy ?? Team.ENEMY, p.viewer as Json);
      const target = probeSoldier(sim, Number((p.target as Json).id), TEAM.player ?? Team.OUR, p.target as Json);
      s2s = soldierToSoldierLos(t, viewer, target, Number(p.tileLimit ?? 255), Number(p.aware ?? 1) !== 0);
      unregisterSoldier(t, target);
      unregisterSoldier(t, viewer);
    }
    const same = los === Number(p.lineOfSight) && (s2s === null || s2s === Number(p.soldierToSoldier));
    if (!same) failures++;
    console.log(
      `los line ${p.line} ${from}→${to} ${p.stance}/${p.toStance}: ${same ? 'ok' : 'MISMATCH'} los ${los}/${p.lineOfSight} s2s ${s2s}/${p.soldierToSoldier}`,
    );
  }
  return failures;
}

function compareCosts(sim: TacticalSim, lines: Json[]): number {
  const probe = lines.find((l) => l.probe === 'costs');
  if (!probe) return 0;
  const ours = sim.state.world.costs.values;
  const hash = fnv1a32(ours).toString(16);
  let differing = 0;
  if (typeof probe.base64 === 'string') {
    const theirs = new Uint8Array(Buffer.from(probe.base64, 'base64'));
    for (let k = 0; k < theirs.length; k++) if (theirs[k] !== ours[k]) differing++;
  }
  console.log(`costs: fnv1a32 ${hash}/${probe.fnv1a32}, ${differing} differing entries`);
  return hash === probe.fnv1a32 && differing === 0 ? 0 : 1;
}

const files = process.argv.slice(2);
if (files.length === 0) {
  console.error('usage: node tools/oracle/compare.ts <probe output .jsonl>...');
  process.exit(2);
}
const data = await openDataVfs({
  projectDataDir: PROJECT_DATA_DIR,
  dataDir: process.env.JA2_DATA_DIR || undefined,
  stubsDir: DEFAULT_STUBS_DIR,
});
if (data.dataDir === null) {
  console.error('JA2_DATA_DIR is required');
  process.exit(2);
}
const read = async (p: string) => (data.vfs.stat(p) ? data.vfs.read(p) : null);
const [world, content] = await Promise.all([loadTacticalWorld(read, MAP), loadTacticalContent(read)]);
let failures = 0;
for (const file of files) {
  const lines = readLines(file);
  const sim = new TacticalSim(world, content, 1);
  failures += compareCosts(sim, lines) + comparePaths(sim, lines) + compareLos(sim, lines);
}
await data.close();
console.log(failures === 0 ? 'all probes match' : `${failures} mismatching probes`);
process.exit(failures === 0 ? 0 : 1);

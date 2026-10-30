import { readFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { withGraphicFacts } from '../../src/content/rules/graphic-facts.ts';
import { vfsFileReader } from '../../src/content/vfs/vfs.ts';
import { WORLD_MAX } from '../../src/content/world/grid.ts';
import { structureHeight } from '../../src/content/world/structures.ts';
import { loadTacticalWorld, type TacticalWorld } from '../../src/content/world/tactical-world.ts';
import { openDataVfs } from '../../src/node/data-vfs.ts';
import { DEFAULT_STUBS_DIR, PROJECT_DATA_DIR } from '../../src/node/repo.ts';
import type { FileExists } from '../../src/server/world-cache.ts';
import { calcBestShot } from '../../src/sim/tactical/ai/attack-choice.ts';
import { plotPathCost } from '../../src/sim/tactical/ai/utils.ts';
import { anim } from '../../src/sim/tactical/anim-states.ts';
import { AnimHeight, endHeight, initNewSoldierAnim } from '../../src/sim/tactical/animation.ts';
import { calcTotalAPsToAttack } from '../../src/sim/tactical/combat/ap.ts';
import { soldierToLocationChanceToGetThrough, soldierToSoldierBodyPartChanceToGetThrough } from '../../src/sim/tactical/combat/bullets.ts';
import { calcChanceToHitGun } from '../../src/sim/tactical/combat/chance.ts';
import { soldierToSoldierLos } from '../../src/sim/tactical/combat/positions.ts';
import { AimShot, WeaponMode } from '../../src/sim/tactical/combat/types.ts';
import type { TacticalContent } from '../../src/sim/tactical/content.ts';
import { InvSlot, itemIn } from '../../src/sim/tactical/inventory.ts';
import { LightSpriteFlags, lightSetBaseLevel, lightTrueLevel, loadMapLights } from '../../src/sim/tactical/lighting/lighting.ts';
import { loadTacticalContent } from '../../src/sim/tactical/load-content.ts';
import { setSoldierPosition } from '../../src/sim/tactical/movement.ts';
import { findBestPath, type MoveMode } from '../../src/sim/tactical/pathfinding.ts';
import { landHeightUnits, lineOfSightTest } from '../../src/sim/tactical/perception/los.ts';
import { distanceVisible } from '../../src/sim/tactical/perception/sight.ts';
import { calcActionPoints } from '../../src/sim/tactical/points.ts';
import {
  effectiveAgility,
  effectiveDexterity,
  effectiveExpLevel,
  effectiveMarksmanship,
  effectiveWisdom,
} from '../../src/sim/tactical/skills.ts';
import { createSoldier, NOWHERE, type Soldier, Team } from '../../src/sim/tactical/soldier.ts';
import { registerSoldier, unregisterSoldier, whoIsThere } from '../../src/sim/tactical/state.ts';
import { TacticalSim } from '../../src/sim/tactical/tactical-sim.ts';
import { ACTION_PROBES, ActionComparer } from './actions-compare.ts';
import { ATTACH_PROBES, AttachComparer } from './attach-compare.ts';
import { compareAutoresolveAftermath, compareEnemyCounts } from './autoresolve-aftermath.ts';
import { compareAutoresolve } from './autoresolve-compare.ts';
import { compareAutoresolveCreation } from './autoresolve-creation.ts';
import { BOXING_PROBES, BoxingComparer } from './boxing-compare.ts';
import { CIV_PROBES, CivComparer } from './civ-compare.ts';
import { CONTRACT_PROBES, ContractComparer } from './contract-compare.ts';
import { CREATURE_AI_PROBES, CreatureAiComparer } from './creature-ai-compare.ts';
import { CREATURE_PROBES, CreatureComparer } from './creature-compare.ts';
import { DOOR_PROBES, DoorComparer } from './doors-compare.ts';
import { ECONOMY_PROBES, EconomyComparer } from './economy-compare.ts';
import { FACT_PROBES, FactComparer } from './facts-compare.ts';
import { GIVE_PROBES, GiveComparer } from './give-compare.ts';
import { HELI_PROBES, HeliComparer } from './heli-compare.ts';
import { LAPTOP_PROBES, LaptopComparer } from './laptop-compare.ts';
import { MEANWHILE_PROBES, MeanwhileComparer } from './meanwhile-compare.ts';
import { MERCHANT_PROBES, MerchantComparer } from './merchant-compare.ts';
import { MORALE_PROBES, MoraleComparer } from './morale-compare.ts';
import { comparePreBattle } from './pre-battle-compare.ts';
import { RECRUIT_PROBES, RecruitComparer } from './recruit-compare.ts';
import { SAI_PROBES, SaiComparer } from './sai-compare.ts';
import { SCHEDULE_PROBES, ScheduleComparer } from './schedules-compare.ts';
import { SECTOR_PROBES, SectorComparer } from './sector-compare.ts';
import { STRATEGIC_PROBES, StrategicComparer } from './strategic-compare.ts';
import { createTacticalSaveSession } from './tactical-import.ts';
import { TALK_PROBES, TalkComparer } from './talk-compare.ts';

type Json = Record<string, unknown>;
type ReadFile = (path: string) => Promise<Uint8Array | null>;

interface Context {
  readonly sim: TacticalSim;
  readonly save: boolean;
  readonly bytes?: Uint8Array;
}

const DEFAULT_MAP = 'maps/a9.dat';
const ORACLE_NOWHERE = 25601;
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
const AIM_RANDOM = 0;
const OPPLIST_ENTRIES = 148;
const IRRELEVANT_DIRECTION = -1;
const MAX_REPORTED_TILES = 12;
const SPRITE_STATE_FLAGS = LightSpriteFlags.ON | LightSpriteFlags.PRIMETIME | LightSpriteFlags.NIGHTTIME;

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

const grid = (g: unknown) => (Number(g) === ORACLE_NOWHERE ? NOWHERE : Number(g));

function report(label: string, same: boolean, detail: string): number {
  console.log(`${label}: ${same ? 'ok' : 'MISMATCH'} ${detail}`);
  return same ? 0 : 1;
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

function existing(ctx: Context, info: Json): Soldier | null {
  return ctx.sim.state.soldiers[Number(info.id)] ?? null;
}

function withSoldier<T>(ctx: Context, info: Json, team: number, use: (s: Soldier) => T): T {
  const found = ctx.save ? existing(ctx, info) : null;
  if (found) return use(found);
  const s = probeSoldier(ctx.sim, Number(info.id), team, info);
  try {
    return use(s);
  } finally {
    unregisterSoldier(ctx.sim.state, s);
  }
}

function comparePath(ctx: Context, p: Json): number {
  const t = ctx.sim.state;
  const soldier = p.soldier as Json;
  return withSoldier(ctx, soldier, Number(soldier.team), (s) => {
    const mode = MODE[String(p.mode)] ?? 'WALKING';
    const route = findBestPath(t.pathEnv, s, Number(p.to), Number(p.toLevel ?? 0), { mode, flags: Number(p.flags ?? 0) });
    const apCost = route.length === 0 ? 0 : plotPathCost(t, s, Number(p.to), anim(t.content, mode));
    const expected = (p.directions as number[] | undefined) ?? [];
    const same = route.length === Number(p.length) && route.steps.every((d, i) => d === expected[i]) && apCost === Number(p.apCost);
    return report(`path line ${p.line} ${p.from}→${p.to} ${p.mode}`, same, `length ${route.length}/${p.length} ap ${apCost}/${p.apCost}`);
  });
}

function compareLos(ctx: Context, p: Json): number {
  const t = ctx.sim.state;
  const world = { structures: t.world.structures, heights: t.world.level.heights };
  let los: number | null = null;
  if (p.lineOfSight !== undefined) {
    const from = Number(p.from);
    const to = Number(p.to);
    const fromZ = (STANCE_Z[String(p.stance)] ?? 175) + Number(p.level ?? 0) * HEIGHT_UNITS + landHeightUnits(world, from);
    const toZ = (STANCE_Z[String(p.toStance)] ?? 175) + Number(p.toLevel ?? 0) * HEIGHT_UNITS + landHeightUnits(world, to);
    los = lineOfSightTest(world, from, fromZ, to, toZ, {
      tileLimit: Number(p.tileLimit ?? 255),
      treeReduction: TREE_REDUCTION[String(p.toStance)] ?? 6,
      aware: Number(p.aware ?? 1) !== 0,
      camo: 0,
      disallowSight: false,
    });
  }
  let s2s: number | null = null;
  if (p.viewer && p.target) {
    s2s = withSoldier(ctx, p.viewer as Json, TEAM.enemy ?? Team.ENEMY, (viewer) =>
      withSoldier(ctx, p.target as Json, TEAM.player ?? Team.OUR, (target) =>
        soldierToSoldierLos(t, viewer, target, Number(p.tileLimit ?? 255), Number(p.aware ?? 1) !== 0),
      ),
    );
  }
  const same = (los === null || los === Number(p.lineOfSight)) && (s2s === null || s2s === Number(p.soldierToSoldier));
  return report(
    `los line ${p.line} ${p.from ?? (p.viewer as Json)?.id}→${p.to ?? (p.target as Json)?.id}`,
    same,
    `los ${los}/${p.lineOfSight} s2s ${s2s}/${p.soldierToSoldier}`,
  );
}

function compareCosts(ctx: Context, probe: Json): number {
  const ours = ctx.sim.state.world.costs.values;
  const hash = fnv1a32(ours).toString(16);
  let differing = 0;
  if (typeof probe.base64 === 'string') {
    const theirs = new Uint8Array(Buffer.from(probe.base64, 'base64'));
    for (let k = 0; k < theirs.length; k++) if (theirs[k] !== ours[k]) differing++;
  }
  return report('costs', hash === probe.fnv1a32 && differing === 0, `fnv1a32 ${hash}/${probe.fnv1a32}, ${differing} differing entries`);
}

function soldierFacts(s: Soldier): Json {
  return {
    gridNo: s.gridNo,
    level: s.level,
    x: s.x,
    y: s.y,
    direction: s.direction,
    desiredDirection: s.desiredDirection,
    animState: s.state,
    life: s.life,
    lifeMax: s.lifeMax,
    breath: s.breath,
    breathMax: s.breathMax,
    breathRed: s.breathRed,
    bleeding: s.bleeding,
    ap: s.actionPoints,
    initialAp: s.initialActionPoints,
    apPerTurn: calcActionPoints(s),
    morale: s.morale,
    aiMorale: s.ai.morale,
    alert: s.ai.alertStatus,
    orders: s.ai.orders,
    attitude: s.ai.attitude,
    visible: s.visible,
    lastTarget: s.lastTarget,
    effective: {
      marksmanship: effectiveMarksmanship(s),
      dexterity: effectiveDexterity(s),
      agility: effectiveAgility(s),
      wisdom: effectiveWisdom(s),
      expLevel: effectiveExpLevel(s),
    },
    personality: s.personalityTrait,
    oppList: Array.from(s.oppList.subarray(0, OPPLIST_ENTRIES)),
    inventory: s.inv.flatMap((o, slot) => (o.item ? [{ slot, item: o.item, count: o.count, status: o.status[0] ?? 0 }] : [])),
  };
}

function oracleFacts(o: Json): Json {
  const inventory = (o.inventory as Json[]).map((i) => ({ slot: i.slot, item: i.item, count: i.count, status: i.status }));
  return {
    gridNo: o.gridNo,
    level: o.level,
    x: o.x,
    y: o.y,
    direction: o.direction,
    desiredDirection: o.desiredDirection,
    animState: o.animState,
    life: o.life,
    lifeMax: o.lifeMax,
    breath: o.breath,
    breathMax: o.breathMax,
    breathRed: o.breathRed,
    bleeding: o.bleeding,
    ap: o.ap,
    initialAp: o.initialAp,
    apPerTurn: o.apPerTurn,
    morale: o.morale,
    aiMorale: o.aiMorale,
    alert: o.alert,
    orders: o.orders,
    attitude: o.attitude,
    visible: o.visible,
    lastTarget: grid(o.lastTarget),
    effective: o.effective,
    personality: o.personality,
    oppList: (o.oppList as number[]).slice(0, OPPLIST_ENTRIES),
    inventory,
  };
}

function compareSoldier(ctx: Context, o: Json, line: unknown): number {
  const s = ctx.sim.state.soldiers[Number(o.id)];
  if (!s?.placed) return report(`soldier ${o.id} line ${line}`, false, 'missing in ja2-node');
  const ours = soldierFacts(s);
  const theirs = oracleFacts(o);
  const differing = Object.keys(theirs).filter((k) => JSON.stringify(ours[k]) !== JSON.stringify(theirs[k]));
  const detail = differing.map((k) => `${k} ${JSON.stringify(ours[k])}/${JSON.stringify(theirs[k])}`).join('; ');
  return report(`soldier ${o.id} line ${line}`, differing.length === 0, detail);
}

function compareSoldiers(ctx: Context, p: Json): number {
  if (p.probe === 'soldier') return compareSoldier(ctx, p.soldier as Json, p.line);
  if (!p.detail) return 0;
  return (p.soldiers as Json[]).reduce((n, o) => n + compareSoldier(ctx, o, p.line), 0);
}

const LOCATION_PART: Readonly<Record<string, number>> = {
  torso: AimShot.TORSO,
  head: AimShot.HEAD,
  legs: AimShot.LEGS,
  random: AimShot.RANDOM,
};

interface Estimate {
  readonly chance: number;
  readonly apCost: number;
  readonly chanceToGetThrough: number;
}

function estimateShot(ctx: Context, s: Soldier, target: number, level: number, aim: number, part: number): Estimate {
  const t = ctx.sim.state;
  const saved = { ...s, inv: s.inv };
  const victim = whoIsThere(t, target, level);
  s.aimTime = aim;
  s.aimShotLocation = victim && endHeight(t.content, victim.state) !== AnimHeight.PRONE ? part : AimShot.RANDOM;
  s.weaponMode = WeaponMode.NORMAL;
  s.doBurst = 0;
  s.attackingHand = InvSlot.HAND;
  s.attackingWeapon = itemIn(s.inv, InvSlot.HAND);
  s.targetLevel = level;
  s.targetCubeLevel = 0;
  const apCost = calcTotalAPsToAttack(t, s, victim ? victim.gridNo : target, true, aim);
  const chance = calcChanceToHitGun(t, s, target, aim, s.aimShotLocation, false);
  const chanceToGetThrough = victim
    ? soldierToSoldierBodyPartChanceToGetThrough(t, s, victim, s.aimShotLocation)
    : soldierToLocationChanceToGetThrough(t, s, target, level, 0, null);
  Object.assign(s, {
    aimTime: saved.aimTime,
    aimShotLocation: saved.aimShotLocation,
    weaponMode: saved.weaponMode,
    doBurst: saved.doBurst,
    attackingHand: saved.attackingHand,
    attackingWeapon: saved.attackingWeapon,
    targetLevel: saved.targetLevel,
    targetCubeLevel: saved.targetCubeLevel,
    ctgtTarget: saved.ctgtTarget,
  });
  return { chance, apCost, chanceToGetThrough };
}

function compareCth(ctx: Context, p: Json): number {
  const s = ctx.sim.state.soldiers[Number(p.shooter)];
  if (!s) return report(`cth line ${p.line} ${p.shooter}`, false, 'missing in ja2-node');
  let failures = 0;
  for (const r of p.results as Json[]) {
    const e = estimateShot(
      ctx,
      s,
      Number(p.targetGridNo),
      Number(p.targetLevel ?? 0),
      Number(r.aim),
      LOCATION_PART[String(p.location)] ?? AimShot.TORSO,
    );
    const same = e.chance === r.chance && e.apCost === r.apCost && e.chanceToGetThrough === p.chanceToGetThrough;
    failures += report(
      `cth line ${p.line} ${p.shooter}→${p.target ?? p.targetGridNo} ${p.location} aim ${r.aim}`,
      same,
      `chance ${e.chance}/${r.chance} ap ${e.apCost}/${r.apCost} ctgt ${e.chanceToGetThrough}/${p.chanceToGetThrough}`,
    );
  }
  return failures;
}

function compareBestShot(ctx: Context, p: Json): number {
  const t = ctx.sim.state;
  const s = t.soldiers[Number(p.who)];
  if (!s) return report(`bestshot line ${p.line} ${p.who}`, false, 'missing in ja2-node');
  const others = t.soldiers.filter((x): x is Soldier => x !== undefined);
  const saved = {
    aimShotLocation: s.aimShotLocation,
    attackingWeapon: s.attackingWeapon,
    dontChargeReadyAPs: s.dontChargeReadyAPs,
    targets: others.map((x) => x.ctgtTarget),
  };
  if (!p.keepAim) s.aimShotLocation = AIM_RANDOM;
  const best = calcBestShot(t, s);
  Object.assign(s, {
    aimShotLocation: saved.aimShotLocation,
    attackingWeapon: saved.attackingWeapon,
    dontChargeReadyAPs: saved.dontChargeReadyAPs,
  });
  others.forEach((x, k) => {
    x.ctgtTarget = saved.targets[k] ?? null;
  });
  const ours = {
    possible: best.possible,
    opponent: best.opponent?.id ?? null,
    target: best.possible ? best.target : NOWHERE,
    aimTime: best.aimTime,
    chanceToReallyHit: best.chanceToReallyHit,
    apCost: best.apCost,
    attackValue: best.attackValue,
  };
  const theirs = {
    possible: p.possible,
    opponent: p.opponent,
    target: p.possible ? grid(p.target) : NOWHERE,
    aimTime: p.aimTime,
    chanceToReallyHit: p.chanceToReallyHit,
    apCost: p.apCost,
    attackValue: p.attackValue,
  };
  const differing = (Object.keys(theirs) as (keyof typeof theirs)[]).filter((k) => ours[k] !== theirs[k]);
  return report(
    `bestshot line ${p.line} ${p.who}`,
    differing.length === 0,
    JSON.stringify(ours) + (differing.length ? ` vs ${JSON.stringify(theirs)}` : ''),
  );
}

function compareLight(ctx: Context, p: Json): number {
  const t = ctx.sim.state;
  const viewer = p.viewer === undefined ? null : t.soldiers[Number(p.viewer)];
  const ours = {
    ambient: t.lighting.ambient,
    trueLevel: lightTrueLevel(t, Number(p.g), Number(p.level ?? 0)),
    distanceVisible: viewer
      ? distanceVisible(t, viewer, IRRELEVANT_DIRECTION, IRRELEVANT_DIRECTION, Number(p.g), Number(p.level ?? 0))
      : undefined,
  };
  const same = ours.ambient === p.ambient && ours.trueLevel === p.trueLevel && ours.distanceVisible === p.distanceVisible;
  return report(
    `light line ${p.line} ${p.g}`,
    same,
    `${JSON.stringify(ours)} vs ambient ${p.ambient} trueLevel ${p.trueLevel} distanceVisible ${p.distanceVisible}`,
  );
}

function trueLevels(ctx: Context, level: number): Uint8Array {
  const levels = new Uint8Array(WORLD_MAX);
  for (let g = 0; g < WORLD_MAX; g++) levels[g] = lightTrueLevel(ctx.sim.state, g, level);
  return levels;
}

function compareLights(ctx: Context, p: Json): number {
  const level = Number(p.level ?? 0);
  const ours = trueLevels(ctx, level);
  const hash = fnv1a32(ours).toString(16).padStart(8, '0');
  const differing: string[] = [];
  let count = 0;
  if (typeof p.base64 === 'string') {
    const theirs = new Uint8Array(Buffer.from(p.base64, 'base64'));
    for (let g = 0; g < theirs.length; g++) {
      if (theirs[g] === ours[g]) continue;
      count++;
      if (differing.length < MAX_REPORTED_TILES) differing.push(`${g}:${ours[g]}/${theirs[g]}`);
    }
  }
  const lit = ours.reduce((n, v) => n + (v !== ctx.sim.state.lighting.natural ? 1 : 0), 0);
  const sprites = spriteList(
    ctx.sim.state.lighting.sprites.flatMap((l) => (l && l.flags & LightSpriteFlags.ACTIVE ? [{ ...l, template: l.template.name }] : [])),
  );
  const theirSprites = spriteList(
    ((p.sprites as Json[] | undefined) ?? [])
      .filter((l) => !(Number(l.flags) & LightSpriteFlags.MERC_LIGHT))
      .map((l) => ({ x: l.x, y: l.y, flags: l.flags, template: String(l.template) })),
  );
  return report(
    `lights line ${p.line} level ${level}`,
    hash === p.fnv1a32 && count === 0 && ctx.sim.state.lighting.ambient === p.ambient && sprites === theirSprites,
    `fnv1a32 ${hash}/${p.fnv1a32}, ambient ${ctx.sim.state.lighting.ambient}/${p.ambient}, ${lit} tiles off the natural level, ` +
      `${count} differing tiles${differing.length ? ` (g:ours/theirs ${differing.join(' ')})` : ''}` +
      (sprites === theirSprites ? '' : `, sprites ${sprites} vs ${theirSprites}`),
  );
}

function spriteList(
  sprites: readonly { readonly x: unknown; readonly y: unknown; readonly flags: unknown; readonly template: string }[],
): string {
  return sprites
    .map((l) => `${l.x},${l.y},${Number(l.flags) & SPRITE_STATE_FLAGS},${l.template.toUpperCase()}`)
    .sort()
    .join(' ');
}

function savesDir(dataDir: string): string {
  if (process.env.JA2_SAVES_DIR) return process.env.JA2_SAVES_DIR;
  const root = basename(dataDir).toLowerCase() === 'data' ? dirname(dataDir) : dataDir;
  return join(root, 'SavedGames');
}

function syncStructureHeightCache(world: TacticalWorld, cached: readonly (readonly [number, number])[]): void {
  for (const list of world.structures.lists) for (const s of list) s.cachedHeight = 0;
  for (const [g, index] of cached) {
    const s = world.structures.at(g)[index];
    if (s) structureHeight(s);
  }
}

async function sectorContext(
  read: ReadFile,
  content: TacticalContent,
  worlds: Map<string, TacticalWorld>,
  p: Json | null,
): Promise<Context> {
  const map = p ? `maps/${String(p.map ?? `${p.sector}.dat`).toLowerCase()}` : DEFAULT_MAP;
  let world = worlds.get(map);
  if (!world) {
    world = await loadTacticalWorld(read, map);
    worlds.set(map, world);
  }
  const sim = new TacticalSim(world, content, 1);
  if (p?.hour !== undefined) {
    syncStructureHeightCache(world, (p.structureHeights as [number, number][] | undefined) ?? []);
    loadMapLights(sim.state, world.map.lights, Number(p.hour));
    lightSetBaseLevel(sim.state, Number(p.ambient));
  }
  return { sim, save: false };
}

async function saveContext(read: ReadFile, dataDir: string, p: Json): Promise<Context> {
  const bytes = new Uint8Array(readFileSync(join(savesDir(dataDir), `${String(p.name)}.sav`)));
  const { session } = await createTacticalSaveSession(read, bytes);
  return { sim: session.sim, save: true, bytes };
}

async function comparePreBattleProbe(read: ReadFile, exists: FileExists, ctx: Context | null, p: Json): Promise<number> {
  if (!ctx?.bytes) return report(`pbi line ${p.line}`, false, 'no save loaded');
  const { session } = await createTacticalSaveSession(read, ctx.bytes, 1, exists);
  return comparePreBattle(session, p);
}

async function compareEnemyCountsProbe(read: ReadFile, ctx: Context | null, p: Json): Promise<number> {
  if (!ctx?.bytes) return report(`enemycounts line ${p.line}`, false, 'no save loaded');
  const { session } = await createTacticalSaveSession(read, ctx.bytes);
  return compareEnemyCounts(session, p);
}

async function compareAutoresolveProbe(
  read: ReadFile,
  exists: FileExists,
  ctx: Context | null,
  setup: Json | null,
  p: Json,
): Promise<number> {
  if (!ctx?.bytes || !setup) return compareAutoresolve(content, p);
  const { session } = await createTacticalSaveSession(read, ctx.bytes, 1, exists);
  const creation = (await createTacticalSaveSession(read, ctx.bytes, 1, exists)).session;
  return compareAutoresolve(content, p, (r) => {
    compareAutoresolveCreation(r, content, creation, setup, p);
    compareAutoresolveAftermath(r, content, session, setup, p);
  });
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
const dataDir = data.dataDir;
if (dataDir === null) {
  console.error('JA2_DATA_DIR is required');
  process.exit(2);
}
const read: ReadFile = withGraphicFacts(vfsFileReader(data.vfs));
const exists: FileExists = (p) => data.vfs.stat(p) !== undefined;
const content = await loadTacticalContent(read);
const worlds = new Map<string, TacticalWorld>();
let failures = 0;
for (const file of files) {
  const strategic = new StrategicComparer(read);
  const economy = new EconomyComparer(read);
  const sai = new SaiComparer(read);
  const sectors = new SectorComparer(read, (p) => data.vfs.stat(p) !== undefined);
  const creatures = new CreatureComparer(read, exists);
  const morale = new MoraleComparer(read, exists);
  const merchants = new MerchantComparer(read);
  const contracts = new ContractComparer(read, exists);
  const creatureAi = new CreatureAiComparer(read, exists);
  const laptop = new LaptopComparer(read, exists);
  const doors = new DoorComparer(read, exists);
  const attach = new AttachComparer(read, exists);
  const heli = new HeliComparer(read, exists);
  const talk = new TalkComparer(read, exists, (path) => data.vfs.layerCount(path));
  const give = new GiveComparer(read, exists, (path) => data.vfs.layerCount(path));
  const civ = new CivComparer(read, exists, (path) => data.vfs.layerCount(path));
  const facts = new FactComparer(read, exists);
  const actions = new ActionComparer(read, exists);
  const meanwhiles = new MeanwhileComparer(read, exists);
  const schedules = new ScheduleComparer(read, exists, savesDir(dataDir));
  const recruits = new RecruitComparer(read, exists);
  const boxing = new BoxingComparer(read, exists);
  let ctx: Context | null = null;
  let arSetup: Json | null = null;
  for (const p of readLines(file)) {
    if (p.error) failures += report(`${p.probe} line ${p.line}`, false, `oracle error: ${p.error}`);
    else if (p.probe === 'arsetup') {
      arSetup = p;
      await creatures.arsetup(p);
    } else if (p.probe === 'sector') {
      ctx = await sectorContext(read, content, worlds, p);
      sectors.loadSector(ctx.sim, p);
      meanwhiles.loadSector();
    } else if (p.probe === 'save') {
      ctx = await saveContext(read, dataDir, p);
      sectors.loadSave(savesDir(dataDir), String(p.name));
      await strategic.loadSave(savesDir(dataDir), String(p.name), ctx.sim);
      await economy.loadSave(savesDir(dataDir), String(p.name));
      await sai.loadSave(savesDir(dataDir), String(p.name));
      if (ctx.bytes) creatures.loadSave(ctx.bytes);
      if (ctx.bytes) morale.loadSave(ctx.bytes);
      await merchants.loadSave(savesDir(dataDir), String(p.name));
      if (ctx.bytes) contracts.loadSave(ctx.bytes);
      if (ctx.bytes) creatureAi.loadSave(ctx.bytes);
      if (ctx.bytes) laptop.loadSave(ctx.bytes);
      if (ctx.bytes) doors.loadSave(ctx.bytes);
      if (ctx.bytes) attach.loadSave(ctx.bytes);
      if (ctx.bytes) heli.loadSave(ctx.bytes);
      if (ctx.bytes) talk.loadSave(ctx.bytes);
      if (ctx.bytes) give.loadSave(ctx.bytes);
      if (ctx.bytes) civ.loadSave(ctx.bytes);
      if (ctx.bytes) facts.loadSave(ctx.bytes);
      if (ctx.bytes) actions.loadSave(ctx.bytes);
      if (ctx.bytes) recruits.loadSave(ctx.bytes);
      if (ctx.bytes) meanwhiles.loadSave(ctx.bytes);
      if (ctx.bytes) boxing.loadSave(ctx.bytes);
    } else if (p.probe === 'end') continue;
    else if (p.probe === 'autoresolve') failures += await compareAutoresolveProbe(read, exists, ctx, arSetup, p);
    else if (p.probe === 'enemycounts') failures += await compareEnemyCountsProbe(read, ctx, p);
    else if (p.probe === 'pbi') failures += await comparePreBattleProbe(read, exists, ctx, p);
    else if (MERCHANT_PROBES.has(String(p.probe))) failures += await merchants.compare(p);
    else if (STRATEGIC_PROBES.has(String(p.probe))) failures += await strategic.compare(p);
    else if (ECONOMY_PROBES.has(String(p.probe))) failures += economy.compare(p);
    else if (SAI_PROBES.has(String(p.probe))) failures += await sai.compare(p);
    else if (SECTOR_PROBES.has(String(p.probe))) failures += await sectors.compare(p);
    else if (p.probe === 'options' && !ctx?.bytes) merchants.setOptions(p);
    else if (CREATURE_PROBES.has(String(p.probe))) {
      if (p.probe === 'options') merchants.setOptions(p);
      failures += await creatures.compare(p);
    } else if (MORALE_PROBES.has(String(p.probe))) failures += await morale.compare(p);
    else if (CONTRACT_PROBES.has(String(p.probe))) failures += await contracts.compare(p);
    else if (CREATURE_AI_PROBES.has(String(p.probe))) failures += await creatureAi.compare(p);
    else if (LAPTOP_PROBES.has(String(p.probe))) failures += await laptop.compare(p);
    else if (DOOR_PROBES.has(String(p.probe))) failures += await doors.compare(p);
    else if (ATTACH_PROBES.has(String(p.probe))) failures += await attach.compare(p);
    else if (HELI_PROBES.has(String(p.probe))) failures += await heli.compare(p);
    else if (TALK_PROBES.has(String(p.probe))) failures += await talk.compare(p);
    else if (GIVE_PROBES.has(String(p.probe))) failures += await give.compare(p);
    else if (CIV_PROBES.has(String(p.probe))) failures += await civ.compare(p);
    else if (FACT_PROBES.has(String(p.probe))) failures += await facts.compare(p);
    else if (ACTION_PROBES.has(String(p.probe))) failures += await actions.compare(p);
    else if (SCHEDULE_PROBES.has(String(p.probe))) failures += await schedules.compare(p);
    else if (RECRUIT_PROBES.has(String(p.probe))) failures += await recruits.compare(p);
    else if (MEANWHILE_PROBES.has(String(p.probe))) failures += await meanwhiles.compare(p, ctx?.sim ?? null);
    else if (BOXING_PROBES.has(String(p.probe))) failures += await boxing.compare(p);
    else {
      ctx ??= await sectorContext(read, content, worlds, null);
      if (p.probe === 'costs') failures += compareCosts(ctx, p);
      else if (p.probe === 'path') failures += comparePath(ctx, p);
      else if (p.probe === 'los') failures += compareLos(ctx, p);
      else if (p.probe === 'soldier' || p.probe === 'soldiers') failures += compareSoldiers(ctx, p);
      else if (p.probe === 'cth') failures += compareCth(ctx, p);
      else if (p.probe === 'bestshot') failures += compareBestShot(ctx, p);
      else if (p.probe === 'light') failures += compareLight(ctx, p);
      else if (p.probe === 'lights') failures += compareLights(ctx, p);
      else if (p.probe === 'ambient') lightSetBaseLevel(ctx.sim.state, Number(p.level));
    }
  }
}
await data.close();
console.log(failures === 0 ? 'all probes match' : `${failures} mismatching probes`);
process.exit(failures === 0 ? 0 : 1);

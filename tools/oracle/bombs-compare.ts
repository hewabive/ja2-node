import { NOTHING } from '../../src/content/items/items.ts';
import { has as hasFlag, StructureFlags } from '../../src/content/world/structures.ts';
import { loadTacticalWorld } from '../../src/content/world/tactical-world.ts';
import type { ReadFile } from '../../src/content/world/tileset-loader.ts';
import type { CampaignSession } from '../../src/server/campaign-session.ts';
import type { FileExists } from '../../src/server/world-cache.ts';
import { createItem, emptyObject, type ItemObject, ObjectFlags } from '../../src/sim/items/object.ts';
import { makeClosestEnemyChosenOne, panicAI, possiblyMakeThisEnemyChosenOne } from '../../src/sim/tactical/ai/panic.ts';
import { executeUseDetonator, pullTriggerOpcode } from '../../src/sim/tactical/ai/panic-actions.ts';
import { closestPanicTrigger, initPanicSystem, NUM_PANIC_TRIGGERS } from '../../src/sim/tactical/ai/panic-triggers.ts';
import { plotPathCost } from '../../src/sim/tactical/ai/utils.ts';
import { anim } from '../../src/sim/tactical/anim-states.ts';
import {
  actionValueOf,
  armBomb,
  bombItemOf,
  bombOwnerOf,
  bombStatusOf,
  detonatorOf,
  frequencyOf,
  setActionValue,
  setBombItem,
  setBombOwner,
  setDetonator,
  setFrequency,
  setTolerance,
  toleranceOf,
} from '../../src/sim/tactical/bombs/bomb-object.ts';
import {
  decayBombTimers,
  handleExplosionQueue,
  setOffBombsByFrequency,
  setOffBombsInGridNo,
} from '../../src/sim/tactical/bombs/bomb-queue.ts';
import { answerPlaceBlueFlag, checkIfNearbyGroundSeemsWrong, nearbyGroundSeemsWrong } from '../../src/sim/tactical/bombs/mine-detection.ts';
import { setBlueFlagFlags } from '../../src/sim/tactical/bombs/mine-flags.ts';
import { answerBombMessageBox, handleSoldierDropBomb, startBombMessageBox } from '../../src/sim/tactical/bombs/planting.ts';
import { answerDisarmTrap, answerRemoveBlueFlag } from '../../src/sim/tactical/booby-traps.ts';
import type { TacticalContent } from '../../src/sim/tactical/content.ts';
import { findDoorInfo } from '../../src/sim/tactical/doors/door-table.ts';
import { InvSlot } from '../../src/sim/tactical/inventory.ts';
import { answerActivateSwitch, handleSoldierPickupItem } from '../../src/sim/tactical/item-actions.ts';
import { lightSpriteDestroy } from '../../src/sim/tactical/lighting/lighting.ts';
import { setSoldierPosition } from '../../src/sim/tactical/movement.ts';
import type { NarrativePort } from '../../src/sim/tactical/narrative/port.ts';
import { findBestPath, type MoveMode } from '../../src/sim/tactical/pathfinding.ts';
import { minPtsToMove } from '../../src/sim/tactical/points.ts';
import { profileProgress, StatKind } from '../../src/sim/tactical/profiles.ts';
import { type TacticalPrompt, TacticalPromptKind, takeAnswer } from '../../src/sim/tactical/prompts.ts';
import { NOWHERE, type Soldier, Team } from '../../src/sim/tactical/soldier.ts';
import type { TacticalState } from '../../src/sim/tactical/state.ts';
import { TacticalSim } from '../../src/sim/tactical/tactical-sim.ts';
import { addItemToPool, loadWorldItemsFromMap, type WorldItem, WorldItemFlags } from '../../src/sim/tactical/world-items.ts';
import { activateXRayDevice, turnOffXRayEffects } from '../../src/sim/tactical/xray.ts';
import { type Draw, firstDifference, ReplayMismatch, report, StrictReplay } from './actions-compare.ts';
import { createTacticalSaveSession } from './tactical-import.ts';

type Json = Record<string, unknown>;

export const BOMB_PROBES: ReadonlySet<string> = new Set([
  'bombmap',
  'armbomb',
  'bombsoldier',
  'mineflag',
  'stepon',
  'bombfrequency',
  'decaybombs',
  'bombqueue',
  'bombreset',
  'groundcheck',
  'bombpickup',
  'bombanswer',
  'plantbomb',
  'xray',
  'panicinit',
  'panicset',
  'chosenone',
  'possiblychosen',
  'panicai',
  'pulltrigger',
  'usedetonator',
  'minepath',
]);

const SEED = 1;
const MAIN_STREAM = 'm';
const PRE_STREAM = 'p';
const MARK_STREAM = 'k';
const DROPPED_MARKS: ReadonlyMap<number, number> = new Map([
  [301, 302],
  [4001, 4000],
]);
const NATIVE_NOWHERE = 25601;
const NO_SOLDIER_ID = -1;
const DEFAULT_BOMB_STATUS = 100;
const DEFAULT_ATTACHMENT_STATUS = 100;
const DEFAULT_OWNER = 1;
const MINE_FLAG_MASK = 0x0c;
const ROOF_LEVEL_HEIGHT = 50;
const SET_OFF_TRIGGER_CODE = 762;
const BURIED = -3;
const MOVE_MODES: Readonly<Record<string, MoveMode>> = { walk: 'WALKING', run: 'RUNNING', swat: 'SWATTING', crawl: 'CRAWLING' };
const SECTOR_ROWS = 'ABCDEFGHIJKLMNOP';
const UNDEFINED_ANSWER = '';
const WITHOUT_RANDOM = false;

const num = (v: unknown) => Number(v ?? 0);
const has = (a: Json, key: string) => a[key] !== undefined;
const grid = (g: number) => (g === NOWHERE ? NATIVE_NOWHERE : g);

function withoutDroppedDraws(trace: readonly Draw[]): Draw[] {
  const kept: Draw[] = [];
  const open: number[] = [];
  for (const d of trace) {
    if (d[0] === MARK_STREAM) {
      const end = DROPPED_MARKS.get(d[1]);
      if (end !== undefined) open.push(end);
      else if (open[open.length - 1] === d[1]) open.pop();
      continue;
    }
    if (open.length === 0) kept.push(d);
  }
  return kept;
}

function replay(t: TacticalState, trace: readonly Draw[], action: () => void, withRandom = true): string[] {
  const draws = withoutDroppedDraws(trace);
  const main = new StrictReplay(withRandom ? draws.filter((d) => d[0] === MAIN_STREAM) : [], 'Random');
  const pre = new StrictReplay(
    draws.filter((d) => d[0] === PRE_STREAM),
    'PreRandom',
  );
  const rng = t.rng as unknown as Record<string, unknown>;
  const preRng = t.pre as unknown as Record<string, unknown>;
  Object.assign(rng, { int: (n: number) => main.int(n), chance: (x: number) => main.int(100) < x });
  Object.assign(preRng, { int: (n: number) => pre.int(n), chance: (x: number) => pre.int(100) < x });
  const problems: string[] = [];
  try {
    action();
    if (main.left || pre.left) problems.push(`${main.left} Random and ${pre.left} PreRandom draws left over`);
  } catch (e) {
    if (e instanceof ReplayMismatch) problems.push(e.message);
    else throw e;
  } finally {
    delete rng.int;
    delete rng.chance;
    delete preRng.int;
    delete preRng.chance;
  }
  return problems;
}

function itemIndex(t: TacticalState, name: string): number {
  if (/^\d+$/.test(name)) return Number(name);
  const item = t.content.items.byName.get(name)?.index;
  if (item === undefined) throw new Error(`unknown item ${name}`);
  return item;
}

function bombRow(wi: WorldItem): number[] {
  const o = wi.object;
  return [
    wi.gridNo,
    wi.level,
    o.item,
    wi.visible,
    wi.flags,
    o.flags,
    o.trap,
    bombStatusOf(o),
    detonatorOf(o),
    bombItemOf(o),
    frequencyOf(o),
    bombOwnerOf(o),
    actionValueOf(o),
    toleranceOf(o),
  ];
}

function isMapBombItem(t: TacticalState, wi: WorldItem): boolean {
  const item = wi.object.item;
  const bomb = (wi.flags & WorldItemFlags.ARMED_BOMB) !== 0;
  return bomb || wi.object.trap > 0 || item === itemIndex(t, 'ACTION_ITEM') || item === itemIndex(t, 'SWITCH');
}

function promptKind(prompt: TacticalPrompt): string {
  return prompt.kind === TacticalPromptKind.BOMB_SETTING ? `${prompt.kind}/${prompt.detonator}` : prompt.kind;
}

function nativeExplosion(row: readonly number[]): number[] {
  const [owner = 0, x = 0, y = 0, z = 0, gridNo = 0, item = 0, level = 0] = row;
  return [owner, x, y, z === 0 && level > 0 ? ROOF_LEVEL_HEIGHT : z, gridNo, item, level];
}

function bombState(t: TacticalState): Json {
  const q = t.explosionQueue;
  const panic = t.panic;
  const mines: number[][] = [];
  t.mineFlags.forEach((flags, g) => {
    if (flags & MINE_FLAG_MASK) mines.push([g, flags & MINE_FLAG_MASK]);
  });
  const explosions = t.explosives.aniTiles
    .flatMap((a) => (a.kind === 'explosion' ? [[a.owner?.id ?? NO_SOLDIER_ID, a.x, a.y, a.z, a.gridNo, a.item, a.level]] : []))
    .reverse();
  const trap = t.boobyTrap;
  return {
    bombs: t.worldBombs.flatMap((slot, i) => (slot.exists ? [[i, bombRow(slot.item)]] : [])),
    slots: t.worldBombs.length,
    queue: q.entries.map((e) => [e.bomb, e.timestamp - t.clockMs, e.exists ? 1 : 0]),
    queueActive: q.active,
    mayChangeSight: q.mayHaveChangedSight,
    person: q.person?.id ?? NO_SOLDIER_ID,
    mines,
    panic: {
      flags: panic.flags,
      chosen: panic.chosenOne?.id ?? NO_SOLDIER_ID,
      killed: panic.armyGuysKilled,
      triggers: panic.triggers.map((tr) => [grid(tr.gridNo), tr.isAlarm ? 1 : 0, tr.tolerance]),
    },
    busy: t.turn.attackBusyCount,
    disallowSight: t.perception.disallowSight,
    checkSight: t.turn.checkSightAtEndOfAttack,
    explosions,
    boxes: t.prompt ? [promptKind(t.prompt)] : [],
    boobyTrap: [trap.gridNo, trap.level, trap.buried ? 1 : 0, trap.difficulty, trap.justFound ? 1 : 0],
  };
}

function nativeBombState(p: Json): Json {
  const state = { ...(p.state as Json) };
  state.explosions = ((state.explosions as number[][] | undefined) ?? []).map(nativeExplosion);
  return state;
}

function attachmentRow(o: ItemObject): number[] {
  return o.attachments.flatMap((a) => (a.item === NOTHING ? [] : [a.item, a.status]));
}

function inventoryRows(s: Soldier): unknown[] {
  return s.inv.flatMap((o, slot) =>
    o.item === NOTHING ? [] : [[slot, [o.item, o.count, o.status[0] ?? 0, o.trap, o.flags], attachmentRow(o)]],
  );
}

function soldierRow(t: TacticalState, s: Soldier): Json {
  const row: Json = {
    id: s.id,
    gridNo: s.gridNo,
    level: s.level,
    ap: s.actionPoints,
    breath: s.breath,
    life: s.life,
    keys: s.hasKeys,
    stats: [s.stats.wisdom, s.stats.explosives],
    xrayedBy: s.xrayedBy?.id ?? NO_SOLDIER_ID,
    xrayTime: s.xrayActivatedTime ? 1 : 0,
    inv: inventoryRows(s),
  };
  if (s.team !== Team.OUR) {
    Object.assign(row, {
      alert: s.ai.alertStatus,
      action: s.ai.action,
      actionData: grid(s.ai.actionData),
      newSituation: s.ai.newSituation,
      pathStored: s.pathStored,
      noise: [grid(s.ai.noiseGridNo), s.ai.noiseVolume],
    });
    return row;
  }
  const p = profileProgress(t, s.profile);
  if (p) {
    const wisdom = StatKind.WISDOM;
    const explosives = StatKind.EXPLOSIVES;
    row.gains = [
      p.gains.wisdom,
      p.gains.explosives,
      p.statChangeChances[wisdom] ?? 0,
      p.statChangeSuccesses[wisdom] ?? 0,
      p.statChangeChances[explosives] ?? 0,
      p.statChangeSuccesses[explosives] ?? 0,
    ];
  }
  return row;
}

function soldierRows(t: TacticalState, who: Soldier | null): Json[] {
  const enemies = t.soldiers.filter((s): s is Soldier => s?.placed === true && s.team === Team.ENEMY && s !== who);
  return [...(who ? [who] : []), ...enemies].map((s) => soldierRow(t, s));
}

function doorRows(t: TacticalState, a: Json): number[][] {
  const grids = String(a.doors ?? '')
    .split(',')
    .filter((g) => g !== '')
    .map(Number);
  return grids.map((g) => {
    const open = hasFlag(t.world.structures.find(g, StructureFlags.ANYDOOR)?.flags ?? 0, StructureFlags.OPEN) ? 1 : 0;
    const door = findDoorInfo(t, g);
    return door ? [g, open, door.locked ? 1 : 0, door.trapId, door.trapLevel] : [g, open];
  });
}

function poolRows(t: TacticalState, gridNo: number, level: number): number[][] {
  return t.worldItems.filter((wi) => wi.gridNo === gridNo && wi.level === level).map(bombRow);
}

function attach(t: TacticalState, o: ItemObject, a: Json): void {
  if (!has(a, 'attach')) return;
  String(a.attach)
    .split(',')
    .forEach((name, slot) => {
      const attachment = o.attachments[slot];
      if (!attachment) throw new Error('too many attachments');
      attachment.item = itemIndex(t, name);
      attachment.status = DEFAULT_ATTACHMENT_STATUS;
    });
}

function sectorOf(p: Json): { x: number; y: number; z: number } {
  const name = String(p.sector);
  return { x: Number(name.slice(1)), y: SECTOR_ROWS.indexOf(name[0] ?? 'A') + 1, z: num(p.z) };
}

interface Outcome {
  readonly result: unknown;
  readonly who: Soldier | null;
}

export class BombComparer {
  readonly #read: ReadFile;
  readonly #exists: FileExists;
  readonly #content: TacticalContent;
  #bytes: Uint8Array | null = null;
  #session: CampaignSession | null = null;
  #quoteSaid = false;
  #nativeBoobyTrap: readonly number[] = [];

  constructor(read: ReadFile, exists: FileExists, content: TacticalContent) {
    this.#read = read;
    this.#exists = exists;
    this.#content = content;
  }

  loadSave(bytes: Uint8Array): void {
    this.#bytes = bytes;
    this.#session = null;
  }

  async compare(p: Json): Promise<number> {
    const label = `${String(p.probe)} line ${String(p.line ?? '')}`;
    try {
      if (p.probe === 'bombmap') return await this.#bombMap(label, p);
      return await this.#saveProbe(label, p);
    } catch (e) {
      return report(label, false, `threw: ${(e as Error).message}`);
    }
  }

  async #bombMap(label: string, p: Json): Promise<number> {
    const world = await loadTacticalWorld(this.#read, `maps/${String(p.map).toLowerCase()}`);
    const sim = new TacticalSim(world, this.#content, SEED);
    const t = sim.state;
    t.sector = sectorOf(p);
    const problems = replay(
      t,
      (p.draws as Draw[] | undefined) ?? [],
      () => {
        loadWorldItemsFromMap(t, world.map.items);
        setBlueFlagFlags(t);
        initPanicSystem(t);
      },
      WITHOUT_RANDOM,
    );
    const ours = { items: t.worldItems.filter((wi) => isMapBombItem(t, wi)).map(bombRow), state: bombState(t) };
    const diff = firstDifference(ours, { items: p.items, state: nativeBombState(p) });
    if (diff) problems.push(diff);
    return report(label, problems.length === 0, problems.join('; ') || `${t.worldBombs.length} bomb slots`);
  }

  async #tactical(): Promise<TacticalState> {
    if (!this.#session) {
      if (!this.#bytes) throw new Error('bomb probes need a save');
      this.#session = (await createTacticalSaveSession(this.#read, this.#bytes, SEED, this.#exists)).session;
      const t = this.#tacticalOf(this.#session);
      this.#installNarrative(t);
      this.#keepBoobyTrapGlobals(t);
    }
    return this.#tacticalOf(this.#session);
  }

  #tacticalOf(session: CampaignSession): TacticalState {
    const t = session.campaign.tactical?.state;
    if (!t) throw new Error('no loaded sector');
    return t;
  }

  #keepBoobyTrapGlobals(t: TacticalState): void {
    const [gridNo = 0, level = 0, buried = 0, difficulty = 0, justFound = 0] = this.#nativeBoobyTrap;
    Object.assign(t.boobyTrap, { gridNo, level, buried: buried !== 0, difficulty, justFound: justFound !== 0 });
  }

  #installNarrative(t: TacticalState): void {
    const port = t.narrative;
    t.narrative = new Proxy(port, {
      get: (target, key) => {
        if (key !== 'sayStopTimeQuote') return Reflect.get(target, key, target);
        return () => {
          this.#quoteSaid = true;
          return false;
        };
      },
    }) as NarrativePort;
  }

  #soldier(t: TacticalState, id: unknown): Soldier {
    const s = t.soldiers[num(id)];
    if (!s?.placed) throw new Error(`soldier ${String(id)} is not in the loaded sector`);
    return s;
  }

  async #saveProbe(label: string, p: Json): Promise<number> {
    const t = await this.#tactical();
    const a = (p.args as Json | undefined) ?? {};
    let outcome: Outcome = { result: null, who: null };
    this.#quoteSaid = false;
    const problems = replay(t, (p.draws as Draw[] | undefined) ?? [], () => {
      outcome = this.#run(t, String(p.probe), a);
    });
    const ours = { result: outcome.result, doors: doorRows(t, a), soldiers: soldierRows(t, outcome.who), state: bombState(t) };
    const theirs = { result: p.result, doors: p.doors, soldiers: p.soldiers, state: nativeBombState(p) };
    const diff = firstDifference(ours, theirs);
    if (diff) problems.push(diff);
    this.#nativeBoobyTrap = ((p.state as Json | undefined)?.boobyTrap as number[] | undefined) ?? [];
    return report(label, problems.length === 0, problems.join('; ') || `${t.worldBombs.filter((b) => b.exists).length} bombs`);
  }

  #run(t: TacticalState, probe: string, a: Json): Outcome {
    switch (probe) {
      case 'armbomb':
        this.#armBomb(t, a);
        return { result: null, who: null };
      case 'bombsoldier':
        return { result: null, who: this.#setSoldier(t, a) };
      case 'mineflag':
        t.mineFlags[num(a.grid)] = num(a.flags) & MINE_FLAG_MASK;
        return { result: null, who: null };
      case 'stepon': {
        const s = this.#soldier(t, a.who);
        const found = setOffBombsInGridNo(
          t,
          s,
          has(a, 'grid') ? num(a.grid) : s.gridNo,
          num(a.all) !== 0,
          has(a, 'level') ? num(a.level) : s.level,
        );
        return { result: { found }, who: s };
      }
      case 'bombfrequency': {
        const s = num(a.who) === NO_SOLDIER_ID ? null : this.#soldier(t, a.who);
        setOffBombsByFrequency(t, s, num(a.freq));
        return { result: null, who: s };
      }
      case 'decaybombs':
        for (let i = 0; i < (has(a, 'count') ? num(a.count) : 1); i++) decayBombTimers(t);
        return { result: null, who: null };
      case 'bombqueue':
        for (let i = 0; i < (has(a, 'steps') ? num(a.steps) : 1); i++) {
          t.clockMs += num(a.ms);
          handleExplosionQueue(t);
        }
        return { result: null, who: null };
      case 'bombreset':
        this.#reset(t);
        return { result: null, who: null };
      case 'groundcheck':
        return this.#groundCheck(t, a);
      case 'bombpickup':
        return this.#pickup(t, a);
      case 'bombanswer':
        return { result: { boxes: this.#answer(t, a, false) }, who: has(a, 'who') ? this.#soldier(t, a.who) : null };
      case 'plantbomb':
        return this.#plant(t, a);
      case 'xray':
        return this.#xray(t, a);
      default:
        return this.#panic(t, probe, a);
    }
  }

  #armBomb(t: TacticalState, a: Json): void {
    const o = createItem(t.content.items, itemIndex(t, String(a.item)), has(a, 'status') ? num(a.status) : DEFAULT_BOMB_STATUS);
    attach(t, o, a);
    if (has(a, 'action')) setActionValue(o, num(a.action));
    if (has(a, 'setting')) armBomb(t, o, num(a.setting));
    if (has(a, 'det')) setDetonator(o, num(a.det));
    if (has(a, 'freq')) setFrequency(o, num(a.freq));
    if (has(a, 'bombitem')) setBombItem(o, itemIndex(t, String(a.bombitem)));
    setBombOwner(o, has(a, 'owner') ? num(a.owner) : DEFAULT_OWNER);
    if (has(a, 'trap')) o.trap = num(a.trap);
    if (has(a, 'tolerance')) setTolerance(o, num(a.tolerance));
    if ((has(a, 'armed') ? num(a.armed) : has(a, 'det') ? 1 : 0) !== 0) o.flags |= ObjectFlags.ARMED_BOMB;
    if (num(a.known) !== 0) o.flags |= ObjectFlags.KNOWN_TO_BE_TRAPPED;
    if (num(a.disabled) !== 0) o.flags |= ObjectFlags.DISABLED_BOMB;
    if (num(a.alarm) !== 0) o.flags |= ObjectFlags.ALARM_TRIGGER;
    const flags = has(a, 'flags') ? num(a.flags) : WorldItemFlags.ARMED_BOMB;
    const visible = has(a, 'visible') ? num(a.visible) : BURIED;
    addItemToPool(t, num(a.grid), o, visible, num(a.level), flags, num(a.z));
  }

  #setSoldier(t: TacticalState, a: Json): Soldier {
    const s = this.#soldier(t, a.who);
    if (has(a, 'explosives')) s.stats.explosives = num(a.explosives);
    if (has(a, 'wisdom')) s.stats.wisdom = num(a.wisdom);
    if (has(a, 'explevel')) s.stats.experience = num(a.explevel);
    if (has(a, 'bleeding')) s.bleeding = num(a.bleeding);
    if (has(a, 'shock')) s.shock = num(a.shock);
    if (has(a, 'life')) s.life = num(a.life);
    if (has(a, 'breath')) s.breath = num(a.breath);
    if (has(a, 'ap')) s.actionPoints = num(a.ap);
    if (has(a, 'keys')) s.hasKeys = num(a.keys);
    if (has(a, 'alert')) s.ai.alertStatus = num(a.alert);
    if (has(a, 'grid')) setSoldierPosition(t, s, num(a.grid));
    if (has(a, 'hand')) {
      const hand = String(a.hand);
      const o =
        hand === 'none'
          ? null
          : createItem(t.content.items, itemIndex(t, hand), has(a, 'handstatus') ? num(a.handstatus) : DEFAULT_BOMB_STATUS);
      if (o) attach(t, o, a);
      this.#putInSlot(s, InvSlot.HAND, o);
    }
    if (has(a, 'slot')) {
      const item = String(a.item ?? 'none');
      const status = has(a, 'status') ? num(a.status) : DEFAULT_BOMB_STATUS;
      this.#putInSlot(s, num(a.slot), item === 'none' ? null : createItem(t.content.items, itemIndex(t, item), status));
    }
    return s;
  }

  #putInSlot(s: Soldier, slot: number, o: ItemObject | null): void {
    const target = s.inv[slot];
    if (!target) throw new Error(`no inventory slot ${slot}`);
    Object.assign(target, o ?? emptyObject());
  }

  #reset(t: TacticalState): void {
    const tiles = t.explosives.aniTiles;
    for (let k = tiles.length - 1; k >= 0; k--) {
      const a = tiles[k];
      if (!a || a.kind === 'door') continue;
      if (a.kind === 'explosion' && a.light) lightSpriteDestroy(t, a.light);
      tiles.splice(k, 1);
    }
    t.explosionQueue.entries.length = 0;
    t.explosionQueue.active = false;
    t.explosionQueue.mayHaveChangedSight = false;
    t.explosionQueue.person = null;
    t.turn.attackBusyCount = 0;
    t.perception.disallowSight = false;
    t.turn.checkSightAtEndOfAttack = false;
    t.prompt = null;
  }

  #answer(t: TacticalState, a: Json, quote: boolean): Json {
    const asked: string[] = [];
    const answers = String(a.answers ?? UNDEFINED_ANSWER).split(',');
    for (const choice of answers) {
      const open = t.prompt;
      if (choice === UNDEFINED_ANSWER || !open) break;
      asked.push(promptKind(open));
      const answer = takeAnswer(t, { choice });
      if ('ok' in answer) throw new Error(`answer ${choice} refused`);
      this.#answerPrompt(t, answer.prompt, answer.choice);
    }
    return { quote, asked };
  }

  #answerPrompt(t: TacticalState, prompt: TacticalPrompt, choice: string): void {
    const yes = choice === 'yes';
    switch (prompt.kind) {
      case TacticalPromptKind.DISARM_TRAP:
        answerDisarmTrap(t, yes);
        return;
      case TacticalPromptKind.ACTIVATE_SWITCH:
        answerActivateSwitch(t, prompt, yes);
        return;
      case TacticalPromptKind.PLACE_BLUE_FLAG:
        answerPlaceBlueFlag(t, yes);
        return;
      case TacticalPromptKind.REMOVE_BLUE_FLAG:
        answerRemoveBlueFlag(t, yes);
        return;
      case TacticalPromptKind.BOMB_SETTING:
      case TacticalPromptKind.REMOTE_FREQUENCY:
        answerBombMessageBox(t, prompt, Number(choice));
        return;
    }
  }

  #groundCheck(t: TacticalState, a: Json): Outcome {
    const s = this.#soldier(t, a.who);
    const g = has(a, 'grid') ? num(a.grid) : s.gridNo;
    const around = (has(a, 'around') ? num(a.around) : 1) !== 0;
    if (a.mode === 'raw') {
      const mine = nearbyGroundSeemsWrong(t, s, g, around);
      return { result: { found: mine !== null, problem: grid(mine ?? NOWHERE) }, who: s };
    }
    const stopped = checkIfNearbyGroundSeemsWrong(t, s, g, around);
    return { result: { keepMoving: !stopped, boxes: this.#answer(t, a, this.#quoteSaid) }, who: s };
  }

  #pickup(t: TacticalState, a: Json): Outcome {
    const s = this.#soldier(t, a.who);
    const g = has(a, 'grid') ? num(a.grid) : s.gridNo;
    s.pendingPickup = { gridNo: g, actionGridNo: s.gridNo, zLevel: 0, selection: null };
    handleSoldierPickupItem(t, s);
    const boxes = this.#answer(t, a, this.#quoteSaid);
    return { result: { boxes, pool: poolRows(t, g, s.level) }, who: s };
  }

  #plant(t: TacticalState, a: Json): Outcome {
    const s = this.#soldier(t, a.who);
    const g = has(a, 'grid') ? num(a.grid) : s.gridNo;
    if (a.use === 'remote') startBombMessageBox(t, s, g);
    else handleSoldierDropBomb(t, s, g);
    const boxes = this.#answer(t, a, false);
    return { result: { boxes, pool: poolRows(t, g, s.level) }, who: s };
  }

  #xray(t: TacticalState, a: Json): Outcome {
    const s = this.#soldier(t, a.who);
    if (num(a.off) !== 0) turnOffXRayEffects(t, s);
    else activateXRayDevice(t, s);
    const xrayed = t.mercSlots.filter((tgt) => tgt.xrayedBy !== null).map((tgt) => [tgt.id, tgt.xrayedBy?.id ?? NO_SOLDIER_ID]);
    return { result: { xrayed }, who: s };
  }

  #panic(t: TacticalState, probe: string, a: Json): Outcome {
    switch (probe) {
      case 'panicinit':
        this.#resetPanic(t);
        initPanicSystem(t);
        return { result: null, who: null };
      case 'panicset':
        if (has(a, 'killed')) t.panic.armyGuysKilled = num(a.killed);
        if (has(a, 'chosen')) t.panic.chosenOne = num(a.chosen) === NO_SOLDIER_ID ? null : this.#soldier(t, a.chosen);
        if (has(a, 'aware')) t.perception.awareOfOpposition[Team.ENEMY] = num(a.aware) !== 0;
        return { result: null, who: null };
      case 'chosenone':
        makeClosestEnemyChosenOne(t);
        return { result: null, who: null };
      case 'possiblychosen': {
        const s = this.#soldier(t, a.who);
        possiblyMakeThisEnemyChosenOne(t, s);
        return { result: null, who: s };
      }
      case 'panicai': {
        const s = this.#soldier(t, a.who);
        const canMove = has(a, 'canmove') ? num(a.canmove) : s.actionPoints >= this.#minPtsToMove(t, s) ? 1 : 0;
        const decision = panicAI(t, s, canMove !== 0);
        return { result: { canMove, decision, decisionData: grid(s.ai.actionData) }, who: s };
      }
      case 'pulltrigger': {
        const s = this.#soldier(t, a.who);
        const trigger = closestPanicTrigger(t, s);
        pullTriggerOpcode(t, s, SET_OFF_TRIGGER_CODE);
        return { result: { trigger }, who: s };
      }
      case 'usedetonator': {
        const s = this.#soldier(t, a.who);
        executeUseDetonator(t, s);
        return { result: null, who: s };
      }
      case 'minepath':
        return this.#path(t, a);
      default:
        throw new Error(`unknown bomb probe ${probe}`);
    }
  }

  #minPtsToMove(t: TacticalState, s: Soldier): number {
    return minPtsToMove({ env: t.pathEnv, content: t.content, inCombat: t.inCombat }, s, s.uiMovementMode);
  }

  #resetPanic(t: TacticalState): void {
    const panic = t.panic;
    panic.armyGuysKilled = 0;
    panic.flags = 0;
    for (let k = 0; k < NUM_PANIC_TRIGGERS; k++) {
      const trigger = panic.triggers[k];
      if (!trigger) continue;
      trigger.gridNo = NOWHERE;
      trigger.isAlarm = false;
      trigger.tolerance = 0;
    }
    panic.chosenOne = null;
  }

  #path(t: TacticalState, a: Json): Outcome {
    const s = this.#soldier(t, a.who);
    const to = num(a.to);
    const mode = MOVE_MODES[String(a.mode ?? 'walk')] ?? 'WALKING';
    const route = findBestPath(t.pathEnv, s, to, s.level, { mode, flags: 0 });
    const apCost = route.length === 0 ? 0 : plotPathCost(t, s, to, anim(t.content, mode));
    return { result: { length: route.length, directions: [...route.steps], apCost }, who: s };
  }
}

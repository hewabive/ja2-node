import type { ReadFile } from '../../src/content/world/tileset-loader.ts';
import { createSaveSession } from '../../src/server/save-session.ts';
import type { FileExists } from '../../src/server/world-cache.ts';
import { createItems } from '../../src/sim/items/object.ts';
import { calcBestStab, calcTentacleAttack } from '../../src/sim/tactical/ai/attack-choice.ts';
import { decideNpcAction } from '../../src/sim/tactical/ai/control.ts';
import { creatureCall, trackScent } from '../../src/sim/tactical/ai/creature-decide.ts';
import { decideAlertStatus } from '../../src/sim/tactical/ai/decide.ts';
import { initNewSoldierAnim } from '../../src/sim/tactical/animation.ts';
import { calcChanceToStab, hthImpact } from '../../src/sim/tactical/combat/melee.ts';
import { emptyInventory, InvSlot, NUM_INV_SLOTS } from '../../src/sim/tactical/inventory.ts';
import { setSoldierPosition } from '../../src/sim/tactical/movement.ts';
import { calcActionPoints } from '../../src/sim/tactical/points.ts';
import { dropSmell } from '../../src/sim/tactical/smell.ts';
import { createSoldier, NOWHERE, type Soldier, SoldierStatusFlags } from '../../src/sim/tactical/soldier.ts';
import { registerSoldier, type TacticalState, unregisterSoldier } from '../../src/sim/tactical/state.ts';
import type { TacticalSim } from '../../src/sim/tactical/tactical-sim.ts';

type Json = Record<string, unknown>;
type Draw = readonly [string, number, number, number];

export const CREATURE_AI_PROBES: ReadonlySet<string> = new Set([
  'addsoldier',
  'setsoldier',
  'seen',
  'decide',
  'beststab',
  'stab',
  'creaturecall',
  'smell',
  'dropsmell',
  'trackscent',
]);

const ORACLE_NOWHERE = 25601;
const SEED = 1;
const MAIN_STREAM = 'm';
const PRE_STREAM = 'p';
const MARK_STREAM = 'k';
const MARK_PATH_BEGIN = 301;
const MARK_PATH_END = 302;
const MAX_REPORTED_DIFFERENCES = 12;

const grid = (g: unknown) => (Number(g) === ORACLE_NOWHERE ? NOWHERE : Number(g));
const num = (v: unknown) => Number(v ?? 0);
const flag = (v: unknown) => Number(v ?? 0) !== 0;

function report(label: string, same: boolean, detail: string): number {
  console.log(`${label}: ${same ? 'ok' : 'MISMATCH'} ${detail}`);
  return same ? 0 : 1;
}

class ReplayMismatch extends Error {}

class ReplayRandom {
  readonly #name: string;
  readonly #draws: Draw[];
  #at = 0;

  constructor(name: string, draws: Draw[]) {
    this.#name = name;
    this.#draws = draws;
  }

  get left(): number {
    return this.#draws.length - this.#at;
  }

  int(n: number): number {
    if (n === 0) return 0;
    const d = this.#draws[this.#at];
    if (!d) throw new ReplayMismatch(`${this.#name} draw #${this.#at}: native log exhausted, ja2-node wants range ${n}`);
    if (d[1] !== n)
      throw new ReplayMismatch(`${this.#name} draw #${this.#at}: ja2-node wants range ${n}, native drew ${JSON.stringify(d)}`);
    this.#at++;
    return d[2];
  }

  chance(percent: number): boolean {
    return this.int(100) < percent;
  }

  coinToss(): boolean {
    throw new ReplayMismatch(`${this.#name}: ja2-node tossed a coin, the native trace has no coin tosses`);
  }
}

function decisionDraws(trace: readonly Draw[], stream: string): Draw[] {
  let depth = 0;
  const kept: Draw[] = [];
  for (const d of trace) {
    if (d[0] === MARK_STREAM) depth += d[1] === MARK_PATH_BEGIN ? 1 : d[1] === MARK_PATH_END ? -1 : 0;
    else if (depth === 0 && d[0] === stream) kept.push(d);
  }
  return kept;
}

interface Replay {
  readonly main: ReplayRandom;
  readonly pre: ReplayRandom;
}

function replayed<T>(t: TacticalState, trace: readonly Draw[], run: () => T): { result: T; left: number } {
  const replay: Replay = {
    main: new ReplayRandom('Random', decisionDraws(trace, MAIN_STREAM)),
    pre: new ReplayRandom('PreRandom', decisionDraws(trace, PRE_STREAM)),
  };
  const saved = { rng: t.rng, pre: t.pre };
  Object.assign(t, { rng: replay.main, pre: replay.pre });
  try {
    const result = run();
    return { result, left: replay.main.left + replay.pre.left };
  } finally {
    Object.assign(t, saved);
  }
}

function soldierFromDump(t: TacticalState, d: Json): Soldier {
  const stats = d.stats as Json;
  const traits = (d.skillTraits as number[] | undefined) ?? [0, 0];
  const inv = emptyInventory();
  for (const o of (d.inventory as Json[] | undefined) ?? [])
    inv[num(o.slot)] = createItems(t.content.items, num(o.item), num(o.status), num(o.count));
  return createSoldier({
    id: num(d.id),
    team: num(d.team),
    side: num(d.side),
    name: String(d.name ?? `probe${String(d.id)}`),
    profile: num(d.profile),
    soldierClass: num(d.soldierClass),
    bodyType: num(d.body),
    palettes: { hair: 'BLACKHEAD', skin: 'PINKSKIN', vest: 'BLUEVEST', pants: 'JEANPANTS' },
    inv,
    stats: {
      agility: num(stats.agility),
      dexterity: num(stats.dexterity),
      strength: num(stats.strength),
      wisdom: num(stats.wisdom),
      leadership: num(stats.leadership),
      marksmanship: num(stats.marksmanship),
      mechanical: num(stats.mechanical),
      explosives: num(stats.explosive),
      medical: num(stats.medical),
      experience: num(stats.expLevel),
    },
    life: num(d.life),
    lifeMax: num(d.lifeMax),
    morale: num(d.morale),
    skillTrait1: traits[0] ?? 0,
    skillTrait2: traits[1] ?? 0,
    personalityTrait: num(d.personality),
    breath: num(d.breathMax),
    gridNo: NOWHERE,
    level: num(d.level),
    direction: num(d.direction),
    state: num(d.animState),
  });
}

function syncSoldier(t: TacticalState, s: Soldier, d: Json, ai: Json): void {
  s.side = num(ai.side);
  s.neutral = flag(ai.neutral);
  s.life = num(d.life);
  s.lifeMax = num(d.lifeMax);
  s.breath = num(d.breath);
  s.breathMax = num(d.breathMax);
  s.breathRed = num(d.breathRed);
  s.bleeding = num(d.bleeding);
  s.shock = num(d.shock);
  s.actionPoints = num(d.ap);
  s.initialActionPoints = num(d.initialAp);
  s.morale = num(d.morale);
  s.direction = num(d.direction);
  s.desiredDirection = num(d.desiredDirection);
  s.lastTarget = grid(d.lastTarget);
  s.oldLife = num(ai.oldLife);
  s.normalSmell = num(ai.normalSmell);
  s.monsterSmell = num(ai.monsterSmell);
  s.hunting = flag(ai.hunting);
  s.regenerationCounter = num(ai.regeneration);
  s.uiMovementMode = num(ai.uiMovementMode);
  s.finalDestination = grid(ai.finalDestination);
  s.aimTime = num(ai.aimTime);
  s.aimShotLocation = num(ai.aimShotLocation);
  s.targetLevel = num(ai.targetLevel);
  s.walkToAttackGridNo = grid(ai.walkToAttackGridNo);
  s.walkToAttackCost = num(ai.walkToAttackCost);
  s.stealthMode = flag(ai.stealth);
  const opps = (d.oppList as number[] | undefined) ?? [];
  opps.forEach((v, k) => {
    s.oppList[k] = v;
  });
  const flags = (ai.inventoryFlags as number[] | undefined) ?? [];
  for (let k = 0; k < NUM_INV_SLOTS; k++) {
    const o = s.inv[k];
    if (o) o.flags = flags[k] ?? 0;
  }
  Object.assign(s.ai, {
    alertStatus: num(d.alert),
    orders: num(d.orders),
    attitude: num(d.attitude),
    morale: num(d.aiMorale),
    mobility: num(ai.mobility),
    caller: num(ai.caller),
    callerGridNo: grid(ai.callerGridNo),
    callPriority: num(ai.callPriority),
    callActedUpon: flag(ai.callActedUpon),
    frenzied: flag(ai.frenzied),
    action: num(ai.action),
    actionData: grid(ai.actionData),
    nextAction: num(ai.nextAction),
    nextActionData: grid(ai.nextActionData),
    lastAction: num(ai.lastAction),
    actionInProgress: flag(ai.actionInProgress),
    newSituation: num(ai.newSituation),
    bypassToGreen: num(ai.bypassToGreen),
    dominantDir: num(ai.dominantDir),
    noiseGridNo: grid(ai.noiseGridNo),
    noiseVolume: num(ai.noiseVolume),
    noiseLevel: num(ai.noiseLevel),
    oppCount: num(ai.oppCount),
    underFire: num(ai.underFire),
    patrolGrid: ((ai.patrolGrid as number[] | undefined) ?? []).map(grid),
    patrolCount: num(ai.patrolCount),
    nextPatrolPoint: num(ai.nextPatrolPoint),
    blackList: grid(ai.blackList),
  });
  t.perception.awareOfOpposition[s.team] = ai.teamAware === true;
}

function decisionFacts(t: TacticalState, s: Soldier): Json {
  return {
    alert: s.ai.alertStatus,
    actionData: s.ai.actionData,
    nextAction: s.ai.nextAction,
    nextActionData: s.ai.nextActionData,
    mobility: s.ai.mobility,
    caller: s.ai.caller,
    callerGridNo: s.ai.callerGridNo,
    callPriority: s.ai.callPriority,
    callActedUpon: s.ai.callActedUpon,
    frenzied: s.ai.frenzied,
    hunting: s.hunting,
    oldLife: s.oldLife,
    newSituation: s.ai.newSituation,
    bypassToGreen: s.ai.bypassToGreen,
    underFire: s.ai.underFire,
    oppCount: s.ai.oppCount,
    noiseGridNo: s.ai.noiseGridNo,
    noiseVolume: s.ai.noiseVolume,
    uiMovementMode: s.uiMovementMode,
    finalDestination: s.finalDestination,
    aimTime: s.aimTime,
    aimShotLocation: s.aimShotLocation,
    walkToAttackGridNo: s.walkToAttackGridNo,
    walkToAttackCost: s.walkToAttackCost,
    direction: s.direction,
    desiredDirection: s.desiredDirection,
    ap: s.actionPoints,
    hand: s.inv[InvSlot.HAND]?.item ?? 0,
    secondHand: s.inv[InvSlot.SECOND_HAND]?.item ?? 0,
    inventoryFlags: s.inv.map((o) => o.flags),
    teamAware: t.perception.awareOfOpposition[s.team] === true,
  };
}

function nativeDecisionFacts(d: Json, ai: Json): Json {
  return {
    alert: num(d.alert),
    actionData: grid(ai.actionData),
    nextAction: num(ai.nextAction),
    nextActionData: grid(ai.nextActionData),
    mobility: num(ai.mobility),
    caller: num(ai.caller),
    callerGridNo: grid(ai.callerGridNo),
    callPriority: num(ai.callPriority),
    callActedUpon: flag(ai.callActedUpon),
    frenzied: flag(ai.frenzied),
    hunting: flag(ai.hunting),
    oldLife: num(ai.oldLife),
    newSituation: num(ai.newSituation),
    bypassToGreen: num(ai.bypassToGreen),
    underFire: num(ai.underFire),
    oppCount: num(ai.oppCount),
    noiseGridNo: grid(ai.noiseGridNo),
    noiseVolume: num(ai.noiseVolume),
    uiMovementMode: num(ai.uiMovementMode),
    finalDestination: grid(ai.finalDestination),
    aimTime: num(ai.aimTime),
    aimShotLocation: num(ai.aimShotLocation),
    walkToAttackGridNo: grid(ai.walkToAttackGridNo),
    walkToAttackCost: num(ai.walkToAttackCost),
    direction: num(d.direction),
    desiredDirection: num(d.desiredDirection),
    ap: num(d.ap),
    hand: num(ai.hand),
    secondHand: num(ai.secondHand),
    inventoryFlags: ai.inventoryFlags,
    teamAware: ai.teamAware === true,
  };
}

function differences(ours: Json, theirs: Json): string[] {
  return Object.keys(theirs)
    .filter((k) => JSON.stringify(ours[k]) !== JSON.stringify(theirs[k]))
    .map((k) => `${k} ${JSON.stringify(ours[k])}/${JSON.stringify(theirs[k])}`);
}

export class CreatureAiComparer {
  readonly #read: ReadFile;
  readonly #exists: FileExists;
  #bytes: Uint8Array | null = null;
  #sim: TacticalSim | null = null;

  constructor(read: ReadFile, exists: FileExists) {
    this.#read = read;
    this.#exists = exists;
  }

  loadSave(bytes: Uint8Array): void {
    this.#bytes = bytes;
    this.#sim = null;
  }

  async #session(): Promise<TacticalSim> {
    if (this.#sim) return this.#sim;
    if (!this.#bytes) throw new Error('creature AI probes need a save');
    const { session } = await createSaveSession(this.#read, this.#bytes, SEED, this.#exists);
    this.#sim = session.sim;
    return this.#sim;
  }

  async compare(p: Json): Promise<number> {
    const label = `${String(p.probe)} line ${String(p.line)}`;
    try {
      const sim = await this.#session();
      const t = sim.state;
      switch (p.probe) {
        case 'addsoldier':
          return this.#add(label, t, p);
        case 'setsoldier':
        case 'seen':
          return this.#sync(label, t, p);
        case 'decide':
          return this.#decide(label, sim, p);
        case 'beststab':
          return this.#bestStab(label, t, p);
        case 'stab':
          return this.#stab(label, t, p);
        case 'creaturecall':
          return this.#call(label, t, p);
        case 'smell':
          return this.#smell(label, t, p);
        case 'dropsmell':
          return this.#dropSmell(label, t, p);
        case 'trackscent':
          return this.#trackScent(label, t, p);
        default:
          return report(label, false, 'unknown creature AI probe');
      }
    } catch (e) {
      if (e instanceof ReplayMismatch) return report(label, false, e.message);
      return report(label, false, e instanceof Error ? (e.stack ?? e.message) : String(e));
    }
  }

  #soldier(t: TacticalState, id: unknown): Soldier {
    const s = t.soldiers[num(id)];
    if (!s?.placed) throw new Error(`no soldier ${String(id)} in ja2-node`);
    return s;
  }

  #add(label: string, t: TacticalState, p: Json): number {
    const d = p.soldier as Json;
    const old = t.soldiers[num(d.id)];
    if (old) unregisterSoldier(t, old);
    const s = soldierFromDump(t, d);
    const ai = p.ai as Json;
    s.monsterOrAnimal = (num(d.statusFlags) & (SoldierStatusFlags.MONSTER | SoldierStatusFlags.ANIMAL)) !== 0;
    s.normalSmell = num(ai.normalSmell);
    s.monsterSmell = num(ai.monsterSmell);
    registerSoldier(t, s);
    setSoldierPosition(t, s, num(d.gridNo));
    initNewSoldierAnim(t, s, num(d.animState), 0, true);
    syncSoldier(t, s, d, ai);
    const apPerTurn = calcActionPoints(t.content, s);
    const same = s.gridNo === num(d.gridNo) && apPerTurn === num(d.apPerTurn);
    return report(label, same, `body ${String(d.body)} at ${s.gridNo}/${String(d.gridNo)} ap per turn ${apPerTurn}/${String(d.apPerTurn)}`);
  }

  #sync(label: string, t: TacticalState, p: Json): number {
    const s = this.#soldier(t, p.who);
    syncSoldier(t, s, p.soldier as Json, p.ai as Json);
    if (p.probe === 'seen') {
      const opp = num(p.opp);
      const g = grid(p.grid);
      if (p.public === true) {
        const publicOpp = t.perception.publicOpp[s.team];
        const publicLastKnown = t.perception.publicLastKnown[s.team];
        if (publicOpp) publicOpp[opp] = num(p.value);
        if (publicLastKnown) publicLastKnown[opp] = g;
      } else s.lastKnownOpp[opp] = g;
    }
    return report(label, true, `soldier ${s.id} synced`);
  }

  #decide(label: string, sim: TacticalSim, p: Json): number {
    const t = sim.state;
    const s = this.#soldier(t, p.who);
    const { result, left } = replayed(t, p.draws as Draw[], () => {
      if (p.status === true) decideAlertStatus(t, s, sim.ai.hooks);
      return decideNpcAction(t, s, sim.ai);
    });
    const diffs = differences(
      { decided: result, ...decisionFacts(t, s) },
      { decided: num(p.decided), ...nativeDecisionFacts(p.soldier as Json, p.ai as Json) },
    );
    if (left) diffs.push(`${left} native draws left over`);
    return report(
      label,
      diffs.length === 0,
      `soldier ${s.id} action ${String(p.decided)} data ${grid((p.ai as Json).actionData)}${diffs.length ? `; ${diffs.slice(0, MAX_REPORTED_DIFFERENCES).join('; ')}` : ''}`,
    );
  }

  #bestStab(label: string, t: TacticalState, p: Json): number {
    const s = this.#soldier(t, p.who);
    const saved = {
      attackingWeapon: s.attackingWeapon,
      aimTime: s.aimTime,
      aimShotLocation: s.aimShotLocation,
      targetLevel: s.targetLevel,
    };
    const { result: best, left } = replayed(t, p.draws as Draw[], () =>
      p.tentacles === true ? calcTentacleAttack(t, s) : calcBestStab(t, s, true),
    );
    const ours = {
      weapon: s.inv[InvSlot.HAND]?.item ?? 0,
      ap: s.actionPoints,
      possible: best.possible,
      opponent: best.opponent?.id ?? null,
      target: best.target,
      aimTime: best.aimTime,
      chanceToReallyHit: best.chanceToReallyHit,
      apCost: best.apCost,
      attackValue: best.attackValue,
      walkToAttackGridNo: s.walkToAttackGridNo,
      walkToAttackCost: s.walkToAttackCost,
    };
    Object.assign(s, saved);
    const theirs = {
      weapon: num(p.weapon),
      ap: num(p.ap),
      possible: p.possible === true,
      opponent: p.opponent ?? null,
      target: grid(p.target),
      aimTime: num(p.aimTime),
      chanceToReallyHit: num(p.chanceToReallyHit),
      apCost: num(p.apCost),
      attackValue: num(p.attackValue),
      walkToAttackGridNo: grid(p.walkToAttackGridNo),
      walkToAttackCost: num(p.walkToAttackCost),
    };
    const diffs = differences(ours, theirs);
    if (left) diffs.push(`${left} native draws left over`);
    return report(label, diffs.length === 0, `${JSON.stringify(theirs)}${diffs.length ? `; ${diffs.join('; ')}` : ''}`);
  }

  #stab(label: string, t: TacticalState, p: Json): number {
    const s = this.#soldier(t, p.who);
    const target = this.#soldier(t, p.target);
    const savedWeapon = s.attackingWeapon;
    s.attackingWeapon = s.inv[InvSlot.HAND]?.item ?? 0;
    const chance = calcChanceToStab(t, s, target, num(p.aim));
    const { result: impact, left } = replayed(t, p.draws as Draw[], () => hthImpact(t, s, target, num(p.hitBy), true));
    const weapon = s.attackingWeapon;
    s.attackingWeapon = savedWeapon;
    const diffs = differences({ weapon, chance, impact }, { weapon: num(p.weapon), chance: num(p.chance), impact: num(p.impact) });
    if (left) diffs.push(`${left} native draws left over`);
    return report(
      label,
      diffs.length === 0,
      `chance ${String(p.chance)} impact ${String(p.impact)}${diffs.length ? `; ${diffs.join('; ')}` : ''}`,
    );
  }

  #call(label: string, t: TacticalState, p: Json): number {
    const s = this.#soldier(t, p.who);
    s.ai.actionData = num(p.call);
    const { left } = replayed(t, p.draws as Draw[], () => creatureCall(t, s));
    const receiver = (r: Soldier) => ({
      id: r.id,
      alert: r.ai.alertStatus,
      caller: r.ai.caller,
      callerGridNo: r.ai.callerGridNo,
      callPriority: r.ai.callPriority,
      callActedUpon: r.ai.callActedUpon,
    });
    const ours = {
      aware: t.perception.awareOfOpposition[s.team] === true,
      receivers: t.soldiers.filter((r): r is Soldier => r?.placed === true && r.team === s.team).map(receiver),
    };
    const theirs = {
      aware: p.aware === true,
      receivers: (p.receivers as Json[]).map((r) => {
        const ai = r.ai as Json;
        return {
          id: num(r.id),
          alert: num(r.alert),
          caller: num(ai.caller),
          callerGridNo: grid(ai.callerGridNo),
          callPriority: num(ai.callPriority),
          callActedUpon: flag(ai.callActedUpon),
        };
      }),
    };
    const diffs = differences(ours, theirs);
    if (left) diffs.push(`${left} native draws left over`);
    return report(
      label,
      diffs.length === 0,
      `call ${String(p.call)} from ${s.id} reaches ${theirs.receivers.filter((r) => r.caller === s.id).length}${diffs.length ? `; ${diffs.join('; ')}` : ''}`,
    );
  }

  #smell(label: string, t: TacticalState, p: Json): number {
    const g = num(p.g);
    t.smell.smell[g] = num(p.smell);
    t.smell.blood[g] = num(p.blood);
    return report(label, true, `smell ${t.smell.smell[g]} blood ${t.smell.blood[g]} at ${g}`);
  }

  #dropSmell(label: string, t: TacticalState, p: Json): number {
    const s = this.#soldier(t, p.who);
    dropSmell(t.smell, s);
    const g = s.gridNo;
    const ours = { g, smell: t.smell.smell[g] ?? 0, blood: t.smell.blood[g] ?? 0 };
    const theirs = { g: num(p.g), smell: num(p.smell), blood: num(p.blood) };
    const diffs = differences(ours, theirs);
    return report(label, diffs.length === 0, `${JSON.stringify(theirs)}${diffs.length ? `; ${diffs.join('; ')}` : ''}`);
  }

  #trackScent(label: string, t: TacticalState, p: Json): number {
    const s = this.#soldier(t, p.who);
    s.ai.actionData = grid(p.actionData);
    const { result, left } = replayed(t, p.draws as Draw[], () => trackScent(t, s));
    const diffs = differences({ result, actionData: s.ai.actionData }, { result: num(p.result), actionData: grid(p.actionData) });
    if (left) diffs.push(`${left} native draws left over`);
    return report(label, diffs.length === 0, `result ${String(p.result)}${diffs.length ? `; ${diffs.join('; ')}` : ''}`);
  }
}

import { PreRandom, Rng } from '../../../core/rng.ts';
import { InvSlot } from '../inventory.ts';
import { type Soldier, Team, TOTAL_SOLDIERS } from '../soldier.ts';
import { mercs, type TacticalState } from '../state.ts';
import { NUM_WATCHED_LOCS } from '../turns/turn-state.ts';
import { Opp } from './opp.ts';

const NONE = -1;
const FIRST_TAPE_LENGTH = 4096;

export class InputTape {
  #numbers = new Float64Array(FIRST_TAPE_LENGTH);
  readonly #refs: unknown[] = [];
  #numberCount = 0;
  #refCount = 0;
  #checking = false;
  #matching = true;
  #numberCursor = 0;
  #refCursor = 0;

  record(): void {
    this.#checking = false;
    this.#numberCount = 0;
    this.#refCount = 0;
  }

  check(): void {
    this.#checking = true;
    this.#matching = true;
    this.#numberCursor = 0;
    this.#refCursor = 0;
  }

  matched(): boolean {
    this.#checking = false;
    return this.#matching && this.#numberCursor === this.#numberCount && this.#refCursor === this.#refCount;
  }

  put(value: number): void {
    if (this.#checking) {
      if (this.#numbers[this.#numberCursor++] !== value) this.#matching = false;
    } else if (this.#numberCount < this.#numbers.length) this.#numbers[this.#numberCount++] = value;
    else this.#grow(value);
  }

  #grow(value: number): void {
    const longer = new Float64Array(this.#numbers.length * 2);
    longer.set(this.#numbers);
    this.#numbers = longer;
    this.#numbers[this.#numberCount++] = value;
  }

  flag(value: boolean): void {
    this.put(value ? 1 : 0);
  }

  ref(value: unknown): void {
    if (!this.#checking) this.#refs[this.#refCount++] = value;
    else if (this.#refs[this.#refCursor++] !== value) this.#matching = false;
  }

  sameAs(other: InputTape): boolean {
    const n = this.#numberCount;
    const r = this.#refCount;
    if (n !== other.#numberCount || r !== other.#refCount) return false;
    const mine = this.#numbers;
    const theirs = other.#numbers;
    for (let k = 0; k < n; k++) if (mine[k] !== theirs[k]) return false;
    for (let k = 0; k < r; k++) if (this.#refs[k] !== other.#refs[k]) return false;
    return true;
  }
}

export interface LookMemo {
  remembered: InputTape;
  before: InputTape;
  readonly after: InputTape;
  readonly present: Soldier[];
  rememberedRadioCallers: Soldier[];
  radioCallers: Soldier[];
  known: boolean;
  unrepeatable: boolean;
  looking: boolean;
}

export function createLookMemo(): LookMemo {
  return {
    remembered: new InputTape(),
    before: new InputTape(),
    after: new InputTape(),
    present: [],
    rememberedRadioCallers: [],
    radioCallers: [],
    known: false,
    unrepeatable: false,
    looking: false,
  };
}

let skipping = true;

export function setLookSkipping(on: boolean): void {
  skipping = on;
}

export function markLookUnrepeatable(t: Pick<TacticalState, 'lookMemo'>): void {
  t.lookMemo.unrepeatable = true;
}

export function setLastMercToRadio(t: Pick<TacticalState, 'lookMemo' | 'perception'>, s: Soldier): void {
  t.perception.lastMercToRadio[s.team] = s;
  if (t.lookMemo.looking) t.lookMemo.radioCallers.push(s);
}

function recordScene(t: TacticalState, tape: InputTape): void {
  const world = t.world;
  tape.ref(world);
  tape.ref(world.structures);
  tape.put(world.structures.version);
  tape.ref(world.costs);
  tape.put(world.costs.version);
  tape.ref(world.level.heights);
  const c = t.changes;
  tape.put(c.smoke);
  tape.put(c.light);
  tape.put(c.fog);
  tape.put(c.blood);
  tape.put(c.occupancy);
  tape.flag(t.inCombat);
  tape.put(t.options.difficulty);
  tape.flag(t.options.bloodAndGore);
  tape.put(t.sector?.x ?? NONE);
  tape.put(t.sector?.y ?? NONE);
  tape.put(t.sector?.z ?? NONE);
}

function recordCaveLights(t: TacticalState, tape: InputTape): void {
  const l = t.lighting;
  tape.flag(l.underground);
  tape.flag(l.caves);
  if (!l.caves) return;
  for (const sprite of l.sprites) {
    tape.ref(sprite);
    if (!sprite) continue;
    tape.put(sprite.x);
    tape.put(sprite.y);
    tape.put(sprite.flags);
  }
}

function recordPerception(t: TacticalState, tape: InputTape): void {
  const p = t.perception;
  tape.put(p.bestSize);
  for (const s of p.best) tape.ref(s);
  tape.put(p.playerTeamSawCreatures);
  tape.flag(p.disallowSight);
  for (let team = 0; team < p.publicOpp.length; team++) {
    tape.flag(p.awareOfOpposition[team] === true);
    tape.put(p.publicNoiseGridNo[team] ?? NONE);
    tape.put(p.publicNoiseVolume[team] ?? NONE);
    tape.put(p.publicNoiseLevel[team] ?? NONE);
  }
  tape.put(t.turn.sightFlags);
  tape.flag(t.turn.delayResolvingBestSightingDueToDoor);
  tape.ref(t.turn.interruptProvoker);
  tape.ref(t.panic.chosenOne);
}

function recordOurMerc(t: TacticalState, s: Soldier, tape: InputTape): void {
  tape.put(t.profiles.get(s.profile)?.miscFlags ?? NONE);
  tape.put(t.narrative.corpseQuoteRecord(s)?.corpseQuoteTolerance ?? NONE);
}

function recordSoldier(t: TacticalState, s: Soldier, tape: InputTape): void {
  tape.flag(s.placed);
  tape.put(s.life);
  tape.put(s.team);
  tape.put(s.side);
  tape.flag(s.neutral);
  tape.put(s.bodyType);
  tape.put(s.profile);
  tape.put(s.soldierClass);
  tape.put(s.gridNo);
  tape.put(s.level);
  tape.put(s.x);
  tape.put(s.y);
  tape.put(s.direction);
  tape.put(s.desiredDirection);
  tape.put(s.state);
  tape.put(s.overTerrain);
  tape.put(s.tilesMoved);
  tape.put(s.camo);
  tape.put(s.blindedCounter);
  tape.flag(s.muzzleFlash);
  tape.flag(s.gassed);
  tape.put(s.normalSmell);
  tape.put(s.monsterSmell);
  tape.flag(s.monsterOrAnimal);
  tape.put(s.skillTrait1);
  tape.put(s.skillTrait2);
  tape.put(s.inv[InvSlot.HEAD1]?.item ?? NONE);
  tape.put(s.inv[InvSlot.HEAD2]?.item ?? NONE);
  tape.put(s.visible);
  tape.put(s.fade);
  tape.flag(s.aiTurnControl);
  tape.put(s.turningFromPronePosition);
  tape.put(s.newOppCnt);
  const ai = s.ai;
  tape.put(ai.newSituation);
  tape.put(ai.alertStatus);
  tape.put(ai.oppCount);
  tape.put(ai.noiseGridNo);
  tape.put(ai.noiseVolume);
  tape.put(ai.noiseLevel);
  tape.flag(t.narrative.mercAsleep(s));
  if (s.team === Team.OUR) recordOurMerc(t, s, tape);
}

function recordSoldiers(t: TacticalState, tape: InputTape, present: Soldier[]): void {
  present.length = 0;
  tape.put(t.soldiers.length);
  for (const s of t.soldiers) {
    tape.ref(s);
    if (s) present.push(s);
  }
  const placed = mercs(t);
  tape.put(placed.length);
  for (const s of placed) {
    tape.ref(s);
    if (t.soldiers[s.id] !== s) present.push(s);
  }
  for (const s of present) recordSoldier(t, s, tape);
}

function recordOpinions(t: TacticalState, tape: InputTape, present: readonly Soldier[]): void {
  const seen = t.turn.seenOpponents;
  for (const viewer of present) {
    const opinions = viewer.oppList;
    for (const target of present) {
      const opinion = opinions[target.id] ?? NONE;
      tape.put(opinion);
      if (opinion === Opp.NOT_HEARD_OR_SEEN) continue;
      tape.put(viewer.lastKnownOpp[target.id] ?? NONE);
      tape.put(viewer.lastKnownOppLevel[target.id] ?? NONE);
      tape.put(seen[viewer.id * TOTAL_SOLDIERS + target.id] ?? NONE);
    }
  }
}

function recordPublicOpinions(t: TacticalState, tape: InputTape, present: readonly Soldier[]): void {
  const p = t.perception;
  for (let team = 0; team < p.publicOpp.length; team++) {
    const opinions = p.publicOpp[team];
    const lastKnown = p.publicLastKnown[team];
    const lastKnownLevel = p.publicLastKnownLevel[team];
    for (const target of present) {
      const opinion = opinions?.[target.id] ?? NONE;
      tape.put(opinion);
      if (opinion === Opp.NOT_HEARD_OR_SEEN) continue;
      tape.put(lastKnown?.[target.id] ?? NONE);
      tape.put(lastKnownLevel?.[target.id] ?? NONE);
    }
  }
}

function recordWatchedLocIncrements(t: TacticalState, tape: InputTape, present: readonly Soldier[]): void {
  const incremented = t.turn.watched.incremented;
  for (const s of present) for (let k = 0; k < NUM_WATCHED_LOCS; k++) tape.put(incremented[s.id * NUM_WATCHED_LOCS + k] ?? NONE);
}

function recordThingsSeen(t: TacticalState, tape: InputTape): void {
  tape.put(t.doorStatus.size);
  for (const [gridNo, door] of t.doorStatus) {
    tape.put(gridNo);
    tape.flag(door.open);
    tape.flag(door.perceivedOpen);
    tape.flag(door.perceivedNotSet);
  }
  tape.put(t.worldItems.length);
  for (const wi of t.worldItems) {
    tape.put(wi.gridNo);
    tape.put(wi.level);
    tape.put(wi.visible);
    tape.put(wi.object.item);
  }
  tape.put(t.corpses.length);
  for (const corpse of t.corpses) tape.ref(corpse);
}

function recordLookInputs(t: TacticalState, tape: InputTape): void {
  const present = t.lookMemo.present;
  recordScene(t, tape);
  recordCaveLights(t, tape);
  recordPerception(t, tape);
  recordSoldiers(t, tape, present);
  recordOpinions(t, tape, present);
  recordPublicOpinions(t, tape, present);
  recordWatchedLocIncrements(t, tape, present);
  recordThingsSeen(t, tape);
}

function outputs(t: TacticalState): readonly number[] | null {
  if (!(t.rng instanceof Rng) || !(t.pre instanceof PreRandom)) return null;
  return [t.events.length, t.gameEvents.length, ...t.rng.state().s, ...t.pre.refillStream().state().s];
}

function sameOutputs(a: readonly number[] | null, b: readonly number[] | null): boolean {
  return a !== null && b !== null && a.length === b.length && a.every((value, k) => value === b[k]);
}

function lookAndWatch(t: TacticalState, look: () => void): boolean {
  const memo = t.lookMemo;
  const before = outputs(t);
  memo.unrepeatable = false;
  memo.radioCallers = [];
  memo.looking = true;
  try {
    look();
  } finally {
    memo.looking = false;
  }
  return !memo.unrepeatable && sameOutputs(before, outputs(t));
}

function replayRadioCallers(t: TacticalState): void {
  for (const s of t.lookMemo.rememberedRadioCallers) t.perception.lastMercToRadio[s.team] = s;
}

function remember(memo: LookMemo): void {
  const remembered = memo.remembered;
  memo.remembered = memo.before;
  memo.before = remembered;
  memo.rememberedRadioCallers = memo.radioCallers;
}

export function lookUnlessUnchanged(t: TacticalState, look: () => void): void {
  const memo = t.lookMemo;
  if (memo.looking) {
    memo.unrepeatable = true;
    look();
    return;
  }
  if (skipping && memo.known && unchangedSinceRemembered(t)) {
    replayRadioCallers(t);
    return;
  }
  memo.before.record();
  recordLookInputs(t, memo.before);
  const quiet = lookAndWatch(t, look);
  memo.after.record();
  recordLookInputs(t, memo.after);
  memo.known = quiet && memo.after.sameAs(memo.before);
  if (memo.known) remember(memo);
}

function unchangedSinceRemembered(t: TacticalState): boolean {
  const remembered = t.lookMemo.remembered;
  remembered.check();
  recordLookInputs(t, remembered);
  return remembered.matched();
}

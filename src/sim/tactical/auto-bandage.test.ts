import { beforeAll, describe, expect, it } from 'vitest';
import { combatStats, newCombatSim, spawnSoldier } from '../../../tests/support/combat.ts';
import { loadTestContent } from '../../../tests/support/tactical.ts';
import { DIRECTION_COUNT, Direction, gridNo, gridSquare } from '../../content/world/grid.ts';
import { TravelCost } from '../../content/world/movement-costs.ts';
import type { SyntheticWorld } from '../../content/world/synthetic.ts';
import { TICK_MS } from '../clock.ts';
import type { CommandResult } from '../command.ts';
import type { SimEvent } from '../events.ts';
import { createItem, emptyObject } from '../items/object.ts';
import { AiAction } from './ai/actions.ts';
import { anim } from './anim-states.ts';
import { isMoving, states } from './animation.ts';
import { shouldBeginAutoBandage, startAutoBandage } from './auto-bandage.ts';
import type { TacticalContent } from './content.ts';
import { InvSlot, NO_SLOT } from './inventory.ts';
import { stopMerc } from './movement.ts';
import { createSoldier, NOBODY, NOWHERE, OKLIFE, type Soldier, Team, Visible } from './soldier.ts';
import type { TacticalState } from './state.ts';
import type { TacticalSim } from './tactical-sim.ts';
import { checkForEndOfBattle, RT_TURN_MS, STRATEGIC_OVERHEAD_MS } from './turns/turns.ts';

let content: TacticalContent;

beforeAll(async () => {
  content = await loadTestContent();
});

const SHADOW = 0;
const SIDNEY = 1;
const IRA = 2;
const IVAN = 3;
const ENEMY = 20;
const CIVILIAN = 30;
const WOUNDED = 60;
const DYING = 10;
const BLEEDING = 5;
const HEAVY_BLEEDING = 20;
const FULL_KIT = 100;
const NEARLY_EMPTY_KIT = 3;
const MAX_FRAMES = 4000;
const SECONDS_PER_FRAME = 5;
const MAX_WARP_SECONDS = 125;
const FRAMES_TO_THE_CAP = MAX_WARP_SECONDS / SECONDS_PER_FRAME;
const FRAMES_BEFORE_AN_EARLY_END = 4;
const IDLE_WAIT_FRAMES = 11_000 / TICK_MS + 1;
const FRAMES_TO_A_TURN = (STRATEGIC_OVERHEAD_MS + TICK_MS) / TICK_MS;
const MEDIC = gridNo(70, 70);
const BESIDE_MEDIC = gridNo(70, 71);
const FAR_FROM_MEDIC = gridNo(70, 80);

const item = (name: string) => content.items.byName.get(name)?.index ?? -1;
const st = () => states(content.animations);

function scene(shape: (world: SyntheticWorld) => void = () => undefined): TacticalSim {
  return newCombatSim(content, [], 3, new Set(), shape);
}

function walledIn(centre: number): (world: SyntheticWorld) => void {
  return (world) => {
    for (const g of gridSquare(centre, 1)) {
      if (g === centre) continue;
      for (let direction = 0; direction < DIRECTION_COUNT; direction++) world.costs.force(g, direction, 0, TravelCost.OBSTACLE);
    }
  };
}

function medic(sim: TacticalSim, id: number, at: number, kitStatus = FULL_KIT): Soldier {
  const s = spawnSoldier(sim, id, Team.OUR, at, Direction.NORTH);
  s.inv[InvSlot.BIGPOCK1] = createItem(content.items, item('FIRSTAIDKIT'), kitStatus);
  return s;
}

function patient(sim: TacticalSim, id: number, at: number, bleeding = BLEEDING): Soldier {
  const s = spawnSoldier(sim, id, Team.OUR, at, Direction.NORTH, { life: WOUNDED });
  s.bleeding = bleeding;
  return s;
}

function civilian(sim: TacticalSim, id: number, at: number): Soldier {
  const s = spawnSoldier(sim, id, Team.CIV, at, Direction.NORTH);
  s.visible = Visible.SEEN;
  s.neutral = true;
  return s;
}

function mercElsewhere(id: number, state: number): Soldier {
  const palettes = { hair: 'BLACKHEAD', skin: 'PINKSKIN', vest: 'BLUEVEST', pants: 'JEANPANTS' };
  const stats = combatStats(70);
  return createSoldier({
    id,
    team: Team.OUR,
    name: `S${id}`,
    bodyType: 0,
    palettes,
    stats,
    life: 80,
    gridNo: NOWHERE,
    direction: 0,
    state,
  });
}

function refusalOf(result: CommandResult): unknown {
  return result.ok ? null : result.data?.refusal;
}

function askAndStart(sim: TacticalSim): void {
  expect(sim.dispatch({ type: 'autoBandage' })).toMatchObject({ ok: true });
  expect(sim.dispatch({ type: 'answer', choice: 'yes' })).toEqual({ ok: true });
  expect(sim.state.pathEnv.autoBandage).toBe(true);
}

function frame(sim: TacticalSim): SimEvent[] {
  sim.step();
  return sim.drainEvents();
}

function framesUntil(sim: TacticalSim, done: () => boolean): SimEvent[] {
  const events: SimEvent[] = [];
  for (let k = 0; k < MAX_FRAMES && !done(); k++) events.push(...frame(sim));
  expect(done()).toBe(true);
  return events;
}

function endNow(sim: TacticalSim): SimEvent[] {
  expect(sim.dispatch({ type: 'endAutoBandage' })).toEqual({ ok: true, data: { ending: true } });
  return frame(sim);
}

function ofType<T extends SimEvent['type']>(events: readonly SimEvent[], type: T): Extract<SimEvent, { type: T }>[] {
  return events.filter((e): e is Extract<SimEvent, { type: T }> => e.type === type);
}

interface HooksHeard {
  started: number;
  readonly warps: number[];
}

function hooksHeard(t: TacticalState): HooksHeard {
  const heard: HooksHeard = { started: 0, warps: [] };
  t.sectorHooks = {
    ...t.sectorHooks,
    autoBandageStarted: () => {
      heard.started++;
    },
    autoBandageEnded: (_t, seconds) => {
      heard.warps.push(seconds);
    },
  };
  return heard;
}

function listOurTeam(t: TacticalState, team: readonly Soldier[]): void {
  t.sectorHooks = { ...t.sectorHooks, ourWholeTeam: () => team };
}

describe('the auto-bandage command (Auto_Bandage.cc BeginAutoBandage)', () => {
  it('refuses in the original’s order: combat or any living hostile, nobody bleeding, no kit, then no medic', () => {
    const sim = scene();
    const t = sim.state;
    const ira = medic(sim, IRA, MEDIC);
    const ask = () => refusalOf(sim.dispatch({ type: 'autoBandage' }));
    const refusals: unknown[] = [];
    t.inCombat = true;
    refusals.push(ask());
    t.inCombat = false;
    const enemy = spawnSoldier(sim, ENEMY, Team.ENEMY, gridNo(100, 100), Direction.NORTH, { life: DYING });
    enemy.collapsed = true;
    refusals.push(ask());
    enemy.life = 0;
    refusals.push(ask());
    const shadow = patient(sim, SHADOW, BESIDE_MEDIC);
    ira.inv[InvSlot.BIGPOCK1] = emptyObject();
    refusals.push(ask());
    shadow.inv[InvSlot.BIGPOCK1] = createItem(content.items, item('FIRSTAIDKIT'), FULL_KIT);
    shadow.stats.medical = 0;
    refusals.push(ask());
    shadow.stats.medical = 30;
    shadow.life = OKLIFE - 1;
    refusals.push(ask());
    expect(refusals).toEqual([
      'sectorNotCleared',
      'sectorNotCleared',
      'nobodyToBandage',
      'noMedKit',
      'cannotAutoBandage',
      'cannotAutoBandage',
    ]);
    expect(t.prompt).toBeNull();
  });

  it('asks with the beginAutoBandage prompt, and no changes nothing', () => {
    const sim = scene();
    const t = sim.state;
    medic(sim, IRA, MEDIC);
    patient(sim, SHADOW, FAR_FROM_MEDIC);
    const before = { mode: structuredClone(t.autoBandage), rng: t.rng.state(), clockMs: t.clockMs };
    const asked = sim.dispatch({ type: 'autoBandage' });
    expect(t.prompt?.kind).toBe('beginAutoBandage');
    expect(asked).toEqual({ ok: true, data: { prompt: t.prompt?.id } });
    expect(sim.hasPendingDecision()).toBe(true);
    expect(refusalOf(sim.dispatch({ type: 'autoBandage' }))).toBe('promptOpen');
    sim.step();
    expect(t.clockMs).toBe(before.clockMs);
    expect(sim.dispatch({ type: 'answer', choice: 'no' })).toEqual({ ok: true });
    expect([t.prompt, t.pathEnv.autoBandage, structuredClone(t.autoBandage), t.rng.state()]).toEqual([
      null,
      false,
      before.mode,
      before.rng,
    ]);
    expect(ofType(sim.drainEvents(), 'autoBandageStarted')).toEqual([]);
  });

  it('is refused with the interface locked, as the key is', () => {
    const sim = scene();
    medic(sim, IRA, MEDIC);
    patient(sim, SHADOW, FAR_FROM_MEDIC);
    sim.state.explosionQueue.active = true;
    expect(refusalOf(sim.dispatch({ type: 'autoBandage' }))).toBe('uiLocked');
  });

  it('refuses every order but endAutoBandage and setOption while the mode runs, and endAutoBandage outside it', () => {
    const sim = scene();
    const ira = medic(sim, IRA, MEDIC);
    patient(sim, SHADOW, FAR_FROM_MEDIC);
    expect(refusalOf(sim.dispatch({ type: 'endAutoBandage' }))).toBe('notAutoBandaging');
    askAndStart(sim);
    const orders = [
      { type: 'move', soldier: IRA, to: gridNo(60, 60) },
      { type: 'autoBandage' },
      { type: 'answer', choice: 'yes' },
      { type: 'stop', soldier: IRA },
    ];
    expect(orders.map((cmd) => refusalOf(sim.dispatch(cmd)))).toEqual(orders.map(() => 'autoBandaging'));
    expect(sim.actRefusal(ira)?.token).toBe('autoBandaging');
    expect(sim.dispatch({ type: 'setOption', bloodAndGore: false })).toMatchObject({ ok: true });
    expect(sim.dispatch({ type: 'endAutoBandage' })).toEqual({ ok: true, data: { ending: true } });
  });
});

function holdTheQuestion(t: TacticalState): { talking: boolean; scripted: boolean } {
  const holds = { talking: false, scripted: false };
  t.narrative = {
    ...t.narrative,
    dialogueQueueIsEmptyAndNobodyIsTalking: () => !holds.talking,
    scriptedSequence: () => holds.scripted,
  };
  return holds;
}

function pendingAndPrompt(t: TacticalState): [boolean, unknown] {
  return [t.autoBandage.pending, t.prompt?.kind ?? null];
}

describe('the question at the end of a battle (Overhead.cc CheckForEndOfBattle, Auto_Bandage.cc ShouldBeginAutoBandage)', () => {
  it('is set pending out of combat, outside the Deidranna endgame and with a medic for a patient', () => {
    const sim = scene();
    const t = sim.state;
    const ira = medic(sim, IRA, MEDIC);
    patient(sim, SHADOW, FAR_FROM_MEDIC);
    const pendingAfter = () => {
      shouldBeginAutoBandage(t);
      return t.autoBandage.pending;
    };
    const asked: boolean[] = [];
    t.inCombat = true;
    asked.push(pendingAfter());
    t.inCombat = false;
    t.sectorHooks = { ...t.sectorHooks, inDeidrannaEndgame: () => true };
    asked.push(pendingAfter());
    t.sectorHooks = { ...t.sectorHooks, inDeidrannaEndgame: () => false };
    ira.stats.medical = 0;
    asked.push(pendingAfter());
    ira.stats.medical = 30;
    asked.push(pendingAfter());
    expect(asked).toEqual([false, false, false, true]);
  });

  it('is set pending by a won battle in both arms, after a fought battle and after one nobody fought', () => {
    const fought = [1, 0].map((enemies) => {
      const sim = scene();
      const t = sim.state;
      medic(sim, IRA, MEDIC);
      patient(sim, SHADOW, FAR_FROM_MEDIC);
      t.turn.enemyInSector = true;
      t.turn.numFoughtInBattle[Team.ENEMY] = enemies;
      expect(checkForEndOfBattle(t)).toBe(true);
      return t.autoBandage.pending;
    });
    expect(fought).toEqual([true, true]);
  });
});

describe('the pending question (Auto_Bandage.cc HandleAutoBandagePending)', () => {
  it('waits for the dialogue, a pending action of ours and the locked interface, then asks once with the same prompt', () => {
    const sim = scene();
    const t = sim.state;
    medic(sim, IRA, MEDIC);
    const shadow = patient(sim, SHADOW, FAR_FROM_MEDIC);
    const holds = holdTheQuestion(t);
    t.autoBandage.pending = true;
    const waited: [boolean, unknown][] = [];
    holds.talking = true;
    frame(sim);
    waited.push(pendingAndPrompt(t));
    holds.talking = false;
    shadow.pendingTalk = IRA;
    frame(sim);
    waited.push(pendingAndPrompt(t));
    shadow.pendingTalk = null;
    holds.scripted = true;
    frame(sim);
    waited.push(pendingAndPrompt(t));
    holds.scripted = false;
    frame(sim);
    waited.push(pendingAndPrompt(t));
    expect(waited).toEqual([
      [true, null],
      [true, null],
      [true, null],
      [false, 'beginAutoBandage'],
    ]);
    expect(sim.dispatch({ type: 'answer', choice: 'yes' })).toEqual({ ok: true });
    expect(t.pathEnv.autoBandage).toBe(true);
  });

  it('waits while a merc of ours still holds the MERC_GIVEITEM of a give on the spot, which outlives the hand-over', () => {
    const sim = scene();
    const t = sim.state;
    medic(sim, IRA, MEDIC);
    const shadow = patient(sim, SHADOW, FAR_FROM_MEDIC);
    t.autoBandage.pending = true;
    shadow.heldGiveAction = { target: IRA, targetGridNo: MEDIC, direction: 0, animCount: 1 };
    frame(sim);
    const waited = pendingAndPrompt(t);
    shadow.heldGiveAction = null;
    frame(sim);
    expect([waited, pendingAndPrompt(t)]).toEqual([
      [true, null],
      [false, 'beginAutoBandage'],
    ]);
  });

  it('waits while a merc of ours in the loaded sector keeps the pending action of a native save, until he stops (Auto_Bandage.cc:151-160)', () => {
    const MERC_PICKUPITEM = 2;
    const sim = scene();
    const t = sim.state;
    medic(sim, IRA, MEDIC);
    const shadow = patient(sim, SHADOW, FAR_FROM_MEDIC);
    t.autoBandage.pending = true;
    shadow.savedPendingAction = { action: MERC_PICKUPITEM, giveTarget: NOBODY, data3: 0, animCount: 1 };
    frame(sim);
    const waited = pendingAndPrompt(t);
    stopMerc(t, shadow);
    frame(sim);
    expect([waited, shadow.savedPendingAction, pendingAndPrompt(t)]).toEqual([[true, null], null, [false, 'beginAutoBandage']]);
  });

  it("waits while a seat of a helicopter drop under way keeps a native save's pending action, though the seat is not on the map yet (Auto_Bandage.cc:151-160)", () => {
    const MERC_PICKUPITEM = 2;
    const SEAT_ID = 4;
    const sim = scene();
    const t = sim.state;
    medic(sim, IRA, MEDIC);
    patient(sim, SHADOW, FAR_FROM_MEDIC);
    const seat = mercElsewhere(SEAT_ID, st().STANDING);
    seat.savedPendingAction = { action: MERC_PICKUPITEM, giveTarget: NOBODY, data3: 0, animCount: 1 };
    t.sectorHooks = { ...t.sectorHooks, helicopterSeat: (_t, id) => (id === SEAT_ID ? seat : null) };
    t.helicopterDrop.seats.push(SEAT_ID);
    t.autoBandage.pending = true;
    frame(sim);
    const waited = pendingAndPrompt(t);
    seat.savedPendingAction = null;
    frame(sim);
    expect([t.soldiers[SEAT_ID], waited, pendingAndPrompt(t)]).toEqual([undefined, [true, null], [false, 'beginAutoBandage']]);
  });

  it('checks everything again when it asks, so a changed sector gives the refusal instead and clears the flag (quirk)', () => {
    const sim = scene();
    const t = sim.state;
    medic(sim, IRA, MEDIC);
    const shadow = patient(sim, SHADOW, FAR_FROM_MEDIC);
    t.autoBandage.pending = true;
    shadow.bleeding = 0;
    const events = frame(sim);
    expect(ofType(events, 'autoBandageRefused')).toMatchObject([{ refusal: 'nobodyToBandage' }]);
    expect(pendingAndPrompt(t)).toEqual([false, null]);
    expect(ofType(frame(sim), 'autoBandageRefused')).toEqual([]);
  });
});

describe('the start of the mode (Auto_Bandage.cc AutoBandage(TRUE), SetUpAutoBandageUpdatePanel)', () => {
  it('lists the medics and the patients in team order, a bleeding medic on both lists, refilling the shared lists', () => {
    const sim = scene();
    const t = sim.state;
    const lists = [t.autoBandage.medics, t.autoBandage.patients];
    medic(sim, IRA, MEDIC);
    const sidney = medic(sim, SIDNEY, gridNo(80, 80));
    sidney.bleeding = BLEEDING;
    patient(sim, SHADOW, FAR_FROM_MEDIC);
    askAndStart(sim);
    expect([t.autoBandage.medics, t.autoBandage.patients]).toEqual([
      [SIDNEY, IRA],
      [SHADOW, SIDNEY],
    ]);
    expect([t.autoBandage.medics, t.autoBandage.patients]).toEqual(lists);
    expect(t.autoBandage.medics).toBe(lists[0]);
    expect(ofType(sim.drainEvents(), 'autoBandageStarted')).toMatchObject([{ medics: [SIDNEY, IRA], patients: [SHADOW, SIDNEY] }]);
  });

  it('empties both lists when one of them is empty', () => {
    const sim = scene();
    const t = sim.state;
    patient(sim, SHADOW, FAR_FROM_MEDIC);
    t.autoBandage.medics.push(IRA);
    startAutoBandage(t);
    expect([t.autoBandage.medics, t.autoBandage.patients, t.pathEnv.autoBandage]).toEqual([[], [], true]);
  });

  it('clears the failure and every merc’s kit pocket and medic, off the map too, but keeps the full check’s pointer', () => {
    const sim = scene();
    const t = sim.state;
    const ira = medic(sim, IRA, MEDIC);
    const shadow = patient(sim, SHADOW, FAR_FROM_MEDIC);
    const ivan = mercElsewhere(IVAN, st().STANDING);
    listOurTeam(t, [shadow, ira, ivan]);
    for (const s of [shadow, ira, ivan]) Object.assign(s, { slotItemTakenFrom: InvSlot.BIGPOCK3, autoBandagingMedic: IRA });
    Object.assign(t.autoBandage, { failed: true, fullCheckSoldier: SHADOW, complete: true });
    startAutoBandage(t);
    expect([shadow, ira, ivan].map((s) => [s.slotItemTakenFrom, s.autoBandagingMedic])).toEqual([
      [NO_SLOT, NOBODY],
      [NO_SLOT, NOBODY],
      [NO_SLOT, NOBODY],
    ]);
    expect([t.autoBandage.failed, t.autoBandage.complete, t.autoBandage.fullCheckSoldier]).toEqual([false, false, SHADOW]);
  });

  it('runs the real-time turn left over from combat before the mode, so it bleeds the wounded as outside it', () => {
    const sim = scene();
    const t = sim.state;
    medic(sim, IRA, MEDIC);
    const shadow = patient(sim, SHADOW, FAR_FROM_MEDIC, HEAVY_BLEEDING);
    shadow.nextBleed = 0.5;
    t.clockMs += RT_TURN_MS;
    t.turn.forceRealtimeTurn = true;
    startAutoBandage(t);
    expect([t.turn.forceRealtimeTurn, t.realtimeClock.lastTurnMs, shadow.life]).toEqual([false, t.clockMs, WOUNDED - 1]);
  });

  it('starts every soldier in the sector animating at the loop rate, and the end gives them their delays back', () => {
    const sim = scene();
    const civ = civilian(sim, CIVILIAN, gridNo(90, 90));
    medic(sim, IRA, MEDIC);
    patient(sim, SHADOW, FAR_FROM_MEDIC);
    const delay = civ.aniDelay;
    expect(delay).toBeGreaterThan(0);
    askAndStart(sim);
    expect(civ.aniDelay).toBe(0);
    endNow(sim);
    expect(civ.aniDelay).toBe(delay);
  });
});

describe('the frame of the mode (Auto_Bandage.cc HandleAutoBandage)', () => {
  it('counts 5 s a frame up to 125 and warps that much at the end, through the sector hooks', () => {
    const sim = scene();
    const t = sim.state;
    medic(sim, IRA, MEDIC);
    patient(sim, SHADOW, FAR_FROM_MEDIC);
    const heard = hooksHeard(t);
    askAndStart(sim);
    expect(heard.started).toBe(1);
    const counted: number[] = [];
    for (let k = 0; k <= FRAMES_TO_THE_CAP; k++) {
      frame(sim);
      counted.push(t.autoBandage.seconds);
    }
    expect(counted.slice(0, 2)).toEqual([SECONDS_PER_FRAME, 2 * SECONDS_PER_FRAME]);
    expect(counted.slice(-2)).toEqual([MAX_WARP_SECONDS, MAX_WARP_SECONDS]);
    const ended = ofType(endNow(sim), 'autoBandageEnded');
    expect([heard, ended]).toEqual([
      { started: 1, warps: [MAX_WARP_SECONDS] },
      [expect.objectContaining({ worldSecondsWarped: MAX_WARP_SECONDS })],
    ]);
    expect(t.autoBandage.seconds).toBe(0);
  });

  it('warps 5 s for every frame of an early end, the frame of the end included', () => {
    const sim = scene();
    const t = sim.state;
    medic(sim, IRA, MEDIC);
    patient(sim, SHADOW, FAR_FROM_MEDIC);
    const heard = hooksHeard(t);
    askAndStart(sim);
    for (let k = 0; k < FRAMES_BEFORE_AN_EARLY_END; k++) frame(sim);
    endNow(sim);
    expect(heard.warps).toEqual([(FRAMES_BEFORE_AN_EARLY_END + 1) * SECONDS_PER_FRAME]);
  });

  it('ends at the end of the next frame, which runs in full', () => {
    const sim = scene();
    const t = sim.state;
    const ira = medic(sim, IRA, MEDIC);
    const shadow = patient(sim, SHADOW, BESIDE_MEDIC, HEAVY_BLEEDING);
    askAndStart(sim);
    framesUntil(sim, () => ira.state === anim(content, 'GIVING_AID'));
    const before = { clockMs: t.clockMs, bleeding: shadow.bleeding };
    expect(sim.dispatch({ type: 'endAutoBandage' })).toMatchObject({ ok: true });
    expect([t.pathEnv.autoBandage, t.autoBandage.endRequested, t.clockMs]).toEqual([true, true, before.clockMs]);
    const events = frame(sim);
    expect(events.map((e) => e.type).filter((type) => type === 'bandaged' || type === 'autoBandageEnded')).toEqual([
      'bandaged',
      'autoBandageEnded',
    ]);
    expect(shadow.bleeding).toBeLessThan(before.bleeding);
    expect([t.pathEnv.autoBandage, t.autoBandage.endRequested, t.clockMs]).toEqual([false, false, before.clockMs + TICK_MS]);
  });

  it('dresses the patient at every frame of the aid', () => {
    const sim = scene();
    const ira = medic(sim, IRA, MEDIC);
    const shadow = patient(sim, SHADOW, BESIDE_MEDIC, HEAVY_BLEEDING);
    askAndStart(sim);
    framesUntil(sim, () => ira.state === anim(content, 'GIVING_AID'));
    const dressingsPerFrame: number[] = [];
    while (shadow.bleeding > 0 && dressingsPerFrame.length < MAX_FRAMES) dressingsPerFrame.push(ofType(frame(sim), 'bandaged').length);
    expect(dressingsPerFrame.length).toBeGreaterThan(1);
    expect(new Set(dressingsPerFrame)).toEqual(new Set([1]));
  });

  it('completes once everybody is bandaged, telling it once, and is idle from then on', () => {
    const sim = scene();
    const ira = medic(sim, IRA, MEDIC);
    const shadow = patient(sim, SHADOW, BESIDE_MEDIC, HEAVY_BLEEDING);
    askAndStart(sim);
    expect(sim.isIdle()).toBe(false);
    const events = framesUntil(sim, () => sim.state.autoBandage.complete);
    expect([shadow.bleeding, ira.servicePartner, sim.isIdle()]).toEqual([0, NOBODY, true]);
    for (let k = 0; k < FRAMES_TO_THE_CAP; k++) events.push(...frame(sim));
    expect(ofType(events, 'autoBandageComplete')).toHaveLength(1);
    expect([sim.state.pathEnv.autoBandage, sim.isIdle()]).toEqual([true, true]);
  });

  it('completes silently when the kits run out with a patient still bleeding', () => {
    const sim = scene();
    medic(sim, IRA, MEDIC, NEARLY_EMPTY_KIT);
    const shadow = patient(sim, SHADOW, BESIDE_MEDIC, HEAVY_BLEEDING);
    askAndStart(sim);
    framesUntil(sim, () => sim.state.autoBandage.complete);
    expect([shadow.bleeding > 0, sim.state.autoBandage.failed]).toEqual([true, false]);
    expect(ofType(endNow(sim), 'autoBandageEnded')).toMatchObject([{ failed: false }]);
  });

  it('completes with the failure when the full check finds a patient no medic reaches, and the end reports it once', () => {
    const shadowAt = gridNo(80, 90);
    const sim = scene(walledIn(shadowAt));
    const t = sim.state;
    medic(sim, IRA, MEDIC);
    patient(sim, SHADOW, shadowAt);
    askAndStart(sim);
    framesUntil(sim, () => t.autoBandage.complete);
    expect(t.autoBandage.failed).toBe(true);
    expect(ofType(endNow(sim), 'autoBandageEnded')).toMatchObject([{ failed: true }]);
    expect(t.autoBandage.failed).toBe(false);
  });

  it('runs on after completion, its AI deciding and drawing, until the end', () => {
    const sim = scene();
    const t = sim.state;
    medic(sim, IRA, MEDIC);
    const shadow = patient(sim, SHADOW, BESIDE_MEDIC);
    const ivan = spawnSoldier(sim, IVAN, Team.OUR, gridNo(90, 90), Direction.NORTH);
    askAndStart(sim);
    framesUntil(sim, () => t.autoBandage.complete);
    expect(shadow.bleeding).toBe(0);
    const completedAt = { rng: t.rng.state(), counter: ivan.ai.counter };
    for (let k = 0; k < IDLE_WAIT_FRAMES; k++) frame(sim);
    expect([t.pathEnv.autoBandage, sim.isIdle(), ivan.ai.counter > completedAt.counter]).toEqual([true, true, true]);
    expect(t.rng.state()).not.toEqual(completedAt.rng);
  });

  it('stops the real-time turn while the mode runs, so the first one after it comes at once', () => {
    const sim = scene();
    const t = sim.state;
    medic(sim, IRA, MEDIC);
    patient(sim, SHADOW, FAR_FROM_MEDIC);
    askAndStart(sim);
    const lastTurn = t.realtimeClock.lastTurnMs;
    for (let k = 0; k < 2 * (RT_TURN_MS / TICK_MS); k++) frame(sim);
    expect(t.realtimeClock.lastTurnMs).toBe(lastTurn);
    endNow(sim);
    for (let k = 0; k < FRAMES_TO_A_TURN; k++) sim.step();
    expect(t.realtimeClock.lastTurnMs).toBeGreaterThan(lastTurn);
  });
});

describe('the end of the mode (Auto_Bandage.cc AutoBandage(FALSE))', () => {
  it('stands up every merc of ours, off the map too, and leaves a medic stood up mid-dressing paired with his patient', () => {
    const sim = scene();
    const t = sim.state;
    const ira = medic(sim, IRA, MEDIC);
    const sidney = patient(sim, SIDNEY, BESIDE_MEDIC, HEAVY_BLEEDING);
    sidney.state = st().CROUCHING;
    const shadow = mercElsewhere(SHADOW, st().CROUCHING);
    listOurTeam(t, [shadow, sidney, ira]);
    askAndStart(sim);
    framesUntil(sim, () => ira.state === anim(content, 'GIVING_AID'));
    endNow(sim);
    expect([shadow.state, shadow.gridNo, shadow.placed]).toEqual([st().KNEEL_UP, NOWHERE, false]);
    expect([sidney.state, ira.state]).toEqual([st().KNEEL_UP, st().KNEEL_UP]);
    expect([ira.servicePartner, sidney.serviceCount, ira.ai.action]).toEqual([SIDNEY, 1, AiAction.NONE]);
  });

  it('stops a medic walking to his patient on the tile he stands on', () => {
    const sim = scene();
    const t = sim.state;
    const ira = medic(sim, IRA, MEDIC);
    patient(sim, SHADOW, FAR_FROM_MEDIC);
    askAndStart(sim);
    framesUntil(sim, () => ira.gridNo !== MEDIC && isMoving(content, ira.state));
    endNow(sim);
    expect([isMoving(content, ira.state), ira.finalDestination, ira.ai.action, t.pathEnv.autoBandage]).toEqual([
      false,
      ira.gridNo,
      AiAction.NONE,
      false,
    ]);
    expect(ira.gridNo).not.toBe(FAR_FROM_MEDIC);
  });

  it('leaves the dying and the collapsed down', () => {
    const sim = scene();
    medic(sim, IRA, MEDIC);
    const shadow = patient(sim, SHADOW, FAR_FROM_MEDIC);
    const ivan = spawnSoldier(sim, IVAN, Team.OUR, gridNo(90, 90), Direction.NORTH, { life: DYING });
    for (const s of [shadow, ivan]) s.state = st().CROUCHING;
    shadow.collapsed = true;
    askAndStart(sim);
    endNow(sim);
    expect([shadow.state, ivan.state]).toEqual([st().CROUCHING, st().CROUCHING]);
  });
});

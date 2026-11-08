import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { combatStats } from '../../../tests/support/combat.ts';
import { loadStubSectorKit, type StubSectorKit } from '../../../tests/support/sectors.ts';
import { Direction } from '../../content/world/grid.ts';
import { msForTicks } from '../clock.ts';
import type { SimEvent } from '../events.ts';
import { restoreTactical, snapshotJson, snapshotTactical } from '../snapshot/session.ts';
import { anim } from './anim-states.ts';
import { states } from './animation.ts';
import { soldierCollapse } from './combat/hit.ts';
import { addMercToHeli, HELI_SCRIPT_STEP_MS, helicopterDropStalled, skipHelicopterDrop, startHelicopterRun } from './helicopter-drop.ts';
import { type HelicopterDrop, HeliState, helicopterDropView } from './helicopter-drop-state.ts';
import { playerInterfaceLocked } from './interface-lock.ts';
import { NO_NARRATIVE_PORT } from './narrative/port.ts';
import { cellCentre, createSoldier, NOWHERE, type Soldier, Team } from './soldier.ts';
import { sectorMapOf, type TacticalState } from './state.ts';
import { TacticalSim } from './tactical-sim.ts';

const A9 = 'stubs/world/maps/a9.dat';
const STEP_TICKS = 21;
const FIRST_STEP_TICK = 22;
const SCRIPT_STEPS = 30;
const FADE_STEPS = 26;
const HIGHVOLUME = 127;
const SEATS_PER_ROUND = 6;
const BUDGET = 40_000;
const SQUAD = 3;

let kit: StubSectorKit;

beforeAll(async () => {
  kit = await loadStubSectorKit();
});

afterAll(async () => {
  await kit.dispose();
});

interface Scene {
  sim: TacticalSim;
  readonly seats: Soldier[];
  readonly log: string[];
}

function seatSoldier(t: TacticalState, id: number): Soldier {
  const s = createSoldier({
    id,
    team: Team.OUR,
    name: `M${id}`,
    bodyType: 0,
    palettes: { hair: 'BLACKHEAD', skin: 'PINKSKIN', vest: 'BLUEVEST', pants: 'JEANPANTS' },
    stats: combatStats(70),
    life: 80,
    gridNo: NOWHERE,
    direction: Direction.NORTH,
    state: states(t.content.animations).STANDING,
  });
  t.soldiers[id] = s;
  addMercToHeli(t.helicopterDrop, id);
  return s;
}

function recordCampaignEffects(scene: Scene): void {
  const t = scene.sim.state;
  t.sectorHooks = {
    ...t.sectorHooks,
    mercArrivesQuotes: (state, s) =>
      scene.log.push(`quotes ${s.id} facing ${s.direction} path ${s.pathSize} engaged ${state.helicopterDrop.engagedInDrop}`),
    helicopterRunEnded: () => scene.log.push('ended'),
  };
  let current = 0;
  t.narrative = {
    ...NO_NARRATIVE_PORT,
    assignment: () => SQUAD,
    currentSquad: () => current,
    changeCurrentSquad: (squad) => {
      current = squad;
      scene.log.push(`squad ${squad}`);
    },
    squadMembers: (squad) => (squad === SQUAD ? scene.seats.filter((s) => s.placed) : []),
  };
}

function dropScene(count: number, recorded = true): Scene {
  const sim = new TacticalSim(kit.world(A9), kit.content, 7);
  const t = sim.state;
  const scene: Scene = { sim, seats: [], log: [] };
  for (let id = 0; id < count; id++) scene.seats.push(seatSoldier(t, id));
  if (recorded) recordCampaignEffects(scene);
  expect(startHelicopterRun(t, northEntry(t))).toBe(true);
  return scene;
}

function northEntry(t: TacticalState): number {
  return sectorMapOf(t).info.northGridNo;
}

function drop(scene: Scene): HelicopterDrop {
  return scene.sim.state.helicopterDrop;
}

function stepUntil(scene: Scene, done: () => boolean, budget = BUDGET): number {
  for (let ticks = 1; ticks <= budget; ticks++) {
    scene.sim.step();
    if (done()) return ticks;
  }
  throw new Error('the drop did not get there');
}

function stepTicks(scene: Scene, ticks: number): void {
  for (let k = 0; k < ticks; k++) scene.sim.step();
}

function inHelidrop(t: TacticalState, s: Soldier): boolean {
  return s.state === anim(t.content, 'HELIDROP');
}

function dropped(events: readonly SimEvent[]): number[] {
  return events.flatMap((e) => (e.type === 'mercDropped' ? [e.soldier] : []));
}

describe('the helicopter drop (Merc_Entering.cc HandleHeliDrop)', () => {
  it('steps its script once more than 100 ms have passed since the last step, the start arming the first (ME_SCRIPT_DELAY)', () => {
    const scene = dropScene(1);
    const steps: number[] = [];
    for (let tick = 1; tick <= 90; tick++) {
      const before = drop(scene).lastStepMs;
      scene.sim.step();
      if (drop(scene).lastStepMs !== before) steps.push(tick);
    }
    expect(steps).toEqual([
      FIRST_STEP_TICK,
      FIRST_STEP_TICK + STEP_TICKS,
      FIRST_STEP_TICK + 2 * STEP_TICKS,
      FIRST_STEP_TICK + 3 * STEP_TICKS,
    ]);
    expect(drop(scene).script).toBe(steps.length);
    expect(msForTicks(STEP_TICKS)).toBe(HELI_SCRIPT_STEP_MS);
  });

  it('fades the engine in over 26 steps from silence and out over 26 more after the exit script, the silence ending the drop', () => {
    const scene = dropScene(1);
    const volumes: number[] = [];
    let previous = 0;
    for (let tick = 0; drop(scene).fadingIn && tick < BUDGET; tick++) {
      scene.sim.step();
      if (drop(scene).volume !== previous) volumes.push(drop(scene).volume);
      previous = drop(scene).volume;
    }
    expect(volumes).toHaveLength(FADE_STEPS);
    expect(volumes.at(-1)).toBe(HIGHVOLUME);
    const fadeOut = stepUntil(scene, () => drop(scene).fadingOut);
    expect(drop(scene)).toMatchObject({ state: HeliState.EXIT, script: SCRIPT_STEPS, volume: HIGHVOLUME });
    expect(stepUntil(scene, () => !drop(scene).running)).toBe(FADE_STEPS * STEP_TICKS);
    expect(fadeOut).toBeGreaterThan(0);
    expect(drop(scene)).toMatchObject({ volume: 0, fadingOut: false, seats: [] });
    expect(scene.log.filter((line) => line === 'ended')).toHaveLength(1);
  });

  it('drops one seat at a time at the north entry in HELIDROP, the next only once the one before reached code 467 and started his walk away', () => {
    const scene = dropScene(3);
    const t = scene.sim.state;
    const landed: number[] = [];
    for (const [k, s] of scene.seats.entries()) {
      stepUntil(scene, () => s.placed);
      expect(inHelidrop(t, s)).toBe(true);
      expect(drop(scene)).toMatchObject({ state: HeliState.DROP, curDrop: k + 1, engagedInDrop: true });
      const before = scene.seats[k - 1];
      if (before) expect([inHelidrop(t, before), before.pathSize > 0 || before.gridNo !== landed[k - 1]]).toEqual([false, true]);
      landed.push(s.gridNo);
      for (const later of scene.seats.slice(k + 1)) expect(later.placed).toBe(false);
    }
    const north = northEntry(t);
    expect([landed[0], landed[1] !== north, landed[2]]).toEqual([north, true, north]);
    stepUntil(scene, () => !drop(scene).running);
    for (const s of scene.seats) expect(s.gridNo).not.toBe(landed[scene.seats.indexOf(s)]);
  });

  it('tells its start at the sweet spot, the north entry the game screen centres on, and each merc it drops as he lands (GameScreen.cc:352, Merc_Entering.cc:607)', () => {
    const scene = dropScene(2);
    const t = scene.sim.state;
    const [first, second] = scene.seats as [Soldier, Soldier];
    expect(scene.sim.drainEvents()).toEqual([{ type: 'helicopterDropStarted', gridNo: northEntry(t), tick: 0 }]);
    stepUntil(scene, () => first.placed);
    expect(dropped(scene.sim.drainEvents())).toEqual([0]);
    stepUntil(scene, () => second.placed);
    expect(dropped(scene.sim.drainEvents())).toEqual([1]);
  });

  it('shows the player the run, its engine volume and its shadow, and nothing once it has left (the view of a drop)', () => {
    const scene = dropScene(1);
    const t = scene.sim.state;
    expect(helicopterDropView(t)).toEqual({ running: true, engineVolume: 0, shadows: [] });
    stepUntil(scene, () => drop(scene).shadow !== null);
    const shadow = drop(scene).shadow;
    expect(helicopterDropView(t)).toEqual({ running: true, engineVolume: HIGHVOLUME, shadows: [shadow] });
    expect(helicopterDropView(t)?.shadows[0]).not.toBe(shadow);
    stepUntil(scene, () => !drop(scene).running);
    expect(helicopterDropView(t)).toBeNull();
  });

  it('keeps HELIDROP through the placement instead of the arrival stance (Soldier_Add.cc AddSoldierToSectorGridNo)', () => {
    const scene = dropScene(1);
    const [s] = scene.seats as [Soldier];
    stepUntil(scene, () => s.placed);
    expect([s.state, s.pc]).toEqual([anim(scene.sim.state.content, 'HELIDROP'), 1]);
  });

  it('turns a merc east at code 467, frees the drop and says his arrival lines before he walks off', () => {
    const scene = dropScene(1);
    const [s] = scene.seats as [Soldier];
    stepUntil(scene, () => !drop(scene).engagedInDrop && s.placed);
    expect(scene.log.filter((line) => line.startsWith('quotes'))).toEqual([`quotes 0 facing ${Direction.EAST} path 0 engaged false`]);
    expect([s.state, s.pendingAnimation, s.pathSize]).toEqual([
      states(scene.sim.state.content.animations).KNEEL_UP,
      states(scene.sim.state.content.animations).WALKING,
      1,
    ]);
  });

  it('makes the first merc down’s squad current, forced, and selects the first seat at the exit script', () => {
    const scene = dropScene(2);
    const t = scene.sim.state;
    const [first] = scene.seats as [Soldier];
    stepUntil(scene, () => first.placed);
    expect(scene.log).toEqual([`squad ${SQUAD}`]);
    expect(t.turn.selected).toBe(first.id);
    t.turn.selected = -1;
    stepUntil(scene, () => drop(scene).state === HeliState.EXIT);
    expect(t.turn.selected).toBe(first.id);
  });

  it('shows its shadow two tiles west and ten north of the sweet spot at MOVETO, flies it south and down to the hover, and takes it away at the exit', () => {
    const scene = dropScene(1);
    const t = scene.sim.state;
    const centre = cellCentre(northEntry(t));
    stepUntil(scene, () => drop(scene).state === HeliState.MOVETO);
    expect(drop(scene).shadow).toBeNull();
    stepUntil(scene, () => drop(scene).shadow !== null);
    expect(drop(scene).shadow).toEqual({ gridNo: northEntry(t), x: centre.x - 20, y: centre.y - 100, z: 0 });
    stepUntil(scene, () => drop(scene).state === HeliState.DROP);
    expect(drop(scene).shadow).toMatchObject({ y: centre.y - 100 + 28 * 4, z: -29 });
    expect(drop(scene).z).toBe(-29.25);
    stepUntil(scene, () => drop(scene).state === HeliState.EXIT);
    expect(drop(scene).shadow).toBeNull();
  });

  it('flies MOVEAWAY once, with no repeat at the reference 640x480 (REPEAT_HELI_MOVEAWAY is STD_SCREEN_X / 7 = 0)', () => {
    const scene = dropScene(1);
    const centre = cellCentre(northEntry(scene.sim.state));
    const moveAway = stepUntil(scene, () => drop(scene).state === HeliState.MOVEAWAY);
    let lastY = 0;
    const exit = stepUntil(scene, () => {
      if (drop(scene).shadow) lastY = drop(scene).shadow?.y ?? 0;
      return drop(scene).state === HeliState.EXIT;
    });
    expect(exit).toBe(SCRIPT_STEPS * STEP_TICKS);
    expect(moveAway).toBeGreaterThan(0);
    expect([drop(scene).moveAwayRepeated, lastY]).toEqual([0, centre.y - 100 + 28 * 4 + 29 * 6]);
  });

  it('drops six seats a round and flies the next round from APPROACH for the rest, with no second fade-in', () => {
    const scene = dropScene(8);
    stepUntil(scene, () => drop(scene).round === 2);
    expect(drop(scene)).toMatchObject({
      curDrop: SEATS_PER_ROUND,
      state: HeliState.APPROACH,
      shadow: null,
      fadingIn: false,
      volume: HIGHVOLUME,
    });
    expect(scene.seats.map((s) => s.placed)).toEqual([true, true, true, true, true, true, false, false]);
    stepUntil(scene, () => !drop(scene).running);
    expect([drop(scene).round, drop(scene).curDrop, scene.seats.every((s) => s.placed)]).toEqual([2, 8, true]);
  });

  it('starts a later round one step into APPROACH, so it lasts 29 steps, not 30 (GOTO_EXIT resets the script to 0 before the step’s increment)', () => {
    const scene = dropScene(8);
    const firstMoveTo = stepUntil(scene, () => drop(scene).state === HeliState.MOVETO);
    expect(firstMoveTo).toBe(FIRST_STEP_TICK + (SCRIPT_STEPS - 1) * STEP_TICKS);
    stepUntil(scene, () => drop(scene).round === 2);
    expect(drop(scene).script).toBe(1);
    expect(stepUntil(scene, () => drop(scene).state === HeliState.MOVETO)).toBe((SCRIPT_STEPS - 1) * STEP_TICKS);
  });

  it('locks the interface, refuses orders and holds the sim busy while it runs, and lets go at its end', () => {
    const scene = dropScene(1);
    const t = scene.sim.state;
    expect([playerInterfaceLocked(t), scene.sim.isIdle()]).toEqual([true, false]);
    expect(scene.sim.dispatch({ type: 'select', soldier: 0 })).toMatchObject({ ok: false, data: { refusal: 'uiLocked' } });
    stepUntil(scene, () => !drop(scene).running);
    expect([playerInterfaceLocked(t), scene.sim.isIdle()]).toEqual([false, true]);
  });

  it('stalls in DROP when the merc it dropped leaves HELIDROP before code 467, only the skip ending it (gfIngagedInDrop)', () => {
    const scene = dropScene(2);
    const t = scene.sim.state;
    const [first, second] = scene.seats as [Soldier, Soldier];
    stepUntil(scene, () => first.placed);
    expect(helicopterDropStalled(t)).toBe(false);
    soldierCollapse(t, first);
    expect(inHelidrop(t, first)).toBe(false);
    stepTicks(scene, 5_000);
    expect(drop(scene)).toMatchObject({ running: true, state: HeliState.DROP, curDrop: 1, engagedInDrop: true });
    expect([helicopterDropStalled(t), scene.sim.isIdle(), second.placed]).toEqual([true, true, false]);
    expect(skipHelicopterDrop(t)).toBe(true);
    expect([drop(scene).running, second.placed, drop(scene).engagedInDrop]).toEqual([false, true, true]);
  });

  it('stays engaged after a stall and its skip, so the next run hovers in DROP before its first merc until skipped again (only code 467 clears gfIngagedInDrop)', () => {
    const scene = dropScene(1);
    const t = scene.sim.state;
    const [first] = scene.seats as [Soldier];
    stepUntil(scene, () => first.placed);
    soldierCollapse(t, first);
    skipHelicopterDrop(t);
    const later = seatSoldier(t, 1);
    expect(startHelicopterRun(t, northEntry(t))).toBe(true);
    stepUntil(scene, () => drop(scene).state === HeliState.DROP);
    stepTicks(scene, 5_000);
    expect([drop(scene).state, drop(scene).curDrop, later.placed, helicopterDropStalled(t)]).toEqual([HeliState.DROP, 0, false, true]);
    skipHelicopterDrop(t);
    expect(later.placed).toBe(true);
  });
});

describe('the Esc skip of the helicopter drop (Merc_Entering.cc HandleHeliDrop, _KeyDown(SDLK_ESCAPE))', () => {
  it('lands every seat at once at a sweet spot during APPROACH, standing with no walk, says their lines, selects the first seat and ends the run', () => {
    const scene = dropScene(3);
    const t = scene.sim.state;
    stepTicks(scene, 300);
    expect(skipHelicopterDrop(t)).toBe(true);
    const standing = states(t.content.animations).STANDING;
    expect(scene.seats.map((s) => [s.placed, s.state, s.pathSize])).toEqual(scene.seats.map(() => [true, standing, 0]));
    expect(new Set(scene.seats.map((s) => s.gridNo)).size).toBe(3);
    expect(scene.log.filter((line) => line.startsWith('quotes')).map((line) => line.split(' ')[1])).toEqual(['0', '1', '2']);
    expect(scene.log.at(-1)).toBe('ended');
    expect(t.turn.selected).toBe(0);
    expect(drop(scene)).toMatchObject({ running: false, seats: [], shadow: null });
    expect(playerInterfaceLocked(t)).toBe(false);
  });

  it('tells each merc it lands, after his lines, as the merc in mid-drop was told at his drop (MERC_HAS_ARRIVED_STR, Merc_Entering.cc:475, :607)', () => {
    const scene = dropScene(3);
    const t = scene.sim.state;
    const [first] = scene.seats as [Soldier];
    stepUntil(scene, () => first.placed);
    expect(dropped(scene.sim.drainEvents())).toEqual([0]);
    stepTicks(scene, 50);
    skipHelicopterDrop(t);
    expect(dropped(scene.sim.drainEvents())).toEqual([1, 2]);
  });

  it('lets the merc in mid-drop finish his HELIDROP and walk away at code 467 while the seats left land at once', () => {
    const scene = dropScene(3);
    const t = scene.sim.state;
    const [first, second, third] = scene.seats as [Soldier, Soldier, Soldier];
    stepUntil(scene, () => first.placed);
    stepTicks(scene, 50);
    skipHelicopterDrop(t);
    expect([inHelidrop(t, first), inHelidrop(t, second), inHelidrop(t, third)]).toEqual([true, false, false]);
    stepUntil(scene, () => !drop(scene).engagedInDrop);
    expect([first.direction, first.pathSize]).toEqual([Direction.EAST, 1]);
    expect(scene.log.filter((line) => line.startsWith('quotes')).map((line) => line.split(' ')[1])).toEqual(['1', '2', '0']);
  });

  it('leaves the fade flags set, so after a skip in the fade-out the next run fades in and straight out, ending in MOVETO before its seat drops, the seat forgotten and the shadow left behind', () => {
    const scene = dropScene(1);
    const t = scene.sim.state;
    stepUntil(scene, () => drop(scene).fadingOut);
    stepTicks(scene, 5 * STEP_TICKS);
    skipHelicopterDrop(t);
    expect([drop(scene).running, drop(scene).fadingOut]).toEqual([false, true]);
    const later = seatSoldier(t, 1);
    startHelicopterRun(t, northEntry(t));
    expect(stepUntil(scene, () => !drop(scene).running)).toBe(FIRST_STEP_TICK + (2 * FADE_STEPS - 1) * STEP_TICKS);
    expect(drop(scene)).toMatchObject({ state: HeliState.MOVETO, curDrop: 0, seats: [], fadingIn: false, fadingOut: false });
    expect(drop(scene).shadow).not.toBeNull();
    expect(later.placed).toBe(false);
    expect(helicopterDropView(t)).toEqual({ running: false, engineVolume: 0, shadows: [drop(scene).shadow] });
  });

  it('does nothing outside a run', () => {
    const scene = dropScene(1);
    const t = scene.sim.state;
    skipHelicopterDrop(t);
    scene.log.length = 0;
    expect(skipHelicopterDrop(t)).toBe(false);
    expect(scene.log).toEqual([]);
  });
});

describe('a snapshot of the helicopter drop', () => {
  function run(reloadEvery: number | null): string {
    const scene = dropScene(3, false);
    for (let tick = 1; drop(scene).running && tick <= BUDGET; tick++) {
      scene.sim.step();
      if (reloadEvery === null || tick % reloadEvery !== 0) continue;
      const json = snapshotJson(snapshotTactical(scene.sim, { content: scene.sim.state.content }));
      scene.sim = restoreTactical(JSON.parse(json), { content: { content: kit.content }, world: () => kit.world(A9) });
    }
    stepTicks(scene, 600);
    return snapshotJson(snapshotTactical(scene.sim, { content: scene.sim.state.content }));
  }

  it('restores mid-drop to the same drop and finishes it the same', () => {
    expect(run(487)).toBe(run(null));
  });
});

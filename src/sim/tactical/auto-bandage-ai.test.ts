import { beforeAll, describe, expect, it } from 'vitest';
import { newCombatSim, spawnSoldier } from '../../../tests/support/combat.ts';
import { loadTestContent } from '../../../tests/support/tactical.ts';
import { NOTHING } from '../../content/items/items.ts';
import { Direction, gridNo } from '../../content/world/grid.ts';
import { Rng } from '../../core/rng.ts';
import { TICK_MS } from '../clock.ts';
import type { SimEvent } from '../events.ts';
import { createItem } from '../items/object.ts';
import { AI_DELAY, AiAction } from './ai/actions.ts';
import { handleSoldierAI } from './ai/control.ts';
import { anim } from './anim-states.ts';
import { initNewSoldierAnim, resetAllMercSpeeds, setSoldierDirection, states } from './animation.ts';
import { updateSkullReleases } from './combat/death.ts';
import type { TacticalContent } from './content.ts';
import { handleTeamServices } from './first-aid.ts';
import { InvSlot, itemIn } from './inventory.ts';
import { revealRoofsAndItems } from './perception/fov.ts';
import { AlertStatus, NOBODY, OKLIFE, type Soldier, Team, Visible } from './soldier.ts';
import { setAutoBandageMode } from './state.ts';
import type { TacticalSim } from './tactical-sim.ts';
import { addItemToPool, Visibility } from './world-items.ts';

let content: TacticalContent;

beforeAll(async () => {
  content = await loadTestContent();
});

const SHADOW = 0;
const SIDNEY = 1;
const IRA = 2;
const IVAN = 3;
const CIVILIAN = 30;
const OTHER_CIVILIAN = 31;
const WOUNDED = 60;
const BLEEDING = 5;
const FULL_KIT = 100;
const MAX_FRAMES = 4000;
const FAST_TURN_DELAY = 30;
const REALTIME_AI_DELAY_BASE = 10_000;
const REALTIME_AI_DELAY_SPREAD = 1000;

const item = (name: string) => content.items.byName.get(name)?.index ?? -1;
const st = () => states(content.animations);

function scene(): TacticalSim {
  return newCombatSim(content);
}

function medic(sim: TacticalSim, id: number, at: number, kitSlot: number = InvSlot.BIGPOCK1, kitStatus = FULL_KIT): Soldier {
  const s = spawnSoldier(sim, id, Team.OUR, at, Direction.NORTH);
  s.inv[kitSlot] = createItem(content.items, item('FIRSTAIDKIT'), kitStatus);
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

function startMode(sim: TacticalSim): void {
  setAutoBandageMode(sim.state, true);
  resetAllMercSpeeds(sim.state);
}

function bandageFrame(sim: TacticalSim): SimEvent[] {
  handleTeamServices(sim.state, Team.OUR);
  sim.step();
  return sim.drainEvents();
}

function framesUntil(sim: TacticalSim, done: () => boolean): SimEvent[] {
  const events: SimEvent[] = [];
  for (let frame = 0; frame < MAX_FRAMES && !done(); frame++) events.push(...bandageFrame(sim));
  expect(done()).toBe(true);
  return events;
}

function patientsOf(events: readonly SimEvent[], type: 'firstAidStarted' | 'firstAidDone'): number[] {
  return events.flatMap((e) => (e.type === type ? [e.patient] : []));
}

function decide(sim: TacticalSim, s: Soldier): void {
  handleSoldierAI(sim.state, s, sim.ai);
}

describe('the AI of our mercs in auto-bandage (AIMain.cc HandleSoldierAI, Realtime.cc RTPlayerDecideAction)', () => {
  it('sends a medic to the nearer patient, dresses him on the spot, then sends him on to the next', () => {
    const sim = scene();
    const ira = medic(sim, IRA, gridNo(70, 70));
    const shadow = patient(sim, SHADOW, gridNo(70, 74));
    const sidney = patient(sim, SIDNEY, gridNo(76, 70));
    startMode(sim);
    const first = bandageFrame(sim);
    expect([ira.ai.action, shadow.autoBandagingMedic]).toEqual([AiAction.GET_CLOSER, IRA]);
    const events = [...first, ...framesUntil(sim, () => shadow.bleeding === 0 && sidney.bleeding === 0)];
    expect(patientsOf(events, 'firstAidStarted')).toEqual([SHADOW, SIDNEY]);
    expect(patientsOf(events, 'firstAidDone')).toEqual([SHADOW, SIDNEY]);
    expect([shadow.autoBandagingMedic, sidney.autoBandagingMedic, ira.servicePartner]).toEqual([NOBODY, NOBODY, NOBODY]);
  });

  it('keeps a medic done with a patient in GIVING_AID, with no END_AID, his action done and the patient free of him', () => {
    const sim = scene();
    const ira = medic(sim, IRA, gridNo(70, 70));
    const shadow = patient(sim, SHADOW, gridNo(70, 71));
    startMode(sim);
    framesUntil(sim, () => shadow.bleeding === 0);
    expect([ira.state, ira.ai.action, ira.servicePartner, shadow.autoBandagingMedic]).toEqual([
      anim(content, 'GIVING_AID'),
      AiAction.NONE,
      NOBODY,
      NOBODY,
    ]);
    for (let frame = 0; frame < AI_DELAY / TICK_MS - 1; frame++) bandageFrame(sim);
    expect(ira.state).toBe(anim(content, 'GIVING_AID'));
  });

  it('has a bleeding medic dress himself first, keeping his gait, before he goes to the other patient', () => {
    const sim = scene();
    const ira = medic(sim, IRA, gridNo(70, 70));
    ira.bleeding = BLEEDING;
    ira.uiMovementMode = st().SWATTING;
    const shadow = patient(sim, SHADOW, gridNo(70, 74));
    startMode(sim);
    const events = bandageFrame(sim);
    expect([ira.ai.action, ira.servicePartner, ira.uiMovementMode]).toEqual([AiAction.GIVE_AID, IRA, st().SWATTING]);
    events.push(...framesUntil(sim, () => ira.bleeding === 0 && shadow.bleeding === 0));
    expect(patientsOf(events, 'firstAidStarted')).toEqual([IRA, SHADOW]);
    expect(itemIn(ira.inv, InvSlot.HAND)).toBe(item('FIRSTAIDKIT'));
    expect(ira.slotItemTakenFrom).toBe(InvSlot.BIGPOCK1);
  });

  it('swaps a second kit in after the first ran out with a patient’s last dressing, so the pocket it came from overwrites the first one', () => {
    const sim = scene();
    const ira = medic(sim, IRA, gridNo(70, 70), InvSlot.BIGPOCK1, 2);
    ira.inv[InvSlot.BIGPOCK2] = createItem(content.items, item('FIRSTAIDKIT'), FULL_KIT);
    const shadow = patient(sim, SHADOW, gridNo(70, 71), 2);
    const sidney = patient(sim, SIDNEY, gridNo(70, 74));
    startMode(sim);
    framesUntil(sim, () => shadow.bleeding === 0);
    expect([itemIn(ira.inv, InvSlot.HAND), ira.slotItemTakenFrom]).toEqual([NOTHING, InvSlot.BIGPOCK1]);
    framesUntil(sim, () => sidney.serviceCount > 0);
    expect(ira.slotItemTakenFrom).toBe(InvSlot.BIGPOCK2);
    expect([itemIn(ira.inv, InvSlot.HAND), itemIn(ira.inv, InvSlot.BIGPOCK1), itemIn(ira.inv, InvSlot.BIGPOCK2)]).toEqual([
      item('FIRSTAIDKIT'),
      item('GLOCK_17'),
      NOTHING,
    ]);
  });

  it('makes a merc of ours with nothing to do wait 10 to 11 s at his first visit, drawing Random(1000) on the main stream', () => {
    const sim = scene();
    const t = sim.state;
    const ivan = spawnSoldier(sim, IVAN, Team.OUR, gridNo(70, 70), Direction.NORTH);
    setAutoBandageMode(t, true);
    const probe = Rng.fromState(t.rng.state());
    const wait = REALTIME_AI_DELAY_BASE + probe.int(REALTIME_AI_DELAY_SPREAD);
    decide(sim, ivan);
    expect([ivan.ai.action, ivan.ai.actionInProgress, ivan.ai.counter]).toEqual([AiAction.NONE, true, t.clockMs + wait]);
    expect(t.rng.state()).toEqual(probe.state());
  });

  it('leaves our mercs out of the AI when the mode is off', () => {
    const sim = scene();
    const t = sim.state;
    const ivan = spawnSoldier(sim, IVAN, Team.OUR, gridNo(70, 70), Direction.NORTH);
    const before = t.rng.state();
    decide(sim, ivan);
    expect([ivan.ai.actionInProgress, ivan.ai.counter, t.rng.state()]).toEqual([false, 0, before]);
  });
});

describe('the gait of a medic on his way (AIUtils.cc NewDest after DecideAutoBandage)', () => {
  function goingToPatient(alert: number, teamAware = false): Soldier {
    const sim = scene();
    const t = sim.state;
    const ira = medic(sim, IRA, gridNo(70, 70));
    ira.ai.alertStatus = alert;
    patient(sim, SHADOW, gridNo(70, 76));
    t.perception.awareOfOpposition[Team.OUR] = teamAware;
    setAutoBandageMode(t, true);
    decide(sim, ira);
    expect([ira.ai.action, ira.ai.actionInProgress]).toEqual([AiAction.GET_CLOSER, true]);
    return ira;
  }

  it('walks at GREEN with the team unaware of opposition, the RUNNING of the decision overridden by the movement table', () => {
    expect(goingToPatient(AlertStatus.GREEN).uiMovementMode).toBe(st().WALKING);
  });

  it('runs at RED', () => {
    expect(goingToPatient(AlertStatus.RED).uiMovementMode).toBe(st().RUNNING);
  });

  it('raises a medic at GREEN to RED at his first decision once the team knows of opposition, so he runs', () => {
    const ira = goingToPatient(AlertStatus.GREEN, true);
    expect([ira.ai.alertStatus, ira.uiMovementMode]).toEqual([AlertStatus.RED, st().RUNNING]);
  });
});

describe('the cadence in auto-bandage (Overhead.cc ExecuteOverhead, Soldier_Control.cc SetSoldierAniSpeed)', () => {
  it('handles the AI of every soldier of every team at the first pass, each on his own 100 ms timer after it', () => {
    const sim = scene();
    const t = sim.state;
    const ira = medic(sim, IRA, gridNo(70, 70));
    patient(sim, SHADOW, gridNo(70, 95));
    const civilians = [civilian(sim, CIVILIAN, gridNo(90, 90)), civilian(sim, OTHER_CIVILIAN, gridNo(95, 95))];
    startMode(sim);
    bandageFrame(sim);
    expect(civilians.every((c) => c.ai.counter > t.clockMs)).toBe(true);
    expect([ira.ai.action, ira.ai.counter]).toEqual([AiAction.GET_CLOSER, t.clockMs - TICK_MS + AI_DELAY]);
    const visits: number[] = [];
    for (let frame = 0; frame < 3 * (AI_DELAY / TICK_MS); frame++) {
      const before = ira.ai.counter;
      bandageFrame(sim);
      if (ira.ai.counter !== before) visits.push(ira.ai.counter - before);
    }
    expect(visits).toEqual([AI_DELAY, AI_DELAY, AI_DELAY]);
  });

  it('leaves the civilians to the AI cursor when the mode is off', () => {
    const sim = scene();
    const t = sim.state;
    const civilians = [civilian(sim, CIVILIAN, gridNo(90, 90)), civilian(sim, OTHER_CIVILIAN, gridNo(95, 95))];
    sim.step();
    expect(civilians.some((c) => c.ai.counter > t.clockMs)).toBe(false);
  });

  it('animates every soldier of every team one frame per pass, but a monster getting up and a turning merc of ours', () => {
    const sim = scene();
    const t = sim.state;
    const ira = medic(sim, IRA, gridNo(70, 70));
    const civ = civilian(sim, CIVILIAN, gridNo(90, 90));
    const enemy = spawnSoldier(sim, 20, Team.ENEMY, gridNo(95, 95), Direction.NORTH);
    const rising = spawnSoldier(sim, 21, Team.ENEMY, gridNo(100, 95), Direction.NORTH);
    rising.state = anim(content, 'MONSTER_UP');
    expect([ira, civ, enemy].every((s) => s.aniDelay > 0)).toBe(true);
    startMode(sim);
    expect([ira.aniDelay, civ.aniDelay, enemy.aniDelay]).toEqual([0, 0, 0]);
    expect(rising.aniDelay).toBeGreaterThan(0);
    initNewSoldierAnim(t, civ, st().WALKING, 0, false);
    expect(civ.aniDelay).toBe(0);
    ira.desiredDirection = Direction.SOUTH;
    setSoldierDirection(t, ira, Direction.EAST);
    expect(ira.aniDelay).toBe(FAST_TURN_DELAY);
  });
});

describe('what the mode changes around the AI', () => {
  it('reveals no items to our mercs looking around (FOV.cc RevealRoofsAndItems, OUR_MERCS_AUTO_MOVE)', () => {
    const look = (autoBandage: boolean) => {
      const sim = scene();
      const t = sim.state;
      const ira = spawnSoldier(sim, IRA, Team.OUR, gridNo(80, 80), Direction.SOUTH);
      const hidden = addItemToPool(t, gridNo(80, 84), createItem(content.items, item('GLOCK_17'), FULL_KIT), Visibility.INVISIBLE, 0);
      setAutoBandageMode(t, autoBandage);
      revealRoofsAndItems(t, ira, true);
      return hidden?.visible;
    };
    expect(look(true)).toBe(Visibility.INVISIBLE);
    expect(look(false)).toBe(Visibility.VISIBLE);
  });

  it('cancels a dead patient’s medic only while a merc of ours stands conscious in the sector (Overhead.cc HandlePlayerTeamMemberDeath)', () => {
    const afterDeath = (medicLife: number, bystander: boolean) => {
      const sim = scene();
      const t = sim.state;
      const ira = medic(sim, IRA, gridNo(70, 70));
      const shadow = patient(sim, SHADOW, gridNo(70, 76));
      if (bystander) spawnSoldier(sim, IVAN, Team.OUR, gridNo(90, 90), Direction.NORTH);
      setAutoBandageMode(t, true);
      decide(sim, ira);
      expect([ira.ai.action, shadow.autoBandagingMedic]).toEqual([AiAction.GET_CLOSER, IRA]);
      ira.life = medicLife;
      shadow.life = 0;
      t.pendingSkullReleases.push({ soldier: shadow, at: t.clockMs });
      updateSkullReleases(t);
      return ira.ai.action;
    };
    expect(afterDeath(WOUNDED, false)).toBe(AiAction.NONE);
    expect(afterDeath(OKLIFE - 1, true)).toBe(AiAction.NONE);
    expect(afterDeath(OKLIFE - 1, false)).toBe(AiAction.GET_CLOSER);
  });

  it('has a medic out of bandages curse only outside the mode (Overhead.cc HandlePlayerServices)', () => {
    const outOfBandages = (autoBandage: boolean) => {
      const sim = scene();
      const t = sim.state;
      const ira = medic(sim, IRA, gridNo(70, 70), InvSlot.HAND, 1);
      const shadow = patient(sim, SHADOW, gridNo(70, 71));
      setAutoBandageMode(t, autoBandage);
      ira.servicePartner = shadow.id;
      ira.targetGridNo = shadow.gridNo;
      shadow.serviceCount = 1;
      ira.state = anim(content, 'GIVING_AID');
      handleTeamServices(t, Team.OUR);
      return sim.drainEvents().find((e) => e.type === 'outOfBandages');
    };
    expect(outOfBandages(false)).toMatchObject({ battleSound: 'CURSE1' });
    expect(outOfBandages(true)).not.toHaveProperty('battleSound');
  });
});

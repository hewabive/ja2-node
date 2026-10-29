import { beforeAll, describe, expect, it } from 'vitest';
import {
  type CrewOptions,
  type EconomyTestContent,
  economyTestContext,
  item,
  kit,
  loadEconomyTestContent,
} from '../../../../tests/support/economy.ts';
import { parseSectorString } from '../../../content/strategic/sector-ids.ts';
import { initializeMapStructure, initStrategicMovementCosts } from '../map/init.ts';
import { worldTotalMinutes } from '../time/world-clock.ts';
import { AC, areAssignmentConditionsMet, canCharacterTrainStat, enoughTimeOnAssignment, numberThatCanBeDoctored } from './conditions.ts';
import { Assignment, SkillTrait, StatAmt, StatCause, TrainStat } from './constants.ts';
import { healCharacters, healPatient } from './doctor.ts';
import { kitItems, Slot, useKitPoints } from './kits.ts';
import {
  calculateHealingPointsForDoctor,
  calculateRepairPointsForRepairman,
  getBonusTrainingPtsDueToInstructor,
  getSoldierTrainingPts,
  getTownTrainPtsForCharacter,
} from './points.ts';
import { doActualRepair, handleRepairBySoldier, repairItemsOnOthers } from './repair.ts';
import {
  calcSoldierNeedForSleep,
  fatigueCharacter,
  handleHealingByNaturalCauses,
  handleRestFatigueAndSleepStatus,
  naturalHealingDivisor,
  restCharacter,
} from './rest.ts';
import { assignSoldiers } from './set-assignment.ts';
import { updateAssignments } from './update.ts';

const OMERTA = parseSectorString('A9');
const DRASSEN = parseSectorString('C13');

let content: EconomyTestContent;
beforeAll(async () => {
  content = await loadEconomyTestContent();
});

function context(rolls?: { int(n: number): number; chance(p: number): boolean }) {
  const made = economyTestContext({ content, ...(rolls ? { random: rolls } : {}) });
  initializeMapStructure(made.ctx);
  initStrategicMovementCosts(made.ctx);
  return made;
}

function merc(made: ReturnType<typeof context>, o: Partial<CrewOptions> & { id: number }) {
  return made.crew.add({ sector: DRASSEN, lastAssignmentChangeMin: 0, ...o });
}

describe('conditions and points', () => {
  it('applies the condition flags and the 45-minute rule', () => {
    const made = context();
    const s = merc(made, { id: 0, life: 10 });
    expect(areAssignmentConditionsMet(made.ctx, s, AC.NONE)).toBe(false);
    expect(areAssignmentConditionsMet(made.ctx, s, AC.UNCONSCIOUS)).toBe(true);
    s.life = 80;
    s.lastAssignmentChangeMin = worldTotalMinutes(made.ctx.state.clock) - 44;
    expect(enoughTimeOnAssignment(made.ctx, s)).toBe(false);
    s.lastAssignmentChangeMin -= 1;
    expect(enoughTimeOnAssignment(made.ctx, s)).toBe(true);
    expect(canCharacterTrainStat(made.ctx, s, TrainStat.MEDICAL, true, false)).toBe(true);
    expect(canCharacterTrainStat(made.ctx, merc(made, { id: 1, stats: { medical: 85 } }), TrainStat.MEDICAL, true, false)).toBe(false);
    expect(canCharacterTrainStat(made.ctx, merc(made, { id: 2, stats: { medical: 24 } }), TrainStat.MEDICAL, false, true)).toBe(false);
  });

  it('computes doctor, repair and town training points from the effective stats, the kits and the TEACHING trait', () => {
    const made = context();
    const kits = kitItems(content.items);
    const d = merc(made, { id: 0, stats: { medical: 80, dexterity: 80, wisdom: 70, expLevel: 4 } });
    d.inv[Slot.HAND] = kit(content.items, 'MEDICKIT', [100]);
    expect(calculateHealingPointsForDoctor(d, kits, false)).toEqual({ points: 300, max: 300 });
    d.inv[Slot.HAND] = kit(content.items, 'MEDICKIT', [2]);
    expect(calculateHealingPointsForDoctor(d, kits, false).points).toBe(200);
    d.breathMax = 60;
    d.inv[Slot.HAND] = kit(content.items, 'MEDICKIT', [100]);
    expect(calculateHealingPointsForDoctor(d, kits, false).points).toBe(225);
    const r = merc(made, { id: 1, stats: { mechanical: 80, dexterity: 80, expLevel: 4 } });
    expect(calculateRepairPointsForRepairman(r, kits, false)).toEqual({ points: 0, max: 0 });
    r.inv[Slot.BIGPOCK1] = kit(content.items, 'TOOLKIT', [40]);
    expect(calculateRepairPointsForRepairman(r, kits, true)).toEqual({ points: 9, max: 12 });
    expect(r.inv[Slot.HAND]?.item).toBe(kits.toolKit);
    const t = merc(made, { id: 2, stats: { wisdom: 80, leadership: 70, expLevel: 4 } });
    expect(getTownTrainPtsForCharacter(made.ctx, t)).toEqual({ points: 760, max: 760 });
    const teacher = merc(made, { id: 3, stats: { wisdom: 80, leadership: 70, expLevel: 4 }, profileTraits: [SkillTrait.TEACHING, 0] });
    expect(getTownTrainPtsForCharacter(made.ctx, teacher).points).toBe(988);
    const student = merc(made, { id: 4, stats: { wisdom: 80, marksmanship: 60 } });
    expect(getSoldierTrainingPts(student, TrainStat.MARKSMANSHIP, false).points).toBe(2);
    expect(getSoldierTrainingPts(student, TrainStat.MARKSMANSHIP, true).points).toBe(2);
  });

  it('gives instructor points with opinions and the minimum point', () => {
    const made = context();
    const t = merc(made, { id: 0, profile: 10, stats: { marksmanship: 90, wisdom: 80, leadership: 60 } });
    const st = merc(made, { id: 1, profile: 11, stats: { marksmanship: 60, wisdom: 70 } });
    expect(getBonusTrainingPtsDueToInstructor(made.ctx, t, null, TrainStat.MARKSMANSHIP, false)).toEqual({ points: 5, max: 5 });
    expect(getBonusTrainingPtsDueToInstructor(made.ctx, t, st, TrainStat.MARKSMANSHIP, false).points).toBe(1);
    made.crew.opinions.set('11:10', 20);
    made.crew.opinions.set('10:11', -9);
    expect(getBonusTrainingPtsDueToInstructor(made.ctx, t, st, TrainStat.MARKSMANSHIP, false).points).toBe(1);
    const close = merc(made, { id: 2, stats: { marksmanship: 75, wisdom: 10 } });
    expect(getBonusTrainingPtsDueToInstructor(made.ctx, t, close, TrainStat.MARKSMANSHIP, false)).toEqual({ points: 1, max: 1 });
    const better = merc(made, { id: 3, stats: { marksmanship: 84 } });
    expect(getBonusTrainingPtsDueToInstructor(made.ctx, t, better, TrainStat.MARKSMANSHIP, false)).toEqual({ points: 0, max: 0 });
  });
});

describe('rest, fatigue and natural healing', () => {
  it('computes the need for sleep with health shifts, traits and the UINT8 wrap', () => {
    const made = context();
    const s = merc(made, { id: 0, needForSleep: 7, life: 80, lifeMax: 80 });
    expect(calcSoldierNeedForSleep(s)).toBe(7);
    s.life = 19;
    expect(calcSoldierNeedForSleep(s)).toBe(11);
    s.life = 39;
    expect(calcSoldierNeedForSleep(s)).toBe(9);
    const wrapped = merc(made, { id: 1, needForSleep: 1, skillTraits: [SkillTrait.NIGHTOPS, SkillTrait.MARTIALARTS] });
    expect(calcSoldierNeedForSleep(wrapped)).toBe(12);
  });

  it('rests and fatigues by the need for sleep, half again below 50 and with the load on the road', () => {
    const made = context();
    const s = merc(made, { id: 0, needForSleep: 7, breathMax: 60 });
    restCharacter(s);
    expect(s.breathMax).toBe(67);
    s.breathMax = 40;
    restCharacter(s);
    expect(s.breathMax).toBe(50);
    s.breathMax = 60;
    fatigueCharacter(made.ctx, s);
    expect(s.breathMax).toBe(58);
    s.breathMax = 40;
    fatigueCharacter(made.ctx, s);
    expect(s.breathMax).toBe(37);
    s.betweenSectors = true;
    made.crew.encumbrance.set(0, 300);
    s.breathMax = 60;
    fatigueCharacter(made.ctx, s);
    expect(s.breathMax).toBe(54);
  });

  it('oscillates a rested squad merc around 95 and sends a tired assignee to sleep', () => {
    const made = context();
    const squad = merc(made, { id: 0, assignment: Assignment.SQUAD_1, breathMax: 95 });
    const doctor = merc(made, { id: 1, assignment: Assignment.DOCTOR, breathMax: 51 });
    handleRestFatigueAndSleepStatus(made.ctx);
    expect(squad.breathMax).toBe(93);
    expect(doctor).toMatchObject({ breathMax: 49, asleep: true });
    handleRestFatigueAndSleepStatus(made.ctx);
    expect(squad.breathMax).toBe(100);
  });

  it('wears out a dying merc on a squad: below OKLIFE he cannot sleep, so he is not taking it easy', () => {
    const made = context();
    const dying = merc(made, { id: 0, assignment: Assignment.SQUAD_1, life: 10, breathMax: 80 });
    const healthy = merc(made, { id: 1, assignment: Assignment.SQUAD_1, breathMax: 80 });
    handleRestFatigueAndSleepStatus(made.ctx);
    expect(dying).toMatchObject({ breathMax: 77, asleep: false });
    expect(healthy.breathMax).toBe(87);
  });

  it('collapses at 10 and only wakes after recovering', () => {
    const made = context();
    const s = merc(made, { id: 0, assignment: Assignment.REPAIR, breathMax: 11 });
    handleRestFatigueAndSleepStatus(made.ctx);
    expect(s).toMatchObject({ breathMax: 10, asleep: true, collapsed: true });
    s.breathMax = 94;
    handleRestFatigueAndSleepStatus(made.ctx);
    expect(s).toMatchObject({ asleep: false, collapsed: false, forcedToStayAwake: false });
  });

  it('heals naturally with the activity divisors', () => {
    const made = context();
    const s = merc(made, { id: 0, life: 48, lifeMax: 80, assignment: Assignment.SQUAD_1 });
    expect(naturalHealingDivisor(made.ctx, s)).toBe(1);
    made.ctx.state.flow = 'tactical';
    expect(naturalHealingDivisor(made.ctx, s)).toBe(12);
    s.assignment = Assignment.REPAIR;
    expect(naturalHealingDivisor(made.ctx, s)).toBe(4);
    handleHealingByNaturalCauses(made.ctx, s);
    expect(s).toMatchObject({ life: 48, fractLife: 15 });
    s.asleep = true;
    for (let k = 0; k < 6; k++) handleHealingByNaturalCauses(made.ctx, s);
    expect(s).toMatchObject({ life: 51, fractLife: 82 });
    s.bleeding = 1;
    handleHealingByNaturalCauses(made.ctx, s);
    expect(s.life).toBe(51);
  });
});

describe('doctoring', () => {
  it('uses kits from the last object and doubles the cost below OKLIFE, wasting the odd point', () => {
    const k = kit(content.items, 'MEDICKIT', [50, 30]);
    expect(useKitPoints(k, 40)).toBe(40);
    expect(k.status.slice(0, k.count)).toEqual([40]);
    expect(useKitPoints(k, 70)).toBe(40);
    expect(k.count).toBe(0);
    const made = context();
    const d = merc(made, { id: 0, assignment: Assignment.DOCTOR, stats: { medical: 80 } });
    d.inv[Slot.HAND] = kit(content.items, 'MEDICKIT', [100]);
    const p = merc(made, { id: 1, assignment: Assignment.PATIENT, life: 10, lifeMax: 80 });
    expect(healPatient(made.ctx, p, d, 1100)).toBe(1100);
    expect(p.life).toBe(16);
    const odd = merc(made, { id: 2, assignment: Assignment.PATIENT, life: 12, lifeMax: 80 });
    healPatient(made.ctx, odd, d, 500);
    expect(odd.life).toBe(14);
  });

  it('treats doctors as patients: a doctor heals another doctor and himself', () => {
    const made = context();
    const d = merc(made, { id: 0, assignment: Assignment.DOCTOR, life: 70 });
    d.inv[Slot.HAND] = kit(content.items, 'MEDICKIT', [100]);
    const other = merc(made, { id: 1, assignment: Assignment.DOCTOR, life: 60 });
    expect(numberThatCanBeDoctored(made.ctx, d, true, false, false)).toBe(2);
    healCharacters(made.ctx, d);
    expect([d.life, other.life]).toEqual([71, 61]);
  });

  it('refunds unused hundredths when the patient is fully healed', () => {
    const made = context();
    const d = merc(made, { id: 0, assignment: Assignment.DOCTOR });
    d.inv[Slot.HAND] = kit(content.items, 'MEDICKIT', [100]);
    const p = merc(made, { id: 1, assignment: Assignment.PATIENT, life: 78, lifeMax: 80 });
    p.fractLife = 30;
    expect(healPatient(made.ctx, p, d, 450)).toBe(450 - 200 - 80);
    expect(p).toMatchObject({ life: 80, fractLife: 0 });
  });

  it('splits evenly, then gives the rest to the worst hurt, and records stat chances', () => {
    const made = context();
    const d = merc(made, { id: 0, assignment: Assignment.DOCTOR, stats: { medical: 80, dexterity: 80, wisdom: 70, expLevel: 4 } });
    d.inv[Slot.HAND] = kit(content.items, 'MEDICKIT', [100]);
    const a = merc(made, { id: 1, assignment: Assignment.PATIENT, life: 79, lifeMax: 80 });
    const b = merc(made, { id: 2, assignment: Assignment.PATIENT, life: 40, lifeMax: 80 });
    healCharacters(made.ctx, d);
    expect(a.life).toBe(80);
    expect(b.life).toBe(42);
    expect(made.crew.statChanges).toEqual([
      { id: 0, stat: StatAmt.MEDICAL, chances: 3, cause: StatCause.SUCCESS },
      { id: 0, stat: StatAmt.DEXTERITY, chances: 1, cause: StatCause.SUCCESS },
      { id: 0, stat: StatAmt.WISDOM, chances: 1, cause: StatCause.SUCCESS },
    ]);
  });
});

describe('repair', () => {
  it('adjusts the cost by repair ease and electronics, and fixes damage costing under a point for free with no points left', () => {
    const made = context();
    const r = merc(made, { id: 0 });
    const vest = content.items.byName.get('KEVLAR_VEST');
    const pistol = content.items.byName.get('GLOCK_17');
    if (!vest || !pistol) throw new Error('no vest or pistol');
    expect(vest.repairEase).toBe(0);
    expect(pistol.repairEase).toBeGreaterThan(0);
    const budget = { left: 10 };
    expect(doActualRepair(made.ctx, r, vest.index, 90, budget)).toBe(100);
    expect(budget.left).toBe(0);
    expect(doActualRepair(made.ctx, r, vest.index, 99, { left: 0 })).toBe(99);
    expect(doActualRepair(made.ctx, r, pistol.index, 99, { left: 0 })).toBe(100);
  });

  it('repairs the robot’s gear for a teammate: the original asks whether the repairer, not the owner, is a machine or an EPC', () => {
    const made = context();
    const r = merc(made, { id: 0, assignment: Assignment.REPAIR });
    const robot = merc(made, { id: 1, isRobot: true });
    const gun = item(content.items, 'GLOCK_17', 50);
    robot.inv[Slot.HAND] = gun;
    repairItemsOnOthers(made.ctx, r, { left: 20 });
    expect(gun.status[0]).toBe(75);
  });

  it('unjams guns first, repairs own items, wears the toolkit and finishes', () => {
    const rolls = { int: () => 0, chance: () => true };
    const made = context(rolls);
    const r = merc(made, { id: 0, assignment: Assignment.REPAIR, stats: { mechanical: 80, dexterity: 80, expLevel: 4 } });
    r.inv[Slot.HAND] = kit(content.items, 'TOOLKIT', [100]);
    const gun = item(content.items, 'GLOCK_17', 100);
    gun.gunAmmoStatus = -50;
    r.inv[Slot.SECOND_HAND] = gun;
    handleRepairBySoldier(made.ctx, r);
    expect(gun.gunAmmoStatus).toBe(50);
    expect(made.crew.statChanges.slice(0, 2).map((c) => c.chances)).toEqual([5, 5]);
    expect(r.inv[Slot.HAND]?.status[0]).toBe(99);
    expect(made.ctx.events.some((e) => e.type === 'assignmentDone' && e.soldier === 0)).toBe(true);
  });
});

describe('assigning and the hourly order', () => {
  it('sets a doctor with the kit in hand and stamps the change time', () => {
    const made = context();
    const d = merc(made, { id: 0, assignment: Assignment.ON_DUTY });
    d.inv[Slot.BIGPOCK2] = kit(content.items, 'MEDICKIT', [100]);
    const [result] = assignSoldiers(made.ctx, [0], { kind: 'doctor' });
    expect(result).toEqual({ ok: true });
    expect(d).toMatchObject({ assignment: Assignment.DOCTOR, lastAssignmentChangeMin: worldTotalMinutes(made.ctx.state.clock) });
    expect(d.inv[Slot.HAND]?.item).toBe(kitItems(content.items).medicKit);
    expect(d.nothingToDo).toBe(true);
    expect(made.ctx.state.queue.events.some((e) => e.kind === 68)).toBe(true);
  });

  it('pays nobody during the first 45 minutes and trains self-trainers afterwards', () => {
    const made = context();
    const now = worldTotalMinutes(made.ctx.state.clock);
    const s = merc(made, { id: 0, assignment: Assignment.TRAIN_SELF, sector: OMERTA, lastAssignmentChangeMin: now - 30 });
    s.trainStat = TrainStat.MEDICAL;
    updateAssignments(made.ctx);
    expect(made.crew.statChanges).toEqual([]);
    s.lastAssignmentChangeMin = now - 45;
    updateAssignments(made.ctx);
    expect(made.crew.statChanges).toEqual([{ id: 0, stat: StatAmt.MEDICAL, chances: 1, cause: StatCause.TRAINING }]);
  });
});

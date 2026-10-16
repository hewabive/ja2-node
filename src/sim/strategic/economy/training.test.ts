import { beforeAll, describe, expect, it } from 'vitest';
import {
  type EconomyTestContent,
  economyTestContext,
  kit,
  loadEconomyTestContent,
  setTownNames,
} from '../../../../tests/support/economy.ts';
import { ScriptedRolls } from '../../../../tests/support/strategic.ts';
import { parseSectorString, sectorId } from '../../../content/strategic/sector-ids.ts';
import { initSquads } from '../forces/squads.ts';
import { initializeMapStructure, initStrategicMovementCosts } from '../map/init.ts';
import { sectorInfo } from '../map/sectors.ts';
import { EventKind } from '../time/constants.ts';
import { Assignment, FACT_MINERS_PLACED, StatAmt, StatCause, Town, TrainStat } from './constants.ts';
import { bandageBleedingDyingPatientsBeingTreated } from './doctor.ts';
import { Slot } from './kits.ts';
import { setTownLoyalty } from './loyalty.ts';
import { placeHeadMinersOnSectorEntry } from './mines.ts';
import { handleTrainingInSector, reportTrainersTraineesWithoutPartners, sortTownTrainers } from './training.ts';

const OMERTA = parseSectorString('A9');
const C13 = parseSectorString('C13');

let content: EconomyTestContent;
beforeAll(async () => {
  content = await loadEconomyTestContent();
});

function context(random?: ScriptedRolls) {
  const placed: string[] = [];
  const facts: number[] = [];
  const made = economyTestContext({
    content,
    ...(random ? { random } : {}),
    setup: {
      hooks: {
        placeHeadMiner: (profile, s, town) => placed.push(`${profile}@${sectorId(s)}/${town}`),
        setFact: (id) => facts.push(id),
      },
    },
  });
  initializeMapStructure(made.ctx);
  initStrategicMovementCosts(made.ctx);
  initSquads(made.ctx);
  setTownNames(made.ctx);
  return { ...made, placed, facts };
}

describe('stat training', () => {
  it('adds the best instructor bonus to students trained by others', () => {
    const made = context();
    const teacher = made.crew.add({
      id: 0,
      sector: OMERTA,
      assignment: Assignment.TRAIN_TEAMMATE,
      stats: { marksmanship: 90, wisdom: 80, leadership: 70 },
    });
    teacher.trainStat = TrainStat.MARKSMANSHIP;
    const weaker = made.crew.add({ id: 1, sector: OMERTA, assignment: Assignment.TRAIN_TEAMMATE, stats: { marksmanship: 70, wisdom: 80 } });
    weaker.trainStat = TrainStat.MARKSMANSHIP;
    const student = made.crew.add({
      id: 2,
      sector: OMERTA,
      assignment: Assignment.TRAIN_BY_OTHER,
      stats: { marksmanship: 60, wisdom: 80 },
    });
    student.trainStat = TrainStat.MARKSMANSHIP;
    handleTrainingInSector(made.ctx, OMERTA, new Set());
    expect(made.crew.statChanges).toEqual([{ id: 2, stat: StatAmt.MARKSMANSHIP, chances: 3, cause: StatCause.TRAINING }]);
    made.crew.statChanges.length = 0;
    handleTrainingInSector(made.ctx, OMERTA, new Set([2]));
    expect(made.crew.statChanges).toEqual([]);
  });

  it('flags instructors and students without a partner as done', () => {
    const made = context();
    const teacher = made.crew.add({ id: 0, sector: OMERTA, assignment: Assignment.TRAIN_TEAMMATE, stats: { medical: 90 } });
    teacher.trainStat = TrainStat.MEDICAL;
    const student = made.crew.add({ id: 1, sector: C13, assignment: Assignment.TRAIN_BY_OTHER, stats: { medical: 40 } });
    student.trainStat = TrainStat.MEDICAL;
    reportTrainersTraineesWithoutPartners(made.ctx);
    expect(made.ctx.events.filter((e) => e.type === 'assignmentDone').map((e) => (e.type === 'assignmentDone' ? e.soldier : -1))).toEqual([
      0, 1,
    ]);
  });
});

describe('militia trainers', () => {
  it('orders trainers by points and stops after the one that completes the session', () => {
    expect(
      sortTownTrainers([
        { soldier: { id: 0 } as never, points: 600 },
        { soldier: { id: 1 } as never, points: 900 },
      ]).map((t) => t.points),
    ).toEqual([900, 600]);
    const made = context();
    setTownLoyalty(made.ctx, Town.DRASSEN, 40);
    made.crew.add({ id: 0, sector: C13, assignment: Assignment.TRAIN_TOWN, stats: { wisdom: 50, leadership: 50, expLevel: 2 } });
    made.crew.add({ id: 1, sector: C13, assignment: Assignment.TRAIN_TOWN, stats: { wisdom: 80, leadership: 70, expLevel: 4 } });
    sectorInfo(made.ctx.state.map, C13).militiaTrainingPercentDone = 95;
    handleTrainingInSector(made.ctx, C13, new Set());
    expect(made.crew.statChanges.map((c) => c.id)).toEqual([1]);
    expect(sectorInfo(made.ctx.state.map, C13).militia).toEqual([10, 0, 0]);
  });
});

describe('head miners and bandaging', () => {
  it('places Fred in the first mine entered and the others by a retrying Random(4)', () => {
    const random = new ScriptedRolls([0, 2, 2, 1, 3]);
    const made = context(random);
    placeHeadMinersOnSectorEntry(made.ctx, parseSectorString('D13'));
    expect(made.placed).toEqual([
      `106@${sectorId(parseSectorString('D13'))}/2`,
      `157@${sectorId(parseSectorString('H8'))}/6`,
      `156@${sectorId(parseSectorString('B2'))}/12`,
      `158@${sectorId(parseSectorString('H3'))}/4`,
    ]);
    expect(made.facts).toEqual([FACT_MINERS_PLACED]);
    expect(random.ranges).toEqual([4, 4, 4, 4, 4]);
  });

  it('bandages a bleeding patient with the first medical kit and re-posts while someone still bleeds', () => {
    const made = context();
    const doctor = made.crew.add({ id: 0, sector: C13, assignment: Assignment.DOCTOR });
    doctor.inv[Slot.BIGPOCK1] = kit(content.items, 'FIRSTAIDKIT', [30]);
    doctor.inv[Slot.BIGPOCK2] = kit(content.items, 'MEDICKIT', [100]);
    const patient = made.crew.add({ id: 1, sector: C13, assignment: Assignment.PATIENT, life: 50 });
    patient.bleeding = 4;
    made.crew.dressWoundResult = 10;
    bandageBleedingDyingPatientsBeingTreated(made.ctx);
    expect(doctor.inv[Slot.BIGPOCK1]?.status[0]).toBe(20);
    expect(made.ctx.state.queue.events.filter((e) => e.kind === EventKind.BANDAGE_BLEEDING_MERCS)).toHaveLength(1);
    patient.bleeding = 0;
    bandageBleedingDyingPatientsBeingTreated(made.ctx);
    expect(made.ctx.state.queue.events.filter((e) => e.kind === EventKind.BANDAGE_BLEEDING_MERCS)).toHaveLength(0);
  });
});

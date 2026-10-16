import { beforeAll, describe, expect, it } from 'vitest';
import { awakeFixture, type GarrisonFixture, loadArmyTestContent, usePatrols } from '../../../../tests/support/queen.ts';
import { loadStrategicTestContent } from '../../../../tests/support/strategic.ts';
import type { ArmyContent } from '../../../content/strategic/army.ts';
import { parseSectorId, parseSectorString, sectorId } from '../../../content/strategic/sector-ids.ts';
import type { StrategicContent } from '../../../content/strategic/strategic-content.ts';
import { EnemyIntention, MoveType } from '../forces/constants.ts';
import { createNewEnemyGroupDepartingFromSector, getFinalWaypoint } from '../forces/groups.ts';
import { sectorInfo } from '../map/sectors.ts';
import { EventKind } from '../time/constants.ts';
import { worldTotalMinutes } from '../time/world-clock.ts';
import { Composition } from './constants.ts';
import { checkEnemyControlledSector } from './detection.ts';
import { evaluateQueenSituation } from './evaluate.ts';
import { reinforcementsApproved, sendReinforcementsForPatrol } from './reinforce.ts';

let content: StrategicContent;
let army: ArmyContent;

beforeAll(async () => {
  content = await loadStrategicTestContent();
  army = await loadArmyTestContent();
});

const DRASSEN_SETUP: readonly GarrisonFixture[] = [
  { sector: 'P3', composition: Composition.QUEEN_DEFENCE, elites: 32 },
  { sector: 'M3', composition: Composition.LEVEL1_DEFENCE, troops: 20 },
  { sector: 'C13', composition: Composition.DRASSEN_DEFENCE },
  { sector: 'H13', composition: Composition.ALMA_DEFENCE, troops: 18 },
];

function fixture(garrisons: readonly GarrisonFixture[] = DRASSEN_SETUP) {
  return awakeFixture({ content, army, difficulty: 2 }, garrisons);
}

function enemyGroups(q: ReturnType<typeof fixture>['q']) {
  return q.state.forces.groups.filter((g) => !g.player);
}

function evaluationEvents(q: ReturnType<typeof fixture>['q']) {
  return q.state.queue.events.filter((e) => e.kind === EventKind.EVALUATE_QUEEN_SITUATION);
}

describe('EvaluateQueenSituation (docs/17 §4.1, §6.1)', () => {
  it('reschedules with two draws and decides nothing while asleep', () => {
    const { q, rolls } = fixture();
    q.state.queen.awake = false;
    rolls.push(10, 20);
    evaluateQueenSituation(q);
    expect(rolls.ranges).toEqual([(100 - 6) * 4, 180]);
    expect(evaluationEvents(q).map((e) => e.stamp)).toEqual([(worldTotalMinutes(q.state.clock) + 94 + 10 + 360 + 20) * 60]);
    expect(enemyGroups(q)).toHaveLength(0);
  });

  it('recruits 30 troops at an empty pool and waits ten times longer', () => {
    const { q, rolls } = fixture();
    q.state.queen.reinforcementPool = 0;
    rolls.push(5, 7);
    evaluateQueenSituation(q);
    expect(rolls.ranges).toEqual([376, 180]);
    expect(q.state.queen.reinforcementPool).toBe(30);
    expect(evaluationEvents(q).map((e) => e.stamp)).toEqual([(worldTotalMinutes(q.state.clock) + (94 + 5 + 360 + 7) * 10) * 60]);
  });

  it('sends a palace group to the weighted garrison when R(points + pool) falls in the pool', () => {
    const { q, rolls } = fixture();
    expect([q.state.queen.requestPoints, q.state.queen.reinforcementPoints]).toEqual([6, 20]);
    rolls.push(0, 0, 0, 199);
    evaluateQueenSituation(q);
    expect(rolls.ranges).toEqual([376, 180, 6, 220]);
    const g = enemyGroups(q)[0];
    expect(g?.enemy).toMatchObject({ numTroops: 10, numElites: 0, numAdmins: 0, intention: EnemyIntention.REINFORCEMENTS });
    expect(g?.moveType).toBe(MoveType.ONE_WAY);
    expect(g?.sector).toEqual(parseSectorString('P3'));
    expect(q.state.queen.garrisons[2]?.pendingGroup).toBe(g?.id);
    expect(q.state.queen.reinforcementPool).toBe(190);
    const last = g ? getFinalWaypoint(g) : undefined;
    const c13 = parseSectorString('C13');
    expect(last && Math.abs(last.x - c13.x) + Math.abs(last.y - c13.y)).toBe(1);
  });

  it('prefers Alma for Drassen when Alma can give at least 67% of the request', () => {
    const { q, rolls } = fixture();
    rolls.push(0, 0, 0, 200, 0);
    evaluateQueenSituation(q);
    expect(rolls.ranges).toEqual([376, 180, 6, 220, 100]);
    const g = enemyGroups(q)[0];
    expect(g?.sector).toEqual(parseSectorString('H13'));
    expect(g?.size).toBe(7);
    expect(sectorInfo(q.state.map, parseSectorString('H13')).numTroops).toBe(11);
  });

  it('falls back to the weighted search below 67% and draws the source composition', () => {
    const { q, rolls } = fixture(DRASSEN_SETUP.map((g) => (g.sector === 'H13' ? { ...g, troops: 16 } : g)));
    rolls.push(0, 0, 0, 200, 0, 0);
    evaluateQueenSituation(q);
    expect(rolls.ranges).toEqual([376, 180, 6, 219, 19, 100]);
    const g = enemyGroups(q)[0];
    expect(g?.sector).toEqual(parseSectorString('M3'));
    expect(g?.size).toBe(8);
    expect(sectorInfo(q.state.map, parseSectorString('M3'))).toMatchObject({ numTroops: 12, numElites: 0 });
  });

  it('denies reinforcements against a strong defence and wraps the denial counter at 256', () => {
    const { q } = fixture();
    const militia = sectorInfo(q.state.map, parseSectorString('C13')).militia;
    militia[2] = 20;
    expect(reinforcementsApproved(q, 2)).toEqual({ approved: false, defence: 60 });
    expect(q.state.queen.garrisonDenied[2]).toBe(10);
    militia[2] = 255;
    q.state.queen.garrisonDenied[2] = 250;
    expect(reinforcementsApproved(q, 2).approved).toBe(false);
    expect(q.state.queen.garrisonDenied[2]).toBe(4);
  });

  it('tops up a staged group from thin air, then attacks directly', () => {
    const { q, rolls } = fixture();
    const g = createNewEnemyGroupDepartingFromSector(q, parseSectorId('C12'), 0, 6, 0);
    if (!g.enemy) throw new Error('enemy group');
    g.moveType = MoveType.ONE_WAY;
    g.enemy.intention = EnemyIntention.STAGING;
    g.enemy.pendingReinforcements = 7;
    const gg = q.state.queen.garrisons[2];
    if (!gg) throw new Error('garrison');
    gg.pendingGroup = g.id;
    rolls.push(1);
    checkEnemyControlledSector(q, parseSectorId('C13'));
    expect(rolls.ranges).toEqual([3]);
    expect([g.size, g.enemy.numTroops, g.enemy.pendingReinforcements]).toEqual([10, 10, 3]);
    checkEnemyControlledSector(q, parseSectorId('C13'));
    expect([g.size, g.enemy.pendingReinforcements]).toEqual([13, 0]);
    checkEnemyControlledSector(q, parseSectorId('C13'));
    expect(g.betweenSectors).toBe(true);
    expect(g.next).toEqual(parseSectorString('C13'));
    expect(g.enemy.intention).toBe(EnemyIntention.STAGING);
  });

  it('can send an empty group to a patrol from a non-spawning garrison', () => {
    const { q, rolls } = fixture([
      { sector: 'O3', composition: Composition.MEDUNA_DEFENCE, troops: 20 },
      { sector: 'M3', composition: Composition.LEVEL1_DEFENCE, troops: 20 },
    ]);
    usePatrols(q, [{ size: 6, priority: 30, points: ['B10', 'B12'] }]);
    const patrol = createNewEnemyGroupDepartingFromSector(q, parseSectorId('B12'), 0, 2, 0);
    const pg = q.state.queen.patrols[0];
    if (!pg) throw new Error('patrol');
    pg.group = patrol.id;
    expect(q.state.queen.reinforcementPoints).toBe(17);
    rolls.push(200);
    sendReinforcementsForPatrol(q, 0, null);
    expect(rolls.ranges).toEqual([217]);
    const sent = q.state.forces.groups.find((g) => g.id === pg.pendingGroup);
    expect(sent?.size).toBe(0);
    expect(sent?.sector).toEqual(parseSectorString('O3'));
    expect(sent?.enemy?.intention).toBe(EnemyIntention.REINFORCEMENTS);
    expect(sectorInfo(q.state.map, parseSectorString('O3')).numTroops).toBe(20);
    expect(sectorId(sent?.sector ?? parseSectorString('A1'))).toBe(parseSectorId('O3'));
  });
});

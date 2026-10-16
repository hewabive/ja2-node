import { beforeAll, describe, expect, it } from 'vitest';
import { awakeFixture, type GarrisonFixture, loadArmyTestContent, usePatrols } from '../../../../tests/support/queen.ts';
import { loadStrategicTestContent } from '../../../../tests/support/strategic.ts';
import type { ArmyContent } from '../../../content/strategic/army.ts';
import { parseSectorId, parseSectorString, sectorId } from '../../../content/strategic/sector-ids.ts';
import type { StrategicContent } from '../../../content/strategic/strategic-content.ts';
import { EnemyIntention, MoveType } from '../forces/constants.ts';
import { createNewEnemyGroupDepartingFromSector, type Group, getGroup } from '../forces/groups.ts';
import { moveGroupFromSectorToSector } from '../forces/movement.ts';
import { sectorInfo } from '../map/sectors.ts';
import { Composition } from './constants.ts';
import type { QueenContext } from './context.ts';
import { enemyPermittedToAttackSector, okayForEnemyToMoveThroughSector } from './detection.ts';
import { evaluateGroupSituation, reassignAIGroup, redirectEnemyGroupsMovingThroughSector } from './orders.ts';
import { strategicHandleQueenLosingControlOfSector } from './reactions.ts';

let content: StrategicContent;
let army: ArmyContent;

beforeAll(async () => {
  content = await loadStrategicTestContent();
  army = await loadArmyTestContent();
});

function fixture(garrisons: readonly GarrisonFixture[]) {
  return awakeFixture({ content, army, difficulty: 2 }, garrisons);
}

function arrived(q: QueenContext, sector: string, troops: number, admins = 0): Group {
  const g = createNewEnemyGroupDepartingFromSector(q, parseSectorId(sector), admins, troops, 0);
  if (!g.enemy) throw new Error('enemy group');
  g.size = troops + admins;
  g.moveType = MoveType.ONE_WAY;
  g.enemy.intention = EnemyIntention.REINFORCEMENTS;
  return g;
}

describe('EvaluateGroupSituation arrivals (docs/17 §7.2)', () => {
  it('merges reinforcements into the garrison after removing the surplus admins first', () => {
    const { q } = fixture([{ sector: 'C13', composition: Composition.DRASSEN_DEFENCE, admins: 15 }]);
    const g = arrived(q, 'C13', 10);
    const gg = q.state.queen.garrisons[0];
    if (!gg) throw new Error('garrison');
    gg.pendingGroup = g.id;
    expect(evaluateGroupSituation(q, g)).toBe(true);
    expect(sectorInfo(q.state.map, parseSectorString('C13'))).toMatchObject({ numAdmins: 10, numTroops: 10 });
    expect(getGroup(q, g.id)).toBeUndefined();
    expect(gg.pendingGroup).toBe(0);
    expect(gg.weight).toBe(-25);
  });

  it('fills the palace guard to 20 and credits the pool with 20 − elites instead of the real overflow', () => {
    const { q } = fixture([{ sector: 'P3', composition: Composition.QUEEN_DEFENCE, elites: 15 }]);
    const g = arrived(q, 'P3', 8);
    const gg = q.state.queen.garrisons[0];
    if (!gg) throw new Error('garrison');
    gg.pendingGroup = g.id;
    const pool = q.state.queen.reinforcementPool;
    evaluateGroupSituation(q, g);
    expect(sectorInfo(q.state.map, parseSectorString('P3')).numElites).toBe(20);
    expect(q.state.queen.reinforcementPool).toBe(pool + 5);
  });

  it('warps reinforcements into a live patrol and truncates it to 20, admins first', () => {
    const { q } = fixture([]);
    usePatrols(q, [{ size: 20, priority: 60, points: ['G4', 'G7'] }]);
    const patrol = createNewEnemyGroupDepartingFromSector(q, parseSectorId('G7'), 0, 18, 0);
    const pg = q.state.queen.patrols[0];
    if (!pg) throw new Error('patrol');
    pg.group = patrol.id;
    const g = arrived(q, 'G7', 3, 2);
    pg.pendingGroup = g.id;
    expect(evaluateGroupSituation(q, g)).toBe(true);
    expect(patrol.size).toBe(20);
    expect(patrol.enemy).toMatchObject({ numTroops: 20, numAdmins: 0 });
    expect(getGroup(q, g.id)).toBeUndefined();
    expect(pg.pendingGroup).toBe(0);
  });

  it('turns reinforcements of a destroyed patrol into the new patrol group', () => {
    const { q } = fixture([]);
    usePatrols(q, [{ size: 8, priority: 40, points: ['B1', 'C1', 'C3', 'A3'] }]);
    const pg = q.state.queen.patrols[0];
    if (!pg) throw new Error('patrol');
    const g = arrived(q, 'C1', 8);
    pg.pendingGroup = g.id;
    expect(evaluateGroupSituation(q, g)).toBe(true);
    expect(pg.group).toBe(g.id);
    expect(g.enemy?.intention).toBe(EnemyIntention.PATROL);
    expect(g.moveType).toBe(MoveType.ENDTOEND_FORWARDS);
    expect(g.waypoints.map(sectorId)).toEqual(['B1', 'C1', 'C3', 'A3'].map(parseSectorId));
    expect(g.betweenSectors).toBe(true);
    expect(g.next).toEqual(parseSectorString('B1'));
  });
});

describe('ReassignAIGroup (docs/17 §7.3)', () => {
  it('sends the group to the palace when nobody requests reinforcements', () => {
    const { q } = fixture([{ sector: 'M3', composition: Composition.LEVEL1_DEFENCE, troops: 20 }]);
    const g = arrived(q, 'K4', 6);
    expect(reassignAIGroup(q, g)).toBe(g);
    expect(g.enemy?.intention).toBe(EnemyIntention.REINFORCEMENTS);
    expect(g.betweenSectors).toBe(true);
    expect(g.waypoints.at(-1)).toEqual(parseSectorString('P3'));
  });

  it('transfers the group to the pool when every candidate fails', () => {
    const { q, rolls } = fixture([{ sector: 'B13', composition: Composition.DRASSEN_AIRPORT }]);
    q.state.clock.seconds = 86400 + 12 * 3600;
    const g = arrived(q, 'K4', 6);
    const pool = q.state.queen.reinforcementPool;
    rolls.push(0);
    expect(reassignAIGroup(q, g)).toBeNull();
    expect(q.state.queen.reinforcementPool).toBe(pool + 6);
    expect(getGroup(q, g.id)).toBeUndefined();
  });
});

describe('liberation grace and redirection (docs/17 §7.1, §9.3)', () => {
  it('blocks paths through a freshly liberated garrison sector and reroutes groups around it', () => {
    const { q, rolls } = fixture([{ sector: 'G9', composition: Composition.CAMBRIA_DEFENCE }]);
    const g = arrived(q, 'G7', 6);
    moveGroupFromSectorToSector(q, g, g.sector, parseSectorString('G11'));
    expect(g.waypoints.at(-1)).toEqual(parseSectorString('G11'));
    const element = q.state.map.elements[9 + 7 * 18];
    if (element) element.enemyControlled = false;
    rolls.push(0);
    strategicHandleQueenLosingControlOfSector(q, parseSectorString('G9'));
    const id = parseSectorId('G9');
    expect(sectorInfo(q.state.map, parseSectorString('G9')).timeLastPlayerLiberated).toBe(q.state.clock.seconds);
    expect(okayForEnemyToMoveThroughSector(q, id)).toBe(false);
    expect(enemyPermittedToAttackSector(q, null, id).permitted).toBe(false);
    expect(g.waypoints.at(-1)).toEqual(parseSectorString('G11'));
    expect(redirectEnemyGroupsMovingThroughSector(q, parseSectorString('G9'))).toBe(0);
    q.state.clock.seconds += 96 * 3600 + 1;
    expect(okayForEnemyToMoveThroughSector(q, id)).toBe(true);
    expect(q.state.queen.playerBattleVictories).toBe(1);
  });
});

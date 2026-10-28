import { beforeAll, describe, expect, it } from 'vitest';
import { awakeFixture, loadArmyTestContent, QueuedRolls } from '../../../../tests/support/queen.ts';
import { loadStrategicTestContent } from '../../../../tests/support/strategic.ts';
import type { ArmyContent } from '../../../content/strategic/army.ts';
import { parseSectorId, parseSectorString } from '../../../content/strategic/sector-ids.ts';
import type { StrategicContent } from '../../../content/strategic/strategic-content.ts';
import { SoldierClass, Team } from '../../tactical/soldier.ts';
import { InsertionCode } from '../forces/constants.ts';
import { createNewEnemyGroupDepartingFromSector, getGroup } from '../forces/groups.ts';
import { sectorInfo } from '../map/sectors.ts';
import { Composition } from './constants.ts';
import { addSoldierInitListEnemyDefenceSoldiers, type PlacementNode, sortSoldierInitList } from './defence-placement.ts';
import {
  addPossiblePendingEnemiesToBattle,
  assignEnemyGroupIds,
  BattlePlanKind,
  endTacticalBattleForEnemy,
  nextArrivingSoldierClass,
  prepareEnemyForSectorBattle,
  processQueenCmdImplicationsOfDeath,
} from './queen-command.ts';

let content: StrategicContent;
let army: ArmyContent;

beforeAll(async () => {
  content = await loadStrategicTestContent();
  army = await loadArmyTestContent();
});

function battleAt(sector: string, troops = 0, admins = 0, elites = 0) {
  const f = awakeFixture({ content, army, difficulty: 2 }, [{ sector, composition: Composition.DRASSEN_DEFENCE, troops, admins, elites }]);
  f.q.state.worldSector = parseSectorString(sector);
  return f;
}

function node(index: number, kind: 'PD' | 'P' | 'D' | 'B', soldierClass: number, team: number = Team.ENEMY): PlacementNode {
  return {
    index,
    team,
    soldierClass,
    priorityExistence: kind === 'PD' || kind === 'P',
    detailed: kind === 'PD' || kind === 'D',
    hasSoldier: false,
  };
}

describe('PrepareEnemyForSectorBattle', () => {
  it('puts the garrison and the groups in the sector into the battle up to 32 and leaves the rest pending', () => {
    const { q } = battleAt('D13', 20, 4, 2);
    const g = createNewEnemyGroupDepartingFromSector(q, parseSectorId('D13'), 1, 8, 3);
    const battle = prepareEnemyForSectorBattle(q);
    expect(battle.kind).toBe(BattlePlanKind.DEFENCE);
    expect(battle.defence).toEqual({ admins: 5, troops: 25, elites: 2 });
    expect(battle.stationary).toBe(26);
    expect(g.enemy).toMatchObject({ adminsInBattle: 1, troopsInBattle: 5, elitesInBattle: 0 });
    expect(q.state.encounter.pendingEnemies).toBe(true);
    expect(sectorInfo(q.state.map, parseSectorString('D13'))).toMatchObject({ troopsInBattle: 20, adminsInBattle: 4, elitesInBattle: 2 });
    const soldiers = [
      ...Array.from({ length: 20 }, () => ({ soldierClass: SoldierClass.ARMY, groupId: 0 })),
      { soldierClass: SoldierClass.ADMINISTRATOR, groupId: 0 },
      { soldierClass: SoldierClass.ARMY, groupId: 0 },
    ];
    assignEnemyGroupIds(q, battle, soldiers);
    expect(soldiers.filter((s) => s.groupId === g.id)).toHaveLength(6);
    expect(soldiers[4]?.groupId).toBe(g.id);
    expect(soldiers[5]?.groupId).toBe(0);
    expect(soldiers[20]?.groupId).toBe(g.id);
    expect(soldiers[21]?.groupId).toBe(0);
  });

  it('feeds pending enemies from the arrival side as slots free up', () => {
    const { q, rolls } = battleAt('D13');
    const g = createNewEnemyGroupDepartingFromSector(q, parseSectorId('D13'), 0, 30, 10);
    g.prev = parseSectorString('D14');
    prepareEnemyForSectorBattle(q);
    expect(g.enemy).toMatchObject({ troopsInBattle: 30, elitesInBattle: 2 });
    expect(q.state.encounter.pendingEnemies).toBe(true);
    expect(addPossiblePendingEnemiesToBattle(q, 3)).toEqual([
      { groupId: g.id, insertionCode: InsertionCode.EAST, admins: 0, troops: 0, elites: 3 },
    ]);
    expect(q.state.encounter.pendingEnemies).toBe(true);
    expect(addPossiblePendingEnemiesToBattle(q, 10)).toEqual([
      { groupId: g.id, insertionCode: InsertionCode.EAST, admins: 0, troops: 0, elites: 5 },
    ]);
    expect(q.state.encounter.pendingEnemies).toBe(false);
    rolls.push(2, 0, 0);
    const left = { admins: 1, troops: 1, elites: 1 };
    expect([nextArrivingSoldierClass(rolls, left), nextArrivingSoldierClass(rolls, left), nextArrivingSoldierClass(rolls, left)]).toEqual([
      SoldierClass.ADMINISTRATOR,
      SoldierClass.ELITE,
      SoldierClass.ARMY,
    ]);
    expect(rolls.ranges).toEqual([3, 2, 1]);
  });

  it('places the total underground counts while marking only the new ones in battle', () => {
    const { q } = battleAt('D13');
    const u = q.state.map.underground.find((x) => x.sector.x === 4 && x.sector.y === 11 && x.sector.z === 1);
    if (!u) throw new Error('K4 basement');
    u.numTroops = 6;
    u.troopsInBattle = 2;
    q.state.worldSector = { x: 4, y: 11, z: 1 };
    const battle = prepareEnemyForSectorBattle(q);
    expect(battle.kind).toBe(BattlePlanKind.UNDERGROUND);
    expect(battle.defence.troops).toBe(6);
    expect(u.troopsInBattle).toBe(6);
  });
});

describe('deaths and the end of a battle', () => {
  it('decrements the group by id, removes it when empty, and decrements the garrison otherwise', () => {
    const { q } = battleAt('D13', 3);
    const g = createNewEnemyGroupDepartingFromSector(q, parseSectorId('D13'), 0, 1, 0);
    const d13 = parseSectorString('D13');
    const dead = { profile: 200, team: Team.ENEMY, neutral: false, soldierClass: SoldierClass.ARMY, body: 0, sector: d13 };
    processQueenCmdImplicationsOfDeath(q, { ...dead, groupId: g.id });
    expect(getGroup(q, g.id)).toBeUndefined();
    sectorInfo(q.state.map, d13).troopsInBattle = 3;
    processQueenCmdImplicationsOfDeath(q, { ...dead, groupId: 0 });
    expect(sectorInfo(q.state.map, d13)).toMatchObject({ numTroops: 2, troopsInBattle: 2 });
    expect(q.state.queen.garrisons[0]?.weight).toBe(Math.trunc(((10 - 2) * 3 * 20) / 96));
    processQueenCmdImplicationsOfDeath(q, { ...dead, groupId: 0, neutral: true });
    expect(sectorInfo(q.state.map, d13).numTroops).toBe(2);
  });

  it('clears the in-battle counters and the creatures and reports abandoned militia', () => {
    const { q } = battleAt('D13', 3);
    const si = sectorInfo(q.state.map, parseSectorString('D13'));
    si.troopsInBattle = 3;
    si.numCreatures = 4;
    expect(endTacticalBattleForEnemy(q, { militia: true, enemies: true, creatures: false })).toBe(true);
    expect(si).toMatchObject({ troopsInBattle: 0, numCreatures: 0, numTroops: 3 });
    expect(endTacticalBattleForEnemy(q, { militia: true, enemies: false, creatures: false })).toBe(false);
  });
});

describe('enemy defence placements', () => {
  it('sorts into reversed PD, P and D blocks, then basic placements and existing soldiers', () => {
    const list = [
      node(0, 'B', SoldierClass.ARMY),
      node(1, 'PD', SoldierClass.ARMY),
      node(2, 'D', SoldierClass.ARMY),
      node(3, 'P', SoldierClass.ARMY),
      node(4, 'PD', SoldierClass.ELITE),
      node(5, 'B', SoldierClass.ADMINISTRATOR),
      node(6, 'D', SoldierClass.ARMY),
      { ...node(7, 'B', SoldierClass.ARMY), hasSoldier: true },
      node(8, 'P', SoldierClass.ARMY),
    ];
    expect(sortSoldierInitList(list).map((n) => n.index)).toEqual([4, 1, 8, 3, 6, 2, 0, 5, 7]);
  });

  it('examines only every second node of the PD block (Stracciatella)', () => {
    const sorted = sortSoldierInitList([
      node(0, 'PD', SoldierClass.ARMY),
      node(1, 'PD', SoldierClass.ARMY),
      node(2, 'PD', SoldierClass.ARMY),
      node(3, 'PD', SoldierClass.ARMY),
      node(4, 'B', SoldierClass.ARMY),
      node(5, 'B', SoldierClass.ARMY),
    ]);
    const placed: number[] = [];
    const rolls = new QueuedRolls().push(0, 0);
    addSoldierInitListEnemyDefenceSoldiers(sorted, { admins: 0, troops: 2, elites: 0 }, rolls, (n) => placed.push(n.index) > 0);
    expect(sorted.map((n) => n.index)).toEqual([3, 2, 1, 0, 4, 5]);
    expect(placed).toEqual([3, 1]);
    expect(rolls.ranges).toEqual([4, 3]);
  });

  it('overwrites the class of remaining priority placements and spreads leftovers over free placements', () => {
    const sorted = sortSoldierInitList([
      node(0, 'P', SoldierClass.ADMINISTRATOR),
      node(1, 'B', SoldierClass.ARMY),
      node(2, 'B', SoldierClass.ARMY),
      node(3, 'B', SoldierClass.ADMINISTRATOR, Team.CIV),
    ]);
    const placed: { index: number; soldierClass: number }[] = [];
    const rolls = new QueuedRolls().push(0, 1, 0);
    addSoldierInitListEnemyDefenceSoldiers(sorted, { admins: 0, troops: 0, elites: 3 }, rolls, (n) => {
      placed.push({ index: n.index, soldierClass: n.soldierClass });
      return true;
    });
    expect(placed).toEqual([
      { index: 0, soldierClass: SoldierClass.ELITE },
      { index: 1, soldierClass: SoldierClass.ELITE },
      { index: 2, soldierClass: SoldierClass.ELITE },
    ]);
    expect(rolls.ranges).toEqual([3, 2, 1]);
  });
});

import { beforeAll, describe, expect, it } from 'vitest';
import { awakeFixture, type GarrisonFixture, loadArmyTestContent, usePatrols } from '../../../../tests/support/queen.ts';
import { FakeMercs, loadStrategicTestContent } from '../../../../tests/support/strategic.ts';
import type { ArmyContent } from '../../../content/strategic/army.ts';
import { parseSectorId, parseSectorString } from '../../../content/strategic/sector-ids.ts';
import type { StrategicContent } from '../../../content/strategic/strategic-content.ts';
import { EnemyIntention, MoveType } from '../forces/constants.ts';
import {
  addPlayerToGroup,
  createNewEnemyGroupDepartingFromSector,
  createNewPlayerGroupDepartingFromSector,
  getGroup,
} from '../forces/groups.ts';
import { sectorInfo } from '../map/sectors.ts';
import { Fact } from '../narrative/fact-ids.ts';
import { setFact } from '../narrative/facts.ts';
import { EventKind } from '../time/constants.ts';
import { Composition, Meanwhile, StrategicAiAction } from './constants.ts';
import {
  attemptToNoticeAdjacentGroupSucceeds,
  checkEnemyControlledSector,
  enemyPermittedToAttackSector,
  strategicAILookForAdjacentGroups,
} from './detection.ts';
import {
  handleMeanwhileEvent,
  handleMeanwhileEventPostingForSamLiberation,
  handleMeanwhileEventPostingForTownLiberation,
} from './meanwhile.ts';
import { executeStrategicAIAction, strategicHandleMineThatRanOut, wakeUpQueen } from './reactions.ts';

let content: StrategicContent;
let army: ArmyContent;

beforeAll(async () => {
  content = await loadStrategicTestContent();
  army = await loadArmyTestContent();
});

function fixture(garrisons: readonly GarrisonFixture[], hour = 12, facts: Record<number, number> = {}) {
  const mercs = new FakeMercs();
  const f = awakeFixture({ content, army, difficulty: 2, mercs }, garrisons, 4, hour);
  for (const [id, value] of Object.entries(facts)) setFact(f.q.state.narrative, Number(id), value);
  return { ...f, mercs };
}

describe('notice rolls (docs/17 §8.1)', () => {
  it('uses the full alertness by day and a third at night, with decay on success', () => {
    const { q, rolls } = fixture([]);
    rolls.push(19, 20);
    expect(attemptToNoticeAdjacentGroupSucceeds(q)).toBe(true);
    expect(q.state.queen.alertness).toBe(0);
    expect(attemptToNoticeAdjacentGroupSucceeds(q)).toBe(false);
    expect(q.state.queen.alertness).toBe(1);
    q.state.clock.seconds = 5 * 86400 + 2 * 3600;
    q.state.queen.alertness = 30;
    rolls.push(10, 32);
    expect(attemptToNoticeAdjacentGroupSucceeds(q)).toBe(false);
    expect(q.state.queen.alertness).toBe(31);
    expect(rolls.ranges).toEqual([100, 100, 100, 100]);
  });
});

describe('who may be attacked (docs/17 §8.2)', () => {
  it('applies the Omerta and Drassen time gates, the Kingpin and hillbilly facts and the grace period', () => {
    const early = fixture([], 12);
    early.q.state.clock.seconds = 2 * 86400 + 7 * 3600 + 44 * 60;
    expect(enemyPermittedToAttackSector(early.q, null, parseSectorId('A9')).permitted).toBe(false);
    early.q.state.clock.seconds += 60;
    expect(enemyPermittedToAttackSector(early.q, null, parseSectorId('A10')).permitted).toBe(true);
    expect(enemyPermittedToAttackSector(early.q, null, parseSectorId('C13')).permitted).toBe(false);
    const late = fixture([]);
    expect(enemyPermittedToAttackSector(late.q, null, parseSectorId('C13')).permitted).toBe(true);
    expect(enemyPermittedToAttackSector(late.q, null, parseSectorId('C5')).permitted).toBe(false);
    expect(enemyPermittedToAttackSector(late.q, null, parseSectorId('F10')).permitted).toBe(true);
    const facts = fixture([], 12, { [Fact.KINGPIN_DEAD]: 1, [Fact.HILLBILLIES_KILLED]: 1 });
    expect(enemyPermittedToAttackSector(facts.q, null, parseSectorId('C5')).permitted).toBe(true);
    expect(enemyPermittedToAttackSector(facts.q, null, parseSectorId('F10')).permitted).toBe(false);
  });
});

describe('arrival look-around (docs/17 §8.4)', () => {
  it('looks north before west for an arriving enemy group and attacks the militia it notices', () => {
    const { q, rolls } = fixture([]);
    const g = createNewEnemyGroupDepartingFromSector(q, parseSectorId('G7'), 0, 8, 0);
    g.moveType = MoveType.ENDTOEND_FORWARDS;
    for (const s of ['F7', 'G6']) sectorInfo(q.state.map, parseSectorString(s)).militia[0] = 2;
    rolls.push(99, 0);
    expect(strategicAILookForAdjacentGroups(q, g)).toBe(false);
    expect(rolls.ranges).toEqual([100, 100]);
    expect(g.enemy?.intention).toBe(EnemyIntention.REINFORCEMENTS);
    expect(g.waypoints.at(-1)).toEqual(parseSectorString('G6'));
  });

  it('looks north, east, south and west from an arriving player group and sends the noticing patrol in pursuit', () => {
    const { q, rolls, mercs } = fixture([]);
    mercs.add({ id: 0, sector: parseSectorString('E8') });
    const pg = createNewPlayerGroupDepartingFromSector(q, parseSectorString('E8'));
    addPlayerToGroup(q, pg, 0);
    const north = createNewEnemyGroupDepartingFromSector(q, parseSectorId('D8'), 0, 6, 0);
    const east = createNewEnemyGroupDepartingFromSector(q, parseSectorId('E9'), 0, 6, 0);
    rolls.push(99, 0);
    expect(strategicAILookForAdjacentGroups(q, pg)).toBe(false);
    expect(north.enemy?.intention).toBe(0);
    expect(east.enemy?.intention).toBe(EnemyIntention.PURSUIT);
    expect(east.waypoints.at(-1)).toEqual(parseSectorString('E8'));
  });

  it('wakes the Queen when a one-way group reaches its destination and sends Omerta arrivals to the pool', () => {
    const { q } = fixture([{ sector: 'M3', composition: Composition.LEVEL1_DEFENCE, troops: 20 }]);
    q.state.queen.awake = false;
    q.state.queen.massFortificationOrdered = true;
    const g = createNewEnemyGroupDepartingFromSector(q, parseSectorId('A9'), 0, 6, 0);
    g.moveType = MoveType.ONE_WAY;
    strategicAILookForAdjacentGroups(q, g);
    expect(q.state.queen.awake).toBe(true);
    expect(g.waypoints.at(-1)).toEqual(parseSectorString('P3'));
  });

  it('lets a garrison split towards an important undefended town sector', () => {
    const { q, rolls } = fixture([
      { sector: 'B13', composition: Composition.DRASSEN_AIRPORT, admins: 10 },
      { sector: 'C13', composition: Composition.DRASSEN_DEFENCE },
    ]);
    rolls.push(0);
    checkEnemyControlledSector(q, parseSectorId('B13'));
    const gg = q.state.queen.garrisons[1];
    const g = getGroup(q, gg?.pendingGroup ?? 0);
    expect(g?.size).toBe(5);
    expect(g?.next).toEqual(parseSectorString('C13'));
    expect(sectorInfo(q.state.map, parseSectorString('B13')).numAdmins).toBe(5);
  });
});

describe('reactions (docs/17 §9)', () => {
  it('fortifies towns at wake from the nearest big patrol and converts the Omerta garrison', () => {
    const { q } = fixture([
      { sector: 'C13', composition: Composition.DRASSEN_DEFENCE, admins: 5 },
      { sector: 'A9', composition: Composition.OMERTA_WELCOME_WAGON, troops: 4 },
    ]);
    q.state.queen.massFortificationOrdered = false;
    usePatrols(q, [
      { size: 10, priority: 60, points: ['E12', 'E15'] },
      { size: 6, priority: 45, points: ['A11', 'A14', 'D14'] },
    ]);
    const near = createNewEnemyGroupDepartingFromSector(q, parseSectorId('E12'), 0, 10, 0);
    const far = createNewEnemyGroupDepartingFromSector(q, parseSectorId('A14'), 0, 6, 0);
    const patrols = q.state.queen.patrols;
    if (patrols[0]) patrols[0].group = near.id;
    if (patrols[1]) patrols[1].group = far.id;
    wakeUpQueen(q);
    const split = getGroup(q, q.state.queen.garrisons[0]?.pendingGroup ?? 0);
    expect(split?.size).toBe(5);
    expect(split?.sector).toEqual(parseSectorString('E12'));
    expect(near.size).toBe(5);
    expect(sectorInfo(q.state.map, parseSectorString('A9')).numTroops).toBe(0);
    expect(q.state.forces.groups.some((g) => !g.player && g.createdSectorId === parseSectorId('A9'))).toBe(true);
  });

  it('sends an elite squad to a liberated SAM site and reassigns the old pending group', () => {
    const { q } = fixture([{ sector: 'D15', composition: Composition.DRASSEN_SAMSITE }]);
    const old = createNewEnemyGroupDepartingFromSector(q, parseSectorId('D12'), 0, 4, 0);
    const gg = q.state.queen.garrisons[0];
    if (!gg) throw new Error('garrison');
    gg.pendingGroup = old.id;
    const pool = q.state.queen.reinforcementPool;
    executeStrategicAIAction(q, StrategicAiAction.SEND_TROOPS_TO_SAM, parseSectorString('D15'));
    const squad = getGroup(q, gg.pendingGroup);
    expect(squad?.enemy).toMatchObject({ numElites: 5, intention: EnemyIntention.REINFORCEMENTS });
    expect(squad?.id).not.toBe(old.id);
    expect(getGroup(q, old.id)).toBeUndefined();
    expect(q.state.queen.reinforcementPool).toBe(pool - 5 + 4);
  });

  it('runs liberation meanwhiles as skipped scenes five minutes later', () => {
    const { q } = fixture([{ sector: 'D15', composition: Composition.DRASSEN_SAMSITE }]);
    q.state.queen.awake = false;
    q.state.queen.massFortificationOrdered = true;
    handleMeanwhileEventPostingForTownLiberation(q, 2);
    handleMeanwhileEventPostingForTownLiberation(q, 2);
    handleMeanwhileEventPostingForSamLiberation(q, 1);
    const scenes = q.state.queue.events.filter((e) => e.kind === EventKind.MEANWHILE);
    expect(scenes.map((e) => e.param)).toEqual([Meanwhile.DRASSEN_LIBERATED, Meanwhile.NE_SAM]);
    for (const e of scenes) handleMeanwhileEvent(q, e);
    expect(q.state.queen.awake).toBe(true);
    expect(getGroup(q, q.state.queen.garrisons[0]?.pendingGroup ?? 0)?.enemy?.numElites).toBe(5);
  });

  it('quarters the priorities of the mine garrisons when a mine runs out', () => {
    const { q } = fixture([
      { sector: 'A2', composition: Composition.CHITZENA_DEFENCE },
      { sector: 'B2', composition: Composition.CHITZENA_MINE },
    ]);
    strategicHandleMineThatRanOut(q, parseSectorId('B2'));
    expect(q.state.queen.compositions[Composition.CHITZENA_DEFENCE]?.priority).toBe(7);
    expect(q.state.queen.compositions[Composition.CHITZENA_MINE]?.priority).toBe(10);
  });
});

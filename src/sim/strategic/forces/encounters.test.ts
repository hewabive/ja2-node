import { beforeAll, describe, expect, it } from 'vitest';
import { FakeMercs, loadStrategicTestContent, ScriptedRolls, testContext } from '../../../../tests/support/strategic.ts';
import { parseSectorId, parseSectorString, type Sector } from '../../../content/strategic/sector-ids.ts';
import type { StrategicContent } from '../../../content/strategic/strategic-content.ts';
import { initializeMapStructure, initStrategicMovementCosts } from '../map/init.ts';
import { sectorInfo } from '../map/sectors.ts';
import { Fact } from '../narrative/fact-ids.ts';
import { setFact } from '../narrative/facts.ts';
import { createStrategicState } from '../state.ts';
import { EventKind, NUM_SEC_IN_DAY, NUM_SEC_IN_HOUR } from '../time/constants.ts';
import { addStrategicEvent } from '../time/event-queue.ts';
import { EncounterCode, GroupFlag, InsertionCode, PauseLock } from './constants.ts';
import { answerSimultaneousArrival, checkConditionsForBattle, testForBloodcatAmbush } from './encounters.ts';
import { PreBattleNotice } from './flow-state.ts';
import { addPlayerToGroup, createNewEnemyGroupDepartingFromSector, createNewPlayerGroupDepartingFromSector, type Group } from './groups.ts';
import { groupArrivedAtSector, nowMinutes } from './movement.ts';
import type { StrategicContext } from './ports.ts';

let content: StrategicContent;

beforeAll(async () => {
  content = await loadStrategicTestContent();
});

const S = (name: string): Sector => parseSectorString(name);
const NOON = NUM_SEC_IN_DAY + 12 * NUM_SEC_IN_HOUR;

interface Setup {
  readonly ctx: StrategicContext;
  readonly mercs: FakeMercs;
  readonly pre: ScriptedRolls;
  readonly rolls: ScriptedRolls;
}

function setup(o: { pre?: number[]; rolls?: number[]; facts?: Record<number, number>; enemyInSector?: boolean } = {}): Setup {
  const mercs = new FakeMercs();
  const pre = new ScriptedRolls(o.pre ?? []);
  const rolls = new ScriptedRolls(o.rolls ?? []);
  const ctx = testContext({
    content,
    mercs,
    state: createStrategicState({ worldSeconds: NOON }),
    random: rolls,
    preRandom: pre,
    world: { enemyInSector: () => o.enemyInSector === true },
  });
  for (const [id, value] of Object.entries(o.facts ?? {})) setFact(ctx.state.narrative, Number(id), value);
  initializeMapStructure(ctx);
  initStrategicMovementCosts(ctx);
  for (const e of ctx.state.map.elements) e.enemyControlled = true;
  for (const info of ctx.state.map.sectors) info.bloodCats = -1;
  return { ctx, mercs, pre, rolls };
}

function squad(s: Setup, sector: Sector, ids: readonly number[], life = 80): Group {
  const g = createNewPlayerGroupDepartingFromSector(s.ctx, sector);
  for (const id of ids) {
    s.mercs.add({ id, sector, life });
    addPlayerToGroup(s.ctx, g, id);
  }
  return g;
}

function arriving(g: Group, from: Sector, to: Sector, arrivalTime: number): void {
  g.sector = from;
  g.next = to;
  g.betweenSectors = true;
  g.arrivalTime = arrivalTime;
}

describe('CheckConditionsForBattle', () => {
  it('hands a player group meeting enemies to the pre-battle interface', () => {
    const s = setup();
    sectorInfo(s.ctx.state.map, S('C9')).numTroops = 3;
    const g = squad(s, S('C9'), [0, 1]);
    expect(checkConditionsForBattle(s.ctx, g)).toBe(true);
    expect(s.ctx.state.encounter.preBattle).toMatchObject({
      battleGroupId: g.id,
      dialogGroupId: g.id,
      sector: S('C9'),
      notice: null,
      speakerCandidates: [0, 1],
      combatAbleMerc: true,
    });
    expect(s.ctx.state.clock).toMatchObject({ paused: true, pauseLocked: true, pauseLockReason: PauseLock.PREBATTLE, timeInterrupt: true });
  });

  it('lets a player group pass an empty sector', () => {
    const s = setup({ pre: [50] });
    const g = squad(s, S('C9'), [0]);
    expect(checkConditionsForBattle(s.ctx, g)).toBe(false);
    expect(s.ctx.state.encounter.preBattle).toBeNull();
  });

  it('starts a battle when an enemy group finds conscious mercs', () => {
    const s = setup();
    const defenders = squad(s, S('C9'), [0]);
    const enemy = createNewEnemyGroupDepartingFromSector(s.ctx, parseSectorId('C9'), 0, 4, 0);
    expect(checkConditionsForBattle(s.ctx, enemy)).toBe(true);
    expect(s.ctx.state.encounter.preBattle).toMatchObject({ battleGroupId: enemy.id, dialogGroupId: defenders.id, militiaPresent: false });
  });

  it('goes to autoresolve when only unconscious mercs are attacked', () => {
    const s = setup();
    squad(s, S('C9'), [0], 10);
    const enemy = createNewEnemyGroupDepartingFromSector(s.ctx, parseSectorId('C9'), 0, 4, 0);
    expect(checkConditionsForBattle(s.ctx, enemy)).toBe(true);
    expect(s.ctx.state.encounter).toMatchObject({ delayAutoResolveStart: true, usePersistentPBI: true });
    expect(s.ctx.state.encounter.preBattle).toMatchObject({ notice: PreBattleNotice.UNCONSCIOUS_MERCS_ATTACKED, dialogGroupId: null });
  });

  it('notifies an invasion of a player town defended by militia only', () => {
    const s = setup();
    const town = S('A9');
    sectorInfo(s.ctx.state.map, town).militia[0] = 5;
    const element = s.ctx.state.map.elements[9 + 18];
    if (element) element.enemyControlled = false;
    const enemy = createNewEnemyGroupDepartingFromSector(s.ctx, parseSectorId('A9'), 0, 4, 0);
    expect(checkConditionsForBattle(s.ctx, enemy)).toBe(true);
    expect(s.ctx.state.encounter.preBattle).toMatchObject({ notice: PreBattleNotice.INVASION, militiaPresent: true });
  });

  it('ignores enemies arriving where nobody alive and no militia is', () => {
    const s = setup();
    squad(s, S('C9'), [0], 0);
    const enemy = createNewEnemyGroupDepartingFromSector(s.ctx, parseSectorId('C9'), 0, 4, 0);
    expect(checkConditionsForBattle(s.ctx, enemy)).toBe(false);
    const elsewhere = createNewEnemyGroupDepartingFromSector(s.ctx, parseSectorId('D9'), 0, 4, 0);
    expect(checkConditionsForBattle(s.ctx, elsewhere)).toBe(false);
  });

  it('sends a player group into the running battle of the loaded sector as reinforcements', () => {
    const s = setup({ enemyInSector: true });
    squad(s, S('C9'), [0]);
    s.ctx.state.worldSector = S('C9');
    const late = squad(s, S('C9'), [3]);
    late.prev = S('C10');
    expect(checkConditionsForBattle(s.ctx, late)).toBe(true);
    expect(s.mercs.get(3)?.insertionCode).toBe(InsertionCode.EAST);
    expect(s.mercs.placedInSector).toEqual([3]);
  });
});

describe('simultaneous arrivals', () => {
  it('asks to coordinate and, on yes, lets every group arrive at the latest arrival time', () => {
    const s = setup();
    sectorInfo(s.ctx.state.map, S('C9')).numTroops = 3;
    const now = nowMinutes(s.ctx);
    const first = squad(s, S('B9'), [0]);
    const second = squad(s, S('C8'), [1]);
    arriving(first, S('B9'), S('C9'), now);
    arriving(second, S('C8'), S('C9'), now + 40);
    groupArrivedAtSector(s.ctx, first, true, false);
    expect(s.ctx.state.encounter.simultaneousArrival).toMatchObject({ groupId: first.id, nearbyGroups: 1, bloodcats: false });
    expect(s.ctx.state.clock).toMatchObject({ paused: true, pauseLockReason: PauseLock.SIMULTANEOUS_ARRIVAL });
    expect(s.ctx.state.encounter.preBattle).toBeNull();
    answerSimultaneousArrival(s.ctx, true);
    expect(first).toMatchObject({ sector: S('B9'), next: S('C9'), betweenSectors: true, arrivalTime: now + 40 });
    expect(second.flags & GroupFlag.SIMULTANEOUSARRIVAL_APPROVED).toBeTruthy();
    expect(s.ctx.state.clock.paused).toBe(false);
  });

  it('opens the pre-battle interface for the first group when the player declines', () => {
    const s = setup();
    sectorInfo(s.ctx.state.map, S('C9')).numTroops = 3;
    const now = nowMinutes(s.ctx);
    const first = squad(s, S('B9'), [0]);
    const second = squad(s, S('C8'), [1]);
    arriving(first, S('B9'), S('C9'), now);
    arriving(second, S('C8'), S('C9'), now + 40);
    groupArrivedAtSector(s.ctx, first, true, false);
    answerSimultaneousArrival(s.ctx, false);
    expect(s.ctx.state.encounter.preBattle).toMatchObject({ battleGroupId: first.id, dialogGroupId: first.id });
  });

  it('pulls groups arriving in the same second into the battle sector and releases their flags', () => {
    const s = setup();
    sectorInfo(s.ctx.state.map, S('C9')).numTroops = 3;
    const now = nowMinutes(s.ctx);
    const player = squad(s, S('B9'), [0]);
    arriving(player, S('B9'), S('C9'), now);
    const enemy = createNewEnemyGroupDepartingFromSector(s.ctx, parseSectorId('D9'), 0, 2, 0);
    arriving(enemy, S('D9'), S('C9'), now);
    addStrategicEvent(s.ctx.state.queue, EventKind.GROUP_ARRIVAL, now, enemy.id);
    groupArrivedAtSector(s.ctx, player, true, false);
    expect(enemy).toMatchObject({ sector: S('C9'), betweenSectors: false, flags: 0 });
    expect(s.ctx.state.queue.events).toHaveLength(0);
    expect(s.ctx.state.movement.numGroupsArrivedSimultaneously).toBe(0);
    expect(s.ctx.state.encounter.preBattle?.battleGroupId).toBe(player.id);
  });
});

describe('TestForBloodcatAmbush', () => {
  it('rolls the first visit with PreChance and sizes the pack by difficulty, progress and mercs', () => {
    const s = setup({ pre: [5], rolls: [1] });
    const info = sectorInfo(s.ctx.state.map, S('C3'));
    info.bloodCatPlacements = 12;
    const g = squad(s, S('C3'), [0, 1]);
    expect(testForBloodcatAmbush(s.ctx, g)).toBe(true);
    expect(info.bloodCats).toBe(3);
    expect(s.ctx.state.encounter.code).toBe(EncounterCode.BLOODCAT_AMBUSH);
    expect(s.pre.ranges).toEqual([100]);
    expect(s.rolls.ranges).toEqual([4]);
  });

  it('keeps rolling until the first ambush happens and rarely ambushes twice', () => {
    const s = setup({ pre: [50, 60, 99] });
    const info = sectorInfo(s.ctx.state.map, S('C3'));
    info.bloodCatPlacements = 12;
    const g = squad(s, S('C3'), [0]);
    expect(testForBloodcatAmbush(s.ctx, g)).toBe(false);
    expect(info.bloodCats).toBe(-1);
    info.bloodCats = 4;
    expect(testForBloodcatAmbush(s.ctx, g)).toBe(false);
    expect(testForBloodcatAmbush(s.ctx, g)).toBe(true);
    info.bloodCats = 0;
    expect(testForBloodcatAmbush(s.ctx, g)).toBe(false);
    expect(s.pre.ranges).toHaveLength(4);
  });

  it('fills the lair from its placements and calls it a lair entrance once the lair is known', () => {
    const s = setup({ facts: { [Fact.PLAYER_KNOWS_ABOUT_BLOODCAT_LAIR]: 1 } });
    const info = sectorInfo(s.ctx.state.map, S('I16'));
    info.bloodCatPlacements = 19;
    const g = squad(s, S('I16'), [0]);
    expect(testForBloodcatAmbush(s.ctx, g)).toBe(true);
    expect(info.bloodCats).toBe(19);
    expect(s.ctx.state.encounter.code).toBe(EncounterCode.ENTERING_BLOODCAT_LAIR);
    expect(s.pre.ranges).toEqual([]);
  });

  it('turns a bloodcat ambush into a pre-battle hand-off with its notice', () => {
    const s = setup({ pre: [0], rolls: [3] });
    sectorInfo(s.ctx.state.map, S('C3')).bloodCatPlacements = 12;
    const g = squad(s, S('C3'), [0, 1]);
    expect(checkConditionsForBattle(s.ctx, g)).toBe(true);
    expect(s.ctx.state.encounter).toMatchObject({ usePersistentPBI: true, code: EncounterCode.BLOODCAT_AMBUSH });
    expect(s.ctx.state.encounter.preBattle).toMatchObject({ notice: PreBattleNotice.BLOODCAT_BATTLE, bloodcatAmbush: true });
  });
});

import { beforeAll, describe, expect, it } from 'vitest';
import { type EconomyTestContent, FakeCrew, loadEconomyTestContent, setTownNames } from '../../../../tests/support/economy.ts';
import { ScriptedRolls, testContext } from '../../../../tests/support/strategic.ts';
import { type Sector, sectorId } from '../../../content/strategic/sector-ids.ts';
import { createEconomyContext } from '../economy/context.ts';
import type { EconomyContext } from '../economy/ports.ts';
import { sectorInfo } from '../map/sectors.ts';
import { createStrategicState } from '../state.ts';
import { EncounterCode, SectorFlag } from './constants.ts';
import { addPlayerToGroup, createNewEnemyGroupDepartingFromSector, createNewPlayerGroupDepartingFromSector, type Group } from './groups.ts';
import { initPreBattleInterface, nonPersistentAutoresolveRefusal } from './pre-battle.ts';

let content: EconomyTestContent;

beforeAll(async () => {
  content = await loadEconomyTestContent();
});

const DRASSEN: Sector = { x: 13, y: 4, z: 0 };
const WILDERNESS: Sector = { x: 6, y: 6, z: 0 };

interface Setup {
  readonly stationary?: number;
  readonly progress?: number;
  readonly random?: readonly number[];
  readonly pre?: readonly number[];
  readonly difficulty?: number;
}

interface Harness {
  readonly ctx: EconomyContext;
  readonly random: ScriptedRolls;
  readonly pre: ScriptedRolls;
  readonly crew: FakeCrew;
}

function harness(o: Setup = {}): Harness {
  const crew = new FakeCrew();
  const random = new ScriptedRolls(o.random);
  const pre = new ScriptedRolls(o.pre);
  const strategic = testContext({
    content: content.strategic,
    state: createStrategicState({ options: { difficulty: o.difficulty ?? 2 } }),
    mercs: crew,
    random,
    preRandom: pre,
    ai: { numStationaryEnemiesInSector: () => o.stationary ?? 0, progressPercentage: () => o.progress ?? 0 },
  });
  const ctx = createEconomyContext(strategic, { economy: content.economy, items: content.items, crew });
  crew.economy = ctx;
  setTownNames(ctx);
  return { ctx, random, pre, crew };
}

function squadIn(h: Harness, s: Sector, count: number, life = 80): Group {
  const g = createNewPlayerGroupDepartingFromSector(h.ctx, s);
  for (let id = 0; id < count; id++) {
    h.crew.add({ id, sector: s, assignment: 0, life });
    addPlayerToGroup(h.ctx, g, id);
  }
  return g;
}

function enemiesIn(h: Harness, s: Sector, troops: number): Group {
  return createNewEnemyGroupDepartingFromSector(h.ctx, sectorId(s), 0, troops, 0);
}

const choices = (opening: ReturnType<typeof initPreBattleInterface>) =>
  opening?.options.map((o) => [o.choice, o.enabled, o.reason ?? null]) ?? null;

describe('the pre-battle interface', () => {
  it('codes an enemy group entering a town as an invasion with every button enabled', () => {
    const h = harness();
    squadIn(h, DRASSEN, 2);
    const enemies = enemiesIn(h, DRASSEN, 4);
    const opening = initPreBattleInterface(h.ctx, enemies, true);
    expect(h.ctx.state.encounter.code).toBe(EncounterCode.ENEMY_INVASION);
    expect(choices(opening)).toEqual([
      ['autoresolve', true, null],
      ['enterSector', true, null],
      ['retreat', true, null],
    ]);
    expect(h.ctx.state.battle.firstBattle.beingFought).toBe(true);
  });

  it('codes an enemy group in the wilderness as an encounter and remembers that the player knows the count', () => {
    const h = harness();
    squadIn(h, WILDERNESS, 1);
    initPreBattleInterface(h.ctx, enemiesIn(h, WILDERNESS, 3), true);
    expect(h.ctx.state.encounter.code).toBe(EncounterCode.ENEMY_ENCOUNTER);
    expect(sectorInfo(h.ctx.state.map, WILDERNESS).flags & SectorFlag.PLAYER_KNOWS_ENEMIES_ARE_HERE).not.toBe(0);
    expect(h.ctx.state.battle.resetAllPlayerKnowsEnemiesFlags).toBe(true);
  });

  it('refuses autoresolve when the player attacks a garrison', () => {
    const h = harness({ stationary: 5 });
    const squad = squadIn(h, WILDERNESS, 2);
    expect(choices(initPreBattleInterface(h.ctx, squad, true))).toEqual([
      ['autoresolve', false, 'playerInitiatedAttack'],
      ['enterSector', true, null],
      ['retreat', true, null],
    ]);
    expect(h.random.ranges).toEqual([]);
    expect(h.pre.ranges).toEqual([]);
  });

  it('rolls chance(90) on main for a high-potential ambush', () => {
    const ambush = harness({ random: [89] });
    const squad = squadIn(ambush, WILDERNESS, 2);
    enemiesIn(ambush, WILDERNESS, 4);
    ambush.ctx.state.encounter.highPotentialForAmbush = true;
    expect(choices(initPreBattleInterface(ambush.ctx, squad, true))).toEqual([
      ['autoresolve', false, 'ambush'],
      ['enterSector', true, null],
      ['retreat', false, 'ambush'],
    ]);
    expect(ambush.random.ranges).toEqual([100]);
    expect(ambush.ctx.state.encounter.highPotentialForAmbush).toBe(false);
    const missed = harness({ random: [90] });
    const other = squadIn(missed, WILDERNESS, 2);
    missed.ctx.state.encounter.highPotentialForAmbush = true;
    initPreBattleInterface(missed.ctx, other, true);
    expect(missed.ctx.state.encounter.code).toBe(EncounterCode.ENEMY_ENCOUNTER);
  });

  it('never rolls the random ambush while a conscious merc scouts the sector (Q2)', () => {
    const h = harness({ progress: 90 });
    const squad = squadIn(h, WILDERNESS, 1);
    enemiesIn(h, WILDERNESS, 6);
    initPreBattleInterface(h.ctx, squad, true);
    expect(h.ctx.state.encounter.code).toBe(EncounterCode.ENEMY_ENCOUNTER);
    expect(h.pre.ranges).toEqual([]);
  });

  it('rolls pre(100) against 4 + 2·difficulty + progress/10 when nobody can scout', () => {
    const chance = 4 + 2 * 2 + 4;
    const hit = harness({ progress: 40, pre: [chance - 1] });
    const squad = squadIn(hit, WILDERNESS, 1, 10);
    enemiesIn(hit, WILDERNESS, 6);
    initPreBattleInterface(hit.ctx, squad, true);
    expect(hit.ctx.state.encounter.code).toBe(EncounterCode.ENEMY_AMBUSH);
    expect(hit.pre.ranges).toEqual([100]);
    const miss = harness({ progress: 40, pre: [chance] });
    const other = squadIn(miss, WILDERNESS, 1, 10);
    enemiesIn(miss, WILDERNESS, 6);
    initPreBattleInterface(miss.ctx, other, true);
    expect(miss.ctx.state.encounter.code).toBe(EncounterCode.ENEMY_ENCOUNTER);
  });

  it('consumes the cannot-retreat flag of an intercepted retreat', () => {
    const h = harness();
    squadIn(h, WILDERNESS, 1);
    h.ctx.state.encounter.cantRetreatInPBI = true;
    const opening = initPreBattleInterface(h.ctx, enemiesIn(h, WILDERNESS, 2), true);
    expect(choices(opening)?.[2]).toEqual(['retreat', false, 'cannotRetreat']);
    expect(h.ctx.state.encounter.cantRetreatInPBI).toBe(false);
  });

  it('disables enter and retreat for an automatic start', () => {
    const h = harness();
    squadIn(h, DRASSEN, 1);
    h.ctx.state.battle.autoStart = true;
    expect(choices(initPreBattleInterface(h.ctx, enemiesIn(h, DRASSEN, 2), true))).toEqual([
      ['autoresolve', true, null],
      ['enterSector', false, 'autoStart'],
      ['retreat', false, 'autoStart'],
    ]);
  });

  it('allows the non-persistent autoresolve only for invasions, encounters and creature attacks', () => {
    expect(nonPersistentAutoresolveRefusal(EncounterCode.ENEMY_INVASION)).toBeNull();
    expect(nonPersistentAutoresolveRefusal(EncounterCode.ENEMY_ENCOUNTER)).toBeNull();
    expect(nonPersistentAutoresolveRefusal(EncounterCode.CREATURE_ATTACK)).toBeNull();
    expect(nonPersistentAutoresolveRefusal(EncounterCode.ENTERING_ENEMY_SECTOR)).toBe('enteringEnemySector');
    expect(nonPersistentAutoresolveRefusal(EncounterCode.ENEMY_AMBUSH)).toBe('ambush');
    expect(nonPersistentAutoresolveRefusal(EncounterCode.HOSTILE_CIVILIANS)).toBe('hostileCivilians');
    expect(nonPersistentAutoresolveRefusal(EncounterCode.HOSTILE_BLOODCATS)).toBe('bloodcats');
  });
});

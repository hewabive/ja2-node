import { beforeAll, describe, expect, it } from 'vitest';
import { type EconomyTestContent, loadEconomyTestContent } from '../../../../tests/support/economy.ts';
import { CreatureHabitat } from '../../../content/strategic/creature-lairs.ts';
import { parseSectorString, type Sector, sectorFromId, sectorId, strategicIndex } from '../../../content/strategic/sector-ids.ts';
import { createMineStatus } from '../economy/state.ts';
import { ScriptedStream } from '../forces/autoresolve/replay-rng.ts';
import { SectorFlag } from '../forces/constants.ts';
import type { RollSource } from '../forces/ports.ts';
import { createUndergroundSector, findUndergroundSector, sectorInfo } from '../map/sectors.ts';
import { createStrategicState, type StrategicState } from '../state.ts';
import { EventKind } from '../time/constants.ts';
import {
  type CreatureContext,
  creatureNightPlanning,
  distributeCreaturesByWeight,
  endCreatureQuest,
  initCreatureQuest,
  LAIR_DESTROYED,
  mineClearOfMonsters,
  spreadCreatures,
  warpOutOfMineCodes,
} from './creatures.ts';
import { creatureAttackTown, type TownAttackPorts } from './town-attack.ts';

const DRASSEN_MINE = 1;
const DRASSEN_EXIT: Sector = { x: 13, y: 4, z: 1 };

let content: EconomyTestContent;

beforeAll(async () => {
  content = await loadEconomyTestContent();
});

function rolls(values: readonly number[], fallback: number | null = null): RollSource & { readonly stream: ScriptedStream } {
  const stream = new ScriptedStream(values, fallback);
  return { stream, int: (n) => stream.int(n), chance: (p) => stream.int(100) < p };
}

function state(difficulty = 1): StrategicState {
  const s = createStrategicState({ options: { difficulty, sciFi: true } });
  s.map.underground = content.strategic.underground.map((t) => createUndergroundSector(sectorFromId(t.sector, t.z), t.adjacentSectors));
  s.economy.mines = content.economy.mines.map(() => createMineStatus());
  for (const e of s.map.elements) e.enemyControlled = true;
  return s;
}

function context(s: StrategicState, random: RollSource, preRandom: RollSource = rolls([])): CreatureContext & { meanwhiles: number } {
  const ctx = {
    state: s,
    lairs: content.strategic.creatureLairs,
    mines: content.economy.mines,
    random,
    preRandom,
    meanwhiles: 0,
    scheduleCreatureMeanwhile: () => {
      ctx.meanwhiles++;
    },
  };
  return ctx;
}

function playerControls(s: StrategicState, ...names: string[]): void {
  for (const n of names) {
    const e = s.map.elements[strategicIndex(parseSectorString(n))];
    if (e) e.enemyControlled = false;
  }
}

function underground(s: StrategicState, name: string, z: number) {
  const u = findUndergroundSector(s.map, { ...parseSectorString(name), z });
  if (!u) throw new Error(`no underground ${name}/${z}`);
  return u;
}

describe('creature quest (docs/17 §12.1)', () => {
  it('schedules the meanwhile once, needs an infestible mine, picks one at random and posts the spread and night events', () => {
    const s = state();
    const none = context(s, rolls([]));
    initCreatureQuest(none);
    expect(s.creatures.lairId).toBe(0);
    expect([none.meanwhiles, s.creatures.meanwhileScenePlayed]).toEqual([1, true]);
    playerControls(s, 'D13', 'I14', 'H8');
    const r = rolls([0, 0], 0);
    const ctx = context(s, r);
    initCreatureQuest(ctx);
    expect(ctx.meanwhiles).toBe(0);
    expect(s.creatures.lairId).toBe(1);
    expect(r.stream.requested[0]).toBe(3);
    expect(underground(s, 'F13', 3).creatureHabitat).toBe(CreatureHabitat.QUEEN_LAIR);
    expect(underground(s, 'D13', 1).creatureHabitat).toBe(CreatureHabitat.MINE_EXIT);
    expect(underground(s, 'E13', 1).flags & SectorFlag.PENDING_ALTERNATE_MAP).toBe(SectorFlag.PENDING_ALTERNATE_MAP);
    expect(s.queue.events.map((e) => e.kind).sort()).toEqual([EventKind.CREATURE_SPREAD, EventKind.CREATURE_NIGHT_PLANNING].sort());
    expect(s.creatures.habitatedDistance).toBeGreaterThan(0);
  });

  it('spreads every newborn into the lair: the queen keeps growing while her chance holds', () => {
    const s = state();
    playerControls(s, 'D13', 'I14', 'H8');
    initCreatureQuest(context(s, rolls([0], 0)));
    const total = () => s.map.underground.reduce((n, u) => n + u.numCreatures, 0);
    const before = total();
    spreadCreatures(context(s, rolls([1], 0)));
    expect(total()).toBe(before + 7);
  });

  it('plans a night attack from a crowded mine exit with the PreRandom rolls', () => {
    const s = state();
    playerControls(s, 'D13', 'I14', 'H8');
    initCreatureQuest(context(s, rolls([0], 0)));
    underground(s, 'D13', 1).numCreatures = 6;
    creatureNightPlanning(context(s, rolls([]), rolls([10, 99], 99)));
    const attack = s.queue.events.find((e) => e.kind === EventKind.CREATURE_ATTACK);
    expect(attack?.param).toBe(sectorId({ x: 13, y: 4 }));
  });

  it('ends: other lair levels, the Tixa cave and all surface creatures are cleared and mines count as clear', () => {
    const s = state();
    playerControls(s, 'D13', 'I14', 'H8');
    initCreatureQuest(context(s, rolls([0], 0)));
    underground(s, 'D13', 1).numCreatures = 4;
    sectorInfo(s.map, { x: 13, y: 4 }).numCreatures = 3;
    const status = s.economy.mines[DRASSEN_MINE];
    if (status) status.prevInvadedByMonsters = true;
    const ctx = context(s, rolls([]));
    expect(mineClearOfMonsters(ctx, DRASSEN_MINE)).toBe(false);
    endCreatureQuest(ctx);
    expect(s.creatures.lairId).toBe(LAIR_DESTROYED);
    expect(underground(s, 'D13', 1).numCreatures).toBe(0);
    expect(underground(s, 'F13', 3).numCreatures).toBeGreaterThan(0);
    expect(sectorInfo(s.map, { x: 13, y: 4 }).numCreatures).toBe(0);
    expect(mineClearOfMonsters(ctx, DRASSEN_MINE)).toBe(true);
    expect(warpOutOfMineCodes(ctx, DRASSEN_EXIT)).toEqual({ sector: { x: 13, y: 4, z: 0 }, gridNo: 20700 });
  });

  it('distributes creatures by habitat weights with one 100-roll each', () => {
    const r = rolls([0, 9, 10, 74, 75, 79, 80, 99]);
    expect(distributeCreaturesByWeight(r, 8, [0, 0, 10, 65, 5, 20])).toEqual([0, 0, 2, 2, 2, 2]);
  });
});

describe('creature town attacks (docs/19 §1.2)', () => {
  function ports(overrides: Partial<TownAttackPorts> = {}): TownAttackPorts & { eaten: number; battle: number | null } {
    const p = {
      eaten: 0,
      battle: null as number | null,
      enemyInLoadedSector: () => false,
      playerGroupsInSector: () => false,
      loadedSector: () => null,
      inTacticalScreen: () => false,
      militiaInSector: () => 0,
      creaturesEatCivilians: (_s: Sector, n: number) => {
        p.eaten += n;
      },
      beginCreatureBattle: (code: number) => {
        p.battle = code;
      },
      ...overrides,
    };
    return p;
  }

  function questState(): StrategicState {
    const s = state();
    playerControls(s, 'D13', 'I14', 'H8', 'C13', 'B13');
    initCreatureQuest(context(s, rolls([0], 0)));
    underground(s, 'D13', 1).numCreatures = 7;
    return s;
  }

  it('eats civilians of a player-held town sector nobody defends and dates the attack on the mine sector', () => {
    const s = questState();
    const p = ports();
    creatureAttackTown({ ...context(s, rolls([60])), ports: p }, sectorId({ x: 13, y: 4 }), false);
    expect(p.eaten).toBe(7);
    expect(s.creatures.attack.sectorId).toBe(sectorId({ x: 13, y: 3 }));
    expect(sectorInfo(s.map, { x: 13, y: 4 }).dayOfLastCreatureAttack).toBe(1);
    expect(underground(s, 'D13', 1).numCreatures).toBe(0);
  });

  it('hands militia-only sectors to autoresolve and player groups to the pre-battle interface', () => {
    const s = questState();
    const militia = ports({ militiaInSector: () => 3 });
    creatureAttackTown({ ...context(s, rolls([0])), ports: militia }, sectorId({ x: 13, y: 4 }), false);
    expect(militia.battle).toBe(4);
    const groups = ports({ playerGroupsInSector: () => true });
    creatureAttackTown({ ...context(s, rolls([])), ports: groups }, sectorId({ x: 13, y: 4 }), true);
    expect(groups.battle).toBe(3);
    expect(s.creatures.attack.numAttacking).toBe(5);
  });

  it('reposts itself while a battle runs in the loaded sector', () => {
    const s = questState();
    const p = ports({ enemyInLoadedSector: () => true });
    creatureAttackTown({ ...context(s, rolls([4])), ports: p }, sectorId({ x: 13, y: 4 }), false);
    expect(s.queue.events.filter((e) => e.kind === EventKind.CREATURE_ATTACK)).toHaveLength(1);
    expect(underground(s, 'D13', 1).numCreatures).toBe(7);
  });
});

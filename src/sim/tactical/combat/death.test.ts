import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { newCombatSim, runUntilIdle, spawnSoldier } from '../../../../tests/support/combat.ts';
import { spawnCreature } from '../../../../tests/support/creatures.ts';
import { ORIGINAL_DATA_DIR } from '../../../../tests/support/original-data.ts';
import { loadTestContent } from '../../../../tests/support/tactical.ts';
import { withGraphicFacts } from '../../../content/rules/graphic-facts.ts';
import { vfsFileReader } from '../../../content/vfs/vfs.ts';
import { Direction, gridNo, WORLD_COLS } from '../../../content/world/grid.ts';
import { type DataVfs, openDataVfs } from '../../../node/data-vfs.ts';
import { PROJECT_DATA_DIR } from '../../../node/repo.ts';
import { createItems, type ItemObject } from '../../items/object.ts';
import { ScriptedStream } from '../../strategic/forces/autoresolve/replay-rng.ts';
import { anim, animName } from '../anim-states.ts';
import { changeSoldierState, initNewSoldierAnim } from '../animation.ts';
import type { TacticalContent } from '../content.ts';
import { InvSlot } from '../inventory.ts';
import { loadTacticalContent } from '../load-content.ts';
import { Profile } from '../narrative/constants.ts';
import { calcActionPoints } from '../points.ts';
import { Body, type Soldier, TEAM_FIRST_ID, Team } from '../soldier.ts';
import type { TacticalState } from '../state.ts';
import type { TacticalSim } from '../tactical-sim.ts';
import { Visibility } from '../world-items.ts';
import type { RandomStream } from './context.ts';
import { deathOpcode, handleSoldierDeath } from './death.ts';

let content: TacticalContent;

beforeAll(async () => {
  content = await loadTestContent();
});

const DEATH_OR_RELEASE = 497;

describe('kill records (Overhead.cc HandleNPCTeamMemberDeath, Soldier_Ani.cc HandleSoldierDeath)', () => {
  it('counts a militia kill three times: once where the enemy dies and twice more where the kill is credited', () => {
    const sim = newCombatSim(content);
    const militia = spawnSoldier(sim, TEAM_FIRST_ID[Team.MILITIA], Team.MILITIA, gridNo(80, 80), Direction.SOUTH);
    const enemy = spawnSoldier(sim, TEAM_FIRST_ID[Team.ENEMY], Team.ENEMY, gridNo(80, 85), Direction.NORTH);
    enemy.attacker = militia;
    enemy.life = 0;
    handleSoldierDeath(sim.state, enemy);
    expect(militia.militiaKills).toBe(3);
  });

  it('begins the creature queen’s death only when somebody killed her', () => {
    function queenDies(killedByMerc: boolean): (number | null)[] {
      const sim = newCombatSim(content);
      const begun: (number | null)[] = [];
      sim.state.narrative = { ...sim.state.narrative, creatureQueenDied: (killer) => begun.push(killer?.id ?? null) };
      const merc = spawnSoldier(sim, 0, Team.OUR, gridNo(80, 80), Direction.SOUTH);
      const queen = spawnSoldier(sim, TEAM_FIRST_ID[Team.CREATURE], Team.CREATURE, gridNo(80, 85), Direction.NORTH);
      queen.bodyType = Body.QUEENMONSTER;
      queen.attacker = killedByMerc ? merc : null;
      queen.life = 0;
      handleSoldierDeath(sim.state, queen);
      return begun;
    }
    expect(queenDies(true)).toEqual([0]);
    expect(queenDies(false)).toEqual([]);
  });
});

describe('going down unconscious (Soldier_Ani.cc HandleCheckForDeathCommonCode)', () => {
  function knockedOutOnTurnOf(team: number) {
    const sim = newCombatSim(content);
    const t = sim.state;
    const s = spawnSoldier(sim, 0, Team.OUR, gridNo(80, 80), Direction.SOUTH, { life: 10 });
    t.inCombat = true;
    t.turn.currentTeam = team;
    s.state = anim(t.content, 'FALLFORWARD_FROMHIT_STAND');
    deathOpcode(t, s, DEATH_OR_RELEASE);
    return { s, pose: animName(t.content, s.state) };
  }

  it('counts two turns down on his own turn, as the original runs its getting-up check twice, and none on another team’s turn', () => {
    const own = knockedOutOnTurnOf(Team.OUR);
    expect(own.s.collapsed).toBe(true);
    expect(own.s.collapsedTurns).toBe(2);
    expect(own.pose).toBe('STAND_FALLFORWARD_STOP');
    const other = knockedOutOnTurnOf(Team.ENEMY);
    expect(other.s.collapsed).toBe(true);
    expect(other.s.collapsedTurns).toBe(0);
    expect(other.pose).toBe('STAND_FALLFORWARD_STOP');
  });
});

describe('the drops at death (Rotting_Corpses.cc TurnSoldierIntoCorpse)', () => {
  function dropsOf(team: number, profile?: number) {
    const sim = newCombatSim(content);
    const at = gridNo(80, 85);
    const s = spawnSoldier(sim, TEAM_FIRST_ID[team] ?? 0, team, at, Direction.NORTH, profile === undefined ? {} : { profile });
    s.life = 0;
    handleSoldierDeath(sim.state, s);
    return sim.state.worldItems.filter((i) => i.gridNo === at).map((i) => i.visible);
  }

  it('drops Deidranna’s items visible, as only our mercs’ are otherwise', () => {
    expect(dropsOf(Team.CIV, Profile.QUEEN)).toEqual([Visibility.VISIBLE]);
    expect(dropsOf(Team.CIV)).toEqual([Visibility.INVISIBLE]);
    expect(dropsOf(Team.ENEMY)).toEqual([Visibility.INVISIBLE]);
  });

  it('leaves the creature queen’s inventory and drops 6, 5 or 4 jars of her blood two rows south of her by difficulty', () => {
    function queenDrops(difficulty: number) {
      const sim = newCombatSim(content);
      Object.assign(sim.state.options, { difficulty });
      const at = gridNo(80, 85);
      const queen = spawnSoldier(sim, TEAM_FIRST_ID[Team.CREATURE], Team.CREATURE, at, Direction.NORTH);
      queen.bodyType = Body.QUEENMONSTER;
      queen.state = anim(sim.state.content, 'QUEEN_DIE');
      queen.life = 0;
      handleSoldierDeath(sim.state, queen);
      const jar = sim.state.content.items.byName.get('JAR_QUEEN_CREATURE_BLOOD')?.index;
      return sim.state.worldItems.map((i) => ({
        at: i.gridNo - at,
        jar: i.object.item === jar,
        status: i.object.status[0],
        visible: i.visible,
      }));
    }
    const jars = (n: number) =>
      Array.from({ length: n }, () => ({ at: 2 * WORLD_COLS, jar: true, status: 100, visible: Visibility.INVISIBLE }));
    expect(queenDrops(1)).toEqual(jars(6));
    expect(queenDrops(2)).toEqual(jars(5));
    expect(queenDrops(3)).toEqual(jars(4));
  });
});

const SHOOTER_AT = gridNo(80, 80);
const CREATURE_AT = gridNo(80, 86);
const MAX_SHOTS = 6;

function shootCreatureDead(creatureContent: TacticalContent, body: number) {
  const sim = newCombatSim(creatureContent);
  const t = sim.state;
  const merc = spawnSoldier(sim, 0, Team.OUR, SHOOTER_AT, Direction.SOUTH, { marksmanship: 100 });
  const creature = spawnCreature(sim, TEAM_FIRST_ID[Team.CREATURE], body, CREATURE_AT, Direction.NORTH, { life: 1 });
  sim.lookAround();
  for (let shot = 0; shot < MAX_SHOTS && creature.placed; shot++) {
    merc.actionPoints = calcActionPoints(merc);
    expect(sim.dispatch({ type: 'attack', soldier: merc.id, target: CREATURE_AT, aimTime: 4 }).ok).toBe(true);
    runUntilIdle(sim);
  }
  expect(creature.placed).toBe(false);
  const jar = t.content.items.byName.get('JAR_QUEEN_CREATURE_BLOOD')?.index;
  return {
    corpses: t.corpses.map((c) => ({ at: c.gridNo, type: t.content.corpses.table.types[c.type] })),
    jars: t.worldItems.filter((i) => i.object.item === jar).map((i) => i.gridNo - CREATURE_AT),
  };
}

describe('creatures shot dead (Soldier_Ani.cc codes 465 and 440, Animation_Control.cc gubAnimSurfaceCorpseID)', () => {
  it('leaves the corpse its dying animation names: the larva’s, the infant’s and the queen’s die where they fall', () => {
    expect(shootCreatureDead(content, Body.LARVAE_MONSTER).corpses).toEqual([{ at: CREATURE_AT, type: 'LARVAEMONSTER_DEAD' }]);
    expect(shootCreatureDead(content, Body.INFANT_MONSTER).corpses).toEqual([{ at: CREATURE_AT, type: 'INFANTMONSTER_DEAD' }]);
    expect(shootCreatureDead(content, Body.QUEENMONSTER).corpses).toEqual([{ at: CREATURE_AT, type: 'QUEEN_MONSTER_DEAD' }]);
  });

  it('melts an adult creature into its corpse', () => {
    expect(shootCreatureDead(content, Body.AM_MONSTER).corpses).toEqual([{ at: CREATURE_AT, type: 'ADULTMONSTER_DEAD' }]);
    expect(shootCreatureDead(content, Body.YAF_MONSTER).corpses).toEqual([{ at: CREATURE_AT, type: 'ADULTMONSTER_DEAD' }]);
  });

  it('drops the queen’s blood jars two rows south of her corpse', () => {
    expect(shootCreatureDead(content, Body.QUEENMONSTER).jars).toEqual(Array(5).fill(2 * WORLD_COLS));
  });
});

describe.skipIf(!ORIGINAL_DATA_DIR)('creatures shot dead with the original animation scripts', () => {
  let data: DataVfs;
  let original: TacticalContent;

  beforeAll(async () => {
    data = await openDataVfs({ projectDataDir: PROJECT_DATA_DIR, dataDir: ORIGINAL_DATA_DIR });
    original = await loadTacticalContent(withGraphicFacts((path) => vfsFileReader(data.vfs)(path)));
  });
  afterAll(async () => {
    await data.close();
  });

  it('leave the same corpses and jars as on the stub pack', () => {
    for (const body of [Body.LARVAE_MONSTER, Body.INFANT_MONSTER, Body.QUEENMONSTER, Body.AM_MONSTER])
      expect(shootCreatureDead(original, body), String(body)).toEqual(shootCreatureDead(content, body));
  });
});

const FALL_TO_GROUND = 721;
const HEAVY_FALL = 722;
const MAX_FALL_TICKS = 2_000;
const DOWN_AFTER_FALL = 'STAND_FALLFORWARD_STOP';
const SMASHED_PAIR = [1];
const WHOLE_PAIR = [100, 100];

function carrier(sim: TacticalSim): { s: Soldier; jars: ItemObject; elixir: ItemObject } {
  const s = spawnSoldier(sim, 0, Team.OUR, gridNo(80, 80), Direction.SOUTH, { life: 10 });
  const items = sim.state.content.items;
  const id = (name: string) => items.byName.get(name)?.index ?? 0;
  const jars = createItems(items, id('JAR'), 100, 2);
  const elixir = createItems(items, id('JAR_ELIXIR'), 100, 1);
  s.inv[InvSlot.SMALLPOCK1] = jars;
  s.inv[InvSlot.SMALLPOCK2] = elixir;
  return { s, jars, elixir };
}

function scriptPre(t: TacticalState, values: readonly number[]): ScriptedStream {
  const pre = new ScriptedStream(values);
  Object.assign(t, { pre });
  return pre;
}

function jarsAfterFall(fallContent: TacticalContent, stance: string, fall: string): number[] {
  const sim = newCombatSim(fallContent);
  const t = sim.state;
  const { s, jars } = carrier(sim);
  const worstRolls: RandomStream = { int: (n) => Math.max(0, n - 1) };
  Object.assign(t, { pre: worstRolls });
  initNewSoldierAnim(t, s, anim(t.content, stance), 0, true);
  changeSoldierState(t, s, anim(t.content, fall));
  for (let tick = 0; tick < MAX_FALL_TICKS && animName(t.content, s.state) !== DOWN_AFTER_FALL; tick++) sim.step();
  expect(animName(t.content, s.state)).toBe(DOWN_AFTER_FALL);
  return [...jars.status.slice(0, jars.count)];
}

describe('jars in a fall (Soldier_Ani.cc codes 721 and 722, Items.cc CheckEquipmentForFragileItemDamage)', () => {
  it('rolls each jar’s damage in a standing fall forward from a hit and smashes it past a second roll of 5', () => {
    const sim = newCombatSim(content);
    const { s, jars, elixir } = carrier(sim);
    s.state = anim(sim.state.content, 'FALLFORWARD_FROMHIT_STAND');
    const pre = scriptPre(sim.state, [10, 6, 3, 2, 0]);
    expect(deathOpcode(sim.state, s, FALL_TO_GROUND)).toBe('continue');
    expect(pre.requested).toEqual([20, 10, 20, 3, 20]);
    expect([jars.count, jars.status[0]]).toEqual([1, 97]);
    expect([elixir.count, elixir.status[0]]).toEqual([1, 100]);
  });

  it('rolls the crouched fall forward from a hit at 15', () => {
    const sim = newCombatSim(content);
    const { s } = carrier(sim);
    s.state = anim(sim.state.content, 'FALLFORWARD_FROMHIT_CROUCH');
    const pre = scriptPre(sim.state, [0, 0, 0]);
    deathOpcode(sim.state, s, HEAVY_FALL);
    expect(pre.requested).toEqual([15, 15, 15]);
  });

  it('ignores the fall sounds of every other animation', () => {
    const sim = newCombatSim(content);
    const { s } = carrier(sim);
    const pre = scriptPre(sim.state, []);
    for (const [state, code] of [
      ['ENDFALLFORWARD_FROMHIT_CROUCH', FALL_TO_GROUND],
      ['FALLFORWARD_FROMHIT_CROUCH', FALL_TO_GROUND],
      ['FALLFORWARD_FROMHIT_STAND', HEAVY_FALL],
      ['FALLBACK_HIT_STAND', HEAVY_FALL],
    ] as const) {
      s.state = anim(sim.state.content, state);
      deathOpcode(sim.state, s, code);
    }
    expect(pre.requested).toEqual([]);
  });

  it('smashes the jars as the standing fall forward reaches its fall sound', () => {
    expect(jarsAfterFall(content, 'STANDING', 'FALLFORWARD_FROMHIT_STAND')).toEqual(SMASHED_PAIR);
  });

  it('never smashes jars in the crouched fall forward, whose fall sound plays in its second animation', () => {
    expect(jarsAfterFall(content, 'CROUCHING', 'FALLFORWARD_FROMHIT_CROUCH')).toEqual(WHOLE_PAIR);
  });
});

describe.skipIf(!ORIGINAL_DATA_DIR)('jars in a fall with the original animation scripts', () => {
  let data: DataVfs;
  let original: TacticalContent;

  beforeAll(async () => {
    data = await openDataVfs({ projectDataDir: PROJECT_DATA_DIR, dataDir: ORIGINAL_DATA_DIR });
    original = await loadTacticalContent(withGraphicFacts((path) => vfsFileReader(data.vfs)(path)));
  });
  afterAll(async () => {
    await data.close();
  });

  it('smash in the standing fall forward and never in the crouched one', () => {
    expect(jarsAfterFall(original, 'STANDING', 'FALLFORWARD_FROMHIT_STAND')).toEqual(SMASHED_PAIR);
    expect(jarsAfterFall(original, 'CROUCHING', 'FALLFORWARD_FROMHIT_CROUCH')).toEqual(WHOLE_PAIR);
  });
});

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { newCombatSim, spawnSoldier } from '../../../../tests/support/combat.ts';
import { ORIGINAL_DATA_DIR } from '../../../../tests/support/original-data.ts';
import { loadTestContent } from '../../../../tests/support/tactical.ts';
import { withGraphicFacts } from '../../../content/rules/graphic-facts.ts';
import { vfsFileReader } from '../../../content/vfs/vfs.ts';
import { Direction, gridNo } from '../../../content/world/grid.ts';
import { type DataVfs, openDataVfs } from '../../../node/data-vfs.ts';
import { PROJECT_DATA_DIR } from '../../../node/repo.ts';
import { createItems, type ItemObject } from '../../items/object.ts';
import { ScriptedStream } from '../../strategic/forces/autoresolve/replay-rng.ts';
import { anim, animName } from '../anim-states.ts';
import { changeSoldierState, initNewSoldierAnim } from '../animation.ts';
import type { TacticalContent } from '../content.ts';
import { InvSlot } from '../inventory.ts';
import { loadTacticalContent } from '../load-content.ts';
import { Body, type Soldier, TEAM_FIRST_ID, Team } from '../soldier.ts';
import type { TacticalState } from '../state.ts';
import type { TacticalSim } from '../tactical-sim.ts';
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

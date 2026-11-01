import { beforeAll, describe, expect, it } from 'vitest';
import { loadTestContent, testDoorCosts } from '../../../../tests/support/tactical.ts';
import { Direction, gridNo } from '../../../content/world/grid.ts';
import { syntheticWorld } from '../../../content/world/synthetic.ts';
import { Rng } from '../../../core/rng.ts';
import { ScriptedStream } from '../../strategic/forces/autoresolve/replay-rng.ts';
import { setCivGroupHostility } from '../../strategic/narrative/civ-groups.ts';
import { initNewSoldierAnim, states } from '../animation.ts';
import type { TacticalContent } from '../content.ts';
import { setSoldierPosition } from '../movement.ts';
import { CivGroupHostility } from '../narrative/constants.ts';
import { AlertStatus, CivilianGroup, createSoldier, Orders, type Soldier, Team } from '../soldier.ts';
import { createTacticalState, registerSoldier, type TacticalState } from '../state.ts';
import { buildAIListForTeam } from './ai-list.ts';

let content: TacticalContent;

beforeAll(async () => {
  content = await loadTestContent();
});

const STATS = {
  agility: 50,
  dexterity: 50,
  strength: 50,
  wisdom: 50,
  leadership: 50,
  marksmanship: 50,
  mechanical: 30,
  explosives: 30,
  medical: 30,
  experience: 3,
};

function sectorWithCivilian(civilianGroup: number): { t: TacticalState; civilian: Soldier } {
  const w = syntheticWorld(testDoorCosts());
  const t = createTacticalState({ ...w, mapDoors: new Map() }, content, Rng.fromSeed(3));
  const at = gridNo(80, 80);
  const civilian = createSoldier({
    id: 0,
    team: Team.CIV,
    name: '',
    bodyType: 0,
    palettes: { hair: '', skin: '', vest: '', pants: '' },
    stats: STATS,
    life: 60,
    breath: 99,
    gridNo: at,
    direction: Direction.SOUTH,
    state: states(content.animations).STANDING,
    ai: { orders: Orders.STATIONARY, attitude: 0 },
  });
  registerSoldier(t, civilian);
  setSoldierPosition(t, civilian, at);
  initNewSoldierAnim(t, civilian, states(content.animations).STANDING, 0, true);
  civilian.civilianGroup = civilianGroup;
  civilian.neutral = true;
  civilian.ai.alertStatus = AlertStatus.GREEN;
  return { t, civilian };
}

function listed(t: TacticalState, rolls: readonly number[]): { listed: boolean; draws: number[] } {
  const pre = new ScriptedStream(rolls);
  Object.assign(t, { pre });
  return { listed: buildAIListForTeam(t, Team.CIV), draws: pre.requested };
}

describe('the civilians the AI list skips (AIList.cc SatisfiesAIListConditions)', () => {
  const SKIP_ROLL = 5;
  const KEEP_ROLL = 0;

  it('handles an unalerted neutral civilian one turn in ten', () => {
    expect(listed(sectorWithCivilian(CivilianGroup.NONE).t, [SKIP_ROLL])).toEqual({ listed: false, draws: [10] });
    expect(listed(sectorWithCivilian(CivilianGroup.NONE).t, [KEEP_ROLL])).toEqual({ listed: true, draws: [10] });
  });

  it('handles every turn a neutral member of a group that is no longer neutral, without a roll', () => {
    const { t } = sectorWithCivilian(CivilianGroup.KINGPIN);
    setCivGroupHostility(t.civGroups, CivilianGroup.KINGPIN, CivGroupHostility.WILL_BECOME_HOSTILE);
    expect(listed(t, [])).toEqual({ listed: true, draws: [] });
  });

  it('rolls for a neutral member of a neutral group like for anyone without a group', () => {
    expect(listed(sectorWithCivilian(CivilianGroup.KINGPIN).t, [SKIP_ROLL])).toEqual({ listed: false, draws: [10] });
  });

  it('handles an NPC acting out a quote record every turn, after rolling for him all the same', () => {
    const { t, civilian } = sectorWithCivilian(CivilianGroup.NONE);
    civilian.quoteRecord = 2;
    expect(listed(t, [SKIP_ROLL])).toEqual({ listed: true, draws: [10] });
  });
});

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type CampaignKit, createTestCampaign, landFirstSquad } from '../../../tests/support/campaign.ts';
import { loadEconomyTestContent } from '../../../tests/support/economy.ts';
import { loadArmyTestContent } from '../../../tests/support/queen.ts';
import { loadStubSectorKit } from '../../../tests/support/sectors.ts';
import { Assignment } from '../strategic/economy/constants.ts';
import { handleHourlyUpdate } from '../strategic/economy/update.ts';
import { createSoldier, SkillTrait, type Soldier } from '../tactical/soldier.ts';
import { hourlyCamouflageUpdate } from './camouflage.ts';

function soldier(id: number, camo: number, monsterSmell = 0, skillTrait2 = 0): Soldier {
  const s = createSoldier({
    id,
    team: 0,
    name: `m${id}`,
    bodyType: 0,
    palettes: { hair: 'BLACKHEAD', skin: 'PINKSKIN', vest: 'BLUEVEST', pants: 'JEANPANTS' },
    stats: {
      agility: 60,
      dexterity: 60,
      strength: 60,
      wisdom: 60,
      leadership: 50,
      marksmanship: 60,
      mechanical: 60,
      explosives: 60,
      medical: 60,
      experience: 3,
    },
    life: 60,
    gridNo: -1,
    direction: 0,
    state: 0,
    skillTrait2,
  });
  s.camo = camo;
  s.monsterSmell = monsterSmell;
  return s;
}

function wear(team: Soldier[]): number[] {
  const wornOff: number[] = [];
  hourlyCamouflageUpdate(team, (s) => wornOff.push(s.id));
  return wornOff;
}

describe('HourlyCamouflageUpdate', () => {
  it('wears two points of camouflage off per hour and reports the merc whose last two points are gone', () => {
    const team = [soldier(0, 40), soldier(1, 2), soldier(2, 1), soldier(3, 3)];
    expect(wear(team)).toEqual([1, 2]);
    expect(team.map((s) => s.camo)).toEqual([38, 0, 0, 1]);
    expect(wear(team)).toEqual([3]);
    expect(wear(team)).toEqual([]);
    expect(team.map((s) => s.camo)).toEqual([34, 0, 0, 0]);
  });

  it('keeps the camouflage of a CAMOUFLAGED merc but lets his monster smell fade', () => {
    const team = [soldier(0, 100, 2, SkillTrait.CAMOUFLAGED)];
    expect(wear(team)).toEqual([]);
    expect(team[0]?.camo).toBe(100);
    expect(team[0]?.monsterSmell).toBe(1);
  });

  it('fades monster smell by one point per hour down to zero, with or without camouflage', () => {
    const team = [soldier(0, 0, 2), soldier(1, 10, 1)];
    wear(team);
    expect(team.map((s) => s.monsterSmell)).toEqual([1, 0]);
    wear(team);
    expect(team.map((s) => s.monsterSmell)).toEqual([0, 0]);
  });
});

describe('the hourly update of a campaign', () => {
  let kit: CampaignKit;

  beforeAll(async () => {
    const [sectors, economy, army] = await Promise.all([loadStubSectorKit(), loadEconomyTestContent(), loadArmyTestContent()]);
    kit = { sectors, economy, army };
  });

  afterAll(async () => {
    await kit.sectors.dispose();
  });

  it('wears camouflage off the soldiers of our team and reports the merc it is gone from', () => {
    const { campaign: c, roster } = createTestCampaign(kit, { seed: 3, mercs: 2 });
    landFirstSquad(c);
    const economy = c.economy;
    if (!economy) throw new Error('no economy');
    const [first, second] = roster.all();
    if (!first || !second) throw new Error('no mercs');
    first.soldier.camo = 2;
    second.soldier.camo = 30;
    second.soldier.monsterSmell = 4;
    handleHourlyUpdate(economy);
    expect([first.soldier.camo, second.soldier.camo, second.soldier.monsterSmell]).toEqual([0, 28, 3]);
    expect(economy.events.filter((e) => e.type === 'camoWornOff')).toEqual([{ type: 'camoWornOff', soldier: first.id }]);
  });

  it('wears the camouflage off a dead merc too and reports it: the team loop does not skip the dead', () => {
    const { campaign: c, roster } = createTestCampaign(kit, { seed: 3, mercs: 1 });
    landFirstSquad(c);
    const economy = c.economy;
    const [dead] = roster.all();
    if (!economy || !dead) throw new Error('no merc');
    dead.soldier.life = 0;
    dead.assignment = Assignment.ASSIGNMENT_DEAD;
    dead.soldier.camo = 1;
    handleHourlyUpdate(economy);
    expect(dead.soldier.camo).toBe(0);
    expect(economy.events.filter((e) => e.type === 'camoWornOff')).toEqual([{ type: 'camoWornOff', soldier: dead.id }]);
  });
});

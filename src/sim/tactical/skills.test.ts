import { describe, expect, it } from 'vitest';
import { Direction, gridNo } from '../../content/world/grid.ts';
import {
  effectiveAgility,
  effectiveDexterity,
  effectiveExpLevel,
  effectiveExplosive,
  effectiveLeadership,
  effectiveMarksmanship,
  effectiveMechanical,
  effectiveMedical,
  effectiveStrength,
  effectiveWisdom,
} from './skills.ts';
import { createSoldier, NO_PROFILE, Personality, type Soldier, type SoldierStats } from './soldier.ts';

const MERC_PROFILE = 5;
const SURFACE = { sector: { z: 0 } };
const MINE_LEVEL = { sector: { z: 2 } };

const stats = (experience: number): SoldierStats => ({
  agility: 70,
  dexterity: 70,
  strength: 70,
  wisdom: 70,
  leadership: 50,
  marksmanship: 70,
  mechanical: 30,
  explosives: 30,
  medical: 30,
  experience,
});

function merc(experience: number, personalityTrait: number, profile = MERC_PROFILE): Soldier {
  const s = createSoldier({
    id: 0,
    team: 0,
    name: 'M',
    profile,
    bodyType: 0,
    palettes: { hair: 'BLACKHEAD', skin: 'PINKSKIN', vest: 'BLUEVEST', pants: 'JEANPANTS' },
    stats: stats(experience),
    personalityTrait,
    life: 80,
    gridNo: gridNo(80, 80),
    direction: Direction.SOUTH,
    state: 0,
  });
  s.placed = true;
  return s;
}

describe('the effective experience level (SkillCheck.cc EffectiveExpLevel)', () => {
  it('takes a level from a claustrophobic merc in an underground loaded sector, never below 1', () => {
    expect(effectiveExpLevel(MINE_LEVEL, merc(4, Personality.CLAUSTROPHOBIC))).toBe(3);
    expect(effectiveExpLevel(SURFACE, merc(4, Personality.CLAUSTROPHOBIC))).toBe(4);
    expect(effectiveExpLevel({ sector: null }, merc(4, Personality.CLAUSTROPHOBIC))).toBe(4);
    expect(effectiveExpLevel(MINE_LEVEL, merc(1, Personality.CLAUSTROPHOBIC))).toBe(1);
    expect(effectiveExpLevel(MINE_LEVEL, merc(4, Personality.FEAR_OF_INSECTS))).toBe(4);
  });

  it('keeps the level of a claustrophobe who is not in the sector, or has no profile', () => {
    const away = merc(4, Personality.CLAUSTROPHOBIC);
    away.placed = false;
    expect(effectiveExpLevel(MINE_LEVEL, away)).toBe(4);
    expect(effectiveExpLevel(MINE_LEVEL, merc(4, Personality.CLAUSTROPHOBIC, NO_PROFILE))).toBe(4);
  });
});

const DRINK = 8;

function drunk(s: Soldier, drinks: number, hangover = 0): Soldier {
  s.drugs.alcohol.effect = drinks * DRINK;
  s.drugs.alcohol.sideEffect = hangover;
  return s;
}

function drinkStats(s: Soldier): number[] {
  return [
    effectiveAgility(s),
    effectiveDexterity(s),
    effectiveWisdom(s),
    effectiveMarksmanship(s),
    effectiveMechanical(s),
    effectiveExplosive(s),
    effectiveMedical(s),
    effectiveStrength(s),
  ];
}

describe('stats under drink (SkillCheck.cc, Drugs_And_Alcohol.cc EffectStatForBeingDrunk)', () => {
  it('scales agility, dexterity, wisdom, marksmanship, mechanical, explosives and medical to 75, 65 and 50 percent, never strength', () => {
    expect(drinkStats(merc(4, 0))).toEqual([70, 70, 70, 70, 30, 30, 30, 70]);
    expect(drinkStats(drunk(merc(4, 0), 1))).toEqual([52, 52, 52, 52, 22, 22, 22, 70]);
    expect(drinkStats(drunk(merc(4, 0), 4))).toEqual([45, 45, 45, 45, 19, 19, 19, 70]);
    expect(drinkStats(drunk(merc(4, 0), 5))).toEqual([35, 35, 35, 35, 15, 15, 15, 70]);
    expect(drinkStats(drunk(merc(4, 0), 0, 10))).toEqual([70, 70, 70, 70, 30, 30, 30, 70]);
  });

  it('scales agility before the weight it carries', () => {
    const s = drunk(merc(4, 0), 1);
    s.weightCarriedAtTurnStart = 150;
    expect(effectiveAgility(s)).toBe(34);
  });

  it('raises leadership by a fifth only while he feels good, the level that already cuts his other stats to 75 percent', () => {
    expect(effectiveLeadership(merc(4, 0))).toBe(50);
    expect(effectiveLeadership(drunk(merc(4, 0), 1))).toBe(60);
    expect(effectiveLeadership(drunk(merc(4, 0), 4))).toBe(50);
    expect(effectiveLeadership(drunk(merc(4, 0), 0, 10))).toBe(50);
  });

  it('takes one level when borderline and two when drunk, before the claustrophobic level and the floor of 1', () => {
    expect(effectiveExpLevel(SURFACE, drunk(merc(4, 0), 1))).toBe(4);
    expect(effectiveExpLevel(SURFACE, drunk(merc(4, 0), 4))).toBe(3);
    expect(effectiveExpLevel(SURFACE, drunk(merc(4, 0), 5))).toBe(2);
    expect(effectiveExpLevel(MINE_LEVEL, drunk(merc(4, Personality.CLAUSTROPHOBIC), 5))).toBe(1);
    expect(effectiveExpLevel(MINE_LEVEL, drunk(merc(2, Personality.CLAUSTROPHOBIC), 5))).toBe(1);
    expect(effectiveExpLevel(SURFACE, drunk(merc(4, 0), 0, 10))).toBe(4);
  });
});

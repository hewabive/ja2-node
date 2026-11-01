import { describe, expect, it } from 'vitest';
import { Direction, gridNo } from '../../content/world/grid.ts';
import { effectiveExpLevel } from './skills.ts';
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

import { describe, expect, it } from 'vitest';
import { createSoldier, type SoldierStats, Team } from './soldier.ts';

const STATS: SoldierStats = {
  agility: 80,
  dexterity: 80,
  strength: 80,
  wisdom: 80,
  leadership: 50,
  marksmanship: 80,
  mechanical: 30,
  explosives: 30,
  medical: 30,
  experience: 3,
};

const PALETTES = { hair: 'BROWNHEAD', skin: 'TANSKIN', vest: 'BLUEVEST', pants: 'JEANPANTS' };

describe('createSoldier', () => {
  it('owns its stats, so a stat change never reaches the object it was created from or another soldier', () => {
    const init = { team: Team.OUR, name: 'a', bodyType: 0, palettes: PALETTES, stats: STATS, life: 80, gridNo: -1, direction: 4, state: 0 };
    const first = createSoldier({ ...init, id: 0 });
    const second = createSoldier({ ...init, id: 1 });
    first.stats.strength -= 7;
    expect(STATS.strength).toBe(80);
    expect(second.stats.strength).toBe(80);
  });
});

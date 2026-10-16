import { noCampaignFields, noRelations, type ProfileProgress, type StatKey } from '../../src/sim/tactical/profiles.ts';

const BASE_STAT = 50;

export function testProfile(id: number, overrides: Partial<ProfileProgress> = {}): ProfileProgress {
  const stats: Record<StatKey, number> = {
    lifeMax: BASE_STAT,
    agility: BASE_STAT,
    dexterity: BASE_STAT,
    wisdom: BASE_STAT,
    medical: BASE_STAT,
    explosives: BASE_STAT,
    mechanical: BASE_STAT,
    marksmanship: BASE_STAT,
    experience: 1,
    strength: BASE_STAT,
    leadership: BASE_STAT,
  };
  return {
    id,
    evolution: 0,
    attitude: 0,
    buddies: [],
    hated: [],
    ...noRelations(),
    life: BASE_STAT,
    stats,
    gains: { ...stats },
    statChangeChances: [],
    statChangeSuccesses: [],
    kills: 0,
    assists: 0,
    shotsFired: 0,
    shotsHit: 0,
    timesWounded: 0,
    ...noCampaignFields(),
    inventory: new Array<number>(19).fill(0),
    inventoryStatus: new Array<number>(19).fill(0),
    inventoryCount: new Array<number>(19).fill(0),
    ...overrides,
  };
}

export function profileMap(profiles: readonly ProfileProgress[]): Map<number, ProfileProgress> {
  return new Map(profiles.map((p) => [p.id, p]));
}

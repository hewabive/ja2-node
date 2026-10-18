import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { FormatError } from '../binary/errors.ts';
import { loadStubProfiles, parseStubProfiles, STUB_PROFILES_PATH } from './stub-profiles.ts';

const ITEMS: Readonly<Record<string, number>> = { PISTOL: 3, CLIP: 71 };
const itemIndex = (name: string) => ITEMS[name];

const MINIMAL = {
  id: 4,
  name: 'Test Person',
  nickname: 'Tester',
  stats: {
    life: 60,
    lifeMax: 70,
    strength: 50,
    agility: 51,
    dexterity: 52,
    wisdom: 53,
    marksmanship: 54,
    medical: 5,
    mechanical: 6,
    explosives: 7,
    leadership: 8,
    experience: 2,
  },
};

function parseOne(extra: Record<string, unknown>) {
  return parseStubProfiles({ profiles: [{ ...MINIMAL, ...extra }] }, itemIndex)[4];
}

const FIRST_AIM = 0;
const LAST_AIM = 39;
const VEHICLES = [160, 161, 162, 163];
const SKYRIDER = 97;

describe('authored stub profiles', () => {
  it('fills the defaults of a minimal profile', () => {
    const p = parseOne({});
    expect(p).toMatchObject({ id: 4, nickname: 'Tester', life: 60, lifeMax: 70, experience: 2, deathRate: 50, reputationTolerance: 50 });
    expect(p?.buddies).toEqual([-1, -1, -1, -1, -1]);
    expect(p?.hated).toEqual([-1, -1, -1, -1, -1]);
    expect(p?.mercOpinion).toHaveLength(75);
    expect(p?.inventory).toHaveLength(19);
    expect(p?.inventory.every((i) => i === 0)).toBe(true);
    expect([p?.salary, p?.mercStatus, p?.armourAttractiveness, p?.mainGunAttractiveness]).toEqual([0, 0, -1, -1]);
  });

  it('places relations, opinions and items, and starts the counters at the times', () => {
    const p = parseOne({
      hated: [2],
      hatedTime: [6],
      learnToHate: 1,
      learnToHateTime: 10,
      opinions: { 2: -25 },
      salary: 500,
      inventory: [
        { slot: 5, item: 'PISTOL' },
        { slot: 7, item: 'CLIP', count: 2, status: 80 },
      ],
    });
    expect(p?.hated[0]).toBe(2);
    expect(p?.hatedCount).toEqual([6, 0, 0, 0, 0]);
    expect([p?.learnToHate, p?.learnToHateCount]).toEqual([1, 10]);
    expect(p?.mercOpinion[2]).toBe(-25);
    expect(p?.salary).toBe(500);
    expect([p?.inventory[5], p?.inventoryStatus[5], p?.inventoryCount[5]]).toEqual([3, 100, 1]);
    expect([p?.inventory[7], p?.inventoryStatus[7], p?.inventoryCount[7]]).toEqual([71, 80, 2]);
  });

  it('reads a home sector and civilian group for authored NPCs', () => {
    expect(parseOne({ sector: 'A10', civilianGroup: 3 })).toMatchObject({ sectorX: 10, sectorY: 1, civilianGroup: 3 });
    expect(parseOne({})).toMatchObject({ sectorX: 0, sectorY: 0, civilianGroup: 0 });
  });

  it('rejects unknown items, bad slots, too many relations and duplicate ids', () => {
    expect(() => parseOne({ inventory: [{ slot: 1, item: 'LASER' }] })).toThrow(FormatError);
    expect(() => parseOne({ inventory: [{ slot: 19, item: 'PISTOL' }] })).toThrow(FormatError);
    expect(() => parseOne({ buddies: [1, 2, 3, 5, 6, 7] })).toThrow(FormatError);
    expect(() => parseOne({ opinions: { 80: 1 } })).toThrow(FormatError);
    expect(() => parseStubProfiles({ profiles: [MINIMAL, MINIMAL] }, itemIndex)).toThrow(FormatError);
  });

  it('parses the checked-in stub pack profiles', async () => {
    const bytes = new Uint8Array(readFileSync(join(import.meta.dirname, '../../..', STUB_PROFILES_PATH)));
    const profiles = await loadStubProfiles(
      async (path) => (path === STUB_PROFILES_PATH ? bytes : null),
      () => 1,
    );
    expect(profiles.filter(Boolean).length).toBeGreaterThanOrEqual(6);
    for (const [id, p] of profiles.entries()) if (p) expect(p.id).toBe(id);
    const aim = profiles.slice(FIRST_AIM, LAST_AIM + 1).filter(Boolean);
    expect(aim.length).toBeGreaterThanOrEqual(12);
    expect(VEHICLES.every((id) => profiles[id])).toBe(true);
    expect(profiles[SKYRIDER]?.nickname).toBeTruthy();
    for (const p of aim)
      for (const other of [...(p?.buddies ?? []), ...(p?.hated ?? []), p?.learnToHate ?? -1, p?.learnToLike ?? -1])
        if (other >= 0) expect(profiles[other], `${p?.id} -> ${other}`).toBeDefined();
    expect(await loadStubProfiles(async () => null, itemIndex)).toEqual([]);
  });
});

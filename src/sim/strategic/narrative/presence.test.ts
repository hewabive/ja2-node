import { beforeAll, describe, expect, it } from 'vitest';
import { loadEconomyTestContent } from '../../../../tests/support/economy.ts';
import { profileMap, testProfile } from '../../../../tests/support/profiles.ts';
import { ScriptedRolls } from '../../../../tests/support/strategic.ts';
import type { ItemTable } from '../../../content/items/items.ts';
import { ProfileMiscFlag2 } from '../../campaign/profiles.ts';
import type { ProfileProgress } from '../../tactical/profiles.ts';
import { type EarlyMorningContext, handleEarlyMorningEvents } from './early-morning.ts';
import { Fact } from './fact-ids.ts';
import { createNarrativeState, fact } from './facts.ts';
import { applyProgressMilestones, hourlyCheckIfSlayAloneSoHeCanLeave, hourlyQuestUpdate, payOffSkyriderDebtIfAny } from './hourly.ts';
import { Npc } from './npc-ids.ts';
import {
  ASSASSINS,
  changeNpcToDifferentSector,
  decideOnAssassin,
  makeRemainingTerroristsTougher,
  type ProfileItems,
  profileSector,
  setMoneyInProfile,
} from './presence.ts';

let items: ItemTable;

beforeAll(async () => {
  items = (await loadEconomyTestContent()).items;
});

const profileItems = (): ProfileItems => ({ table: items, soldier: () => null });
const id = (name: string) => items.byName.get(name)?.index ?? -1;

describe('profile locations (docs/25 §4.1)', () => {
  it('sends a profile that left the country nowhere and drops its insertion data', () => {
    const p = testProfile(Npc.CONRAD, { useProfileInsertion: true });
    changeNpcToDifferentSector(p, { x: 4, y: 5, z: 1 });
    expect(profileSector(p)).toEqual({ x: 4, y: 5, z: 1 });
    expect(p.useProfileInsertion).toBe(false);
    p.miscFlags2 = ProfileMiscFlag2.LEFT_COUNTRY;
    changeNpcToDifferentSector(p, { x: 6, y: 6, z: 0 });
    expect(profileSector(p)).toEqual({ x: 0, y: 0, z: 0 });
  });

  it('keeps profile cash out of the inventory and needs a free pocket for it', () => {
    const p = testProfile(Npc.VINCE);
    setMoneyInProfile(profileItems(), p, 1200);
    expect(p.money).toBe(1200);
    expect(p.inventory.every((item) => item === 0)).toBe(true);
    setMoneyInProfile(profileItems(), p, 0);
    expect(p.money).toBe(0);
    for (let slot = 7; slot < 18; slot++) p.inventoryCount[slot] = 1;
    setMoneyInProfile(profileItems(), p, 500);
    expect(p.money).toBe(0);
  });
});

describe('terrorists and assassins (docs/25 §11.4, §11.6)', () => {
  it('gives the remaining terrorists a mini grenade once a third of them is dead on medium', () => {
    const profiles = profileMap([
      testProfile(Npc.DRUGGIST, { sectorX: 13, sectorY: 3 }),
      testProfile(Npc.SLAY, { sectorX: 9, sectorY: 6, mercStatus: -5 }),
      testProfile(Npc.ANNIE, { sectorX: 14, sectorY: 9 }),
    ]);
    const ctx = {
      items: profileItems(),
      toughening: { miniGrenade: id('MINI_GRENADE'), handGrenade: id('HAND_GRENADE'), mustardGrenade: 1, rocketLauncher: 2 },
      difficulty: 2,
      profile: (pid: number) => profiles.get(pid) ?? null,
      slayOnPlayerTeam: () => false,
    };
    makeRemainingTerroristsTougher(ctx, 3);
    expect(profiles.get(Npc.DRUGGIST)?.inventory[7]).toBe(id('MINI_GRENADE'));
    expect(profiles.get(Npc.ANNIE)?.inventory[7]).toBe(id('MINI_GRENADE'));
    expect(profiles.get(Npc.SLAY)?.inventory[7]).toBe(0);
  });

  it('picks an unplaced living assassin for the town and posts his removal 3 to 5 hours later', () => {
    const profiles = profileMap(ASSASSINS.map((a) => testProfile(a.profile)));
    const rolls = new ScriptedRolls([1, 2]);
    const posted: [number, number][] = [];
    decideOnAssassin({
      world: { x: 9, y: 7, z: 0 },
      town: 6,
      now: 600,
      random: (n) => rolls.int(n),
      profile: (pid) => profiles.get(pid) ?? null,
      removeAssassinAt: (minute, pid) => posted.push([minute, pid]),
    });
    expect(rolls.ranges).toEqual([5, 3]);
    const picked = [Npc.JIM, Npc.OLAF, Npc.RAY, Npc.OLGA, Npc.TYRONE][1] ?? 0;
    expect(profileSector(profiles.get(picked) as ProfileProgress)).toEqual({ x: 9, y: 7, z: 0 });
    expect(posted).toEqual([[600 + 5 * 60, picked]]);
  });
});

function morning(o: { world?: { x: number; y: number; z: number } | null; profiles: ProfileProgress[]; rolls: number[]; pre?: number[] }) {
  const profiles = profileMap(o.profiles);
  const rolls = new ScriptedRolls(o.rolls);
  const pre = new ScriptedRolls(o.pre ?? [1]);
  const narrative = createNarrativeState();
  const hospital: number[] = [];
  const ctx: EarlyMorningContext = {
    narrative,
    world: o.world ?? null,
    items: profileItems(),
    heads: { first: id('HEAD_1'), last: id('HEAD_7') },
    random: (n) => rolls.int(n),
    preRandom: (n) => pre.int(n),
    profile: (pid) => profiles.get(pid) ?? null,
    npcOrRpcProfiles: () => [...profiles.values()],
    placementSectors: (pid) => (pid === Npc.CARMEN ? [36, 44, 104] : [10, 20, 30, 40, 50]),
    onPlayerTeam: () => false,
    clearDefaultResponses: () => {},
    checkForMissingHospitalSupplies: () => hospital.push(1),
  };
  handleEarlyMorningEvents(ctx);
  return { profiles, rolls, pre, narrative, hospital };
}

describe('the 04:00 event (docs/25 §4.3)', () => {
  it('draws Father, his move, Devin, Hamous and Carmen in order and Dave’s gas from PreRandom', () => {
    const m = morning({
      profiles: [
        testProfile(Npc.FATHER, { sectorX: 13, sectorY: 3 }),
        testProfile(Npc.DEVIN, { npcData: 3 }),
        testProfile(Npc.HAMOUS),
        testProfile(Npc.PROF_ICECREAM),
        testProfile(Npc.CARMEN, { money: 100 }),
        testProfile(Npc.TONY),
        testProfile(Npc.DARREN, { balance: 50 }),
      ],
      rolls: [2, 1, 4, 3, 1],
      pre: [0],
    });
    expect(m.rolls.ranges).toEqual([4, 2, 5, 5, 3]);
    expect(m.pre.ranges).toEqual([3]);
    expect(m.profiles.get(Npc.FATHER)).toMatchObject({ npcData: 2, sectorX: 13, sectorY: 4 });
    expect(m.profiles.get(Npc.DEVIN)?.npcData).toBe(4);
    expect(profileSector(m.profiles.get(Npc.HAMOUS) as ProfileProgress)).toEqual(
      profileSector(m.profiles.get(Npc.PROF_ICECREAM) as ProfileProgress),
    );
    expect(m.profiles.get(Npc.CARMEN)).toMatchObject({ sectorX: 13, sectorY: 3, money: 5000 });
    expect(m.profiles.get(Npc.DARREN)).toMatchObject({ balance: 0, money: 15000 });
    expect(fact(m.narrative, Fact.DAVE_HAS_GAS)).toBe(true);
  });

  it('keeps NPCs whose sector is loaded and pays Carmen for his heads when he comes back', () => {
    const c13 = { x: 13, y: 3, z: 0 };
    const carmen = testProfile(Npc.CARMEN, { miscFlags2: ProfileMiscFlag2.DONT_ADD_TO_SECTOR, npcData2: 2, money: 12000 });
    carmen.inventory[3] = id('HEAD_2');
    carmen.inventoryCount[3] = 1;
    const m = morning({
      world: c13,
      profiles: [testProfile(Npc.FATHER, { sectorX: 13, sectorY: 3 }), carmen, testProfile(Npc.TONY, { lastDateSpokenTo: 3 })],
      rolls: [0, 1],
      pre: [2],
    });
    expect(m.rolls.ranges).toEqual([4, 2, 4]);
    expect(m.profiles.get(Npc.FATHER)?.sectorY).toBe(3);
    expect(m.profiles.get(Npc.CARMEN)).toMatchObject({ sectorX: 13, sectorY: 3, npcData2: 0, money: 32000, miscFlags2: 0 });
    expect(m.profiles.get(Npc.CARMEN)?.inventory[3]).toBe(0);
    expect(fact(m.narrative, Fact.TONY_NOT_AVAILABLE)).toBe(true);
  });

  it('checks the hospital supplies only while F8 is loaded', () => {
    expect(morning({ world: { x: 8, y: 6, z: 0 }, profiles: [], rolls: [0, 0] }).hospital).toEqual([1]);
    expect(morning({ world: { x: 8, y: 6, z: 1 }, profiles: [], rolls: [0, 0] }).hospital).toEqual([]);
  });
});

describe('hourly NPC handlers (docs/25 §4.4)', () => {
  it('opens and closes the brothel, club and museum and rests the boxers', () => {
    const n = createNarrativeState();
    n.boxing.matchesWon = 3;
    n.boxing.fought[1] = true;
    hourlyQuestUpdate(n, 20);
    hourlyQuestUpdate(n, 9);
    expect([fact(n, Fact.BROTHEL_OPEN), fact(n, Fact.MUSEUM_OPEN)]).toEqual([true, true]);
    hourlyQuestUpdate(n, 15);
    expect(fact(n, Fact.CLUB_OPEN)).toBe(true);
    expect(n.boxing).toMatchObject({ resting: true, rests: 0, fought: [false, false, false] });
    hourlyQuestUpdate(n, 15);
    expect(n.boxing).toMatchObject({ resting: false, rests: 1 });
    hourlyQuestUpdate(n, 2);
    hourlyQuestUpdate(n, 18);
    hourlyQuestUpdate(n, 4);
    expect([fact(n, Fact.CLUB_OPEN), fact(n, Fact.MUSEUM_OPEN), fact(n, Fact.BROTHEL_OPEN)]).toEqual([false, false, false]);
  });

  it('applies the progress milestones: Mike to the army, Iggy to C5', () => {
    const n = createNarrativeState();
    const iggy = testProfile(Npc.IGGY);
    let meanwhiles = 0;
    applyProgressMilestones(
      { narrative: n, profile: () => iggy, scientistAwolMeanwhile: () => meanwhiles++ },
      { madlab: true, mike: true, iggy: true },
    );
    expect(meanwhiles).toBe(1);
    expect(n.facts[Fact.MIKE_AVAILABLE_TO_ARMY]).toBe(1);
    expect(profileSector(iggy)).toEqual({ x: 5, y: 3, z: 0 });
  });

  it('lets Slay leave on a 15 % roll only when he is alone', () => {
    const rolls = new ScriptedRolls([14]);
    let left = 0;
    const ctx = {
      slay: () => ({ life: 50, betweenSectors: false, sector: { x: 1, y: 1, z: 0 }, assignment: 0, contractEnd: 0 }),
      playerMercsInSector: () => 1,
      chance: (p: number) => rolls.int(100) < p,
      leaves: () => left++,
    };
    hourlyCheckIfSlayAloneSoHeCanLeave(ctx);
    expect(left).toBe(1);
    hourlyCheckIfSlayAloneSoHeCanLeave({ ...ctx, playerMercsInSector: () => 2 });
    expect(rolls.ranges).toEqual([100]);
  });

  it('pays what it can of Skyrider’s debt', () => {
    const skyrider = testProfile(Npc.SKYRIDER, { balance: -3000 });
    const paid: number[] = [];
    payOffSkyriderDebtIfAny({ skyrider: () => skyrider, balance: () => 1000, pay: (a) => paid.push(a), paid: () => {} });
    expect(paid).toEqual([1000]);
    expect(skyrider.balance).toBe(-2000);
  });
});

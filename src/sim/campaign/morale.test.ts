import { describe, expect, it } from 'vitest';
import { progressFor } from '../../../tests/support/autoresolve.ts';
import type { Sector } from '../../content/strategic/sector-ids.ts';
import { Assignment } from '../strategic/economy/constants.ts';
import type { ProfileProgress } from '../tactical/profiles.ts';
import { createSoldier, NO_PROFILE } from '../tactical/soldier.ts';
import { createMercRecord } from './merc-record.ts';
import { handleMoraleEvent, type MoraleContext, MoraleEvent } from './morale.ts';
import { RosterMerc } from './roster.ts';

const HERE: Sector = { x: 9, y: 1, z: 0 };
const ELSEWHERE: Sector = { x: 13, y: 4, z: 0 };
const Attitude = { NORMAL: 0, OPTIMIST: 3, AGGRESSIVE: 5, COWARD: 9 } as const;

const STATS = {
  agility: 60,
  dexterity: 60,
  strength: 60,
  wisdom: 60,
  leadership: 60,
  marksmanship: 60,
  mechanical: 60,
  explosives: 60,
  medical: 60,
  experience: 3,
};

function merc(
  id: number,
  sector: Sector,
  profile: number = id + 1,
  extra: Partial<{ betweenSectors: boolean; prev: number; assignment: number }> = {},
) {
  const soldier = createSoldier({
    id,
    team: 0,
    name: `m${id}`,
    profile,
    bodyType: 0,
    palettes: { hair: 'BLACKHEAD', skin: 'PINKSKIN', vest: 'BLUEVEST', pants: 'JEANPANTS' },
    stats: STATS,
    life: 60,
    gridNo: -1,
    direction: 0,
    state: 0,
  });
  return new RosterMerc(
    createMercRecord({
      soldier,
      profile: null,
      kind: 1,
      statusFlags: 0,
      sector,
      betweenSectors: extra.betweenSectors ?? false,
      groupId: 1,
      prevSectorId: extra.prev ?? 255,
      insertionCode: 0,
      insertionDirection: 0,
      path: [],
      assignment: extra.assignment ?? Assignment.SQUAD_1,
      vehicleId: -1,
      asleep: false,
    }),
  );
}

type TestContext = MoraleContext & { readonly profiles: Map<number, ProfileProgress> };

function context(
  team: RosterMerc[],
  attitudes: Record<number, number> = {},
  extra: Partial<Omit<MoraleContext, 'profiles'>> = {},
): TestContext {
  const profiles = new Map(team.map((m) => [m.profile, progressFor(m.profile, { attitude: attitudes[m.profile] ?? Attitude.NORMAL })]));
  return { team, progress: 20, enemyInSector: false, ...extra, profiles };
}

describe('strategic morale events', () => {
  it('rewards a won battle in the sector and by hearsay elsewhere, with the attitude bonus', () => {
    const team = [merc(0, HERE), merc(1, ELSEWHERE), merc(2, HERE)];
    handleMoraleEvent(context(team, { 3: Attitude.OPTIMIST }), null, MoraleEvent.BATTLE_WON, HERE);
    expect(team.map((m) => m.soldier.strategicMoraleMod)).toEqual([4, 2, 5]);
    expect(team.map((m) => m.soldier.morale)).toEqual([58, 56, 59]);
  });

  it('doubles running away for the aggressive, spares cowards and counts those who just left', () => {
    const leaving = merc(3, { x: 9, y: 2, z: 0 }, 4, { betweenSectors: true, prev: 8 });
    const team = [merc(0, HERE), merc(1, HERE), merc(2, HERE), leaving, merc(4, ELSEWHERE)];
    handleMoraleEvent(context(team, { 2: Attitude.AGGRESSIVE, 3: Attitude.COWARD }), null, MoraleEvent.RAN_AWAY, HERE);
    expect(team.map((m) => m.soldier.strategicMoraleMod)).toEqual([-5, -10, 0, -5, -2]);
  });

  it('spreads a teammate death with the squadmate, buddy and hated rules', () => {
    const dead = merc(0, HERE, 10);
    const buddy = merc(1, HERE, 11);
    const hater = merc(2, ELSEWHERE, 12);
    const team = [dead, buddy, hater];
    const ctx = context(team);
    ctx.profiles.set(11, progressFor(11, { buddies: [10, 0, 0] }));
    ctx.profiles.set(12, progressFor(12, { hated: [10, 0, 0] }));
    handleMoraleEvent(ctx, dead, MoraleEvent.TEAMMATE_DIED, HERE);
    expect(buddy.soldier.tacticalMoraleMod).toBe(-5);
    expect(buddy.soldier.strategicMoraleMod).toBe(-20);
    expect(hater.soldier.strategicMoraleMod).toBe(5);
    expect(hater.soldier.tacticalMoraleMod).toBe(0);
  });

  it('keeps strategic changes for later while a battle runs elsewhere and ignores the dead, captives and the profileless', () => {
    const away = merc(0, ELSEWHERE);
    const pow = merc(1, HERE, 2, { assignment: Assignment.ASSIGNMENT_POW });
    const anonymous = merc(2, HERE, NO_PROFILE);
    const team = [away, pow, anonymous];
    const ctx = context(team, {}, { enemyInSector: true });
    ctx.profiles.delete(NO_PROFILE);
    handleMoraleEvent(ctx, null, MoraleEvent.HEARD_BATTLE_LOST, HERE);
    expect(away.soldier.delayedStrategicMoraleMod).toBe(-2);
    expect(away.soldier.strategicMoraleMod).toBe(0);
    expect(pow.soldier.delayedStrategicMoraleMod + pow.soldier.strategicMoraleMod).toBe(0);
    expect(anonymous.soldier.strategicMoraleMod).toBe(0);
  });
});

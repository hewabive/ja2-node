import { describe, expect, it } from 'vitest';
import { progressFor } from '../../../tests/support/autoresolve.ts';
import type { Sector } from '../../content/strategic/sector-ids.ts';
import { Assignment } from '../strategic/economy/constants.ts';
import type { ProfileProgress } from '../tactical/profiles.ts';
import { createSoldier, Personality } from '../tactical/soldier.ts';
import { MercKind, RosterMerc } from './roster.ts';
import {
  createTeamMoraleState,
  decayTacticalMoraleModifiers,
  hourlyMoraleUpdate,
  type TeamMoraleContext,
  type TeamMoraleEvent,
  updateBuddyAndHatedCounters,
} from './team-morale.ts';

const HERE: Sector = { x: 9, y: 1, z: 0 };
const BELOW: Sector = { x: 9, y: 1, z: 1 };
const HATED = -25;
const BUDDY = 25;

interface MercOptions {
  readonly sector?: Sector;
  readonly leadership?: number;
  readonly personality?: number;
  readonly kind?: number;
  readonly assignment?: number;
  readonly gridNo?: number;
  readonly placed?: boolean;
}

function merc(id: number, o: MercOptions = {}): RosterMerc {
  const soldier = createSoldier({
    id,
    team: 0,
    name: `m${id}`,
    profile: id + 1,
    bodyType: 0,
    palettes: { hair: 'BLACKHEAD', skin: 'PINKSKIN', vest: 'BLUEVEST', pants: 'JEANPANTS' },
    stats: {
      agility: 60,
      dexterity: 60,
      strength: 60,
      wisdom: 60,
      leadership: o.leadership ?? 50,
      marksmanship: 60,
      mechanical: 60,
      explosives: 60,
      medical: 60,
      experience: 3,
    },
    life: 60,
    gridNo: o.gridNo ?? -1,
    direction: 0,
    state: 0,
    personalityTrait: o.personality ?? Personality.NONE,
  });
  soldier.placed = o.placed ?? false;
  return new RosterMerc({
    soldier,
    profile: null,
    kind: o.kind ?? MercKind.AIM_MERC,
    statusFlags: 0,
    sector: o.sector ?? HERE,
    betweenSectors: false,
    groupId: 1,
    prevSectorId: 255,
    insertionCode: 0,
    insertionDirection: 0,
    path: [],
    assignment: o.assignment ?? Assignment.SQUAD_1,
    vehicleId: -1,
    asleep: false,
  });
}

function opinions(about: Record<number, number>): number[] {
  const list = new Array<number>(75).fill(0);
  for (const [profile, value] of Object.entries(about)) list[Number(profile)] = value;
  return list;
}

function context(team: RosterMerc[], profiles: Record<number, Partial<ProfileProgress>> = {}) {
  const events: TeamMoraleEvent[] = [];
  const map = new Map(team.map((m) => [m.profile, progressFor(m.profile, { opinions: opinions({}), ...profiles[m.profile] })]));
  const ctx: TeamMoraleContext = {
    team,
    profiles: map,
    progress: 0,
    enemyInSector: false,
    groupInMotion: () => false,
    squadSize: () => team.length,
    spacesAway: (a, b) => Math.abs(a - b),
    morale: createTeamMoraleState(),
    emit: (e) => events.push(e),
    stopTimeCompression: () => {},
  };
  return { ctx, events, profiles: map };
}

describe('HourlyMoraleUpdate', () => {
  it('moves the team modifier by a tenth of the gap to the average opinion plus the best leadership', () => {
    const team = [merc(0, { leadership: 90 }), merc(1), merc(2)];
    const { ctx } = context(team, { 1: { opinions: opinions({ 2: 20, 3: 0 }) } });
    hourlyMoraleUpdate(ctx);
    expect(team[0]?.soldier.teamMoraleMod).toBe(2);
    expect(team[1]?.soldier.teamMoraleMod).toBe(1);
    expect(team[0]?.soldier.morale).toBe(52);
  });

  it('drops the whole opinion to hated when a hated teammate is past his tolerance', () => {
    const team = [merc(0), merc(1)];
    const hated = [2, -1, -1, -1, -1];
    const { ctx } = context(team, {
      1: { opinions: opinions({ 2: HATED }), hated, hatedTime: [10, 0, 0, 0, 0], hatedCount: [10, 0, 0, 0, 0] },
    });
    hourlyMoraleUpdate(ctx);
    expect(team[0]?.soldier.teamMoraleMod).toBe(-3);
  });

  it('scales a hated opinion by the time left before it snaps', () => {
    const team = [merc(0), merc(1)];
    const { ctx } = context(team, {
      1: { opinions: opinions({ 2: HATED }), hated: [2, -1, -1, -1, -1], hatedTime: [10, 0, 0, 0, 0], hatedCount: [16, 0, 0, 0, 0] },
    });
    hourlyMoraleUpdate(ctx);
    expect(team[0]?.soldier.teamMoraleMod).toBe(2);
  });

  it('applies the delayed strategic modifier and decays the strategic one every third hour', () => {
    const team = [merc(0)];
    const s = team[0]?.soldier;
    if (!s) throw new Error('no merc');
    s.delayedStrategicMoraleMod = -12;
    s.strategicMoraleMod = 20;
    const { ctx } = context(team);
    hourlyMoraleUpdate(ctx);
    expect([s.strategicMoraleMod, s.delayedStrategicMoraleMod]).toEqual([8, 0]);
    hourlyMoraleUpdate(ctx);
    hourlyMoraleUpdate(ctx);
    expect(s.strategicMoraleMod).toBe(0);
    expect(ctx.morale.strategicDecayCounter).toBe(0);
  });

  it('skips sleeping mercs and those in transit', () => {
    const team = [merc(0, { leadership: 90 }), merc(1, { assignment: Assignment.IN_TRANSIT })];
    const sleeper = merc(2);
    sleeper.asleep = true;
    team.push(sleeper);
    const { ctx } = context(team);
    hourlyMoraleUpdate(ctx);
    expect(team.map((m) => m.soldier.teamMoraleMod)).toEqual([0, 0, 0]);
  });
});

describe('DecayTacticalMoraleModifiers', () => {
  it('decays the tactical modifier toward zero with the size-dependent step', () => {
    const team = [merc(0), merc(1)];
    const [a, b] = team.map((m) => m.soldier);
    if (!a || !b) throw new Error('no mercs');
    a.tacticalMoraleMod = 30;
    b.tacticalMoraleMod = -30;
    decayTacticalMoraleModifiers(context(team).ctx);
    expect([a.tacticalMoraleMod, b.tacticalMoraleMod]).toEqual([25, -27]);
  });

  it('keeps a claustrophobe underground from recovering and pushes him toward the phobic limit', () => {
    const team = [merc(0, { sector: BELOW, personality: Personality.CLAUSTROPHOBIC })];
    const s = team[0]?.soldier;
    if (!s) throw new Error('no merc');
    s.tacticalMoraleMod = -5;
    decayTacticalMoraleModifiers(context(team).ctx);
    expect(s.tacticalMoraleMod).toBe(-6);
  });

  it('lets a nervous merc with low morale sink while he is far from every friend', () => {
    const team = [merc(0, { personality: Personality.NERVOUS, placed: true, gridNo: 100 }), merc(1, { placed: true, gridNo: 200 })];
    const s = team[0]?.soldier;
    if (!s) throw new Error('no merc');
    s.morale = 40;
    s.tacticalMoraleMod = -4;
    decayTacticalMoraleModifiers(context(team).ctx);
    expect(s.tacticalMoraleMod).toBe(-5);
    const friend = team[1]?.soldier;
    if (!friend) throw new Error('no friend');
    friend.gridNo = 105;
    s.morale = 40;
    decayTacticalMoraleModifiers(context(team).ctx);
    expect(s.tacticalMoraleMod).toBe(0);
  });
});

describe('UpdateBuddyAndHatedCounters', () => {
  it('counts down the hated time and makes a M.E.R.C. merc quit when it runs out', () => {
    const team = [merc(0, { kind: MercKind.MERC }), merc(1)];
    const { ctx, events, profiles } = context(team, {
      1: { hated: [2, -1, -1, -1, -1], hatedTime: [4, 0, 0, 0, 0], hatedCount: [1, 0, 0, 0, 0] },
    });
    updateBuddyAndHatedCounters(ctx);
    expect(profiles.get(1)?.hatedCount[0]).toBe(0);
    expect(events).toEqual([{ type: 'quit', soldier: 0, about: 2, quote: 'MERC_QUIT_HATED1' }]);
  });

  it('turns a learned liking into a buddy slot with the buddy opinion', () => {
    const team = [merc(0), merc(1)];
    const { ctx, profiles } = context(team, {
      1: { buddies: [-1, -1, -1, -1, -1], learnToLike: 2, learnToLikeTime: 8, learnToLikeCount: 2 },
    });
    updateBuddyAndHatedCounters(ctx);
    expect(profiles.get(1)?.opinions[2]).toBe(12);
    updateBuddyAndHatedCounters(ctx);
    expect(profiles.get(1)?.buddies[2]).toBe(2);
    expect(profiles.get(1)?.opinions[2]).toBe(BUDDY);
  });

  it('holds the last hour of hatred while enemies are in the merc sector', () => {
    const team = [merc(0, { placed: true }), merc(1, { placed: true })];
    const { ctx, profiles } = context(team, { 1: { hated: [2, -1, -1, -1, -1], hatedTime: [4, 0, 0, 0, 0], hatedCount: [1, 0, 0, 0, 0] } });
    updateBuddyAndHatedCounters({ ...ctx, enemyInSector: true });
    expect(profiles.get(1)?.hatedCount[0]).toBe(1);
  });
});

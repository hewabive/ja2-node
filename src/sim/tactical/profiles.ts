// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-15. See LICENSE (SFI-SCLA).
// @src src/game/Tactical/Campaign.h StatKind; Soldier_Profile_Type.h MERCPROFILESTRUCT (mutable campaign fields)

import type { MercProfile } from '../../content/formats/prof.ts';

export const StatKind = {
  SALARY: 0,
  HEALTH: 1,
  AGILITY: 2,
  DEXTERITY: 3,
  WISDOM: 4,
  MEDICAL: 5,
  EXPLOSIVES: 6,
  MECHANICAL: 7,
  MARKSMANSHIP: 8,
  EXPERIENCE: 9,
  STRENGTH: 10,
  LEADERSHIP: 11,
} as const;

export type StatKey =
  | 'lifeMax'
  | 'agility'
  | 'dexterity'
  | 'wisdom'
  | 'medical'
  | 'explosives'
  | 'mechanical'
  | 'marksmanship'
  | 'experience'
  | 'strength'
  | 'leadership';

export const STAT_KEYS: Readonly<Record<number, StatKey>> = {
  [StatKind.HEALTH]: 'lifeMax',
  [StatKind.AGILITY]: 'agility',
  [StatKind.DEXTERITY]: 'dexterity',
  [StatKind.WISDOM]: 'wisdom',
  [StatKind.MEDICAL]: 'medical',
  [StatKind.EXPLOSIVES]: 'explosives',
  [StatKind.MECHANICAL]: 'mechanical',
  [StatKind.MARKSMANSHIP]: 'marksmanship',
  [StatKind.EXPERIENCE]: 'experience',
  [StatKind.STRENGTH]: 'strength',
  [StatKind.LEADERSHIP]: 'leadership',
};

export interface ProfileProgress {
  readonly id: number;
  readonly evolution: number;
  readonly attitude: number;
  readonly buddies: readonly number[];
  readonly hated: readonly number[];
  life: number;
  readonly stats: Record<StatKey, number>;
  readonly gains: Record<StatKey, number>;
  readonly statChangeChances: number[];
  readonly statChangeSuccesses: number[];
  kills: number;
  assists: number;
  shotsFired: number;
  shotsHit: number;
  timesWounded: number;
  dead: boolean;
}

function fromProfile(p: MercProfile): ProfileProgress {
  return {
    id: p.id,
    evolution: p.evolution,
    attitude: p.attitude,
    buddies: p.buddies,
    hated: p.hated,
    life: p.life,
    stats: {
      lifeMax: p.lifeMax,
      agility: p.agility,
      dexterity: p.dexterity,
      wisdom: p.wisdom,
      medical: p.medical,
      explosives: p.explosives,
      mechanical: p.mechanical,
      marksmanship: p.marksmanship,
      experience: p.experience,
      strength: p.strength,
      leadership: p.leadership,
    },
    gains: {
      lifeMax: p.gains.life,
      agility: p.gains.agility,
      dexterity: p.gains.dexterity,
      wisdom: p.gains.wisdom,
      medical: p.gains.medical,
      explosives: p.gains.explosives,
      mechanical: p.gains.mechanical,
      marksmanship: p.gains.marksmanship,
      experience: p.gains.expLevel,
      strength: p.gains.strength,
      leadership: p.gains.leadership,
    },
    statChangeChances: new Array<number>(12).fill(0),
    statChangeSuccesses: new Array<number>(12).fill(0),
    kills: 0,
    assists: 0,
    shotsFired: 0,
    shotsHit: 0,
    timesWounded: 0,
    dead: false,
  };
}

export interface ProfileSource {
  readonly profiles: Map<number, ProfileProgress>;
  readonly content: { readonly profiles: readonly MercProfile[] };
}

export function profileProgress(t: ProfileSource, id: number): ProfileProgress | null {
  const existing = t.profiles.get(id);
  if (existing) return existing;
  const p = t.content.profiles[id];
  if (!p) return null;
  const created = fromProfile(p);
  t.profiles.set(id, created);
  return created;
}

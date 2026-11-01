// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-30. See LICENSE (SFI-SCLA).
// @src src/game/Tactical/Animation_Control.h (the ANIM_ flag values; the RANDOM_ANIM_ values and gRandomAnimDefs,
// @src 2026-11-01).

import { FormatError } from '../binary/errors.ts';

export const ANIM_CONTROL_PATH = 'tables/anim-control.json';
export const ANIM_SURFACES_PATH = 'tables/anim-surfaces.json';
export const INVALID_SURFACE = -1;

export const AnimFlags = {
  IGNORE_AUTOSTANCE: 0x00000001,
  OK_CHARGE_AP_FOR_TURN: 0x00000002,
  STATIONARY: 0x00000004,
  MOVING: 0x00000008,
  TURNING: 0x00000010,
  FASTTURN: 0x00000020,
  FIREREADY: 0x00000040,
  NONINTERRUPT: 0x00000080,
  HITFINISH: 0x00000100,
  HITSTART: 0x00000200,
  HITWHENDOWN: 0x00000400,
  NOSHOW_MARKER: 0x00000800,
  NOMOVE_MARKER: 0x00001000,
  NORESTART: 0x00002000,
  HITSTOP: 0x00004000,
  SPECIALMOVE: 0x00008000,
  MERCIDLE: 0x00010000,
  STANCECHANGEANIM: 0x00020000,
  LOWER_WEAPON: 0x00040000,
  RAISE_WEAPON: 0x00080000,
  NOCHANGE_WEAPON: 0x00100000,
  NOCHANGE_PENDINGCOUNT: 0x00200000,
  NO_EFFORT: 0x00400000,
  MIN_EFFORT: 0x00800000,
  LIGHT_EFFORT: 0x01000000,
  MODERATE_EFFORT: 0x02000000,
  RT_NONINTERRUPT: 0x04000000,
  VARIABLE_EFFORT: 0x08000000,
  FIRE: 0x20000000,
  BREATH: 0x40000000,
  IGNOREHITFINISH: 0x80000000,
} as const;

export const RandomAnimHand = { NOTHING: 0, RIFLE: 1, IRRELEVANT: 2 } as const;

export const RandomAnimFlags = { CASUAL: 0x01, SECOND_BIG_MERC: 0x02, FIRST_BIG_MERC: 0x04, INJURED: 0x08, DRUNK: 0x10 } as const;

export interface RandomAnim {
  readonly hand: number;
  readonly state: number | null;
  readonly firstRoll: number;
  readonly lastRoll: number;
  readonly flags: number;
  readonly height: number;
}

type RandomAnimRow = Omit<RandomAnim, 'state'> & { readonly anim: string | null };

export interface AnimationControl {
  readonly index: number;
  readonly id: string;
  readonly movement: number;
  readonly flags: number;
  readonly speed: number;
  readonly height: number;
  readonly endHeight: number;
}

export interface BodySpeed {
  readonly speed: number;
  readonly movement: number;
}

export interface AnimationSurface {
  readonly id: number;
  readonly name: string;
  readonly file: string;
  readonly struct: number;
  readonly noFrames: boolean;
  readonly directions: number;
  readonly profile: number;
}

interface SubType {
  readonly state: number;
  readonly surfaces: readonly number[];
}

export interface AnimationTables {
  readonly controls: readonly AnimationControl[];
  readonly stateIndex: ReadonlyMap<string, number>;
  readonly bodyTypes: readonly string[];
  readonly randomAnims: readonly (readonly RandomAnim[])[];
  readonly bodySpeeds: {
    readonly walk: readonly BodySpeed[];
    readonly run: readonly BodySpeed[];
    readonly swat: readonly BodySpeed[];
    readonly crawl: readonly BodySpeed[];
  };
  readonly surfaces: readonly AnimationSurface[];
  readonly bodySurfaces: Readonly<Record<number, Readonly<Record<number, number>>>>;
  readonly itemSubSurfaces: Readonly<Record<number, Readonly<Record<number, number>>>>;
  readonly nothingBreath: readonly number[];
  readonly injuredRifleWalk: SubType;
  readonly injuredNothingWalk: SubType;
  readonly doubleHandedStanding: SubType;
}

export function parseAnimationTables(controlJson: unknown, surfacesJson: unknown): AnimationTables {
  const c = controlJson as {
    animations: AnimationControl[];
    bodyTypes: string[];
    bodySpeeds: AnimationTables['bodySpeeds'];
    randomAnims: RandomAnimRow[][];
  };
  const s = surfacesJson as Omit<AnimationTables, 'controls' | 'stateIndex' | 'bodyTypes' | 'randomAnims' | 'bodySpeeds'>;
  if (!Array.isArray(c?.animations) || !Array.isArray(c.randomAnims) || !Array.isArray(s?.surfaces))
    throw new FormatError('malformed animation tables');
  const stateIndex = new Map(c.animations.map((a) => [a.id, a.index]));
  return {
    controls: c.animations,
    stateIndex,
    bodyTypes: c.bodyTypes,
    randomAnims: c.randomAnims.map((rows) => rows.map((row) => randomAnim(row, stateIndex))),
    bodySpeeds: c.bodySpeeds,
    surfaces: s.surfaces,
    bodySurfaces: s.bodySurfaces,
    itemSubSurfaces: s.itemSubSurfaces,
    nothingBreath: s.nothingBreath,
    injuredRifleWalk: s.injuredRifleWalk,
    injuredNothingWalk: s.injuredNothingWalk,
    doubleHandedStanding: s.doubleHandedStanding,
  };
}

function randomAnim(row: RandomAnimRow, stateIndex: ReadonlyMap<string, number>): RandomAnim {
  const state = row.anim === null ? null : stateIndex.get(row.anim);
  if (state === undefined) throw new FormatError(`unknown random animation ${row.anim}`);
  return { hand: row.hand, state, firstRoll: row.firstRoll, lastRoll: row.lastRoll, flags: row.flags, height: row.height };
}

export function stateId(tables: AnimationTables, name: string): number {
  const i = tables.stateIndex.get(name);
  if (i === undefined) throw new RangeError(`unknown animation state ${name}`);
  return i;
}

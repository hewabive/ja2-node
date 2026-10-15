import { FormatError } from '../binary/errors.ts';

export const ANIM_CONTROL_PATH = 'tables/anim-control.json';
export const ANIM_SURFACES_PATH = 'tables/anim-surfaces.json';
export const INVALID_SURFACE = -1;

export const AnimFlags = {
  STATIONARY: 0x00000004,
  MOVING: 0x00000008,
  TURNING: 0x00000010,
  FASTTURN: 0x00000020,
  NORESTART: 0x00002000,
  SPECIALMOVE: 0x00008000,
  STANCECHANGEANIM: 0x00020000,
  BREATH: 0x40000000,
} as const;

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
  const c = controlJson as { animations: AnimationControl[]; bodyTypes: string[]; bodySpeeds: AnimationTables['bodySpeeds'] };
  const s = surfacesJson as Omit<AnimationTables, 'controls' | 'stateIndex' | 'bodyTypes' | 'bodySpeeds'>;
  if (!Array.isArray(c?.animations) || !Array.isArray(s?.surfaces)) throw new FormatError('malformed animation tables');
  return {
    controls: c.animations,
    stateIndex: new Map(c.animations.map((a) => [a.id, a.index])),
    bodyTypes: c.bodyTypes,
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

export function stateId(tables: AnimationTables, name: string): number {
  const i = tables.stateIndex.get(name);
  if (i === undefined) throw new RangeError(`unknown animation state ${name}`);
  return i;
}

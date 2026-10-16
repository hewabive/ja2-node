// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-15. See LICENSE (SFI-SCLA).
// @src src/externalized/ExplosionAnimationModel.cc, SmokeEffectModel.cc; DefaultContentManager.cc smoke effect ids;
// @src src/game/TileEngine/Tile_Cache.cc ubNumFrames from the STI aux data. See docs/12 §10.1.

import { decodeSti, isSti } from '../formats/sti.ts';

export const EXPLOSION_ANIMATIONS_PATH = 'externalized/explosion-animations.json';
export const SMOKE_EFFECTS_PATH = 'externalized/smoke-effects.json';

export const SmokeEffectId = { NOTHING: 0, SMOKE: 1, TEARGAS: 2, MUSTARDGAS: 3, CREATUREGAS: 4 } as const;

export interface ExplosionAnimation {
  readonly id: number;
  readonly name: string;
  readonly blastSpeed: number;
  readonly damageKeyframe: number;
  readonly transparentKeyframe: number;
  readonly graphics: string;
  readonly waterAnimation: string | null;
  readonly frames: number;
}

export interface SmokeEffectType {
  readonly id: number;
  readonly name: string;
  readonly damage: number;
  readonly breathDamage: number;
  readonly lostVisibilityPerTile: number;
  readonly maxVisibility: number;
  readonly maxVisibilityWhenAffected: number;
  readonly ignoresGasMask: boolean;
  readonly affectsRobot: boolean;
  readonly affectsMonsters: boolean;
}

export interface ExplosionContent {
  readonly animations: ReadonlyMap<string, ExplosionAnimation>;
  readonly smokeEffects: ReadonlyMap<string, SmokeEffectType>;
}

type Json = Record<string, unknown>;
export type FrameCountOf = (graphics: string) => number | null;

const num = (o: Json, key: string, fallback = 0): number => (typeof o[key] === 'number' ? (o[key] as number) : fallback);
const str = (o: Json, key: string): string | null => (typeof o[key] === 'string' ? (o[key] as string) : null);
const flag = (o: Json, key: string, fallback: boolean): boolean => (typeof o[key] === 'boolean' ? (o[key] as boolean) : fallback);

function fallbackFrames(damageKeyframe: number): number {
  return damageKeyframe + 1;
}

function animation(o: Json, frameCount: FrameCountOf): ExplosionAnimation {
  const graphics = str(o, 'graphics') ?? '';
  const damageKeyframe = num(o, 'damageKeyframe');
  return {
    id: num(o, 'id'),
    name: str(o, 'name') ?? '',
    blastSpeed: num(o, 'blastSpeed'),
    damageKeyframe,
    transparentKeyframe: num(o, 'transparentKeyframe'),
    graphics,
    waterAnimation: str(o, 'waterAnimation'),
    frames: frameCount(graphics) ?? fallbackFrames(damageKeyframe),
  };
}

function smokeEffect(o: Json, index: number): SmokeEffectType {
  return {
    id: index + 1,
    name: str(o, 'name') ?? '',
    damage: num(o, 'damage'),
    breathDamage: num(o, 'breathDamage'),
    lostVisibilityPerTile: num(o, 'lostVisibilityPerTile'),
    maxVisibility: num(o, 'maxVisibility'),
    maxVisibilityWhenAffected: num(o, 'maxVisibilityWhenAffected'),
    ignoresGasMask: flag(o, 'ignoresGasMask', false),
    affectsRobot: flag(o, 'affectsRobot', false),
    affectsMonsters: flag(o, 'affectsMonsters', true),
  };
}

export function parseExplosionContent(animations: unknown, smokeEffects: unknown, frameCount: FrameCountOf = () => null): ExplosionContent {
  const anims = (animations as Json[]).map((o) => animation(o, frameCount));
  const smokes = (smokeEffects as Json[]).map(smokeEffect);
  return {
    animations: new Map(anims.map((a) => [a.name, a])),
    smokeEffects: new Map(smokes.map((s) => [s.name, s])),
  };
}

export function stiFrameCount(bytes: Uint8Array | null): number | null {
  if (!bytes || !isSti(bytes)) return null;
  const sti = decodeSti(bytes, false);
  if (sti.kind !== 'indexed') return 1;
  return sti.appData?.[0]?.numberOfFrames ?? 1;
}

export async function loadExplosionContent(read: (path: string) => Promise<Uint8Array | null>): Promise<ExplosionContent> {
  const json = async (path: string) => {
    const bytes = await read(path);
    if (!bytes) throw new Error(`missing ${path}`);
    return JSON.parse(new TextDecoder().decode(bytes)) as unknown;
  };
  const [animations, smokes] = await Promise.all([json(EXPLOSION_ANIMATIONS_PATH), json(SMOKE_EFFECTS_PATH)]);
  const graphics = [...new Set((animations as Json[]).map((o) => str(o, 'graphics') ?? ''))];
  const frames = new Map(await Promise.all(graphics.map(async (g) => [g, stiFrameCount(await read(g))] as const)));
  return parseExplosionContent(animations, smokes, (g) => frames.get(g) ?? null);
}

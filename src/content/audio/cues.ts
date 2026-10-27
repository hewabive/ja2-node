// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-18. See LICENSE (SFI-SCLA).
// @src src/game/Tactical/Soldier_Control.cc InternalPlaySoldierFootstepSound, SoldierGotHit (impact sounds);
// @src Tactical/Weapons.cc GetBurstSoundName, UseGun, BulletHitStructure, StructureHit and ShotMiss (miss sounds),
// @src DoSpecialEffectAmmoMiss (the HE blast), WindowHit (the glass); Tactical/Items.cc ReloadGun;
// @src Tactical/Soldier_Ani.cc AdjustToNextAnimationFrame (codes 700-791, the battle cry of 717);
// @src TileEngine/Structure.cc guiMaterialHitSound, DamageStructure; TileEngine/Explosion_Control.cc
// @src GenerateExplosionFromExplosionPointer; Tactical/Handle_Doors.cc HandleDoorChangeFromGridNo; Tactical/Keys.cc DoUnlockDoor, AttemptToUnlockDoor, AttemptToCrowbarLock, AttemptToSmashDoor,
// @src HandleDoorTrap; Tactical/Handle_Items.cc (the drop impact); Laptop/Laptop.cc (power up and down). See docs/27 §3.1.

import { type Cue, cueOf, effectCue, type FileExists, type Rand, soundRange, VolumeLevel } from './cue.ts';
import type { CueBook, WeaponSounds } from './cue-book.ts';
import { NOWHERE } from './sound-position.ts';
import { BURST_ROUNDS_PLACEHOLDER } from './sound-table.ts';

export const GENERIC_BURST_SOUND = 'sounds/weapons/bursttype1.wav';
export const LAPTOP_POWER_UP = 'sounds/laptop power up (8-11).wav';
export const LAPTOP_POWER_DOWN = 'sounds/laptop power down (8-11).wav';

export const TerrainKind = {
  FLAT_FLOOR: 2,
  PAVED_ROAD: 3,
  DIRT_ROAD: 4,
  LOW_WATER: 8,
  MED_WATER: 9,
  DEEP_WATER: 10,
} as const;

export const SoundBody = {
  REGFEMALE: 3,
  ADULTFEMALEMONSTER: 4,
  AM_MONSTER: 5,
  YAF_MONSTER: 6,
  YAM_MONSTER: 7,
  LARVAE_MONSTER: 8,
  INFANT_MONSTER: 9,
  QUEENMONSTER: 10,
  HATKIDCIV: 15,
  KIDCIV: 16,
  COW: 18,
  CROW: 19,
  BLOODCAT: 20,
  ROBOTNOWEAPON: 21,
  FIRST_VEHICLE: 22,
  LAST_VEHICLE: 27,
} as const;

const FOOTSTEP_VARIANTS = 4;
const WATER_STEP_VARIANTS = 2;
const MAX_VARIANT_DRAWS = 16;

export interface StepContext {
  readonly gridNo: number;
  readonly terrain: number;
  readonly bodyType: number;
  readonly crawling: boolean;
  readonly hopFence: boolean;
  readonly quiet: boolean;
}

export interface Footstep {
  readonly cue: Cue;
  readonly variant: number;
}

export function isVehicleBody(bodyType: number): boolean {
  return bodyType >= SoundBody.FIRST_VEHICLE && bodyType <= SoundBody.LAST_VEHICLE;
}

function footstepBase(ctx: StepContext): { readonly first: string; readonly variants: number } {
  if (ctx.crawling) return { first: 'CRAWL_1', variants: FOOTSTEP_VARIANTS };
  switch (ctx.terrain) {
    case TerrainKind.FLAT_FLOOR:
      return { first: 'WALK_LEFT_IN', variants: FOOTSTEP_VARIANTS };
    case TerrainKind.DIRT_ROAD:
    case TerrainKind.PAVED_ROAD:
      return { first: 'WALK_LEFT_ROAD', variants: FOOTSTEP_VARIANTS };
    case TerrainKind.LOW_WATER:
    case TerrainKind.MED_WATER:
      return { first: 'WATER_WALK1_IN', variants: WATER_STEP_VARIANTS };
    case TerrainKind.DEEP_WATER:
      return { first: 'SWIM_1', variants: WATER_STEP_VARIANTS };
    default:
      return { first: 'WALK_LEFT_OUT', variants: FOOTSTEP_VARIANTS };
  }
}

export function nextFootstepVariant(variants: number, last: number, rand: Rand): number {
  for (let draw = 0; draw < MAX_VARIANT_DRAWS; draw++) {
    const v = rand(variants);
    if (v !== last) return v;
  }
  return (last + 1) % variants;
}

export function footstepCue(book: CueBook, ctx: StepContext, lastVariant: number, rand: Rand): Footstep | null {
  if (isVehicleBody(ctx.bodyType)) return null;
  const loud = ctx.hopFence ? VolumeLevel.HIGH : VolumeLevel.MID;
  if (ctx.bodyType === SoundBody.ROBOTNOWEAPON) {
    const cue = effectCue(book, 'ROBOT_BEEP', 'soldier', loud, ctx.gridNo);
    return cue ? { cue, variant: lastVariant } : null;
  }
  const base = footstepBase(ctx);
  const variant = nextFootstepVariant(base.variants, lastVariant, rand);
  const ids = book.effects.sounds;
  const first = ids.findIndex((s) => s.name === base.first);
  const path = ids[first + variant]?.path;
  if (first < 0 || !path) return null;
  return { cue: cueOf(path, 'soldier', ctx.quiet ? VolumeLevel.LOW : loud, ctx.gridNo), variant };
}

export interface ShotSound {
  readonly item: number;
  readonly silenced: boolean;
  readonly burst: boolean;
  readonly rounds: number;
}

export function burstSoundName(weapon: WeaponSounds, silenced: boolean, rounds: number, exists: FileExists): string {
  const pattern = silenced ? weapon.silencedBurstSound : weapon.burstSound;
  if (pattern !== '') {
    const file = pattern.replace(BURST_ROUNDS_PLACEHOLDER, String(rounds));
    if (exists(file)) return file;
  }
  if (rounds === 1) {
    const single = silenced ? weapon.silencedSound : weapon.sound;
    if (single !== '' && exists(single)) return single;
  }
  return GENERIC_BURST_SOUND;
}

export function gunshotCue(book: CueBook, gridNo: number, shot: ShotSound, exists: FileExists): Cue | null {
  const weapon = book.weapons.get(shot.item);
  if (!weapon || weapon.kind === 'throwingBlade' || shot.rounds === 0) return null;
  if (shot.burst) return cueOf(burstSoundName(weapon, shot.silenced, shot.rounds, exists), 'location', VolumeLevel.HIGH, gridNo);
  const file = shot.silenced ? weapon.silencedSound : weapon.sound;
  return file !== '' ? cueOf(file, 'location', VolumeLevel.HIGH, gridNo) : null;
}

export function dryFireCue(book: CueBook, gridNo: number): Cue | null {
  return effectCue(book, 'S_DRYFIRE1', 'location', VolumeLevel.MID, gridNo);
}

export function reloadCue(book: CueBook, item: number): Cue | null {
  const name = book.weapons.get(item)?.reload;
  return name ? effectCue(book, name, 'fixed', VolumeLevel.HIGH) : null;
}

export function lockAndLoadCue(book: CueBook, item: number, gridNo: number): Cue | null {
  const name = book.weapons.get(item)?.lockAndLoad;
  return name ? effectCue(book, name, 'location', VolumeLevel.HIGH, gridNo) : null;
}

export function weaponByName(book: CueBook, name: string): WeaponSounds | null {
  for (const w of book.weapons.values()) if (w.name === name) return w;
  return null;
}

export function impactCue(book: CueBook, gridNo: number, blade: boolean, rand: Rand): Cue | null {
  const name = blade ? 'KNIFE_IMPACT' : soundRange(book, 'BULLET_IMPACT_1', 'BULLET_IMPACT_3', rand);
  return effectCue(book, name, 'location', VolumeLevel.MID, gridNo);
}

const MATERIAL_HIT_SOUNDS: readonly (string | null)[] = [
  null,
  'S_WOOD_IMPACT1',
  'S_WOOD_IMPACT2',
  'S_WOOD_IMPACT3',
  'S_VEG_IMPACT1',
  null,
  'S_PORCELAIN_IMPACT1',
  null,
  null,
  null,
  null,
  'S_STONE_IMPACT1',
  'S_STONE_IMPACT1',
  'S_STONE_IMPACT1',
  'S_STONE_IMPACT1',
  'S_RUBBER_IMPACT1',
  null,
  null,
  null,
  null,
  null,
  'S_METAL_IMPACT1',
  'S_METAL_IMPACT2',
  'S_METAL_IMPACT3',
  'S_STONE_IMPACT1',
  'S_METAL_IMPACT3',
  null,
];
const MATERIAL_INDESTRUCTABLE_STONE = 24;
const MATERIAL_INDESTRUCTABLE_METAL = 25;

export function materialHitCue(book: CueBook, gridNo: number, material: number, caveWall: boolean): Cue | null {
  if (material === MATERIAL_INDESTRUCTABLE_STONE || material === MATERIAL_INDESTRUCTABLE_METAL) return null;
  const name = caveWall ? 'S_VEG_IMPACT1' : (MATERIAL_HIT_SOUNDS[material] ?? null);
  return name ? effectCue(book, name, 'location', VolumeLevel.HIGH, gridNo) : null;
}

export type MissSurface = 'ground' | 'air';

export function missCue(book: CueBook, gridNo: number, weapon: WeaponSounds | null, surface: MissSurface, rand: Rand): Cue | null {
  if (weapon?.kind === 'blade' || weapon?.kind === 'throwingBlade') return effectCue(book, 'MISS_KNIFE', 'panned', VolumeLevel.MID, gridNo);
  if (weapon && !['handgun', 'smg', 'rifle', 'shotgun', 'lmg'].includes(weapon.kind)) return null;
  const volume = weapon?.kind === 'shotgun' ? VolumeLevel.LOW : VolumeLevel.MID;
  const name = surface === 'ground' ? 'MISS_G2' : soundRange(book, 'MISS_1', 'MISS_8', rand);
  return effectCue(book, name, 'panned', volume, gridNo);
}

export function offMapMissCue(book: CueBook, weapon: WeaponSounds | null, explosiveAmmo: boolean, rand: Rand): Cue | null {
  if (weapon?.kind === 'monster') return effectCue(book, 'SPIT_RICOCHET', 'fixed', VolumeLevel.HIGH);
  if (!weapon || !['handgun', 'smg', 'rifle', 'shotgun', 'lmg'].includes(weapon.kind)) return null;
  if (explosiveAmmo) return effectCue(book, 'SMALL_EXPLODE_1', 'fixed', VolumeLevel.MID);
  return effectCue(book, soundRange(book, 'MISS_1', 'MISS_8', rand), 'fixed', VolumeLevel.HIGH);
}

export function smallExplosionCue(book: CueBook, gridNo: number): Cue | null {
  return effectCue(book, 'SMALL_EXPLODE_1', 'location', VolumeLevel.HIGH, gridNo);
}

export function glassShatterCue(book: CueBook, gridNo: number, rand: Rand): Cue | null {
  return effectCue(book, soundRange(book, 'GLASS_SHATTER1', 'GLASS_SHATTER2', rand), 'panned', VolumeLevel.MID, gridNo);
}

export function explosionCue(book: CueBook, animation: string, gridNo: number, rand: Rand): Cue | null {
  const candidates = book.explosions.get(animation) ?? [];
  const file = candidates[rand(candidates.length)];
  return file ? cueOf(file, 'location', VolumeLevel.HIGH, gridNo) : null;
}

export type DoorKind = 'wood' | 'cloth' | 'garage' | 'metal';

export function doorCue(book: CueBook, gridNo: number, kind: DoorKind, open: boolean, rand: Rand): Cue | null {
  const name =
    kind === 'cloth'
      ? open
        ? 'CURTAINS_OPEN'
        : 'CURTAINS_CLOSE'
      : kind === 'garage'
        ? open
          ? 'GARAGE_DOOR_OPEN'
          : 'GARAGE_DOOR_CLOSE'
        : kind === 'metal'
          ? open
            ? 'METAL_DOOR_OPEN'
            : 'METAL_DOOR_CLOSE'
          : open
            ? soundRange(book, 'DROPEN_1', 'DROPEN_3', rand)
            : soundRange(book, 'DRCLOSE_1', 'DRCLOSE_2', rand);
  return effectCue(book, name, 'location', VolumeLevel.MID, gridNo);
}

export interface LockOutcome {
  readonly action: string;
  readonly result: string;
  readonly doorGridNo: number;
  readonly soldierGridNo: number;
}

export function lockOutcomeCue(book: CueBook, o: LockOutcome): Cue | null {
  if (o.action === 'unlock' && o.result === 'opened') return effectCue(book, 'UNLOCK_DOOR_1', 'location', VolumeLevel.MID, o.doorGridNo);
  if ((o.action === 'unlock' || o.action === 'lock') && o.result === 'wrongKey')
    return effectCue(book, 'KEY_FAILURE', 'fixed', VolumeLevel.MID);
  if ((o.action === 'crowbar' || o.action === 'force') && o.result === 'opened')
    return effectCue(book, 'BREAK_LOCK', 'location', VolumeLevel.MID, o.soldierGridNo);
  return null;
}

const SIREN_LOOPS = 5;

export function doorTrapCue(book: CueBook, trap: string, gridNo: number): Cue | null {
  if (trap === 'siren') return effectCue(book, 'KLAXON_ALARM', 'location', VolumeLevel.MID, gridNo, SIREN_LOOPS);
  if (trap === 'electric') return effectCue(book, 'DOOR_ELECTRICITY', 'location', VolumeLevel.MID, gridNo);
  return null;
}

export function dropCue(book: CueBook, gridNo: number): Cue | null {
  return effectCue(book, 'THROW_IMPACT_2', 'location', VolumeLevel.MID, gridNo);
}

export type CreatureCall = 'onePrey' | 'multiplePrey' | 'attacked' | 'crippled';

export interface OpContext {
  readonly gridNo: number;
  readonly bodyType: number;
  readonly stealth: boolean;
  readonly onScreen: boolean;
  readonly handItem: number | null;
  readonly creatureCall: CreatureCall | null;
}

export type OpSound =
  | { readonly kind: 'cue'; readonly cue: Cue }
  | { readonly kind: 'footstep' }
  | { readonly kind: 'battle'; readonly sound: 'DIE1' | 'COOL1' };

interface SimpleOp {
  readonly first: string;
  readonly last?: string;
  readonly volume: number;
  readonly mix: 'soldier' | 'location' | 'fixed';
  readonly when?: (ctx: OpContext, rand: Rand) => boolean;
}

const notStealthy = (ctx: OpContext) => !ctx.stealth;
const visibleOnScreen = (ctx: OpContext) => ctx.onScreen;
const H = VolumeLevel.HIGH;
const M = VolumeLevel.MID;
const L = VolumeLevel.LOW;
const CROW_PECK_CHANCE = 5;

const SIMPLE_OPS: ReadonlyMap<number, SimpleOp> = new Map<number, SimpleOp>([
  [702, { first: 'FALL_1', last: 'FALL_2', volume: H, mix: 'soldier' }],
  [705, { first: 'BODY_SPLAT_1', volume: H, mix: 'soldier' }],
  [706, { first: 'HEADSPLAT_1', volume: H, mix: 'soldier' }],
  [707, { first: 'CREATURE_BATTLECRY_1', volume: H, mix: 'location' }],
  [710, { first: 'ACR_STEP_1', volume: M, mix: 'soldier', when: visibleOnScreen }],
  [711, { first: 'ACR_STEP_2', volume: M, mix: 'soldier', when: visibleOnScreen }],
  [712, { first: 'LCR_MOVEMENT', volume: M, mix: 'soldier', when: visibleOnScreen }],
  [713, { first: 'BCR_DRAGGING', volume: M, mix: 'soldier', when: (c) => c.bodyType === SoundBody.INFANT_MONSTER && c.onScreen }],
  [714, { first: 'ACR_LUNGE', volume: H, mix: 'soldier' }],
  [715, { first: 'ACR_SWIPE', volume: H, mix: 'soldier' }],
  [716, { first: 'ACR_EATFLESH', volume: H, mix: 'soldier' }],
  [718, { first: 'LQ_RUPTURING', volume: H, mix: 'soldier' }],
  [719, { first: 'LQ_ENRAGED_ATTACK', volume: H, mix: 'soldier' }],
  [720, { first: 'LQ_WHIP_ATTACK', volume: H, mix: 'soldier' }],
  [721, { first: 'FALL_TO_GROUND_1', last: 'FALL_TO_GROUND_3', volume: H, mix: 'soldier' }],
  [722, { first: 'HEAVY_FALL_1', volume: H, mix: 'soldier' }],
  [723, { first: 'IDLE_ARMPIT', volume: L, mix: 'soldier' }],
  [725, { first: 'IDLE_BACKCRACK', volume: L, mix: 'soldier' }],
  [726, { first: 'KICKIN_DOOR', volume: H, mix: 'soldier' }],
  [727, { first: 'SWOOSH_1', last: 'SWOOSH_6', volume: H, mix: 'soldier' }],
  [728, { first: 'ACR_FALL_1', volume: H, mix: 'soldier' }],
  [729, { first: 'GRAB_ROOF', volume: H, mix: 'soldier' }],
  [730, { first: 'LAND_ON_ROOF', volume: H, mix: 'soldier' }],
  [731, { first: 'FALL_TO_GROUND_1', last: 'FALL_TO_GROUND_3', volume: H, mix: 'soldier' }],
  [763, { first: 'THROW_IMPACT_2', volume: M, mix: 'location' }],
  [764, { first: 'PICKING_LOCK', volume: H, mix: 'soldier' }],
  [767, { first: 'SLAP_2', volume: H, mix: 'soldier' }],
  [770, { first: 'USE_WIRE_CUTTERS', volume: H, mix: 'fixed' }],
  [771, { first: 'BLOODCAT_ATTACK', volume: H, mix: 'fixed' }],
  [773, { first: 'KNEEL_UP_SOUND', volume: M, mix: 'soldier', when: notStealthy }],
  [774, { first: 'KNEEL_DOWN_SOUND', volume: M, mix: 'soldier', when: notStealthy }],
  [775, { first: 'PRONE_UP_SOUND', volume: M, mix: 'soldier', when: notStealthy }],
  [776, { first: 'PRONE_DOWN_SOUND', volume: M, mix: 'soldier', when: notStealthy }],
  [777, { first: 'PICKING_SOMETHING_UP', volume: H, mix: 'soldier', when: notStealthy }],
  [778, { first: 'ENTER_DEEP_WATER_1', volume: H, mix: 'soldier', when: notStealthy }],
  [779, { first: 'COW_FALL', volume: H, mix: 'soldier' }],
  [780, { first: 'COW_HIT_SND', volume: H, mix: 'soldier' }],
  [781, { first: 'ACR_DIE_PART2', volume: H, mix: 'soldier' }],
  [782, { first: 'CREATURE_DISSOLVE_1', volume: H, mix: 'soldier' }],
  [784, { first: 'CREATURE_FALL', volume: H, mix: 'soldier' }],
  [785, { first: 'CROW_PECKING_AT_FLESH', volume: M, mix: 'soldier', when: (_c, rand) => rand(CROW_PECK_CHANCE) === 0 }],
  [786, { first: 'CROW_FLYING_AWAY', volume: M, mix: 'soldier' }],
  [787, { first: 'SLAP_1', volume: H, mix: 'soldier' }],
  [788, { first: 'MORTAR_START', volume: H, mix: 'soldier' }],
  [789, { first: 'MORTAR_LOAD', volume: H, mix: 'soldier' }],
  [790, { first: 'COW_FALL_2', volume: H, mix: 'soldier' }],
  [791, { first: 'FENCE_OPEN', volume: H, mix: 'soldier' }],
]);

export const FIRST_SOUND_OPCODE = 700;
export const LAST_SOUND_OPCODE = 798;
const OP_FOOTSTEP_LEFT = 703;
const OP_FOOTSTEP_RIGHT = 704;
const OP_LOCK_N_LOAD = 708;
const OP_KNIFE_THROW = 709;
const OP_DIE_SOUND = 732;
const OP_BATTLE_CRY = 717;
const OP_COOL_QUOTE = 766;

export function isSoundOpcode(code: number): boolean {
  return code >= FIRST_SOUND_OPCODE && code <= LAST_SOUND_OPCODE;
}

const QUEEN_CRIES: Readonly<Record<CreatureCall, string>> = {
  onePrey: 'LQ_SMELLS_THREAT',
  multiplePrey: 'LQ_SMELLS_THREAT',
  attacked: 'LQ_ENRAGED_ATTACK',
  crippled: 'LQ_CRIPPLED',
};
const CREATURE_CRIES: Readonly<Record<CreatureCall, string>> = {
  onePrey: 'ACR_SMELL_PREY',
  multiplePrey: 'ACR_SMELL_THREAT',
  attacked: 'ACR_SMELL_THREAT',
  crippled: 'ACR_CRIPPLED',
};

function battleCryCue(book: CueBook, ctx: OpContext): Cue | null {
  if (ctx.creatureCall === null) return null;
  const cries = ctx.bodyType === SoundBody.QUEENMONSTER ? QUEEN_CRIES : CREATURE_CRIES;
  return effectCue(book, cries[ctx.creatureCall], 'location', VolumeLevel.HIGH, ctx.gridNo);
}

function simpleOpCue(book: CueBook, op: SimpleOp, ctx: OpContext, rand: Rand): Cue | null {
  if (op.when && !op.when(ctx, rand)) return null;
  const name = op.last ? soundRange(book, op.first, op.last, rand) : op.first;
  return effectCue(book, name, op.mix, op.volume, op.mix === 'fixed' ? NOWHERE : ctx.gridNo);
}

export function opcodeSound(book: CueBook, code: number, ctx: OpContext, rand: Rand): OpSound | null {
  if (code === OP_FOOTSTEP_LEFT || code === OP_FOOTSTEP_RIGHT) return ctx.stealth ? null : { kind: 'footstep' };
  if (code === OP_DIE_SOUND) return { kind: 'battle', sound: 'DIE1' };
  if (code === OP_COOL_QUOTE) return { kind: 'battle', sound: 'COOL1' };
  let cue: Cue | null = null;
  if (code === OP_LOCK_N_LOAD) cue = ctx.handItem !== null ? lockAndLoadCue(book, ctx.handItem, ctx.gridNo) : null;
  else if (code === OP_BATTLE_CRY) cue = battleCryCue(book, ctx);
  else if (code === OP_KNIFE_THROW) {
    const knife = weaponByName(book, 'THROWING_KNIFE');
    cue = knife && knife.sound !== '' ? cueOf(knife.sound, 'location', VolumeLevel.HIGH, ctx.gridNo) : null;
  } else {
    const op = SIMPLE_OPS.get(code);
    cue = op ? simpleOpCue(book, op, ctx, rand) : null;
  }
  return cue ? { kind: 'cue', cue } : null;
}

export function laptopPowerCue(open: boolean): Cue {
  return cueOf(open ? LAPTOP_POWER_UP : LAPTOP_POWER_DOWN, 'fixed', VolumeLevel.HIGH);
}

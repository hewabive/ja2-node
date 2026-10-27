// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-18. See LICENSE (SFI-SCLA).
// @src src/externalized/WeaponModels.cc (calibre sound defaults, sReloadSound and sLocknLoadSound per weapon class);
// @src src/externalized/ExplosionAnimationModel.cc getSounds; src/game/Utils/Sound_Control.cc szSoundEffects. See docs/27 §3.1.

import { asArray, asObject, asString, type JsonObject } from '../strategic/json-fields.ts';
import { parseJsoncBytes } from '../strategic/jsonc.ts';
import {
  BATTLE_SOUNDS_PATH,
  type BattleSoundTable,
  parseBattleSounds,
  parseSoundEffects,
  SOUND_EFFECTS_PATH,
  type SoundEffectTable,
} from './sound-table.ts';

export const WEAPONS_PATH = 'externalized/weapons.json';
export const CALIBRES_PATH = 'externalized/calibres.json';
export const EXPLOSION_ANIMATIONS_PATH = 'externalized/explosion-animations.json';
export const CUE_BOOK_PATHS = [SOUND_EFFECTS_PATH, BATTLE_SOUNDS_PATH, WEAPONS_PATH, CALIBRES_PATH, EXPLOSION_ANIMATIONS_PATH] as const;

export type WeaponKind =
  | 'handgun'
  | 'smg'
  | 'rifle'
  | 'shotgun'
  | 'lmg'
  | 'launcher'
  | 'blade'
  | 'throwingBlade'
  | 'punch'
  | 'thrown'
  | 'monster'
  | 'other';

const KIND_BY_TYPE: Readonly<Record<string, WeaponKind>> = {
  PISTOL: 'handgun',
  M_PISTOL: 'handgun',
  SMG: 'smg',
  SN_RIFLE: 'rifle',
  RIFLE: 'rifle',
  ASRIFLE: 'rifle',
  SHOTGUN: 'shotgun',
  LMG: 'lmg',
  LAUNCHER: 'launcher',
  BLADE: 'blade',
  THROWINGBLADE: 'throwingBlade',
  PUNCHWEAPON: 'punch',
  THROWN: 'thrown',
  MONSTSPIT: 'monster',
};

const RELOAD_SOUNDS: Readonly<Partial<Record<WeaponKind, { readonly reload: string; readonly lockAndLoad: string }>>> = {
  handgun: { reload: 'S_RELOAD_PISTOL', lockAndLoad: 'S_LNL_PISTOL' },
  smg: { reload: 'S_RELOAD_SMG', lockAndLoad: 'S_LNL_SMG' },
  rifle: { reload: 'S_RELOAD_RIFLE', lockAndLoad: 'S_LNL_RIFLE' },
  shotgun: { reload: 'S_RELOAD_SHOTGUN', lockAndLoad: 'S_LNL_SHOTGUN' },
  lmg: { reload: 'S_RELOAD_LMG', lockAndLoad: 'S_LNL_LMG' },
};

export interface WeaponSounds {
  readonly item: number;
  readonly name: string;
  readonly kind: WeaponKind;
  readonly sound: string;
  readonly silencedSound: string;
  readonly burstSound: string;
  readonly silencedBurstSound: string;
  readonly reload: string | null;
  readonly lockAndLoad: string | null;
}

export interface CueBook {
  readonly effects: SoundEffectTable;
  readonly battle: BattleSoundTable;
  readonly weapons: ReadonlyMap<number, WeaponSounds>;
  readonly explosions: ReadonlyMap<string, readonly string[]>;
  readonly paths: ReadonlyMap<string, string>;
}

export interface CueBookSources {
  readonly effects: unknown;
  readonly battle: unknown;
  readonly weapons: unknown;
  readonly calibres: unknown;
  readonly explosions: unknown;
}

function optionalText(o: JsonObject, key: string, fallback: string): string {
  const v = o[key];
  return typeof v === 'string' && v !== '' ? v.toLowerCase() : fallback;
}

function calibreSounds(json: unknown): Map<string, JsonObject> {
  return new Map(
    asArray(json, 'calibres').map((c, i) => [
      asString(asObject(c, `calibres[${i}]`).internalName, `calibres[${i}].internalName`),
      asObject(c, ''),
    ]),
  );
}

export function parseWeaponSounds(weaponsJson: unknown, calibresJson: unknown): Map<number, WeaponSounds> {
  const calibres = calibreSounds(calibresJson);
  const out = new Map<number, WeaponSounds>();
  asArray(weaponsJson, 'weapons').forEach((w, i) => {
    const o = asObject(w, `weapons[${i}]`);
    const item = Number(o.itemIndex);
    const kind = KIND_BY_TYPE[String(o.internalType)] ?? 'other';
    const calibre = typeof o.calibre === 'string' ? (calibres.get(o.calibre) ?? {}) : {};
    const defaults = (key: string) => optionalText(calibre, key, '');
    const reload = RELOAD_SOUNDS[kind];
    out.set(item, {
      item,
      name: String(o.internalName),
      kind,
      sound: optionalText(o, 'sound', defaults('sound')),
      silencedSound: optionalText(o, 'silencedSound', defaults('silencedSound')),
      burstSound: optionalText(o, 'burstSound', defaults('burstSound')),
      silencedBurstSound: optionalText(o, 'silencedBurstSound', defaults('silencedBurstSound')),
      reload: reload?.reload ?? null,
      lockAndLoad: reload?.lockAndLoad ?? null,
    });
  });
  return out;
}

export function parseExplosionSounds(json: unknown): Map<string, readonly string[]> {
  return new Map(
    asArray(json, 'explosion animations').map((a, i) => {
      const o = asObject(a, `explosion animations[${i}]`);
      const sounds = asArray(o.sounds ?? [], `explosion animations[${i}].sounds`).map((s) => asString(s, 'sound').toLowerCase());
      return [asString(o.name, `explosion animations[${i}].name`), sounds];
    }),
  );
}

export function buildCueBook(sources: CueBookSources): CueBook {
  const effects = parseSoundEffects(sources.effects);
  const paths = new Map<string, string>();
  for (const s of effects.sounds) if (s.path) paths.set(s.name, s.path);
  return {
    effects,
    battle: parseBattleSounds(sources.battle),
    weapons: parseWeaponSounds(sources.weapons, sources.calibres),
    explosions: parseExplosionSounds(sources.explosions),
    paths,
  };
}

export async function loadCueBook(read: (path: string) => Promise<Uint8Array>): Promise<CueBook> {
  const [effects, battle, weapons, calibres, explosions] = await Promise.all(
    CUE_BOOK_PATHS.map(async (p) => parseJsoncBytes(await read(p))),
  );
  return buildCueBook({ effects, battle, weapons, calibres, explosions });
}

export function soundPath(book: CueBook, name: string): string | null {
  return book.paths.get(name) ?? null;
}

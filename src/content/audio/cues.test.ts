import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { PROJECT_DATA_DIR } from '../../node/repo.ts';
import { AmbientTime } from '../formats/ambient.ts';
import { ambientActive, ambientCue, ambientGapMs, ambientSilenced } from './ambient-schedule.ts';
import { type BattleRequest, battleSoundCue, battleVoiceBasename, NO_BATTLE_MEMORY, type VoiceSoldier } from './battle-sound.ts';
import type { Rand } from './cue.ts';
import { type CueBook, loadCueBook } from './cue-book.ts';
import {
  burstSoundName,
  doorCue,
  doorTrapCue,
  dryFireCue,
  explosionCue,
  footstepCue,
  GENERIC_BURST_SOUND,
  gunshotCue,
  impactCue,
  lockAndLoadCue,
  lockOutcomeCue,
  materialHitCue,
  missCue,
  nextFootstepVariant,
  opcodeSound,
  reloadCue,
  SoundBody,
  type StepContext,
  TerrainKind,
} from './cues.ts';
import { speechPathForLine } from './speech.ts';

let book: CueBook;
const G = 12880;
const first: Rand = () => 0;
const last: Rand = (n) => Math.max(0, n - 1);
const everything = () => true;
const nothing = () => false;

function sequence(values: readonly number[]): Rand {
  let i = 0;
  return (n) => (n <= 0 ? 0 : (values[i++ % values.length] ?? 0) % n);
}

function weaponItem(name: string): number {
  for (const w of book.weapons.values()) if (w.name === name) return w.item;
  throw new Error(name);
}

beforeAll(async () => {
  book = await loadCueBook((path) => readFile(join(PROJECT_DATA_DIR, path)));
});

describe('footsteps', () => {
  const step: StepContext = { gridNo: G, terrain: 1, bodyType: 0, crawling: false, hopFence: false, quiet: false };

  it('pick the sound family from the terrain under the soldier', () => {
    const file = (ctx: Partial<StepContext>) => footstepCue(book, { ...step, ...ctx }, 9, first)?.cue.file;
    expect(file({})).toBe(book.paths.get('WALK_LEFT_OUT'));
    expect(file({ terrain: TerrainKind.FLAT_FLOOR })).toBe(book.paths.get('WALK_LEFT_IN'));
    expect(file({ terrain: TerrainKind.PAVED_ROAD })).toBe(book.paths.get('WALK_LEFT_ROAD'));
    expect(file({ terrain: TerrainKind.DIRT_ROAD })).toBe(book.paths.get('WALK_LEFT_ROAD'));
    expect(file({ terrain: TerrainKind.LOW_WATER })).toBe(book.paths.get('WATER_WALK1_IN'));
    expect(file({ terrain: TerrainKind.DEEP_WATER })).toBe(book.paths.get('SWIM_1'));
    expect(file({ crawling: true, terrain: TerrainKind.FLAT_FLOOR })).toBe(book.paths.get('CRAWL_1'));
    expect(file({ bodyType: SoundBody.ROBOTNOWEAPON })).toBe(book.paths.get('ROBOT_BEEP'));
    expect(footstepCue(book, { ...step, bodyType: SoundBody.FIRST_VEHICLE }, 0, first)).toBeNull();
  });

  it('never repeat the last variant', () => {
    expect(nextFootstepVariant(4, 2, sequence([2, 2, 3]))).toBe(3);
    expect(nextFootstepVariant(2, 0, first)).toBe(1);
    const steps = footstepCue(book, step, 0, sequence([0, 0, 1]));
    expect(steps?.variant).toBe(1);
    expect(steps?.cue.file).toBe(book.paths.get('WALK_RIGHT_OUT'));
  });

  it('play at mid volume, loud over a fence, low in real time for a soldier who is not selected, scaled twice', () => {
    expect(footstepCue(book, step, 9, first)?.cue).toMatchObject({ baseVolume: 65, mix: 'soldier', gridNo: G });
    expect(footstepCue(book, { ...step, hopFence: true }, 9, first)?.cue.baseVolume).toBe(127);
    expect(footstepCue(book, { ...step, quiet: true, hopFence: true }, 9, first)?.cue.baseVolume).toBe(25);
  });
});

describe('gunfire', () => {
  it('plays the single shot or the silenced shot at high volume where the shooter stands', () => {
    const glock = weaponItem('GLOCK_17');
    expect(gunshotCue(book, G, { item: glock, silenced: false, burst: false, rounds: 1 }, everything)).toMatchObject({
      file: 'sounds/weapons/9mm single shot.wav',
      baseVolume: 127,
      mix: 'location',
      gridNo: G,
    });
    expect(gunshotCue(book, G, { item: glock, silenced: true, burst: false, rounds: 1 }, everything)?.file).toBe(
      'sounds/weapons/silencer 02.wav',
    );
  });

  it('plays one burst file formatted with the rounds, only for the first bullet', () => {
    const glock18 = weaponItem('GLOCK_18');
    expect(gunshotCue(book, G, { item: glock18, silenced: false, burst: true, rounds: 5 }, everything)?.file).toBe(
      'sounds/weapons/9mm burst 5.wav',
    );
    expect(gunshotCue(book, G, { item: glock18, silenced: true, burst: true, rounds: 3 }, everything)?.file).toBe(
      'sounds/weapons/silencer burst 3.wav',
    );
    expect(gunshotCue(book, G, { item: glock18, silenced: false, burst: true, rounds: 0 }, everything)).toBeNull();
  });

  it('falls back from a missing burst file to the single shot for one round, then to bursttype1', () => {
    const glock18 = book.weapons.get(weaponItem('GLOCK_18'));
    if (!glock18) throw new Error('GLOCK_18');
    const single = (p: string) => p === glock18.sound;
    expect(burstSoundName(glock18, false, 1, single)).toBe(glock18.sound);
    expect(burstSoundName(glock18, false, 4, single)).toBe(GENERIC_BURST_SOUND);
    expect(burstSoundName(glock18, false, 1, nothing)).toBe(GENERIC_BURST_SOUND);
  });

  it('leaves the throwing knife to its animation code, plays the dry fire on a jam', () => {
    expect(gunshotCue(book, G, { item: weaponItem('THROWING_KNIFE'), silenced: false, burst: false, rounds: 1 }, everything)).toBeNull();
    expect(dryFireCue(book, G)?.file).toBe(book.paths.get('S_DRYFIRE1'));
    expect(opcodeSound(book, 709, { gridNo: G, bodyType: 0, stealth: false, onScreen: true, handItem: null }, first)).toMatchObject({
      cue: { file: 'sounds/weapons/knife throw swoosh.wav' },
    });
  });

  it('reloads and locks and loads by weapon class', () => {
    expect(reloadCue(book, weaponItem('GLOCK_17'))).toMatchObject({
      file: book.paths.get('S_RELOAD_PISTOL'),
      mix: 'fixed',
      baseVolume: 127,
    });
    expect(reloadCue(book, weaponItem('MP5K'))?.file).toBe(book.paths.get('S_RELOAD_SMG'));
    expect(reloadCue(book, weaponItem('SPAS15'))?.file).toBe(book.paths.get('S_RELOAD_SHOTGUN'));
    expect(reloadCue(book, weaponItem('COMBAT_KNIFE'))).toBeNull();
    expect(lockAndLoadCue(book, weaponItem('M14'), G)).toMatchObject({ file: book.paths.get('S_LNL_RIFLE'), mix: 'location' });
  });
});

describe('impacts and misses', () => {
  it('hit soldiers with a knife impact or one of three bullet impacts at mid volume', () => {
    expect(impactCue(book, G, true, first)?.file).toBe(book.paths.get('KNIFE_IMPACT'));
    expect(impactCue(book, G, false, last)?.file).toBe(book.paths.get('BULLET_IMPACT_3'));
    expect(impactCue(book, G, false, first)?.baseVolume).toBe(65);
  });

  it('miss into the ground, the air, lower for shotguns, with a knife sound for blades', () => {
    const rifle = book.weapons.get(weaponItem('M14')) ?? null;
    const shotgun = book.weapons.get(weaponItem('SPAS15')) ?? null;
    expect(missCue(book, G, rifle, 'ground', first)).toMatchObject({ file: book.paths.get('MISS_G2'), mix: 'panned', baseVolume: 65 });
    expect(missCue(book, G, rifle, 'air', last)?.file).toBe(book.paths.get('MISS_8'));
    expect(missCue(book, G, shotgun, 'air', first)?.baseVolume).toBe(25);
    expect(missCue(book, G, book.weapons.get(weaponItem('THROWING_KNIFE')) ?? null, 'ground', first)?.file).toBe(
      book.paths.get('MISS_KNIFE'),
    );
  });

  it('play the material sound of a hit structure, vegetation for cave walls, nothing for indestructible ones', () => {
    expect(materialHitCue(book, G, 1, false)?.file).toBe(book.paths.get('S_WOOD_IMPACT1'));
    expect(materialHitCue(book, G, 12, false)?.file).toBe(book.paths.get('S_STONE_IMPACT1'));
    expect(materialHitCue(book, G, 22, false)?.file).toBe(book.paths.get('S_METAL_IMPACT2'));
    expect(materialHitCue(book, G, 12, true)?.file).toBe(book.paths.get('S_VEG_IMPACT1'));
    expect(materialHitCue(book, G, 17, false)).toBeNull();
    expect(materialHitCue(book, G, 24, true)).toBeNull();
    expect(materialHitCue(book, G, 1, false)?.baseVolume).toBe(127);
  });

  it('explode with one of the animation candidates', () => {
    expect(explosionCue(book, 'BLAST_1', G, last)?.file).toBe('sounds/explosion 10.wav');
    expect(explosionCue(book, 'WATER_BLAST', G, first)?.file).toBe('sounds/air escaping.wav');
    expect(explosionCue(book, 'NO_SUCH', G, first)).toBeNull();
  });
});

describe('doors and locks', () => {
  it('open and close by door kind', () => {
    expect(doorCue(book, G, 'wood', true, last)?.file).toBe(book.paths.get('DROPEN_3'));
    expect(doorCue(book, G, 'wood', false, first)?.file).toBe(book.paths.get('DRCLOSE_1'));
    expect(doorCue(book, G, 'cloth', true, first)?.file).toBe(book.paths.get('CURTAINS_OPEN'));
    expect(doorCue(book, G, 'garage', false, first)?.file).toBe(book.paths.get('GARAGE_DOOR_CLOSE'));
    expect(doorCue(book, G, 'metal', true, first)).toMatchObject({ file: book.paths.get('METAL_DOOR_OPEN'), baseVolume: 65 });
  });

  it('sound lock outcomes and traps', () => {
    const o = { doorGridNo: G, soldierGridNo: G + 1 };
    expect(lockOutcomeCue(book, { ...o, action: 'unlock', result: 'opened' })).toMatchObject({
      file: book.paths.get('UNLOCK_DOOR_1'),
      gridNo: G,
    });
    expect(lockOutcomeCue(book, { ...o, action: 'unlock', result: 'wrongKey' })).toMatchObject({
      file: book.paths.get('KEY_FAILURE'),
      mix: 'fixed',
    });
    expect(lockOutcomeCue(book, { ...o, action: 'crowbar', result: 'opened' })).toMatchObject({
      file: book.paths.get('BREAK_LOCK'),
      gridNo: G + 1,
    });
    expect(lockOutcomeCue(book, { ...o, action: 'pickLock', result: 'failed' })).toBeNull();
    expect(doorTrapCue(book, 'siren', G)).toMatchObject({ file: book.paths.get('KLAXON_ALARM'), loops: 5 });
    expect(doorTrapCue(book, 'electric', G)?.file).toBe(book.paths.get('DOOR_ELECTRICITY'));
    expect(doorTrapCue(book, 'explosion', G)).toBeNull();
  });
});

describe('animation codes 700-798', () => {
  const ctx = { gridNo: G, bodyType: 0, stealth: false, onScreen: true, handItem: null };

  it('map codes to cues, footsteps and battle sounds', () => {
    expect(opcodeSound(book, 703, ctx, first)).toEqual({ kind: 'footstep' });
    expect(opcodeSound(book, 703, { ...ctx, stealth: true }, first)).toBeNull();
    expect(opcodeSound(book, 732, ctx, first)).toEqual({ kind: 'battle', sound: 'DIE1' });
    expect(opcodeSound(book, 766, ctx, first)).toEqual({ kind: 'battle', sound: 'COOL1' });
    expect(opcodeSound(book, 702, ctx, last)).toMatchObject({ cue: { file: book.paths.get('FALL_2'), mix: 'soldier' } });
    expect(opcodeSound(book, 727, ctx, last)).toMatchObject({ cue: { file: book.paths.get('SWOOSH_6') } });
    expect(opcodeSound(book, 774, ctx, first)).toMatchObject({ cue: { file: book.paths.get('KNEEL_DOWN_SOUND'), baseVolume: 65 } });
    expect(opcodeSound(book, 774, { ...ctx, stealth: true }, first)).toBeNull();
    expect(opcodeSound(book, 777, ctx, first)).toMatchObject({ cue: { file: book.paths.get('PICKING_SOMETHING_UP'), baseVolume: 127 } });
    expect(opcodeSound(book, 710, { ...ctx, onScreen: false }, first)).toBeNull();
    expect(opcodeSound(book, 713, ctx, first)).toBeNull();
    expect(opcodeSound(book, 785, ctx, sequence([1]))).toBeNull();
    expect(opcodeSound(book, 785, ctx, first)).not.toBeNull();
    expect(opcodeSound(book, 750, ctx, first)).toBeNull();
    expect(opcodeSound(book, 770, ctx, first)).toMatchObject({ cue: { mix: 'fixed' } });
    expect(opcodeSound(book, 708, { ...ctx, handItem: weaponItem('GLOCK_17') }, first)).toMatchObject({
      cue: { file: book.paths.get('S_LNL_PISTOL') },
    });
  });
});

describe('battle sounds', () => {
  const merc: VoiceSoldier = { gridNo: G, team: 0, bodyType: 0, voice: '007', morale: 50 };
  const enemy: VoiceSoldier = { gridNo: G, team: 1, bodyType: 0, voice: 'bad1', morale: 50 };
  const request: BattleRequest = {
    sound: 'HIT1',
    nowMs: 10_000,
    playing: false,
    talking: false,
    muteConfirmations: false,
    lowerVolume: false,
  };

  it('name voices by profile voice id or by the generic sets of soldiers without a profile', () => {
    expect(battleVoiceBasename(7, 7, 0, 0)).toBe('007');
    expect(battleVoiceBasename(null, 0, 0, 2)).toBe('bad2');
    expect(battleVoiceBasename(null, 0, SoundBody.KIDCIV, 1)).toBe('kid1');
  });

  it('draw a variant and play on the speech bus, positional only for other teams', () => {
    const own = battleSoundCue(book, merc, NO_BATTLE_MEMORY, request, everything, last);
    expect(own.cues[0]).toMatchObject({ file: 'battlesnds/007_hit2.wav', bus: 'speech', mix: 'voiceOwn', baseVolume: 127 });
    expect(own.memory).toEqual({ lastKind: 4, lastAtMs: 10_000 });
    const other = battleSoundCue(book, enemy, NO_BATTLE_MEMORY, { ...request, lowerVolume: true }, everything, first);
    expect(other.cues[0]).toMatchObject({ file: 'battlesnds/bad1_hit1.wav', mix: 'voiceOther', baseVolume: 65 });
  });

  it('filters the same kind within 2 s and lets it through afterwards', () => {
    const memory = { lastKind: 4, lastAtMs: 9_000 };
    expect(battleSoundCue(book, merc, memory, request, everything, first).cues).toEqual([]);
    expect(battleSoundCue(book, merc, memory, { ...request, nowMs: 11_000 }, everything, first).cues).toHaveLength(1);
  });

  it('uses the low-morale variants below 35 and drops OK when confirmations are muted', () => {
    const low = battleSoundCue(book, { ...merc, morale: 20 }, NO_BATTLE_MEMORY, { ...request, sound: 'OK1' }, everything, first);
    expect(low.cues[0]?.file).toBe('battlesnds/007_lmok1.wav');
    const attn = battleSoundCue(book, { ...merc, morale: 20 }, NO_BATTLE_MEMORY, { ...request, sound: 'ATTN1' }, everything, first);
    expect(attn.cues[0]?.file).toBe('battlesnds/007_lmattn.wav');
    const muted = battleSoundCue(book, merc, NO_BATTLE_MEMORY, { ...request, sound: 'OK1', muteConfirmations: true }, everything, first);
    expect(muted.cues).toEqual([]);
    expect(muted.memory.lastKind).toBe(0);
  });

  it('falls back to the dying file, then to the generic m_ or f_ set for profiled soldiers only', () => {
    const dying = (p: string) => p.endsWith('_dying.wav');
    expect(battleSoundCue(book, merc, NO_BATTLE_MEMORY, { ...request, sound: 'DIE1' }, dying, first).cues[0]?.file).toBe(
      'battlesnds/007_dying.wav',
    );
    expect(battleSoundCue(book, merc, NO_BATTLE_MEMORY, request, nothing, first).cues[0]?.file).toBe('battlesnds/m_hit1.wav');
    const woman = { ...merc, bodyType: SoundBody.REGFEMALE };
    expect(battleSoundCue(book, woman, NO_BATTLE_MEMORY, request, nothing, first).cues[0]?.file).toBe('battlesnds/f_hit1.wav');
    expect(battleSoundCue(book, enemy, NO_BATTLE_MEMORY, request, nothing, first).cues).toEqual([]);
    expect(battleSoundCue(book, enemy, NO_BATTLE_MEMORY, { ...request, sound: 'COOL1' }, everything, first).cues).toEqual([]);
  });

  it('skips while a voice plays unless the sound is critical, and cuts or yields to speech', () => {
    expect(battleSoundCue(book, merc, NO_BATTLE_MEMORY, { ...request, sound: 'CURSE1', playing: true }, everything, first).cues).toEqual(
      [],
    );
    const hit = battleSoundCue(book, merc, NO_BATTLE_MEMORY, { ...request, playing: true, talking: true }, everything, first);
    expect(hit).toMatchObject({ stopPrevious: true, cutSpeech: true });
    expect(battleSoundCue(book, merc, NO_BATTLE_MEMORY, { ...request, sound: 'OK1', talking: true }, everything, first).cues).toEqual([]);
  });

  it('substitutes creature, animal and robot sounds', () => {
    const cat = battleSoundCue(book, { ...enemy, bodyType: SoundBody.BLOODCAT }, NO_BATTLE_MEMORY, request, everything, first);
    expect(cat.cues[0]).toMatchObject({ file: book.paths.get('BLOODCAT_HIT_1'), mix: 'creatureVoice', bus: 'effects' });
    const robot = battleSoundCue(
      book,
      { ...merc, bodyType: SoundBody.ROBOTNOWEAPON },
      NO_BATTLE_MEMORY,
      { ...request, sound: 'DIE1' },
      everything,
      first,
    );
    expect(robot.cues.map((c) => c.file)).toEqual([book.paths.get('ROBOT_DEATH'), book.paths.get('EXPLOSION_1')]);
  });
});

describe('speech', () => {
  const key = (file: string, row: number) => ({ file, row, width: 160 });

  it('resolves merc, NPC, alternate and Russian R.P.C. speech from the text key', () => {
    expect(speechPathForLine({ profile: 7, textKey: key('mercedt/007.edt', 12), recruitedNpcOrRpc: false }, false)).toBe(
      'speech/007_012.wav',
    );
    expect(speechPathForLine({ profile: 94, textKey: key('npcdata/094.edt', 3), recruitedNpcOrRpc: false }, false)).toBe(
      'npc_speech/094_003.wav',
    );
    expect(speechPathForLine({ profile: 153, textKey: key('npcdata/151.edt', 1), recruitedNpcOrRpc: false }, false)).toBe(
      'npc_speech/151_001.wav',
    );
    expect(speechPathForLine({ profile: 60, textKey: key('npcdata/d_060.edt', 5), recruitedNpcOrRpc: false }, true)).toBe(
      'npc_speech/d_060_005.wav',
    );
    expect(speechPathForLine({ profile: 57, textKey: key('mercedt/057.edt', 8), recruitedNpcOrRpc: true }, true)).toBe(
      'speech/r_057_008.wav',
    );
    expect(speechPathForLine({ profile: 1, textKey: key('npcdata/civ01.edt', 1), recruitedNpcOrRpc: false }, false)).toBeNull();
  });
});

describe('ambient scheduling', () => {
  const entry = { minTimeMs: 1000, maxTimeMs: 5000, timeCategory: AmbientTime.NIGHT, file: 'Owl.wav', volume: 40 };

  it('activates entries inside their window of the day, the night window across midnight', () => {
    expect(ambientActive(entry, 23 * 60)).toBe(true);
    expect(ambientActive(entry, 3 * 60)).toBe(true);
    expect(ambientActive(entry, 6 * 60 + 47)).toBe(false);
    expect(ambientActive({ ...entry, timeCategory: AmbientTime.DAWN }, 6 * 60 + 50)).toBe(true);
    expect(ambientActive({ ...entry, timeCategory: AmbientTime.DAY }, 12 * 60)).toBe(true);
    expect(ambientActive({ ...entry, timeCategory: AmbientTime.DUSK }, 21 * 60)).toBe(true);
    expect(ambientActive({ ...entry, timeCategory: 9 }, 12 * 60)).toBe(false);
  });

  it('waits between min and max milliseconds, plays at the entry volume, and is silent underground', () => {
    expect(ambientGapMs(entry, first)).toBe(1000);
    expect(ambientGapMs(entry, last)).toBe(4999);
    expect(ambientCue(entry)).toMatchObject({ file: 'ambient/owl.wav', bus: 'ambient', mix: 'ambient', baseVolume: 40 });
    expect(ambientSilenced({ basement: true, caves: false })).toBe(true);
    expect(ambientSilenced(null)).toBe(false);
  });
});

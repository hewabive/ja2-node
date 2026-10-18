import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { PROJECT_DATA_DIR } from '../../node/repo.ts';
import {
  BATTLE_SOUNDS_PATH,
  battleSoundPath,
  effectPaths,
  expandBurstPattern,
  genericVoiceSets,
  parseBattleSounds,
  parseSoundEffects,
  SOUND_EFFECTS_PATH,
  soundPathsIn,
  voiceSetKinds,
} from './sound-table.ts';

async function table(path: string): Promise<unknown> {
  return JSON.parse(await readFile(join(PROJECT_DATA_DIR, path), 'utf8'));
}

describe('the transcribed sound tables', () => {
  it('list the 291 sound ids with 237 paths, 14 ambient sounds and the pan and volume constants', async () => {
    const effects = parseSoundEffects(await table(SOUND_EFFECTS_PATH));
    expect(effects.sounds).toHaveLength(291);
    expect(effects.sounds.filter((s) => s.path !== null)).toHaveLength(237);
    expect(effects.sounds[0]).toEqual({ id: 0, name: 'MISS_1', path: 'sounds/ricochet 01.wav' });
    expect(effects.sounds.find((s) => s.name === 'CREATURE_BATTLECRY_1')?.path).toBe('stsounds/blah.wav');
    expect(effects.ambient).toHaveLength(14);
    expect(effects.pan).toMatchObject({ FARLEFT: 0, LEFTSIDE: 48, MIDDLE: 64, RIGHTSIDE: 80, FARRIGHT: 127 });
    expect(effects.volume).toEqual({ LOWVOLUME: 25, BTNVOLUME: 40, MIDVOLUME: 65, HIGHVOLUME: 127 });
    expect(effects.farVolumeMod).toBe(25);
    expect(effects.files).toContain('sounds/weapons/bursttype1.wav');
    expect(effects.files).toContain('laptop/static4.wav');
    const paths = effectPaths(effects);
    expect(new Set(paths).size).toBe(paths.length);
  });

  it('list the 17 battle sound kinds with their variants and flags', async () => {
    const battle = parseBattleSounds(await table(BATTLE_SOUNDS_PATH));
    expect(battle).toMatchObject({ directory: 'battlesnds', minSubsequentDelayMs: 2000, lowMoraleThreshold: 35 });
    expect(battle.kinds.map((k) => k.file)).toEqual([
      'ok1',
      'ok2',
      'cool',
      'curse',
      'hit1',
      'hit2',
      'laugh',
      'attn',
      'die',
      'humm',
      'noth',
      'gotit',
      'lmok1',
      'lmok2',
      'lmattn',
      'locked',
      'enem',
    ]);
    expect(battle.kinds[0]).toEqual({
      id: 0,
      name: 'OK1',
      file: 'ok1',
      randomVariants: 2,
      badGuy: true,
      dontAllowTwoInRow: true,
      stopDialogue: 2,
    });
    expect(battle.kinds.filter((k) => k.badGuy).map((k) => k.file)).toEqual([
      'ok1',
      'ok2',
      'curse',
      'hit1',
      'hit2',
      'laugh',
      'die',
      'enem',
    ]);
  });

  it('name the generic voices of soldiers without a profile and the profile fallbacks', async () => {
    const battle = parseBattleSounds(await table(BATTLE_SOUNDS_PATH));
    const sets = genericVoiceSets();
    expect(sets.map((s) => s.basename)).toEqual(['m', 'f', 'bad0', 'bad1', 'bad2', 'bad7', 'bad8', 'kid0', 'kid1']);
    const [male, , bad0] = sets;
    if (!male || !bad0) throw new Error('no sets');
    expect(voiceSetKinds(battle, male)).toHaveLength(17);
    expect(voiceSetKinds(battle, bad0)).toHaveLength(8);
    expect(battleSoundPath(battle, 'm', 'cool')).toBe('battlesnds/m_cool.wav');
    expect(battleSoundPath(battle, 'bad7', 'die')).toBe('battlesnds/bad7_die.wav');
  });

  it('collect sound paths from content tables and expand burst names', () => {
    const json = {
      weapons: [{ sound: 'Sounds/A.wav', burstSound: 'sounds/b %d.wav', name: 'x.wav' }],
      explosion: { sounds: ['sounds/c.wav'] },
    };
    expect(soundPathsIn(json).sort()).toEqual(['sounds/a.wav', 'sounds/b %d.wav', 'sounds/c.wav']);
    expect(expandBurstPattern('sounds/b %d.wav', 3)).toEqual(['sounds/b 1.wav', 'sounds/b 2.wav', 'sounds/b 3.wav']);
    expect(expandBurstPattern('sounds/a.wav', 3)).toEqual(['sounds/a.wav']);
  });
});

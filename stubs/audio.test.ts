import { describe, expect, it } from 'vitest';
import { soundClassOf, stubSoundPaths } from './audio.ts';

describe('stub sound classes', () => {
  it('sort the original sound names into cue classes', () => {
    const cases: Record<string, string> = {
      'sounds/ftp gravel 03.wav': 'step-gravel',
      'sounds/crawling 02.wav': 'crawl',
      'sounds/weapons/9mm single shot.wav': 'gun-pistol',
      'sounds/weapons/7,62 nato single shot.wav': 'gun-rifle',
      'sounds/weapons/5,56 burst 4.wav': 'burst-rifle-4',
      'sounds/weapons/silencer burst 2.wav': 'burst-silenced-2',
      'sounds/weapons/silencer 03.wav': 'gun-silenced',
      'sounds/weapons/shotgun reload.wav': 'reload',
      'sounds/weapons/smg lnl.wav': 'lock-n-load',
      'sounds/slap 02.wav': 'punch',
      'sounds/stab into flesh.wav': 'knife',
      'sounds/bullet impact 01.wav': 'impact',
      'sounds/heavy fall 01.wav': 'fall',
      'sounds/explosion 12.wav': 'explosion-big',
      'sounds/door open 02.wav': 'door-open',
      'sounds/metal door close.wav': 'door-metal-close',
      'sounds/key failure.wav': 'door-locked',
      'sounds/picking something up.wav': 'pickup',
      'sounds/rock hit 02.wav': 'drop',
      'sounds/small switch 02 in.wav': 'ui-click',
      'sounds/computer beep 01 in.wav': 'laptop-beep',
      'laptop/static3.wav': 'static',
    };
    for (const [path, cls] of Object.entries(cases)) expect(soundClassOf(path), path).toBe(cls);
  });

  it('classify every name the tables use; only a battle voice and one joke sound fall through', async () => {
    const fallback = (await stubSoundPaths()).filter((p) => soundClassOf(p) === 'misc');
    expect(fallback).toEqual(['battlesnds/m_cool.wav', 'sounds/sex.wav']);
  });
});

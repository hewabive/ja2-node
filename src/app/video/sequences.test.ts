import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, updateSettings } from '../settings.ts';
import { beginningPlan, endingPlan, IntroVideo, introVideoPath, sequenceEnabled, splashPlan } from './sequences.ts';

describe('intro sequences', () => {
  it('names the eleven videos of the intro archive', () => {
    expect(Object.values(IntroVideo).map(introVideoPath)).toEqual([
      'intro/rebel_cr.smk',
      'intro/omerta.smk',
      'intro/prague_cr.smk',
      'intro/prague.smk',
      'intro/throne_mig.smk',
      'intro/throne_nomig.smk',
      'intro/heli_flyby.smk',
      'intro/heli_sky.smk',
      'intro/heli_nosky.smk',
      'intro/splashscreen.smk',
      'intro/talonsoftid_endhold.smk',
    ]);
  });

  it('plays the splash alone (never the TalonSoft logo), then the main menu', () => {
    expect(splashPlan()).toEqual({ sequence: 'splash', videos: ['splashscreen'], followedBy: 'mainMenu' });
  });

  it('plays the four beginning videos in order, then starts the new game', () => {
    expect(beginningPlan()).toEqual({
      sequence: 'beginning',
      videos: ['rebel_cr', 'omerta', 'prague_cr', 'prague'],
      followedBy: 'newGame',
    });
  });

  it("picks the throne video by Miguel's death and the helicopter video by Skyrider's, then the credits", () => {
    expect(endingPlan({ miguelAlive: true, skyriderAlive: true })).toEqual({
      sequence: 'ending',
      videos: ['throne_mig', 'heli_flyby', 'heli_sky'],
      followedBy: 'credits',
    });
    expect(endingPlan({ miguelAlive: false, skyriderAlive: true }).videos).toEqual(['throne_nomig', 'heli_flyby', 'heli_sky']);
    expect(endingPlan({ miguelAlive: true, skyriderAlive: false }).videos).toEqual(['throne_mig', 'heli_flyby', 'heli_nosky']);
    expect(endingPlan({ miguelAlive: false, skyriderAlive: false }).videos).toEqual(['throne_nomig', 'heli_flyby', 'heli_nosky']);
  });

  it('lets the client settings turn off the splash and the beginning, never the ending', () => {
    expect(['splash', 'beginning', 'ending'].map((s) => sequenceEnabled(s as 'splash', DEFAULT_SETTINGS))).toEqual([true, true, true]);
    const off = updateSettings(DEFAULT_SETTINGS, { playSplash: false, playIntro: false });
    expect(['splash', 'beginning', 'ending'].map((s) => sequenceEnabled(s as 'splash', off))).toEqual([false, false, true]);
  });
});

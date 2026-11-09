import { describe, expect, it } from 'vitest';
import type { Sector } from '../../content/strategic/sector-ids.ts';
import { SKYRIDER } from '../strategic/forces/helicopter.ts';
import { type SpeakerLocatorSources, speakerLocator } from './speaker-locator.ts';

const HEAD_MINER = 106;
const B13: Sector = { x: 13, y: 2, z: 0 };
const D13_MINE: Sector = { x: 13, y: 4, z: 1 };
const C14: Sector = { x: 14, y: 3, z: 0 };

function sources(over: Partial<SpeakerLocatorSources>): SpeakerLocatorSources {
  return { soldierSector: () => null, helicopterSector: () => null, profileSector: () => null, ...over };
}

describe('the speaker locator (TurnOnSectorLocator)', () => {
  it("marks Skyrider's helicopter once it is set up, flagged for the aircraft filter, before his own sector", () => {
    const set = sources({ helicopterSector: () => B13, profileSector: () => C14 });
    expect(speakerLocator(set, SKYRIDER)).toEqual({ sector: 'B13', helicopter: true });
    expect(speakerLocator(sources({ profileSector: () => C14 }), SKYRIDER)).toEqual({ sector: 'C14' });
  });

  it("marks the speaker's soldier before anything else, and only Skyrider's line marks the helicopter", () => {
    const set = sources({ soldierSector: () => D13_MINE, helicopterSector: () => B13 });
    expect(speakerLocator(set, SKYRIDER)).toEqual({ sector: 'D13-1' });
    expect(speakerLocator(sources({ helicopterSector: () => B13, profileSector: () => C14 }), HEAD_MINER)).toEqual({ sector: 'C14' });
    expect(speakerLocator(sources({}), HEAD_MINER)).toBeNull();
  });
});

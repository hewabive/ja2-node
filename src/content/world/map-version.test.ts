import { describe, expect, it } from 'vitest';
import type { MapDef, MapInformation } from '../formats/map.ts';
import { MINOR_MAP_VERSION, updateOldVersionMap } from './map-version.ts';

const OLDER_VERSION = MINOR_MAP_VERSION - 1;
const STORED_LIGHT_LEVEL = 11;

function underground(mapVersion: number, caves: boolean): Pick<MapDef, 'info' | 'ambient'> {
  return {
    info: { mapVersion } as MapInformation,
    ambient: { basement: !caves, caves, lightLevel: STORED_LIGHT_LEVEL },
  };
}

describe('UpdateOldVersionMap', () => {
  it('relights a cave map older than minor version 25 to level 13', () => {
    expect(updateOldVersionMap(underground(OLDER_VERSION, true)).ambient?.lightLevel).toBe(13);
  });

  it('keeps the stored light of a cave map of version 25, of an old basement and of a map above ground', () => {
    expect(updateOldVersionMap(underground(MINOR_MAP_VERSION, true)).ambient?.lightLevel).toBe(STORED_LIGHT_LEVEL);
    expect(updateOldVersionMap(underground(OLDER_VERSION, false)).ambient?.lightLevel).toBe(STORED_LIGHT_LEVEL);
    expect(updateOldVersionMap({ info: { mapVersion: OLDER_VERSION } as MapInformation, ambient: null }).ambient).toBeNull();
  });
});

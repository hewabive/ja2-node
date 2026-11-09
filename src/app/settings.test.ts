import { describe, expect, it } from 'vitest';
import { SETTINGS_KEY, type SettingsStorage } from '../ui/settings.ts';
import { handOverSeenMeanwhileScenes, loadSettings, pendingMeanwhileScenesSeen } from './settings.ts';

const LOST_TOWN_AND_CREATURES = (1 << 10) | (1 << 12);
const FLOWERS = 1 << 13;

function olderPageStorage(): SettingsStorage {
  const data = new Map<string, string>([
    [SETTINGS_KEY, JSON.stringify({ version: 2, muted: true, meanwhileScenesSeen: LOST_TOWN_AND_CREATURES })],
  ]);
  return { getItem: (k) => data.get(k) ?? null, setItem: (k, v) => void data.set(k, v) };
}

describe('the meanwhile scenes seen an older page kept in the browser', () => {
  it('go to the server once, merged by OR there, and leave the browser when it took them', async () => {
    const storage = olderPageStorage();
    const sent: number[] = [];
    const accept = async (flags: number) => {
      sent.push(flags);
      return true;
    };
    expect(await handOverSeenMeanwhileScenes(accept, 0, storage)).toBe(true);
    expect(await handOverSeenMeanwhileScenes(accept, 0, storage)).toBe(true);
    expect(sent).toEqual([LOST_TOWN_AND_CREATURES]);
    expect([pendingMeanwhileScenesSeen(storage), loadSettings(storage).muted]).toEqual([0, true]);
  });

  it('stay in the browser while the server cannot take them, imported ones added', async () => {
    const storage = olderPageStorage();
    expect(await handOverSeenMeanwhileScenes(async () => false, FLOWERS, storage)).toBe(false);
    expect(await handOverSeenMeanwhileScenes(() => Promise.reject(new Error('offline')), 0, storage)).toBe(false);
    expect(pendingMeanwhileScenesSeen(storage)).toBe(LOST_TOWN_AND_CREATURES | FLOWERS);
  });
});

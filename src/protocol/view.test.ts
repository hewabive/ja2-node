import { describe, expect, it } from 'vitest';
import { diffPlayerView, type PlayerView, type ShopView, type StrategicView } from './view.ts';

const STRATEGIC: StrategicView = {
  balance: 35000,
  worldSector: 'A9',
  flow: 'tactical',
  campaign: 'playing',
  meanwhiles: [],
  sectors: [],
  mercs: [],
  groups: [],
  quests: [],
};

const base: PlayerView = {
  tick: 10,
  mapPath: 'maps/a9.dat',
  clock: { day: 1, hour: 7, minute: 0, compressing: false },
  strategic: STRATEGIC,
  soldiers: [],
};

describe('view frames', () => {
  it('are empty when nothing the player sees changed', () => {
    expect(diffPlayerView(base, { ...base, tick: 20, clock: { day: 1, hour: 7, minute: 0, compressing: false } })).toBeNull();
  });

  it('carry the clock, the strategic view and a new map only when they change', () => {
    const next: PlayerView = {
      ...base,
      tick: 20,
      mapPath: 'maps/b9.dat',
      clock: { day: 1, hour: 7, minute: 1, compressing: true },
      strategic: { ...STRATEGIC, worldSector: 'B9' },
    };
    expect(diffPlayerView(base, next)).toEqual({
      tick: 20,
      changed: [],
      removed: [],
      mapPath: 'maps/b9.dat',
      clock: next.clock,
      strategic: next.strategic,
    });
    expect(diffPlayerView(base, { ...base, tick: 30, mapPath: null })).toMatchObject({ mapPath: null });
  });

  it('carry the open shop when it opens, changes and closes', () => {
    const shop: ShopView = {
      dealer: 124,
      name: 'Franz',
      kind: 'buySell',
      soldier: 0,
      pricing: { soldier: 0, weaponSaleModifier: 100 },
      balance: 35000,
      canTrade: [0],
      boxes: [
        { key: { item: 258, element: -1 }, item: 'VIDEO_CAMERA', count: 1, status: 100, unitPrice: 450, attachments: [], imprinted: false },
      ],
    };
    const open: PlayerView = { ...base, tick: 20, shop };
    expect(diffPlayerView({ ...base, shop: null }, open)).toMatchObject({ shop });
    expect(diffPlayerView(open, { ...open, tick: 30 })).toBeNull();
    expect(diffPlayerView(open, { ...open, tick: 30, shop: { ...shop, boxes: [] } })).toMatchObject({ shop: { boxes: [] } });
    expect(diffPlayerView(open, { ...open, tick: 40, shop: null })).toMatchObject({ shop: null });
  });
});

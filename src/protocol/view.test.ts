import { describe, expect, it } from 'vitest';
import { applyViewFrame, diffPlayerView, type PlayerView, type ShopView, type SoldierView, type StrategicView } from './view.ts';

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

function soldier(id: number, gridNo: number): SoldierView {
  return {
    id,
    team: 0,
    name: `s${id}`,
    bodyType: 0,
    gridNo,
    x: gridNo,
    y: 0,
    level: 0,
    direction: 0,
    animation: 0,
    frame: 0,
    palettes: ['a', 'b', 'c', 'd'],
    hand: 'NOTHING',
    frameSlot: 0,
    stateTick: 0,
    frameDelay: 0,
  };
}

describe('applying view frames', () => {
  const steps: PlayerView[] = [
    { ...base, soldiers: [soldier(1, 10), soldier(2, 20)], music: { mode: 'tacticalNothing', creature: false } },
    {
      ...base,
      tick: 20,
      soldiers: [soldier(1, 11), soldier(2, 20)],
      meanwhile: { seq: 1, scene: 'frontierMap' },
      music: { mode: 'tacticalNothing', creature: false },
    },
    { ...base, tick: 30, soldiers: [soldier(2, 20)], meanwhile: null, openDoors: [5], music: { mode: 'tacticalBattle', creature: false } },
    {
      ...base,
      tick: 40,
      soldiers: [soldier(2, 21), soldier(3, 30)],
      meanwhile: null,
      openDoors: [5],
      ended: { outcome: 'victory', at: 40, day: 9, ending: { miguelAlive: true, skyriderAlive: false }, mercDeaths: 0 },
      music: { mode: 'tacticalBattle', creature: false },
    },
  ];

  it('rebuilds every next view from the previous one and the diff, meanwhile, ended and music included (clock, strategic and music are always sent)', () => {
    let mirrored = steps[0] as PlayerView;
    for (const next of steps.slice(1)) {
      const frame = diffPlayerView(mirrored, next);
      if (!frame) throw new Error('every step changes something');
      mirrored = applyViewFrame(mirrored, JSON.parse(JSON.stringify(frame)));
      expect(mirrored).toEqual(next);
    }
  });

  it('keeps the soldier list when a frame carries no soldier change and moves the tick', () => {
    const view = steps[0] as PlayerView;
    const next = applyViewFrame(view, { tick: 99, changed: [], removed: [], clock: { day: 2, hour: 0, minute: 0, compressing: false } });
    expect(next.soldiers).toBe(view.soldiers);
    expect(next.tick).toBe(99);
    expect(next.clock).toEqual({ day: 2, hour: 0, minute: 0, compressing: false });
    expect(next).not.toHaveProperty('events');
  });
});

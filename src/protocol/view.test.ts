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
      repaired: [],
    };
    const open: PlayerView = { ...base, tick: 20, shop };
    expect(diffPlayerView({ ...base, shop: null }, open)).toMatchObject({ shop });
    expect(diffPlayerView(open, { ...open, tick: 30 })).toBeNull();
    expect(diffPlayerView(open, { ...open, tick: 30, shop: { ...shop, boxes: [] } })).toMatchObject({ shop: { boxes: [] } });
    expect(diffPlayerView(open, { ...open, tick: 40, shop: null })).toMatchObject({ shop: null });
  });

  it('carry the selected merc when the server selects another one or nobody', () => {
    const selected: PlayerView = { ...base, selected: 2 };
    expect(diffPlayerView(selected, { ...selected, tick: 20 })).toBeNull();
    expect(diffPlayerView(selected, { ...selected, tick: 20, selected: 3 })).toEqual({ tick: 20, changed: [], removed: [], selected: 3 });
    const nobody = diffPlayerView(selected, { ...selected, tick: 30, selected: null });
    expect(nobody).toMatchObject({ selected: null });
    expect(nobody && applyViewFrame(selected, nobody).selected).toBeNull();
  });

  it('carry the item locator lock as it rises and drops', () => {
    const locked: PlayerView = { ...base, itemLocatorsLocked: true };
    expect(diffPlayerView(base, { ...base, tick: 20 })).toBeNull();
    expect(diffPlayerView(base, { ...locked, tick: 20 })).toEqual({ tick: 20, changed: [], removed: [], itemLocatorsLocked: true });
    const unlocked = diffPlayerView(locked, { ...base, tick: 30 });
    expect(unlocked).toMatchObject({ itemLocatorsLocked: false });
    expect(unlocked && applyViewFrame(locked, unlocked).itemLocatorsLocked).toBe(false);
  });

  it('carry the known mines when a tile is marked for the player or loses its mark', () => {
    const none: PlayerView = { ...base, knownMines: [] };
    const marked: PlayerView = { ...base, tick: 20, knownMines: [12000] };
    expect(diffPlayerView(none, { ...none, tick: 20 })).toBeNull();
    expect(diffPlayerView(none, marked)).toEqual({ tick: 20, changed: [], removed: [], knownMines: [12000] });
    const cleared = diffPlayerView(marked, { ...none, tick: 30 });
    expect(cleared).toMatchObject({ knownMines: [] });
    expect(cleared && applyViewFrame(marked, cleared).knownMines).toEqual([]);
  });

  it('carry the exit grids added while the sector runs as soon as one is added, and an empty list in a sector without them', () => {
    const none: PlayerView = { ...base, addedExitGrids: [] };
    const opened: PlayerView = { ...base, tick: 20, addedExitGrids: [{ gridNo: 13669, sector: 'O3-1' }] };
    expect(diffPlayerView(none, { ...none, tick: 20 })).toBeNull();
    expect(diffPlayerView(none, opened)).toEqual({ tick: 20, changed: [], removed: [], addedExitGrids: opened.addedExitGrids });
    const left = diffPlayerView(opened, { ...base, tick: 30 });
    expect(left).toMatchObject({ addedExitGrids: [] });
    expect(left && applyViewFrame(opened, left).addedExitGrids).toEqual([]);
  });

  it('carry the radar contacts of x-rayed soldiers while the x-ray shows them, and an empty list once it stops', () => {
    const contact = { gridNo: 12000, kind: 'enemy' as const };
    const xrayed: PlayerView = { ...base, tick: 20, radarContacts: [contact] };
    expect(diffPlayerView(base, { ...base, tick: 20 })).toBeNull();
    expect(diffPlayerView(base, xrayed)).toEqual({ tick: 20, changed: [], removed: [], radarContacts: [contact] });
    const off = diffPlayerView(xrayed, { ...base, tick: 30 });
    expect(off).toMatchObject({ radarContacts: [] });
    expect(off && applyViewFrame(xrayed, off).radarContacts).toEqual([]);
  });

  it('carry the helicopter drop as its engine fades and its shadow moves, and null once it has left', () => {
    const shadow = { gridNo: 12000, x: 1500, y: 300, z: 0 };
    const flying: PlayerView = { ...base, tick: 20, helicopterDrop: { running: true, engineVolume: 5, shadows: [] } };
    expect(diffPlayerView(base, flying)).toEqual({ tick: 20, changed: [], removed: [], helicopterDrop: flying.helicopterDrop });
    expect(diffPlayerView(flying, { ...flying, tick: 30 })).toBeNull();
    const moved = { ...flying, tick: 30, helicopterDrop: { running: true, engineVolume: 10, shadows: [shadow] } };
    expect(diffPlayerView(flying, moved)).toMatchObject({ helicopterDrop: { engineVolume: 10, shadows: [shadow] } });
    const left = diffPlayerView(moved, { ...base, tick: 40 });
    expect(left).toMatchObject({ helicopterDrop: null });
    expect(left && applyViewFrame(moved, left).helicopterDrop).toBeNull();
  });

  it('carry the box of auto-bandage as it opens, completes and closes', () => {
    const running: PlayerView = { ...base, tick: 20, autoBandage: { complete: false, medics: [2], patients: [0, 2] } };
    expect(diffPlayerView(base, running)).toEqual({ tick: 20, changed: [], removed: [], autoBandage: running.autoBandage });
    expect(diffPlayerView(running, { ...running, tick: 30 })).toBeNull();
    const complete: PlayerView = { ...running, tick: 40, autoBandage: { complete: true, medics: [2], patients: [0, 2] } };
    expect(diffPlayerView(running, complete)).toMatchObject({ autoBandage: { complete: true } });
    const closed = diffPlayerView(complete, { ...base, tick: 50 });
    expect(closed).toMatchObject({ autoBandage: null });
    expect(closed && applyViewFrame(complete, JSON.parse(JSON.stringify(closed))).autoBandage).toBeNull();
  });

  it('carry the current squad when the server makes another squad current or none', () => {
    const current: PlayerView = { ...base, currentSquad: 0 };
    expect(diffPlayerView(current, { ...current, tick: 20 })).toBeNull();
    expect(diffPlayerView(current, { ...current, tick: 20, currentSquad: 1 })).toEqual({
      tick: 20,
      changed: [],
      removed: [],
      currentSquad: 1,
    });
    const none = diffPlayerView(current, { ...current, tick: 30, currentSquad: null });
    expect(none).toMatchObject({ currentSquad: null });
    expect(none && applyViewFrame(current, none).currentSquad).toBeNull();
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
    surface: 0,
    frameSlot: 0,
    stateTick: 0,
    frameDelay: 0,
  };
}

const EVERY_SOLDIER_FIELD: Required<SoldierView> = {
  id: 5,
  team: 0,
  name: 'Ira',
  bodyType: 1,
  gridNo: 100,
  x: 1005,
  y: 15,
  level: 0,
  heightAdjustment: 0,
  direction: 2,
  hiResDirection: 8,
  turning: false,
  animation: 1,
  frame: 3,
  palettes: ['a', 'b', 'c', 'd'],
  camouflaged: false,
  hand: 'NOTHING',
  surface: 7,
  frameSlot: 4,
  boundingFrame: 3,
  boundingDirection: 1,
  boundingHiResDirection: 4,
  stateTick: 90,
  frameDelay: 80,
  nextFrameTick: 110,
  muzzleFlash: false,
  fadingOut: false,
  ap: 20,
  life: 80,
  lifeMax: 90,
  breath: 100,
  inventory: [{ slot: 0, item: 'GLOCK_17', index: 2, count: 1, status: [90] }],
  keys: [{ position: 0, keyId: 3, count: 1 }],
  merchant: 'buySell',
  profile: 7,
  talkable: 'npc',
  kind: 'rpc',
  controlled: false,
  voice: '007',
  bleeding: 0,
  breathMax: 100,
  morale: 50,
  stats: {
    agility: 80,
    dexterity: 80,
    strength: 80,
    leadership: 50,
    wisdom: 70,
    level: 3,
    marksmanship: 75,
    explosives: 20,
    mechanical: 30,
    medical: 40,
  },
  armour: 10,
  weight: 40,
  camo: 0,
  asleep: false,
  squad: 0,
  stealth: false,
  weaponMode: 'single',
  muted: false,
  sees: [21],
  opponents: 1,
  canAct: true,
  stance: 'stand',
  continueTo: null,
  noApToFinishMove: false,
  vehicle: null,
  passengers: [],
  firstAid: null,
  blinded: false,
  climb: { roof: null, enoughAp: true, fence: false },
  enoughApToAttack: true,
  destination: 100,
  gettingHit: false,
  drunk: 'feelingGood',
  adrenaline: 'active',
  hostile: false,
  healthIndex: 6,
  defaultName: 'enemy',
  hint: {
    skills: [0, 0],
    personality: 0,
    shock: 0,
    lastTarget: 0,
    tilesMoved: 0,
    weightAtTurnStart: 0,
    collapsed: false,
    gassed: false,
    underAiControl: false,
  },
};

function anotherValue(value: unknown): unknown {
  if (typeof value === 'number') return value + 1;
  if (typeof value === 'string') return `${value}*`;
  if (typeof value === 'boolean') return !value;
  if (value === null) return 0;
  if (Array.isArray(value)) return value.length > 0 ? [] : [0];
  return {};
}

describe('the frames of a soldier', () => {
  it('carry him when any one field of his changes, his name alone too (a terrorist revealing himself)', () => {
    const before: PlayerView = { ...base, soldiers: [EVERY_SOLDIER_FIELD] };
    const fields = Object.keys(EVERY_SOLDIER_FIELD).filter((key): key is keyof SoldierView => key !== 'id');
    const unsent = fields.filter((key) => {
      const changed = { ...EVERY_SOLDIER_FIELD, [key]: anotherValue(EVERY_SOLDIER_FIELD[key]) };
      return diffPlayerView(before, { ...before, tick: 20, soldiers: [changed] })?.changed[0] !== changed;
    });
    expect(unsent).toEqual([]);
  });
});

describe('the frames of a vehicle of ours', () => {
  it('carry the vehicle when somebody gets aboard or off, though nothing else about it changed', () => {
    const empty = { ...soldier(18, 40), passengers: [] };
    const before: PlayerView = { ...base, soldiers: [empty] };
    const frame = diffPlayerView(before, { ...before, tick: 20, soldiers: [{ ...empty, passengers: [1] }] });
    expect(frame?.changed.map((s) => s.passengers)).toEqual([[1]]);
  });
});

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

describe('the revealed tiles in view frames', () => {
  const at = (tick: number, revealedTiles: NonNullable<PlayerView['revealedTiles']>): PlayerView => ({ ...base, tick, revealedTiles });

  it('send only the tiles revealed since the last frame while tiles are only added', () => {
    const frame = diffPlayerView(
      at(10, [
        [100, 5],
        [200, 3],
      ]),
      at(20, [
        [98, 9],
        [200, 4],
        [300, 1],
      ]),
    );
    expect(frame).toEqual({
      tick: 20,
      changed: [],
      removed: [],
      revealedTilesAdded: [
        [98, 2],
        [105, 2],
        [203, 1],
        [300, 1],
      ],
    });
  });

  it('send the whole set once a tile is no longer revealed, as at a load or a new sector', () => {
    const frame = diffPlayerView(at(10, [[100, 5]]), at(20, [[101, 6]]));
    expect(frame).toMatchObject({ revealedTiles: [[101, 6]] });
    expect(frame).not.toHaveProperty('revealedTilesAdded');
  });

  it('rebuild the whole set on the client from the increments', () => {
    const steps = [
      at(10, []),
      at(20, [[40, 2]]),
      at(30, [[38, 6]]),
      at(40, [
        [38, 6],
        [50, 1],
      ]),
      at(50, [[50, 2]]),
    ];
    let mirrored = steps[0] as PlayerView;
    for (const next of steps.slice(1)) {
      const frame = diffPlayerView(mirrored, next);
      if (!frame) throw new Error('every step changes the revealed tiles');
      mirrored = applyViewFrame(mirrored, JSON.parse(JSON.stringify(frame)));
      expect(mirrored).toEqual(next);
    }
  });
});

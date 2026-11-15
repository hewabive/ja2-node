import { describe, expect, it } from 'vitest';
import { gridNo, WORLD_COLS } from '../../../../content/world/grid.ts';
import type { CoverMap, SightMap } from '../../../../protocol/hints.ts';
import type { CommandEnvelope } from '../../../../protocol/messages.ts';
import type { SoldierView } from '../../../../protocol/view.ts';
import {
  CoverDisplay,
  type CoverDisplayHost,
  coverTile,
  DEFAULT_SHADE_LEVEL,
  nodeShade,
  sightSlots,
  TCTL_MSG_DISPLAY_COVER,
  TCTL_MSG_LOS,
} from './cover-display.ts';
import type { HintState } from './hints.ts';
import { COVER_KEY, SIGHT_KEY } from './hotkeys.ts';

const MERC_AT = gridNo(80, 80);
const AMBIENT = 3;

class Host implements CoverDisplayHost {
  merc: SoldierView = { id: 0, team: 0, gridNo: MERC_AT, stance: 'stand' } as SoldierView;
  at: number | null = gridNo(82, 80);
  level = 0;
  held = new Set<string>();
  cover = 4;
  sight = 4;
  map = 'A9.dat';
  offScreen = new Set<number>();
  readonly messages: number[] = [];
  readonly requests: CommandEnvelope[] = [];
  answers: (request: CommandEnvelope) => unknown = (request) => answerFor(request);

  selected(): SoldierView | null {
    return this.merc;
  }

  cursor(): number | null {
    return this.at;
  }

  interfaceLevel(): number {
    return this.level;
  }

  keyHeld(key: string): boolean {
    return this.held.has(key);
  }

  coverSize(): number {
    return this.cover;
  }

  sightSize(): number {
    return this.sight;
  }

  hint<T>(request: CommandEnvelope): HintState<T> {
    this.requests.push(request);
    return { state: 'ok', data: this.answers(request) as T };
  }

  onScreen(g: number): boolean {
    return !this.offScreen.has(g);
  }

  nodeShade(): number {
    return AMBIENT;
  }

  message(index: number): void {
    this.messages.push(index);
  }

  mapPath(): string | null {
    return this.map;
  }
}

function square(center: number, radius: number): number[] {
  const out: number[] = [];
  for (let dy = -radius; dy <= radius; dy++) for (let dx = -radius; dx <= radius; dx++) out.push(center + dx + dy * WORLD_COLS);
  return out;
}

function answerFor(request: CommandEnvelope): CoverMap | SightMap {
  const center = request.center as number;
  const radius = request.radius as number;
  const level = request.level as number;
  if (request.type === 'coverMap')
    return { center, level, radius, stance: 'stand', tiles: square(center, radius).map((g) => ({ gridNo: g, cover: 50 })) };
  return { center, level, radius, tiles: square(center, radius).map((g) => ({ gridNo: g, stances: 3, roof: false })) };
}

function poll(display: CoverDisplay, frames = 1): void {
  for (let k = 0; k < frames; k++) display.poll();
}

function coverRequests(host: Host): number {
  return host.requests.filter((r) => r.type === 'coverMap').length;
}

describe('the cover display while Delete is held (DisplayCover.cc DisplayCoverOfSelectedGridNo)', () => {
  it('lays a translucent cover tile on every tile around the cursor, says so once, and takes them off on release', () => {
    const host = new Host();
    const display = new CoverDisplay(host);
    host.held.add(COVER_KEY);
    poll(display, 3);
    const markers = display.markers();
    expect(markers).toHaveLength(81);
    expect(markers[0]).toMatchObject({ layer: 'object', tile: 'SPECIALTILE_COVER_3', head: true, translucent: true, shade: AMBIENT });
    expect(host.messages).toEqual([TCTL_MSG_DISPLAY_COVER]);
    host.held.clear();
    poll(display);
    expect(display.markers()).toEqual([]);
  });

  it('works the cover out again on every frame, but never while the cursor rests on the merc himself', () => {
    const host = new Host();
    const display = new CoverDisplay(host);
    host.held.add(COVER_KEY);
    poll(display, 3);
    expect(coverRequests(host)).toBe(3);
    host.at = MERC_AT;
    poll(display, 3);
    expect(coverRequests(host)).toBe(4);
    host.merc = { ...host.merc, stance: 'run' };
    poll(display);
    expect(coverRequests(host)).toBe(4);
    host.merc = { ...host.merc, stance: 'crouch' };
    poll(display);
    expect(coverRequests(host)).toBe(5);
  });

  it('leaves the old tiles lying when the interface level changes while it is shown: they are taken off the other level', () => {
    const host = new Host();
    const display = new CoverDisplay(host);
    host.held.add(COVER_KEY);
    poll(display);
    host.level = 1;
    poll(display);
    host.held.clear();
    poll(display);
    const left = display.markers();
    expect(left).toHaveLength(81);
    expect(left.every((m) => m.layer === 'object')).toBe(true);
    host.map = 'B9.dat';
    expect(display.markers()).toEqual([]);
  });

  it('says it again after a size change, which takes the display off and shows it again (ChangeSizeOfDisplayCover)', () => {
    const host = new Host();
    const display = new CoverDisplay(host);
    host.held.add(COVER_KEY);
    poll(display);
    host.cover = 5;
    display.resizedCover();
    expect(host.messages).toEqual([TCTL_MSG_DISPLAY_COVER, TCTL_MSG_DISPLAY_COVER]);
    expect(display.markers()).toHaveLength(121);
  });

  it('lays no cover tile on a tile the screen leaves out (GridNoOnScreen)', () => {
    const host = new Host();
    const off = gridNo(82, 76);
    host.offScreen.add(off);
    const display = new CoverDisplay(host);
    host.held.add(COVER_KEY);
    poll(display);
    expect(display.markers()).toHaveLength(80);
    expect(display.markers().some((m) => m.gridNo === off)).toBe(false);
  });

  it('shows nothing new while the cursor is off the map and keeps what it shows', () => {
    const host = new Host();
    const display = new CoverDisplay(host);
    host.held.add(COVER_KEY);
    poll(display);
    host.at = null;
    poll(display);
    expect(display.markers()).toHaveLength(81);
  });

  it('draws the bands of 20 the original draws', () => {
    expect([0, 20, 21, 40, 41, 60, 61, 80, 81, 100].map(coverTile)).toEqual([
      'SPECIALTILE_COVER_1',
      'SPECIALTILE_COVER_1',
      'SPECIALTILE_COVER_2',
      'SPECIALTILE_COVER_2',
      'SPECIALTILE_COVER_3',
      'SPECIALTILE_COVER_3',
      'SPECIALTILE_COVER_4',
      'SPECIALTILE_COVER_4',
      'SPECIALTILE_COVER_5',
      'SPECIALTILE_COVER_5',
    ]);
  });

  it('shades a new tile with the ambient light, but with the default shade at night', () => {
    expect([nodeShade(false, 9), nodeShade(true, 12)]).toEqual([9, DEFAULT_SHADE_LEVEL]);
  });
});

describe('the sight display while End is held (DisplayCover.cc DisplayGridNoVisibleToSoldierGrid)', () => {
  it('works the sight out only when the cursor or the merc moves, not when the merc changes his stance', () => {
    const host = new Host();
    const display = new CoverDisplay(host);
    host.held.add(SIGHT_KEY);
    poll(display, 3);
    expect(host.requests).toHaveLength(1);
    expect(host.messages).toEqual([TCTL_MSG_LOS]);
    host.merc = { ...host.merc, stance: 'prone' };
    poll(display);
    expect(host.requests).toHaveLength(1);
    host.at = gridNo(83, 80);
    poll(display);
    expect(host.requests).toHaveLength(2);
    expect(display.markers()).toHaveLength(81);
  });

  it('says nothing when End is pressed while Delete is held: the two displays share the last merc tile', () => {
    const host = new Host();
    const display = new CoverDisplay(host);
    host.held.add(COVER_KEY);
    poll(display);
    host.held.add(SIGHT_KEY);
    poll(display);
    expect(host.messages).toEqual([TCTL_MSG_DISPLAY_COVER]);
    expect(display.markers()).toHaveLength(162);
  });

  it('does not follow the merc while Delete is held too, the cover display having taken his new tile first', () => {
    const host = new Host();
    const display = new CoverDisplay(host);
    host.held.add(COVER_KEY);
    host.held.add(SIGHT_KEY);
    poll(display);
    const sightBefore = host.requests.filter((r) => r.type === 'sightMap').length;
    host.merc = { ...host.merc, gridNo: MERC_AT + 1 };
    poll(display);
    expect(host.requests.filter((r) => r.type === 'sightMap')).toHaveLength(sightBefore);
  });

  it('lays a red tile on the last tile of a row the screen leaves out: the slot after the row is drawn too', () => {
    const answer = answerFor({ type: 'sightMap', center: MERC_AT, radius: 1, level: 0 }) as SightMap;
    const lastOfFirstRow = MERC_AT + 1 - WORLD_COLS;
    const middleOfLastRow = MERC_AT + WORLD_COLS;
    const slots = sightSlots(answer, (g) => g !== lastOfFirstRow && g !== middleOfLastRow);
    expect(slots).toHaveLength(8);
    expect(slots[2]).toEqual({ gridNo: lastOfFirstRow, tile: 'SPECIALTILE_COVER_1', roof: false });
    expect(slots.map((s) => s.gridNo)).not.toContain(middleOfLastRow);
  });

  it('draws three stances bright, none red, one and two in between, on the roof where the hint says so', () => {
    const answer: SightMap = {
      center: MERC_AT,
      level: 0,
      radius: 0,
      tiles: [{ gridNo: MERC_AT, stances: 2, roof: true }],
    };
    expect(sightSlots(answer, () => true)).toEqual([{ gridNo: MERC_AT, tile: 'SPECIALTILE_COVER_3', roof: true }]);
    const host = new Host();
    host.answers = () => answer;
    const display = new CoverDisplay(host);
    host.held.add(SIGHT_KEY);
    poll(display);
    expect(display.markers()).toEqual([
      { gridNo: MERC_AT, layer: 'onRoof', tile: 'SPECIALTILE_COVER_3', head: true, translucent: true, shade: AMBIENT },
    ]);
  });
});

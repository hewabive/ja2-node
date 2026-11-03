import { describe, expect, it } from 'vitest';
import type { SoldierView } from '../../../protocol/view.ts';
import { cursorFromSlot, dropCommand, giveCommand, passCommand, tossCommand } from './item-cursor.ts';

const OUR_TEAM = 0;
const ROBOT_BODY = 21;
const SMALL_POCKET = 11;
const CLIP_INDEX = 71;
const BESIDE = 1201;
const FAR_TILE = 1210;

function view(id: number, team: number, extra: Partial<SoldierView> = {}): SoldierView {
  return {
    id,
    team,
    name: `S${id}`,
    bodyType: 0,
    gridNo: 0,
    x: 0,
    y: 0,
    level: 0,
    direction: 0,
    animation: 0,
    frame: 0,
    palettes: ['', '', '', ''],
    hand: '',
    frameSlot: 0,
    stateTick: 0,
    frameDelay: 0,
    ...extra,
  };
}

describe('the commands of the item cursor dropped on the map (HandleItemPointerClick)', () => {
  const clips = { slot: SMALL_POCKET, item: 'CLIP9_15', index: CLIP_INDEX, count: 2, status: [15, 15] };
  const merc = view(0, OUR_TEAM, { inventory: [clips] });

  it('gives one clip to the robot, the drop the server turns into its reload', () => {
    const robot = view(1, OUR_TEAM, { bodyType: ROBOT_BODY, kind: 'epc', controlled: true });
    const cursor = cursorFromSlot(merc, SMALL_POCKET, false);
    if (!cursor) throw new Error('no cursor');
    expect(giveCommand(cursor, robot.id)).toEqual({ type: 'give', soldier: 0, target: 1, slot: SMALL_POCKET, count: 1 });
  });

  it('drops at the feet or on the tile beside him, tosses to a tile and passes to a merc, with the pocket object', () => {
    const cursor = cursorFromSlot(merc, SMALL_POCKET, true);
    if (!cursor) throw new Error('no cursor');
    expect(dropCommand(cursor)).toEqual({ type: 'drop', soldier: 0, slot: SMALL_POCKET });
    expect(dropCommand(cursor, BESIDE)).toEqual({ type: 'drop', soldier: 0, slot: SMALL_POCKET, gridNo: BESIDE });
    expect(tossCommand(cursor, FAR_TILE, 1)).toEqual({ type: 'toss', soldier: 0, slot: SMALL_POCKET, gridNo: FAR_TILE, level: 1 });
    expect(passCommand(cursor, 3)).toEqual({ type: 'pass', soldier: 0, slot: SMALL_POCKET, target: 3 });
  });
});

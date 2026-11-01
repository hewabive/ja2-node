import { describe, expect, it } from 'vitest';
import type { SoldierView } from '../../../protocol/view.ts';
import { cursorFromSlot, giveCommand, receivesGive } from './item-cursor.ts';

const OUR_TEAM = 0;
const CIV_TEAM = 4;
const ROBOT_BODY = 21;
const SMALL_POCKET = 11;
const CLIP_INDEX = 71;
const FAR = 10;
const NEAR = 2;

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

describe('the item cursor dropped on a soldier (HandleItemPointerClick)', () => {
  it('gives to the robot at any distance, the drop the server turns into its reload', () => {
    const clips = { slot: SMALL_POCKET, item: 'CLIP9_15', index: CLIP_INDEX, count: 2, status: [15, 15] };
    const merc = view(0, OUR_TEAM, { inventory: [clips] });
    const robot = view(1, OUR_TEAM, { bodyType: ROBOT_BODY, kind: 'epc', controlled: true });
    const cursor = cursorFromSlot(merc, SMALL_POCKET, false);
    if (!cursor) throw new Error('no cursor');
    expect(receivesGive(robot, FAR)).toBe(true);
    expect(giveCommand(cursor, robot.id)).toEqual({ type: 'give', soldier: 0, target: 1, slot: SMALL_POCKET, count: 1 });
  });

  it('gives to an escort at any distance and to a squad mate only within passing distance', () => {
    expect(receivesGive(view(2, OUR_TEAM, { kind: 'epc' }), FAR)).toBe(true);
    expect(receivesGive(view(3, OUR_TEAM), NEAR)).toBe(true);
    expect(receivesGive(view(3, OUR_TEAM), FAR)).toBe(false);
  });

  it('gives to a talkable NPC and never to another soldier', () => {
    expect(receivesGive(view(4, CIV_TEAM, { talkable: 'npc' }), FAR)).toBe(true);
    expect(receivesGive(view(5, CIV_TEAM), NEAR)).toBe(false);
  });
});

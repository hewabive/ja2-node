import { describe, expect, it } from 'vitest';
import { CreditRowFeed } from '../../app/credits/rows.ts';
import { CREDIT_START_Y, CreditRoll } from './credit-roll.ts';

const LINE = 15;

function rollOf(rows: (string | undefined)[]): CreditRoll {
  const queue = [...rows];
  return new CreditRoll(
    0,
    () => (queue.length === 0 ? null : queue.shift()),
    () => LINE,
  );
}

describe('credits roll', () => {
  it('adds a node at the bottom, scrolls 1 px per 25 ms and reads the next row after the node gap', () => {
    const roll = rollOf(['first', 'second']);
    roll.update(0);
    expect(roll.nodes.map((n) => [n.node.text, n.y])).toEqual([['first', CREDIT_START_Y]]);
    roll.update(25);
    expect(roll.nodes[0]?.y).toBe(CREDIT_START_Y);
    roll.update(26);
    expect(roll.nodes[0]?.y).toBe(CREDIT_START_Y - 1);
    roll.update(26 + 25 * 9);
    expect(roll.nodes[0]?.y).toBe(CREDIT_START_Y - 10);
    expect(roll.nodes).toHaveLength(1);
    roll.update(26 + 25 * 11);
    expect(roll.nodes.map((n) => n.node.text)).toEqual(['first', 'second']);
  });

  it('applies code rows to the style and the gap before the next row', () => {
    const roll = rollOf(['@S10,D30;', '@T,{;Title', '@};Name']);
    roll.update(0);
    expect(roll.style.scrollDelayMs).toBe(10);
    roll.update(1);
    expect(roll.nodes[0]?.node).toMatchObject({ text: 'Title', title: true });
    expect(roll.style.gapBeforeNextRow).toBe(30);
    roll.update(250);
    expect(roll.nodes.map((n) => n.y)).toEqual([CREDIT_START_Y - 24]);
    roll.update(320);
    expect(roll.nodes.map((n) => n.node.text)).toEqual(['Title', 'Name']);
    expect(roll.style.gapBeforeNextRow).toBe(50);
  });

  it('waits for rows still loading and ends once the rows ran out and the last node left the screen', () => {
    const roll = rollOf([undefined, 'only']);
    roll.update(0);
    expect(roll.rowsRead).toBe(0);
    roll.update(1);
    expect(roll.rowsRead).toBe(1);
    let now = 1;
    while (!roll.finished && now < 60_000) {
      now += 16;
      roll.update(now);
    }
    expect(roll.finished).toBe(true);
    expect(roll.nodes).toHaveLength(0);
    expect(now).toBeGreaterThan(25 * (CREDIT_START_Y + LINE));
  });
});

describe('credit row feed', () => {
  it('prefetches rows in order from row 1 and reports the end at the first missing row', async () => {
    const asked: number[] = [];
    const feed = new CreditRowFeed(async (row) => {
      asked.push(row);
      return row <= 3 ? `row ${row}` : null;
    }, 2);
    expect(feed.take()).toBeUndefined();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(feed.take()).toBe('row 1');
    expect(feed.take()).toBe('row 2');
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(feed.take()).toBe('row 3');
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(feed.take()).toBeNull();
    expect(asked.slice(0, 3)).toEqual([1, 2, 3]);
  });
});

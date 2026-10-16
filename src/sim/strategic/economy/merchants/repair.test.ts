import { beforeAll, describe, expect, it } from 'vitest';
import {
  itemId,
  loadMerchantTestContent,
  type MerchantTestContent,
  merchantFixture,
  queued,
} from '../../../../../tests/support/merchants.ts';
import { createItem, NO_PROFILE } from '../../../items/object.ts';
import { determineArmsDealersSellingInventory, type RepairedItem } from './boxes.ts';
import {
  calculateMinutesClosedBetween,
  calculateObjectItemRepairCost,
  calculateObjectItemRepairTime,
  calculateOvernightRepairDelay,
  canDealerRepairItem,
  countTotalItemsRepairDealerHasInForRepairs,
  giveObjectToArmsDealerForRepair,
  handlePossibleRepairDelays,
  repairmanIsFixingItemsButNoneAreDoneYet,
} from './repair.ts';
import { header } from './state.ts';

let t: MerchantTestContent;

beforeAll(async () => {
  t = await loadMerchantTestContent();
});

const ARNIE = 14;
const FREDO = 15;
const PERKO = 16;
const OPEN = 8 * 60;
const CLOSE = 20 * 60;
const DAY = 1440;
const IVAN = 7;

const item = (name: string, status: number) => createItem(t.items, itemId(t, name), status);

describe('repairmen', () => {
  it('repairs electronics at Fredo only and everything else elsewhere', () => {
    const [arnie, fredo] = [t.content.dealers[ARNIE], t.content.dealers[FREDO]];
    const { ctx } = merchantFixture(t);
    if (!arnie || !fredo) throw new Error('no repairmen');
    expect(canDealerRepairItem(ctx, arnie, itemId(t, 'GLOCK_17'))).toBe(true);
    expect(canDealerRepairItem(ctx, arnie, itemId(t, 'VIDEO_CAMERA'))).toBe(false);
    expect(canDealerRepairItem(ctx, fredo, itemId(t, 'VIDEO_CAMERA'))).toBe(true);
    expect(canDealerRepairItem(ctx, fredo, itemId(t, 'GLOCK_17'))).toBe(false);
    expect(canDealerRepairItem(ctx, arnie, itemId(t, 'BEER'))).toBe(false);
  });

  it('reproduces the cost and time examples', () => {
    const { ctx } = merchantFixture(t);
    const glock = item('GLOCK_17', 50);
    expect([calculateObjectItemRepairCost(ctx, PERKO, glock), calculateObjectItemRepairTime(ctx, PERKO, glock)]).toEqual([56, 56]);
    expect([calculateObjectItemRepairCost(ctx, ARNIE, glock), calculateObjectItemRepairTime(ctx, ARNIE, glock)]).toEqual([112, 15]);
    expect([calculateObjectItemRepairCost(ctx, FREDO, glock), calculateObjectItemRepairTime(ctx, FREDO, glock)]).toEqual([84, 50]);
    const rocketRifle = item('ROCKET_RIFLE', 100);
    expect([calculateObjectItemRepairCost(ctx, FREDO, rocketRifle), calculateObjectItemRepairTime(ctx, FREDO, rocketRifle)]).toEqual([
      100, 60,
    ]);
    const flak = item('FLAK_JACKET', 99);
    expect([calculateObjectItemRepairCost(ctx, PERKO, flak), calculateObjectItemRepairTime(ctx, PERKO, flak)]).toEqual([10, 15]);
  });

  it('adds attachments below 100 % that the repairman can fix', () => {
    const { ctx } = merchantFixture(t);
    const m14 = item('M14', 50);
    const scope = m14.attachments[0];
    if (scope) {
      scope.item = itemId(t, 'SNIPERSCOPE');
      scope.status = 40;
    }
    const bare = item('M14', 50);
    const scopeAlone = item('SNIPERSCOPE', 40);
    expect(calculateObjectItemRepairCost(ctx, PERKO, m14)).toBe(
      calculateObjectItemRepairCost(ctx, PERKO, bare) + calculateObjectItemRepairCost(ctx, PERKO, scopeAlone),
    );
  });

  it('delays a job that does not fit into the shop day', () => {
    const fixture = merchantFixture(t);
    const { ctx } = fixture;
    expect(calculateOvernightRepairDelay(ctx, PERKO, 600, 1000)).toBe(0);
    fixture.hours = { open: OPEN, close: CLOSE };
    const night = DAY - (CLOSE - OPEN);
    expect(calculateOvernightRepairDelay(ctx, PERKO, 600, 100)).toBe(0);
    expect(calculateOvernightRepairDelay(ctx, PERKO, 1170, 60)).toBe(night);
    expect(calculateOvernightRepairDelay(ctx, PERKO, 1260, 30)).toBe(night);
    expect(calculateOvernightRepairDelay(ctx, PERKO, 600, 2000)).toBe(2 * night);
    expect(calculateOvernightRepairDelay(ctx, PERKO, DAY + 300, 30)).toBe(0);
  });

  it('counts closed minutes with the double night of a same-time span and one night short across two days', () => {
    const fixture = merchantFixture(t);
    const { ctx } = fixture;
    fixture.hours = { open: OPEN, close: CLOSE };
    const night = DAY - (CLOSE - OPEN);
    expect(calculateMinutesClosedBetween(ctx, PERKO, 600, 660)).toBe(0);
    expect(calculateMinutesClosedBetween(ctx, PERKO, 1170, 1440)).toBe(240);
    expect(calculateMinutesClosedBetween(ctx, PERKO, 1260, 1260 + 1380)).toBe(180 + 480 + 0 + 0);
    expect(calculateMinutesClosedBetween(ctx, PERKO, 600, 600 + 3 * DAY)).toBe(2 * night + night + night);
    expect(calculateMinutesClosedBetween(ctx, PERKO, 600, 600 + 2 * DAY + 60)).toBe(night);
    expect(calculateMinutesClosedBetween(ctx, PERKO, 1260, 1200 + 2 * DAY)).toBe(night + 180 + 480);
  });

  it('queues repairs one after another with negated conditions and the owner', () => {
    const fixture = merchantFixture(t, { world: { minutes: DAY + 600 } });
    const { ctx } = fixture;
    fixture.hours = { open: OPEN, close: CLOSE };
    const first = giveObjectToArmsDealerForRepair(ctx, PERKO, item('GLOCK_17', 50), IVAN);
    const second = giveObjectToArmsDealerForRepair(ctx, PERKO, item('BERETTA_92F', 30), IVAN);
    const glock = header(ctx.state, PERKO, itemId(t, 'GLOCK_17')).specials[first];
    const beretta = header(ctx.state, PERKO, itemId(t, 'BERETTA_92F')).specials[second];
    expect(glock).toMatchObject({ repairDoneTime: DAY + 656, owner: IVAN });
    expect(glock?.info.condition).toBe(-50);
    expect(beretta?.repairDoneTime).toBe(DAY + 656 + calculateObjectItemRepairTime(ctx, PERKO, item('BERETTA_92F', 30)));
    expect(countTotalItemsRepairDealerHasInForRepairs(ctx, PERKO)).toBe(2);
    expect(repairmanIsFixingItemsButNoneAreDoneYet(ctx, PERKO)).toBe(true);
  });

  it('offers the delay excuse once, only for recent jobs, with a pre-stream chance', () => {
    const pre = queued(10);
    const main = queued(2);
    const fixture = merchantFixture(t, { random: main, preRandom: pre, world: { minutes: DAY + 600 } });
    const { ctx, world } = fixture;
    giveObjectToArmsDealerForRepair(ctx, PERKO, item('GLOCK_17', 50), IVAN);
    world.minutes = DAY + 700;
    expect(handlePossibleRepairDelays(ctx, PERKO)).toBe(true);
    expect(pre.ranges).toEqual([100]);
    expect(main.ranges).toEqual([6]);
    expect(header(ctx.state, PERKO, itemId(t, 'GLOCK_17')).specials[0]?.repairDoneTime).toBe(DAY + 656 + 8 * 60);
    expect(handlePossibleRepairDelays(ctx, PERKO)).toBe(false);
    expect(pre.ranges).toHaveLength(1);
    const arnie = merchantFixture(t, { preRandom: pre, world: { minutes: DAY + 600 } });
    giveObjectToArmsDealerForRepair(arnie.ctx, ARNIE, item('GLOCK_17', 50), IVAN);
    arnie.world.minutes = DAY + 700;
    expect(handlePossibleRepairDelays(arnie.ctx, ARNIE)).toBe(false);
  });

  it('skips the excuse right after a visit or long after the job was done', () => {
    const pre = queued();
    const fixture = merchantFixture(t, { preRandom: pre, world: { minutes: DAY + 600 } });
    const { ctx, world } = fixture;
    giveObjectToArmsDealerForRepair(ctx, PERKO, item('GLOCK_17', 50), IVAN);
    world.minutes = DAY + 700;
    const status = ctx.state.dealers[PERKO]?.status;
    if (status) status.lastSkiMinute = DAY + 600;
    expect(handlePossibleRepairDelays(ctx, PERKO)).toBe(false);
    if (status) status.lastSkiMinute = 0;
    world.minutes = DAY + 656 + 6 * 60;
    expect(handlePossibleRepairDelays(ctx, PERKO)).toBe(false);
    expect(pre.ranges).toEqual([]);
  });

  it('collects finished repairs at 100 % with repairable attachments fixed and Fredo resetting imprints', () => {
    const fixture = merchantFixture(t, { world: { minutes: DAY + 600 } });
    const { ctx, world } = fixture;
    const m14 = item('M14', 40);
    const scope = m14.attachments[0];
    if (scope) {
      scope.item = itemId(t, 'SNIPERSCOPE');
      scope.status = 30;
    }
    m14.imprintId = IVAN;
    giveObjectToArmsDealerForRepair(ctx, PERKO, m14, IVAN);
    const rocketRifle = item('ROCKET_RIFLE', 100);
    rocketRifle.imprintId = IVAN;
    giveObjectToArmsDealerForRepair(ctx, FREDO, rocketRifle, IVAN);
    world.minutes = DAY * 5;
    const collected: RepairedItem[] = [];
    const collect = (r: RepairedItem) => {
      collected.push(r);
      return true;
    };
    expect(determineArmsDealersSellingInventory(ctx, PERKO, collect)).toEqual([]);
    expect(determineArmsDealersSellingInventory(ctx, FREDO, collect)).toEqual([]);
    expect(collected.map((r) => [r.object.status[0], r.object.attachments[0]?.status, r.object.imprintId, r.owner])).toEqual([
      [100, 100, IVAN, IVAN],
      [100, 0, NO_PROFILE, IVAN],
    ]);
    expect(countTotalItemsRepairDealerHasInForRepairs(ctx, PERKO)).toBe(0);
  });

  it('keeps a finished repair in the shop when there is no room for it', () => {
    const fixture = merchantFixture(t, { world: { minutes: DAY + 600 } });
    const { ctx, world } = fixture;
    giveObjectToArmsDealerForRepair(ctx, PERKO, item('GLOCK_17', 50), IVAN);
    world.minutes = DAY * 3;
    const boxes = determineArmsDealersSellingInventory(ctx, PERKO, () => false);
    expect(boxes.map((b) => [b.key.item, b.object.status[0], b.owner])).toEqual([[itemId(t, 'GLOCK_17'), 50, IVAN]]);
  });
});

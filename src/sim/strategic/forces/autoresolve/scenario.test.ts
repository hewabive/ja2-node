import { beforeAll, describe, expect, it } from 'vitest';
import {
  arEnv,
  arSoldier,
  enemySoldier,
  itemIndex,
  militiaSoldier,
  progressFor,
  seededRng,
  TestMilitia,
} from '../../../../../tests/support/autoresolve.ts';
import { loadTestContent } from '../../../../../tests/support/tactical.ts';
import { createItem } from '../../../items/object.ts';
import type { TacticalContent } from '../../../tactical/content.ts';
import { InvSlot } from '../../../tactical/inventory.ts';
import { SoldierClass } from '../../../tactical/soldier.ts';
import { EncounterCode } from '../constants.ts';
import { autoBandageMercs, canBandage } from './bandage.ts';
import { closeAutoresolve } from './close.ts';
import { orderRetreat } from './end.ts';
import { runAutoresolve } from './loop.ts';
import { endOfBattle } from './outcome.ts';
import { enterAutoresolve } from './setup.ts';
import { BattleStatus, CellFlag, createAutoresolveState } from './state.ts';

let content: TacticalContent;

beforeAll(async () => {
  content = await loadTestContent();
});

const ENEMY_GROUP = 5;

function scenario(seed: number, retreatAfterSlices: number | null) {
  const profiles = new Map([1, 2, 3].map((id) => [id, progressFor(id)]));
  const mercs = [1, 2, 3].map((profile, i) => ({
    soldier: arSoldier(content, { id: i, profile, gun: 'MP5K', magazines: 3, leadership: 40 + 10 * i, medical: 30 }),
    groupId: 1,
  }));
  mercs[2]?.soldier.inv.splice(InvSlot.SMALLPOCK1, 1, createItem(content.items, itemIndex(content, 'FIRSTAIDKIT'), 100));
  const militia = Array.from({ length: 4 }, (_, i) =>
    militiaSoldier(content, { id: 40 + i, soldierClass: i === 0 ? SoldierClass.REG_MILITIA : SoldierClass.GREEN_MILITIA, magazines: 2 }),
  );
  const enemies = Array.from({ length: 6 }, (_, i) => ({
    soldier: enemySoldier(content, { id: 60 + i, gun: i < 2 ? 'AK74' : 'GLOCK_18', magazines: 2, morale: 60 }),
    groupId: ENEMY_GROUP,
  }));
  const ar = createAutoresolveState({ sector: 3 * 16 + 12, encounter: EncounterCode.ENEMY_INVASION, mercs, militia, enemies });
  const env = arEnv(content, { rng: seededRng(seed), profiles, world: { day: 2, playerCapturedForRescue: false } });
  enterAutoresolve(env, ar);
  if (retreatAfterSlices !== null) {
    runAutoresolve(env, ar, { maxSlices: retreatAfterSlices });
    orderRetreat(ar, null);
  }
  const stop = runAutoresolve(env, ar, { maxSlices: 100000 });
  const battleMs = ar.elapsedMs;
  const outcome = endOfBattle(ar);
  const bandage = canBandage(env, ar) ? autoBandageMercs(env, ar) : null;
  const militiaCounts = new TestMilitia(3, 1, 0);
  const close = closeAutoresolve(env, ar, { militia: militiaCounts, enemiesLeftInSector: () => 0 });
  const ids = (list: readonly { id: number }[]) => list.map((s) => s.id);
  return {
    stop,
    status: ar.status,
    battleMs,
    slices: ar.slices,
    outcome: outcome && { ...outcome, mercsCaptured: ids(outcome.mercsCaptured) },
    bandage,
    warpSeconds: close.warpSeconds,
    mercsDied: ids(close.mercsDied),
    militiaDied: close.militiaDied,
    promotions: close.promotions,
    enemiesKilled: close.enemiesKilled.map((e) => [e.soldier.id, e.groupId]),
    corpses: close.corpses.map((c) => [c.soldier.id, c.gridNo, c.deathAnimation, c.items.map((o) => [o.item, o.count])]),
    lives: [...ar.mercs, ...ar.militia, ...ar.enemies].map((c) => [c.soldier.life, c.soldier.bleeding, c.flags & ~CellFlag.PROCESSED]),
    ammo: ar.mercs.map((c) => c.soldier.inv.map((o) => [o.item, o.count, o.gunShotsLeft, o.status[0] ?? 0])),
    profiles: [...profiles.values()].map((p) => ({ ...p })),
    events: ar.events,
    statEvents: ar.statEvents,
    militiaCounts: militiaCounts.counts,
  };
}

describe('autoresolve scenario on constructed cells', () => {
  it('runs to the end deterministically and identically across two runs', () => {
    const first = scenario(1234, null);
    const second = scenario(1234, null);
    expect(first.stop).toBe('over');
    expect([BattleStatus.VICTORY, BattleStatus.DEFEAT]).toContain(first.status);
    expect(first.events.length).toBeGreaterThan(20);
    expect(first.warpSeconds).toBe(Math.trunc((first.battleMs * 3 + (first.bandage?.pointsUsed ?? 0) * 200) / 1000));
    expect(second).toEqual(first);
    expect(scenario(4321, null).events).not.toEqual(first.events);
  });

  it('replays a battle with a retreat order after slice 3', () => {
    const first = scenario(77, 3);
    const second = scenario(77, 3);
    expect(second).toEqual(first);
    expect(first.lives.slice(0, 3).every(([, , flags]) => ((flags as number) & (CellFlag.RETREATING | CellFlag.RETREATED)) !== 0)).toBe(
      true,
    );
    expect(first.events.find((e) => e.type === 'arRetreated')).toBeDefined();
  });
});

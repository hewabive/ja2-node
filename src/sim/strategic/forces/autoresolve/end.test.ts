import { beforeAll, describe, expect, it } from 'vitest';
import { arEnv, arSoldier, arState, enemySoldier, itemIndex, militiaSoldier, scripted } from '../../../../../tests/support/autoresolve.ts';
import { loadTestContent } from '../../../../../tests/support/tactical.ts';
import { createItem } from '../../../items/object.ts';
import type { TacticalContent } from '../../../tactical/content.ts';
import { InvSlot } from '../../../tactical/inventory.ts';
import { Body } from '../../../tactical/soldier.ts';
import { answerSurrender, attemptPlayerCapture, isBattleOver, orderRetreat, retreatAll, retreatOne } from './end.ts';
import { processCell, runAutoresolve, runSlice } from './loop.ts';
import { type ArCell, BattleStatus, CellFlag, updateRobotController } from './state.ts';

let content: TacticalContent;

beforeAll(async () => {
  content = await loadTestContent();
});

function cell(cells: readonly ArCell[], i: number): ArCell {
  const c = cells[i];
  if (!c) throw new Error(`no cell ${i}`);
  return c;
}

describe('retreat orders', () => {
  it('times one merc with 5× and everybody with 2× the remaining timer, wrapping at 16 bits (quirk Q7)', () => {
    const ar = arState({ mercs: [{ soldier: arSoldier(content) }, { soldier: arSoldier(content) }] });
    const a = cell(ar.mercs, 0);
    const b = cell(ar.mercs, 1);
    a.attack = 600;
    b.attack = 500;
    ar.playerAttack = 1100;
    a.nextAttack = 20000;
    b.nextAttack = 300;
    const pre = scripted([5]);
    expect(retreatOne(pre, ar, 0)).toBe(true);
    expect(pre.requested).toEqual([1400]);
    expect(a.nextAttack).toBe((1000 + 100000 + 5) * 2 - 0x30000);
    expect(a.attack).toBe(0);
    expect(ar.playerAttack).toBe(500);
    const all = scripted([7]);
    retreatAll(all, ar);
    expect(all.requested).toEqual([1500]);
    expect(b.nextAttack).toBe((1000 + 600 + 7) * 2);
    expect(b.flags & CellFlag.RETREATING).not.toBe(0);
    expect(ar.playerAttack).toBe(0);
  });

  it('keeps a robot without controller from retreating and lets it follow its controller', () => {
    const remote = itemIndex(content, 'ROBOT_REMOTE_CONTROL');
    const controller = arSoldier(content, { id: 1 });
    controller.inv[InvSlot.HEAD1] = createItem(content.items, remote, 100);
    const ar = arState({
      mercs: [{ soldier: controller }, { soldier: arSoldier(content, { id: 2, body: Body.ROBOTNOWEAPON }), robot: true }],
    });
    updateRobotController(arEnv(content), ar);
    expect(ar.robotController).toBe(0);
    const robot = cell(ar.mercs, 1);
    robot.attack = 300;
    ar.playerAttack = 300;
    expect(retreatOne(scripted([0]), ar, 1)).toBe(false);
    expect(retreatOne(scripted([0]), ar, 0)).toBe(true);
    expect(robot.flags & CellFlag.RETREATING).not.toBe(0);
    expect(robot.nextAttack).toBe(cell(ar.mercs, 0).nextAttack);
    expect(robot.attack).toBe(0);
    const alone = arState({
      mercs: [{ soldier: arSoldier(content) }, { soldier: arSoldier(content, { body: Body.ROBOTNOWEAPON }), robot: true }],
    });
    updateRobotController(arEnv(content), alone);
    retreatAll(scripted([], 0), alone);
    expect(cell(alone.mercs, 1).flags & CellFlag.RETREATING).toBe(0);
    expect(cell(alone.mercs, 1).nextAttack).toBe(0xffff);
  });

  it('orders the dead and the unconscious to retreat too, a retreat they never complete (quirk Q11)', () => {
    const ar = arState({
      mercs: [{ soldier: arSoldier(content) }, { soldier: arSoldier(content, { life: 0 }) }, { soldier: arSoldier(content, { life: 5 }) }],
      enemies: [{ soldier: enemySoldier(content) }],
    });
    const pre = scripted([], 0);
    retreatAll(pre, ar);
    expect(pre.requested).toHaveLength(ar.mercs.length);
    expect(ar.mercs.every((c) => (c.flags & CellFlag.RETREATING) !== 0)).toBe(true);
    const unconscious = cell(ar.mercs, 2);
    unconscious.nextAttack = 0;
    processCell(arEnv(content), ar, unconscious, 1000);
    expect(unconscious.flags & (CellFlag.RETREATING | CellFlag.RETREATED)).toBe(CellFlag.RETREATING);
  });

  it('queues orders and refuses them while a surrender offer is pending', () => {
    const ar = arState({ mercs: [{ soldier: arSoldier(content) }] });
    expect(orderRetreat(ar, 0)).toBe(true);
    ar.pendingSurrender = true;
    expect(orderRetreat(ar, null)).toBe(false);
    expect(ar.orders).toEqual([{ merc: 0 }]);
  });
});

describe('isBattleOver', () => {
  it('keeps going while an unconscious enemy lives and ends in victory when all are dead', () => {
    const ar = arState({ mercs: [{ soldier: arSoldier(content) }], enemies: [{ soldier: enemySoldier(content, { life: 5 }) }] });
    const env = arEnv(content);
    expect(isBattleOver(env, ar)).toBe(false);
    cell(ar.enemies, 0).soldier.life = 0;
    ar.aliveEnemies = 0;
    expect(isBattleOver(env, ar)).toBe(true);
    expect(ar.status).toBe(BattleStatus.VICTORY);
  });

  it('ends in retreat when someone retreated and in defeat otherwise', () => {
    const retreat = arState({
      mercs: [{ soldier: arSoldier(content) }, { soldier: arSoldier(content, { life: 0 }) }],
      enemies: [{ soldier: enemySoldier(content) }],
    });
    cell(retreat.mercs, 0).flags |= CellFlag.RETREATED;
    let retreated = false;
    expect(isBattleOver(arEnv(content, { hooks: { battleRetreat: () => (retreated = true) } }), retreat)).toBe(true);
    expect(retreat.status).toBe(BattleStatus.RETREAT);
    expect(retreated).toBe(true);
    const defeat = arState({ mercs: [{ soldier: arSoldier(content, { life: 0 }) }], enemies: [{ soldier: enemySoldier(content) }] });
    expect(isBattleOver(arEnv(content), defeat)).toBe(true);
    expect(defeat.status).toBe(BattleStatus.DEFEAT);
  });

  it('kills the EPCs left alone and lets live militia keep the battle going', () => {
    const ar = arState({
      mercs: [{ soldier: arSoldier(content, { life: 0 }) }, { soldier: arSoldier(content), epc: true }],
      militia: [militiaSoldier(content, { life: 3 })],
      enemies: [{ soldier: enemySoldier(content) }],
    });
    expect(isBattleOver(arEnv(content), ar)).toBe(false);
    ar.aliveCivs = 0;
    expect(isBattleOver(arEnv(content), ar)).toBe(true);
    expect(ar.status).toBe(BattleStatus.DEFEAT);
    expect(cell(ar.mercs, 1).soldier.life).toBe(0);
    expect(ar.aliveMercs).toBe(0);
  });

  it('counts unconscious mercs as still fighting', () => {
    const ar = arState({ mercs: [{ soldier: arSoldier(content, { life: 4 }) }], enemies: [{ soldier: enemySoldier(content) }] });
    expect(isBattleOver(arEnv(content), ar)).toBe(false);
  });

  it('kills a dead robot again and loses the battle while its unconscious controller lives (quirk Q21)', () => {
    const controller = arSoldier(content, { life: 10 });
    controller.inv[InvSlot.HEAD1] = createItem(content.items, itemIndex(content, 'ROBOT_REMOTE_CONTROL'), 100);
    const ar = arState({
      mercs: [{ soldier: controller }, { soldier: arSoldier(content, { life: 0, body: Body.ROBOTNOWEAPON }), robot: true }],
      enemies: [{ soldier: enemySoldier(content) }],
    });
    const env = arEnv(content);
    updateRobotController(env, ar);
    expect(ar.aliveMercs).toBe(1);
    expect(isBattleOver(env, ar)).toBe(true);
    expect(ar.status).toBe(BattleStatus.DEFEAT);
    expect(ar.aliveMercs).toBe(0);
    expect(controller.life).toBe(10);
  });
});

describe('attemptPlayerCapture', () => {
  function capturable(day = 4) {
    const mercs = [{ soldier: arSoldier(content, { life: 30, lifeMax: 60 }) }, { soldier: arSoldier(content, { life: 30, lifeMax: 60 }) }];
    const enemies = Array.from({ length: 4 }, () => ({ soldier: enemySoldier(content) }));
    return { ar: arState({ mercs, enemies }), day };
  }

  it('never captures before day 4 and needs 2–3 mercs at most 60 % life against twice as many conscious enemies', () => {
    const early = capturable(3);
    expect(attemptPlayerCapture(arEnv(content, { world: { day: early.day } }), early.ar)).toBe(false);
    const healthy = capturable();
    cell(healthy.ar.mercs, 0).soldier.life = 37;
    expect(attemptPlayerCapture(arEnv(content, { world: { day: 4 } }), healthy.ar)).toBe(false);
    const few = capturable();
    for (const e of few.ar.enemies.slice(1)) e.soldier.life = 10;
    expect(attemptPlayerCapture(arEnv(content, { world: { day: 4 } }), few.ar)).toBe(false);
    const robot = arState({
      mercs: [
        { soldier: arSoldier(content, { life: 30 }) },
        { soldier: arSoldier(content, { life: 10, body: Body.ROBOTNOWEAPON }), robot: true },
      ],
      enemies: Array.from({ length: 4 }, () => ({ soldier: enemySoldier(content) })),
    });
    expect(attemptPlayerCapture(arEnv(content, { world: { day: 9 } }), robot)).toBe(false);
  });

  it('offers surrender 2 % of the time with a conscious merc, captures 25 % of the time otherwise', () => {
    const offer = capturable();
    const pre = scripted([1]);
    expect(attemptPlayerCapture(arEnv(content, { pre, world: { day: 4 } }), offer.ar)).toBe(true);
    expect(offer.ar.pendingSurrender).toBe(true);
    const failed = capturable();
    expect(attemptPlayerCapture(arEnv(content, { pre: scripted([2]), world: { day: 4 } }), failed.ar)).toBe(true);
    expect(failed.ar.pendingSurrender).toBe(false);
    expect(failed.ar.status).toBe(BattleStatus.IN_PROGRESS);
    const out = capturable();
    for (const c of out.ar.mercs) c.soldier.life = 10;
    let begun = false;
    const env = arEnv(content, { pre: scripted([24]), world: { day: 4 }, hooks: { beginCaptureSequence: () => (begun = true) } });
    expect(attemptPlayerCapture(env, out.ar)).toBe(true);
    expect(out.ar.status).toBe(BattleStatus.CAPTURED);
    expect(begun).toBe(true);
  });

  it('stops checking after a rejected offer and surrenders on accept', () => {
    const rejected = capturable();
    rejected.ar.pendingSurrender = true;
    const env = arEnv(content, { world: { day: 4 } });
    answerSurrender(env, rejected.ar, false);
    expect(rejected.ar.playerRejectedSurrender).toBe(true);
    expect(attemptPlayerCapture(env, rejected.ar)).toBe(false);
    const accepted = capturable();
    accepted.ar.pendingSurrender = true;
    answerSurrender(env, accepted.ar, true);
    expect(accepted.ar.status).toBe(BattleStatus.SURRENDERED);
  });

  it('abandons the slice after a failed roll, so the next slice adds another 1000 ms', () => {
    const { ar } = capturable();
    for (const c of ar.mercs) c.soldier.life = 10;
    const pre = scripted([99, 99, 0]);
    const env = arEnv(content, { pre, world: { day: 4 } });
    runSlice(env, ar);
    expect(ar.elapsedMs).toBe(1000);
    expect(pre.requested).toEqual([100]);
    runSlice(env, ar);
    expect(ar.elapsedMs).toBe(2000);
    expect(runAutoresolve(env, ar)).toBe('over');
    expect(ar.status).toBe(BattleStatus.CAPTURED);
    expect(ar.elapsedMs).toBe(3000);
  });
});

import { beforeAll, describe, expect, it } from 'vitest';
import {
  arEnv,
  arSoldier,
  arState,
  enemySoldier,
  itemIndex,
  militiaSoldier,
  progressFor,
  scripted,
  TestMilitia,
} from '../../../../../tests/support/autoresolve.ts';
import { loadTestContent } from '../../../../../tests/support/tactical.ts';
import { createItem } from '../../../items/object.ts';
import type { TacticalContent } from '../../../tactical/content.ts';
import { InvSlot } from '../../../tactical/inventory.ts';
import { SoldierClass } from '../../../tactical/soldier.ts';
import { autoBandageMercs, canBandage, dressWound } from './bandage.ts';
import { type AutoresolveClosePort, checkOneMilitiaForPromotion, closeAutoresolve, MilitiaRank, randomGridNo } from './close.ts';
import { answerSurrender, attemptPlayerCapture } from './end.ts';
import { endOfBattle } from './outcome.ts';
import { BattleStatus, CellFlag, combatContext } from './state.ts';

let content: TacticalContent;

beforeAll(async () => {
  content = await loadTestContent();
});

function port(militia: TestMilitia, enemiesLeft = 0): AutoresolveClosePort & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    militia,
    enemiesLeftInSector: () => enemiesLeft,
    mercDied: () => calls.push('mercDied'),
    mercCaptured: () => calls.push('mercCaptured'),
    enemyKilled: (_s, groupId) => calls.push(`enemyKilled:${groupId}`),
    eliminateAllEnemies: () => calls.push('eliminate'),
    resetEnemyMovement: () => calls.push('resetMovement'),
    playerGroupArrivedSafely: (g, first) => calls.push(`arrived:${g}:${first}`),
    endCaptureSequence: () => calls.push('endCapture'),
  };
}

describe('elapsed battle time', () => {
  it('triples the battle time, then adds 5 minutes for a retreat and 200 ms per kit point (quirk Q27)', () => {
    const ar = arState({ mercs: [{ soldier: arSoldier(content) }] });
    ar.elapsedMs = 7000;
    ar.status = BattleStatus.RETREAT;
    const outcome = endOfBattle(ar);
    expect(ar.elapsedMs).toBe(21000 + 300000);
    expect(outcome?.retreatImplications).toBe(true);
    expect(outcome?.enemyGainsControl).toBe(true);
    expect(endOfBattle(ar)).toBeNull();
    const won = arState({ mercs: [{ soldier: arSoldier(content) }] });
    won.elapsedMs = 4000;
    won.status = BattleStatus.VICTORY;
    expect(endOfBattle(won)?.playerTakesControl).toBe(true);
    expect(won.elapsedMs).toBe(12000);
    const result = closeAutoresolve(arEnv(content), won, port(new TestMilitia(0, 0, 0)));
    expect(result.warpSeconds).toBe(12);
  });
});

describe('bandaging after a victory', () => {
  function wounded() {
    const kit = itemIndex(content, 'FIRSTAIDKIT');
    const medic = arSoldier(content, { medical: 50, dexterity: 60, experience: 3 });
    medic.inv[InvSlot.SMALLPOCK1] = createItem(content.items, kit, 100);
    const patient = arSoldier(content, { life: 10, lifeMax: 60 });
    patient.bleeding = 20;
    const ar = arState({ mercs: [{ soldier: medic }, { soldier: patient }] });
    ar.status = BattleStatus.VICTORY;
    return { ar, medic, patient };
  }

  it('dresses wounds like VirtualSoldierDressWound with 12 APs', () => {
    const { ar, medic, patient } = wounded();
    const env = arEnv(content);
    const kit = medic.inv[InvSlot.SMALLPOCK1];
    if (!kit) throw new Error('no kit');
    expect(dressWound(env, combatContext(env, ar), medic, patient, kit, 100, 100)).toBe(14);
    expect(patient.life).toBe(15);
    expect(patient.bleeding).toBe(11);
  });

  it('bandages everyone with the best medic and adds 200 ms per point used', () => {
    const { ar, patient, medic } = wounded();
    const env = arEnv(content);
    expect(canBandage(env, ar)).toBe(true);
    ar.elapsedMs = 30000;
    const r = autoBandageMercs(env, ar);
    expect(r).toEqual({ complete: true, pointsUsed: 25 });
    expect(patient.bleeding).toBe(0);
    expect(patient.life).toBe(15);
    expect(medic.inv[InvSlot.SMALLPOCK1]?.status[0]).toBe(75);
    expect(ar.elapsedMs).toBe(30000 + 25 * 200);
    expect(canBandage(env, ar)).toBe(false);
  });

  it('gives the medic the medical kit bonus only for a kit in the helmet slot (quirk Q17)', () => {
    const kit = (slot: number) => {
      const { ar, medic, patient } = wounded();
      patient.life = 60;
      patient.bleeding = 40;
      medic.inv[slot] = createItem(content.items, itemIndex(content, 'MEDICKIT'), 100);
      const env = arEnv(content);
      const firstAid = medic.inv[InvSlot.SMALLPOCK1];
      if (!firstAid) throw new Error('no kit');
      return dressWound(env, combatContext(env, ar), medic, patient, firstAid, 100, 100);
    };
    const inHand = kit(InvSlot.HAND);
    expect(kit(InvSlot.HELMET)).toBe(inHand + Math.trunc(inHand / 2));
  });

  it('stops looking for the best medic at the first kit owner who is not bleeding (quirk Q17)', () => {
    const [FIRST_KIT_OWNER, BETTER_MEDIC, PATIENT] = [3, 4, 5];
    const profiles = new Map([FIRST_KIT_OWNER, BETTER_MEDIC, PATIENT].map((id) => [id, progressFor(id)]));
    const owner = arSoldier(content, { profile: FIRST_KIT_OWNER, medical: 30 });
    owner.inv[InvSlot.SMALLPOCK1] = createItem(content.items, itemIndex(content, 'FIRSTAIDKIT'), 100);
    const better = arSoldier(content, { profile: BETTER_MEDIC, medical: 90 });
    const patient = arSoldier(content, { profile: PATIENT, life: 30, lifeMax: 60 });
    patient.bleeding = 20;
    const ar = arState({ mercs: [{ soldier: owner }, { soldier: better }, { soldier: patient }] });
    ar.status = BattleStatus.VICTORY;
    expect(autoBandageMercs(arEnv(content, { profiles }), ar).complete).toBe(true);
    expect(patient.bleeding).toBe(0);
    const medicalGains = (id: number) => profiles.get(id)?.gains.medical;
    expect(medicalGains(FIRST_KIT_OWNER)).toBeGreaterThan(0);
    expect(medicalGains(BETTER_MEDIC)).toBe(0);
  });
});

describe('closeAutoresolve', () => {
  it('kills militia below 7 life, promotes survivors and counts enemies below 15 life as killed even after a defeat (quirk Q20)', () => {
    const militia = new TestMilitia(2, 0, 0);
    const ar = arState({
      mercs: [{ soldier: arSoldier(content, { life: 0 }) }],
      militia: [militiaSoldier(content, { life: 6 }), militiaSoldier(content, { life: 7 })],
      enemies: [{ soldier: enemySoldier(content, { life: 14 }), groupId: 3 }, { soldier: enemySoldier(content, { life: 15 }) }],
    });
    ar.status = BattleStatus.DEFEAT;
    const militiaCell = ar.militia[1];
    if (militiaCell) militiaCell.militiaKills = 3;
    const p = port(militia);
    const main = scripted([80, 80, 0, 80, 80, 80, 0, 0, 80, 80, 80, 0]);
    const result = closeAutoresolve(arEnv(content, { main }), ar, p);
    expect(result.militiaDied).toEqual([MilitiaRank.GREEN]);
    expect(militia.removed).toEqual([MilitiaRank.GREEN]);
    expect(result.promotions).toEqual({ greenToRegular: 1, regularToElite: 0, greenToElite: 0, total: 1 });
    expect(result.enemiesKilled.map((e) => e.groupId)).toEqual([3]);
    expect(result.mercsDied).toHaveLength(1);
    expect(p.calls).toEqual(['mercDied', 'enemyKilled:3', 'resetMovement']);
    expect(result.excessEliminated).toBe(false);
    expect(result.corpses).toHaveLength(3);
    expect(main.left).toBe(0);
  });

  it('eliminates the excess enemies only after a victory', () => {
    const won = arState({
      mercs: [{ soldier: arSoldier(content), groupId: 2 }],
      enemies: [{ soldier: enemySoldier(content, { life: 0 }) }],
    });
    won.status = BattleStatus.VICTORY;
    const p = port(new TestMilitia(0, 0, 0), 5);
    expect(closeAutoresolve(arEnv(content), won, p).excessEliminated).toBe(true);
    expect(p.calls).toContain('eliminate');
    expect(p.calls).toContain('arrived:2:true');
  });

  it('drops everything of a dead merc and a quarter of what others carry', () => {
    const merc = arSoldier(content, { life: 0, gun: 'GLOCK_17', magazines: 3 });
    const enemy = enemySoldier(content, { life: 0, gun: 'GLOCK_17', magazines: 4 });
    const ar = arState({ mercs: [{ soldier: merc }], enemies: [{ soldier: enemy }] });
    ar.status = BattleStatus.VICTORY;
    const main = scripted([80, 80, 3, 80, 80, 10, 80, 1, 2]);
    const result = closeAutoresolve(arEnv(content, { main }), ar, port(new TestMilitia(0, 0, 0)));
    const [mercCorpse, enemyCorpse] = result.corpses;
    expect(mercCorpse?.items.map((o) => o.count)).toEqual([1, 3]);
    expect(mercCorpse?.deathAnimation).toBe('FLYBACK_HIT_DEATH');
    expect(main.left).toBe(0);
    expect(enemyCorpse?.items).toHaveLength(1);
    expect(enemyCorpse?.items[0]?.count).toBe(1 + 1);
    expect(enemy.inv[InvSlot.HAND]?.flags).not.toBe(0);
  });

  it('promotes with kill points like CheckOneMilitiaForPromotion', () => {
    const militia = new TestMilitia(1, 0, 0);
    const none = scripted([]);
    expect(checkOneMilitiaForPromotion(none, militia, MilitiaRank.GREEN, 1)).toEqual({ rank: MilitiaRank.GREEN, promotions: 0 });
    expect(none.requested).toEqual([]);
    const twice = scripted([0, 0]);
    expect(checkOneMilitiaForPromotion(twice, new TestMilitia(1, 0, 0), MilitiaRank.GREEN, 7)).toEqual({
      rank: MilitiaRank.GREEN,
      promotions: 2,
    });
    const moved = new TestMilitia(0, 1, 0);
    expect(checkOneMilitiaForPromotion(scripted([49]), moved, MilitiaRank.GREEN, 5)).toEqual({ rank: MilitiaRank.REGULAR, promotions: 1 });
    expect(moved.promoted).toEqual([MilitiaRank.REGULAR]);
  });

  it('picks random grid numbers on the visible world diamond', () => {
    expect(randomGridNo(scripted([0, 0, 80, 80]))).toBe(80 * 160 + 80);
  });

  it('keeps a merc who retreated alone in the battle sector after a victory (quirk Q15)', () => {
    const GROUP = 2;
    const ar = arState({
      mercs: [{ soldier: arSoldier(content, { life: 40 }), groupId: GROUP }],
      enemies: [{ soldier: enemySoldier(content, { life: 0 }) }],
    });
    const merc = ar.mercs[0];
    if (merc) merc.flags |= CellFlag.RETREATED;
    ar.status = BattleStatus.VICTORY;
    const p = port(new TestMilitia(0, 0, 0));
    const result = closeAutoresolve(arEnv(content), ar, p);
    expect(result.mercsAtCenter).toEqual([merc?.soldier]);
    expect(p.calls).toContain(`arrived:${GROUP}:true`);
  });

  it('captures the mercs who retreated as well (quirk Q19)', () => {
    const retreated = arSoldier(content, { life: 30, lifeMax: 60 });
    const unconscious = arSoldier(content, { life: 10, lifeMax: 60 });
    const ar = arState({
      mercs: [{ soldier: retreated }, { soldier: unconscious }],
      enemies: Array.from({ length: 4 }, () => ({ soldier: enemySoldier(content) })),
    });
    const cell = ar.mercs[0];
    if (cell) cell.flags |= CellFlag.RETREATED;
    const env = arEnv(content, { pre: scripted([1]), world: { day: 4 } });
    expect(attemptPlayerCapture(env, ar)).toBe(true);
    expect(ar.pendingSurrender).toBe(true);
    answerSurrender(env, ar, true);
    expect(ar.status).toBe(BattleStatus.SURRENDERED);
    expect(closeAutoresolve(env, ar, port(new TestMilitia(0, 0, 0))).mercsCaptured).toEqual([retreated, unconscious]);
  });

  it('reports captured mercs and ends the capture sequence', () => {
    const ar = arState({ mercs: [{ soldier: arSoldier(content, { life: 10 }) }, { soldier: arSoldier(content, { life: 20 }) }] });
    ar.status = BattleStatus.CAPTURED;
    const outcome = endOfBattle(ar);
    expect(outcome?.mercsCaptured).toHaveLength(2);
    const p = port(new TestMilitia(0, 0, 0));
    expect(closeAutoresolve(arEnv(content), ar, p).mercsCaptured).toHaveLength(2);
    expect(p.calls).toEqual(['mercCaptured', 'mercCaptured', 'endCapture', 'resetMovement']);
  });

  it('counts the battle in the profile of every merc of it, dead or alive', () => {
    const profiles = new Map([
      [3, progressFor(3, { battlesFought: 2 })],
      [4, progressFor(4)],
    ]);
    const ar = arState({
      mercs: [{ soldier: arSoldier(content, { profile: 3, life: 0 }) }, { soldier: arSoldier(content, { profile: 4, life: 30 }) }],
    });
    ar.status = BattleStatus.VICTORY;
    closeAutoresolve(arEnv(content, { profiles, main: scripted([80, 80, 0]) }), ar, port(new TestMilitia(0, 0, 0)));
    expect([profiles.get(3)?.battlesFought, profiles.get(4)?.battlesFought]).toEqual([3, 1]);
  });

  it('ignores militia soldiers of non-militia classes', () => {
    const ar = arState({ mercs: [], militia: [militiaSoldier(content, { soldierClass: SoldierClass.NONE, life: 1 })] });
    ar.status = BattleStatus.VICTORY;
    expect(closeAutoresolve(arEnv(content), ar, port(new TestMilitia(1, 0, 0))).militiaDied).toEqual([]);
  });
});

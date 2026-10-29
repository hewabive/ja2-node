import { beforeAll, describe, expect, it } from 'vitest';
import { arSoldier, arState, enemySoldier, militiaSoldier, scripted } from '../../../../../tests/support/autoresolve.ts';
import { loadTestContent } from '../../../../../tests/support/tactical.ts';
import type { TacticalContent } from '../../../tactical/content.ts';
import { Body } from '../../../tactical/soldier.ts';
import { EncounterCode } from '../constants.ts';
import { calculateAttackValues, determineTeamLeaders, resetNextAttackCounter } from './ratings.ts';
import { CellFlag } from './state.ts';

let content: TacticalContent;

beforeAll(async () => {
  content = await loadTestContent();
});

const strong = { strength: 80, dexterity: 80, wisdom: 80, marksmanship: 80, morale: 50, breathMax: 100, agility: 80, medical: 30 };

describe('resetNextAttackCounter', () => {
  it('waits 1000 + 5·min(1000 − attack, 800) + pre(2000 − attack) ms', () => {
    const ar = arState({ mercs: [{ soldier: arSoldier(content) }] });
    const c = ar.mercs[0];
    if (!c) throw new Error('no cell');
    c.attack = 600;
    const pre = scripted([0]);
    resetNextAttackCounter(pre, c);
    expect(c.nextAttack).toBe(3000);
    expect(pre.requested).toEqual([1400]);
    c.attack = 1000;
    resetNextAttackCounter(scripted([999]), c);
    expect(c.nextAttack).toBe(1999);
    c.attack = 0;
    resetNextAttackCounter(scripted([1999]), c);
    expect(c.nextAttack).toBe(6999);
  });

  it('shortens creature timers to 8/10', () => {
    const ar = arState({
      encounter: EncounterCode.CREATURE_ATTACK,
      mercs: [{ soldier: arSoldier(content) }],
      enemies: [{ soldier: enemySoldier(content, { body: Body.YAM_MONSTER, gun: null }) }],
    });
    const c = ar.enemies[0];
    if (!c) throw new Error('no cell');
    expect(c.flags).toBe(CellFlag.YM_CREATURE);
    c.attack = 600;
    resetNextAttackCounter(scripted([7]), c);
    expect(c.nextAttack).toBe(Math.trunc((3007 * 8) / 10));
  });
});

describe('calculateAttackValues', () => {
  it('rates a merc and a militiaman like a worked example', () => {
    const merc = arSoldier(content, { ...strong, leadership: 80 });
    const militia = militiaSoldier(content, { ...strong, breath: 50, leadership: 10 });
    const ar = arState({ encounter: EncounterCode.ENEMY_ENCOUNTER, mercs: [{ soldier: merc }], militia: [militia] });
    determineTeamLeaders(ar);
    expect(ar.playerLeadership).toBe(80);
    expect(ar.mercs[0]?.flags).toBe(CellFlag.MERC | CellFlag.TEAMLEADER);
    calculateAttackValues(scripted([], 0), ar);
    expect(ar.mercs[0]?.attack).toBe(679);
    expect(ar.mercs[0]?.defence).toBe(438);
    expect(ar.militia[0]?.attack).toBe(238);
    expect(ar.playerAttack).toBe(679 + 238);
    expect(ar.playerDefence).toBe(438 + (ar.militia[0]?.defence ?? 0));
  });

  it('gives EPCs attack 0 and defence 1000, so they draw fire (quirk Q18)', () => {
    const ar = arState({
      encounter: EncounterCode.ENEMY_ENCOUNTER,
      mercs: [
        { soldier: arSoldier(content, { strength: 100, dexterity: 100, wisdom: 100, marksmanship: 100, morale: 100, leadership: 100 }) },
        { soldier: arSoldier(content), epc: true },
      ],
    });
    determineTeamLeaders(ar);
    calculateAttackValues(scripted([], 0), ar);
    expect(ar.mercs[0]?.attack).toBe(Math.trunc((625 * 131) / 100));
    expect(ar.mercs[1]?.attack).toBe(0);
    expect(ar.mercs[1]?.defence).toBe(1000);
  });

  it('delays late entries, militia by (i − 4)·2000 from the eighth on (quirk Q6), gives a 60 % head start and wraps an unrated dead merc', () => {
    const mercs = Array.from({ length: 10 }, (_, i) => ({ soldier: arSoldier(content, { life: i === 3 ? 0 : 60 }) }));
    const militia = Array.from({ length: 8 }, () => militiaSoldier(content));
    const enemies = Array.from({ length: 6 }, () => ({ soldier: enemySoldier(content) }));
    const ar = arState({ mercs, militia, enemies });
    determineTeamLeaders(ar);
    const timers = (cells: readonly { attack: number }[]) => cells.map((c) => 1000 + Math.min(1000 - c.attack, 800) * 5);
    const pre = scripted([], 0);
    calculateAttackValues(pre, ar);
    expect(pre.requested).toHaveLength(9 + 8 + 6);
    const raw = {
      mercs: timers(ar.mercs).map((t, i) => (i === 9 ? t + 2000 : t)),
      militia: timers(ar.militia).map((t, i) => (i === 7 ? t + 6000 : t)),
      enemies: timers(ar.enemies).map((t, i) => (i === 5 ? t + 1000 : t)),
    };
    const rated = [...raw.mercs.filter((_, i) => i !== 3), ...raw.militia, ...raw.enemies];
    const headStart = Math.trunc((Math.min(...rated) * 60) / 100);
    expect(ar.mercs[9]?.nextAttack).toBe((raw.mercs[9] ?? 0) - headStart);
    expect(ar.militia[7]?.nextAttack).toBe((raw.militia[7] ?? 0) - headStart);
    expect(ar.enemies[5]?.nextAttack).toBe((raw.enemies[5] ?? 0) - headStart);
    expect(ar.mercs[3]?.nextAttack).toBe(0x10000 - headStart);
    expect(ar.mercs[3]?.attack).toBe(0);
  });

  it('gives creatures no late-entry delay', () => {
    const enemies = Array.from({ length: 6 }, () => ({ soldier: enemySoldier(content, { body: Body.ADULTFEMALEMONSTER, gun: null }) }));
    const ar = arState({ encounter: EncounterCode.CREATURE_ATTACK, mercs: [{ soldier: arSoldier(content) }], enemies });
    calculateAttackValues(scripted([], 0), ar);
    expect(ar.enemies[5]?.nextAttack).toBe(ar.enemies[4]?.nextAttack);
  });
});

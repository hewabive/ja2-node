import { beforeAll, describe, expect, it } from 'vitest';
import { newCombatSim, runUntilIdle, spawnSoldier } from '../../../tests/support/combat.ts';
import { loadTestContent, loadTestTimelines } from '../../../tests/support/tactical.ts';
import type { PresentationTimeline } from '../../content/anim/timelines.ts';
import { Direction, gridNo } from '../../content/world/grid.ts';
import type { SimEvent } from '../events.ts';
import { createItem, createMoney } from '../items/object.ts';
import { AiAction } from './ai/actions.ts';
import { checkBleeding } from './combat/bleeding.ts';
import { soldierTakeDamage } from './combat/hit.ts';
import { DamageReason, WeaponMode } from './combat/types.ts';
import type { TacticalContent } from './content.ts';
import { LIFELESS_HEALTH_INDEX } from './health.ts';
import { InvSlot } from './inventory.ts';
import { Team } from './soldier.ts';
import type { OwnSoldierSnapshot, TacticalSim } from './tactical-sim.ts';
import { addToIntList, doneAddingToIntList } from './turns/turns.ts';
import { addItemToPool, Visibility } from './world-items.ts';

let content: TacticalContent;
let presentation: PresentationTimeline;

beforeAll(async () => {
  content = await loadTestContent();
  presentation = (await loadTestTimelines()).presentation;
});

function item(name: string): number {
  const def = content.items.byName.get(name);
  if (!def) throw new Error(`no item ${name}`);
  return def.index;
}

function shown(sim: TacticalSim, id: number): OwnSoldierSnapshot {
  const entry = sim.snapshot(presentation, (s) => s.team === Team.OUR || s.visible >= 0).find((s) => s.id === id);
  if (!entry) throw new Error(`soldier ${id} is not in the view`);
  return entry;
}

function eventsOf<T extends SimEvent['type']>(events: readonly SimEvent[], type: T): Extract<SimEvent, { type: T }>[] {
  return events.filter((e): e is Extract<SimEvent, { type: T }> => e.type === type);
}

describe('own soldiers in the view (docs/28 §12.1 G1-G4, G7)', () => {
  it('carry the panel values the original computes and the animation schedule', () => {
    const sim = newCombatSim(content);
    const merc = spawnSoldier(sim, 0, Team.OUR, gridNo(80, 80), Direction.SOUTH, { profile: 3 });
    spawnSoldier(sim, 20, Team.ENEMY, gridNo(80, 92), Direction.WEST);
    merc.inv[InvSlot.VEST] = createItem(content.items, item('KEVLAR_VEST'), 100);
    merc.bleeding = 4;
    merc.camo = 30;
    merc.stealthMode = true;
    merc.morale = 63;
    merc.breathMax = 90;
    merc.weaponMode = WeaponMode.BURST;
    sim.lookAround();
    merc.blindedCounter = 2;
    const view = shown(sim, merc.id);
    expect(view).toMatchObject({
      profile: 3,
      bleeding: 4,
      breathMax: 90,
      morale: 63,
      camo: 30,
      stealth: true,
      weaponMode: 'burst',
      muted: false,
      blinded: true,
      canAct: true,
      firstAid: null,
      continueTo: null,
      stats: { agility: 70, dexterity: 70, strength: 70, leadership: 50, wisdom: 70, level: 3, marksmanship: 70, medical: 30 },
      frameSlot: merc.frameSlot,
      stateTick: merc.stateTick,
      frameDelay: merc.aniDelay,
    });
    expect(view.armour).toBeGreaterThan(0);
    expect(view.weight).toBeGreaterThan(0);
    expect(view.sees).toEqual([20]);
  });

  it('count only the hostile soldiers they see as opponents, not the neutral civilians', () => {
    const sim = newCombatSim(content);
    const merc = spawnSoldier(sim, 0, Team.OUR, gridNo(80, 80), Direction.SOUTH);
    spawnSoldier(sim, 20, Team.ENEMY, gridNo(80, 92), Direction.WEST);
    spawnSoldier(sim, 116, Team.CIV, gridNo(78, 88), Direction.WEST);
    sim.lookAround();
    const view = shown(sim, merc.id);
    expect(view.sees).toEqual([20, 116]);
    expect(view.opponents).toBe(1);
  });

  it('flags a jammed gun and names the imprint of a rocket rifle', () => {
    const sim = newCombatSim(content);
    const merc = spawnSoldier(sim, 0, Team.OUR, gridNo(80, 80), Direction.SOUTH);
    const hand = merc.inv[InvSlot.HAND];
    if (!hand) throw new Error('no hand item');
    hand.gunAmmoStatus = -10;
    const rifle = createItem(content.items, item('ROCKET_RIFLE'), 100);
    rifle.imprintId = 7;
    merc.inv[InvSlot.BIGPOCK1] = rifle;
    const inventory = shown(sim, merc.id).inventory ?? [];
    expect(inventory.find((i) => i.slot === InvSlot.HAND)).toMatchObject({ jammed: true });
    expect(inventory.find((i) => i.slot === InvSlot.BIGPOCK1)).toMatchObject({ imprint: 7 });
    expect(inventory.find((i) => i.slot === InvSlot.BIGPOCK1)?.jammed).toBeUndefined();
  });
});

describe('other soldiers in the view (G5)', () => {
  it('show hostility and the health word, never life', () => {
    const sim = newCombatSim(content);
    spawnSoldier(sim, 0, Team.OUR, gridNo(80, 80), Direction.SOUTH);
    const wounded = spawnSoldier(sim, 20, Team.ENEMY, gridNo(80, 92), Direction.WEST, { life: 40 });
    wounded.lifeMax = 80;
    spawnSoldier(sim, 116, Team.CIV, gridNo(78, 88), Direction.WEST);
    sim.lookAround();
    const enemy = shown(sim, 20);
    expect(enemy).toMatchObject({ hostile: true, healthIndex: 2 });
    expect(enemy.life).toBeUndefined();
    expect(enemy.stats).toBeUndefined();
    expect(shown(sim, 116).hostile).toBe(false);
  });

  it('mark a soldier whose life is gone while his death animation plays', () => {
    const sim = newCombatSim(content);
    spawnSoldier(sim, 0, Team.OUR, gridNo(80, 80), Direction.SOUTH);
    const enemy = spawnSoldier(sim, 20, Team.ENEMY, gridNo(80, 92), Direction.WEST);
    sim.lookAround();
    enemy.life = 0;
    expect(shown(sim, 20).healthIndex).toBe(LIFELESS_HEALTH_INDEX);
  });
});

describe('ground items in the view (G7)', () => {
  it('carry the money amount and the attachments', () => {
    const sim = newCombatSim(content);
    spawnSoldier(sim, 0, Team.OUR, gridNo(80, 80), Direction.SOUTH);
    addItemToPool(sim.state, gridNo(81, 80), createMoney(content.items, 350), Visibility.VISIBLE, 0);
    const gun = createItem(content.items, item('GLOCK_17'), 90);
    gun.attachments[0] = { item: item('SILENCER'), status: 80 };
    addItemToPool(sim.state, gridNo(82, 80), gun, Visibility.VISIBLE, 0);
    const items = sim.visibleItems();
    expect(items.find((i) => i.gridNo === gridNo(81, 80))).toMatchObject({ money: 350 });
    expect(items.find((i) => i.gridNo === gridNo(82, 80))).toMatchObject({ attachments: [{ item: 'SILENCER', status: 80 }] });
  });
});

describe('the combat block and the enemy turn (G6, events)', () => {
  it('names our turn, the enemy turn with its progress and the acting soldier', () => {
    const sim = newCombatSim(content);
    spawnSoldier(sim, 0, Team.OUR, gridNo(80, 80), Direction.SOUTH);
    spawnSoldier(sim, 20, Team.ENEMY, gridNo(80, 92), Direction.SOUTH);
    spawnSoldier(sim, 21, Team.ENEMY, gridNo(84, 92), Direction.SOUTH);
    sim.lookAround();
    sim.drainEvents();
    expect(sim.combatView()).toMatchObject({ team: Team.OUR, topMessage: { kind: 'playerTurn' }, ai: null, uiLocked: false });
    const seen: unknown[] = [];
    const t = sim.state;
    const start = t.turnHooks.startNPCAI;
    t.turnHooks = {
      ...t.turnHooks,
      startNPCAI: (state, s) => {
        start(state, s);
        seen.push(sim.combatView());
      },
    };
    sim.ai.green.decideActionBlack = () => AiAction.NONE;
    expect(sim.dispatch({ type: 'endTurn' }).ok).toBe(true);
    const events = runUntilIdle(sim);
    expect(seen[0]).toMatchObject({ team: Team.ENEMY, uiLocked: true, topMessage: { kind: 'computerTurn', team: Team.ENEMY } });
    expect(seen[0]).toMatchObject({ ai: { current: 0, total: 2 } });
    expect(eventsOf(events, 'enemyTurnProgress').map((e) => [e.done, e.total])).toEqual([
      [0, 2],
      [1, 2],
    ]);
    expect(eventsOf(events, 'aiTurn').map((e) => e.soldier)).toEqual([20, 21]);
    expect(sim.combatView()).toMatchObject({ team: Team.OUR, topMessage: { kind: 'playerTurn' } });
  });

  it('keeps a hidden AI interrupt hidden: the team, the top message, the refusals (rule finding 7)', () => {
    const sim = newCombatSim(content);
    const t = sim.state;
    const merc = spawnSoldier(sim, 0, Team.OUR, gridNo(80, 80), Direction.NORTH);
    spawnSoldier(sim, 1, Team.OUR, gridNo(82, 80), Direction.NORTH);
    const watcher = spawnSoldier(sim, 20, Team.ENEMY, gridNo(80, 60), Direction.EAST);
    watcher.stats.experience = 10;
    merc.stats.experience = 1;
    sim.lookAround();
    expect(t.turn.currentTeam).toBe(Team.OUR);
    const during: unknown[] = [];
    const start = t.turnHooks.startNPCAI;
    t.turnHooks = {
      ...t.turnHooks,
      startNPCAI: (state, s) => {
        start(state, s);
        during.push({
          hidden: t.turn.hiddenInterrupt,
          view: sim.combatView(),
          order: sim.dispatch({ type: 'stance', soldier: 1, stance: 'crouch' }),
        });
      },
    };
    sim.ai.green.decideActionBlack = () => AiAction.NONE;
    expect(sim.dispatch({ type: 'move', soldier: 0, to: gridNo(80, 70), mode: 'walk' }).ok).toBe(true);
    const events = runUntilIdle(sim);
    expect(during).toHaveLength(1);
    expect(during[0]).toMatchObject({
      hidden: true,
      view: { team: Team.OUR, topMessage: { kind: 'playerTurn', team: Team.OUR }, ai: null, uiLocked: true },
      order: { ok: false, data: { refusal: 'uiLocked' } },
    });
    expect(JSON.stringify(during[0])).not.toContain('not your turn');
    expect(eventsOf(events, 'aiTurn')).toEqual([]);
    expect(eventsOf(events, 'enemyTurnProgress')).toEqual([]);
  });

  it('names the merc an interrupt in our favour selects and shows the interrupt bar', () => {
    const sim = newCombatSim(content);
    const t = sim.state;
    spawnSoldier(sim, 0, Team.OUR, gridNo(80, 60), Direction.SOUTH);
    const second = spawnSoldier(sim, 1, Team.OUR, gridNo(82, 60), Direction.SOUTH);
    const mover = spawnSoldier(sim, 20, Team.ENEMY, gridNo(80, 72), Direction.EAST);
    sim.lookAround();
    sim.drainEvents();
    t.turn.currentTeam = Team.ENEMY;
    addToIntList(t, mover, false);
    addToIntList(t, second, true);
    doneAddingToIntList(t);
    expect(eventsOf(sim.drainEvents(), 'interrupt')).toMatchObject([{ team: Team.OUR, selected: 1 }]);
    expect(sim.combatView()).toMatchObject({ team: Team.OUR, interrupt: true, topMessage: { kind: 'playerInterrupt' } });
  });
});

describe('life deductions (lifeLost)', () => {
  it('reports the life a visible soldier actually loses, bleeding included', () => {
    const sim = newCombatSim(content);
    const merc = spawnSoldier(sim, 0, Team.OUR, gridNo(80, 80), Direction.SOUTH, { life: 30 });
    const hidden = spawnSoldier(sim, 20, Team.ENEMY, gridNo(80, 150), Direction.WEST, { life: 30 });
    sim.drainEvents();
    soldierTakeDamage(sim.state, merc, 50, 0, DamageReason.GUNFIRE, null);
    soldierTakeDamage(sim.state, hidden, 5, 0, DamageReason.GUNFIRE, null);
    expect(eventsOf(sim.drainEvents(), 'lifeLost')).toMatchObject([{ soldier: 0, amount: 30 }]);
    const bleeder = spawnSoldier(sim, 1, Team.OUR, gridNo(82, 80), Direction.SOUTH, { life: 60 });
    bleeder.bleeding = 20;
    bleeder.nextBleed = 0;
    checkBleeding(sim.state, bleeder);
    expect(eventsOf(sim.drainEvents(), 'lifeLost')).toMatchObject([{ soldier: 1, amount: 1 }]);
  });
});

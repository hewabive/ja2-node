import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { newCombatSim, runUntilIdle, spawnSoldier } from '../../../tests/support/combat.ts';
import { loadTestContent, loadTestTimelines } from '../../../tests/support/tactical.ts';
import { addStubTank } from '../../../tests/support/vehicles.ts';
import { SubAnimFlags } from '../../content/anim/surface-choice.ts';
import type { PresentationTimeline } from '../../content/anim/timelines.ts';
import { Orientation } from '../../content/formats/jsd.ts';
import type { MercProfile } from '../../content/formats/prof.ts';
import { parseStubProfiles, STUB_PROFILES_PATH } from '../../content/formats/stub-profiles.ts';
import { Direction, gridNo } from '../../content/world/grid.ts';
import { StructureFlags } from '../../content/world/structures.ts';
import { syntheticStructure } from '../../content/world/synthetic.ts';
import { Terrain } from '../../content/world/terrain.ts';
import type { SimEvent } from '../events.ts';
import { createItem, createMoney } from '../items/object.ts';
import { AiAction } from './ai/actions.ts';
import { anim } from './anim-states.ts';
import { states } from './animation.ts';
import { minAPsToAttack } from './combat/ap.ts';
import { checkBleeding } from './combat/bleeding.ts';
import { soldierTakeDamage } from './combat/hit.ts';
import { DamageReason, WeaponMode } from './combat/types.ts';
import type { TacticalContent } from './content.ts';
import { LIFELESS_HEALTH_INDEX } from './health.ts';
import { InvSlot } from './inventory.ts';
import { setSoldierPosition } from './movement.ts';
import { apsToClimbRoof, setSoldierHeight } from './roofs.ts';
import { Body, Team, Visible } from './soldier.ts';
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

describe('own soldiers in the view', () => {
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

  it('carry the climb button inputs: the roof edge next to them with the APs to climb it, and a fence to jump (UpdateSMPanel)', () => {
    const roofs = new Set<number>();
    for (let x = 85; x <= 90; x++) for (let y = 78; y <= 82; y++) roofs.add(gridNo(x, y));
    const fence = gridNo(80, 71);
    const sim = newCombatSim(content, [], 3, roofs, (world) =>
      world.structures.add(fence, 0, syntheticStructure(StructureFlags.FENCE, Orientation.NONE, { height: 1 })),
    );
    const t = sim.state;
    const below = spawnSoldier(sim, 0, Team.OUR, gridNo(84, 80), Direction.NORTH);
    const above = spawnSoldier(sim, 1, Team.OUR, gridNo(86, 80), Direction.NORTH);
    setSoldierHeight(t, above, 50);
    const byTheFence = spawnSoldier(sim, 2, Team.OUR, gridNo(80, 72), Direction.SOUTH);
    const inTheOpen = spawnSoldier(sim, 3, Team.OUR, gridNo(70, 70), Direction.SOUTH);
    spawnSoldier(sim, 20, Team.ENEMY, gridNo(40, 40), Direction.SOUTH);
    expect(shown(sim, below.id).climb).toEqual({ roof: 'up', enoughAp: true, fence: false });
    expect(shown(sim, above.id).climb).toEqual({ roof: null, enoughAp: false, fence: false });
    expect(shown(sim, byTheFence.id).climb).toEqual({ roof: null, enoughAp: false, fence: true });
    expect(shown(sim, inTheOpen.id).climb).toEqual({ roof: null, enoughAp: false, fence: false });
    setSoldierPosition(t, above, gridNo(85, 78));
    expect(shown(sim, above.id).climb).toEqual({ roof: 'down', enoughAp: true, fence: false });
    t.inCombat = true;
    below.actionPoints = apsToClimbRoof(t, below, false) - 1;
    above.actionPoints = apsToClimbRoof(t, above, true);
    byTheFence.actionPoints = 0;
    expect(shown(sim, below.id).climb).toEqual({ roof: 'up', enoughAp: false, fence: false });
    expect(shown(sim, above.id).climb).toEqual({ roof: 'down', enoughAp: true, fence: false });
    expect(shown(sim, byTheFence.id).climb).toEqual({ roof: null, enoughAp: false, fence: true });
  });

  it('carry whether they have the APs for the cheapest attack on their last target, leaving the ready charge as it is (PrintAP)', () => {
    const sim = newCombatSim(content);
    const t = sim.state;
    const merc = spawnSoldier(sim, 0, Team.OUR, gridNo(80, 80), Direction.SOUTH);
    const enemy = spawnSoldier(sim, 20, Team.ENEMY, gridNo(80, 92), Direction.WEST);
    sim.lookAround();
    expect(t.inCombat).toBe(true);
    merc.lastTarget = enemy.gridNo;
    merc.dontChargeReadyAPs = true;
    const minAPs = minAPsToAttack(t, merc, merc.lastTarget, true);
    merc.dontChargeReadyAPs = true;
    merc.actionPoints = minAPs;
    expect(shown(sim, merc.id).enoughApToAttack).toBe(true);
    merc.actionPoints = minAPs - 1;
    expect(shown(sim, merc.id).enoughApToAttack).toBe(false);
    expect(merc.dontChargeReadyAPs).toBe(true);
  });

  it('carry the final destination of a move and a hit animation playing, which the face highlights read', () => {
    const sim = newCombatSim(content);
    const merc = spawnSoldier(sim, 0, Team.OUR, gridNo(80, 80), Direction.SOUTH);
    expect(shown(sim, merc.id)).toMatchObject({ destination: merc.gridNo, gettingHit: false });
    const target = gridNo(80, 86);
    expect(sim.dispatch({ type: 'move', soldier: merc.id, to: target })).toEqual({ ok: true });
    sim.step();
    const walking = shown(sim, merc.id);
    expect(walking.destination).toBe(target);
    expect(walking.gridNo).not.toBe(target);
    runUntilIdle(sim);
    expect(shown(sim, merc.id)).toMatchObject({ gridNo: target, destination: target });
    merc.gettingHit = 1;
    expect(shown(sim, merc.id).gettingHit).toBe(true);
  });

  it('carry the drunk level and the adrenaline state behind the drug icons and the light blue AP number, never the counters', () => {
    const sim = newCombatSim(content);
    const merc = spawnSoldier(sim, 0, Team.OUR, gridNo(80, 80), Direction.SOUTH);
    const drugFields = () => {
      const { drunk, adrenaline } = shown(sim, merc.id);
      return { drunk, adrenaline };
    };
    expect(drugFields()).toEqual({ drunk: undefined, adrenaline: undefined });
    merc.drugs.alcohol.sideEffect = 10;
    merc.drugs.adrenaline.sideEffect = 20;
    expect(drugFields()).toEqual({ drunk: 'hungover', adrenaline: 'crash' });
    merc.drugs.alcohol.effect = 8;
    merc.drugs.adrenaline.effect = 4;
    expect(drugFields()).toEqual({ drunk: 'feelingGood', adrenaline: 'active' });
    merc.drugs.alcohol.effect = 32;
    expect(drugFields().drunk).toBe('borderline');
    merc.drugs.alcohol.effect = 40;
    expect(drugFields().drunk).toBe('drunk');
    expect(JSON.stringify(shown(sim, merc.id))).not.toMatch(/sideEffect|future|"rate"/);
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
    wounded.drugs.alcohol.effect = 40;
    wounded.drugs.adrenaline.effect = 4;
    expect(shown(sim, 20)).not.toHaveProperty('drunk');
    expect(shown(sim, 20)).not.toHaveProperty('adrenaline');
    expect(shown(sim, 116).hostile).toBe(false);
  });

  it('show a vehicle in sight with its life and fuel for the bars over it, and nothing of one out of sight (Interface.cc DrawSelectedUIAboveGuy)', () => {
    const sim = newCombatSim(content);
    spawnSoldier(sim, 0, Team.OUR, gridNo(80, 80), Direction.SOUTH);
    const seen = addStubTank(sim.state, { body: Body.TANK_NW, team: Team.ENEMY, gridNo: gridNo(80, 92), direction: Direction.NORTH });
    const behind = addStubTank(sim.state, { body: Body.TANK_NE, team: Team.ENEMY, gridNo: gridNo(80, 40), direction: Direction.SOUTH });
    Object.assign(seen, { life: 61, breath: 73 });
    sim.lookAround();
    const inSight = sim.snapshot(presentation, (s) => s.team === Team.OUR || s.visible >= 0);
    expect(shown(sim, seen.id)).toMatchObject({ life: 61, lifeMax: seen.lifeMax, breath: 73, breathMax: seen.breathMax });
    expect(inSight.some((s) => s.id === behind.id)).toBe(false);
  });

  it("show a tank's 32-step facing between two directions and that it is turning, neither once it faces where it turned", () => {
    const sim = newCombatSim(content);
    spawnSoldier(sim, 0, Team.OUR, gridNo(80, 80), Direction.SOUTH);
    const tank = addStubTank(sim.state, { body: Body.TANK_NW, team: Team.ENEMY, gridNo: gridNo(80, 92), direction: Direction.NORTH });
    const merc = spawnSoldier(sim, 21, Team.ENEMY, gridNo(78, 90), Direction.NORTH);
    sim.lookAround();
    expect(shown(sim, tank.id)).not.toHaveProperty('hiResDirection');
    expect(shown(sim, tank.id)).not.toHaveProperty('turning');
    Object.assign(tank, { desiredDirection: Direction.EAST, hiResDirection: 5, direction: Direction.NORTHEAST });
    Object.assign(merc, { desiredDirection: Direction.EAST });
    expect(shown(sim, tank.id)).toMatchObject({ direction: Direction.NORTHEAST, hiResDirection: 5, turning: true });
    expect(shown(sim, merc.id)).not.toHaveProperty('turning');
    Object.assign(tank, { hiResDirection: 8, direction: Direction.EAST });
    expect(shown(sim, tank.id)).not.toHaveProperty('hiResDirection');
    expect(shown(sim, tank.id)).not.toHaveProperty('turning');
  });

  it('mark a soldier whose life is gone while his death animation plays', () => {
    const sim = newCombatSim(content);
    spawnSoldier(sim, 0, Team.OUR, gridNo(80, 80), Direction.SOUTH);
    const enemy = spawnSoldier(sim, 20, Team.ENEMY, gridNo(80, 92), Direction.WEST);
    sim.lookAround();
    enemy.life = 0;
    expect(shown(sim, 20).healthIndex).toBe(LIFELESS_HEALTH_INDEX);
  });

  it('show the sheet the squad sees: in water, with two pistols, walking hurt, and a big man in his threatening stand', () => {
    const sim = newCombatSim(content);
    spawnSoldier(sim, 0, Team.OUR, gridNo(80, 80), Direction.SOUTH);
    const wading = spawnSoldier(sim, 20, Team.ENEMY, gridNo(80, 92), Direction.WEST);
    const twoPistols = spawnSoldier(sim, 21, Team.ENEMY, gridNo(78, 92), Direction.WEST);
    const launcher = spawnSoldier(sim, 22, Team.ENEMY, gridNo(76, 92), Direction.WEST);
    const hurt = spawnSoldier(sim, 23, Team.ENEMY, gridNo(82, 92), Direction.WEST, { life: 29, gun: 'M14' });
    const big = spawnSoldier(sim, 24, Team.ENEMY, gridNo(84, 92), Direction.WEST, { body: Body.BIGMALE, gun: 'M14' });
    sim.lookAround();
    for (const s of [wading, twoPistols, launcher, big]) s.state = states(content.animations).STANDING;
    hurt.state = states(content.animations).WALKING;
    wading.overTerrain = Terrain.LOW_WATER;
    twoPistols.inv[InvSlot.SECOND_HAND] = createItem(content.items, item('BERETTA_92F'), 100);
    launcher.inv[InvSlot.SECOND_HAND] = createItem(content.items, item('UNDER_GLAUNCHER'), 100);
    const sheet = (id: number) => content.animations.surfaces[shown(sim, id).surface]?.name;
    expect([20, 21, 22, 23, 24].map(sheet)).toEqual([
      'RGMWATER_N_STD',
      'RGMDBLBREATH',
      'RGMPISTOLBREATH',
      'RGMHURTWALKINGR',
      'BGMTHREATENSTAND',
    ]);
  });

  it("show a big man whose profile has the second shot flag aiming with the first big aim sheet (Grizzly's uiBodyTypeSubFlags)", () => {
    const json = JSON.parse(readFileSync(join(import.meta.dirname, '../../..', STUB_PROFILES_PATH), 'utf8'));
    const profiles = [...parseStubProfiles(json, (name) => content.items.byName.get(name)?.index)];
    const [flagged, unflagged] = profiles.flatMap((p) => (p ? [p.id] : []));
    if (flagged === undefined || unflagged === undefined) throw new Error('fewer than two stub profiles');
    profiles[flagged] = { ...(profiles[flagged] as MercProfile), bodyTypeSubFlags: SubAnimFlags.BIGGUY_SHOOT2 };
    const sim = newCombatSim({ ...content, profiles });
    spawnSoldier(sim, 0, Team.OUR, gridNo(80, 80), Direction.SOUTH);
    const big = { body: Body.BIGMALE, gun: 'M14' } as const;
    const grizzly = spawnSoldier(sim, 20, Team.ENEMY, gridNo(80, 92), Direction.WEST, { ...big, profile: flagged });
    const other = spawnSoldier(sim, 21, Team.ENEMY, gridNo(78, 92), Direction.WEST, { ...big, profile: unflagged });
    sim.lookAround();
    for (const s of [grizzly, other]) s.state = anim(content, 'AIM_RIFLE_STAND');
    expect([20, 21].map((id) => content.animations.surfaces[shown(sim, id).surface]?.name)).toEqual(['BGMSTANDAIM', 'BGMSTANDAIM2']);
  });

  it('show camouflage paint on ours and theirs', () => {
    const sim = newCombatSim(content);
    const merc = spawnSoldier(sim, 0, Team.OUR, gridNo(80, 80), Direction.SOUTH);
    const painted = spawnSoldier(sim, 20, Team.ENEMY, gridNo(80, 92), Direction.WEST);
    spawnSoldier(sim, 21, Team.ENEMY, gridNo(78, 92), Direction.WEST);
    merc.camo = 2;
    painted.camo = 100;
    sim.lookAround();
    expect([0, 20, 21].map((id) => shown(sim, id).camouflaged)).toEqual([true, true, undefined]);
  });

  it("show the queen's spit aimed from two tiles east of her: a target to her north-east gets the north-west sheet", () => {
    const sim = newCombatSim(content);
    spawnSoldier(sim, 0, Team.OUR, gridNo(80, 80), Direction.SOUTH);
    const queen = spawnSoldier(sim, 52, Team.CREATURE, gridNo(80, 90), Direction.SOUTH, { body: Body.QUEENMONSTER });
    sim.lookAround();
    queen.state = anim(content, 'QUEEN_SPIT');
    queen.targetGridNo = gridNo(81, 89);
    expect(content.animations.surfaces[shown(sim, 52).surface]?.name).toBe('QUEENMONSTERSPIT_NE');
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

  it('names the merc an interrupt in our favour selects, the seen soldier it stops, and shows the interrupt bar', () => {
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
    expect(mover.visible).not.toBe(Visible.HIDDEN);
    expect(eventsOf(sim.drainEvents(), 'interrupt')).toMatchObject([{ team: Team.OUR, selected: 1, interrupted: mover.id }]);
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

  it('shows the deductions added up since the number last faded, not the life lost: a dying enemy the bleeding kills shows 1 (Soldier_Control.cc:5636, :5697)', () => {
    const sim = newCombatSim(content);
    const merc = spawnSoldier(sim, 0, Team.OUR, gridNo(80, 80), Direction.SOUTH, { life: 30 });
    const dying = spawnSoldier(sim, 20, Team.ENEMY, gridNo(80, 84), Direction.NORTH, { life: 12 });
    sim.lookAround();
    sim.drainEvents();
    soldierTakeDamage(sim.state, merc, 50, 0, DamageReason.GUNFIRE, null);
    soldierTakeDamage(sim.state, dying, 1, 0, DamageReason.BLOODLOSS, null);
    expect(dying.life).toBe(0);
    expect(eventsOf(sim.drainEvents(), 'lifeLost')).toEqual([
      expect.objectContaining({ soldier: 0, amount: 30, shown: 50 }),
      expect.objectContaining({ soldier: 20, amount: 12, shown: 1 }),
    ]);
  });

  it('adds the damage a soldier took out of sight to the number his next seen hit shows (Soldier_Control.cc:5636)', () => {
    const sim = newCombatSim(content);
    spawnSoldier(sim, 0, Team.OUR, gridNo(80, 80), Direction.SOUTH);
    const enemy = spawnSoldier(sim, 20, Team.ENEMY, gridNo(80, 150), Direction.WEST, { life: 60 });
    sim.drainEvents();
    soldierTakeDamage(sim.state, enemy, 5, 0, DamageReason.GUNFIRE, null);
    expect(eventsOf(sim.drainEvents(), 'lifeLost')).toEqual([]);
    enemy.visible = Visible.SEEN;
    soldierTakeDamage(sim.state, enemy, 3, 0, DamageReason.GUNFIRE, null);
    expect(eventsOf(sim.drainEvents(), 'lifeLost')).toEqual([expect.objectContaining({ soldier: 20, amount: 3, shown: 8 })]);
  });
});

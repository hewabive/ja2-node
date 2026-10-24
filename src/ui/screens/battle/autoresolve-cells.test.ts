import { describe, expect, it } from 'vitest';
import { KEY_TEXT } from '../../../../tests/support/map-screen.ts';
import { FontColor } from '../../../content/text/font-colors.ts';
import type { AutoresolveCellView, AutoresolveView } from '../../../protocol/view.ts';
import { DrawList, rgb } from '../../draw-list.ts';
import { cellFace, cellStatus, displayCell, drawCellBars, flashAfterRender, GenericFace, HIT_FLASH_MS } from './autoresolve-cells.ts';
import { ArPlayback, applyEvent, displayState, sliceDurationMs, speedPercent } from './autoresolve-playback.ts';
import { autoresolveSounds, soundMemory } from './autoresolve-sounds.ts';

const merc = (fields: Partial<AutoresolveCellView> = {}): AutoresolveCellView => ({
  side: 'merc',
  index: 0,
  kind: 'Ivan',
  state: 'alive',
  soldier: 3,
  name: 'Ivan',
  profile: 7,
  life: 80,
  lifeMax: 80,
  bleeding: 0,
  breathMax: 100,
  morale: 60,
  ...fields,
});

const other = (side: 'militia' | 'enemy', kind: string, fields: Partial<AutoresolveCellView> = {}): AutoresolveCellView => ({
  side,
  index: 0,
  kind,
  state: 'alive',
  health: 'excellent',
  hurt: false,
  ...fields,
});

describe('the autoresolve cell faces', () => {
  it('picks the generic face of each militia rank, enemy class and creature, the female faces and the skulls', () => {
    expect(cellFace(merc())).toEqual({ kind: 'merc', profile: 7 });
    expect(cellFace(other('militia', 'regular'))).toEqual({ kind: 'generic', frame: GenericFace.MILITIA2 });
    expect(cellFace(other('militia', 'elite', { female: true }))).toEqual({ kind: 'generic', frame: GenericFace.MILITIA3F });
    expect(cellFace(other('enemy', 'admin'))).toEqual({ kind: 'generic', frame: GenericFace.ADMIN });
    expect(cellFace(other('enemy', 'troop', { female: true }))).toEqual({ kind: 'generic', frame: GenericFace.ELITEF });
    expect(cellFace(other('enemy', 'youngMaleCreature'))).toEqual({ kind: 'generic', frame: GenericFace.YM_CREATURE });
    expect(cellFace(merc({ state: 'dead' }))).toEqual({ kind: 'generic', frame: GenericFace.HUMAN_SKULL });
    expect(cellFace(other('enemy', 'adultFemaleCreature', { state: 'dead' }))).toEqual({
      kind: 'generic',
      frame: GenericFace.CREATURE_SKULL,
    });
  });
});

describe('the autoresolve cell status', () => {
  it('prints the health word in the colour of RenderSoldierCellHealth', () => {
    expect(cellStatus(KEY_TEXT, merc(), 'inProgress', 0)).toEqual({ text: 'zHealthStr[5]', colour: FontColor.GRAY1 });
    expect(cellStatus(KEY_TEXT, merc({ life: 70 }), 'inProgress', 0)).toEqual({ text: 'zHealthStr[4]', colour: FontColor.YELLOW });
    expect(cellStatus(KEY_TEXT, merc({ life: 40 }), 'inProgress', 0)).toEqual({ text: 'zHealthStr[2]', colour: FontColor.YELLOW });
    expect(cellStatus(KEY_TEXT, merc({ life: 20 }), 'inProgress', 0)).toEqual({ text: 'zHealthStr[1]', colour: FontColor.RED });
    expect(cellStatus(KEY_TEXT, other('enemy', 'elite', { health: 'good', hurt: true }), 'inProgress', 0)).toEqual({
      text: 'zHealthStr[5]',
      colour: FontColor.YELLOW,
    });
    expect(cellStatus(KEY_TEXT, other('enemy', 'elite', { health: 'fair' }), 'inProgress', 0).colour).toBe(FontColor.GRAY1);
  });

  it('names the dead in black and shows RETREATED, and RETREATING every 450 of 900 ms', () => {
    expect(cellStatus(KEY_TEXT, merc({ state: 'dead', life: 0 }), 'inProgress', 0)).toEqual({ text: 'Ivan', colour: FontColor.BLACK });
    expect(cellStatus(KEY_TEXT, other('militia', 'green', { state: 'dead' }), 'defeat', 0).text).toBe('gpStrategicString[16]');
    expect(cellStatus(KEY_TEXT, other('enemy', 'troop', { state: 'dead' }), 'victory', 0).text).toBe('gpStrategicString[18]');
    expect(cellStatus(KEY_TEXT, merc({ state: 'retreated' }), 'retreat', 0)).toEqual({
      text: 'gpStrategicString[22]',
      colour: FontColor.LTGREEN,
    });
    expect(cellStatus(KEY_TEXT, merc({ state: 'retreated' }), 'victory', 0).text).toBe('zHealthStr[5]');
    expect(cellStatus(KEY_TEXT, merc({ state: 'retreating' }), 'inProgress', 449)).toEqual({
      text: 'gpStrategicString[23]',
      colour: FontColor.LTRED,
    });
    expect(cellStatus(KEY_TEXT, merc({ state: 'retreating' }), 'inProgress', 450).text).toBe('zHealthStr[5]');
  });

  it('draws the bars in the code colours and nothing for the dead', () => {
    const list = new DrawList();
    drawCellBars(list, merc({ life: 40, lifeMax: 80, bleeding: 20, breathMax: 100, morale: 60 }), 100, 50);
    expect(list.items.map((i) => (i.kind === 'fill' ? [i.x, i.y, i.width, i.height, i.color] : null))).toEqual([
      [137, 59, 1, 20, rgb(107, 107, 57)],
      [138, 59, 1, 20, rgb(222, 181, 115)],
      [137, 64, 1, 15, rgb(156, 57, 57)],
      [138, 64, 1, 15, rgb(222, 132, 132)],
      [137, 69, 1, 10, rgb(107, 8, 8)],
      [138, 69, 1, 10, rgb(206, 0, 0)],
      [141, 54, 1, 25, rgb(8, 8, 132)],
      [142, 54, 1, 25, rgb(8, 8, 107)],
      [145, 64, 1, 15, rgb(8, 156, 8)],
      [146, 64, 1, 15, rgb(8, 107, 8)],
    ]);
    const dead = new DrawList();
    drawCellBars(dead, merc({ state: 'dead', life: 0 }), 0, 0);
    expect(dead.items).toEqual([]);
  });

  it('flashes white for one frame, then black with the red face for 150 ms', () => {
    const hit = { ...displayCell(merc()), flash: 'white' as const };
    const red = flashAfterRender(hit, 1000);
    expect(red).toMatchObject({ flash: 'red', flashUntil: 1000 + HIT_FLASH_MS });
    expect(flashAfterRender(red, 1100).flash).toBe('red');
    expect(flashAfterRender(red, 1151).flash).toBe('none');
  });
});

const VIEW: AutoresolveView = {
  sector: 'D13',
  encounter: 'enemyInvasion',
  status: 'inProgress',
  battleSeconds: 0,
  alive: { mercs: 1, militia: 0, enemies: 1 },
  cells: [merc(), other('enemy', 'troop')],
};

describe('the autoresolve playback', () => {
  it('applies hits, falls, deaths and the end to the shown cells', () => {
    let state = displayState(VIEW, null);
    state = applyEvent(state, { type: 'arHit', tick: 0, battleMs: 1000, target: { side: 'enemy', index: 0 }, health: 'poor' });
    expect(state.cells[1]).toMatchObject({ health: 'poor', hurt: true, flash: 'white' });
    state = applyEvent(state, { type: 'arDied', tick: 0, battleMs: 1000, cell: { side: 'enemy', index: 0 }, killer: null });
    expect(state.cells[1]?.state).toBe('dead');
    expect(state.alive).toEqual({ mercs: 1, militia: 0, enemies: 0 });
    state = applyEvent(state, { type: 'arBattleOver', tick: 0, battleMs: 1000, status: 'victory' });
    expect(state.status).toBe('victory');
  });

  it('spreads a slice over a second at Play, a quarter at Fast and nothing at Finish, then settles on the view', () => {
    expect(speedPercent('play', 88)).toBe(88);
    expect(speedPercent('fast', 88)).toBe(400);
    const entry = {
      events: [{ type: 'arMiss', tick: 0, battleMs: 1000, target: { side: 'merc', index: 0 } }] as never,
      view: null,
      prompt: null,
    };
    expect(sliceDurationMs(entry, 100)).toBe(1000);
    expect(sliceDurationMs(entry, 400)).toBe(250);
    expect(sliceDurationMs(entry, Number.POSITIVE_INFINITY)).toBe(0);
    const playback = new ArPlayback(VIEW, null);
    const settled = { ...VIEW, battleSeconds: 1, cells: [merc({ life: 70 }), other('enemy', 'troop')] };
    playback.push({
      tick: 200,
      changed: [],
      removed: [],
      autoresolve: settled,
      events: [
        { type: 'arHit', tick: 200, battleMs: 1000, target: { side: 'merc', index: 0 }, damage: 10, life: 70 },
        { type: 'arMiss', tick: 200, battleMs: 1000, target: { side: 'enemy', index: 0 } },
      ],
    });
    const released: string[] = [];
    playback.advance(400, 100, (e) => released.push(e.type));
    expect(released).toEqual([]);
    playback.advance(200, 100, (e) => released.push(e.type));
    expect(released).toEqual(['arHit']);
    expect(playback.state.cells[0]?.life).toBe(70);
    expect(playback.state.battleSeconds).toBe(0);
    playback.advance(500, 100, (e) => released.push(e.type));
    expect(released).toEqual(['arHit', 'arMiss']);
    expect(playback.state.battleSeconds).toBe(1);
    expect(playback.pending).toBe(0);
  });
});

describe('the autoresolve sounds', () => {
  const ctx = { encounter: 'enemyInvasion', random: () => 0, voiceOf: () => 12 };

  it('plays the weapon with its reload, the impact variants, the knife miss and the merc death crunches', () => {
    const state = displayState(VIEW, null);
    const memory = soundMemory();
    const play = (e: Parameters<typeof autoresolveSounds>[0]) => autoresolveSounds(e, state, ctx, memory).map((o) => o.request);
    expect(
      play({
        type: 'arAttack',
        tick: 0,
        battleMs: 0,
        attacker: { side: 'enemy', index: 0 },
        target: { side: 'merc', index: 0 },
        kind: 'shot',
        weapon: 5,
        reloaded: true,
      }),
    ).toEqual([{ kind: 'weapon', item: 5, reloaded: true }]);
    expect(play({ type: 'arSound', tick: 0, battleMs: 0, sound: 'impact', variant: 2 })).toEqual([
      { kind: 'effect', name: 'BULLET_IMPACT_3', loud: false },
    ]);
    expect(play({ type: 'arSound', tick: 0, battleMs: 0, sound: 'claw', variant: 49 })).toEqual([
      { kind: 'effect', name: 'ACR_SWIPE', loud: false },
    ]);
    expect(play({ type: 'arSound', tick: 0, battleMs: 0, sound: 'claw', variant: 50 })).toEqual([
      { kind: 'effect', name: 'ACR_LUNGE', loud: false },
    ]);
    play({
      type: 'arAttack',
      tick: 0,
      battleMs: 0,
      attacker: { side: 'merc', index: 0 },
      target: { side: 'enemy', index: 0 },
      kind: 'knife',
    });
    expect(play({ type: 'arMiss', tick: 0, battleMs: 0, target: { side: 'enemy', index: 0 } })).toEqual([
      { kind: 'effect', name: 'MISS_KNIFE', loud: false },
    ]);
    expect(play({ type: 'arMiss', tick: 0, battleMs: 0, target: { side: 'enemy', index: 0 } })).toEqual([]);
    expect(play({ type: 'arHit', tick: 0, battleMs: 0, target: { side: 'merc', index: 0 }, damage: 10, life: 70 })).toEqual([
      { kind: 'voice', sound: 'HIT1', voice: { profile: 12, generic: 0, bodyType: 0 } },
    ]);
    expect(play({ type: 'arDied', tick: 0, battleMs: 0, cell: { side: 'merc', index: 0 }, killer: null, splat: true })).toEqual([
      { kind: 'effect', name: 'DOORCR_1', loud: true },
      { kind: 'effect', name: 'HEADCR_1', loud: true },
      { kind: 'effect', name: 'HEADSPLAT_1', loud: false },
    ]);
  });

  it('laughs with the first live enemy at a defeat even after Finish', () => {
    const state = displayState(VIEW, null);
    const out = autoresolveSounds({ type: 'arBattleOver', tick: 0, battleMs: 0, status: 'defeat' }, state, ctx, soundMemory());
    expect(out).toEqual([
      { request: { kind: 'voice', sound: 'LAUGH1', voice: { profile: null, generic: 0, bodyType: 0 } }, ungated: true },
    ]);
    const eat = autoresolveSounds(
      { type: 'arBattleOver', tick: 0, battleMs: 0, status: 'defeat' },
      state,
      { ...ctx, encounter: 'creatureAttack' },
      soundMemory(),
    );
    expect(eat).toEqual([{ request: { kind: 'effect', name: 'ACR_EATFLESH', loud: false }, ungated: true }]);
  });
});

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { buildStubAnimationScripts } from '../../stubs/anim-scripts.ts';
import { FakeGraph, pcmWav, settle } from '../../tests/support/fake-audio.ts';
import { ANIM_CONTROL_PATH, ANIM_SURFACES_PATH, type AnimationTables, parseAnimationTables, stateId } from '../content/anim/tables.ts';
import type { Cue } from '../content/audio/cue.ts';
import { type CueBook, loadCueBook } from '../content/audio/cue-book.ts';
import { AmbientTime } from '../content/formats/ambient.ts';
import { type AnimationScripts, MAX_FRAMES_PER_ANIM, parseAnimationScripts } from '../content/formats/ja2bin.ts';
import { PROJECT_DATA_DIR } from '../node/repo.ts';
import type { SoldierView, ViewFrame } from '../protocol/view.ts';
import { CATCH_UP_TICKS, SoundDirector, type SoundWorld } from './director.ts';
import { AudioEngine } from './engine.ts';

let book: CueBook;
let tables: AnimationTables;
let scripts: AnimationScripts;
const G = 80 * 160 + 80;

beforeAll(async () => {
  book = await loadCueBook((path) => readFile(join(PROJECT_DATA_DIR, path)));
  const json = async (p: string) => JSON.parse(await readFile(join(PROJECT_DATA_DIR, p), 'utf8'));
  tables = parseAnimationTables(await json(ANIM_CONTROL_PATH), await json(ANIM_SURFACES_PATH));
  scripts = parseAnimationScripts(await buildStubAnimationScripts());
});

interface Rig {
  readonly director: SoundDirector;
  readonly engine: AudioEngine;
  readonly graph: FakeGraph;
  readonly cues: Cue[];
  readonly later: (() => void)[];
  clock: number;
}

function rig(world: SoundWorld | null = null, animationScripts = scripts): Rig {
  const graph = new FakeGraph();
  const engine = new AudioEngine({ createGraph: () => graph.asGraph(), load: async () => pcmWav(200) });
  engine.unlock();
  engine.setListener({ centerX: 800, centerY: 800, width: 640, height: 360 });
  const cues: Cue[] = [];
  const play = engine.play.bind(engine);
  engine.play = (cue) => {
    cues.push(cue);
    return play(cue);
  };
  const r: Rig = {
    engine,
    graph,
    cues,
    later: [],
    clock: 10_000,
    director: undefined as unknown as SoundDirector,
  };
  const director = new SoundDirector({
    engine,
    book,
    scripts: animationScripts,
    animations: tables,
    exists: () => true,
    seed: 1,
    rpcSpeechPrefixed: false,
    now: () => r.clock,
    later: (_ms, run) => r.later.push(run),
  });
  director.setWorld(world);
  return {
    ...r,
    director,
    get clock() {
      return r.clock;
    },
    set clock(v) {
      r.clock = v;
    },
  };
}

function soldier(id: number, state: string, frame: number, extra: Partial<SoldierView> = {}): SoldierView {
  return {
    id,
    team: 0,
    name: `s${id}`,
    bodyType: 0,
    gridNo: G,
    x: 0,
    y: 0,
    level: 0,
    direction: 0,
    animation: stateId(tables, state),
    frame,
    palettes: ['', '', '', ''],
    hand: 'rifle',
    frameSlot: 0,
    stateTick: 0,
    frameDelay: 0,
    voice: '007',
    life: 50,
    ...extra,
  };
}

const frame = (tick: number, changed: SoldierView[], events: ViewFrame['events'] = []): ViewFrame => ({
  tick,
  changed,
  removed: [],
  events,
});
const files = (r: Rig) => r.cues.map((c) => c.file);

function withScript(state: string, codes: readonly number[]): AnimationScripts {
  const patched = new Uint16Array(scripts.codes);
  patched.fill(0, stateId(tables, state) * MAX_FRAMES_PER_ANIM, (stateId(tables, state) + 1) * MAX_FRAMES_PER_ANIM);
  patched.set(codes, stateId(tables, state) * MAX_FRAMES_PER_ANIM);
  return { codes: patched };
}

describe('the sound director', () => {
  it('plays footsteps from the codes of the walking script, never the same variant twice in a row', () => {
    const r = rig({ terrainAt: () => 1, ambient: [] });
    r.director.reset([soldier(1, 'WALKING', 0)]);
    let tick = 10;
    for (let lap = 0; lap < 3; lap++)
      for (const f of [2, 5, 8, 11, 0]) {
        tick += 10;
        r.director.applyFrames([frame(tick, [soldier(1, 'WALKING', f)])]);
      }
    const steps = r.cues.filter((c) => c.file.includes('ftp gravel') || c.file.includes('walk'));
    expect(r.director.stats.footsteps).toBe(6);
    expect(steps.length).toBe(6);
    expect(steps.every((c, i) => i === 0 || c.file !== steps[i - 1]?.file)).toBe(true);
    expect(steps[0]).toMatchObject({ mix: 'soldier', baseVolume: 25 });
  });

  it('plays the final footstep when a moving state gives way to a stationary one, louder in combat', () => {
    const r = rig({ terrainAt: () => 2, ambient: [] });
    r.director.setContext({ selected: null, inCombat: true, minuteOfDay: null });
    r.director.reset([soldier(1, 'WALKING', 1)]);
    r.director.applyFrames([frame(10, [soldier(1, 'STANDING', 0)])]);
    expect(r.director.stats.footsteps).toBe(1);
    const floor = ['WALK_LEFT_IN', 'WALK_RIGHT_IN', 'WALK_LEFT_IN2', 'WALK_RIGHT_IN2'].map((n) => book.paths.get(n));
    expect(floor).toContain(r.cues[0]?.file);
    expect(r.cues[0]?.baseVolume).toBe(65);
  });

  it('keeps a stealthy soldier quiet except for the stealthy footstep of a new tile', () => {
    const r = rig({ terrainAt: () => 2, ambient: [] });
    r.director.reset([soldier(1, 'WALKING', 1, { stealth: true })]);
    r.director.applyFrames([frame(10, [soldier(1, 'STANDING', 0, { stealth: true })])]);
    r.director.applyFrames([frame(20, [soldier(1, 'KNEEL_DOWN', 1, { stealth: true })])]);
    expect(r.cues).toEqual([]);
    r.director.applyFrames([frame(30, [], [{ type: 'stealthyFootstep', tick: 30, soldier: 1 }])]);
    expect(r.director.stats.footsteps).toBe(1);
  });

  it('plays nothing from a muted merc and picks the low-morale confirmation from the view', () => {
    const r = rig();
    r.director.reset([soldier(1, 'STANDING', 0, { muted: true }), soldier(2, 'STANDING', 0, { morale: 20 })]);
    r.director.confirm(1);
    r.director.applyFrames([frame(10, [], [{ type: 'soldierDied', tick: 10, soldier: 1, killer: null, gridNo: G }])]);
    expect(r.cues).toEqual([]);
    r.director.confirm(2);
    expect(files(r)).toHaveLength(1);
    expect(files(r)[0]).toMatch(/^battlesnds\/007_lmok\d\.wav$/);
  });

  it('cries the call kind of a creature at code 717 of its call animation', () => {
    const MONSTER_UP = [707, 1, 2, 3, 4, 717, 5, 6, 7, 8, 7, 6, 5, 4, 3, 2, 1, 442, 499];
    const cries = (bodyType: number, call: 'onePrey' | 'attacked' | 'crippled') => {
      const r = rig(null, withScript('MONSTER_UP', MONSTER_UP));
      r.director.reset([soldier(1, 'STANDING', 0, { bodyType, team: 2 })]);
      r.director.applyFrames([
        frame(10, [soldier(1, 'MONSTER_UP', 5, { bodyType, team: 2 })], [{ type: 'creatureCall', tick: 10, soldier: 1, call }]),
      ]);
      return files(r).slice(0, 2);
    };
    const path = (name: string) => book.paths.get(name);
    expect(cries(5, 'onePrey')).toEqual([path('CREATURE_BATTLECRY_1'), path('ACR_SMELL_PREY')]);
    expect(cries(5, 'attacked')).toEqual([path('CREATURE_BATTLECRY_1'), path('ACR_SMELL_THREAT')]);
    expect(cries(10, 'crippled')).toEqual([path('CREATURE_BATTLECRY_1'), path('LQ_CRIPPLED')]);
  });

  it('lets a standing crow caw now and then from the passes of its loop, a crow in water never', () => {
    const STANDING_LOOP = [1, 2, 3, 4, 5, 6, 7, 8, 7, 6, 5, 4, 3, 2, 1, 491, 501, 999];
    const caws = (terrain: number) => {
      const r = rig({ terrainAt: () => terrain, ambient: [] }, withScript('STANDING', STANDING_LOOP));
      const crow = soldier(1, 'STANDING', 0, { bodyType: 19, team: 4, frameDelay: 100, healthIndex: 5 });
      r.director.reset([crow]);
      for (let tick = 10; tick <= 30_000; tick += 10) r.director.applyFrames([frame(tick, [])]);
      return files(r);
    };
    const heard = caws(1);
    expect(heard.length).toBeGreaterThan(5);
    expect(new Set(heard)).toEqual(new Set(['sounds/crow2.wav', 'sounds/crow3.wav']));
    expect(heard.length).toBeLessThan(30_000 / (15 * 20 * 3));
    expect(caws(9)).toEqual([]);
  });

  it('plays the stance codes of the stub scripts', () => {
    const r = rig();
    r.director.reset([soldier(1, 'STANDING', 0)]);
    r.director.applyFrames([frame(10, [soldier(1, 'KNEEL_DOWN', 1)])]);
    expect(files(r)).toEqual([book.paths.get('KNEEL_DOWN_SOUND')]);
  });

  it('turns events into gunfire, misses, material hits, impacts and battle sounds', () => {
    const r = rig();
    const glock = [...book.weapons.values()].find((w) => w.name === 'GLOCK_17')?.item ?? -1;
    r.director.reset([soldier(1, 'STANDING', 0), soldier(30, 'STANDING', 0, { team: 1, voice: 'bad1', gridNo: G + 2 })]);
    r.director.applyFrames([
      frame(
        10,
        [],
        [
          {
            type: 'shotFired',
            tick: 9,
            soldier: 1,
            target: G + 2,
            chance: 50,
            hit: false,
            item: glock,
            silenced: false,
            burst: false,
            rounds: 1,
          },
          { type: 'structureStruck', tick: 9, soldier: 1, gridNo: G + 5, material: 11 },
          { type: 'bulletImpact', tick: 9, soldier: 1, gridNo: G + 5, x: 800, y: 805, z: 12, effect: 'dust' },
          { type: 'bulletStopped', tick: 9, soldier: 1, gridNo: G + 5, reason: 'structure', material: 11 },
          {
            type: 'shotFired',
            tick: 9,
            soldier: 1,
            target: G + 2,
            chance: 50,
            hit: true,
            item: glock,
            silenced: false,
            burst: false,
            rounds: 1,
          },
          { type: 'soldierHit', tick: 9, soldier: 30, attacker: 1, damage: 10, breathLoss: 0, location: 'torso', special: 0, life: 20 },
        ],
      ),
    ]);
    expect(files(r)).toEqual([
      'sounds/weapons/9mm single shot.wav',
      book.paths.get('S_STONE_IMPACT1'),
      expect.stringMatching(/ricochet/),
      'sounds/weapons/9mm single shot.wav',
      expect.stringMatching(/bullet impact|impact/),
      expect.stringMatching(/^battlesnds\/bad1_hit[12]\.wav$/),
    ]);
    expect(r.cues[0]?.gridNo).toBe(G);
    expect(r.cues.at(-1)).toMatchObject({ mix: 'voiceOther', bus: 'speech' });
  });

  it('plays the ground miss, the HE blast, a bullet leaving the map, glass, spit gas, a landing grenade and the mortar whistle', () => {
    const r = rig();
    const glock = [...book.weapons.values()].find((w) => w.name === 'GLOCK_17')?.item ?? -1;
    const spit = [...book.weapons.values()].find((w) => w.name === 'CREATURE_QUEEN_SPIT')?.item ?? -1;
    r.director.reset([soldier(1, 'STANDING', 0), soldier(40, 'STANDING', 0, { team: 2, gridNo: G + 9 })]);
    const shot = (soldier: number, item: number) =>
      ({
        type: 'shotFired',
        tick: 9,
        soldier,
        target: G + 2,
        chance: 50,
        hit: false,
        item,
        silenced: false,
        burst: false,
        rounds: 1,
      }) as const;
    const voices: { readonly active: boolean }[] = [];
    const play = r.engine.play.bind(r.engine);
    r.engine.play = (cue) => {
      const voice = play(cue);
      if (voice) voices.push(voice);
      return voice;
    };
    r.director.applyFrames([
      frame(
        10,
        [],
        [
          shot(1, glock),
          { type: 'bulletImpact', tick: 9, soldier: 1, gridNo: G + 5, x: 800, y: 805, z: 0, effect: 'dust' },
          { type: 'bulletImpact', tick: 9, soldier: 1, gridNo: G + 5, x: 800, y: 805, z: 7, effect: 'miniboom' },
          { type: 'bulletStopped', tick: 9, soldier: 1, gridNo: G + 5, reason: 'offMap' },
          { type: 'bulletStopped', tick: 9, soldier: 1, gridNo: G + 5, reason: 'offMap', explosiveAmmo: true },
          shot(40, spit),
          { type: 'bulletStopped', tick: 9, soldier: 40, gridNo: G + 5, reason: 'offMap' },
          { type: 'windowShattered', tick: 9, gridNo: G + 3, tile: 'WINDOWSHATTER6' },
          { type: 'creatureGas', tick: 9, gridNo: G + 6 },
          { type: 'thrownImpact', tick: 9, gridNo: G + 4 },
          { type: 'mortarWhistle', tick: 9, sounding: true },
        ],
      ),
    ]);
    const whistle = voices.at(-1);
    const gunfire = new Set([glock, spit].map((item) => book.weapons.get(item)?.sound));
    expect(files(r).filter((f) => !gunfire.has(f))).toEqual([
      book.paths.get('MISS_G2'),
      book.paths.get('SMALL_EXPLODE_1'),
      expect.stringMatching(/ricochet/),
      book.paths.get('SMALL_EXPLODE_1'),
      book.paths.get('SPIT_RICOCHET'),
      expect.stringMatching(/glass/i),
      book.paths.get('CREATURE_GAS_NOISE'),
      book.paths.get('THROW_IMPACT_2'),
      book.paths.get('MORTAR_WHISTLE'),
    ]);
    expect(whistle?.active).toBe(true);
    r.director.applyFrames([frame(20, [], [{ type: 'mortarWhistle', tick: 19, sounding: false }])]);
    expect(whistle?.active).toBe(false);
  });

  it('curses about one in forty single-shot misses of our mercs, never a burst or another team', () => {
    const r = rig();
    const glock = [...book.weapons.values()].find((w) => w.name === 'GLOCK_17')?.item ?? -1;
    r.director.reset([soldier(1, 'STANDING', 0), soldier(30, 'STANDING', 0, { team: 1, voice: 'bad1' })]);
    const voices: { stop(): void }[] = [];
    const play = r.engine.play.bind(r.engine);
    r.engine.play = (cue) => {
      const voice = play(cue);
      if (voice) voices.push(voice);
      return voice;
    };
    const SHOTS = 400;
    const SILENCE_MS = 10_000;
    const curses = (soldier: number, burst: boolean) => {
      const before = r.cues.length;
      for (let k = 0; k < SHOTS; k++) {
        r.director.applyFrames([
          frame(
            10 + k,
            [],
            [
              {
                type: 'shotFired',
                tick: k,
                soldier,
                target: G + 2,
                chance: 50,
                hit: false,
                item: glock,
                silenced: false,
                burst,
                rounds: 1,
              },
              { type: 'bulletImpact', tick: k, soldier, gridNo: G + 5, x: 800, y: 805, z: 3, effect: 'dust' },
            ],
          ),
        ]);
        for (const v of voices.splice(0)) v.stop();
        r.clock += SILENCE_MS;
      }
      return r.cues.slice(before).filter((c) => /curse/.test(c.file)).length;
    };
    const ours = curses(1, false);
    expect(ours).toBeGreaterThan(SHOTS / 40 / 3);
    expect(ours).toBeLessThan((SHOTS / 40) * 3);
    expect(curses(1, true)).toBe(0);
    expect(curses(30, false)).toBe(0);
  });

  it('plays a death cry once and the gunfire of unseen shooters as an off-screen sound', () => {
    const r = rig();
    const glock = [...book.weapons.values()].find((w) => w.name === 'GLOCK_17')?.item ?? -1;
    r.director.reset([soldier(1, 'STANDING', 0)]);
    r.director.applyFrames([
      frame(
        10,
        [],
        [
          {
            type: 'shotFired',
            tick: 9,
            soldier: 99,
            target: G,
            chance: 50,
            hit: true,
            item: glock,
            silenced: false,
            burst: false,
            rounds: 1,
          },
          { type: 'soldierHit', tick: 9, soldier: 1, attacker: 99, damage: 60, breathLoss: 0, location: 'head', special: 0, life: 0 },
          { type: 'soldierDied', tick: 9, soldier: 1, killer: 99, gridNo: G },
        ],
      ),
    ]);
    expect(r.cues[0]).toMatchObject({ gridNo: -1, baseVolume: 102 });
    expect(files(r).filter((f) => f.includes('_die'))).toEqual(['battlesnds/007_die.wav']);
  });

  it('stays silent for frames older than the catch-up window', () => {
    const r = rig();
    r.director.reset([soldier(1, 'STANDING', 0)]);
    const shot = { type: 'explosion', tick: 1, item: 1, gridNo: G, level: 0, owner: null, animation: 'BLAST_2' } as const;
    r.director.applyFrames([frame(10, [], [shot]), frame(10 + CATCH_UP_TICKS + 10, [], [])]);
    expect(r.cues).toEqual([]);
    r.director.applyFrames([frame(500, [], [shot])]);
    expect(files(r)).toEqual(['sounds/explosion 12.wav']);
  });

  it('queues speech lines so a new line waits for the previous sample to end', async () => {
    const r = rig();
    r.director.reset([soldier(1, 'STANDING', 0)]);
    const line = (row: number) =>
      ({
        type: 'mercQuote',
        tick: 1,
        soldier: 1,
        profile: 7,
        quote: `quote${row}`,
        id: row,
        textKey: { file: 'mercedt/007.edt', row, width: 160 },
      }) as const;
    r.director.applyFrames([frame(10, [], [line(1), line(2)])]);
    expect(files(r)).toEqual(['speech/007_001.wav']);
    await settle();
    r.graph.playing()[0]?.finish();
    expect(files(r)).toEqual(['speech/007_001.wav', 'speech/007_002.wav']);
    r.director.setSettings({ speech: false, muteConfirmations: true });
    r.director.applyFrames([frame(20, [], [line(3)])]);
    r.director.confirm(1);
    expect(files(r)).toHaveLength(2);
  });

  it('delays the door close sound to the key frame and plays the open sound only for a noisy opener', () => {
    const r = rig();
    r.director.applyFrames([
      frame(
        10,
        [],
        [
          { type: 'doorChanged', tick: 1, gridNo: G, open: true, kind: 'metal', noisy: false },
          { type: 'doorChanged', tick: 2, gridNo: G, open: false, kind: 'metal', noisy: false },
        ],
      ),
    ]);
    expect(r.cues).toEqual([]);
    for (const run of r.later) run();
    expect(files(r)).toEqual([book.paths.get('METAL_DOOR_CLOSE')]);
  });

  it('schedules ambient sounds of the active time window with gaps from the table', () => {
    const owl = { minTimeMs: 1000, maxTimeMs: 1000, timeCategory: AmbientTime.NIGHT, file: 'owl.wav', volume: 30 };
    const bird = { ...owl, timeCategory: AmbientTime.DAY, file: 'bird.wav' };
    const r = rig({ terrainAt: () => 1, ambient: [owl, bird] });
    r.director.setContext({ selected: null, inCombat: false, minuteOfDay: 23 * 60 });
    r.director.update();
    expect(r.cues).toEqual([]);
    r.clock += 1000;
    r.director.update();
    expect(r.cues).toEqual([expect.objectContaining({ file: 'ambient/owl.wav', bus: 'ambient', baseVolume: 30 })]);
  });
});

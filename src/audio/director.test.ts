import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { buildStubAnimationScripts } from '../../stubs/anim-scripts.ts';
import { FakeGraph, pcmWav, settle } from '../../tests/support/fake-audio.ts';
import { ANIM_CONTROL_PATH, ANIM_SURFACES_PATH, type AnimationTables, parseAnimationTables, stateId } from '../content/anim/tables.ts';
import type { Cue } from '../content/audio/cue.ts';
import { type CueBook, loadCueBook } from '../content/audio/cue-book.ts';
import { heardSoundTile } from '../content/audio/heard-place.ts';
import { type AmbientEntry, AmbientTime } from '../content/formats/ambient.ts';
import { type AnimationScripts, MAX_FRAMES_PER_ANIM, parseAnimationScripts } from '../content/formats/ja2bin.ts';
import { Direction } from '../content/world/grid.ts';
import { PROJECT_DATA_DIR } from '../node/repo.ts';
import type { SoldierView, ViewFrame } from '../protocol/view.ts';
import { ClientRandom } from './client-random.ts';
import { CATCH_UP_TICKS, type DirectorOptions, SoundDirector, type SoundWorld } from './director.ts';
import { AudioEngine, type VoiceHandle } from './engine.ts';

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

function rig(world: SoundWorld | null = null, animationScripts = scripts, options: Partial<DirectorOptions> = {}): Rig {
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
    ...options,
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
    surface: 0,
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
const world = (terrain: number, ambient: readonly AmbientEntry[] = [], material: number | null = null): SoundWorld => ({
  terrainAt: () => terrain,
  openableMaterialAt: () => material,
  ambient,
});

function withScript(state: string, codes: readonly number[]): AnimationScripts {
  const patched = new Uint16Array(scripts.codes);
  patched.fill(0, stateId(tables, state) * MAX_FRAMES_PER_ANIM, (stateId(tables, state) + 1) * MAX_FRAMES_PER_ANIM);
  patched.set(codes, stateId(tables, state) * MAX_FRAMES_PER_ANIM);
  return { codes: patched };
}

describe('the sound director', () => {
  it('plays footsteps from the codes of the walking script, never the same variant twice in a row', () => {
    const r = rig(world(1));
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
    const r = rig(world(2));
    r.director.setContext({ selected: null, inCombat: true, minuteOfDay: null });
    r.director.reset([soldier(1, 'WALKING', 1)]);
    r.director.applyFrames([frame(10, [soldier(1, 'STANDING', 0)])]);
    expect(r.director.stats.footsteps).toBe(1);
    const floor = ['WALK_LEFT_IN', 'WALK_RIGHT_IN', 'WALK_LEFT_IN2', 'WALK_RIGHT_IN2'].map((n) => book.paths.get(n));
    expect(floor).toContain(r.cues[0]?.file);
    expect(r.cues[0]?.baseVolume).toBe(65);
  });

  it('keeps a stealthy soldier quiet except for the stealthy footstep of a new tile', () => {
    const r = rig(world(2));
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

  it("reports the battle sound of our merc with a line's profile while it plays, never an enemy's with that profile", async () => {
    const r = rig();
    r.director.reset([soldier(1, 'STANDING', 0, { profile: 7 }), soldier(30, 'STANDING', 0, { team: 1, profile: 8, voice: '008' })]);
    expect(r.director.mercBattleSoundPlaying(7)).toBe(false);
    r.director.curse(1);
    r.director.curse(30);
    expect(files(r)).toEqual([
      expect.stringMatching(/^battlesnds\/007_curse\d?\.wav$/),
      expect.stringMatching(/^battlesnds\/008_curse\d?\.wav$/),
    ]);
    expect(r.director.mercBattleSoundPlaying(7)).toBe(true);
    expect(r.director.mercBattleSoundPlaying(8)).toBe(false);
    expect(r.director.mercBattleSoundPlaying(9)).toBe(false);
    await settle();
    expect(r.director.mercBattleSoundPlaying(7)).toBe(true);
    for (const source of r.graph.playing()) source.finish();
    expect(r.director.mercBattleSoundPlaying(7)).toBe(false);
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
      const r = rig(world(terrain), withScript('STANDING', STANDING_LOOP));
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
          {
            type: 'soldierHit',
            tick: 9,
            soldier: 30,
            attacker: 1,
            gridNo: G + 2,
            location: 'torso',
            special: 0,
            conscious: true,
            damage: 10,
            breathLoss: 0,
            life: 20,
          },
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

  it('plays the ground miss, the HE blast, a bullet leaving the map, glass, spit gas, a landing grenade, a catch and the mortar whistle', () => {
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
          { type: 'catchEnded', tick: 9, soldier: 1 },
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
      book.paths.get('CATCH_OBJECT'),
      book.paths.get('MORTAR_WHISTLE'),
    ]);
    expect(whistle?.active).toBe(true);
    r.director.applyFrames([frame(20, [], [{ type: 'mortarWhistle', tick: 19, sounding: false }])]);
    expect(whistle?.active).toBe(false);
  });

  it('plays the rocket rifle ID sounds, unplaced at high volume: one when it is imprinted, one when it is denied', () => {
    const r = rig();
    r.director.reset([soldier(1, 'STANDING', 0)]);
    r.director.applyFrames([
      frame(
        10,
        [],
        [
          { type: 'gunImprint', tick: 9, soldier: 1, result: 'imprinted' },
          { type: 'gunImprint', tick: 9, soldier: 1, result: 'denied' },
        ],
      ),
    ]);
    r.director.fingerprintDenied();
    const [imprinted, invalid] = [book.paths.get('RG_ID_IMPRINTED'), book.paths.get('RG_ID_INVALID')];
    expect(files(r)).toEqual([imprinted, invalid, invalid]);
    expect(r.cues[0]).toMatchObject({ mix: 'fixed', gridNo: -1 });
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

  it('curses when our merc fails a steal or fumbles the item, not when he grabs it', () => {
    const cursesAfter = (result: 'grabbed' | 'dropped' | 'failed') => {
      const r = rig();
      r.director.reset([soldier(1, 'STANDING', 0)]);
      r.director.applyFrames([frame(10, [], [{ type: 'stealAttempt', tick: 1, soldier: 1, target: 30, item: 1, result }])]);
      return r.cues.filter((c) => /curse/.test(c.file)).length;
    };
    expect(cursesAfter('grabbed')).toBe(0);
    expect(cursesAfter('dropped')).toBe(1);
    expect(cursesAfter('failed')).toBe(1);
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
          {
            type: 'soldierHit',
            tick: 9,
            soldier: 1,
            attacker: 99,
            gridNo: G,
            location: 'head',
            special: 0,
            conscious: false,
            damage: 60,
            breathLoss: 0,
            life: 0,
          },
          { type: 'soldierDied', tick: 9, soldier: 1, killer: 99, gridNo: G },
        ],
      ),
    ]);
    expect(r.cues[0]).toMatchObject({ gridNo: -1, baseVolume: 102 });
    expect(files(r).filter((f) => f.includes('_die'))).toEqual(['battlesnds/007_die.wav']);
  });

  it('sounds the hit, the cry and the death of a victim out of sight at his tile, with the voice the event names', () => {
    const r = rig();
    r.director.reset([soldier(1, 'STANDING', 0)]);
    const unseen = { voice: 'bad2', bodyType: 0 };
    const hit = { type: 'soldierHit', tick: 9, soldier: 70, attacker: 1, gridNo: G + 4, location: 'torso', special: 0 } as const;
    r.director.applyFrames([frame(10, [], [{ ...hit, conscious: true, unseen }])]);
    expect(files(r)).toEqual([expect.stringMatching(/impact/), expect.stringMatching(/^battlesnds\/bad2_hit[12]\.wav$/)]);
    expect(r.cues[0]?.gridNo).toBe(G + 4);
    expect(r.cues[1]).toMatchObject({ gridNo: G + 4, mix: 'voiceOther' });
    r.clock += 5_000;
    r.director.applyFrames([
      frame(
        20,
        [],
        [
          { ...hit, tick: 19, conscious: false, unseen },
          { type: 'soldierDied', tick: 19, soldier: 70, killer: 1, gridNo: G + 4, unseen },
        ],
      ),
    ]);
    expect(files(r).slice(2)).toEqual([expect.stringMatching(/impact/), 'battlesnds/bad2_die.wav']);
  });

  it('places an unseen shooter on the side the squad hears him from, and a shot nobody hears far off', () => {
    const r = rig();
    const glock = [...book.weapons.values()].find((w) => w.name === 'GLOCK_17')?.item ?? -1;
    r.director.reset([soldier(1, 'STANDING', 0)]);
    const shot = { type: 'shotFired', tick: 9, soldier: 80, item: glock, silenced: false, burst: false, rounds: 1 } as const;
    r.director.applyFrames([frame(10, [], [{ ...shot, heard: { by: 1, direction: Direction.NORTH, volumeClass: 3 } }, shot])]);
    expect(r.cues[0]).toMatchObject({ gridNo: heardSoundTile(G, Direction.NORTH, 3), baseVolume: 127 });
    expect(r.cues[1]).toMatchObject({ gridNo: -1, baseVolume: 102 });
  });

  it('roars and cries the call of an unseen creature from where the squad hears it, on the frames of its call animation', () => {
    const MONSTER_UP = [707, 1, 2, 3, 4, 717, 5, 6, 7, 8, 7, 6, 5, 4, 3, 2, 1, 442, 499];
    const r = rig(null, withScript('MONSTER_UP', MONSTER_UP));
    r.director.reset([soldier(1, 'STANDING', 0)]);
    const heard = { by: 1, direction: Direction.WEST, volumeClass: 1 } as const;
    r.director.applyFrames([
      frame(10, [], [{ type: 'creatureCall', tick: 10, soldier: 90, call: 'attacked', unseen: { bodyType: 5 }, heard }]),
    ]);
    expect(files(r)).toEqual([book.paths.get('CREATURE_BATTLECRY_1')]);
    expect(r.cues[0]?.gridNo).toBe(heardSoundTile(G, Direction.WEST, 1));
    expect(r.later).toHaveLength(1);
    for (const run of r.later) run();
    expect(files(r)[1]).toBe(book.paths.get('ACR_SMELL_THREAT'));
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

  it('rings the metal of a struck vehicle and lets it neither cry out nor ring with bullet impacts', () => {
    const ICE_CREAM_TRUCK = 23;
    const r = rig();
    r.director.reset([soldier(5, 'STANDING', 0, { bodyType: ICE_CREAM_TRUCK, team: 4, voice: 'bad1' })]);
    r.director.applyFrames([
      frame(
        10,
        [],
        [
          {
            type: 'soldierHit',
            tick: 10,
            soldier: 5,
            attacker: null,
            gridNo: G,
            location: 'torso',
            special: 0,
            conscious: true,
            damage: 10,
            breathLoss: 0,
            life: 40,
          },
        ],
      ),
    ]);
    expect(files(r)).toEqual([book.paths.get('S_METAL_IMPACT3')]);
  });

  it('rings the metal of a vehicle the hit destroys, which the same frame removes from the view', () => {
    const TANK = 23;
    const r = rig();
    r.director.reset([soldier(5, 'STANDING', 0, { bodyType: TANK, team: 1, voice: 'bad1' })]);
    const destroyed: ViewFrame['events'] = [
      { type: 'vehicleDestroyed', tick: 10, soldier: 5, vehicle: 0, killer: null },
      {
        type: 'soldierHit',
        tick: 10,
        soldier: 5,
        attacker: null,
        gridNo: G,
        location: 'torso',
        special: 0,
        conscious: false,
        damage: 40,
        breathLoss: 0,
        life: 0,
      },
    ];
    r.director.applyFrames([{ ...frame(10, [], destroyed), removed: [5] }]);
    expect(files(r)).toEqual([book.paths.get('S_METAL_IMPACT3')]);
  });

  it('sounds a locker opening and closing from the open containers of the view and lets the opener cheer later', () => {
    const LOCKER_METAL = 22;
    const r = rig(world(1, [], LOCKER_METAL));
    r.director.reset([soldier(1, 'STANDING', 0)], []);
    const cheer = { type: 'contentsExclaimed', tick: 10, soldier: 1, sound: 'COOL1' } as const;
    r.director.applyFrames([{ ...frame(10, [], [cheer]), openContainers: [G] }]);
    expect(files(r)).toEqual([book.paths.get('OPEN_LOCKER')]);
    for (const run of r.later) run();
    expect(files(r)[1]).toMatch(/^battlesnds\/007_cool/);
    r.director.applyFrames([{ ...frame(20, []), openContainers: [] }]);
    expect(files(r)[2]).toBe(book.paths.get('CLOSE_LOCKER'));
  });

  it('has a merc whose pickup or search finds nothing say the NOTHING battle sound at once', () => {
    const r = rig(world(1));
    r.director.reset([soldier(1, 'STANDING', 0)], []);
    r.director.applyFrames([frame(10, [], [{ type: 'nothingFound', tick: 10, soldier: 1, gridNo: G }])]);
    expect(files(r)).toEqual(['battlesnds/007_noth.wav']);
  });

  it('has a soldier who trips and falls on the way curse with CURSE1', () => {
    const r = rig(world(1));
    r.director.reset([soldier(1, 'STANDING', 0)], []);
    r.director.applyFrames([frame(10, [], [{ type: 'fellDown', tick: 10, soldier: 1, cause: 'drunk' }])]);
    expect(files(r)[0]).toMatch(/^battlesnds\/007_curse/);
  });

  it('has a soldier who slips on marbles curse with CURSE1', () => {
    const r = rig(world(1));
    r.director.reset([soldier(1, 'STANDING', 0)], []);
    r.director.applyFrames([frame(10, [], [{ type: 'slippedOnMarbles', tick: 10, soldier: 1 }])]);
    expect(files(r)[0]).toMatch(/^battlesnds\/007_curse/);
  });

  it('has a medic out of bandages curse with CURSE1, and stay silent when the event brings no battle sound', () => {
    const r = rig(world(1));
    r.director.reset([soldier(1, 'STANDING', 0)], []);
    r.director.applyFrames([frame(10, [], [{ type: 'outOfBandages', tick: 10, soldier: 1 }])]);
    expect(files(r)).toEqual([]);
    r.director.applyFrames([frame(20, [], [{ type: 'outOfBandages', tick: 20, soldier: 1, battleSound: 'CURSE1' }])]);
    expect(files(r)[0]).toMatch(/^battlesnds\/007_curse/);
  });

  it('has the merc an item was applied to say COOL1, except after a canteen, which plays its drinking sound instead', () => {
    const r = rig(world(1));
    r.director.reset([soldier(1, 'STANDING', 0), soldier(2, 'STANDING', 0, { voice: '011' })], []);
    const applied = (tick: number, item: string, sound?: 'DRINK_CANTEEN_FEMALE') =>
      frame(tick, [], [{ type: 'itemApplied', tick, soldier: 1, target: 2, item, ...(sound ? { sound } : {}) }]);
    r.director.applyFrames([applied(10, 'CAMOUFLAGEKIT')]);
    r.director.applyFrames([applied(20, 'CANTEEN', 'DRINK_CANTEEN_FEMALE')]);
    expect(files(r)[0]).toMatch(/^battlesnds\/011_cool/);
    expect(files(r).slice(1)).toEqual([book.paths.get('DRINK_CANTEEN_FEMALE')]);
    expect(r.cues[1]).toMatchObject({ mix: 'fixed', baseVolume: 65 });
  });

  it('sounds a drop at the feet from its event and leaves a drop beside the merc to its animation code 763', () => {
    const r = rig(world(1));
    r.director.reset([soldier(1, 'STANDING', 0)], []);
    r.director.applyFrames([frame(10, [], [{ type: 'itemDropped', tick: 10, soldier: 1, gridNo: G, beside: true }])]);
    expect(files(r)).toEqual([]);
    r.director.applyFrames([frame(20, [], [{ type: 'itemDropped', tick: 20, soldier: 1, gridNo: G }])]);
    expect(files(r)).toEqual([book.paths.get('THROW_IMPACT_2')]);
  });

  it('closes the crate of a Bobby Ray delivery silently and keeps quiet about containers open when the sector loads', () => {
    const r = rig(world(1, [], 5));
    r.director.reset([], [G]);
    const delivered = { type: 'shipmentDelivered', tick: 10, shipment: 0, sector: 'B13', items: 2, stolen: 0 } as const;
    r.director.applyFrames([{ ...frame(10, [], [delivered]), openContainers: [] }]);
    expect(r.cues).toEqual([]);
  });

  it('cries the death of a merc of ours off the loaded map on the tactical screen in the voice the event names, then DOORCR_1 and HEADCR_1', () => {
    const r = rig();
    const died = (soldier: number, extra: object = {}) => ({ type: 'mercDied', tick: 10, soldier, sector: 'B9', ...extra }) as const;
    r.director.applyFrames([frame(10, [], [died(4, { cry: { voice: '005', bodyType: 0 } })])]);
    const samples = [book.paths.get('DOORCR_1'), book.paths.get('HEADCR_1')];
    expect(files(r)).toEqual(['battlesnds/005_die.wav', ...samples]);
    expect(r.cues[0]).toMatchObject({ gridNo: -1, mix: 'voiceOwn', baseVolume: 127 });
    expect(r.cues.slice(1)).toEqual(samples.map((file) => expect.objectContaining({ file, mix: 'fixed', baseVolume: 127, pan: 64 })));
    r.director.applyFrames([frame(20, [], [died(5)])]);
    expect(files(r).slice(3)).toEqual(samples);
    r.director.applyFrames([frame(30, [], [died(6, { mapScreen: true, cry: { voice: '007', bodyType: 0 } })])]);
    expect(r.cues).toHaveLength(5);
  });

  it('plays no animation codes, final footsteps or code 491 of the loaded sector while the tactical screen is not up, and the events still', () => {
    let tactical = false;
    const r = rig(world(1), withScript('STANDING', [1, 2, 3, 491, 501, 999]), { onTacticalScreen: () => tactical });
    const crow = soldier(2, 'STANDING', 0, { bodyType: 19, team: 4, frameDelay: 100, healthIndex: 5 });
    r.director.reset([soldier(1, 'WALKING', 1), crow]);
    r.director.applyFrames([frame(10, [soldier(1, 'KNEEL_DOWN', 1)])]);
    r.director.applyFrames([frame(20, [soldier(1, 'STANDING', 0)])]);
    for (let tick = 30; tick <= 30_000; tick += 10) r.director.applyFrames([frame(tick, [])]);
    expect(r.cues).toEqual([]);
    r.director.applyFrames([frame(30_010, [], [{ type: 'soldierDied', tick: 30_010, soldier: 1, killer: null, gridNo: G }])]);
    expect(files(r)).toEqual(['battlesnds/007_die.wav']);
    tactical = true;
    r.director.applyFrames([frame(30_020, [soldier(1, 'KNEEL_DOWN', 1)])]);
    expect(files(r).slice(1)).toEqual([book.paths.get('KNEEL_DOWN_SOUND')]);
  });

  it("silences the creature queen's position sound while the tactical screen is not up and starts it again on the return", async () => {
    let tactical = true;
    const r = rig(null, scripts, { onTacticalScreen: () => tactical });
    r.director.reset([soldier(1, 'STANDING', 0, { bodyType: 10, team: 2 })]);
    r.director.applyFrames([frame(10, [])]);
    const loop = book.paths.get('QUEEN_AMBIENT_NOISE');
    expect(files(r)).toEqual([loop]);
    await settle();
    expect(r.graph.playing()).toHaveLength(1);
    tactical = false;
    r.director.applyFrames([frame(20, [])]);
    expect(r.graph.playing()).toEqual([]);
    tactical = true;
    r.director.update();
    expect(files(r)).toEqual([loop, loop]);
  });

  it('schedules ambient sounds of the active time window with gaps from the table', () => {
    const owl = { minTimeMs: 1000, maxTimeMs: 1000, timeCategory: AmbientTime.NIGHT, file: 'owl.wav', volume: 30 };
    const bird = { ...owl, timeCategory: AmbientTime.DAY, file: 'bird.wav' };
    const r = rig(world(1, [owl, bird]));
    r.director.setContext({ selected: null, inCombat: false, minuteOfDay: 23 * 60 });
    r.director.update();
    expect(r.cues).toEqual([]);
    r.clock += 1000;
    r.director.update();
    expect(r.cues).toEqual([expect.objectContaining({ file: 'ambient/owl.wav', bus: 'ambient', baseVolume: 30 })]);
  });
});

describe('the sounds of a vehicle', () => {
  const HUMVEE = 22;
  const TANK_NW = 23;
  const VEHICLE = 18;
  const VEHICLE_AT = G + 3;
  const SOMEWHERE_ELSE = G + 40;
  const BATTLE_SOUNDS = 'battlesnds/';
  const VOICE_DIGITS = 3;

  const hummer = (state: string, extra: Partial<SoldierView> = {}) =>
    soldier(VEHICLE, state, 0, { bodyType: HUMVEE, gridNo: VEHICLE_AT, voice: '999', ...extra });
  const passenger = (id: number, voice: string, extra: Partial<SoldierView> = {}) =>
    soldier(id, 'STANDING', 0, { gridNo: VEHICLE_AT, voice, vehicle: { id: 0, driver: id === 1 }, ...extra });
  const boarded = (gridNo?: number): NonNullable<ViewFrame['events']>[number] => ({
    type: 'vehicleBoarded',
    tick: 10,
    soldier: 1,
    vehicle: 0,
    ...(gridNo === undefined ? {} : { gridNo }),
  });
  const left = (gridNo: number): NonNullable<ViewFrame['events']>[number] => ({
    type: 'vehicleLeft',
    tick: 20,
    soldier: 1,
    vehicle: 0,
    gridNo,
  });

  function voicesOf(r: Rig): VoiceHandle[] {
    const voices: VoiceHandle[] = [];
    const play = r.engine.play.bind(r.engine);
    r.engine.play = (cue) => {
      const voice = play(cue);
      voices.push(voice);
      return voice;
    };
    return voices;
  }

  it('is spoken by a passenger drawn with Random(passengers) on the client generator (PickRandomPassengerFromVehicle)', () => {
    const voices = ['007', '008', '011'];
    const seeds = [1, 2, 3, 4, 5, 6, 7, 8];
    const spoken = seeds.map((seed) => {
      const r = rig(null, scripts, { seed });
      r.director.reset([hummer('STANDING', { passengers: [1, 2, 3] }), ...voices.map((v, k) => passenger(k + 1, v))]);
      r.director.curse(VEHICLE);
      return files(r).map((f) => f.slice(BATTLE_SOUNDS.length, BATTLE_SOUNDS.length + VOICE_DIGITS));
    });
    expect(spoken).toEqual(seeds.map((seed) => [voices[new ClientRandom(seed).rand(voices.length)]]));
    expect(new Set(spoken.flat()).size).toBe(voices.length);
  });

  it('says nothing with nobody aboard or a muted passenger drawn, and plays a death cry of the vehicle once', () => {
    const r = rig();
    r.director.reset([hummer('STANDING', { passengers: [] }), passenger(1, '007', { muted: true })]);
    r.director.attention(VEHICLE);
    r.director.applyFrames([
      frame(
        10,
        [hummer('STANDING', { passengers: [1] })],
        [{ type: 'soldierDied', tick: 10, soldier: VEHICLE, killer: null, gridNo: VEHICLE_AT }],
      ),
    ]);
    expect(r.cues).toEqual([]);
    r.director.applyFrames([
      frame(20, [passenger(1, '007')], [{ type: 'soldierDied', tick: 20, soldier: VEHICLE, killer: null, gridNo: VEHICLE_AT }]),
    ]);
    expect(r.cues).toEqual([]);
    r.director.confirm(VEHICLE);
    expect(files(r)).toEqual([expect.stringMatching(/^battlesnds\/007_ok\d\.wav$/)]);
  });

  it("plays the vehicle type's enter sound at the vehicle's tile as a merc boards or leaves it, only on the tactical screen", () => {
    let tactical = true;
    const r = rig(null, scripts, { onTacticalScreen: () => tactical });
    r.director.reset([hummer('STANDING', { passengers: [1] }), passenger(1, '007')]);
    r.director.applyFrames([frame(10, [], [boarded(VEHICLE_AT), boarded()]), frame(20, [], [left(VEHICLE_AT)])]);
    const enter = { file: book.vehicles[1]?.enter, gridNo: VEHICLE_AT, mix: 'location', baseVolume: 127 };
    expect(r.cues).toEqual([expect.objectContaining(enter), expect.objectContaining(enter)]);
    expect(enter.file).toBe(book.paths.get('S_VECH1_INTO'));
    tactical = false;
    r.director.applyFrames([frame(30, [], [boarded(VEHICLE_AT)])]);
    expect(r.cues).toHaveLength(2);
  });

  it('plays nothing as a merc boards where no vehicle stands in the view', () => {
    const r = rig();
    r.director.reset([hummer('STANDING', { passengers: [1] }), passenger(1, '007')]);
    r.director.applyFrames([frame(10, [], [boarded(SOMEWHERE_ELSE)])]);
    expect(r.cues).toEqual([]);
  });

  it('starts the move sound at the tile a vehicle starts from as it begins to move, and stops it as it stops (HandleVehicleMovementSound)', () => {
    const r = rig();
    const voices = voicesOf(r);
    r.director.reset([hummer('STANDING')]);
    r.director.applyFrames([frame(10, [hummer('WALKING')]), frame(20, [hummer('WALKING', { gridNo: VEHICLE_AT + 1, frame: 2 })])]);
    const move = { file: book.vehicles[1]?.move, gridNo: VEHICLE_AT, mix: 'location', baseVolume: 127, loops: 1 };
    expect(r.cues).toEqual([expect.objectContaining(move)]);
    expect(move.file).toBe(book.paths.get('S_VECH1_MOVE'));
    expect(voices[0]?.active).toBe(true);
    r.director.applyFrames([frame(30, [hummer('STANDING', { gridNo: VEHICLE_AT + 1 })])]);
    expect(voices[0]?.active).toBe(false);
    r.director.applyFrames([frame(40, [hummer('WALKING', { gridNo: VEHICLE_AT + 1 })])]);
    expect(r.cues.map((c) => c.gridNo)).toEqual([VEHICLE_AT, VEHICLE_AT + 1]);
  });

  it('stops the move sound when the vehicle runs out of APs to finish its move and does not start it again on the same move (AdjustNoAPToFinishMove)', () => {
    const r = rig();
    const voices = voicesOf(r);
    r.director.reset([hummer('STANDING')]);
    r.director.applyFrames([frame(10, [hummer('WALKING')]), frame(20, [hummer('WALKING', { noApToFinishMove: true })])]);
    expect(voices[0]?.active).toBe(false);
    r.director.applyFrames([frame(30, [hummer('WALKING', { noApToFinishMove: false })])]);
    expect(r.cues).toHaveLength(1);
  });

  it("starts no move sound for a frame caught up from the past, and a tank's own as it moves", () => {
    const r = rig();
    r.director.reset([hummer('STANDING'), soldier(30, 'STANDING', 0, { bodyType: TANK_NW, team: 1, gridNo: SOMEWHERE_ELSE })]);
    r.director.applyFrames([frame(10, [hummer('WALKING')]), frame(10 + CATCH_UP_TICKS + 1, [])]);
    expect(r.cues).toEqual([]);
    r.director.applyFrames([
      frame(200, [hummer('STANDING')]),
      frame(210, [hummer('WALKING'), soldier(30, 'WALKING', 0, { bodyType: TANK_NW, team: 1, gridNo: SOMEWHERE_ELSE })]),
    ]);
    expect(r.cues.map((c) => c.gridNo)).toEqual([VEHICLE_AT, SOMEWHERE_ELSE]);
    expect(r.cues[1]?.file).toBe(book.vehicles[4]?.move);
  });

  describe("a tank's turret (TurnSoldier)", () => {
    const TANK = 30;
    const tank = (extra: Partial<SoldierView>) =>
      soldier(TANK, 'STANDING', 0, { bodyType: TANK_NW, team: 1, gridNo: SOMEWHERE_ELSE, ...extra });
    const turretMove = { file: 'TURRET_MOVE', mix: 'soldier', baseVolume: 127, gridNo: SOMEWHERE_ELSE, loops: 100 };
    const turretStop = { file: 'TURRET_STOP', mix: 'soldier', baseVolume: 127, gridNo: SOMEWHERE_ELSE, loops: 1 };
    const named = (cue: { readonly file: string }) => ({ ...cue, file: book.paths.get(cue.file) });
    const turningTo = (direction: number, steps: readonly number[], from: number) =>
      steps.map((hiResDirection, k) => frame(from + 10 * k, [tank({ direction, hiResDirection, turning: true })]));

    it('loops TURRET_MOVE from the first step of the turn to its end, then plays TURRET_STOP once', () => {
      const r = rig();
      const voices = voicesOf(r);
      r.director.reset([tank({ direction: Direction.NORTH })]);
      r.director.applyFrames([frame(10, [tank({ direction: Direction.NORTH, turning: true })])]);
      expect(r.cues).toEqual([]);
      r.director.applyFrames([
        ...turningTo(Direction.NORTH, [1, 2, 3], 20),
        frame(50, [tank({ direction: Direction.NORTHEAST, turning: true })]),
        ...turningTo(Direction.NORTHEAST, [5, 6, 7], 60),
      ]);
      expect(r.cues).toEqual([expect.objectContaining(named(turretMove))]);
      expect([named(turretMove).file, named(turretStop).file]).toEqual(['sounds/tank turret a.wav', 'sounds/tank turret b.wav']);
      expect(voices[0]?.active).toBe(true);
      r.director.applyFrames([frame(90, [tank({ direction: Direction.EAST })])]);
      expect(voices[0]?.active).toBe(false);
      expect(r.cues).toEqual([expect.objectContaining(named(turretMove)), expect.objectContaining(named(turretStop))]);
    });

    it('plays nothing for a turn caught up from the past, and silences the loop of a tank gone from the view', () => {
      const r = rig();
      const voices = voicesOf(r);
      r.director.reset([tank({ direction: Direction.NORTH })]);
      r.director.applyFrames([...turningTo(Direction.NORTH, [1], 10), frame(10 + CATCH_UP_TICKS + 1, [])]);
      expect(r.cues).toEqual([]);
      r.director.applyFrames(turningTo(Direction.NORTH, [2], 200));
      expect(r.cues).toEqual([expect.objectContaining(named(turretMove))]);
      r.director.applyFrames([{ tick: 210, changed: [], removed: [TANK], events: [] }]);
      expect(voices[0]?.active).toBe(false);
      expect(r.cues).toHaveLength(1);
    });
  });
});

import { seedFromText } from '../../audio/client-random.ts';
import { SoundDirector, type SoundWorld } from '../../audio/director.ts';
import { type AudioCounters, AudioEngine } from '../../audio/engine.ts';
import { listenerView } from '../../audio/positional.ts';
import type { AnimationTables } from '../../content/anim/tables.ts';
import { ambientSilenced } from '../../content/audio/ambient-schedule.ts';
import { type CueBook, loadCueBook } from '../../content/audio/cue-book.ts';
import { type AmbientEntry, ambientTablePath, parseAmbientTable } from '../../content/formats/ambient.ts';
import { ANIMATION_SCRIPTS_PATH, type AnimationScripts, parseAnimationScripts } from '../../content/formats/ja2bin.ts';
import { type DataVersion, rpcSpeechPrefixed, STUB_DATA_VERSION } from '../../content/text/data-version.ts';
import { compileWorldTerrainIds } from '../../content/world/movement-costs.ts';
import type { ViewFrame } from '../../protocol/view.ts';
import { type MusicHook, musicLevel, PageMusic } from '../net/music.ts';
import { fetchHealth, fetchVfsFile, readVfsFileOrNull } from '../net/vfs.ts';
import { type ClientSettings, effectiveMaster, loadSettings, saveSettings, updateSettings } from '../settings.ts';
import type { LoadedWorld } from '../world/world-loader.ts';

const STUB_PREFIX = 'stubs/';
const MINUTES_PER_HOUR = 60;

export interface AudioHook {
  ready: boolean;
  unlocked: boolean;
  error: string | null;
  counters: AudioCounters | null;
  director: SoundDirector['stats'] | null;
  played: string[];
  settings: ClientSettings;
  music: MusicHook;
  setMaster(volume: number): void;
  setMusicVolume(volume: number): void;
}

declare global {
  interface Window {
    __ja2Audio: AudioHook;
  }
}

const PLAYED_LOG = 200;

export interface SoundContext {
  readonly camera: { readonly centerX: number; readonly centerY: number };
  readonly width: number;
  readonly height: number;
  readonly selected: number | null;
  readonly inCombat: boolean;
  readonly clock: { readonly hour: number; readonly minute: number } | null;
  readonly morale: ReadonlyMap<number, number>;
}

export class TacticalSound {
  readonly hook: AudioHook;
  readonly engine: AudioEngine;
  readonly music: PageMusic;
  #settings: ClientSettings;
  #director: SoundDirector | null = null;
  #book: CueBook | null = null;
  #scripts: AnimationScripts | null = null;
  #version: DataVersion = STUB_DATA_VERSION;
  #available: ReadonlySet<string> = new Set();

  constructor() {
    this.#settings = loadSettings();
    this.engine = new AudioEngine({
      createGraph: () => new AudioContext(),
      load: readVfsFileOrNull,
    });
    this.music = new PageMusic(musicLevel(this.#settings));
    this.hook = {
      ready: false,
      unlocked: false,
      error: null,
      counters: this.engine.counters,
      director: null,
      played: [],
      settings: this.#settings,
      music: this.music.hook,
      setMaster: (volume) => this.change({ volumes: { master: volume } }),
      setMusicVolume: (volume) => this.change({ volumes: { music: volume } }),
    };
    window.__ja2Audio = this.hook;
    const play = this.engine.play.bind(this.engine);
    this.engine.play = (cue) => {
      this.hook.played.push(cue.file);
      if (this.hook.played.length > PLAYED_LOG) this.hook.played.shift();
      return play(cue);
    };
    this.#applySettings();
  }

  get settings(): ClientSettings {
    return this.#settings;
  }

  change(change: Parameters<typeof updateSettings>[1]): void {
    this.#settings = updateSettings(this.#settings, change);
    saveSettings(this.#settings);
    this.#applySettings();
  }

  #applySettings(): void {
    const s = this.#settings;
    this.engine.setVolumes({ ...s.volumes, master: effectiveMaster(s) });
    this.#director?.setSettings({ speech: s.speech, muteConfirmations: s.muteConfirmations });
    this.music.setLevel(musicLevel(s));
    this.hook.settings = s;
  }

  unlock(): void {
    const wasLocked = !this.engine.unlocked;
    this.engine.unlock();
    this.hook.unlocked = this.engine.unlocked;
    if (wasLocked && this.engine.unlocked) this.music.unlocked();
  }

  exists = (path: string): boolean => {
    if (this.#available.has(path)) return true;
    return this.#version === STUB_DATA_VERSION && this.#available.has(`${STUB_PREFIX}${path}`);
  };

  async load(available: ReadonlySet<string>, animations: AnimationTables, session: string): Promise<void> {
    try {
      this.#available = available;
      const health = await fetchHealth();
      this.#version = (health.dataVersion as DataVersion | undefined) ?? STUB_DATA_VERSION;
      this.#book = await loadCueBook(fetchVfsFile);
      const scripts =
        (await readVfsFileOrNull(ANIMATION_SCRIPTS_PATH)) ?? (await readVfsFileOrNull(`${STUB_PREFIX}${ANIMATION_SCRIPTS_PATH}`));
      this.#scripts = scripts ? parseAnimationScripts(scripts) : null;
      this.#director = new SoundDirector({
        engine: this.engine,
        book: this.#book,
        scripts: this.#scripts,
        animations,
        exists: this.exists,
        seed: seedFromText(session),
        rpcSpeechPrefixed: rpcSpeechPrefixed(this.#version),
        now: () => performance.now(),
        later: (ms, run) => {
          setTimeout(run, ms);
        },
      });
      this.hook.director = this.#director.stats;
      await this.music.load(this.engine, session);
      this.#applySettings();
      this.hook.ready = true;
    } catch (err) {
      this.hook.error = (err as Error).message;
    }
  }

  get director(): SoundDirector | null {
    return this.#director;
  }

  async setWorld(world: LoadedWorld): Promise<void> {
    const director = this.#director;
    if (!director) return;
    const terrain = compileWorldTerrainIds(world.level, world.tiles, world.tables);
    const ambient = ambientSilenced(world.map.ambient) ? [] : await this.#ambientTable(world.ambientId);
    const sound: SoundWorld = { terrainAt: (g) => terrain[g] ?? 0, ambient };
    director.setWorld(sound);
  }

  async #ambientTable(id: number): Promise<AmbientEntry[]> {
    const path = ambientTablePath(id);
    if (!this.exists(path)) return [];
    const bytes = await readVfsFileOrNull(path);
    try {
      return bytes ? parseAmbientTable(bytes) : [];
    } catch {
      return [];
    }
  }

  frames(frames: readonly ViewFrame[]): void {
    this.#director?.applyFrames(frames);
    this.music.frames(frames);
  }

  update(ctx: SoundContext): void {
    const director = this.#director;
    this.engine.setListener(listenerView(ctx.camera, ctx.width, ctx.height));
    this.hook.unlocked = this.engine.unlocked;
    if (!director) return;
    director.setContext({
      selected: ctx.selected,
      inCombat: ctx.inCombat,
      minuteOfDay: ctx.clock ? ctx.clock.hour * MINUTES_PER_HOUR + ctx.clock.minute : null,
    });
    director.setMorale(ctx.morale);
    director.update();
  }
}

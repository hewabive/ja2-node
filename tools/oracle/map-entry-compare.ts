import { basename, dirname } from 'node:path';
import { parseSectorString, type Sector, sectorShortString } from '../../src/content/strategic/sector-ids.ts';
import type { ReadFile } from '../../src/content/world/tileset-loader.ts';
import type { CampaignSession } from '../../src/server/campaign-session.ts';
import type { FileExists } from '../../src/server/world-cache.ts';
import type { CampaignSim } from '../../src/sim/campaign/campaign-sim.ts';
import { leaveTacticalScreenForTheMap } from '../../src/sim/campaign/screens.ts';
import { setGroupSectorValue } from '../../src/sim/strategic/forces/groups.ts';
import {
  CompressionStop,
  isTimeBeingCompressed,
  setGameTimeCompressionLevel,
  stopTimeCompression,
} from '../../src/sim/strategic/time/world-clock.ts';
import { firstDifference, report } from './actions-compare.ts';
import { createTacticalSaveSession } from './tactical-import.ts';

type Json = Record<string, unknown>;

const OUTPUT = 'map-entry.jsonl';
const OUTPUT_DIR = 'map-entry';
const IMPORT_SEED = 1;
const MAP_SCREEN = 'map';
const GAME_SCREEN = 'game';
const NO_WORLD = [0, 0, -1];
const SKIPPED = new Set(['hdtimer', 'seed', 'draws', 'end']);

const num = (v: unknown) => Number(v ?? 0);
const bit = (v: boolean) => (v ? 1 : 0);

export function isMapEntryOutput(path: string): boolean {
  return basename(path) === OUTPUT && basename(dirname(path)) === OUTPUT_DIR;
}

function args(p: Json): Record<string, string> {
  return (p.args ?? {}) as Record<string, string>;
}

function sectorArg(value: string | undefined): Sector | null {
  const s = value !== undefined ? parseSectorString(value) : null;
  return s ? { x: s.x, y: s.y, z: 0 } : null;
}

export class MapEntryComparer {
  readonly #read: ReadFile;
  readonly #exists: FileExists;
  readonly #save: (name: string) => Uint8Array;
  #session: CampaignSession | null = null;

  constructor(read: ReadFile, exists: FileExists, save: (name: string) => Uint8Array) {
    this.#read = read;
    this.#exists = exists;
    this.#save = save;
  }

  async compare(p: Json): Promise<number> {
    const probe = String(p.probe);
    const label = `${probe} line ${String(p.line ?? '')}`;
    if (p.error) return report(label, false, `oracle error: ${String(p.error)}`);
    if (SKIPPED.has(probe) || (probe === 'mwframes' && p.frame !== undefined)) return 0;
    try {
      switch (probe) {
        case 'save':
          return await this.#load(label, p);
        case 'mwset':
          return this.#set(label, p);
        case 'mwexit':
          return await this.#exit(label, p);
        case 'mwframes':
          return this.#frames(label, p);
        case 'mwclock':
          return this.#clock(label, p);
        default:
          return report(label, false, `no comparer for ${probe}`);
      }
    } catch (e) {
      return report(label, false, `threw: ${e instanceof Error ? (e.stack ?? e.message) : String(e)}`);
    }
  }

  #campaign(): CampaignSim {
    const c = this.#session?.campaign;
    if (!c) throw new Error('the map entry probes need a save');
    return c;
  }

  async #load(label: string, p: Json): Promise<number> {
    const imported = await createTacticalSaveSession(this.#read, this.#save(String(p.name)), IMPORT_SEED, this.#exists);
    this.#session = imported.session;
    return report(label, true, `imported ${String(p.name)}`);
  }

  #set(label: string, p: Json): number {
    const c = this.#campaign();
    const a = args(p);
    if (a.screen === MAP_SCREEN && c.state.flow !== 'strategic') leaveTacticalScreenForTheMap(c);
    if (a.compress !== undefined) setGameTimeCompressionLevel(c.clockContext, num(a.compress));
    if (a.stop === '1') stopTimeCompression(c.clockContext, CompressionStop.REQUESTED);
    const place = sectorArg(a.place);
    if (place) this.#placeSquad(c, place);
    const selected = sectorArg(a.select);
    if (selected) c.state.map.selectedSector = selected;
    const state = p.state as Json;
    const native = state.meanwhile as Json;
    c.state.clock.paused = native.paused === true;
    c.state.clock.pauseLocked = native.pauseLocked === true;
    const diff = firstDifference(
      { compression: [c.state.clock.mode, bit(c.state.clock.compressionOn)], world: this.#world(c), selected: this.#selected(c) },
      { compression: state.compression, world: state.worldLoaded === true ? state.world : NO_WORLD, selected: state.selected },
    );
    return report(label, diff === null, diff ?? `mode ${c.state.clock.mode}`);
  }

  #placeSquad(c: CampaignSim, sector: Sector): void {
    const ctx = c.strategic;
    if (!ctx) throw new Error('the session has no strategic layer');
    for (const g of ctx.state.forces.groups.filter((group) => group.player)) setGroupSectorValue(ctx, sector, g);
  }

  async #exit(label: string, p: Json): Promise<number> {
    const c = this.#campaign();
    const session = this.#session;
    if (!session) throw new Error('no session');
    const to = args(p).to;
    if (to === MAP_SCREEN) {
      const result = c.dispatch({ type: 'mapScreen' });
      return report(label, result.ok, result.ok ? 'map screen' : `mapScreen refused: ${result.reason}`);
    }
    const allowed = (p.result as Json | null)?.allowed === true;
    const command = { type: 'enterSector', sector: sectorShortString(c.state.map.selectedSector) };
    await session.prepare(command);
    const result = c.dispatch(command);
    return report(label, result.ok === allowed, result.ok ? `entered ${command.sector}` : `refused: ${result.reason}`);
  }

  #frames(label: string, p: Json): number {
    const c = this.#campaign();
    const a = args(p);
    if (a.clock === '1') for (let k = 0; k < num(p.frames); k++) c.step();
    const state = p.state as Json;
    const diff = firstDifference(
      { screen: this.#screen(c), compression: [c.state.clock.mode, bit(c.state.clock.compressionOn)], world: this.#world(c) },
      { screen: state.screen, compression: state.compression, world: state.worldLoaded === true ? state.world : NO_WORLD },
    );
    return report(label, diff === null, diff ?? `${String(p.frames)} frames`);
  }

  #clock(label: string, p: Json): number {
    const c = this.#campaign();
    const clock = c.state.clock;
    const diff = firstDifference(
      {
        screen: this.#screen(c),
        world: this.#world(c),
        compression: [clock.mode, bit(clock.compressionOn), bit(isTimeBeingCompressed(clock))],
        worldSeconds: clock.seconds,
      },
      { screen: p.screen, world: p.worldLoaded === true ? p.world : NO_WORLD, compression: p.compression, worldSeconds: p.worldSeconds },
    );
    return report(label, diff === null, diff ?? `${this.#screen(c)}, mode ${clock.mode}, world second ${clock.seconds}`);
  }

  #screen(c: CampaignSim): string {
    return c.state.flow === 'strategic' ? MAP_SCREEN : GAME_SCREEN;
  }

  #world(c: CampaignSim): number[] {
    const w = c.tactical ? c.state.worldSector : null;
    return w ? [w.x, w.y, w.z] : NO_WORLD;
  }

  #selected(c: CampaignSim): number[] {
    const s = c.state.map.selectedSector;
    return [s.x, s.y, s.z];
  }
}

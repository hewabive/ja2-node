import { basename, dirname } from 'node:path';
import type { ReadFile } from '../../src/content/world/tileset-loader.ts';
import type { CampaignSession } from '../../src/server/campaign-session.ts';
import type { FileExists } from '../../src/server/world-cache.ts';
import { inSector, type Soldier, withOriginalNowhere } from '../../src/sim/tactical/soldier.ts';
import type { TacticalState } from '../../src/sim/tactical/state.ts';
import { type Draw, report } from './actions-compare.ts';
import { differences, inOrder } from './auto-bandage-compare.ts';
import { createTacticalSaveSession } from './tactical-import.ts';

type Json = Record<string, unknown>;

const SAVE_FLIGHT_OUTPUT = 'loads.jsonl';
const SAVE_FLIGHT_DIR = 'save-flight';
const SEED = 1;
const ROW_ID = 0;
const ROW_LIFE = 18;
const ROW_BREATH = 19;
const OBJECTS_NOT_COMPARED = "a thrown object's flight: no probe command runs SimulateWorld or prints the physics table";

const num = (v: unknown) => Number(v ?? 0);

export function isSaveFlightOutput(path: string): boolean {
  return basename(path) === SAVE_FLIGHT_OUTPUT && basename(dirname(path)) === SAVE_FLIGHT_DIR;
}

function compareLifeAndBreath(t: TacticalState, frame: number, row: readonly number[], problems: string[]): void {
  const s = t.soldiers[num(row[ROW_ID])];
  if (!s) return;
  differences([s.life, s.breath], [row[ROW_LIFE], row[ROW_BREATH]], `frame ${frame} soldier ${s.id} life and breath`, problems);
}

export class SaveFlightComparer {
  readonly #read: ReadFile;
  readonly #exists: FileExists;
  readonly #save: (name: string) => Uint8Array;
  #session: CampaignSession | null = null;
  #frames: Json[] = [];

  constructor(read: ReadFile, exists: FileExists, save: (name: string) => Uint8Array) {
    this.#read = read;
    this.#exists = exists;
    this.#save = save;
  }

  async compare(p: Json, loadDraws: readonly Draw[]): Promise<number> {
    const probe = String(p.probe);
    if (probe === 'save') return this.#import(p, loadDraws);
    if (probe === 'hdframes' && p.frame !== undefined) {
      this.#frames.push(p);
      return 0;
    }
    if (probe === 'hdframes') return this.#runFrames(`hdframes line ${String(p.line ?? '')}`, p);
    return 0;
  }

  async #import(p: Json, loadDraws: readonly Draw[]): Promise<number> {
    const label = `save ${String(p.name)}`;
    this.#frames = [];
    try {
      const bytes = this.#save(String(p.name));
      const around = (t: TacticalState, restart: () => void) => inOrder(t, loadDraws, restart);
      this.#session = (await createTacticalSaveSession(this.#read, bytes, SEED, this.#exists, undefined, undefined, around)).session;
    } catch (e) {
      this.#session = null;
      return report(label, false, `threw: ${e instanceof Error ? (e.stack ?? e.message) : String(e)}`);
    }
    const t = this.#tactical();
    const native = ((p.soldiers as Json[] | undefined) ?? []).map((s) => [num(s.id), num(s.gridNo), num(s.animState)]);
    const ours = t.soldiers
      .filter((s): s is Soldier => !!s && inSector(s))
      .map((s) => [s.id, withOriginalNowhere(s.gridNo), s.state])
      .filter(([id]) => native.some(([nativeId]) => nativeId === id));
    const problems: string[] = [];
    differences(ours, native, 'soldiers', problems);
    const flight = `in flight: bullets ${t.bullets.length}, thrown objects ${t.explosives.objects.filter((o) => o !== null).length}`;
    return report(label, problems.length === 0, problems.join('; ') || `${flight}; not compared: ${OBJECTS_NOT_COMPARED}`);
  }

  #tactical(): TacticalState {
    const t = this.#session?.campaign.tactical?.state;
    if (!t) throw new Error('no loaded sector');
    return t;
  }

  #runFrames(label: string, p: Json): number {
    const session = this.#session;
    if (!session) return report(label, false, 'no save imported');
    const c = session.campaign;
    const t = this.#tactical();
    const byFrame = new Map(this.#frames.splice(0).map((f) => [num(f.frame), f]));
    const count = num(p.frames);
    const problems: string[] = [];
    for (let frame = 1; frame <= count && problems.length === 0; frame++) {
      const f = byFrame.get(frame);
      inOrder(c.state, (f?.draws as Draw[] | undefined) ?? [], () => c.step());
      for (const row of (f?.changed as number[][] | undefined) ?? []) compareLifeAndBreath(t, frame, row, problems);
    }
    if (t.bullets.length > 0) problems.push(`${t.bullets.length} bullets still in flight after ${count} frames`);
    return report(
      label,
      problems.length === 0,
      problems.join('; ') || `${count} frames, the bullet's hit and every changed life and breath`,
    );
  }
}

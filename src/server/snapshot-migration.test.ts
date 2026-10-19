import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadStubSectorKit, type StubSectorKit } from '../../tests/support/sectors.ts';
import { type PresentationTimeline, spriteFrameAt } from '../content/anim/timelines.ts';
import type { EncodedGraph, Json } from '../sim/snapshot/codec.ts';
import { migrateSnapshot, type SimSnapshot, snapshotJson } from '../sim/snapshot/session.ts';
import { createCampaignSession } from './campaign-factory.ts';
import { createSandboxSession } from './sandbox.ts';
import type { SessionSim } from './session.ts';
import { restoreSession, type SessionSnapshot, snapshotSession } from './session-snapshot.ts';

type JsonObject = { readonly [key: string]: Json };

const SCENARIO_TIMEOUT_MS = 60_000;

function object(value: Json | undefined): JsonObject {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error('not an object');
  return value as JsonObject;
}

function legacyEquipment(equipment: JsonObject, options: JsonObject): JsonObject {
  const out: Record<string, Json> = {};
  for (const [key, value] of Object.entries(equipment)) {
    if (key !== 'options') out[key] = value;
    else Object.assign(out, { gunNut: options.gunNut ?? false, sciFi: options.sciFi ?? true });
  }
  return out;
}

function legacyPerception(perception: JsonObject, difficulty: Json): JsonObject {
  const out: Record<string, Json> = {};
  for (const [key, value] of Object.entries(perception)) {
    out[key] = value;
    if (key === 'awareOfOpposition') out.difficulty = difficulty;
  }
  return out;
}

function withoutLastMercKill(turn: JsonObject): JsonObject {
  const { lastMercKill, ...rest } = turn;
  expect(lastMercKill).toBeNull();
  return rest;
}

function versionOne(snapshot: SimSnapshot): SimSnapshot {
  const graph = snapshot.graph;
  const strategic = graph.sections.find(([name]) => name === 'strategic')?.[1];
  const tactical = graph.sections.find(([name]) => name === 'tactical')?.[1];
  const options = object(strategic === undefined ? object(tactical).options : object(strategic).options);
  const { bloodAndGore, ...strategicOptions } = options;
  const sections = graph.sections.map(([name, value]): readonly [string, Json] => {
    if (name === 'strategic') return [name, { ...object(value), options: strategicOptions }];
    if (name !== 'tactical') return [name, value];
    const t = object(value);
    return [
      name,
      {
        ...t,
        options: { gunNut: options.gunNut ?? false, bloodAndGore: bloodAndGore ?? true },
        equipment: legacyEquipment(object(t.equipment), options),
        perception: legacyPerception(object(t.perception), options.difficulty ?? 2),
        turn: withoutLastMercKill(object(t.turn)),
      },
    ];
  });
  const legacyGraph: EncodedGraph = { ...graph, sections };
  return { ...snapshot, version: 1, graph: legacyGraph };
}

describe('snapshot version 1 (separate option copies) migrates to the unified game options', () => {
  let kit: StubSectorKit;
  const exists = (path: string) => kit.worlds.exists(path);

  beforeAll(async () => {
    kit = await loadStubSectorKit();
  });

  afterAll(async () => {
    await kit.dispose();
  });

  async function expectMigratesExactly(sim: SessionSim): Promise<void> {
    const current: SessionSnapshot = snapshotSession(sim);
    const legacy = versionOne(current.sim);
    expect(snapshotJson(migrateSnapshot(JSON.parse(JSON.stringify(legacy))))).toBe(snapshotJson(current.sim));
    const restored = await restoreSession(JSON.parse(JSON.stringify({ ...current, sim: legacy })), kit.read, exists);
    expect(JSON.stringify(snapshotSession(restored))).toBe(JSON.stringify(current));
  }

  it(
    'a sandbox keeps difficulty, sci-fi, gun nut and blood and gore',
    async () => {
      const sandbox = await createSandboxSession(kit.read, false, 5);
      sandbox.dispatch({ type: 'setOption', bloodAndGore: false });
      await expectMigratesExactly(sandbox);
    },
    SCENARIO_TIMEOUT_MS,
  );

  it(
    'a landed campaign shares one options object between the layers again',
    async () => {
      const campaign = await createCampaignSession(kit.read, exists, 9, { options: { difficulty: 3, gunNut: true } });
      expect(campaign.campaign.tactical?.state.options).toBe(campaign.campaign.state.options);
      await expectMigratesExactly(campaign);
    },
    SCENARIO_TIMEOUT_MS,
  );
});

function withSpriteFrames(value: Json, presentation: PresentationTimeline): Json {
  if (Array.isArray(value)) return value.map((v: Json) => withSpriteFrames(v, presentation));
  if (typeof value !== 'object' || value === null) return value;
  const out: Record<string, Json> = {};
  for (const [key, v] of Object.entries(value)) {
    if (key === 'frameSlot' && typeof v === 'number') out.frame = spriteFrameAt(presentation, v);
    else out[key] = withSpriteFrames(v, presentation);
  }
  return out;
}

function versionTwo(snapshot: SimSnapshot, presentation: PresentationTimeline): SimSnapshot {
  const sections = snapshot.graph.sections.map(([name, value]): readonly [string, Json] => [name, withSpriteFrames(value, presentation)]);
  return { ...snapshot, version: 2, graph: { ...snapshot.graph, sections } };
}

describe('snapshot version 2 (sprite frames in the soldiers) migrates to frame slots', () => {
  let kit: StubSectorKit;
  const exists = (path: string) => kit.worlds.exists(path);
  const STEP_SOUTH = 320;
  const MOVE_TICKS = 13;
  const AFTER_TICKS = 300;

  beforeAll(async () => {
    kit = await loadStubSectorKit();
  });

  afterAll(async () => {
    await kit.dispose();
  });

  async function expectSameViews(session: SessionSim & { readonly presentation: PresentationTimeline }): Promise<void> {
    const current = snapshotSession(session);
    const legacy = { ...current, sim: versionTwo(current.sim, session.presentation) };
    expect(JSON.stringify(legacy.sim)).toContain('"frame":');
    expect(() => migrateSnapshot(JSON.parse(JSON.stringify(legacy.sim)))).toThrow(/animation timelines/);
    const restored = await restoreSession(JSON.parse(JSON.stringify(legacy)), kit.read, exists);
    expect(restored.view()).toEqual(session.view());
    for (const s of [session, restored]) for (let i = 0; i < AFTER_TICKS; i++) s.step();
    expect(restored.view()).toEqual(session.view());
  }

  it(
    'a sandbox in the middle of a run keeps its frames and continues the same',
    async () => {
      const sandbox = await createSandboxSession(kit.read, false, 5);
      for (const merc of sandbox.view().soldiers.filter((s) => s.team === 0))
        sandbox.dispatch({ type: 'move', soldier: merc.id, to: merc.gridNo + STEP_SOUTH, mode: 'run' });
      for (let i = 0; i < MOVE_TICKS; i++) sandbox.step();
      await expectSameViews(sandbox);
    },
    SCENARIO_TIMEOUT_MS,
  );

  it(
    'a landed campaign keeps its frames and continues the same',
    async () => {
      await expectSameViews(await createCampaignSession(kit.read, exists, 9));
    },
    SCENARIO_TIMEOUT_MS,
  );
});

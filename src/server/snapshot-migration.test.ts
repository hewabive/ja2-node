import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadStubSectorKit, type StubSectorKit } from '../../tests/support/sectors.ts';
import { type PresentationTimeline, spriteFrameAt } from '../content/anim/timelines.ts';
import type { EncodedGraph, Json } from '../sim/snapshot/codec.ts';
import { migrateSnapshot, type SimSnapshot, snapshotJson } from '../sim/snapshot/session.ts';
import { BloodKind, internalDropBlood } from '../sim/tactical/smell.ts';
import type { RealtimeClock } from '../sim/tactical/state.ts';
import { createCampaignSession } from './campaign-factory.ts';
import { createSandboxSession } from './sandbox.ts';
import type { SessionSim } from './session.ts';
import { restoreSession, type SessionSnapshot, snapshotSession } from './session-snapshot.ts';

type JsonObject = { readonly [key: string]: Json };

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

  it('a sandbox keeps difficulty, sci-fi, gun nut and blood and gore', async () => {
    const sandbox = await createSandboxSession(kit.read, false, 5);
    sandbox.dispatch({ type: 'setOption', bloodAndGore: false });
    await expectMigratesExactly(sandbox);
  });

  it('a landed campaign shares one options object between the layers again', async () => {
    const campaign = await createCampaignSession(kit.read, exists, 9, { options: { difficulty: 3, gunNut: true } });
    expect(campaign.campaign.tactical?.state.options).toBe(campaign.campaign.state.options);
    await expectMigratesExactly(campaign);
  });
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

  it('a sandbox in the middle of a run keeps its frames and continues the same', async () => {
    const sandbox = await createSandboxSession(kit.read, false, 5);
    for (const merc of sandbox.view().soldiers.filter((s) => s.team === 0))
      sandbox.dispatch({ type: 'move', soldier: merc.id, to: merc.gridNo + STEP_SOUTH, mode: 'run' });
    for (let i = 0; i < MOVE_TICKS; i++) sandbox.step();
    await expectSameViews(sandbox);
  });

  it('a landed campaign keeps its frames and continues the same', async () => {
    await expectSameViews(await createCampaignSession(kit.read, exists, 9));
  });
});

function versionFour(snapshot: SimSnapshot): SimSnapshot {
  const sections = snapshot.graph.sections.map(([name, value]): readonly [string, Json] => {
    if (name !== 'strategic') return [name, value];
    const strategic = object(value);
    const { newMail, ...laptop } = object(strategic.laptop);
    expect(newMail).toBe(false);
    return [name, { ...strategic, laptop }];
  });
  return { ...snapshot, version: 4, graph: { ...snapshot.graph, sections } };
}

describe('snapshot version 4 (no new-mail flag) migrates with the flag down', () => {
  let kit: StubSectorKit;
  const exists = (path: string) => kit.worlds.exists(path);

  beforeAll(async () => {
    kit = await loadStubSectorKit();
  });

  afterAll(async () => {
    await kit.dispose();
  });

  it('a campaign in the laptop restores the same laptop with newMail false', async () => {
    const campaign = await createCampaignSession(kit.read, exists, 9, { hire: [] });
    expect(campaign.campaign.state.laptop.newMail).toBe(true);
    campaign.campaign.state.laptop.newMail = false;
    const current = snapshotSession(campaign);
    const legacy = versionFour(current.sim);
    expect(JSON.stringify(legacy)).not.toContain('"newMail"');
    expect(migrateSnapshot(JSON.parse(JSON.stringify(legacy)))).toEqual(JSON.parse(JSON.stringify(current.sim)));
    const restored = await restoreSession(JSON.parse(JSON.stringify({ ...current, sim: legacy })), kit.read, exists);
    expect(restored.view().laptop?.newMail).toBe(false);
    expect(restored.view()).toEqual(campaign.view());
  });
});

function versionNine(snapshot: SimSnapshot): SimSnapshot {
  const sections = snapshot.graph.sections.map(([name, value]): readonly [string, Json] => {
    if (name !== 'tactical') return [name, value];
    const tactical = object(value);
    const { reevaluateBlood, shownPools, ...smell } = object(tactical.smell);
    expect(reevaluateBlood).toBeDefined();
    expect(shownPools).toBeDefined();
    return [name, { ...tactical, smell }];
  });
  return { ...snapshot, version: 9, graph: { ...snapshot.graph, sections } };
}

describe('snapshot version 9 (no blood graphics) migrates with every pool waiting to be seen', () => {
  let kit: StubSectorKit;
  const exists = (path: string) => kit.worlds.exists(path);
  const POOL_AT = 12_000;
  const POOL_STRENGTH = 5;
  const UNSEEN = -1;

  beforeAll(async () => {
    kit = await loadStubSectorKit();
  });

  afterAll(async () => {
    await kit.dispose();
  });

  it('a sandbox with blood nobody saw restores the same blood map and shows no pool yet', async () => {
    const sandbox = await createSandboxSession(kit.read, false, 5);
    const t = sandbox.sim.state;
    internalDropBlood(t, POOL_AT, 0, BloodKind.HUMAN, POOL_STRENGTH, UNSEEN);
    const current = snapshotSession(sandbox);
    const legacy = versionNine(current.sim);
    expect(JSON.stringify(legacy)).not.toContain('"shownPools"');
    expect(migrateSnapshot(JSON.parse(JSON.stringify(legacy)))).toEqual(JSON.parse(JSON.stringify(current.sim)));
    const restored = await restoreSession(JSON.parse(JSON.stringify({ ...current, sim: legacy })), kit.read, exists);
    expect(restored.view().blood).toEqual([]);
    expect(restored.view()).toEqual(sandbox.view());
  });
});

const LEGACY_DECAY_MS = 41_234;

function withTacticalMsDecayStamp(value: Json): Json {
  if (Array.isArray(value)) return value.map((v: Json) => withTacticalMsDecayStamp(v));
  if (typeof value !== 'object' || value === null) return value;
  const out: Record<string, Json> = {};
  for (const [key, v] of Object.entries(value)) {
    if (key === 'lastOpplistDecaySeconds') out.lastDecayMs = LEGACY_DECAY_MS;
    else out[key] = withTacticalMsDecayStamp(v);
  }
  return out;
}

function versionTen(snapshot: SimSnapshot): SimSnapshot {
  const sections = snapshot.graph.sections.map(([name, value]): readonly [string, Json] => [name, withTacticalMsDecayStamp(value)]);
  return { ...snapshot, version: 10, graph: { ...snapshot.graph, sections } };
}

describe('snapshot version 10 (opplist decay on the tactical clock) migrates to a world-second stamp', () => {
  let kit: StubSectorKit;
  const exists = (path: string) => kit.worlds.exists(path);

  beforeAll(async () => {
    kit = await loadStubSectorKit();
  });

  afterAll(async () => {
    await kit.dispose();
  });

  async function expectDecayDueAtNextRealtimeTurn(session: SessionSim, clock: RealtimeClock): Promise<void> {
    clock.lastOpplistDecaySeconds = 0;
    const current = snapshotSession(session);
    const legacy = versionTen(current.sim);
    expect(JSON.stringify(legacy)).toContain(`"lastDecayMs":${LEGACY_DECAY_MS}`);
    expect(JSON.stringify(legacy)).not.toContain('"lastOpplistDecaySeconds"');
    expect(migrateSnapshot(JSON.parse(JSON.stringify(legacy)))).toEqual(JSON.parse(JSON.stringify(current.sim)));
    const restored = await restoreSession(JSON.parse(JSON.stringify({ ...current, sim: legacy })), kit.read, exists);
    expect(JSON.stringify(snapshotSession(restored))).toBe(JSON.stringify(current));
  }

  it('a sandbox decays at its next real-time turn', async () => {
    const sandbox = await createSandboxSession(kit.read, false, 5);
    await expectDecayDueAtNextRealtimeTurn(sandbox, sandbox.sim.state.realtimeClock);
  });

  it('a landed campaign keeps one clock for the sector flow and the loaded sector', async () => {
    const campaign = await createCampaignSession(kit.read, exists, 9);
    const clock = campaign.campaign.state.sectorFlow.realtimeClock;
    expect(campaign.campaign.tactical?.state.realtimeClock).toBe(clock);
    await expectDecayDueAtNextRealtimeTurn(campaign, clock);
  });
});

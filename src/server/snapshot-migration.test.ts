import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadStubSectorKit, type StubSectorKit } from '../../tests/support/sectors.ts';
import { type PresentationTimeline, spriteFrameAt } from '../content/anim/timelines.ts';
import { WORLD_COLS, WORLD_MAX } from '../content/world/grid.ts';
import { emptySectorDiff, sectorKey } from '../sim/campaign/sector-diff.ts';
import { encodeBase64 } from '../sim/snapshot/base64.ts';
import type { EncodedGraph, Json } from '../sim/snapshot/codec.ts';
import { migrateSnapshot, type SimSnapshot, snapshotJson } from '../sim/snapshot/session.ts';
import type { DoorStatusEntry } from '../sim/tactical/doors/door-status.ts';
import { handleDoorChangeFromGridNo, isDoorOpenAt } from '../sim/tactical/doors.ts';
import { BloodKind, internalDropBlood } from '../sim/tactical/smell.ts';
import { Team, TOTAL_SOLDIERS } from '../sim/tactical/soldier.ts';
import { type RealtimeClock, type TacticalState, teamMembers } from '../sim/tactical/state.ts';
import { createCampaignSession } from './campaign-factory.ts';
import { createSandboxSession } from './sandbox.ts';
import type { SessionSim } from './session.ts';
import { restoreSession, type SessionSnapshot, snapshotSession } from './session-snapshot.ts';

type JsonObject = { readonly [key: string]: Json };

const NOBODY_PREFERRED = -1;

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
    else if (key !== 'lastRottingCorpsesSeconds' && !CREATURE_TENSE_QUOTE_KEYS.includes(key)) out[key] = withTacticalMsDecayStamp(v);
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
    clock.lastRottingCorpsesSeconds = 0;
    resetCreatureTenseQuoteTimer(clock);
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

const LAST_KNOWN_LEVEL_KEYS: ReadonlySet<string> = new Set(['lastKnownOppLevel', 'publicLastKnownLevel']);

function withoutLastKnownLevels(value: Json): Json {
  if (Array.isArray(value)) return value.map((v: Json) => withoutLastKnownLevels(v));
  if (typeof value !== 'object' || value === null) return value;
  const out: Record<string, Json> = {};
  for (const [key, v] of Object.entries(value)) if (!LAST_KNOWN_LEVEL_KEYS.has(key)) out[key] = withoutLastKnownLevels(v);
  return out;
}

function versionEleven(snapshot: SimSnapshot): SimSnapshot {
  const sections = snapshot.graph.sections.map(([name, value]): readonly [string, Json] => [name, withoutLastKnownLevels(value)]);
  return { ...snapshot, version: 11, graph: { ...snapshot.graph, sections } };
}

describe('snapshot version 11 (no last-known levels) migrates with every last-known level on the ground', () => {
  let kit: StubSectorKit;
  const exists = (path: string) => kit.worlds.exists(path);

  beforeAll(async () => {
    kit = await loadStubSectorKit();
  });

  afterAll(async () => {
    await kit.dispose();
  });

  async function expectGroundLevels(session: SessionSim): Promise<void> {
    const current = snapshotSession(session);
    const legacy = versionEleven(current.sim);
    for (const key of LAST_KNOWN_LEVEL_KEYS) expect(JSON.stringify(legacy)).not.toContain(`"${key}"`);
    expect(migrateSnapshot(JSON.parse(JSON.stringify(legacy)))).toEqual(JSON.parse(JSON.stringify(current.sim)));
    const restored = await restoreSession(JSON.parse(JSON.stringify({ ...current, sim: legacy })), kit.read, exists);
    expect(JSON.stringify(snapshotSession(restored))).toBe(JSON.stringify(current));
  }

  it('a sandbox', async () => {
    await expectGroundLevels(await createSandboxSession(kit.read, false, 5));
  });

  it('a landed campaign', async () => {
    await expectGroundLevels(await createCampaignSession(kit.read, exists, 9));
  });
});

const FADE_STATE_KEYS: ReadonlySet<string> = new Set(['fadeShade', 'fadeStartGridNo', 'landMaxLight', 'roofMaxLight']);
const NEVER_RENDERED = -1;

function mapRecords(value: Json, map: (o: Record<string, Json>) => Record<string, Json>): Json {
  if (Array.isArray(value)) return value.map((v: Json) => mapRecords(v, map));
  if (typeof value !== 'object' || value === null) return value;
  const out: Record<string, Json> = {};
  for (const [key, v] of Object.entries(value)) out[key] = mapRecords(v, map);
  return map(out);
}

function withoutFadeState(o: Record<string, Json>): Record<string, Json> {
  const out: Record<string, Json> = {};
  for (const [key, v] of Object.entries(o)) {
    if (key === 'fade' && o.fadeStartGridNo !== undefined) out.fadeStep = o.fadeShade as Json;
    else if (key === 'lastRenderVisible') out[key] = NEVER_RENDERED;
    else if (!FADE_STATE_KEYS.has(key)) out[key] = v;
  }
  return out;
}

function withFadeDefaults(o: Record<string, Json>): Record<string, Json> {
  if (o.fadeStartGridNo !== undefined) return { ...o, lastRenderVisible: o.visible as Json, fade: 0, fadeStartGridNo: -1 };
  if (o.landMaxLight !== undefined) return { ...o, landMaxLight: o.landLight as Json, roofMaxLight: o.roofLight as Json };
  return o;
}

function mapSections(snapshot: SimSnapshot, version: number, map: (o: Record<string, Json>) => Record<string, Json>): SimSnapshot {
  const sections = snapshot.graph.sections.map(([name, value]): readonly [string, Json] => [name, mapRecords(value, map)]);
  return { ...snapshot, version, graph: { ...snapshot.graph, sections } };
}

describe('snapshot version 12 (no fade state) migrates with every soldier settled at his visibility and the strongest light at the sum', () => {
  let kit: StubSectorKit;
  const exists = (path: string) => kit.worlds.exists(path);

  beforeAll(async () => {
    kit = await loadStubSectorKit();
  });

  afterAll(async () => {
    await kit.dispose();
  });

  async function expectSettledFades(session: SessionSim): Promise<void> {
    const current = snapshotSession(session);
    const legacy = mapSections(current.sim, 12, withoutFadeState);
    for (const key of FADE_STATE_KEYS) expect(JSON.stringify(legacy)).not.toContain(`"${key}"`);
    const expected = mapSections(current.sim, current.sim.version, withFadeDefaults);
    expect(migrateSnapshot(JSON.parse(JSON.stringify(legacy)))).toEqual(JSON.parse(JSON.stringify(expected)));
    const restored = await restoreSession(JSON.parse(JSON.stringify({ ...current, sim: legacy })), kit.read, exists);
    expect(JSON.stringify(snapshotSession(restored))).toBe(JSON.stringify({ ...current, sim: expected }));
  }

  it('a sandbox', async () => {
    await expectSettledFades(await createSandboxSession(kit.read, false, 5));
  });

  it('a landed campaign', async () => {
    await expectSettledFades(await createCampaignSession(kit.read, exists, 9));
  });
});

function versionThirteen(snapshot: SimSnapshot): SimSnapshot {
  const sections = snapshot.graph.sections.map(([name, value]): readonly [string, Json] => {
    if (name !== 'tactical') return [name, value];
    const tactical = object(value);
    const { potentialTeamChangeDuringDeath, ...turn } = object(tactical.turn);
    expect(potentialTeamChangeDuringDeath).toBe(false);
    return [name, { ...tactical, turn }];
  });
  return { ...snapshot, version: 13, graph: { ...snapshot.graph, sections } };
}

describe('snapshot version 13 (no team-change flag) migrates with the flag down', () => {
  let kit: StubSectorKit;
  const exists = (path: string) => kit.worlds.exists(path);

  beforeAll(async () => {
    kit = await loadStubSectorKit();
  });

  afterAll(async () => {
    await kit.dispose();
  });

  async function expectFlagDown(session: SessionSim): Promise<void> {
    const current = snapshotSession(session);
    const legacy = versionThirteen(current.sim);
    expect(JSON.stringify(legacy)).not.toContain('"potentialTeamChangeDuringDeath"');
    expect(snapshotJson(migrateSnapshot(JSON.parse(JSON.stringify(legacy))))).toBe(snapshotJson(current.sim));
    const restored = await restoreSession(JSON.parse(JSON.stringify({ ...current, sim: legacy })), kit.read, exists);
    expect(JSON.stringify(snapshotSession(restored))).toBe(JSON.stringify(current));
  }

  it('a sandbox', async () => {
    await expectFlagDown(await createSandboxSession(kit.read, false, 5));
  });

  it('a landed campaign', async () => {
    await expectFlagDown(await createCampaignSession(kit.read, exists, 9));
  });
});

const ITEM_LOOKING_DEFAULTS: Readonly<Record<string, Json>> = {
  lookForItems: false,
  itemsSeenOnAttack: null,
  itemsSeenOnAttackGridNo: -1,
  lockItemLocators: false,
};

function withoutItemLooking(o: Record<string, Json>): Record<string, Json> {
  const out: Record<string, Json> = {};
  for (const [key, v] of Object.entries(o)) {
    if (!(key in ITEM_LOOKING_DEFAULTS)) out[key] = v;
    else expect(v).toEqual(ITEM_LOOKING_DEFAULTS[key]);
  }
  return out;
}

describe('snapshot version 14 (no item looking state) migrates with nobody looking for items and the item locators unlocked', () => {
  let kit: StubSectorKit;
  const exists = (path: string) => kit.worlds.exists(path);

  beforeAll(async () => {
    kit = await loadStubSectorKit();
  });

  afterAll(async () => {
    await kit.dispose();
  });

  async function expectNobodyLooking(session: SessionSim): Promise<void> {
    const current = snapshotSession(session);
    const legacy = mapSections(current.sim, 14, withoutItemLooking);
    for (const key of Object.keys(ITEM_LOOKING_DEFAULTS)) expect(JSON.stringify(legacy)).not.toContain(`"${key}"`);
    expect(snapshotJson(migrateSnapshot(JSON.parse(JSON.stringify(legacy))))).toBe(snapshotJson(current.sim));
    const restored = await restoreSession(JSON.parse(JSON.stringify({ ...current, sim: legacy })), kit.read, exists);
    expect(JSON.stringify(snapshotSession(restored))).toBe(JSON.stringify(current));
  }

  it('a sandbox', async () => {
    await expectNobodyLooking(await createSandboxSession(kit.read, false, 5));
  });

  it('a landed campaign', async () => {
    await expectNobodyLooking(await createCampaignSession(kit.read, exists, 9));
  });
});

function versionFifteen(snapshot: SimSnapshot): SimSnapshot {
  const sections = snapshot.graph.sections.map(([name, value]): readonly [string, Json] => {
    if (name !== 'strategic') return [name, value];
    const strategic = object(value);
    const { trashedMapRestrictedScroll, preferredSelection, ...sectorFlow } = object(strategic.sectorFlow);
    expect([trashedMapRestrictedScroll, preferredSelection]).toEqual([0, NOBODY_PREFERRED]);
    return [name, { ...strategic, sectorFlow }];
  });
  return { ...snapshot, version: 15, graph: { ...snapshot.graph, sections } };
}

describe('snapshot version 15 (no trashed map) migrates with the full map as the one trashed last', () => {
  let kit: StubSectorKit;
  const exists = (path: string) => kit.worlds.exists(path);

  beforeAll(async () => {
    kit = await loadStubSectorKit();
  });

  afterAll(async () => {
    await kit.dispose();
  });

  it('a landed campaign', async () => {
    const campaign = await createCampaignSession(kit.read, exists, 9);
    const current = snapshotSession(campaign);
    const legacy = versionFifteen(current.sim);
    expect(JSON.stringify(legacy)).not.toContain('"trashedMapRestrictedScroll"');
    expect(snapshotJson(migrateSnapshot(JSON.parse(JSON.stringify(legacy))))).toBe(snapshotJson(current.sim));
    const restored = await restoreSession(JSON.parse(JSON.stringify({ ...current, sim: legacy })), kit.read, exists);
    expect(JSON.stringify(snapshotSession(restored))).toBe(JSON.stringify(current));
  });
});

function versionSixteen(snapshot: SimSnapshot, held: boolean): SimSnapshot {
  const sections = snapshot.graph.sections.map(([name, value]): readonly [string, Json] => {
    if (name !== 'tactical') return [name, value];
    const tactical = object(value);
    const turn = object(tactical.turn);
    expect(turn.killedEnemyOnAttack).toBeNull();
    return [name, { ...tactical, turn: { ...turn, killedEnemyOnAttack: held } }];
  });
  return { ...snapshot, version: 16, graph: { ...snapshot.graph, sections } };
}

describe('snapshot version 16 (a bare kill flag) migrates with no kill held for its quote', () => {
  let kit: StubSectorKit;
  const exists = (path: string) => kit.worlds.exists(path);

  beforeAll(async () => {
    kit = await loadStubSectorKit();
  });

  afterAll(async () => {
    await kit.dispose();
  });

  async function expectNoKillHeld(session: SessionSim): Promise<void> {
    const current = snapshotSession(session);
    for (const held of [false, true]) {
      const legacy = versionSixteen(current.sim, held);
      expect(snapshotJson(migrateSnapshot(JSON.parse(JSON.stringify(legacy))))).toBe(snapshotJson(current.sim));
      const restored = await restoreSession(JSON.parse(JSON.stringify({ ...current, sim: legacy })), kit.read, exists);
      expect(JSON.stringify(snapshotSession(restored))).toBe(JSON.stringify(current));
    }
  }

  it('a sandbox', async () => {
    await expectNoKillHeld(await createSandboxSession(kit.read, false, 5));
  });

  it('a landed campaign', async () => {
    await expectNoKillHeld(await createCampaignSession(kit.read, exists, 9));
  });
});

function versionSeventeen(snapshot: SimSnapshot): SimSnapshot {
  const sections = snapshot.graph.sections.map(([name, value]): readonly [string, Json] => {
    if (name !== 'tactical') return [name, value];
    const tactical = object(value);
    const { playerTeamSawCreatures, ...perception } = object(tactical.perception);
    expect(playerTeamSawCreatures).toBe(0);
    return [name, { ...tactical, perception }];
  });
  return { ...snapshot, version: 17, graph: { ...snapshot.graph, sections } };
}

describe('snapshot version 17 (no sighted-creature flag) migrates with no creature seen by the last look', () => {
  let kit: StubSectorKit;
  const exists = (path: string) => kit.worlds.exists(path);

  beforeAll(async () => {
    kit = await loadStubSectorKit();
  });

  afterAll(async () => {
    await kit.dispose();
  });

  async function expectNoCreatureSeen(session: SessionSim): Promise<void> {
    const current = snapshotSession(session);
    const legacy = versionSeventeen(current.sim);
    expect(snapshotJson(migrateSnapshot(JSON.parse(JSON.stringify(legacy))))).toBe(snapshotJson(current.sim));
    const restored = await restoreSession(JSON.parse(JSON.stringify({ ...current, sim: legacy })), kit.read, exists);
    expect(JSON.stringify(snapshotSession(restored))).toBe(JSON.stringify(current));
  }

  it('a sandbox', async () => {
    await expectNoCreatureSeen(await createSandboxSession(kit.read, false, 5));
  });

  it('a landed campaign', async () => {
    await expectNoCreatureSeen(await createCampaignSession(kit.read, exists, 9));
  });
});

function versionEighteen(snapshot: SimSnapshot): SimSnapshot {
  const sections = snapshot.graph.sections.map(([name, value]): readonly [string, Json] => {
    if (name !== 'strategic') return [name, value];
    const strategic = object(value);
    const { reEvaluateNothingToDo, ...economy } = object(strategic.economy);
    expect(reEvaluateNothingToDo).toBe(false);
    return [name, { ...strategic, economy }];
  });
  return { ...snapshot, version: 18, graph: { ...snapshot.graph, sections } };
}

describe('snapshot version 18 (no nothing-to-do flag) migrates with no re-evaluation pending', () => {
  let kit: StubSectorKit;
  const exists = (path: string) => kit.worlds.exists(path);

  beforeAll(async () => {
    kit = await loadStubSectorKit();
  });

  afterAll(async () => {
    await kit.dispose();
  });

  it('a landed campaign', async () => {
    const campaign = await createCampaignSession(kit.read, exists, 9);
    const current = snapshotSession(campaign);
    const legacy = versionEighteen(current.sim);
    expect(JSON.stringify(legacy)).not.toContain('"reEvaluateNothingToDo"');
    expect(snapshotJson(migrateSnapshot(JSON.parse(JSON.stringify(legacy))))).toBe(snapshotJson(current.sim));
    const restored = await restoreSession(JSON.parse(JSON.stringify({ ...current, sim: legacy })), kit.read, exists);
    expect(JSON.stringify(snapshotSession(restored))).toBe(JSON.stringify(current));
  });
});

function versionNineteen(snapshot: SimSnapshot): SimSnapshot {
  const sections = snapshot.graph.sections.map(([name, value]): readonly [string, Json] => {
    if (name !== 'strategic') return [name, value];
    const strategic = object(value);
    const clock = object(strategic.clock);
    expect(clock.compressedSinceMapEntry).toBeUndefined();
    return [name, { ...strategic, clock: { ...clock, compressedSinceMapEntry: true } }];
  });
  return { ...snapshot, version: 19, graph: { ...snapshot.graph, sections } };
}

describe('snapshot version 19 (a compressed-since-map-entry flag) migrates without it, as every compression start clears', () => {
  let kit: StubSectorKit;
  const exists = (path: string) => kit.worlds.exists(path);

  beforeAll(async () => {
    kit = await loadStubSectorKit();
  });

  afterAll(async () => {
    await kit.dispose();
  });

  it('a landed campaign', async () => {
    const campaign = await createCampaignSession(kit.read, exists, 9);
    const current = snapshotSession(campaign);
    const legacy = versionNineteen(current.sim);
    expect(JSON.stringify(legacy)).toContain('"compressedSinceMapEntry"');
    expect(snapshotJson(migrateSnapshot(JSON.parse(JSON.stringify(legacy))))).toBe(snapshotJson(current.sim));
    const restored = await restoreSession(JSON.parse(JSON.stringify({ ...current, sim: legacy })), kit.read, exists);
    expect(JSON.stringify(snapshotSession(restored))).toBe(JSON.stringify(current));
  });
});

function versionTwenty(snapshot: SimSnapshot): SimSnapshot {
  const sections = snapshot.graph.sections.map(([name, value]): readonly [string, Json] => {
    if (name !== 'strategic') return [name, value];
    const strategic = object(value);
    const { movement, ...cosmetic } = object(strategic.cosmetic);
    expect(movement).toBeDefined();
    return [name, { ...strategic, cosmetic }];
  });
  return { ...snapshot, version: 20, graph: { ...snapshot.graph, sections } };
}

function movementStream(snapshot: SimSnapshot): Json | undefined {
  const strategic = snapshot.graph.sections.find(([name]) => name === 'strategic')?.[1];
  return object(object(strategic).cosmetic).movement;
}

describe('snapshot version 20 (no strategic movement cosmetic stream) migrates with one seeded from the helicopter stream', () => {
  let kit: StubSectorKit;
  const exists = (path: string) => kit.worlds.exists(path);

  beforeAll(async () => {
    kit = await loadStubSectorKit();
  });

  afterAll(async () => {
    await kit.dispose();
  });

  it('a landed campaign', async () => {
    const campaign = await createCampaignSession(kit.read, exists, 9);
    const current = snapshotSession(campaign);
    const legacy = versionTwenty(current.sim);
    const migrated = migrateSnapshot(JSON.parse(JSON.stringify(legacy)));
    const stream = movementStream(migrated);
    expect(object(stream).$rng).toHaveLength(4);
    expect(movementStream(migrateSnapshot(JSON.parse(JSON.stringify(legacy))))).toEqual(stream);
    const restored = await restoreSession(JSON.parse(JSON.stringify({ ...current, sim: legacy })), kit.read, exists);
    expect(movementStream(snapshotSession(restored).sim)).toEqual(stream);
  });
});

const CORPSE_AT = 12_345;
const SMERC_FWD = 3;

function withoutHeadTaken(value: Json): Json {
  if (Array.isArray(value)) return value.map((v: Json) => withoutHeadTaken(v));
  if (typeof value !== 'object' || value === null) return value;
  const out: Record<string, Json> = {};
  for (const [key, v] of Object.entries(value)) if (key !== 'headTaken') out[key] = withoutHeadTaken(v);
  return out;
}

function versionTwentyOne(snapshot: SimSnapshot): SimSnapshot {
  const sections = snapshot.graph.sections.map(([name, value]): readonly [string, Json] => [name, withoutHeadTaken(value)]);
  return { ...snapshot, version: 21, graph: { ...snapshot.graph, sections } };
}

describe('snapshot version 21 (corpses without a taken head) migrates with every head still on', () => {
  let kit: StubSectorKit;
  const exists = (path: string) => kit.worlds.exists(path);

  beforeAll(async () => {
    kit = await loadStubSectorKit();
  });

  afterAll(async () => {
    await kit.dispose();
  });

  it('a sandbox with a corpse', async () => {
    const sandbox = await createSandboxSession(kit.read, false, 5);
    sandbox.sim.state.corpses.push({
      gridNo: CORPSE_AT,
      level: 0,
      heightAdjustment: 0,
      bodyType: 0,
      direction: 0,
      state: 0,
      profile: 200,
      type: SMERC_FWD,
      timeOfDeath: 0,
      headTaken: false,
      servicingCrows: 0,
    });
    const current = snapshotSession(sandbox);
    const legacy = versionTwentyOne(current.sim);
    expect(JSON.stringify(current.sim)).toContain('"headTaken"');
    expect(JSON.stringify(legacy)).not.toContain('"headTaken"');
    expect(snapshotJson(migrateSnapshot(JSON.parse(JSON.stringify(legacy))))).toBe(snapshotJson(current.sim));
    const restored = await restoreSession(JSON.parse(JSON.stringify({ ...current, sim: legacy })), kit.read, exists);
    expect(JSON.stringify(snapshotSession(restored))).toBe(JSON.stringify(current));
  });
});

function versionTwentyTwo(snapshot: SimSnapshot): SimSnapshot {
  const sections = snapshot.graph.sections.map(([name, value]): readonly [string, Json] => {
    if (name !== 'strategic') return [name, value];
    const strategic = object(value);
    const { preferredSelection, ...sectorFlow } = object(strategic.sectorFlow);
    expect(preferredSelection).toBe(NOBODY_PREFERRED);
    return [name, { ...strategic, sectorFlow }];
  });
  return { ...snapshot, version: 22, graph: { ...snapshot.graph, sections } };
}

describe('snapshot version 22 (no preferred selection) migrates with nobody preferred for the next sector load', () => {
  let kit: StubSectorKit;
  const exists = (path: string) => kit.worlds.exists(path);

  beforeAll(async () => {
    kit = await loadStubSectorKit();
  });

  afterAll(async () => {
    await kit.dispose();
  });

  it('a landed campaign', async () => {
    const campaign = await createCampaignSession(kit.read, exists, 9);
    const current = snapshotSession(campaign);
    const legacy = versionTwentyTwo(current.sim);
    expect(JSON.stringify(legacy)).not.toContain('"preferredSelection"');
    expect(snapshotJson(migrateSnapshot(JSON.parse(JSON.stringify(legacy))))).toBe(snapshotJson(current.sim));
    const restored = await restoreSession(JSON.parse(JSON.stringify({ ...current, sim: legacy })), kit.read, exists);
    expect(JSON.stringify(snapshotSession(restored))).toBe(JSON.stringify(current));
  });
});

function versionTwentyThree(snapshot: SimSnapshot): SimSnapshot {
  const sections = snapshot.graph.sections.map(([name, value]): readonly [string, Json] => {
    if (name !== 'tactical') return [name, value];
    const { pickedOwnershipCheck, ...tactical } = object(value);
    expect(pickedOwnershipCheck).toBeNull();
    return [name, tactical];
  });
  return { ...snapshot, version: 23, graph: { ...snapshot.graph, sections } };
}

describe('snapshot version 23 (no ownership check after a pickup) migrates with none pending', () => {
  let kit: StubSectorKit;
  const exists = (path: string) => kit.worlds.exists(path);

  beforeAll(async () => {
    kit = await loadStubSectorKit();
  });

  afterAll(async () => {
    await kit.dispose();
  });

  it('a sandbox', async () => {
    const sandbox = await createSandboxSession(kit.read, false, 5);
    const current = snapshotSession(sandbox);
    const legacy = versionTwentyThree(current.sim);
    expect(JSON.stringify(legacy)).not.toContain('"pickedOwnershipCheck"');
    expect(snapshotJson(migrateSnapshot(JSON.parse(JSON.stringify(legacy))))).toBe(snapshotJson(current.sim));
    const restored = await restoreSession(JSON.parse(JSON.stringify({ ...current, sim: legacy })), kit.read, exists);
    expect(JSON.stringify(snapshotSession(restored))).toBe(JSON.stringify(current));
  });
});

function withoutMissions(value: Json): Json {
  if (Array.isArray(value)) return value.map((v: Json) => withoutMissions(v));
  if (typeof value !== 'object' || value === null) return value;
  const out: Record<string, Json> = {};
  for (const [key, v] of Object.entries(value)) {
    if (key === 'mission') expect(v).toBe(0);
    else out[key] = withoutMissions(v);
  }
  return out;
}

function versionTwentyFour(snapshot: SimSnapshot): SimSnapshot {
  const sections = snapshot.graph.sections.map(([name, value]): readonly [string, Json] => [name, withoutMissions(value)]);
  return { ...snapshot, version: 24, graph: { ...snapshot.graph, sections } };
}

describe('snapshot version 24 (objects without ubMission) migrates with every object off any mission', () => {
  let kit: StubSectorKit;
  const exists = (path: string) => kit.worlds.exists(path);

  beforeAll(async () => {
    kit = await loadStubSectorKit();
  });

  afterAll(async () => {
    await kit.dispose();
  });

  it('a sandbox', async () => {
    const sandbox = await createSandboxSession(kit.read, false, 5);
    const current = snapshotSession(sandbox);
    const legacy = versionTwentyFour(current.sim);
    expect(JSON.stringify(current.sim)).toContain('"mission"');
    expect(JSON.stringify(legacy)).not.toContain('"mission"');
    expect(snapshotJson(migrateSnapshot(JSON.parse(JSON.stringify(legacy))))).toBe(snapshotJson(current.sim));
    const restored = await restoreSession(JSON.parse(JSON.stringify({ ...current, sim: legacy })), kit.read, exists);
    expect(JSON.stringify(snapshotSession(restored))).toBe(JSON.stringify(current));
  });

  it('a landed campaign', async () => {
    const campaign = await createCampaignSession(kit.read, exists, 9);
    const current = snapshotSession(campaign);
    const legacy = versionTwentyFour(current.sim);
    expect(JSON.stringify(legacy)).not.toContain('"mission"');
    expect(snapshotJson(migrateSnapshot(JSON.parse(JSON.stringify(legacy))))).toBe(snapshotJson(current.sim));
    const restored = await restoreSession(JSON.parse(JSON.stringify({ ...current, sim: legacy })), kit.read, exists);
    expect(JSON.stringify(snapshotSession(restored))).toBe(JSON.stringify(current));
  });
});

const BLEEDING_QUOTE_STATE: Readonly<Record<string, Json>> = { dyingComment: false, warnedAboutBleeding: false, meTooBleedLog: 0 };

function withoutBleedingQuoteState(value: Json): Json {
  if (Array.isArray(value)) return value.map((v: Json) => withoutBleedingQuoteState(v));
  if (typeof value !== 'object' || value === null) return value;
  const out: Record<string, Json> = {};
  for (const [key, v] of Object.entries(value)) {
    if (key in BLEEDING_QUOTE_STATE) expect(v).toBe(BLEEDING_QUOTE_STATE[key]);
    else out[key] = withoutBleedingQuoteState(v);
  }
  return out;
}

function versionTwentyFive(snapshot: SimSnapshot): SimSnapshot {
  const sections = snapshot.graph.sections.map(([name, value]): readonly [string, Json] => [name, withoutBleedingQuoteState(value)]);
  return { ...snapshot, version: 25, graph: { ...snapshot.graph, sections } };
}

describe('snapshot version 25 (no bleeding quote flags, no ME_TOO log) migrates with nothing said and the log closed', () => {
  let kit: StubSectorKit;
  const exists = (path: string) => kit.worlds.exists(path);

  beforeAll(async () => {
    kit = await loadStubSectorKit();
  });

  afterAll(async () => {
    await kit.dispose();
  });

  it('a sandbox', async () => {
    const sandbox = await createSandboxSession(kit.read, false, 5);
    const current = snapshotSession(sandbox);
    const legacy = versionTwentyFive(current.sim);
    expect(JSON.stringify(current.sim)).toContain('"warnedAboutBleeding"');
    expect(JSON.stringify(legacy)).not.toContain('"dyingComment"');
    expect(snapshotJson(migrateSnapshot(JSON.parse(JSON.stringify(legacy))))).toBe(snapshotJson(current.sim));
    const restored = await restoreSession(JSON.parse(JSON.stringify({ ...current, sim: legacy })), kit.read, exists);
    expect(JSON.stringify(snapshotSession(restored))).toBe(JSON.stringify(current));
  });

  it('a landed campaign', async () => {
    const campaign = await createCampaignSession(kit.read, exists, 9);
    const current = snapshotSession(campaign);
    const legacy = versionTwentyFive(current.sim);
    expect(JSON.stringify(current.sim)).toContain('"meTooBleedLog"');
    expect(JSON.stringify(legacy)).not.toContain('"meTooBleedLog"');
    expect(JSON.stringify(legacy)).not.toContain('"warnedAboutBleeding"');
    expect(snapshotJson(migrateSnapshot(JSON.parse(JSON.stringify(legacy))))).toBe(snapshotJson(current.sim));
    const restored = await restoreSession(JSON.parse(JSON.stringify({ ...current, sim: legacy })), kit.read, exists);
    expect(JSON.stringify(snapshotSession(restored))).toBe(JSON.stringify(current));
  });
});

function withoutLinePauseFlag(value: Json): Json {
  if (Array.isArray(value)) return value.map((v: Json) => withoutLinePauseFlag(v));
  if (typeof value !== 'object' || value === null) return value;
  const out: Record<string, Json> = {};
  for (const [key, v] of Object.entries(value)) {
    if (key === 'pausedForLine') expect(v).toBe(false);
    else out[key] = withoutLinePauseFlag(v);
  }
  return out;
}

function versionTwentySix(snapshot: SimSnapshot): SimSnapshot {
  const sections = snapshot.graph.sections.map(([name, value]): readonly [string, Json] => [name, withoutLinePauseFlag(value)]);
  return { ...snapshot, version: 26, graph: { ...snapshot.graph, sections } };
}

describe('snapshot version 26 (no map screen line pause flag) migrates with no line holding the pause', () => {
  let kit: StubSectorKit;
  const exists = (path: string) => kit.worlds.exists(path);

  beforeAll(async () => {
    kit = await loadStubSectorKit();
  });

  afterAll(async () => {
    await kit.dispose();
  });

  it('a landed campaign', async () => {
    const campaign = await createCampaignSession(kit.read, exists, 9);
    const current = snapshotSession(campaign);
    const legacy = versionTwentySix(current.sim);
    expect(JSON.stringify(current.sim)).toContain('"pausedForLine"');
    expect(JSON.stringify(legacy)).not.toContain('"pausedForLine"');
    expect(snapshotJson(migrateSnapshot(JSON.parse(JSON.stringify(legacy))))).toBe(snapshotJson(current.sim));
    const restored = await restoreSession(JSON.parse(JSON.stringify({ ...current, sim: legacy })), kit.read, exists);
    expect(JSON.stringify(snapshotSession(restored))).toBe(JSON.stringify(current));
  });
});

const GASSED_KEY = 'gassed';

function withoutSoldierGassedFlag(value: Json, gassedIds: number[]): Json {
  if (Array.isArray(value)) return value.map((v: Json) => withoutSoldierGassedFlag(v, gassedIds));
  if (typeof value !== 'object' || value === null) return value;
  const o = value as JsonObject;
  const soldier = typeof o[GASSED_KEY] === 'boolean' && o.cowering !== undefined;
  if (soldier && o[GASSED_KEY] === true) gassedIds.push(o.id as number);
  const out: Record<string, Json> = {};
  for (const [key, v] of Object.entries(o)) if (!(soldier && key === GASSED_KEY)) out[key] = withoutSoldierGassedFlag(v, gassedIds);
  return out;
}

function sectorGassedArray(gassedIds: readonly number[]): Json {
  const bytes = new Uint8Array(TOTAL_SOLDIERS);
  for (const id of gassedIds) bytes[id] = 1;
  return { $u8: encodeBase64(bytes) };
}

function withSectorGassedArray(explosives: JsonObject, gassedIds: readonly number[]): JsonObject {
  const out: Record<string, Json> = {};
  for (const [key, v] of Object.entries(explosives)) {
    out[key] = v;
    if (key === 'hitByGas') out[GASSED_KEY] = sectorGassedArray(gassedIds);
  }
  return out;
}

function versionTwentySeven(snapshot: SimSnapshot): SimSnapshot {
  const gassedIds: number[] = [];
  const stripped = snapshot.graph.sections.map(([name, value]): readonly [string, Json] => [
    name,
    withoutSoldierGassedFlag(value, gassedIds),
  ]);
  const sections = stripped.map(([name, value]): readonly [string, Json] => {
    if (name !== 'tactical') return [name, value];
    const tactical = object(value);
    return [name, { ...tactical, explosives: withSectorGassedArray(object(tactical.explosives), gassedIds) }];
  });
  return { ...snapshot, version: 27, graph: { ...snapshot.graph, sections } };
}

describe('snapshot version 27 (the gassed state per sector) migrates with the flag on each gassed soldier', () => {
  let kit: StubSectorKit;
  const exists = (path: string) => kit.worlds.exists(path);

  beforeAll(async () => {
    kit = await loadStubSectorKit();
  });

  afterAll(async () => {
    await kit.dispose();
  });

  async function expectFlagsOnTheSoldiers(session: SessionSim, t: TacticalState): Promise<void> {
    const [gassed] = teamMembers(t, Team.OUR);
    if (!gassed) throw new Error('no merc on the map');
    gassed.gassed = true;
    const current = snapshotSession(session);
    const legacy = versionTwentySeven(current.sim);
    expect(JSON.stringify(legacy)).not.toContain('"gassed":true');
    expect(JSON.stringify(legacy)).not.toContain('"gassed":false');
    expect(snapshotJson(migrateSnapshot(JSON.parse(JSON.stringify(legacy))))).toBe(snapshotJson(current.sim));
    const restored = await restoreSession(JSON.parse(JSON.stringify({ ...current, sim: legacy })), kit.read, exists);
    expect(JSON.stringify(snapshotSession(restored))).toBe(JSON.stringify(current));
  }

  it('a sandbox', async () => {
    const sandbox = await createSandboxSession(kit.read, false, 5);
    await expectFlagsOnTheSoldiers(sandbox, sandbox.sim.state);
  });

  it('a landed campaign', async () => {
    const campaign = await createCampaignSession(kit.read, exists, 9);
    const t = campaign.campaign.tactical?.state;
    if (!t) throw new Error('no loaded sector');
    await expectFlagsOnTheSoldiers(campaign, t);
  });
});

const CROW_DEFAULTS: Readonly<Record<string, Json>> = {
  crows: { possible: 0, dontAddNew: false },
  corpseHoles: [],
  targetHeightAdjustment: 0,
  lastRottingCorpsesSeconds: 0,
};

function isReference(value: Json | undefined): boolean {
  return typeof value === 'object' && value !== null && !Array.isArray(value) && '$ref' in value;
}

function withoutCrowState(value: Json): Json {
  if (Array.isArray(value)) return value.map((v: Json) => withoutCrowState(v));
  if (typeof value !== 'object' || value === null) return value;
  const out: Record<string, Json> = {};
  for (const [key, v] of Object.entries(value)) {
    if (!(key in CROW_DEFAULTS)) out[key] = withoutCrowState(v);
    else if (!isReference(v)) expect(v).toEqual(CROW_DEFAULTS[key]);
  }
  return out;
}

function versionTwentyEight(snapshot: SimSnapshot): SimSnapshot {
  const sections = snapshot.graph.sections.map(([name, value]): readonly [string, Json] => [
    name,
    withoutCrowState(withoutCreatureTenseQuoteTimer(value)),
  ]);
  return { ...snapshot, version: 28, graph: { ...snapshot.graph, sections } };
}

describe('snapshot version 28 (no crows) migrates with no crow to come, no emptied corpse slot and nobody on the way up', () => {
  let kit: StubSectorKit;
  const exists = (path: string) => kit.worlds.exists(path);

  beforeAll(async () => {
    kit = await loadStubSectorKit();
  });

  afterAll(async () => {
    await kit.dispose();
  });

  async function expectNoCrowState(session: SessionSim, t: TacticalState): Promise<void> {
    t.crows.possible = 0;
    t.crows.dontAddNew = false;
    t.realtimeClock.lastRottingCorpsesSeconds = 0;
    resetCreatureTenseQuoteTimer(t.realtimeClock);
    const current = snapshotSession(session);
    const legacy = versionTwentyEight(current.sim);
    for (const key of Object.keys(CROW_DEFAULTS)) expect(JSON.stringify(legacy)).not.toContain(`"${key}"`);
    expect(snapshotJson(migrateSnapshot(JSON.parse(JSON.stringify(legacy))))).toBe(snapshotJson(current.sim));
    const restored = await restoreSession(JSON.parse(JSON.stringify({ ...current, sim: legacy })), kit.read, exists);
    expect(JSON.stringify(snapshotSession(restored))).toBe(JSON.stringify(current));
  }

  it('a sandbox', async () => {
    const sandbox = await createSandboxSession(kit.read, false, 5);
    await expectNoCrowState(sandbox, sandbox.sim.state);
  });

  it('a landed campaign keeps one crow state for the sector flow and the loaded sector', async () => {
    const campaign = await createCampaignSession(kit.read, exists, 9);
    const t = campaign.campaign.tactical?.state;
    if (!t) throw new Error('no loaded sector');
    expect(t.crows).toBe(campaign.campaign.state.sectorFlow.crows);
    await expectNoCrowState(campaign, t);
  });
});

const PENDING_ROBOT_RELOAD_KEY = 'pendingRobotReload';

function withoutPendingRobotReload(value: Json): Json {
  if (Array.isArray(value)) return value.map((v: Json) => withoutPendingRobotReload(v));
  if (typeof value !== 'object' || value === null) return value;
  const out: Record<string, Json> = {};
  for (const [key, v] of Object.entries(value)) {
    if (key === PENDING_ROBOT_RELOAD_KEY) expect(v).toBeNull();
    else out[key] = withoutPendingRobotReload(v);
  }
  return out;
}

function versionTwentyNine(snapshot: SimSnapshot): SimSnapshot {
  const sections = snapshot.graph.sections.map(([name, value]): readonly [string, Json] => [name, withoutPendingRobotReload(value)]);
  return { ...snapshot, version: 29, graph: { ...snapshot.graph, sections } };
}

describe('snapshot version 29 (no pending robot reload) migrates with nobody on the way to reload the robot', () => {
  let kit: StubSectorKit;
  const exists = (path: string) => kit.worlds.exists(path);

  beforeAll(async () => {
    kit = await loadStubSectorKit();
  });

  afterAll(async () => {
    await kit.dispose();
  });

  async function expectNoPendingReload(session: SessionSim): Promise<void> {
    const current = snapshotSession(session);
    const legacy = versionTwentyNine(current.sim);
    expect(JSON.stringify(current.sim)).toContain(`"${PENDING_ROBOT_RELOAD_KEY}"`);
    expect(JSON.stringify(legacy)).not.toContain(`"${PENDING_ROBOT_RELOAD_KEY}"`);
    expect(snapshotJson(migrateSnapshot(JSON.parse(JSON.stringify(legacy))))).toBe(snapshotJson(current.sim));
    const restored = await restoreSession(JSON.parse(JSON.stringify({ ...current, sim: legacy })), kit.read, exists);
    expect(JSON.stringify(snapshotSession(restored))).toBe(JSON.stringify(current));
  }

  it('a sandbox', async () => {
    await expectNoPendingReload(await createSandboxSession(kit.read, false, 5));
  });

  it('a landed campaign', async () => {
    await expectNoPendingReload(await createCampaignSession(kit.read, exists, 9));
  });
});

const LANDED_HELICOPTER_KEY = 'landedHelicopter';

function versionThirty(snapshot: SimSnapshot): SimSnapshot {
  const sections = snapshot.graph.sections.map(([name, value]): readonly [string, Json] => {
    if (name !== 'tactical') return [name, value];
    const { [LANDED_HELICOPTER_KEY]: landed, ...rest } = object(value);
    expect(landed).toBeNull();
    return [name, rest];
  });
  return { ...snapshot, version: 30, graph: { ...snapshot.graph, sections } };
}

describe('snapshot version 30 (no landed helicopter) migrates with no helicopter on the map', () => {
  let kit: StubSectorKit;
  const exists = (path: string) => kit.worlds.exists(path);

  beforeAll(async () => {
    kit = await loadStubSectorKit();
  });

  afterAll(async () => {
    await kit.dispose();
  });

  async function expectNoLandedHelicopter(session: SessionSim): Promise<void> {
    const current = snapshotSession(session);
    const legacy = versionThirty(current.sim);
    expect(JSON.stringify(current.sim)).toContain(`"${LANDED_HELICOPTER_KEY}"`);
    expect(JSON.stringify(legacy)).not.toContain(`"${LANDED_HELICOPTER_KEY}"`);
    expect(snapshotJson(migrateSnapshot(JSON.parse(JSON.stringify(legacy))))).toBe(snapshotJson(current.sim));
    const restored = await restoreSession(JSON.parse(JSON.stringify({ ...current, sim: legacy })), kit.read, exists);
    expect(JSON.stringify(snapshotSession(restored))).toBe(JSON.stringify(current));
  }

  it('a sandbox', async () => {
    await expectNoLandedHelicopter(await createSandboxSession(kit.read, false, 5));
  });

  it('a landed campaign', async () => {
    await expectNoLandedHelicopter(await createCampaignSession(kit.read, exists, 9));
  });
});

const SERVICING_CROWS_KEY = 'servicingCrows';

function withoutServicingCrows(value: Json): Json {
  if (Array.isArray(value)) return value.map((v: Json) => withoutServicingCrows(v));
  if (typeof value !== 'object' || value === null) return value;
  const out: Record<string, Json> = {};
  for (const [key, v] of Object.entries(value)) {
    if (key === SERVICING_CROWS_KEY) expect(v).toBe(0);
    else out[key] = withoutServicingCrows(v);
  }
  return out;
}

function versionThirtyOne(snapshot: SimSnapshot): SimSnapshot {
  const sections = snapshot.graph.sections.map(([name, value]): readonly [string, Json] => [name, withoutServicingCrows(value)]);
  return { ...snapshot, version: 31, graph: { ...snapshot.graph, sections } };
}

describe('snapshot version 31 (corpses without a crow count) migrates with no crow feeding on any corpse', () => {
  let kit: StubSectorKit;
  const exists = (path: string) => kit.worlds.exists(path);

  beforeAll(async () => {
    kit = await loadStubSectorKit();
  });

  afterAll(async () => {
    await kit.dispose();
  });

  it('a sandbox with a corpse', async () => {
    const sandbox = await createSandboxSession(kit.read, false, 5);
    sandbox.sim.state.corpses.push({
      gridNo: CORPSE_AT,
      level: 0,
      heightAdjustment: 0,
      bodyType: 0,
      direction: 0,
      state: 0,
      profile: 200,
      type: SMERC_FWD,
      timeOfDeath: 0,
      headTaken: false,
      servicingCrows: 0,
    });
    const current = snapshotSession(sandbox);
    const legacy = versionThirtyOne(current.sim);
    expect(JSON.stringify(current.sim)).toContain(`"${SERVICING_CROWS_KEY}"`);
    expect(JSON.stringify(legacy)).not.toContain(`"${SERVICING_CROWS_KEY}"`);
    expect(snapshotJson(migrateSnapshot(JSON.parse(JSON.stringify(legacy))))).toBe(snapshotJson(current.sim));
    const restored = await restoreSession(JSON.parse(JSON.stringify({ ...current, sim: legacy })), kit.read, exists);
    expect(JSON.stringify(snapshotSession(restored))).toBe(JSON.stringify(current));
  });
});

const RANDOM_ACTION_COUNTER_KEY = 'timeOfLastRandomAction';

function withoutRandomActionCounter(value: Json): Json {
  if (Array.isArray(value)) return value.map((v: Json) => withoutRandomActionCounter(v));
  if (typeof value !== 'object' || value === null) return value;
  const out: Record<string, Json> = {};
  for (const [key, v] of Object.entries(value)) {
    if (key === RANDOM_ACTION_COUNTER_KEY) expect(v).toBe(0);
    else out[key] = withoutRandomActionCounter(v);
  }
  return out;
}

function versionThirtyTwo(snapshot: SimSnapshot): SimSnapshot {
  const sections = snapshot.graph.sections.map(([name, value]): readonly [string, Json] => [name, withoutRandomActionCounter(value)]);
  return { ...snapshot, version: 32, graph: { ...snapshot.graph, sections } };
}

describe('snapshot version 32 (no random idle animation counter) migrates with every count at 0', () => {
  let kit: StubSectorKit;
  const exists = (path: string) => kit.worlds.exists(path);

  beforeAll(async () => {
    kit = await loadStubSectorKit();
  });

  afterAll(async () => {
    await kit.dispose();
  });

  async function expectCountsAtZero(session: SessionSim): Promise<void> {
    const current = snapshotSession(session);
    const legacy = versionThirtyTwo(current.sim);
    expect(JSON.stringify(current.sim)).toContain(`"${RANDOM_ACTION_COUNTER_KEY}"`);
    expect(JSON.stringify(legacy)).not.toContain(`"${RANDOM_ACTION_COUNTER_KEY}"`);
    expect(snapshotJson(migrateSnapshot(JSON.parse(JSON.stringify(legacy))))).toBe(snapshotJson(current.sim));
    const restored = await restoreSession(JSON.parse(JSON.stringify({ ...current, sim: legacy })), kit.read, exists);
    expect(JSON.stringify(snapshotSession(restored))).toBe(JSON.stringify(current));
  }

  it('a sandbox', async () => {
    await expectCountsAtZero(await createSandboxSession(kit.read, false, 5));
  });

  it('a landed campaign', async () => {
    await expectCountsAtZero(await createCampaignSession(kit.read, exists, 9));
  });
});

const CREATURE_TENSE_QUOTE_KEYS = ['creatureTenseQuoteDelaySeconds', 'lastCreatureTenseQuoteMs'];

function resetCreatureTenseQuoteTimer(clock: RealtimeClock): void {
  clock.creatureTenseQuoteDelaySeconds = 0;
  clock.lastCreatureTenseQuoteMs = 0;
}

function withoutCreatureTenseQuoteTimer(value: Json): Json {
  if (Array.isArray(value)) return value.map((v: Json) => withoutCreatureTenseQuoteTimer(v));
  if (typeof value !== 'object' || value === null) return value;
  const out: Record<string, Json> = {};
  for (const [key, v] of Object.entries(value)) {
    if (CREATURE_TENSE_QUOTE_KEYS.includes(key)) expect(v).toBe(0);
    else out[key] = withoutCreatureTenseQuoteTimer(v);
  }
  return out;
}

function versionThirtyThree(snapshot: SimSnapshot): SimSnapshot {
  const sections = snapshot.graph.sections.map(([name, value]): readonly [string, Json] => [name, withoutCreatureTenseQuoteTimer(value)]);
  return { ...snapshot, version: 33, graph: { ...snapshot.graph, sections } };
}

describe('snapshot version 33 (no creature tension timer) migrates with no delay and no tense quote said yet', () => {
  let kit: StubSectorKit;
  const exists = (path: string) => kit.worlds.exists(path);

  beforeAll(async () => {
    kit = await loadStubSectorKit();
  });

  afterAll(async () => {
    await kit.dispose();
  });

  async function expectFreshTimer(session: SessionSim, clock: RealtimeClock): Promise<void> {
    resetCreatureTenseQuoteTimer(clock);
    const current = snapshotSession(session);
    const legacy = versionThirtyThree(current.sim);
    for (const key of CREATURE_TENSE_QUOTE_KEYS) {
      expect(JSON.stringify(current.sim)).toContain(`"${key}"`);
      expect(JSON.stringify(legacy)).not.toContain(`"${key}"`);
    }
    expect(snapshotJson(migrateSnapshot(JSON.parse(JSON.stringify(legacy))))).toBe(snapshotJson(current.sim));
    const restored = await restoreSession(JSON.parse(JSON.stringify({ ...current, sim: legacy })), kit.read, exists);
    expect(JSON.stringify(snapshotSession(restored))).toBe(JSON.stringify(current));
  }

  it('a sandbox', async () => {
    const sandbox = await createSandboxSession(kit.read, false, 5);
    await expectFreshTimer(sandbox, sandbox.sim.state.realtimeClock);
  });

  it('a landed campaign keeps one timer for the sector flow and the loaded sector', async () => {
    const campaign = await createCampaignSession(kit.read, exists, 9);
    const t = campaign.campaign.tactical?.state;
    if (!t) throw new Error('no loaded sector');
    expect(t.realtimeClock).toBe(campaign.campaign.state.sectorFlow.realtimeClock);
    await expectFreshTimer(campaign, t.realtimeClock);
  });
});

const DOOR_STATUS_FLAG_KEYS = ['perceivedNotSet', 'busy', 'shownOpen'];
const REAL_DOOR_STATE_KEY = 'open';
const LIVE_DOOR_STATUS_KEYS = [REAL_DOOR_STATE_KEY, 'perceivedOpen', ...DOOR_STATUS_FLAG_KEYS];
const SAVED_DOOR_STATUS_KEYS = ['gridNo', 'open', 'perceivedOpen', 'perceivedNotSet'];
const SANDBOX_DOOR = 11429;
const OTHER_DOOR = 11433;
const LEFT_SECTOR = { x: 1, y: 1, z: 0 };

function hasKeys(o: Readonly<Record<string, Json>>, keys: readonly string[]): boolean {
  return Object.keys(o).length === keys.length && keys.every((key) => key in o);
}

function shownAsPerceived(open: boolean, perceivedOpen: boolean): DoorStatusEntry {
  return { open, perceivedOpen, perceivedNotSet: false, busy: false, shownOpen: perceivedOpen };
}

function withoutDoorStatusFlags(value: Json): Json {
  if (Array.isArray(value)) return value.map((v: Json) => withoutDoorStatusFlags(v));
  if (typeof value !== 'object' || value === null) return value;
  const out: Record<string, Json> = {};
  for (const [key, v] of Object.entries(value)) out[key] = withoutDoorStatusFlags(v);
  if (hasKeys(out, LIVE_DOOR_STATUS_KEYS)) {
    expect([out.perceivedNotSet, out.busy, out.shownOpen]).toEqual([false, false, out.perceivedOpen]);
    return { perceivedOpen: out.perceivedOpen ?? false };
  }
  if (hasKeys(out, SAVED_DOOR_STATUS_KEYS)) {
    const { perceivedNotSet, ...saved } = out;
    expect(perceivedNotSet).toBe(false);
    return saved;
  }
  return out;
}

function versionThirtyFour(snapshot: SimSnapshot): SimSnapshot {
  const sections = snapshot.graph.sections.map(([name, value]): readonly [string, Json] => [name, withoutDoorStatusFlags(value)]);
  return { ...snapshot, version: 34, graph: { ...snapshot.graph, sections } };
}

describe('snapshot version 34 (door statuses with only the perceived state) migrates with doors free and shown as perceived', () => {
  let kit: StubSectorKit;
  const exists = (path: string) => kit.worlds.exists(path);

  beforeAll(async () => {
    kit = await loadStubSectorKit();
  });

  afterAll(async () => {
    await kit.dispose();
  });

  async function expectPerceivedDoors(session: SessionSim): Promise<void> {
    const current = snapshotSession(session);
    const legacy = versionThirtyFour(current.sim);
    for (const key of DOOR_STATUS_FLAG_KEYS) {
      expect(JSON.stringify(current.sim)).toContain(`"${key}"`);
      expect(JSON.stringify(legacy)).not.toContain(`"${key}"`);
    }
    expect(snapshotJson(migrateSnapshot(JSON.parse(JSON.stringify(legacy))))).toBe(snapshotJson(current.sim));
    const restored = await restoreSession(JSON.parse(JSON.stringify({ ...current, sim: legacy })), kit.read, exists);
    expect(JSON.stringify(snapshotSession(restored))).toBe(JSON.stringify(current));
  }

  it('a sandbox', async () => {
    const sandbox = await createSandboxSession(kit.read, false, 5);
    const t = sandbox.sim.state;
    t.doorStatus.set(SANDBOX_DOOR, shownAsPerceived(false, true));
    t.doorStatus.set(OTHER_DOOR, shownAsPerceived(false, false));
    await expectPerceivedDoors(sandbox);
  });

  it('a landed campaign with a sector left behind', async () => {
    const campaign = await createCampaignSession(kit.read, exists, 9);
    const t = campaign.campaign.tactical?.state;
    if (!t) throw new Error('no loaded sector');
    t.doorStatus.set(SANDBOX_DOOR, shownAsPerceived(false, true));
    const diff = emptySectorDiff();
    diff.doorStatus = [{ gridNo: SANDBOX_DOOR, open: true, perceivedOpen: false, perceivedNotSet: false }];
    campaign.campaign.state.sectorDiffs.set(sectorKey(LEFT_SECTOR), diff);
    await expectPerceivedDoors(campaign);
  });
});

const PRE_COMBAT_GRIDNO_KEY = 'preCombatGridNo';

function withoutPreCombatGridNo(value: Json): Json {
  if (Array.isArray(value)) return value.map((v: Json) => withoutPreCombatGridNo(v));
  if (typeof value !== 'object' || value === null) return value;
  const out: Record<string, Json> = {};
  for (const [key, v] of Object.entries(value)) {
    if (key === PRE_COMBAT_GRIDNO_KEY) expect(v).toBe(0);
    else out[key] = withoutPreCombatGridNo(v);
  }
  return out;
}

function versionThirtyFive(snapshot: SimSnapshot): SimSnapshot {
  const sections = snapshot.graph.sections.map(([name, value]): readonly [string, Json] => [name, withoutPreCombatGridNo(value)]);
  return { ...snapshot, version: 35, graph: { ...snapshot.graph, sections } };
}

describe("snapshot version 35 (profiles without a pre-combat tile) migrates with every profile at prof.dat's 0", () => {
  let kit: StubSectorKit;
  const exists = (path: string) => kit.worlds.exists(path);

  beforeAll(async () => {
    kit = await loadStubSectorKit();
  });

  afterAll(async () => {
    await kit.dispose();
  });

  it('a landed campaign', async () => {
    const session = await createCampaignSession(kit.read, exists, 9);
    const current = snapshotSession(session);
    const legacy = versionThirtyFive(current.sim);
    expect(JSON.stringify(current.sim)).toContain(`"${PRE_COMBAT_GRIDNO_KEY}"`);
    expect(JSON.stringify(legacy)).not.toContain(`"${PRE_COMBAT_GRIDNO_KEY}"`);
    expect(snapshotJson(migrateSnapshot(JSON.parse(JSON.stringify(legacy))))).toBe(snapshotJson(current.sim));
    const restored = await restoreSession(JSON.parse(JSON.stringify({ ...current, sim: legacy })), kit.read, exists);
    expect(JSON.stringify(snapshotSession(restored))).toBe(JSON.stringify(current));
  });
});

const MERC_SLOTS_KEY = 'mercSlots';
const AWAY_SLOTS_KEY = 'awaySlots';

function withEmptySlotBeforeEach(slots: Json | undefined): Json[] {
  if (!Array.isArray(slots)) throw new Error('no slots');
  return slots.flatMap((slot: Json) => [null, slot]);
}

function cursorWithEmptySlotsBefore(cursor: Json | undefined, slots: Json | undefined): Json {
  if (typeof cursor !== 'number' || !Array.isArray(slots) || cursor >= slots.length) return cursor ?? null;
  return cursor * 2 + 1;
}

function versionThirtySix(snapshot: SimSnapshot): SimSnapshot {
  const sections = snapshot.graph.sections.map(([name, value]): readonly [string, Json] => {
    if (name !== 'tactical') return [name, value];
    const t = object(value);
    const pass = object(t.aiPass);
    const aiPass = {
      ...pass,
      cursor: cursorWithEmptySlotsBefore(pass.cursor, t[MERC_SLOTS_KEY]),
      awayCursor: cursorWithEmptySlotsBefore(pass.awayCursor, t[AWAY_SLOTS_KEY]),
    };
    const mercSlots = withEmptySlotBeforeEach(t[MERC_SLOTS_KEY]);
    const awaySlots = withEmptySlotBeforeEach(t[AWAY_SLOTS_KEY]);
    return [name, { ...t, aiPass, [MERC_SLOTS_KEY]: mercSlots, [AWAY_SLOTS_KEY]: awaySlots }];
  });
  return { ...snapshot, version: 36, graph: { ...snapshot.graph, sections } };
}

describe('snapshot version 36 (merc slots left empty by soldiers who left) migrates with the gaps closed', () => {
  let kit: StubSectorKit;
  const exists = (path: string) => kit.worlds.exists(path);

  beforeAll(async () => {
    kit = await loadStubSectorKit();
  });

  afterAll(async () => {
    await kit.dispose();
  });

  async function expectGapsClosed(session: SessionSim): Promise<void> {
    const current = snapshotSession(session);
    const legacy = versionThirtySix(current.sim);
    expect(JSON.stringify(legacy)).toContain(`"${MERC_SLOTS_KEY}":[null,`);
    expect(snapshotJson(migrateSnapshot(JSON.parse(JSON.stringify(legacy))))).toBe(snapshotJson(current.sim));
    const restored = await restoreSession(JSON.parse(JSON.stringify({ ...current, sim: legacy })), kit.read, exists);
    expect(JSON.stringify(snapshotSession(restored))).toBe(JSON.stringify(current));
  }

  it('a sandbox', async () => {
    const sandbox = await createSandboxSession(kit.read, false, 5);
    sandbox.sim.state.aiPass.cursor = 1;
    await expectGapsClosed(sandbox);
  });

  it('a landed campaign', async () => {
    await expectGapsClosed(await createCampaignSession(kit.read, exists, 9));
  });
});

function withoutRealDoorState(value: Json): Json {
  if (Array.isArray(value)) return value.map((v: Json) => withoutRealDoorState(v));
  if (typeof value !== 'object' || value === null) return value;
  const out: Record<string, Json> = {};
  for (const [key, v] of Object.entries(value)) out[key] = withoutRealDoorState(v);
  if (!hasKeys(out, LIVE_DOOR_STATUS_KEYS)) return out;
  const { [REAL_DOOR_STATE_KEY]: _open, ...older } = out;
  return older;
}

function versionThirtySeven(snapshot: SimSnapshot): SimSnapshot {
  const sections = snapshot.graph.sections.map(([name, value]): readonly [string, Json] => [name, withoutRealDoorState(value)]);
  return { ...snapshot, version: 37, graph: { ...snapshot.graph, sections } };
}

describe("snapshot version 37 (door statuses without DOOR_OPEN) migrates with the real state of each door's structure", () => {
  let kit: StubSectorKit;
  const exists = (path: string) => kit.worlds.exists(path);

  beforeAll(async () => {
    kit = await loadStubSectorKit();
  });

  afterAll(async () => {
    await kit.dispose();
  });

  it('a sandbox with an opened door and a status where no door stands', async () => {
    const sandbox = await createSandboxSession(kit.read, false, 5);
    const t = sandbox.sim.state;
    handleDoorChangeFromGridNo(t, null, SANDBOX_DOOR);
    t.doorStatus.set(OTHER_DOOR, shownAsPerceived(false, true));
    expect([isDoorOpenAt(t, SANDBOX_DOOR), t.doorStatus.get(SANDBOX_DOOR)?.open]).toEqual([true, true]);
    const current = snapshotSession(sandbox);
    const legacy = versionThirtySeven(current.sim);
    expect(JSON.stringify(current.sim)).toContain(`"${REAL_DOOR_STATE_KEY}":true,"perceivedOpen"`);
    expect(JSON.stringify(legacy)).not.toContain(`"${REAL_DOOR_STATE_KEY}":true,"perceivedOpen"`);
    expect(snapshotJson(migrateSnapshot(JSON.parse(JSON.stringify(legacy))))).toBe(snapshotJson(current.sim));
    const restored = await restoreSession(JSON.parse(JSON.stringify({ ...current, sim: legacy })), kit.read, exists);
    expect(JSON.stringify(snapshotSession(restored))).toBe(JSON.stringify(current));
  });
});

const CORPSE_HEIGHT_KEY = 'heightAdjustment';
const TIME_OF_DEATH_KEY = 'timeOfDeath';
const ROOF_CORPSE_AT = 12_505;
const LEFT_CORPSE_AT = 12_665;
const PLACED_ROOF_SOLDIER_CORPSE_HEIGHT = 8;

function withoutCorpseHeights(value: Json): Json {
  if (Array.isArray(value)) return value.map((v: Json) => withoutCorpseHeights(v));
  if (typeof value !== 'object' || value === null) return value;
  const corpse = object(value)[TIME_OF_DEATH_KEY] !== undefined;
  const out: Record<string, Json> = {};
  for (const [key, v] of Object.entries(value)) if (!corpse || key !== CORPSE_HEIGHT_KEY) out[key] = withoutCorpseHeights(v);
  return out;
}

function versionThirtyEight(snapshot: SimSnapshot): SimSnapshot {
  const sections = snapshot.graph.sections.map(([name, value]): readonly [string, Json] => [name, withoutCorpseHeights(value)]);
  return { ...snapshot, version: 38, graph: { ...snapshot.graph, sections } };
}

function lyingCorpse(gridNo: number, level: number, heightAdjustment: number) {
  return {
    gridNo,
    level,
    heightAdjustment,
    bodyType: 0,
    direction: 0,
    state: 0,
    profile: 200,
    type: SMERC_FWD,
    timeOfDeath: 0,
    headTaken: false,
    servicingCrows: 0,
  };
}

describe("snapshot version 38 (corpses without a height) migrates with each corpse at its level's default: flat on the ground, 8 px up on a roof as a soldier the map placed there leaves", () => {
  let kit: StubSectorKit;
  const exists = (path: string) => kit.worlds.exists(path);

  beforeAll(async () => {
    kit = await loadStubSectorKit();
  });

  afterAll(async () => {
    await kit.dispose();
  });

  async function expectCorpseHeights(session: SessionSim): Promise<void> {
    const current = snapshotSession(session);
    const legacy = versionThirtyEight(current.sim);
    expect(JSON.stringify(current.sim)).toContain(`"level":1,"${CORPSE_HEIGHT_KEY}":${PLACED_ROOF_SOLDIER_CORPSE_HEIGHT},"bodyType"`);
    expect(JSON.stringify(current.sim)).toContain(`"level":0,"${CORPSE_HEIGHT_KEY}":0,"bodyType"`);
    expect(JSON.stringify(legacy)).not.toContain(`"${CORPSE_HEIGHT_KEY}":${PLACED_ROOF_SOLDIER_CORPSE_HEIGHT},"bodyType"`);
    expect(JSON.stringify(legacy)).not.toContain(`"${CORPSE_HEIGHT_KEY}":0,"bodyType"`);
    expect(snapshotJson(migrateSnapshot(JSON.parse(JSON.stringify(legacy))))).toBe(snapshotJson(current.sim));
    const restored = await restoreSession(JSON.parse(JSON.stringify({ ...current, sim: legacy })), kit.read, exists);
    expect(JSON.stringify(snapshotSession(restored))).toBe(JSON.stringify(current));
  }

  it('a sandbox with a corpse on the ground and one on a roof', async () => {
    const sandbox = await createSandboxSession(kit.read, false, 5);
    sandbox.sim.state.corpses.push(lyingCorpse(CORPSE_AT, 0, 0), lyingCorpse(ROOF_CORPSE_AT, 1, PLACED_ROOF_SOLDIER_CORPSE_HEIGHT));
    await expectCorpseHeights(sandbox);
  });

  it('a landed campaign with corpses in a sector left behind', async () => {
    const campaign = await createCampaignSession(kit.read, exists, 9);
    const diff = emptySectorDiff();
    diff.corpses = [lyingCorpse(LEFT_CORPSE_AT, 0, 0), lyingCorpse(ROOF_CORPSE_AT, 1, PLACED_ROOF_SOLDIER_CORPSE_HEIGHT)];
    campaign.campaign.state.sectorDiffs.set(sectorKey(LEFT_SECTOR), diff);
    await expectCorpseHeights(campaign);
  });
});

const BULLET_LOCATED_KEY = 'located';
const LIVE_BULLET_KEYS = ['toDelete', BULLET_LOCATED_KEY, 'lastStructureHit'];
const SHOT_ROWS_AHEAD = 6;
const SHOT_TICKS = 2000;

function withoutBulletLocatedFlags(value: Json): Json {
  if (Array.isArray(value)) return value.map((v: Json) => withoutBulletLocatedFlags(v));
  if (typeof value !== 'object' || value === null) return value;
  const out: Record<string, Json> = {};
  for (const [key, v] of Object.entries(value)) out[key] = withoutBulletLocatedFlags(v);
  if (!LIVE_BULLET_KEYS.every((key) => key in out)) return out;
  const { [BULLET_LOCATED_KEY]: _located, ...older } = out;
  return older;
}

function versionThirtyNine(snapshot: SimSnapshot): SimSnapshot {
  const sections = snapshot.graph.sections.map(([name, value]): readonly [string, Json] => [name, withoutBulletLocatedFlags(value)]);
  return { ...snapshot, version: 39, graph: { ...snapshot.graph, sections } };
}

describe('snapshot version 39 (bullets without fLocated) migrates with every bullet in flight not located yet, as CreateBullet leaves it', () => {
  let kit: StubSectorKit;
  const exists = (path: string) => kit.worlds.exists(path);

  beforeAll(async () => {
    kit = await loadStubSectorKit();
  });

  afterAll(async () => {
    await kit.dispose();
  });

  it('a sandbox with a bullet in flight', async () => {
    const sandbox = await createSandboxSession(kit.read, false, 5);
    const t = sandbox.sim.state;
    const merc = teamMembers(t, Team.OUR)[0];
    if (!merc) throw new Error('no merc in the sandbox');
    const target = merc.gridNo + SHOT_ROWS_AHEAD * WORLD_COLS;
    expect(sandbox.dispatch({ type: 'attack', soldier: merc.id, target })).toMatchObject({ ok: true });
    for (let i = 0; i < SHOT_TICKS && t.bullets.length === 0; i++) sandbox.step();
    expect(t.bullets.map((b) => b.located)).toEqual([false]);
    const current = snapshotSession(sandbox);
    const legacy = versionThirtyNine(current.sim);
    expect(JSON.stringify(current.sim)).toContain(`"toDelete":false,"${BULLET_LOCATED_KEY}":false,"lastStructureHit"`);
    expect(JSON.stringify(legacy)).not.toContain(`"${BULLET_LOCATED_KEY}":`);
    expect(snapshotJson(migrateSnapshot(JSON.parse(JSON.stringify(legacy))))).toBe(snapshotJson(current.sim));
    const restored = await restoreSession(JSON.parse(JSON.stringify({ ...current, sim: legacy })), kit.read, exists);
    expect(JSON.stringify(snapshotSession(restored))).toBe(JSON.stringify(current));
  });
});

function versionForty(snapshot: SimSnapshot): SimSnapshot {
  const sections = snapshot.graph.sections.map(([name, value]): readonly [string, Json] => {
    if (name !== 'strategic') return [name, value];
    const strategic = object(value);
    const { interfaceLockActive, ...sectorFlow } = object(strategic.sectorFlow);
    expect(interfaceLockActive).toBe(false);
    return [name, { ...strategic, sectorFlow }];
  });
  return { ...snapshot, version: 40, graph: { ...snapshot.graph, sections } };
}

describe('snapshot version 40 (no interface lock flag) migrates with no lock that paused the game', () => {
  let kit: StubSectorKit;
  const exists = (path: string) => kit.worlds.exists(path);

  beforeAll(async () => {
    kit = await loadStubSectorKit();
  });

  afterAll(async () => {
    await kit.dispose();
  });

  it('a landed campaign', async () => {
    const campaign = await createCampaignSession(kit.read, exists, 9);
    const current = snapshotSession(campaign);
    const legacy = versionForty(current.sim);
    expect(JSON.stringify(current.sim)).toContain('"pendingWait":null,"interfaceLockActive":false,');
    expect(JSON.stringify(legacy)).not.toContain('"interfaceLockActive"');
    expect(snapshotJson(migrateSnapshot(JSON.parse(JSON.stringify(legacy))))).toBe(snapshotJson(current.sim));
    const restored = await restoreSession(JSON.parse(JSON.stringify({ ...current, sim: legacy })), kit.read, exists);
    expect(JSON.stringify(snapshotSession(restored))).toBe(JSON.stringify(current));
  });
});

const ITEMS_TILE = 12_884;
const NO_ITEMS_TILE = -1;
const ITEMS_SEEN_ON_ATTACK_GRID_NO_KEY = 'itemsSeenOnAttackGridNo';

function withoutItemsSeenTiles(value: Json): Json {
  if (Array.isArray(value)) return value.map((v: Json) => withoutItemsSeenTiles(v));
  if (typeof value !== 'object' || value === null) return value;
  const out: Record<string, Json> = {};
  for (const [key, v] of Object.entries(value)) out[key] = withoutItemsSeenTiles(v);
  if (out.kind === 'itemLocator') {
    const { gridNo, ...older } = out;
    expect(gridNo).toBe(ITEMS_TILE);
    return older;
  }
  if (!(ITEMS_SEEN_ON_ATTACK_GRID_NO_KEY in out)) return out;
  const { [ITEMS_SEEN_ON_ATTACK_GRID_NO_KEY]: held, ...older } = out;
  expect(held).toBe(NO_ITEMS_TILE);
  return older;
}

function versionFortyOne(snapshot: SimSnapshot): SimSnapshot {
  const sections = snapshot.graph.sections.map(([name, value]): readonly [string, Json] => [name, withoutItemsSeenTiles(value)]);
  return { ...snapshot, version: 41, graph: { ...snapshot.graph, sections } };
}

describe('snapshot version 41 (no items-seen tiles) migrates with no tile to slide to', () => {
  let kit: StubSectorKit;
  const exists = (path: string) => kit.worlds.exists(path);

  beforeAll(async () => {
    kit = await loadStubSectorKit();
  });

  afterAll(async () => {
    await kit.dispose();
  });

  it('a landed campaign with an items-seen quote queued', async () => {
    const campaign = await createCampaignSession(kit.read, exists, 9);
    const queue = campaign.campaign.talk?.talk.queue;
    if (!queue) throw new Error('no dialogue queue');
    queue.push({ kind: 'itemLocator', speaker: 0, gridNo: ITEMS_TILE });
    const current = snapshotSession(campaign);
    const legacy = versionFortyOne(current.sim);
    const queued = (tile: number) => `"kind":"itemLocator","speaker":0,"gridNo":${tile}`;
    expect(JSON.stringify(current.sim)).toContain(queued(ITEMS_TILE));
    expect(JSON.stringify(current.sim)).toContain(`"itemsSeenOnAttack":null,"${ITEMS_SEEN_ON_ATTACK_GRID_NO_KEY}":${NO_ITEMS_TILE},`);
    expect(JSON.stringify(legacy)).not.toContain(`"${ITEMS_SEEN_ON_ATTACK_GRID_NO_KEY}"`);
    const migrated = snapshotJson(migrateSnapshot(JSON.parse(JSON.stringify(legacy))));
    expect(migrated).toBe(snapshotJson(current.sim).replace(queued(ITEMS_TILE), queued(NO_ITEMS_TILE)));
  });
});

const SLANT_ROOF_CEILINGS_KEY = 'slantRoofCeilings';

function versionFortyTwo(snapshot: SimSnapshot): SimSnapshot {
  const sections = snapshot.graph.sections.map(([name, value]): readonly [string, Json] => {
    if (name !== 'tactical') return [name, value];
    const tactical = object(value);
    const { [SLANT_ROOF_CEILINGS_KEY]: ceilings, ...fog } = object(tactical.fog);
    expect(ceilings).toEqual({ $u8: encodeBase64(new Uint8Array(WORLD_MAX)) });
    return [name, { ...tactical, fog }];
  });
  return { ...snapshot, version: 42, graph: { ...snapshot.graph, sections } };
}

describe('snapshot version 42 (no slanted roof ceilings) migrates with no ceiling shown', () => {
  let kit: StubSectorKit;
  const exists = (path: string) => kit.worlds.exists(path);

  beforeAll(async () => {
    kit = await loadStubSectorKit();
  });

  afterAll(async () => {
    await kit.dispose();
  });

  it('a sandbox', async () => {
    const sandbox = await createSandboxSession(kit.read, false, 5);
    const current = snapshotSession(sandbox);
    const legacy = versionFortyTwo(current.sim);
    expect(JSON.stringify(current.sim)).toContain(`"${SLANT_ROOF_CEILINGS_KEY}":`);
    expect(JSON.stringify(legacy)).not.toContain(`"${SLANT_ROOF_CEILINGS_KEY}"`);
    expect(snapshotJson(migrateSnapshot(JSON.parse(JSON.stringify(legacy))))).toBe(snapshotJson(current.sim));
    const restored = await restoreSession(JSON.parse(JSON.stringify({ ...current, sim: legacy })), kit.read, exists);
    expect(JSON.stringify(snapshotSession(restored))).toBe(JSON.stringify(current));
  });

  it('a landed campaign', async () => {
    const campaign = await createCampaignSession(kit.read, exists, 9);
    const current = snapshotSession(campaign);
    const legacy = versionFortyTwo(current.sim);
    expect(snapshotJson(migrateSnapshot(JSON.parse(JSON.stringify(legacy))))).toBe(snapshotJson(current.sim));
  });
});

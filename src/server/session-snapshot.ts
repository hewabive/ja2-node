import { frameSlotOfSpriteFrame, type PresentationTimeline, requireAnimationTimelines } from '../content/anim/timelines.ts';
import type { LayerCount } from '../content/narrative/npc-records.ts';
import { type DataDecoding, DEFAULT_DATA_DECODING } from '../content/text/data-version.ts';
import { loadTacticalWorld, type TacticalWorld } from '../content/world/tactical-world.ts';
import type { ReadFile } from '../content/world/tileset-loader.ts';
import type { CampaignSim } from '../sim/campaign/campaign-sim.ts';
import type { Roster } from '../sim/campaign/roster.ts';
import type { SnapshotMigrationContext } from '../sim/snapshot/migrations.ts';
import type { ContentRoots } from '../sim/snapshot/refs.ts';
import {
  migrateSnapshot,
  restoreCampaign,
  restoreTactical,
  type SimSnapshot,
  snapshotCampaign,
  snapshotTactical,
} from '../sim/snapshot/session.ts';
import type { StrategicState } from '../sim/strategic/state.ts';
import type { TacticalContent } from '../sim/tactical/content.ts';
import { loadTacticalContent } from '../sim/tactical/load-content.ts';
import type { TacticalSim } from '../sim/tactical/tactical-sim.ts';
import { assembleCampaign, type CampaignParts, loadCampaignParts } from './campaign-factory.ts';
import { type CampaignOrigin, CampaignSession } from './campaign-session.ts';
import { TacticalSession } from './sandbox.ts';
import { assembleImportedCampaign, loadImportParts } from './save-session.ts';
import type { SessionSim } from './session.ts';
import { type FileExists, WorldCache } from './world-cache.ts';

export type SessionKind = 'campaign' | 'imported' | 'sandbox';

export interface SessionSnapshot {
  readonly session: SessionKind;
  readonly preparedMaps: readonly string[];
  readonly sim: SimSnapshot;
}

export interface SessionRestoreInputs {
  readonly read: ReadFile;
  readonly presentation: PresentationTimeline;
  readonly exists: FileExists | null;
  readonly parts: CampaignParts | null;
  readonly content: TacticalContent | null;
  readonly worlds: WorldCache | null;
  readonly world: TacticalWorld | null;
}

const SESSION_KINDS: readonly SessionKind[] = ['campaign', 'imported', 'sandbox'];

export function campaignContentRoots(parts: CampaignParts): ContentRoots {
  return {
    content: parts.content,
    strategic: parts.strategic,
    army: parts.army,
    economy: parts.economy,
    merchants: parts.merchants,
    laptop: parts.laptop,
    dialogueProfiles: parts.dialogueProfiles,
    narrative: parts.narrative,
  };
}

export function tacticalContentRoots(content: TacticalContent): ContentRoots {
  return { content };
}

function campaignOrigin(session: CampaignSession): CampaignOrigin {
  if (!session.origin) throw new Error('this campaign session was not built by the server and cannot be snapshotted');
  return session.origin;
}

export function snapshotSession(sim: SessionSim): SessionSnapshot {
  if (sim instanceof TacticalSession)
    return { session: 'sandbox', preparedMaps: [], sim: snapshotTactical(sim.sim, tacticalContentRoots(sim.sim.state.content)) };
  if (!(sim instanceof CampaignSession)) throw new Error('this session kind cannot be snapshotted');
  const origin = campaignOrigin(sim);
  return {
    session: origin.kind,
    preparedMaps: sim.worlds?.preparedPaths() ?? [],
    sim: snapshotCampaign(sim.campaign, campaignContentRoots(origin.parts)),
  };
}

export function snapshotMigrationContext(presentation: PresentationTimeline): SnapshotMigrationContext {
  return { frameSlotOf: (state, pc, spriteFrame) => frameSlotOfSpriteFrame(presentation, state, pc, spriteFrame) };
}

function checkSessionSnapshot(raw: unknown, context: SnapshotMigrationContext): SessionSnapshot {
  const s = raw as Partial<SessionSnapshot> | null;
  if (typeof s !== 'object' || s === null || !SESSION_KINDS.includes(s.session as SessionKind)) throw new Error('not a session snapshot');
  if (!Array.isArray(s.preparedMaps) || s.preparedMaps.some((p) => typeof p !== 'string')) throw new Error('bad prepared map list');
  return { session: s.session as SessionKind, preparedMaps: s.preparedMaps, sim: migrateSnapshot(s.sim, context) };
}

function loadedWorld(inputs: SessionRestoreInputs): (mapPath: string) => TacticalWorld {
  return (mapPath) => {
    const world = inputs.world ?? inputs.worlds?.world(mapPath) ?? null;
    if (!world || world.mapPath !== mapPath) throw new Error(`the map ${mapPath} of the loaded sector is not prepared`);
    return world;
  };
}

function restoreSandbox(snapshot: SessionSnapshot, inputs: SessionRestoreInputs): TacticalSession {
  if (!inputs.content) throw new Error('a sandbox restore needs the tactical content');
  const sim = restoreTactical(snapshot.sim, { content: tacticalContentRoots(inputs.content), world: loadedWorld(inputs) });
  return new TacticalSession(sim, inputs.presentation);
}

function restoreCampaignSession(snapshot: SessionSnapshot, inputs: SessionRestoreInputs): CampaignSession {
  const parts = inputs.parts;
  if (!parts) throw new Error('a campaign restore needs the campaign content');
  const kind = snapshot.session === 'imported' ? 'imported' : 'campaign';
  let roster: Roster | null = null;
  const assemble = (state: StrategicState, tactical: TacticalSim | null): CampaignSim => {
    if (kind === 'imported') {
      const assembled = assembleImportedCampaign(parts, state, tactical, inputs.worlds, () => {}, 'restore');
      roster = assembled.roster;
      return assembled.campaign;
    }
    const { exists, worlds } = inputs;
    if (!exists || !worlds) throw new Error('a new-campaign restore needs the world cache');
    const assembled = assembleCampaign(inputs.read, exists, parts, state, { construction: 'restore', tactical, worlds });
    roster = assembled.roster;
    return assembled.campaign;
  };
  const campaign = restoreCampaign(snapshot.sim, { content: campaignContentRoots(parts), world: loadedWorld(inputs), assemble });
  return new CampaignSession(campaign, parts.presentation, roster, inputs.worlds, parts.narrative.texts, { kind, parts });
}

export function restoreSessionFrom(raw: unknown, inputs: SessionRestoreInputs): SessionSim {
  const snapshot = checkSessionSnapshot(raw, snapshotMigrationContext(inputs.presentation));
  return snapshot.session === 'sandbox' ? restoreSandbox(snapshot, inputs) : restoreCampaignSession(snapshot, inputs);
}

export interface SessionLoadOptions {
  readonly layers?: LayerCount;
  readonly decoding?: DataDecoding;
}

async function preparedWorlds(snapshot: SessionSnapshot, read: ReadFile, exists: FileExists | null): Promise<WorldCache | null> {
  if (!exists) return null;
  const worlds = new WorldCache(read, exists);
  await worlds.prepare(snapshot.preparedMaps);
  return worlds;
}

async function freshLoadedWorld(snapshot: SessionSnapshot, read: ReadFile, worlds: WorldCache | null): Promise<TacticalWorld | null> {
  const mapPath = snapshot.sim.mapPath;
  if (mapPath === null) return null;
  return worlds?.world(mapPath) ?? loadTacticalWorld(read, mapPath);
}

export async function restoreSession(
  raw: unknown,
  read: ReadFile,
  exists: FileExists | null,
  options: SessionLoadOptions = {},
): Promise<SessionSim> {
  const timelines = await requireAnimationTimelines(read);
  const snapshot = checkSessionSnapshot(raw, snapshotMigrationContext(timelines.presentation));
  const decoding = options.decoding ?? DEFAULT_DATA_DECODING;
  if (snapshot.session === 'sandbox') {
    const [content, world] = await Promise.all([loadTacticalContent(read, decoding), freshLoadedWorld(snapshot, read, null)]);
    return restoreSessionFrom(snapshot, { read, presentation: timelines.presentation, exists, parts: null, content, worlds: null, world });
  }
  if (snapshot.session === 'campaign' && !exists) throw new Error('a new-campaign restore needs a file lookup');
  const parts =
    snapshot.session === 'campaign' && exists
      ? (await loadCampaignParts(read, exists, options.layers, decoding)).parts
      : await loadImportParts(read, exists, options.layers, decoding);
  const worlds = await preparedWorlds(snapshot, read, exists);
  const world = await freshLoadedWorld(snapshot, read, worlds);
  return restoreSessionFrom(snapshot, { read, presentation: parts.presentation, exists, parts, content: parts.content, worlds, world });
}

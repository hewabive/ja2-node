import type { TacticalWorld } from '../../content/world/tactical-world.ts';
import { Rng } from '../../core/rng.ts';
import type { CampaignSim } from '../campaign/campaign-sim.ts';
import type { StrategicState } from '../strategic/state.ts';
import { NO_EXPERIENCE_HOOKS } from '../tactical/combat/context.ts';
import { NO_NARRATIVE_PORT } from '../tactical/narrative/port.ts';
import { NO_SCHEDULE_CLOCK } from '../tactical/narrative/schedule-state.ts';
import {
  createPathEnv,
  NO_HOOKS,
  NO_PERCEPTION_HOOKS,
  NO_SECTOR_HOOKS,
  NO_TURN_HOOKS,
  type PathEnvSettings,
  pathEnvSettings,
  type TacticalState,
} from '../tactical/state.ts';
import { TacticalSim } from '../tactical/tactical-sim.ts';
import { canonicalJson, decodeGraph, type EncodedGraph, encodeGraph, type Section, SnapshotError } from './codec.ts';
import { NO_MIGRATION_CONTEXT, type SnapshotMigrationContext, snapshotMigrations } from './migrations.ts';
import type { ContentRoots } from './refs.ts';
import { externalSources, SNAPSHOT_CODECS } from './world.ts';

export const SNAPSHOT_FORMAT = 'ja2-node-snapshot';
export const SNAPSHOT_VERSION = 13;

export type SnapshotKind = 'campaign' | 'tactical';

export interface SimSnapshot {
  readonly format: typeof SNAPSHOT_FORMAT;
  readonly version: number;
  readonly kind: SnapshotKind;
  readonly mapPath: string | null;
  readonly graph: EncodedGraph;
}

export interface RestoreSources {
  readonly content: ContentRoots;
  world(mapPath: string): TacticalWorld;
}

export interface CampaignRestoreSources extends RestoreSources {
  assemble(state: StrategicState, tactical: TacticalSim | null): CampaignSim;
}

const TRANSIENT_TACTICAL_FIELDS: ReadonlySet<string> = new Set([
  'hooks',
  'perceptionHooks',
  'turnHooks',
  'sectorHooks',
  'experienceHooks',
  'narrative',
  'scheduleClock',
  'pathEnv',
]);

function tacticalData(t: TacticalState): Record<string, unknown> {
  const data: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(t)) if (!TRANSIENT_TACTICAL_FIELDS.has(key)) data[key] = value;
  data.pathEnv = pathEnvSettings(t.pathEnv);
  return data;
}

function reviveTactical(data: unknown): TacticalState {
  const fields = data as Omit<TacticalState, 'pathEnv'> & { readonly pathEnv: PathEnvSettings };
  return {
    ...fields,
    hooks: NO_HOOKS,
    perceptionHooks: NO_PERCEPTION_HOOKS,
    turnHooks: NO_TURN_HOOKS,
    sectorHooks: NO_SECTOR_HOOKS,
    experienceHooks: NO_EXPERIENCE_HOOKS,
    narrative: NO_NARRATIVE_PORT,
    scheduleClock: NO_SCHEDULE_CLOCK,
    pathEnv: createPathEnv(fields, fields.pathEnv),
  };
}

function tacticalSections(sim: TacticalSim): Section[] {
  const t = sim.state;
  return [
    ['world', sim.world],
    ['lights', t.lighting.sprites],
    ['items', t.worldItems],
    ['soldiers', t.soldiers],
    ['bullets', t.bullets],
  ];
}

function encodeSnapshot(kind: SnapshotKind, world: TacticalWorld | null, sections: readonly Section[], content: ContentRoots): SimSnapshot {
  const sources = externalSources(content, world);
  return {
    format: SNAPSHOT_FORMAT,
    version: SNAPSHOT_VERSION,
    kind,
    mapPath: world?.mapPath ?? null,
    graph: encodeGraph(sections, { classes: SNAPSHOT_CODECS, external: sources.external }),
  };
}

export function snapshotTactical(sim: TacticalSim, content: ContentRoots): SimSnapshot {
  const sections: Section[] = [...tacticalSections(sim), ['rng', sim.state.rng], ['tactical', tacticalData(sim.state)]];
  return encodeSnapshot('tactical', sim.world, sections, content);
}

export function snapshotCampaign(campaign: CampaignSim, content: ContentRoots): SimSnapshot {
  const sim = campaign.tactical;
  const s = campaign.state;
  const sections: Section[] = [
    ...(sim ? tacticalSections(sim) : []),
    ['rng', s.rng],
    ['strategic', s],
    ...(sim ? [['tactical', tacticalData(sim.state)] as const] : []),
  ];
  return encodeSnapshot('campaign', sim?.world ?? null, sections, content);
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function migrateSnapshot(raw: unknown, context: SnapshotMigrationContext = NO_MIGRATION_CONTEXT): SimSnapshot {
  if (!isRecord(raw) || raw.format !== SNAPSHOT_FORMAT) throw new SnapshotError('not a ja2-node snapshot');
  let version = raw.version;
  if (typeof version !== 'number' || !Number.isInteger(version) || version < 1)
    throw new SnapshotError('the snapshot has no valid version');
  if (version > SNAPSHOT_VERSION) throw new SnapshotError(`the snapshot version ${version} is newer than ${SNAPSHOT_VERSION}`);
  let current: Readonly<Record<string, unknown>> = raw;
  const migrations = snapshotMigrations(context);
  while (version < SNAPSHOT_VERSION) {
    const migrate = migrations[version];
    if (!migrate) throw new SnapshotError(`no migration from snapshot version ${version}`);
    current = { ...migrate(current), version: version + 1 };
    version++;
  }
  return current as unknown as SimSnapshot;
}

function decodeSections(raw: unknown, kind: SnapshotKind, sources: RestoreSources): Map<string, unknown> {
  const snapshot = migrateSnapshot(raw);
  if (snapshot.kind !== kind) throw new SnapshotError(`a ${snapshot.kind} snapshot cannot be restored as a ${kind} session`);
  const world = snapshot.mapPath === null ? null : sources.world(snapshot.mapPath);
  const external = externalSources(sources.content, world);
  return decodeGraph(snapshot.graph, { classes: SNAPSHOT_CODECS, resolve: external.resolve });
}

function restoredTactical(sections: Map<string, unknown>): TacticalSim | null {
  const data = sections.get('tactical');
  if (data === undefined) return null;
  return TacticalSim.restore(sections.get('world') as TacticalWorld, reviveTactical(data));
}

export function restoreTactical(snapshot: unknown, sources: RestoreSources): TacticalSim {
  const sim = restoredTactical(decodeSections(snapshot, 'tactical', sources));
  if (!sim) throw new SnapshotError('the tactical snapshot holds no tactical state');
  return sim;
}

export function restoreCampaign(snapshot: unknown, sources: CampaignRestoreSources): CampaignSim {
  const sections = decodeSections(snapshot, 'campaign', sources);
  const tactical = restoredTactical(sections);
  const campaign = sources.assemble(sections.get('strategic') as StrategicState, tactical);
  if (campaign.tactical !== tactical) throw new SnapshotError('the campaign was not assembled around the restored tactical sim');
  campaign.sectors?.reattachLoadedSector();
  return campaign;
}

export function snapshotJson(snapshot: SimSnapshot): string {
  return canonicalJson(snapshot);
}

export function reseedMain(state: { readonly rng: Rng }, seed: number): void {
  state.rng.restore(Rng.fromSeed(seed).state());
}

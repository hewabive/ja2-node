import type { TacticalWorld } from '../../src/content/world/tactical-world.ts';
import type { ReadFile } from '../../src/content/world/tileset-loader.ts';
import type { CommandEnvelope, SessionAdvanceReport } from '../../src/protocol/messages.ts';
import { CampaignSession } from '../../src/server/campaign-session.ts';
import { TacticalSession } from '../../src/server/sandbox.ts';
import { Session, type SessionSim } from '../../src/server/session.ts';
import { restoreSessionFrom, type SessionRestoreInputs, type SessionSnapshot, snapshotSession } from '../../src/server/session-snapshot.ts';
import type { Slicer } from '../../src/server/slicing.ts';
import type { FileExists } from '../../src/server/world-cache.ts';
import type { StopCondition } from '../../src/sim/advance.ts';
import type { CommandResult } from '../../src/sim/command.ts';
import { defaultRunMode, driven, type ReloadAdapter, type RunMode, reloadPoint, worldContentOnce } from './reload.ts';
import type { StubSectorKit } from './sectors.ts';
import { ViewMirror } from './view-mirror.ts';

export interface SessionSources {
  readonly read: ReadFile;
  readonly exists: FileExists;
  readonly world?: (mapPath: string) => TacticalWorld;
}

function restoreInputs(
  previous: SessionSim,
  snapshot: SessionSnapshot,
  sources: SessionSources,
  world: ((mapPath: string) => TacticalWorld) | null,
): SessionRestoreInputs {
  const mapPath = snapshot.sim.mapPath;
  const base = { read: sources.read, exists: sources.exists };
  if (previous instanceof TacticalSession) {
    const loaded = mapPath === null ? null : (world?.(mapPath) ?? previous.sim.world);
    return { ...base, presentation: previous.presentation, parts: null, content: previous.sim.state.content, worlds: null, world: loaded };
  }
  if (!(previous instanceof CampaignSession) || !previous.origin) throw new Error('this session cannot be reloaded');
  const worlds = previous.worlds?.fork(snapshot.preparedMaps) ?? null;
  const loaded = mapPath === null ? null : (world?.(mapPath) ?? previous.campaign.tactical?.world ?? null);
  return {
    ...base,
    presentation: previous.presentation,
    parts: previous.origin.parts,
    content: previous.origin.parts.content,
    worlds,
    world: loaded,
  };
}

export function sessionAdapter(sources: SessionSources): ReloadAdapter<SessionSim> {
  const world = sources.world ? worldContentOnce(sources.world) : null;
  return {
    drainBeforeReload: (sim) => sim instanceof CampaignSession,
    snapshot: (sim) => snapshotSession(sim),
    restore: (snapshot, previous) => {
      const restored = restoreSessionFrom(snapshot, restoreInputs(previous, snapshot as SessionSnapshot, sources, world));
      if (previous instanceof CampaignSession) restored.useLabels?.(previous.labels);
      return restored;
    },
  };
}

export function drivenSession<T extends SessionSim>(session: T, sources: SessionSources, mode: RunMode | null = defaultRunMode()): T {
  return mode ? (driven(session, sessionAdapter(sources) as unknown as ReloadAdapter<T>, mode) as T) : session;
}

export function stubSessionSources(kit: StubSectorKit): SessionSources {
  return { read: kit.read, exists: (path) => kit.worlds.exists(path), world: (path) => kit.world(path) };
}

export class ReloadingSession extends Session {
  readonly mirror = new ViewMirror(this);

  override advance(until: StopCondition, budget?: number): SessionAdvanceReport {
    const report = super.advance(until, budget);
    reloadPoint(this.sim);
    this.mirror.expectMatches(this);
    return report;
  }

  override dispatch(cmd: CommandEnvelope): CommandResult {
    const result = super.dispatch(cmd);
    this.mirror.expectMatches(this);
    return result;
  }

  override async dispatchSliced(cmd: CommandEnvelope, slicer: Slicer): Promise<CommandResult> {
    const result = await super.dispatchSliced(cmd, slicer);
    this.mirror.expectMatches(this);
    return result;
  }
}

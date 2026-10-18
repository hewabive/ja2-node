import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import type { LayerCount } from '../content/narrative/npc-records.ts';
import type { DataDecoding } from '../content/text/data-version.ts';
import type { ReadFile } from '../content/world/tileset-loader.ts';
import { createCampaignSession } from './campaign-factory.ts';
import type { LogOrigin } from './input-log.ts';
import { createSandboxSession } from './sandbox.ts';
import { musicOfPresentation } from './save-file.ts';
import { type OpenedSave, SaveLoadError, type SaveService } from './save-service.ts';
import { createSaveSession } from './save-session.ts';
import type { SaveStore } from './save-store.ts';
import { Session, type SessionSim, type SessionText } from './session.ts';
import type { SessionFactory, SessionRequest } from './session-registry.ts';
import type { FileExists } from './world-cache.ts';

export interface SessionSources {
  readonly read: ReadFile;
  readonly exists: FileExists;
  readonly layers?: LayerCount | undefined;
  readonly decoding?: DataDecoding | undefined;
  readonly originalData: boolean;
  readonly store: SaveStore | null;
}

export interface SessionFactoryOptions extends SessionSources {
  readonly text: SessionText;
  readonly saves: SaveService | null;
}

function digestOf(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

async function nativeSave(sources: SessionSources, name: string): Promise<Uint8Array> {
  if (!sources.originalData) throw new Error('savegames need the original data (JA2_DATA_DIR)');
  const path = sources.store?.nativePath(name) ?? null;
  if (!path) throw new Error(`invalid save name ${name} or no SavedGames folder (JA2_SAVES_DIR)`);
  return new Uint8Array(await readFile(path));
}

export async function simFromOrigin(sources: SessionSources, origin: LogOrigin, saves: SaveService | null): Promise<SessionSim> {
  const { read, exists, layers, decoding } = sources;
  switch (origin.kind) {
    case 'sandbox':
      return createSandboxSession(read, sources.originalData, origin.seed, decoding);
    case 'campaign':
      return createCampaignSession(read, exists, origin.seed, origin.campaign, layers, decoding);
    case 'import': {
      const bytes = await nativeSave(sources, origin.save);
      if (digestOf(bytes) !== origin.digest) throw new Error(`the native save ${origin.save} changed since the log was written`);
      return (await createSaveSession(read, bytes, origin.seed, exists, layers, decoding)).session;
    }
    case 'load': {
      if (!saves) throw new Error('loading a save needs the save service');
      const opened = await saves.open(origin.name);
      if (opened.digest !== origin.digest) throw new Error(`the save ${origin.name} changed since the log was written`);
      return opened.sim;
    }
    case 'unknown':
      throw new Error('this log has no known origin');
  }
}

async function openLoad(saves: SaveService | null, name: string): Promise<OpenedSave> {
  if (!saves) throw new SaveLoadError('notFound', 'saves are not available');
  return saves.open(name);
}

export function createSessionFactory(options: SessionFactoryOptions): SessionFactory {
  const { saves, text } = options;
  return async (id: string, request: SessionRequest): Promise<Session> => {
    if (request.load) {
      const opened = await openLoad(saves, request.load.name);
      const session = new Session(id, opened.sim, text, { kind: 'load', name: opened.name, digest: opened.digest });
      session.restoreMusic(musicOfPresentation(opened.file.presentation));
      saves?.attach(session);
      saves?.completeLoad(session, opened, request.load.reseed);
      return session;
    }
    let origin: LogOrigin;
    let deadIsDeadName: string | null = null;
    if (request.campaign) {
      origin = { kind: 'campaign', seed: request.seed, campaign: request.campaign };
      deadIsDeadName = request.campaign.deadIsDeadName ?? null;
    } else if (request.save) {
      const bytes = await nativeSave(options, request.save);
      origin = { kind: 'import', seed: request.seed, save: request.save, digest: digestOf(bytes) };
      deadIsDeadName = request.save;
    } else origin = { kind: 'sandbox', seed: request.seed };
    const session = new Session(id, await simFromOrigin(options, origin, saves), text, origin);
    saves?.attach(session, { deadIsDeadName });
    return session;
  };
}

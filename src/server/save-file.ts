import { createHash } from 'node:crypto';
import { promisify } from 'node:util';
import { constants, gunzipSync, gzip, gzipSync } from 'node:zlib';
import { sectorShortString } from '../content/strategic/sector-ids.ts';
import { initialMusic, type MusicState } from '../protocol/music.ts';
import { isMusicMode, MusicMode } from '../protocol/music-modes.ts';
import { type CampaignStatus, campaignStatus } from '../sim/campaign/ending-state.ts';
import { storyFlow } from '../sim/campaign/story-refusals.ts';
import type { GameOptions } from '../sim/options.ts';
import type { SimSnapshot } from '../sim/snapshot/session.ts';
import { worldDay, worldHour, worldMinute } from '../sim/strategic/time/world-clock.ts';
import { Team } from '../sim/tactical/soldier.ts';
import { teamMembers } from '../sim/tactical/state.ts';
import { CampaignSession } from './campaign-session.ts';
import type { ContentFileEntry, ContentIdentityHeader, EngineIdentity } from './content-identity.ts';
import { TacticalSession } from './sandbox.ts';
import type { SessionSim } from './session.ts';
import type { SessionKind, SessionSnapshot } from './session-snapshot.ts';

export const SAVE_FORMAT = 'ja2-node-save';
export const SAVE_VERSION = 2;
export const RULE_PACK_SAVE_VERSION = 2;
export const SAVE_EXTENSION = '.j2s';
export const MAX_DESCRIPTION_CHARS = 46;
export const MAX_SAVE_TEXT_BYTES = 512 * 1024 * 1024;
const HEADER_LINE_END = '\n';
const GZIP_OPTIONS = { level: constants.Z_BEST_SPEED };
const SECTOR_MAP_NAME = /([a-p])(\d{1,2})(?:_b(\d))?\.dat$/i;
const ROW_LETTER_BASE = 96;
const gzipAsync = promisify(gzip);

export type SaveKind = 'player' | 'quick' | 'auto' | 'deadIsDead';

export type SaveOptions = Readonly<GameOptions>;

export interface WorldTime {
  readonly day: number;
  readonly hour: number;
  readonly minute: number;
}

export interface SaveHeader {
  readonly kind: SaveKind;
  readonly description: string;
  readonly savedAt: string;
  readonly engine: EngineIdentity;
  readonly content: ContentIdentityHeader;
  readonly options: SaveOptions;
  readonly world: WorldTime | null;
  readonly sector: string | null;
  readonly flow: string;
  readonly mercs: number;
  readonly balance: number;
  readonly campaign: CampaignStatus;
  readonly session: SessionKind;
  readonly tick: number;
}

export interface SaveSessionPart {
  readonly kind: SessionKind;
  readonly origin: string;
  readonly tick: number;
  readonly preparedMaps: readonly string[];
}

export interface SavePresentation {
  readonly music: { readonly mode: string; readonly previous: string };
}

export interface LegacyContentBinding {
  readonly files: readonly ContentFileEntry[];
}

export interface SaveFile {
  readonly format: typeof SAVE_FORMAT;
  readonly version: number;
  readonly header: SaveHeader;
  readonly session: SaveSessionPart;
  readonly sim: SimSnapshot;
  readonly presentation: SavePresentation;
  readonly legacyContent?: LegacyContentBinding;
}

export interface SaveFileHead {
  readonly format: string;
  readonly version: number;
  readonly header: SaveHeader;
}

export const EMPTY_PRESENTATION: SavePresentation = { music: { mode: MusicMode.NONE, previous: MusicMode.NONE } };

export function presentationOf(music: MusicState): SavePresentation {
  return { music: { mode: music.mode, previous: music.previous } };
}

export function musicOfPresentation(presentation: SavePresentation | undefined): MusicState {
  const music = presentation?.music;
  return initialMusic(
    isMusicMode(music?.mode) ? music.mode : MusicMode.NONE,
    isMusicMode(music?.previous) ? music.previous : MusicMode.NONE,
  );
}

export type SaveFileProblem = 'notASave' | 'versionTooNew' | 'noMigration' | 'corrupt';

export class SaveFileError extends Error {
  readonly problem: SaveFileProblem;

  constructor(problem: SaveFileProblem, message: string) {
    super(message);
    this.problem = problem;
  }
}

export type SaveMigration = (file: Readonly<Record<string, unknown>>) => Record<string, unknown>;

const LEGACY_CONTENT_FILES_KEY = 'contentFiles';

function legacyContentBinding(file: Readonly<Record<string, unknown>>): Record<string, unknown> {
  const { [LEGACY_CONTENT_FILES_KEY]: files, ...rest } = file;
  if (!Array.isArray(files)) throw new SaveFileError('corrupt', 'the save has no content file list');
  return { ...rest, legacyContent: { files } };
}

export const SAVE_MIGRATIONS: Readonly<Record<number, SaveMigration>> = {
  1: legacyContentBinding,
};

export interface MigrationTable {
  readonly current: number;
  readonly migrations: Readonly<Record<number, SaveMigration>>;
}

const DEFAULT_MIGRATIONS: MigrationTable = { current: SAVE_VERSION, migrations: SAVE_MIGRATIONS };

export function digestOf(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

export interface EncodedSave {
  readonly bytes: Uint8Array;
  readonly digest: string;
}

function headLine(file: SaveFile): string {
  return `{"format":${JSON.stringify(file.format)},"version":${file.version},"header":${JSON.stringify(file.header)},${HEADER_LINE_END}`;
}

function bodyText(file: SaveFile): string {
  return [
    `"session":${JSON.stringify(file.session)}`,
    `"sim":${JSON.stringify(file.sim)}`,
    `"presentation":${JSON.stringify(file.presentation)}`,
    ...(file.legacyContent ? [`"legacyContent":${JSON.stringify(file.legacyContent)}`] : []),
  ]
    .join(',')
    .concat('}');
}

export function encodeSaveFile(file: SaveFile): EncodedSave {
  const head = Buffer.from(headLine(file), 'utf8');
  const body = Buffer.from(bodyText(file), 'utf8');
  const bytes = Buffer.concat([gzipSync(head, GZIP_OPTIONS), gzipSync(body, GZIP_OPTIONS)]);
  return { bytes, digest: createHash('sha256').update(head).update(body).digest('hex') };
}

export async function encodeSaveFileAsync(file: SaveFile): Promise<EncodedSave> {
  const head = Buffer.from(headLine(file), 'utf8');
  const body = Buffer.from(bodyText(file), 'utf8');
  const [zippedHead, zippedBody] = await Promise.all([gzipAsync(head, GZIP_OPTIONS), gzipAsync(body, GZIP_OPTIONS)]);
  return { bytes: Buffer.concat([zippedHead, zippedBody]), digest: createHash('sha256').update(head).update(body).digest('hex') };
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function checkHead(value: unknown): SaveFileHead {
  if (!isRecord(value) || value.format !== SAVE_FORMAT) throw new SaveFileError('notASave', 'not a ja2-node save');
  if (typeof value.version !== 'number' || !Number.isInteger(value.version) || value.version < 1)
    throw new SaveFileError('corrupt', 'the save has no valid version');
  if (!isRecord(value.header)) throw new SaveFileError('corrupt', 'the save has no header');
  return value as unknown as SaveFileHead;
}

function inflatePrefix(bytes: Uint8Array): string {
  try {
    return gunzipSync(bytes, { finishFlush: constants.Z_SYNC_FLUSH, maxOutputLength: MAX_SAVE_TEXT_BYTES }).toString('utf8');
  } catch {
    throw new SaveFileError('notASave', 'not a gzip file');
  }
}

export function readSaveHead(prefix: Uint8Array): SaveFileHead {
  const text = inflatePrefix(prefix);
  const end = text.indexOf(HEADER_LINE_END);
  if (end < 0) throw new SaveFileError('corrupt', 'the save header is incomplete');
  const line = text.slice(0, end).replace(/,\s*$/, '');
  try {
    return checkHead(JSON.parse(`${line}}`));
  } catch (err) {
    if (err instanceof SaveFileError) throw err;
    throw new SaveFileError('corrupt', 'the save header is not valid JSON');
  }
}

export interface DecodedSave {
  readonly text: string;
  readonly digest: string;
}

export function inflateSave(bytes: Uint8Array): DecodedSave {
  let text: string;
  try {
    text = gunzipSync(bytes, { maxOutputLength: MAX_SAVE_TEXT_BYTES }).toString('utf8');
  } catch {
    throw new SaveFileError('notASave', 'not a complete gzip file');
  }
  return { text, digest: digestOf(text) };
}

export function migrateSaveFile(raw: unknown, table: MigrationTable = DEFAULT_MIGRATIONS): SaveFile {
  checkHead(raw);
  let current = raw as Readonly<Record<string, unknown>>;
  let version = current.version as number;
  if (version > table.current) throw new SaveFileError('versionTooNew', `the save version ${version} is newer than ${table.current}`);
  while (version < table.current) {
    const migrate = table.migrations[version];
    if (!migrate) throw new SaveFileError('noMigration', `no migration from save version ${version}`);
    current = { ...migrate(current), version: version + 1 };
    version++;
  }
  for (const key of ['session', 'sim', 'presentation'])
    if (!isRecord(current[key])) throw new SaveFileError('corrupt', `the save has no ${key} part`);
  const legacy = current.legacyContent as Partial<LegacyContentBinding> | undefined;
  if (legacy !== undefined && !Array.isArray(legacy.files)) throw new SaveFileError('corrupt', 'the save has a bad legacy content list');
  return current as unknown as SaveFile;
}

export function parseSaveText(text: string, table: MigrationTable = DEFAULT_MIGRATIONS): SaveFile {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SaveFileError('corrupt', 'the save body is not valid JSON');
  }
  return migrateSaveFile(raw, table);
}

export function snapshotOf(file: SaveFile): SessionSnapshot {
  return { session: file.session.kind, preparedMaps: file.session.preparedMaps, sim: file.sim };
}

export function snapshotText(snapshot: SessionSnapshot): string {
  return JSON.stringify({ session: snapshot.session, preparedMaps: snapshot.preparedMaps, sim: snapshot.sim });
}

export function clampDescription(description: string): string {
  return [...description.replace(/[\r\n\t]+/g, ' ').trim()].slice(0, MAX_DESCRIPTION_CHARS).join('');
}

export interface SessionSummary {
  readonly options: SaveOptions;
  readonly world: WorldTime | null;
  readonly sector: string | null;
  readonly flow: string;
  readonly mercs: number;
  readonly balance: number;
  readonly campaign: CampaignStatus;
  readonly tick: number;
}

function sectorString(s: { readonly x: number; readonly y: number; readonly z: number }): string {
  return s.z ? `${sectorShortString(s)}-${s.z}` : sectorShortString(s);
}

function mapSector(mapPath: string): string | null {
  const m = SECTOR_MAP_NAME.exec(mapPath);
  if (!m) return null;
  const y = (m[1] as string).toLowerCase().charCodeAt(0) - ROW_LETTER_BASE;
  return sectorString({ x: Number(m[2]), y, z: Number(m[3] ?? 0) });
}

function campaignSummary(session: CampaignSession): SessionSummary {
  const campaign = session.campaign;
  const s = campaign.state;
  return {
    options: { ...s.options },
    world: { day: worldDay(s.clock), hour: worldHour(s.clock), minute: worldMinute(s.clock) },
    sector: s.worldSector ? sectorString(s.worldSector) : null,
    flow: storyFlow(campaign) ?? s.flow,
    mercs: campaign.strategic?.mercs.all().length ?? s.roster.mercs.size,
    balance: s.finances.balance,
    campaign: campaignStatus(s.ending),
    tick: campaign.tick,
  };
}

function sandboxSummary(session: TacticalSession): SessionSummary {
  const t = session.sim.state;
  return {
    options: { ...t.options },
    world: null,
    sector: mapSector(session.sim.mapPath),
    flow: 'tactical',
    mercs: teamMembers(t, Team.OUR).length,
    balance: 0,
    campaign: 'playing',
    tick: session.tick,
  };
}

export function summarizeSession(sim: SessionSim): SessionSummary {
  if (sim instanceof CampaignSession) return campaignSummary(sim);
  if (sim instanceof TacticalSession) return sandboxSummary(sim);
  throw new Error('this session kind cannot be saved');
}

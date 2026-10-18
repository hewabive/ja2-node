import type { UiLanguage } from '../../content/text/data-version.ts';

export type SaveMode = 'anywhere' | 'ironMan' | 'deadIsDead';
export type Difficulty = 1 | 2 | 3;

export interface GameOptions {
  readonly difficulty: Difficulty;
  readonly sciFi: boolean;
  readonly gunNut: boolean;
  readonly saveMode: SaveMode;
  readonly bloodAndGore: boolean;
}

export interface EngineIdentity {
  readonly version: string;
  readonly commit: string;
}

export interface Health {
  readonly ok: boolean;
  readonly data: { readonly original: boolean; readonly slf: number; readonly stubs: boolean };
  readonly dataVersion: string;
  readonly language: UiLanguage;
  readonly engine?: EngineIdentity;
  readonly files: number;
}

export type SaveKind = 'player' | 'quick' | 'auto' | 'deadIsDead';
export type SessionKind = 'campaign' | 'sandbox' | 'imported';

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
  readonly content: { readonly source: string; readonly dataVersion: string };
  readonly options: GameOptions;
  readonly world: WorldTime | null;
  readonly sector: string | null;
  readonly flow: string;
  readonly mercs: number;
  readonly balance: number;
  readonly campaign: string;
  readonly session: SessionKind;
  readonly tick: number;
}

export interface NativeSaveHeader {
  readonly description: string;
  readonly world: WorldTime;
  readonly sector: { readonly x: number; readonly y: number; readonly z: number };
  readonly mercs: number;
  readonly balance: number;
  readonly version: number;
  readonly options: GameOptions;
  readonly droppedOptions?: readonly string[];
}

export type SaveListing =
  | {
      readonly name: string;
      readonly native: false;
      readonly modified: string;
      readonly header: SaveHeader | null;
      readonly version: number | null;
      readonly compatible: boolean;
      readonly problems: readonly string[];
    }
  | {
      readonly name: string;
      readonly native: true;
      readonly modified: string;
      readonly header: NativeSaveHeader;
      readonly compatible: boolean;
      readonly problems: readonly string[];
    };

export type LoadWarning = 'dataVersionDiffers' | 'engineDiffers';

export interface SessionSummary {
  readonly session: string;
  readonly map: string | null;
  readonly language?: UiLanguage;
  readonly options?: GameOptions;
  readonly flow?: string;
  readonly sector?: string | null;
  readonly campaign?: string;
  readonly canSave?: boolean;
}

export interface Refusal {
  readonly ok: false;
  readonly refused: string;
  readonly reason: string;
}

export interface SaveSuccess {
  readonly ok: true;
  readonly name: string;
  readonly kind: SaveKind;
  readonly header: SaveHeader;
}

export interface LoadSuccess {
  readonly ok: true;
  readonly name: string;
  readonly seed: number | null;
  readonly warnings: readonly LoadWarning[];
  readonly header: SaveHeader;
}

export interface UploadSuccess {
  readonly ok: true;
  readonly name: string;
  readonly header: SaveHeader;
  readonly warnings: readonly LoadWarning[];
}

export class ApiError extends Error {
  readonly status: number;
  readonly refused: string | null;

  constructor(status: number, message: string, refused: string | null) {
    super(message);
    this.status = status;
    this.refused = refused;
  }
}

interface ErrorBody {
  readonly error?: string;
  readonly refused?: string;
  readonly reason?: string;
}

async function json<T>(res: Response): Promise<T> {
  const body = (await res.json().catch(() => ({}))) as T & ErrorBody;
  if (!res.ok) throw new ApiError(res.status, body.reason ?? body.error ?? `HTTP ${res.status}`, body.refused ?? null);
  return body;
}

function post(url: string, body: unknown): Promise<Response> {
  return fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
}

const sessionPath = (id: string) => `/api/sessions/${encodeURIComponent(id)}`;
const savePath = (name: string) => `/api/saves/${encodeURIComponent(name)}`;

export const fetchHealth = async (): Promise<Health> => json<Health>(await fetch('/api/health'));
export const fetchSessions = async (): Promise<SessionSummary[]> => json<SessionSummary[]>(await fetch('/api/sessions'));
export const fetchSaves = async (): Promise<SaveListing[]> => json<SaveListing[]>(await fetch('/api/saves'));

export async function createSession(body: unknown): Promise<SessionSummary & { readonly load?: LoadSuccess }> {
  return json(await post('/api/sessions', body));
}

export async function saveSession(session: string, request: { name?: string; description?: string }): Promise<SaveSuccess | Refusal> {
  const res = await post(`${sessionPath(session)}/save`, request);
  const body = (await res.json().catch(() => ({}))) as (SaveSuccess | Refusal) & ErrorBody;
  if (res.ok || 'refused' in body) return body;
  throw new ApiError(res.status, body.error ?? `HTTP ${res.status}`, null);
}

export async function loadIntoSession(session: string, name: string): Promise<LoadSuccess> {
  return json(await post(`${sessionPath(session)}/load`, { name }));
}

export async function deleteSave(name: string): Promise<boolean> {
  const res = await fetch(savePath(name), { method: 'DELETE' });
  return (await json<{ readonly deleted: boolean }>(res)).deleted;
}

export function saveFileUrl(name: string): string {
  return `${savePath(name)}/file`;
}

export async function uploadSave(name: string, bytes: Uint8Array<ArrayBuffer>): Promise<UploadSuccess> {
  return json(await fetch(saveFileUrl(name), { method: 'PUT', headers: { 'content-type': 'application/gzip' }, body: bytes }));
}

import type { Health, LoadSuccess, Refusal, SaveListing, SaveSuccess, SessionSummary, UploadSuccess } from '../../ui/client/api-types.ts';

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

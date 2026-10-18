import { randomBytes } from 'node:crypto';
import { mkdir, open, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parseSaveHeader, type SaveGameHeader } from '../content/formats/savegame-header.ts';
import { REPO_ROOT } from '../node/repo.ts';
import { readSaveHead, SAVE_EXTENSION, type SaveFileHead } from './save-file.ts';

export const SAVE_DIR_ENV = 'JA2_SAVE_DIR';
export const DEFAULT_SAVE_DIR = join(REPO_ROOT, '.ja2', 'saves');
export const QUICK_SAVE_NAME = 'QuickSave';
export const AUTO_SAVE_NAMES = ['Auto01', 'Auto02'] as const;
export const ERROR_LOG_NAME = 'Error';
export const BACKUP_DIR = 'Backup';
export const NUM_SAVE_BACKUPS = 2;
export const MAX_UPLOAD_BYTES = 32 * 1024 * 1024;
export const SAVE_FILE_NAME = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;
export const LOG_SUFFIX = '.log.jsonl.gz';
export const NATIVE_EXTENSION = '.sav';
const NATIVE_NAME = /^[A-Za-z0-9_-]{1,64}$/;
const MAX_SAVE_NAME_CHARS = 64;
const HEAD_PREFIX_BYTES = 64 * 1024;
const NATIVE_HEADER_BYTES = 2048;
const TEMP_SUFFIX = '.tmp';
const RESERVED_NAMES: ReadonlySet<string> = new Set([QUICK_SAVE_NAME, ...AUTO_SAVE_NAMES, ERROR_LOG_NAME].map((n) => n.toLowerCase()));

export function saveDirFromEnv(env: NodeJS.ProcessEnv = process.env): string {
  return env[SAVE_DIR_ENV]?.trim() || DEFAULT_SAVE_DIR;
}

export function isValidSaveName(name: string): boolean {
  return SAVE_FILE_NAME.test(name);
}

export function isReservedSaveName(name: string): boolean {
  return RESERVED_NAMES.has(name.toLowerCase());
}

export function slugify(text: string): string {
  return text
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export function playerSaveName(description: string, now: Date): string {
  const stamp = `${now.toISOString().slice(0, 19)}Z`;
  const slug = slugify(`${stamp}-${description}`);
  return slug.slice(0, MAX_SAVE_NAME_CHARS).replace(/-+$/, '');
}

export interface StoredSave {
  readonly name: string;
  readonly modifiedMs: number;
  readonly head: SaveFileHead | null;
  readonly problem: string | null;
}

export interface NativeSave {
  readonly name: string;
  readonly modifiedMs: number;
  readonly header: SaveGameHeader;
}

export interface SaveWrite {
  readonly bytes: Uint8Array;
  readonly log: Uint8Array | null;
  readonly backups: boolean;
}

function checkName(name: string): string {
  if (!isValidSaveName(name)) throw new Error(`invalid save name ${JSON.stringify(name)}`);
  return name;
}

async function readPrefix(path: string, bytes: number): Promise<Uint8Array> {
  const handle = await open(path, 'r');
  try {
    const buffer = Buffer.alloc(bytes);
    const { bytesRead } = await handle.read(buffer, 0, bytes, 0);
    return buffer.subarray(0, bytesRead);
  } finally {
    await handle.close();
  }
}

async function exists(path: string): Promise<boolean> {
  return stat(path).then(
    () => true,
    () => false,
  );
}

async function modifiedMs(path: string): Promise<number | null> {
  return stat(path).then(
    (s) => s.mtimeMs,
    () => null,
  );
}

export class SaveStore {
  readonly dir: string;
  readonly nativeDir: string | null;
  #lastAuto: number | null = null;

  constructor(dir: string, nativeDir: string | null = null) {
    this.dir = dir;
    this.nativeDir = nativeDir;
  }

  filePath(name: string): string {
    return join(this.dir, `${checkName(name)}${SAVE_EXTENSION}`);
  }

  logPath(name: string): string {
    return join(this.dir, `${checkName(name)}${LOG_SUFFIX}`);
  }

  backupPath(name: string, index: number): string {
    return join(this.dir, BACKUP_DIR, `${checkName(name)}${SAVE_EXTENSION}.${index}`);
  }

  async #atomicWrite(path: string, bytes: Uint8Array): Promise<void> {
    const temp = `${path}.${randomBytes(6).toString('hex')}${TEMP_SUFFIX}`;
    await writeFile(temp, bytes);
    await rename(temp, path);
  }

  async #rotateBackups(name: string): Promise<void> {
    await mkdir(join(this.dir, BACKUP_DIR), { recursive: true });
    for (let i = NUM_SAVE_BACKUPS - 1; i >= 0; i--) {
      const from = i === 0 ? this.filePath(name) : this.backupPath(name, i);
      if (await exists(from)) await rename(from, this.backupPath(name, i + 1));
    }
  }

  async write(name: string, save: SaveWrite): Promise<void> {
    await mkdir(this.dir, { recursive: true });
    if (save.backups) await this.#rotateBackups(name);
    await this.#atomicWrite(this.filePath(name), save.bytes);
    if (save.log) await this.#atomicWrite(this.logPath(name), save.log);
    else await rm(this.logPath(name), { force: true });
  }

  async writeErrorLog(log: Uint8Array): Promise<string> {
    await mkdir(this.dir, { recursive: true });
    const path = this.logPath(ERROR_LOG_NAME);
    await this.#atomicWrite(path, log);
    return path;
  }

  async nextAutoName(): Promise<string> {
    const [first, second] = AUTO_SAVE_NAMES;
    if (this.#lastAuto !== null) return AUTO_SAVE_NAMES[1 - this.#lastAuto] ?? first;
    const t1 = await modifiedMs(this.filePath(first));
    const t2 = await modifiedMs(this.filePath(second));
    if (t1 !== null && t2 !== null) return t1 < t2 ? first : second;
    if (t1 !== null) return second;
    return first;
  }

  noteAutoWritten(name: string): void {
    const index = AUTO_SAVE_NAMES.indexOf(name as (typeof AUTO_SAVE_NAMES)[number]);
    if (index >= 0) this.#lastAuto = index;
  }

  async read(name: string): Promise<Uint8Array | null> {
    return readFile(this.filePath(name)).then(
      (b) => new Uint8Array(b),
      () => null,
    );
  }

  async readLog(name: string): Promise<Uint8Array | null> {
    return readFile(this.logPath(name)).then(
      (b) => new Uint8Array(b),
      () => null,
    );
  }

  async has(name: string): Promise<boolean> {
    return exists(this.filePath(name));
  }

  async readHead(name: string): Promise<SaveFileHead> {
    return readSaveHead(await readPrefix(this.filePath(name), HEAD_PREFIX_BYTES));
  }

  async delete(name: string): Promise<boolean> {
    const path = this.filePath(name);
    if (!(await exists(path))) return false;
    await rm(path);
    await rm(this.logPath(name), { force: true });
    return true;
  }

  async list(): Promise<StoredSave[]> {
    const names = await readdir(this.dir).catch(() => [] as string[]);
    const saves: StoredSave[] = [];
    for (const file of names) {
      if (!file.endsWith(SAVE_EXTENSION)) continue;
      const name = file.slice(0, -SAVE_EXTENSION.length);
      if (!isValidSaveName(name)) continue;
      const path = join(this.dir, file);
      const mtime = await modifiedMs(path);
      if (mtime === null) continue;
      try {
        saves.push({ name, modifiedMs: mtime, head: readSaveHead(await readPrefix(path, HEAD_PREFIX_BYTES)), problem: null });
      } catch (err) {
        saves.push({ name, modifiedMs: mtime, head: null, problem: (err as Error).message });
      }
    }
    return saves;
  }

  nativePath(name: string): string | null {
    if (!this.nativeDir || !NATIVE_NAME.test(name)) return null;
    return join(this.nativeDir, `${name}${NATIVE_EXTENSION}`);
  }

  async listNative(): Promise<NativeSave[]> {
    if (!this.nativeDir) return [];
    const files = await readdir(this.nativeDir).catch(() => [] as string[]);
    const saves: NativeSave[] = [];
    for (const file of files) {
      if (!file.toLowerCase().endsWith(NATIVE_EXTENSION)) continue;
      const name = file.slice(0, -NATIVE_EXTENSION.length);
      if (!NATIVE_NAME.test(name)) continue;
      const path = join(this.nativeDir, file);
      try {
        const mtime = await modifiedMs(path);
        if (mtime === null) continue;
        saves.push({ name, modifiedMs: mtime, header: parseSaveHeader(await readPrefix(path, NATIVE_HEADER_BYTES)).header });
      } catch {}
    }
    return saves;
  }
}

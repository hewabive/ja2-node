import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { CIV_QUOTE_TEXT_SIZE, DIALOGUE_SIZE } from '../content/formats/edt.ts';
import { civHintFile, civQuoteFile, DialogueTexts, dialogueFileCandidates } from '../content/narrative/dialogue-text.ts';
import { CIV_QUOTE_SECTORS, NUM_CIV_QUOTES } from '../content/narrative/npc-constants.ts';
import { isIdentityLayer, type RulePack, type RuleSource } from '../content/rules/pack.ts';
import type { ReadFile } from '../content/world/tileset-loader.ts';
import { REPO_ROOT } from '../node/repo.ts';
import type { WelcomeIdentity } from '../protocol/messages.ts';
import type { FileExists } from './world-cache.ts';

export type ContentSource = RuleSource;

export interface EngineIdentity {
  readonly version: string;
  readonly commit: string;
}

export interface LegacyLogic {
  readonly logic: string;
  readonly commit: string;
}

export interface LogicIdentity {
  readonly source: ContentSource;
  readonly hash: string;
  matches(logic: string): boolean;
  matchesLegacy(files: readonly ContentFileEntry[], saved: LegacyLogic): Promise<boolean>;
}

export type SavedRepositoryFile = (commit: string, layer: string, path: string) => Promise<Uint8Array | null>;

export interface LegacyScope {
  readonly layerOf: (path: string) => string | null;
  readonly savedRepositoryFile: SavedRepositoryFile;
}

export interface ContentIdentityHeader {
  readonly source: ContentSource;
  readonly dataVersion: string;
  readonly logic: string;
  readonly text: string;
}

export type ContentFileState = 'f' | 'm' | 'p';

export type ContentFileEntry = readonly [path: string, state: ContentFileState];

export const NO_TEXT_IDENTITY = 'none';

const TEXT_EXTENSION = '.edt';
const COMMIT_ENV = 'JA2_COMMIT';
const UNKNOWN_COMMIT = 'unknown';
const VCS_COMMAND = ['git', ['rev-parse', 'HEAD']] as const;

interface FileRecord {
  state: ContentFileState;
  digest: string | null;
}

function sha256(data: Uint8Array | string): string {
  return createHash('sha256').update(data).digest('hex');
}

function isText(path: string): boolean {
  return path.toLowerCase().endsWith(TEXT_EXTENSION);
}

function fileDigest(bytes: Uint8Array): string {
  return `${bytes.length}:${sha256(bytes)}`;
}

export class ContentLedger {
  readonly source: ContentSource;
  readonly read: ReadFile;
  readonly exists: FileExists;
  readonly #baseRead: ReadFile;
  readonly #baseExists: FileExists;
  readonly #scope: LegacyScope | null;
  readonly #files = new Map<string, FileRecord>();

  constructor(source: ContentSource, read: ReadFile, exists: FileExists, scope: LegacyScope | null = null) {
    this.source = source;
    this.#baseRead = read;
    this.#baseExists = exists;
    this.#scope = scope;
    this.read = async (path) => {
      const bytes = await read(path);
      this.#recordRead(path, bytes);
      return bytes;
    };
    this.exists = (path) => {
      const found = exists(path);
      this.#recordProbe(path, found);
      return found;
    };
  }

  #recordRead(path: string, bytes: Uint8Array | null): void {
    const known = this.#files.get(path);
    if (known?.state === 'f' || (known?.state === 'p' && isText(path))) return;
    if (!bytes) {
      if (!known) this.#files.set(path, { state: 'm', digest: null });
      return;
    }
    this.#files.set(path, isText(path) ? { state: 'p', digest: null } : { state: 'f', digest: fileDigest(bytes) });
  }

  #recordProbe(path: string, found: boolean): void {
    if (this.#files.has(path)) return;
    this.#files.set(path, { state: found ? 'p' : 'm', digest: null });
  }

  files(): ContentFileEntry[] {
    return [...this.#files.entries()].map(([path, r]) => [path, r.state] as const).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  }

  currentLogicHash(): string {
    const lines: string[] = [`source ${this.source}`];
    for (const [path, state] of this.files()) {
      const digest = this.#files.get(path)?.digest;
      lines.push(state === 'f' ? `f ${path} ${digest}` : `${state} ${path}`);
    }
    return sha256(lines.join('\n'));
  }

  async #line(path: string, state: ContentFileState): Promise<string> {
    if (state === 'f') {
      const known = this.#files.get(path);
      if (known?.state === 'f' && known.digest) return `f ${path} ${known.digest}`;
      const bytes = await this.#baseRead(path);
      if (!bytes) return `m ${path}`;
      const digest = fileDigest(bytes);
      this.#files.set(path, { state: 'f', digest });
      return `f ${path} ${digest}`;
    }
    return `${this.#baseExists(path) ? 'p' : 'm'} ${path}`;
  }

  async #savedRepositoryLine(scope: LegacyScope, path: string, state: ContentFileState, commit: string): Promise<string | null> {
    const layer = scope.layerOf(path);
    if (layer === null || isIdentityLayer(this.source, layer)) return null;
    if (state !== 'f') return `${state} ${path}`;
    const saved = await scope.savedRepositoryFile(commit, layer, path);
    return saved ? `f ${path} ${fileDigest(saved)}` : null;
  }

  async #identityScopedLine(path: string, state: ContentFileState, commit: string): Promise<string> {
    const saved = this.#scope ? await this.#savedRepositoryLine(this.#scope, path, state, commit) : null;
    return saved ?? this.#line(path, state);
  }

  async logicHash(files: readonly ContentFileEntry[] = this.files()): Promise<string> {
    const lines: string[] = [`source ${this.source}`];
    for (const [path, state] of files) lines.push(await this.#line(path, state));
    return sha256(lines.join('\n'));
  }

  async #identityScopedLogicHash(files: readonly ContentFileEntry[], commit: string): Promise<string> {
    const lines: string[] = [`source ${this.source}`];
    for (const [path, state] of files) lines.push(await this.#identityScopedLine(path, state, commit));
    return sha256(lines.join('\n'));
  }

  async matchesSaved(files: readonly ContentFileEntry[], saved: LegacyLogic): Promise<boolean> {
    if ((await this.logicHash(files)) === saved.logic) return true;
    return this.#scope !== null && (await this.#identityScopedLogicHash(files, saved.commit)) === saved.logic;
  }
}

export function logicIdentityOf(pack: RulePack, legacy: ContentLedger): LogicIdentity {
  const accepted = new Set([pack.hash, pack.allLayersHash]);
  return {
    source: pack.source,
    hash: pack.hash,
    matches: (logic) => accepted.has(logic),
    matchesLegacy: (files, saved) => legacy.matchesSaved(files, saved),
  };
}

export function welcomeIdentityOf(engine: EngineIdentity, pack: RulePack): WelcomeIdentity {
  return { engine, rules: { pack: pack.hash, scripts: pack.scriptsHash } };
}

const textHashes = new WeakMap<DialogueTexts, string>();

function textWidth(file: string, civFiles: ReadonlySet<string>): number {
  return civFiles.has(file) ? CIV_QUOTE_TEXT_SIZE : DIALOGUE_SIZE;
}

function civQuoteFiles(): Set<string> {
  const files = new Set<string>();
  for (let quote = 0; quote < NUM_CIV_QUOTES; quote++) files.add(civQuoteFile(quote));
  for (const [x, y] of CIV_QUOTE_SECTORS) files.add(civHintFile({ x, y, z: 0 }));
  return files;
}

export function quoteLengthIdentity(texts: DialogueTexts): string {
  const known = textHashes.get(texts);
  if (known) return known;
  const civFiles = civQuoteFiles();
  const lines: string[] = [];
  for (const file of [...dialogueFileCandidates()].sort()) {
    if (!texts.has(file)) continue;
    const width = textWidth(file, civFiles);
    const lengths: number[] = [];
    const rows = texts.rows(file, width);
    for (let row = 0; row < rows; row++) lengths.push(texts.chars({ file, row, width }));
    lines.push(`${file} ${width} ${lengths.join(',')}`);
  }
  const hash = sha256(lines.join('\n'));
  textHashes.set(texts, hash);
  return hash;
}

export function textIdentityOf(texts: unknown): string {
  return texts instanceof DialogueTexts ? quoteLengthIdentity(texts) : NO_TEXT_IDENTITY;
}

function sourceCommit(): string {
  try {
    const [command, args] = VCS_COMMAND;
    return execFileSync(command, args, { cwd: REPO_ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return UNKNOWN_COMMIT;
  }
}

export function packageVersion(): string {
  const pkg = JSON.parse(readFileSync(join(REPO_ROOT, 'package.json'), 'utf8')) as { version?: unknown };
  return typeof pkg.version === 'string' ? pkg.version : '0.0.0';
}

export function engineIdentity(env: NodeJS.ProcessEnv = process.env): EngineIdentity {
  return { version: packageVersion(), commit: env[COMMIT_ENV]?.trim() || sourceCommit() };
}

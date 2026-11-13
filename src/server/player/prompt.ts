import { readdirSync } from 'node:fs';
import type { PlatformPath } from 'node:path';
import { createInterface } from 'node:readline/promises';

const HOME_MARK = '~';
const HIDDEN_PREFIX = '.';

export interface AskOptions {
  readonly initial?: string;
  readonly paths?: boolean;
}

export interface Prompter {
  say(text: string): void;
  ask(question: string, options?: AskOptions): Promise<string>;
  close(): void;
}

export class PromptCancelled extends Error {
  constructor() {
    super('cancelled');
  }
}

export type ListDirs = (dir: string) => string[];

export function listDirs(dir: string): string[] {
  try {
    return readdirSync(dir, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => e.name);
  } catch {
    return [];
  }
}

export function expandHome(text: string, home: string, path: PlatformPath): string {
  if (text === HOME_MARK) return home;
  const rest = text.slice(HOME_MARK.length + 1);
  return text.startsWith(`${HOME_MARK}/`) || text.startsWith(`${HOME_MARK}${path.sep}`) ? path.join(home, rest) : text;
}

function lastSeparator(text: string, path: PlatformPath): number {
  return path.sep === '\\' ? Math.max(text.lastIndexOf('\\'), text.lastIndexOf('/')) : text.lastIndexOf('/');
}

export function completePath(line: string, home: string, path: PlatformPath, list: ListDirs): [string[], string] {
  const expanded = expandHome(line, home, path);
  const cut = lastSeparator(expanded, path);
  const dir = cut < 0 ? '.' : expanded.slice(0, cut + 1);
  const prefix = expanded.slice(cut + 1);
  const showHidden = prefix.startsWith(HIDDEN_PREFIX);
  const names = list(dir)
    .filter((name) => name.startsWith(prefix) && (showHidden || !name.startsWith(HIDDEN_PREFIX)))
    .sort();
  return [names.map((name) => `${line}${name.slice(prefix.length)}${path.sep}`), line];
}

export function readlinePrompter(input: NodeJS.ReadableStream, output: NodeJS.WritableStream, home: string, path: PlatformPath): Prompter {
  let completingPaths = false;
  const rl = createInterface({
    input,
    output,
    completer: (line: string): [string[], string] => (completingPaths ? completePath(line, home, path, listDirs) : [[], line]),
  });
  const cancel = new AbortController();
  rl.on('SIGINT', () => cancel.abort());
  rl.on('close', () => cancel.abort());
  return {
    say: (text) => {
      output.write(`${text}\n`);
    },
    ask: async (question, options = {}) => {
      completingPaths = options.paths === true;
      const suffix = options.initial ? ` [${options.initial}]` : '';
      try {
        const answer = (await rl.question(`${question}${suffix}: `, { signal: cancel.signal })).trim();
        return answer || options.initial || '';
      } catch {
        throw new PromptCancelled();
      } finally {
        completingPaths = false;
      }
    },
    close: () => rl.close(),
  };
}

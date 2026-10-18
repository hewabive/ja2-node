import { FormatError } from '../binary/errors.ts';
import { asObject, asString } from '../strategic/json-fields.ts';
import { normalizeVfsPath } from './path.ts';

export const VFS_ALIASES_FILE = 'aliases.json';
export const VFS_ALIASES_FORMAT = 'ja2-node vfs aliases v1';

export function parseVfsAliases(json: unknown): Map<string, string> {
  const o = asObject(json, 'vfs aliases');
  if (o.format !== VFS_ALIASES_FORMAT) throw new FormatError(`vfs aliases: format must be ${VFS_ALIASES_FORMAT}`);
  const aliases = new Map<string, string>();
  for (const [alias, target] of Object.entries(asObject(o.aliases, 'vfs aliases.aliases'))) {
    const from = normalizeVfsPath(alias);
    const to = normalizeVfsPath(asString(target, `vfs aliases.aliases[${alias}]`));
    if (from === to) throw new FormatError(`vfs alias ${alias} points at itself`);
    aliases.set(from, to);
  }
  for (const [alias, target] of aliases) {
    if (aliases.has(target)) throw new FormatError(`vfs alias ${alias} points at another alias ${target}`);
  }
  return aliases;
}

export function encodeVfsAliases(aliases: ReadonlyMap<string, string>): string {
  const sorted = [...aliases].map(([a, t]) => [normalizeVfsPath(a), normalizeVfsPath(t)] as const).sort(([a], [b]) => (a < b ? -1 : 1));
  const lines = sorted.map(([alias, target]) => `    ${JSON.stringify(alias)}: ${JSON.stringify(target)}`);
  return `{\n  "format": ${JSON.stringify(VFS_ALIASES_FORMAT)},\n  "aliases": {\n${lines.join(',\n')}\n  }\n}\n`;
}

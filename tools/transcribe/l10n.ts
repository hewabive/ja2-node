import { join } from 'node:path';
import { REPO_ROOT } from '../../src/node/repo.ts';
import { bracedBody, readSource, STRACCIATELLA_COMMIT, stripCComments, writeTable } from './c-source.ts';

const header = stripCComments(readSource('externalized/strings/Localization.h'));
const source = stripCComments(readSource('externalized/strings/Localization.cc'));

function arraySizes(): Map<string, number> {
  const sizes = new Map<string, number>();
  for (const m of header.matchAll(/constexpr\s+std::size_t\s+(\w+)_SIZE\s*=\s*(\d+)\s*;/g)) {
    const name = m[1] as string;
    const size = Number(m[2]);
    const known = sizes.get(name);
    if (known !== undefined && known !== size) throw new Error(`${name}_SIZE defined twice with different values`);
    sizes.set(name, size);
  }
  return sizes;
}

function structMembers(declaration: string): { name: string; array: boolean }[] {
  const members: { name: string; array: boolean }[] = [];
  for (const raw of bracedBody(header, declaration).split(';')) {
    const line = raw.trim();
    if (!line || line.includes('(SGPFile')) continue;
    const array = /^STRARRAY\((\w+)\)$/.exec(line);
    const single = /^ST::string\s+(\w+)$/.exec(line);
    if (array) members.push({ name: array[1] as string, array: true });
    else if (single) members.push({ name: single[1] as string, array: false });
    else throw new Error(`unexpected member in ${declaration}: ${line}`);
  }
  return members;
}

function readerCalls(declaration: string): { name: string; array: boolean }[] {
  return [...bracedBody(source, declaration).matchAll(/\bGet(Array|String)\((\w+)\)\s*;/g)].map((m) => ({
    name: m[2] as string,
    array: m[1] === 'Array',
  }));
}

function translationKeys(sizes: ReadonlyMap<string, number>): Record<string, number | null> {
  const members = structMembers('struct L10n_t');
  const reads = readerCalls('L10n_t::L10n_t(SGPFile * const translationFile)');
  const declared = new Map(members.map((m) => [m.name, m.array]));
  if (reads.length !== members.length) throw new Error(`L10n_t declares ${members.length} members, its constructor reads ${reads.length}`);
  const keys: Record<string, number | null> = {};
  for (const read of reads) {
    if (declared.get(read.name) !== read.array) throw new Error(`${read.name} is read differently from its declaration`);
    if (read.name in keys) throw new Error(`${read.name} is read twice`);
    const size = read.array ? sizes.get(read.name) : null;
    if (size === undefined) throw new Error(`no ${read.name}_SIZE`);
    keys[read.name] = size;
  }
  return keys;
}

const translation = translationKeys(arraySizes());
const out = {
  source: `JA2 Stracciatella ${STRACCIATELLA_COMMIT}: src/externalized/strings/Localization.h struct L10n_t and the *_SIZE constants, Localization.cc L10n_t::L10n_t`,
  license: 'Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA). See LICENSE.',
  format:
    'translation: the keys of strings/translation-<suffix>.json in the order L10n_t reads them; a number is the exact array length GetArray checks, null a single string read with GetString',
  translation,
};
const target = join(REPO_ROOT, 'data/tables/l10n.json');
writeTable(target, out);
const values = Object.values(translation);
const strings = values.reduce<number>((n, size) => n + (size ?? 1), 0);
console.log(`${values.length} translation keys, ${strings} strings → ${target}`);

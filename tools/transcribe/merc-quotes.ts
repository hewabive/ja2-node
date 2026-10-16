import { join } from 'node:path';
import { REPO_ROOT } from '../../src/node/repo.ts';
import { readSource, STRACCIATELLA_COMMIT, sequentialEnum, writeTable } from './c-source.ts';

const PREFIX = /^QUOTE_/;

function quoteKey(name: string): string {
  return name
    .replace(PREFIX, '')
    .toLowerCase()
    .replace(/_([a-z0-9])/g, (_, c: string) => c.toUpperCase());
}

const quotes = sequentialEnum(readSource('game/Tactical/Dialogue_Control.h'), 'DialogQuoteIDs');
const entries = [...quotes].map(([name, id]) => ({ id, name: name.replace(PREFIX, ''), key: quoteKey(name) }));
const firstNameOf = new Map<number, string>();
for (const e of entries) if (!firstNameOf.has(e.id)) firstNameOf.set(e.id, e.name);
const out = {
  source: `JA2 Stracciatella ${STRACCIATELLA_COMMIT}: src/game/Tactical/Dialogue_Control.h DialogQuoteIDs`,
  license: 'Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA). See LICENSE.',
  format:
    'merc quote numbers in enum order: name without the QUOTE_ prefix and the camelCase key used in events; an alias names the first entry with its number',
  quotes: entries.map((e) => {
    const first = firstNameOf.get(e.id);
    return first !== e.name ? { ...e, aliasOf: first } : e;
  }),
};
const target = join(REPO_ROOT, 'data/tables/merc-quotes.json');
writeTable(target, out);
console.log(`${entries.length} quotes → ${target}`);

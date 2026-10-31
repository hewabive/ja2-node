import { join } from 'node:path';
import { REPO_ROOT } from '../../src/node/repo.ts';
import { arrayItems, readSource, STRACCIATELLA_COMMIT, sequentialEnum, writeTable } from './c-source.ts';

const PREFIX = /^QUOTE_/;

function quoteKey(name: string): string {
  return name
    .replace(PREFIX, '')
    .toLowerCase()
    .replace(/_([a-z0-9])/g, (_, c: string) => c.toUpperCase());
}

const quotes = sequentialEnum(readSource('game/Tactical/Dialogue_Control.h'), 'DialogQuoteIDs');
const qArray = readSource('game/Tactical/QArray.cc');
const passingDislike = arrayItems(qArray, 'BOOLEAN QuoteExp_PassingDislike[75] =')
  .map(Number)
  .flatMap((kind, profile) => (kind ? [profile] : []));
const gotGunOrUsedGun = arrayItems(qArray, 'BOOLEAN QuoteExp_GotGunOrUsedGun[75] =').map(Number);
const genderCode = arrayItems(qArray, 'BOOLEAN QuoteExp_GenderCode[75] =').map(Number);
const entries = [...quotes].map(([name, id]) => ({ id, name: name.replace(PREFIX, ''), key: quoteKey(name) }));
const firstNameOf = new Map<number, string>();
for (const e of entries) if (!firstNameOf.has(e.id)) firstNameOf.set(e.id, e.name);
const out = {
  source: `JA2 Stracciatella ${STRACCIATELLA_COMMIT}: src/game/Tactical/Dialogue_Control.h DialogQuoteIDs, src/game/Tactical/QArray.cc QuoteExp_PassingDislike, QuoteExp_GotGunOrUsedGun, QuoteExp_GenderCode`,
  license: 'Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA). See LICENSE.',
  format:
    'merc quote numbers in enum order: name without the QUOTE_ prefix and the camelCase key used in events; an alias names the first entry with its number; passingDislike: the profile ids whose QuoteExp_PassingDislike entry is not 0, who say the passing dislike when its roll comes up as another merc talks to them; gotGunOrUsedGun: QuoteExp_GotGunOrUsedGun by profile id, the gun quote each profile has (61 found something special, 62 satisfaction with the gun after a kill, 0 none); genderCode: QuoteExp_GenderCode by profile id, the sex of the likable person quote 58 is about (0 male, 1 female, 2 either)',
  quotes: entries.map((e) => {
    const first = firstNameOf.get(e.id);
    return first !== e.name ? { ...e, aliasOf: first } : e;
  }),
  passingDislike,
  gotGunOrUsedGun,
  genderCode,
};
const target = join(REPO_ROOT, 'data/tables/merc-quotes.json');
writeTable(target, out);
console.log(
  `${entries.length} quotes, ${passingDislike.length} passing-dislike speakers, ${gotGunOrUsedGun.length} gun quote entries, ${genderCode.length} gender codes → ${target}`,
);

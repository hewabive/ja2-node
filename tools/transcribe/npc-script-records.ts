import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseJsonc } from '../../src/content/strategic/jsonc.ts';
import { REPO_ROOT } from '../../src/node/repo.ts';
import { STRACCIATELLA_COMMIT, writeTable } from './c-source.ts';

const SOURCE = 'assets/externalized/script-records-NPCs.json';
const records = parseJsonc(readFileSync(join(REPO_ROOT, 'reference/stracciatella', SOURCE), 'utf8'));

writeTable(join(REPO_ROOT, 'data/tables/npc-script-records.json'), {
  source: `JA2 Stracciatella ${STRACCIATELLA_COMMIT}: ${SOURCE} without its comments (the comments quote dialogue text)`,
  license: 'Derived from Jagged Alliance 2 (Strategy First SFI-SCLA) via JA2 Stracciatella. See LICENSE.',
  format: 'the NPC script record overrides as Stracciatella loads them; quote numbers refer to the dialogue files of the game data',
  records,
});

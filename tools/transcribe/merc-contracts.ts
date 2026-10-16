import { join } from 'node:path';
import { REPO_ROOT } from '../../src/node/repo.ts';
import { arrayItems, readSource, STRACCIATELLA_COMMIT, sequentialEnum, writeTable } from './c-source.ts';

const SPECIAL_NPCS = ['BIFF', 'LARRY_NORMAL', 'LARRY_DRUNK', 'DEVIN', 'SLAY', 'IGGY', 'CONRAD'];
const HISTORY_ENUM_MARKER = 'HISTORY_ENTERED_HISTORY_MODE';

function lookup(names: ReadonlyMap<string, number>, name: string): number {
  const value = names.get(name);
  if (value === undefined) throw new Error(`unknown name ${name}`);
  return value;
}

function historyCodes(src: string): Map<string, number> {
  const at = src.indexOf(HISTORY_ENUM_MARKER);
  const open = src.lastIndexOf('enum', at);
  if (at < 0 || open < 0) throw new Error('history enum not found');
  const anonymous = `${src.slice(0, open)}enum HistoryCodes${src.slice(open + 'enum'.length)}`;
  return sequentialEnum(anonymous, 'HistoryCodes');
}

const quotes = sequentialEnum(readSource('game/Tactical/Dialogue_Control.h'), 'DialogQuoteIDs');
const precedent = arrayItems(readSource('game/Tactical/Dialogue_Control.cc'), 'static UINT8 const gubMercValidPrecedentQuoteID[] =');
const profiles = sequentialEnum(readSource('game/Tactical/Soldier_Profile.h'), 'NPCIDs');
const history = historyCodes(readSource('game/Laptop/History.h'));

const out = {
  source: `JA2 Stracciatella ${STRACCIATELLA_COMMIT}: src/game/Tactical/Dialogue_Control.cc gubMercValidPrecedentQuoteID, src/game/Tactical/Soldier_Profile.h NPCIDs, src/game/Laptop/History.h`,
  license: 'Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA). See LICENSE.',
  format:
    'precedent quotes in bit order (quote numbers), the profile ids of the NPCs the contract code names, every history record code by name',
  precedentQuotes: precedent.map((name) => ({ name: name.replace(/^QUOTE_/, ''), quote: lookup(quotes, name) })),
  specialProfiles: Object.fromEntries(SPECIAL_NPCS.map((name) => [name, lookup(profiles, name)])),
  historyCodes: Object.fromEntries([...history].map(([name, code]) => [name.replace(/^HISTORY_/, ''), code])),
};
const target = join(REPO_ROOT, 'data/tables/merc-contracts.json');
writeTable(target, out);
console.log(`${precedent.length} precedent quotes, ${history.size} history codes → ${target}`);

import { join } from 'node:path';
import { REPO_ROOT } from '../../src/node/repo.ts';
import { bracedBody, readSource, STRACCIATELLA_COMMIT, stripCComments, writeTable } from './c-source.ts';

const dealerHeader = stripCComments(readSource('game/Tactical/Arms_Dealer.h'));
const initHeader = stripCComments(readSource('game/Tactical/Arms_Dealer_Init.h'));
const initSource = stripCComments(readSource('game/Tactical/Arms_Dealer_Init.cc'));
const invSource = stripCComments(readSource('game/Tactical/ArmsDealerInvInit.cc'));

function dealerIds(): Record<string, number> {
  const ids: Record<string, number> = {};
  const values = new Map<string, number>();
  let next = 0;
  for (const raw of bracedBody(dealerHeader, 'enum ArmsDealerID').split(',')) {
    const item = raw.trim();
    if (!item) continue;
    const [name, value] = item.split('=').map((s) => s.trim());
    if (!name) continue;
    if (value !== undefined) {
      const resolved = /^-?\d+$/.test(value) ? Number(value) : values.get(value);
      if (resolved === undefined) throw new Error(`unresolved dealer id ${item}`);
      next = resolved;
    }
    values.set(name, next++);
  }
  for (const [name, value] of values) {
    if (name === 'ARMS_DEALER_INVALID' || name === 'NUM_ARMS_DEALERS') continue;
    ids[name.replace(/^ARMS_DEALER_/, '')] = value;
  }
  return ids;
}

function categoryBits(): Record<string, number> {
  const bits: Record<string, number> = {};
  const defines = [...initHeader.matchAll(/#define\s+ARMS_DEALER_(\w+)\s+([^\n]+)/g)];
  for (const m of defines) {
    const name = m[1] as string;
    if (name.startsWith('FLAG__')) continue;
    const parts = (m[2] as string).split('|').map((s) => s.trim());
    let value = 0;
    for (const part of parts) {
      if (/^0x[0-9a-fA-F]+$/.test(part)) value |= Number(part);
      else {
        const ref = bits[part.replace(/^ARMS_DEALER_/, '')];
        if (ref === undefined) throw new Error(`unknown category ${part} in ${name}`);
        value |= ref;
      }
    }
    bits[name] = value >>> 0;
  }
  return bits;
}

function definition(source: string, declaration: string): string {
  let from = 0;
  for (;;) {
    const at = source.indexOf(declaration, from);
    if (at < 0) throw new Error(`definition not found: ${declaration}`);
    const rest = source.slice(at + declaration.length);
    if (/^\s*\{/.test(rest)) return bracedBody(source.slice(at), declaration);
    from = at + declaration.length;
  }
}

function switchCases(body: string, switchOn: string): Map<string, string[]> {
  const at = body.indexOf(`switch( ${switchOn} )`);
  const alt = at >= 0 ? at : body.indexOf(`switch (${switchOn})`);
  if (alt < 0) throw new Error(`switch on ${switchOn} not found`);
  const block = bracedBody(body.slice(alt), `switch`);
  const result = new Map<string, string[]>();
  let pending: string[] = [];
  for (const m of block.matchAll(/case\s+(\w+)\s*:|default\s*:|return\s*\(?\s*(\w+)\s*\)?\s*;/g)) {
    if (m[1]) pending.push(m[1]);
    else if (m[0].startsWith('default')) pending.push('default');
    else if (m[2]) {
      const target = m[2].replace(/^ARMS_DEALER_/, '');
      for (const name of pending) result.set(name, [...(result.get(name) ?? []), target]);
      pending = [];
    }
  }
  return result;
}

function categoryExceptions(classLabel: string): Record<string, string> {
  const fn = definition(initSource, 'static UINT32 GetArmsDealerItemTypeFromItemNumber(UINT16 usItem)');
  const at = fn.indexOf(`case ${classLabel}:`);
  if (at < 0) throw new Error(`${classLabel} not found`);
  const cases = switchCases(fn.slice(at), 'usItem');
  const out: Record<string, string> = {};
  for (const [item, targets] of cases) out[item] = targets[0] as string;
  return out;
}

function caseList(fnDeclaration: string, source: string, returnValue: string): string[] {
  const fn = definition(source, fnDeclaration);
  const items: string[] = [];
  let pending: string[] = [];
  for (const m of fn.matchAll(/case\s+(\w+)\s*:|return\s*\(?\s*(\w+)\s*\)?\s*;/g)) {
    if (m[1]) pending.push(m[1]);
    else {
      if (m[2] === returnValue) items.push(...pending);
      pending = [];
    }
  }
  if (items.length === 0) throw new Error(`no cases returning ${returnValue} in ${fnDeclaration}`);
  return items;
}

function sortCategories(): { itemClass: string; weaponClass: string; allowUsed: boolean }[] {
  const body = bracedBody(invSource, 'static ITEM_SORT_ENTRY const DealerItemSortInfo[] =');
  const rows = [...body.matchAll(/\{\s*(IC_\w+)\s*,\s*(\w+)\s*,\s*(TRUE|FALSE)\s*\}/g)].map((m) => ({
    itemClass: (m[1] as string).replace(/^IC_/, ''),
    weaponClass: m[2] as string,
    allowUsed: m[3] === 'TRUE',
  }));
  const end = rows.findIndex((r) => r.itemClass === 'NONE');
  if (end < 0) throw new Error('DealerItemSortInfo end marker not found');
  return rows.slice(0, end);
}

const ids = dealerIds();
const bits = categoryBits();
const out = {
  source: `JA2 Stracciatella ${STRACCIATELLA_COMMIT}: src/game/Tactical/Arms_Dealer.h ArmsDealerID; Arms_Dealer_Init.h dealer item categories; Arms_Dealer_Init.cc GetArmsDealerItemTypeFromItemNumber (IC_MISC and IC_FACE cases), ItemContainsLiquid; ArmsDealerInvInit.cc DealerItemSortInfo, GetCurrentSuitabilityForItem (staples)`,
  license: 'Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA). See LICENSE.',
  format:
    'dealer ids by role (BOBBYR = -1); dealer item category bits and masks; per item class the item names with their own category (default = everything else of that class); sort categories in order with item class, weapon class and whether sold used; staple items (always suitable); liquids (always sold full)',
  dealerIds: ids,
  categories: bits,
  categoryExceptions: { MISC: categoryExceptions('IC_MISC'), FACE: categoryExceptions('IC_FACE') },
  sortCategories: sortCategories(),
  staples: caseList(
    'static UINT8 GetCurrentSuitabilityForItem(ArmsDealerID const bArmsDealer, UINT16 const usItemIndex)',
    invSource,
    'ITEM_SUITABILITY_ALWAYS',
  ),
  liquids: caseList('static BOOLEAN ItemContainsLiquid(UINT16 usItemIndex)', initSource, 'TRUE'),
};
const target = join(REPO_ROOT, 'data/tables/merchant-tables.json');
writeTable(target, out);
console.log(
  `${Object.keys(ids).length} dealer ids, ${Object.keys(bits).length} categories, ${out.sortCategories.length} sort categories → ${target}`,
);

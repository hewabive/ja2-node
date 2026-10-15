// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-15. See LICENSE (SFI-SCLA).
// @src src/game/Tactical/Items.cc ValidAttachment, ValidLaunchable, CompatibleFaceItem, GetAttachmentInfo;
// @src src/externalized/ArmourModel.cc canBeAttached; WeaponModels.cc canBeAttached

import { ArmourClass, type ItemTable, NOTHING } from './items.ts';

export const ITEM_RULES_PATH = 'tables/item-tables.json';

export interface AttachmentInfo {
  readonly itemClass: string;
  readonly check: string;
  readonly mod: number;
}

export interface MergeRule {
  readonly result: number;
  readonly action: string;
}

export interface ComboMerge {
  readonly item: number;
  readonly attachments: readonly number[];
  readonly result: number;
}

export interface ItemRules {
  readonly attachmentInfo: ReadonlyMap<number, AttachmentInfo>;
  readonly attachmentHosts: ReadonlyMap<number, ReadonlySet<number>>;
  readonly compatibleFaceItems: readonly (readonly [number, number])[];
  readonly merges: ReadonlyMap<string, MergeRule>;
  readonly comboMerges: readonly ComboMerge[];
  readonly plateVests: ReadonlySet<number>;
}

interface RulesJson {
  attachmentInfo: { item: string; itemClass: string; check: string; mod: number }[];
  attachments: Record<string, string[]>;
  compatibleFaceItems: [string, string][];
  merges: { item1: string; item2: string; result: string; action: string }[];
  comboMerges: { item: string; attachments: string[]; result: string }[];
  platesCanBeAttached: string[];
}

export function parseItemRules(json: unknown, byName: ReadonlyMap<string, { readonly index: number }>): ItemRules {
  const j = json as RulesJson;
  const id = (name: string): number => {
    const def = byName.get(name);
    if (!def) throw new Error(`unknown item ${name} in item rules`);
    return def.index;
  };
  return {
    attachmentInfo: new Map(j.attachmentInfo.map((a) => [id(a.item), { itemClass: a.itemClass, check: a.check, mod: a.mod }])),
    attachmentHosts: new Map(Object.entries(j.attachments).map(([a, hosts]) => [id(a), new Set(hosts.map(id))])),
    compatibleFaceItems: j.compatibleFaceItems.map(([a, b]) => [id(a), id(b)] as const),
    merges: new Map(j.merges.map((m) => [`${id(m.item1)}:${id(m.item2)}`, { result: id(m.result), action: m.action }])),
    comboMerges: j.comboMerges.map((m) => ({ item: id(m.item), attachments: m.attachments.map(id), result: id(m.result) })),
    plateVests: new Set(j.platesCanBeAttached.map(id)),
  };
}

export function canBeAttached(table: ItemTable, attachment: number, host: number): boolean {
  const hostDef = table.byIndex.get(host);
  const attachmentDef = table.byIndex.get(attachment);
  if (!hostDef || !attachmentDef) return false;
  if (hostDef.weapon) return hostDef.weapon.attachments.includes(attachmentDef.name);
  if (hostDef.armour && attachmentDef.armour?.armourClass === ArmourClass.PLATE) return table.rules.plateVests.has(host);
  return false;
}

export function validAttachment(table: ItemTable, attachment: number, host: number): boolean {
  if (canBeAttached(table, attachment, host)) return true;
  return table.rules.attachmentHosts.get(attachment)?.has(host) ?? false;
}

export function validLaunchable(table: ItemTable, launchable: number, weapon: number): boolean {
  const calibre = table.byIndex.get(launchable)?.explosive?.calibre;
  if (!calibre) return false;
  return table.byIndex.get(weapon)?.weapon?.explosiveCalibre === calibre;
}

export function compatibleFaceItem(table: ItemTable, a: number, b: number): boolean {
  if (b === NOTHING) return true;
  return table.rules.compatibleFaceItems.some(([x, y]) => (x === a && y === b) || (x === b && y === a));
}

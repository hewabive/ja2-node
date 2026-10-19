// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-19. See LICENSE (SFI-SCLA).
// @src src/externalized/ItemModel.cc ItemStrings (itemdesc.edt: short name, name, description; braydesc.edt: Bobby Ray's
// @src name and description), WeaponModels.cc, ArmourModel.cc, ExplosiveModel.cc (Bobby Ray's texts from braydesc.edt),
// @src MagazineModel.cc (Bobby Ray's name is the short name), CalibreModel.cc (ammo-calibre, ammo-calibre-bobbyray).
// @src See docs/28 §12.1 G19.

import { createHash } from 'node:crypto';
import { ItemClass, type ItemDef, ItemFlags, type ItemTable } from '../content/items/items.ts';
import type { UiLanguage } from '../content/text/data-version.ts';
import { type UiStrings, uiString } from '../content/text/strings.ts';
import type { CatalogueCalibre, CatalogueItem, ItemCatalogue } from '../protocol/items.ts';
import type { TextService } from './text-service.ts';

const ITEM_TEXT_FILE = 'binarydata/itemdesc.edt';
const BOBBY_RAY_TEXT_FILE = 'binarydata/braydesc.edt';
const ETAG_HEX_DIGITS = 16;
const SHORT_NAME = 0;
const LONG_NAME = 1;
const DESCRIPTION = 2;
const BOBBY_RAY_NAME = 0;
const BOBBY_RAY_DESCRIPTION = 1;
const CLASS_NAMES = Object.entries(ItemClass) as [string, number][];
const FLAG_NAMES = Object.entries(ItemFlags) as [string, number][];

type Rows = (row: number) => readonly string[] | null;

export interface EncodedCatalogue {
  readonly catalogue: ItemCatalogue;
  readonly body: string;
  readonly etag: string;
}

function className(itemClass: number): string {
  return CLASS_NAMES.find(([, bit]) => bit === itemClass)?.[0] ?? 'NONE';
}

function flagNames(flags: number): string[] {
  return FLAG_NAMES.filter(([, bit]) => (flags & bit) !== 0).map(([name]) => name);
}

function calibre(strings: UiStrings, index: number): CatalogueCalibre {
  return { index, name: uiString(strings, 'ammo-calibre', index), bobbyRayName: uiString(strings, 'ammo-calibre-bobbyray', index) };
}

function usesBobbyRayFile(def: ItemDef): boolean {
  return def.weapon !== null || def.armour !== null || def.explosive !== null;
}

function bobbyRayTexts(def: ItemDef, item: readonly string[], bray: readonly string[]): { name: string; description: string } {
  if (usesBobbyRayFile(def)) return { name: bray[BOBBY_RAY_NAME] ?? '', description: bray[BOBBY_RAY_DESCRIPTION] ?? '' };
  if (def.magazine) return { name: item[SHORT_NAME] ?? '', description: item[DESCRIPTION] ?? '' };
  return { name: item[LONG_NAME] ?? '', description: item[DESCRIPTION] ?? '' };
}

function catalogueItem(def: ItemDef, strings: UiStrings, itemText: Rows | null, bobbyRayText: Rows | null): CatalogueItem {
  const item = itemText?.(def.index) ?? [];
  const bray = bobbyRayText?.(def.index) ?? [];
  const bobbyRay = bobbyRayTexts(def, item, bray);
  const w = def.weapon;
  return {
    index: def.index,
    name: def.name,
    shortName: item[SHORT_NAME] ?? '',
    longName: item[LONG_NAME] ?? '',
    description: item[DESCRIPTION] ?? '',
    bobbyRayName: bobbyRay.name,
    bobbyRayDescription: bobbyRay.description,
    class: className(def.itemClass),
    classIndex: def.classIndex,
    inventoryGraphics: def.inventoryGraphics,
    tileGraphic: def.tileGraphic,
    weight: def.weight,
    perPocket: def.perPocket,
    price: def.price,
    coolness: def.coolness,
    reliability: def.reliability,
    repairEase: def.repairEase,
    flags: flagNames(def.flags),
    weapon: w
      ? {
          type: w.type,
          weaponClass: w.weaponClass,
          calibre: w.calibre !== 0 ? calibre(strings, w.calibre) : null,
          explosiveCalibre: w.explosiveCalibre,
          readyTime: w.readyTime,
          shotsPer4Turns: w.shotsPer4Turns,
          shotsPerBurst: w.shotsPerBurst,
          burstPenalty: w.burstPenalty,
          impact: w.impact,
          deadliness: w.deadliness,
          magSize: w.magSize,
          range: w.range,
          attackVolume: w.attackVolume,
          hitVolume: w.hitVolume,
          attachments: w.attachments,
        }
      : null,
    magazine: def.magazine
      ? { calibre: calibre(strings, def.magazine.calibre), capacity: def.magazine.capacity, ammoType: def.magazine.ammoType }
      : null,
    armour: def.armour
      ? { armourClass: def.armour.armourClass, protection: def.armour.protection, explosivesProtection: def.armour.explosivesProtection }
      : null,
    explosive: def.explosive
      ? {
          damage: def.explosive.blast?.damage ?? null,
          radius: def.explosive.blast?.radius ?? def.explosive.stun?.radius ?? null,
          stunDamage: def.explosive.stun?.breathDamage ?? null,
          noise: def.explosive.noise,
          volatility: def.explosive.volatility,
        }
      : null,
  };
}

export async function buildItemCatalogue(items: ItemTable, texts: TextService, language: UiLanguage): Promise<EncodedCatalogue> {
  const [loaded, itemText, bobbyRayText] = await Promise.all([
    texts.strings(language),
    texts.edtTable(ITEM_TEXT_FILE),
    texts.edtTable(BOBBY_RAY_TEXT_FILE),
  ]);
  const catalogue: ItemCatalogue = {
    language,
    dataVersion: texts.dataVersion,
    items: items.ordered.map((def) => catalogueItem(def, loaded.strings, itemText, bobbyRayText)),
  };
  const body = JSON.stringify(catalogue);
  const digest = createHash('sha256').update(body).digest('hex').slice(0, ETAG_HEX_DIGITS);
  return { catalogue, body, etag: `"items-${language}-${digest}"` };
}

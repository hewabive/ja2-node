export const ITEM_CATALOGUE_ROUTE = '/api/items';

export interface CatalogueGraphic {
  readonly path: string;
  readonly subImageIndex: number;
}

export interface CatalogueCalibre {
  readonly index: number;
  readonly name: string | null;
  readonly bobbyRayName: string | null;
  readonly showInHelpText: boolean;
}

export interface CatalogueWeapon {
  readonly type: string;
  readonly weaponClass: number;
  readonly calibre: CatalogueCalibre | null;
  readonly explosiveCalibre: string | null;
  readonly readyTime: number;
  readonly shotsPer4Turns: number;
  readonly shotsPerBurst: number;
  readonly burstPenalty: number;
  readonly impact: number;
  readonly deadliness: number;
  readonly magSize: number;
  readonly range: number;
  readonly attackVolume: number;
  readonly hitVolume: number;
  readonly attachments: readonly string[];
  readonly rateOfFire: number;
}

export interface CatalogueMagazine {
  readonly calibre: CatalogueCalibre;
  readonly capacity: number;
  readonly ammoType: number;
}

export interface CatalogueArmour {
  readonly armourClass: number;
  readonly protection: number;
  readonly explosivesProtection: number;
}

export interface CatalogueExplosive {
  readonly damage: number | null;
  readonly radius: number | null;
  readonly stunDamage: number | null;
  readonly noise: number;
  readonly volatility: number;
}

export interface CatalogueItem {
  readonly index: number;
  readonly name: string;
  readonly shortName: string;
  readonly longName: string;
  readonly description: string;
  readonly bobbyRayName: string;
  readonly bobbyRayDescription: string;
  readonly class: string;
  readonly classIndex: number;
  readonly inventoryGraphics: { readonly small: CatalogueGraphic; readonly big: CatalogueGraphic };
  readonly tileGraphic: { readonly type: string; readonly subIndex: number };
  readonly weight: number;
  readonly perPocket: number;
  readonly price: number;
  readonly coolness: number;
  readonly reliability: number;
  readonly repairEase: number;
  readonly flags: readonly string[];
  readonly weapon: CatalogueWeapon | null;
  readonly magazine: CatalogueMagazine | null;
  readonly armour: CatalogueArmour | null;
  readonly explosive: CatalogueExplosive | null;
}

export interface ItemCatalogue {
  readonly language: string;
  readonly dataVersion: string;
  readonly items: readonly CatalogueItem[];
}

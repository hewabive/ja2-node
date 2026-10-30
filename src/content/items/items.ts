// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-15. See LICENSE (SFI-SCLA).
// @src src/game/Tactical/Item_Types.h, Weapons.h; src/externalized/{Item,Magazine,Armour,Explosive}Model.cc, WeaponModels.cc;
// @src ItemModel.cc (the default inventory and tile graphics), InventoryGraphicsModel.cc, TilesetTileIndexModel.cc

import { ITEM_RULES_PATH, type ItemRules, parseItemRules } from './rules.ts';

export const ITEM_TABLE_PATHS = {
  items: 'externalized/items.json',
  weapons: 'externalized/weapons.json',
  magazines: 'externalized/magazines.json',
  armours: 'externalized/armours.json',
  explosives: 'externalized/explosives.json',
  calibres: 'externalized/calibres.json',
  ammoTypes: 'externalized/ammo-types.json',
  rules: ITEM_RULES_PATH,
  gunChoiceNormal: 'externalized/army-gun-choice-normal.json',
  gunChoiceExtended: 'externalized/army-gun-choice-extended.json',
} as const;

export type ItemTableSources = { readonly [K in keyof typeof ITEM_TABLE_PATHS]: unknown };

export const ItemClass = {
  NONE: 0x1,
  GUN: 0x2,
  BLADE: 0x4,
  THROWING_KNIFE: 0x8,
  LAUNCHER: 0x10,
  TENTACLES: 0x20,
  THROWN: 0x40,
  PUNCH: 0x80,
  GRENADE: 0x100,
  BOMB: 0x200,
  AMMO: 0x400,
  ARMOUR: 0x800,
  MEDKIT: 0x1000,
  KIT: 0x2000,
  FACE: 0x8000,
  KEY: 0x10000,
  MISC: 0x10000000,
  MONEY: 0x20000000,
} as const;

export const WEAPON_CLASSES = ItemClass.GUN | ItemClass.BLADE | ItemClass.THROWING_KNIFE | ItemClass.LAUNCHER | ItemClass.TENTACLES;
export const EXPLOSIVE_CLASSES = ItemClass.GRENADE | ItemClass.BOMB;

export const ItemFlags = {
  DAMAGEABLE: 0x0001,
  REPAIRABLE: 0x0002,
  WATER_DAMAGES: 0x0004,
  METAL: 0x0008,
  SINKS: 0x0010,
  SHOW_STATUS: 0x0020,
  HIDDEN_ADDON: 0x0040,
  TWO_HANDED: 0x0080,
  NOT_BUYABLE: 0x0100,
  ATTACHMENT: 0x0200,
  BIGGUNLIST: 0x0400,
  NOT_EDITOR: 0x0800,
  DEFAULT_UNDROPPABLE: 0x1000,
  UNAERODYNAMIC: 0x2000,
  ELECTRONIC: 0x4000,
  INSEPARABLE: 0x8000,
} as const;

const FLAG_KEYS: readonly [string, number][] = [
  ['bDamageable', ItemFlags.DAMAGEABLE],
  ['bRepairable', ItemFlags.REPAIRABLE],
  ['bWaterDamages', ItemFlags.WATER_DAMAGES],
  ['bMetal', ItemFlags.METAL],
  ['bSinks', ItemFlags.SINKS],
  ['bShowStatus', ItemFlags.SHOW_STATUS],
  ['bHiddenAddon', ItemFlags.HIDDEN_ADDON],
  ['bTwoHanded', ItemFlags.TWO_HANDED],
  ['bNotBuyable', ItemFlags.NOT_BUYABLE],
  ['bAttachment', ItemFlags.ATTACHMENT],
  ['bBigGunList', ItemFlags.BIGGUNLIST],
  ['bNotEditor', ItemFlags.NOT_EDITOR],
  ['bDefaultUndroppable', ItemFlags.DEFAULT_UNDROPPABLE],
  ['bUnaerodynamic', ItemFlags.UNAERODYNAMIC],
  ['bElectronic', ItemFlags.ELECTRONIC],
  ['bInseparable', ItemFlags.INSEPARABLE],
];

export const ItemCursor = {
  INVALID: 0,
  QUEST: 1,
  PUNCH: 2,
  TARGET: 3,
  KNIFE: 4,
  AID: 5,
  TOSS: 6,
  MINE: 8,
  LPICK: 9,
  MDETECT: 10,
  CROWBAR: 11,
  SURVCAM: 12,
  CAMERA: 13,
  KEY: 14,
  SAW: 15,
  WIRECUT: 16,
  REMOTE: 17,
  BOMB: 18,
  REPAIR: 19,
  TRAJECTORY: 20,
  JAR: 21,
  TINCAN: 22,
  REFUEL: 23,
} as const;

export const WeaponClass = {
  NOGUN: 0,
  HANDGUN: 1,
  SMG: 2,
  RIFLE: 3,
  MG: 4,
  SHOTGUN: 5,
  KNIFE: 6,
  MONSTER: 7,
} as const;

export const ArmourClass = { HELMET: 0, VEST: 1, LEGGINGS: 2, PLATE: 3, MONST: 4 } as const;

export const AmmoType = {
  REGULAR: 0,
  HP: 1,
  AP: 2,
  SUPER_AP: 3,
  BUCKSHOT: 4,
  FLECHETTE: 5,
  GRENADE: 6,
  MONSTER: 7,
  KNIFE: 8,
  HE: 9,
  HEAT: 10,
  SLEEP_DART: 11,
  FLAME: 12,
} as const;

export const NOAMMO_CALIBRE = 0;
export const NOTHING = 0;

export interface WeaponDef {
  readonly type: string;
  readonly weaponClass: number;
  readonly calibre: number;
  readonly monsterCalibre: boolean;
  readonly explosiveCalibre: string | null;
  readonly readyTime: number;
  readonly shotsPer4Turns: number;
  readonly shotsPerBurst: number;
  readonly burstPenalty: number;
  readonly bulletSpeed: number;
  readonly impact: number;
  readonly deadliness: number;
  readonly magSize: number;
  readonly range: number;
  readonly attackVolume: number;
  readonly hitVolume: number;
  readonly rateOfFire: number;
  readonly smokeEffect: number;
  readonly attachments: readonly string[];
  readonly standardReplacement: string | null;
}

export interface MagazineDef {
  readonly calibre: number;
  readonly capacity: number;
  readonly ammoType: number;
  readonly defaultMagazine: boolean;
  readonly standardReplacement: string | null;
}

export interface ArmourDef {
  readonly armourClass: number;
  readonly protection: number;
  readonly explosivesProtection: number;
  readonly degradePercentage: number;
  readonly ignoreForMaxProtection: boolean;
}

export interface ExplosiveDef {
  readonly blast: { readonly damage: number; readonly radius: number; readonly structuralDamageDivisor: number } | null;
  readonly stun: { readonly breathDamage: number; readonly radius: number } | null;
  readonly smoke: { readonly type: string; readonly initialRadius: number; readonly maxRadius: number; readonly duration: number } | null;
  readonly light: { readonly radius: number; readonly duration: number } | null;
  readonly noise: number;
  readonly volatility: number;
  readonly pressureTriggered: boolean;
  readonly calibre: string | null;
  readonly animation: string | null;
}

export interface GraphicRef {
  readonly path: string;
  readonly subImageIndex: number;
}

export interface InventoryGraphics {
  readonly small: GraphicRef;
  readonly big: GraphicRef;
}

export interface TileGraphic {
  readonly type: string;
  readonly subIndex: number;
}

export interface ItemDef {
  readonly index: number;
  readonly name: string;
  readonly inventoryGraphics: InventoryGraphics;
  readonly tileGraphic: TileGraphic;
  readonly itemClass: number;
  readonly classIndex: number;
  readonly cursor: number;
  readonly weight: number;
  readonly perPocket: number;
  readonly price: number;
  readonly coolness: number;
  readonly reliability: number;
  readonly repairEase: number;
  readonly flags: number;
  readonly weapon: WeaponDef | null;
  readonly magazine: MagazineDef | null;
  readonly armour: ArmourDef | null;
  readonly explosive: ExplosiveDef | null;
}

export interface ItemTable {
  readonly byIndex: ReadonlyMap<number, ItemDef>;
  readonly byName: ReadonlyMap<string, ItemDef>;
  readonly ordered: readonly ItemDef[];
  readonly magazines: readonly ItemDef[];
  readonly rules: ItemRules;
  readonly gunChoice: { readonly normal: readonly (readonly number[])[]; readonly extended: readonly (readonly number[])[] };
  readonly helpTextCalibres: ReadonlySet<number>;
}

type Json = Record<string, unknown>;

const num = (o: Json, key: string, fallback = 0): number => (typeof o[key] === 'number' ? (o[key] as number) : fallback);
const str = (o: Json, key: string): string | null => (typeof o[key] === 'string' ? (o[key] as string) : null);
const bool = (o: Json, key: string): boolean => o[key] === true;
const sub = (o: Json, key: string): Json | null => (typeof o[key] === 'object' && o[key] !== null ? (o[key] as Json) : null);

function flagsOf(o: Json): number {
  let flags = 0;
  for (const [key, flag] of FLAG_KEYS) if (bool(o, key)) flags |= flag;
  return flags;
}

const DEFAULT_SMALL_GRAPHIC: GraphicRef = { path: 'interface/mdguns.sti', subImageIndex: 0 };
const DEFAULT_BIG_GRAPHIC: GraphicRef = { path: 'bigitems/gun00.sti', subImageIndex: 0 };
const DEFAULT_TILE_GRAPHIC: TileGraphic = { type: 'GUNS', subIndex: 1 };

function graphicRef(o: Json | null, fallback: GraphicRef): GraphicRef {
  if (!o) return fallback;
  return { path: (str(o, 'path') ?? fallback.path).toLowerCase(), subImageIndex: num(o, 'subImageIndex') };
}

function inventoryGraphics(o: Json): InventoryGraphics {
  const graphics = sub(o, 'inventoryGraphics');
  return {
    small: graphicRef(graphics ? sub(graphics, 'small') : null, DEFAULT_SMALL_GRAPHIC),
    big: graphicRef(graphics ? sub(graphics, 'big') : null, DEFAULT_BIG_GRAPHIC),
  };
}

function tileGraphic(o: Json): TileGraphic {
  const tile = sub(o, 'tileGraphic');
  return tile ? { type: str(tile, 'type') ?? DEFAULT_TILE_GRAPHIC.type, subIndex: num(tile, 'subIndex') } : DEFAULT_TILE_GRAPHIC;
}

function baseItem(o: Json, itemClass: number, cursor: number): Omit<ItemDef, 'weapon' | 'magazine' | 'armour' | 'explosive'> {
  return {
    index: num(o, 'itemIndex'),
    name: str(o, 'internalName') ?? '',
    inventoryGraphics: inventoryGraphics(o),
    tileGraphic: tileGraphic(o),
    itemClass,
    classIndex: num(o, 'ubClassIndex'),
    cursor,
    weight: num(o, 'ubWeight'),
    perPocket: num(o, 'ubPerPocket'),
    price: num(o, 'usPrice'),
    coolness: num(o, 'ubCoolness'),
    reliability: num(o, 'bReliability'),
    repairEase: num(o, 'bRepairEase'),
    flags: flagsOf(o),
  };
}

const EMPTY_KINDS = { weapon: null, magazine: null, armour: null, explosive: null } as const;

const WEAPON_KINDS: Readonly<Record<string, { itemClass: number; weaponClass: number; cursor: number }>> = {
  NOWEAPON: { itemClass: ItemClass.NONE, weaponClass: WeaponClass.NOGUN, cursor: ItemCursor.INVALID },
  PUNCH: { itemClass: ItemClass.PUNCH, weaponClass: WeaponClass.NOGUN, cursor: ItemCursor.PUNCH },
  THROWN: { itemClass: ItemClass.THROWN, weaponClass: WeaponClass.NOGUN, cursor: ItemCursor.TOSS },
  PISTOL: { itemClass: ItemClass.GUN, weaponClass: WeaponClass.HANDGUN, cursor: ItemCursor.TARGET },
  M_PISTOL: { itemClass: ItemClass.GUN, weaponClass: WeaponClass.HANDGUN, cursor: ItemCursor.TARGET },
  SMG: { itemClass: ItemClass.GUN, weaponClass: WeaponClass.SMG, cursor: ItemCursor.TARGET },
  SN_RIFLE: { itemClass: ItemClass.GUN, weaponClass: WeaponClass.RIFLE, cursor: ItemCursor.TARGET },
  RIFLE: { itemClass: ItemClass.GUN, weaponClass: WeaponClass.RIFLE, cursor: ItemCursor.TARGET },
  ASRIFLE: { itemClass: ItemClass.GUN, weaponClass: WeaponClass.RIFLE, cursor: ItemCursor.TARGET },
  SHOTGUN: { itemClass: ItemClass.GUN, weaponClass: WeaponClass.SHOTGUN, cursor: ItemCursor.TARGET },
  LMG: { itemClass: ItemClass.GUN, weaponClass: WeaponClass.MG, cursor: ItemCursor.TARGET },
  BLADE: { itemClass: ItemClass.BLADE, weaponClass: WeaponClass.KNIFE, cursor: ItemCursor.KNIFE },
  THROWINGBLADE: { itemClass: ItemClass.THROWING_KNIFE, weaponClass: WeaponClass.KNIFE, cursor: ItemCursor.TARGET },
  PUNCHWEAPON: { itemClass: ItemClass.PUNCH, weaponClass: WeaponClass.KNIFE, cursor: ItemCursor.PUNCH },
  LAUNCHER: { itemClass: ItemClass.LAUNCHER, weaponClass: WeaponClass.RIFLE, cursor: ItemCursor.TRAJECTORY },
  LAW: { itemClass: ItemClass.GUN, weaponClass: WeaponClass.RIFLE, cursor: ItemCursor.TARGET },
  CANNON: { itemClass: ItemClass.GUN, weaponClass: WeaponClass.RIFLE, cursor: ItemCursor.TARGET },
  MONSTSPIT: { itemClass: ItemClass.GUN, weaponClass: WeaponClass.MONSTER, cursor: ItemCursor.TARGET },
};

const LAUNCHER_CALIBRES: Readonly<Record<string, string>> = {
  GLAUNCHER: '40MM_GRENADE',
  UNDER_GLAUNCHER: '40MM_GRENADE',
  MORTAR: 'MORTAR_SHELL',
  TANK_CANNON: 'TANK_SHELL',
};

const MODEL_SET_FIELDS: Readonly<Record<string, Partial<Pick<WeaponDef, 'impact' | 'magSize' | 'bulletSpeed'>>>> = {
  LAUNCHER: { impact: 1 },
  LAW: { impact: 80, magSize: 1 },
  CANNON: { impact: 80, magSize: 1 },
  MONSTSPIT: { bulletSpeed: 250 },
};

const ATTACHMENT_KEYS: readonly [string, string][] = [
  ['attachment_Silencer', 'SILENCER'],
  ['attachment_SniperScope', 'SNIPERSCOPE'],
  ['attachment_LaserScope', 'LASERSCOPE'],
  ['attachment_Bipod', 'BIPOD'],
  ['attachment_Duckbill', 'DUCKBILL'],
  ['attachment_UnderGLauncher', 'UNDER_GLAUNCHER'],
  ['attachment_SpringAndBoltUpgrade', 'SPRING_AND_BOLT_UPGRADE'],
  ['attachment_GunBarrelExtender', 'GUN_BARREL_EXTENDER'],
];

const EXPLOSIVE_CURSORS: Readonly<Record<string, number>> = Object.fromEntries(
  Object.entries(ItemCursor).map(([name, value]) => [name, value]),
);

function weaponItem(o: Json, calibres: ReadonlyMap<string, number>, monsterCalibres: ReadonlySet<string>): ItemDef {
  const type = str(o, 'internalType') ?? 'NOWEAPON';
  const kind = WEAPON_KINDS[type];
  if (!kind) throw new Error(`unknown weapon type ${type}`);
  const name = str(o, 'internalName') ?? '';
  const calibreName = str(o, 'calibre');
  const isExplosiveLauncher = type === 'LAUNCHER' || type === 'CANNON';
  const calibre = !isExplosiveLauncher && calibreName ? calibres.get(calibreName) : undefined;
  if (calibreName && !isExplosiveLauncher && calibre === undefined) throw new Error(`unknown calibre ${calibreName}`);
  const weapon: WeaponDef = {
    type,
    weaponClass: kind.weaponClass,
    calibre: calibre ?? NOAMMO_CALIBRE,
    monsterCalibre: !isExplosiveLauncher && calibreName !== null && monsterCalibres.has(calibreName),
    explosiveCalibre: isExplosiveLauncher ? (calibreName ?? LAUNCHER_CALIBRES[name] ?? null) : null,
    readyTime: num(o, 'ubReadyTime'),
    shotsPer4Turns: num(o, 'ubShotsPer4Turns'),
    shotsPerBurst: num(o, 'ubShotsPerBurst'),
    burstPenalty: num(o, 'ubBurstPenalty'),
    bulletSpeed: num(o, 'ubBulletSpeed'),
    impact: num(o, 'ubImpact'),
    deadliness: num(o, 'ubDeadliness'),
    magSize: num(o, 'ubMagSize'),
    range: num(o, 'usRange'),
    attackVolume: num(o, 'ubAttackVolume'),
    hitVolume: num(o, 'ubHitVolume'),
    rateOfFire: num(o, 'rateOfFire'),
    smokeEffect: num(o, 'usSmokeEffect'),
    attachments: ATTACHMENT_KEYS.filter(([key]) => bool(o, key)).map(([, item]) => item),
    standardReplacement: str(o, 'standardReplacement'),
    ...MODEL_SET_FIELDS[type],
  };
  return { ...baseItem(o, kind.itemClass, kind.cursor), ...EMPTY_KINDS, weapon };
}

function magazineItem(o: Json, calibres: ReadonlyMap<string, number>, ammoTypes: ReadonlyMap<string, number>): ItemDef {
  const calibre = calibres.get(str(o, 'calibre') ?? '');
  const ammoType = ammoTypes.get(str(o, 'ammoType') ?? '');
  if (calibre === undefined || ammoType === undefined) throw new Error(`bad magazine ${str(o, 'internalName')}`);
  const magazine: MagazineDef = {
    calibre,
    capacity: num(o, 'capacity'),
    ammoType,
    defaultMagazine: !bool(o, 'dontUseAsDefaultMagazine'),
    standardReplacement: str(o, 'standardReplacement'),
  };
  return { ...baseItem(o, ItemClass.AMMO, ItemCursor.INVALID), ...EMPTY_KINDS, magazine };
}

function armourItem(o: Json): ItemDef {
  const armourClass = ArmourClass[(str(o, 'armourClass') === 'CREATURE' ? 'MONST' : str(o, 'armourClass')) as keyof typeof ArmourClass];
  if (armourClass === undefined) throw new Error(`bad armour ${str(o, 'internalName')}`);
  const protection = num(o, 'protection');
  const armour: ArmourDef = {
    armourClass,
    protection,
    explosivesProtection: num(o, 'explosivesProtection', protection),
    degradePercentage: num(o, 'degradePercentage'),
    ignoreForMaxProtection: bool(o, 'ignoreForMaxProtection'),
  };
  return { ...baseItem(o, ItemClass.ARMOUR, ItemCursor.INVALID), ...EMPTY_KINDS, armour };
}

function explosiveItem(o: Json): ItemDef {
  const itemClass = str(o, 'itemClass') === 'GRENADE' ? ItemClass.GRENADE : ItemClass.BOMB;
  const cursor = EXPLOSIVE_CURSORS[str(o, 'cursor') ?? 'INVALID'] ?? ItemCursor.INVALID;
  const blast = sub(o, 'blastEffect');
  const stun = sub(o, 'stunEffect');
  const smoke = sub(o, 'smokeEffect');
  const light = sub(o, 'lightEffect');
  const explosive: ExplosiveDef = {
    blast: blast
      ? { damage: num(blast, 'damage'), radius: num(blast, 'radius'), structuralDamageDivisor: num(blast, 'structuralDamageDivisor') }
      : null,
    stun: stun ? { breathDamage: num(stun, 'breathDamage'), radius: num(stun, 'radius') } : null,
    smoke: smoke
      ? {
          type: str(smoke, 'type') ?? '',
          initialRadius: num(smoke, 'initialRadius'),
          maxRadius: num(smoke, 'maxRadius'),
          duration: num(smoke, 'duration'),
        }
      : null,
    light: light ? { radius: num(light, 'radius'), duration: num(light, 'duration') } : null,
    noise: num(o, 'noise'),
    volatility: num(o, 'volatility'),
    pressureTriggered: bool(o, 'isPressureTriggered'),
    calibre: str(o, 'calibre'),
    animation: str(o, 'animation'),
  };
  return { ...baseItem(o, itemClass, cursor), ...EMPTY_KINDS, explosive };
}

function plainItem(o: Json): ItemDef {
  return { ...baseItem(o, num(o, 'usItemClass'), num(o, 'ubCursor')), ...EMPTY_KINDS };
}

function namedIndices(json: unknown): Map<string, number> {
  return new Map((json as Json[]).map((e) => [str(e, 'internalName') ?? '', num(e, 'index')]));
}

export function parseItemTable(sources: ItemTableSources): ItemTable {
  const calibres = namedIndices(sources.calibres);
  const monsterCalibres = new Set(
    (sources.calibres as Json[]).filter((c) => bool(c, 'monsterWeapon')).map((c) => str(c, 'internalName') ?? ''),
  );
  const ammoTypes = namedIndices(sources.ammoTypes);
  const nothing: ItemDef = {
    ...baseItem({ itemIndex: NOTHING, internalName: 'NOTHING' }, ItemClass.NONE, ItemCursor.INVALID),
    ...EMPTY_KINDS,
  };
  const all: ItemDef[] = [
    nothing,
    ...(sources.items as Json[]).map(plainItem).filter((i) => !(i.itemClass & (ItemClass.NONE | EXPLOSIVE_CLASSES | ItemClass.ARMOUR))),
    ...(sources.magazines as Json[]).filter((o) => str(o, 'calibre') !== 'NOAMMO').map((o) => magazineItem(o, calibres, ammoTypes)),
    ...(sources.weapons as Json[]).map((o) => weaponItem(o, calibres, monsterCalibres)).filter((w) => w.itemClass !== ItemClass.NONE),
    ...(sources.explosives as Json[]).map(explosiveItem),
    ...(sources.armours as Json[]).map(armourItem),
  ];
  const byIndex = new Map<number, ItemDef>();
  for (const item of all) {
    if (byIndex.has(item.index)) throw new Error(`duplicate item index ${item.index}`);
    byIndex.set(item.index, item);
  }
  const byName = new Map(all.map((item) => [item.name, item]));
  const gunLevels = (json: unknown) =>
    (json as string[][]).map((level) =>
      level.map((name) => {
        const def = byName.get(name);
        if (!def) throw new Error(`unknown gun ${name} in the army gun choice`);
        return def.index;
      }),
    );
  return {
    byIndex,
    byName,
    ordered: all,
    magazines: all.filter((item) => item.magazine),
    rules: parseItemRules(sources.rules, byName),
    gunChoice: { normal: gunLevels(sources.gunChoiceNormal), extended: gunLevels(sources.gunChoiceExtended) },
    helpTextCalibres: new Set((sources.calibres as Json[]).filter((c) => bool(c, 'showInHelpText')).map((c) => num(c, 'index'))),
  };
}

export async function loadItemTable(readJson: (path: string) => Promise<unknown>): Promise<ItemTable> {
  const keys = Object.keys(ITEM_TABLE_PATHS) as (keyof typeof ITEM_TABLE_PATHS)[];
  const values = await Promise.all(keys.map((key) => readJson(ITEM_TABLE_PATHS[key])));
  return parseItemTable(Object.fromEntries(keys.map((key, i) => [key, values[i]])) as ItemTableSources);
}

export function item(table: ItemTable, index: number): ItemDef | undefined {
  return table.byIndex.get(index);
}

export function itemIndex(table: ItemTable, name: string): number {
  const def = table.byName.get(name);
  if (!def) throw new Error(`unknown item ${name}`);
  return def.index;
}

export function isClass(table: ItemTable, index: number, mask: number): boolean {
  return ((table.byIndex.get(index)?.itemClass ?? 0) & mask) !== 0;
}

export function isTwoHanded(table: ItemTable, index: number): boolean {
  return ((table.byIndex.get(index)?.flags ?? 0) & ItemFlags.TWO_HANDED) !== 0;
}

export type HandClass = 'nothing' | 'pistol' | 'rifle';

export function handClass(table: ItemTable, index: number): HandClass {
  const def = table.byIndex.get(index);
  if (!def?.weapon || def.weapon.type === 'LAW') return 'nothing';
  if (!(def.itemClass & (ItemClass.GUN | ItemClass.LAUNCHER))) return 'nothing';
  return def.flags & ItemFlags.TWO_HANDED ? 'rifle' : 'pistol';
}

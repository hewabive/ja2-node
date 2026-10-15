export const WEAPONS_PATH = 'externalized/weapons.json';

const GUN_TYPES = new Set(['PISTOL', 'M_PISTOL', 'SMG', 'RIFLE', 'SN_RIFLE', 'ASRIFLE', 'LMG', 'SHOTGUN']);
const LAUNCHER_TYPES = new Set(['LAUNCHER', 'LAW', 'CANNON']);
const ROCKET_LAUNCHER_TYPE = 'LAW';

export type HandClass = 'nothing' | 'pistol' | 'rifle';

export interface WeaponInfo {
  readonly itemIndex: number;
  readonly internalName: string;
  readonly internalType: string;
  readonly twoHanded: boolean;
}

export interface WeaponTable {
  readonly byItem: ReadonlyMap<number, WeaponInfo>;
}

export function parseWeapons(json: unknown): WeaponTable {
  const list = json as { itemIndex: number; internalName: string; internalType: string; bTwoHanded?: boolean }[];
  return {
    byItem: new Map(
      list.map((w) => [
        w.itemIndex,
        { itemIndex: w.itemIndex, internalName: w.internalName, internalType: w.internalType, twoHanded: w.bTwoHanded === true },
      ]),
    ),
  };
}

export function handClass(weapons: WeaponTable, item: number): HandClass {
  const w = weapons.byItem.get(item);
  if (!w || w.internalType === ROCKET_LAUNCHER_TYPE) return 'nothing';
  if (!GUN_TYPES.has(w.internalType) && !LAUNCHER_TYPES.has(w.internalType)) return 'nothing';
  return w.twoHanded ? 'rifle' : 'pistol';
}

import { gridNo } from './grid.ts';

export const Npc = { TONY: 91, FRED: 106, KEITH: 147, SKYRIDER: 97, QUEEN: 75, DEREK: 136, OLIVER: 137 } as const;

export const MineOffice = { door: gridNo(74, 66), inside: gridNo(73, 66) } as const;
export const TownShop = { door: gridNo(75, 52), inside: gridNo(74, 52) } as const;
export const HELIPAD = gridNo(42, 54);
export const SKYRIDER_FARMS = ['B15', 'C16', 'D12', 'E14'] as const;

export const DRASSEN = { airport: 'B13', town: 'C13', mine: 'D13', sam: 'D15' } as const;

export const DRASSEN_SHOPPING = [
  { item: 'FIRSTAIDKIT', count: 5 },
  { item: 'FLAK_JACKET', count: 2 },
  { item: 'STEEL_HELMET', count: 3 },
] as const;

export const BOBBY_RAY = { destination: 2, speed: 0, deliveryGridNo: gridNo(32, 63) } as const;

export const BOBBY_RAY_ORDER = [
  { item: 'MEDICKIT', quantity: 2 },
  { item: 'FIRSTAIDKIT', quantity: 4 },
] as const;

export const Palace = {
  sector: 'P3',
  basement: 'P3-1',
  stairsDown: gridNo(66, 74),
  queenInBasement: gridNo(81, 57),
} as const;

export const MEDUNA_APPROACH = ['F11', 'J11', 'L8', 'L3'] as const;
export const MEDUNA_ASSAULT = ['M3', 'N3', 'O3'] as const;

import type { PlayerView, SoldierView, StrategicMercView } from '../../../protocol/view.ts';
import type { BarValues } from '../tactical/bars.ts';
import { Assignment } from './character-list.ts';

const OUR_TEAM = 0;
const REGULAR_MALE = 0;
const NO_FRAME = 0;
const EMPTY_PALETTES: readonly [string, string, string, string] = ['', '', '', ''];
const ROBOT_KIND = 'robot';

export function tacticalSoldierOf(view: PlayerView | null, id: number): SoldierView | null {
  return view?.soldiers.find((s) => s.id === id && s.team === OUR_TEAM) ?? null;
}

export function mercSoldier(view: PlayerView | null, m: StrategicMercView): SoldierView {
  const tactical = tacticalSoldierOf(view, m.id);
  const base: SoldierView = tactical ?? {
    id: m.id,
    team: OUR_TEAM,
    name: m.name,
    bodyType: REGULAR_MALE,
    gridNo: 0,
    x: 0,
    y: 0,
    level: 0,
    direction: 0,
    animation: 0,
    frame: NO_FRAME,
    palettes: EMPTY_PALETTES,
    hand: '',
    frameSlot: 0,
    stateTick: 0,
    frameDelay: 0,
  };
  return {
    ...base,
    name: m.name,
    life: m.life,
    lifeMax: m.lifeMax,
    breath: m.breath,
    breathMax: m.breathMax,
    asleep: m.asleep,
    squad: m.squad,
    ...(m.profile !== undefined ? { profile: m.profile } : {}),
    ...(m.kind !== undefined ? { kind: m.kind } : {}),
    ...(m.morale !== undefined ? { morale: m.morale } : {}),
    ...(m.bleeding !== undefined ? { bleeding: m.bleeding } : {}),
    ...(m.stats !== undefined ? { stats: m.stats } : {}),
    ...(m.inventory !== undefined ? { inventory: m.inventory } : {}),
    ...(m.weight !== undefined ? { weight: m.weight } : {}),
    ...(m.controlled !== undefined ? { controlled: m.controlled } : {}),
  };
}

export function isMechanical(m: StrategicMercView): boolean {
  return m.kind === ROBOT_KIND || m.kind === 'vehicle';
}

export function mercBars(m: StrategicMercView): BarValues {
  return {
    life: m.life,
    lifeMax: m.lifeMax,
    bleeding: m.bleeding ?? 0,
    breath: m.breath,
    breathMax: m.breathMax,
    morale: m.morale ?? 0,
    robot: m.kind === ROBOT_KIND,
    vehicle: m.kind === 'vehicle',
  };
}

export function inTransit(m: StrategicMercView): boolean {
  return m.assignment === Assignment.IN_TRANSIT;
}

export function isPow(m: StrategicMercView): boolean {
  return m.assignment === Assignment.ASSIGNMENT_POW;
}

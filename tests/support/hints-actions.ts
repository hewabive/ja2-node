import type { ItemTable } from '../../src/content/items/items.ts';
import { DIRECTION_INCREMENT, Direction, WORLD_COLS, WORLD_MAX } from '../../src/content/world/grid.ts';
import { StructureFlags } from '../../src/content/world/structures.ts';
import type { TacticalWorld } from '../../src/content/world/tactical-world.ts';
import type { CommandEnvelope } from '../../src/protocol/messages.ts';
import type { PlayerView, SoldierView } from '../../src/protocol/view.ts';
import { UNSUPPORTED_ACTIONS } from '../../src/sim/hints/preview-action.ts';
import { createItems, emptyObject } from '../../src/sim/items/object.ts';
import { InvSlot, NUM_INV_SLOTS } from '../../src/sim/tactical/inventory.ts';
import type { Soldier } from '../../src/sim/tactical/soldier.ts';

const SIDES = [Direction.NORTH, Direction.EAST, Direction.SOUTH, Direction.WEST] as const;
const LOOK_OFFSETS = [-3, 3, -3 * WORLD_COLS, 3 * WORLD_COLS, 2 * WORLD_COLS + 2] as const;

export function doorTiles(world: TacticalWorld): number[] {
  const doors: number[] = [];
  for (let g = 0; g < WORLD_MAX; g++) {
    const door = world.structures.find(g, StructureFlags.ANYDOOR);
    if (door && door.gridNo === g) doors.push(g);
  }
  return doors;
}

function distance(a: number, b: number): number {
  return Math.hypot((a % WORLD_COLS) - (b % WORLD_COLS), Math.trunc(a / WORLD_COLS) - Math.trunc(b / WORLD_COLS));
}

function own(view: PlayerView): readonly SoldierView[] {
  return view.soldiers.filter((s) => s.team === 0);
}

export interface ActionSampleOptions {
  readonly doors?: readonly number[];
  readonly nearestDoors?: number;
}

export function sampleActionHints(view: PlayerView, options: ActionSampleOptions = {}): CommandEnvelope[] {
  const requests: CommandEnvelope[] = [];
  const others = view.soldiers;
  for (const s of own(view)) {
    requests.push({ type: 'movementOptions', soldier: s.id });
    const base = { type: 'previewAction', soldier: s.id };
    for (const off of LOOK_OFFSETS) requests.push({ ...base, kind: 'look', gridNo: s.gridNo + off });
    for (const dir of SIDES) requests.push({ ...base, kind: 'jump', gridNo: s.gridNo + 2 * (DIRECTION_INCREMENT[dir] ?? 0) });
    for (const o of others) {
      if (o.id === s.id) continue;
      for (const kind of ['talk', 'give', 'swap', 'aid'] as const)
        requests.push({ ...base, kind, gridNo: o.gridNo, level: o.level, target: o.id });
      requests.push({ ...base, kind: 'aid', gridNo: o.gridNo, level: o.level });
    }
    requests.push({ ...base, kind: 'aid', gridNo: s.gridNo });
    for (const item of view.items ?? []) {
      requests.push({ ...base, kind: 'pickUp', gridNo: item.gridNo, level: item.level });
      requests.push({ ...base, kind: 'pickUp', gridNo: item.gridNo, mode: 'run' });
    }
    const doors = [...(options.doors ?? [])]
      .sort((a, b) => distance(a, s.gridNo) - distance(b, s.gridNo))
      .slice(0, options.nearestDoors ?? 6);
    for (const g of doors) {
      requests.push({ ...base, kind: 'door', gridNo: g });
      requests.push({ ...base, kind: 'door', gridNo: g, mode: 'swat' });
    }
  }
  const first = own(view)[0];
  if (first)
    for (const kind of UNSUPPORTED_ACTIONS) requests.push({ type: 'previewAction', soldier: first.id, kind, gridNo: first.gridNo + 1 });
  return requests;
}

export function sampleInventoryHints(view: PlayerView, itemIndices: readonly number[] = []): CommandEnvelope[] {
  const requests: CommandEnvelope[] = [];
  for (const s of own(view)) {
    for (const item of s.inventory ?? []) {
      requests.push({ type: 'placements', soldier: s.id, slot: item.slot });
      requests.push({ type: 'placements', soldier: s.id, slot: item.slot, count: 1 });
      requests.push({ type: 'itemInfo', soldier: s.id, slot: item.slot });
      requests.push({ type: 'itemInfo', soldier: s.id, slot: item.slot, metric: true });
    }
    requests.push({ type: 'placements', soldier: s.id, slot: NUM_INV_SLOTS - 1 });
  }
  for (const item of itemIndices) requests.push({ type: 'itemInfo', item, metric: item % 2 === 0 });
  return requests;
}

type KitEntry = readonly [slot: number, item: string, count?: number];

const HINT_KITS: readonly (readonly KitEntry[])[] = [
  [
    [InvSlot.HAND, 'GLOCK_17'],
    [InvSlot.VEST, 'KEVLAR_VEST'],
    [InvSlot.SMALLPOCK1, 'CLIP9_15', 2],
    [InvSlot.SMALLPOCK2, 'CLIP9_15'],
    [InvSlot.SMALLPOCK3, 'SILENCER'],
    [InvSlot.SMALLPOCK4, 'CAMOUFLAGEKIT'],
    [InvSlot.BIGPOCK1, 'M14'],
    [InvSlot.BIGPOCK2, 'HAND_GRENADE', 2],
  ],
  [
    [InvSlot.HAND, 'FIRSTAIDKIT'],
    [InvSlot.BIGPOCK1, 'GLAUNCHER'],
    [InvSlot.BIGPOCK2, 'MEDICKIT'],
    [InvSlot.SMALLPOCK1, 'GL_HE_GRENADE'],
    [InvSlot.SMALLPOCK2, 'SNIPERSCOPE'],
    [InvSlot.SMALLPOCK3, 'TOOLKIT'],
  ],
];

const KIT_STATUS = 90;
const WOUND = 10;
const BLEEDING = 4;

export function kitForHints(soldiers: readonly Soldier[], items: ItemTable): void {
  soldiers.forEach((s, k) => {
    const kit = HINT_KITS[k];
    if (!kit) return;
    for (let slot = 0; slot < s.inv.length; slot++) s.inv[slot] = emptyObject();
    for (const [slot, name, count] of kit) {
      const def = items.byName.get(name);
      if (def) s.inv[slot] = createItems(items, def.index, KIT_STATUS, count ?? 1);
    }
  });
  const wounded = soldiers[0];
  if (wounded) {
    wounded.life = Math.max(1, wounded.lifeMax - WOUND);
    wounded.bleeding = BLEEDING;
  }
}

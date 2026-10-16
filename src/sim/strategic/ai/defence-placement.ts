// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-16. See LICENSE (SFI-SCLA).
// @src src/game/Tactical/Soldier_Init_List.cc SortSoldierInitList, AddSoldierInitListEnemyDefenceSoldiers. See docs/17 §10.2.

import { u8 } from '../../../core/int.ts';
import { SoldierClass, Team } from '../../tactical/soldier.ts';
import type { RollSource } from '../forces/ports.ts';

export interface PlacementNode {
  readonly index: number;
  readonly team: number;
  soldierClass: number;
  readonly priorityExistence: boolean;
  readonly detailed: boolean;
  hasSoldier: boolean;
}

export interface DefenceTotals {
  admins: number;
  troops: number;
  elites: number;
}

export type AddPlacement = (node: PlacementNode) => boolean;

type Matcher = (n: PlacementNode) => boolean;

function moveMatchingToFront(list: readonly PlacementNode[], match: Matcher): PlacementNode[] {
  const moved = list.filter(match).reverse();
  return [...moved, ...list.filter((n) => !match(n))];
}

export function sortSoldierInitList(nodes: readonly PlacementNode[]): PlacementNode[] {
  if (nodes.length === 0) return [];
  const tail = nodes[nodes.length - 1];
  const withSoldier = (n: PlacementNode) => n.hasSoldier && n !== tail;
  let list = [...nodes.filter((n) => !withSoldier(n)), ...nodes.filter(withSoldier).reverse()];
  list = moveMatchingToFront(list, (n) => !n.hasSoldier && !n.priorityExistence && n.detailed);
  list = moveMatchingToFront(list, (n) => !n.hasSoldier && n.priorityExistence && !n.detailed);
  list = moveMatchingToFront(list, (n) => !n.hasSoldier && n.priorityExistence && n.detailed);
  return list;
}

const ENEMY_CLASSES = [SoldierClass.ADMINISTRATOR, SoldierClass.ELITE, SoldierClass.ARMY] as const;
type EnemyClass = (typeof ENEMY_CLASSES)[number];

const Block = { PD: 0, P: 1, D: 2, B: 3 } as const;
type Block = (typeof Block)[keyof typeof Block];

function blockOf(n: PlacementNode): Block {
  if (n.priorityExistence && n.detailed) return Block.PD;
  if (n.priorityExistence) return Block.P;
  if (n.detailed) return Block.D;
  return Block.B;
}

class Filler {
  readonly #rolls: RollSource;
  readonly #add: AddPlacement;
  readonly #totals: Record<EnemyClass, number>;
  readonly #slots: Record<EnemyClass, number[]>;
  maxNum: number;

  constructor(list: readonly PlacementNode[], totals: DefenceTotals, rolls: RollSource, add: AddPlacement) {
    this.#rolls = rolls;
    this.#add = add;
    this.#totals = {
      [SoldierClass.ADMINISTRATOR]: u8(totals.admins),
      [SoldierClass.ELITE]: u8(totals.elites),
      [SoldierClass.ARMY]: u8(totals.troops),
    };
    this.maxNum = u8(totals.admins + totals.troops + totals.elites);
    this.#slots = { [SoldierClass.ADMINISTRATOR]: [0, 0, 0, 0], [SoldierClass.ELITE]: [0, 0, 0, 0], [SoldierClass.ARMY]: [0, 0, 0, 0] };
    for (const n of list) {
      if (n.hasSoldier) break;
      if (n.team !== Team.ENEMY || !isEnemyClass(n.soldierClass)) continue;
      const slots = this.#slots[n.soldierClass];
      const b = blockOf(n);
      slots[b] = u8((slots[b] ?? 0) + 1);
    }
  }

  canContinue(cls: EnemyClass, block: Block): boolean {
    return this.maxNum !== 0 && this.#totals[cls] !== 0 && (this.#slots[cls][block] ?? 0) !== 0;
  }

  offer(n: PlacementNode, cls: EnemyClass, block: Block): boolean {
    if (n.hasSoldier || n.team !== Team.ENEMY || n.soldierClass !== cls) return true;
    const slots = this.#slots[cls];
    const free = slots[block] ?? 0;
    const total = this.#totals[cls];
    if (free <= total || this.#rolls.int(free) < total) {
      if (!this.place(n)) return false;
      this.#totals[cls] = u8(total - 1);
      this.maxNum = u8(this.maxNum - 1);
    }
    slots[block] = u8(free - 1);
    return true;
  }

  place(n: PlacementNode): boolean {
    if (!this.#add(n)) return false;
    n.hasSoldier = true;
    return true;
  }

  chooseClass(n: PlacementNode): boolean {
    const roll = this.#rolls.int(this.maxNum);
    const t = this.#totals;
    const elites = t[SoldierClass.ELITE];
    const troops = t[SoldierClass.ARMY];
    if (roll < elites) {
      n.soldierClass = SoldierClass.ELITE;
      t[SoldierClass.ELITE] = u8(elites - 1);
    } else if (roll < elites + troops) {
      n.soldierClass = SoldierClass.ARMY;
      t[SoldierClass.ARMY] = u8(troops - 1);
    } else if (roll < elites + troops + t[SoldierClass.ADMINISTRATOR]) {
      n.soldierClass = SoldierClass.ADMINISTRATOR;
      t[SoldierClass.ADMINISTRATOR] = u8(t[SoldierClass.ADMINISTRATOR] - 1);
    }
    if (!this.place(n)) return false;
    this.maxNum = u8(this.maxNum - 1);
    return true;
  }
}

function isEnemyClass(c: number): c is EnemyClass {
  return c === SoldierClass.ADMINISTRATOR || c === SoldierClass.ELITE || c === SoldierClass.ARMY;
}

const PD_PASS_STRIDE = 2;

function priorityDetailedPass(list: readonly PlacementNode[], f: Filler): boolean {
  for (const cls of ENEMY_CLASSES) {
    for (let i = 0; i < list.length; i += PD_PASS_STRIDE) {
      const n = list[i];
      if (!n || !f.canContinue(cls, Block.PD) || !n.detailed || !n.priorityExistence) break;
      if (!f.offer(n, cls, Block.PD)) return false;
    }
  }
  return true;
}

function blockPass(list: readonly PlacementNode[], start: number, inBlock: Matcher, block: Block, f: Filler): boolean {
  for (const cls of ENEMY_CLASSES) {
    for (let i = start; i < list.length; i++) {
      const n = list[i];
      if (!n || !f.canContinue(cls, block) || !inBlock(n)) break;
      if (!f.offer(n, cls, block)) return false;
    }
  }
  return true;
}

function skipWhile(list: readonly PlacementNode[], start: number, inBlock: Matcher): number {
  let i = start;
  while (i < list.length && inBlock(list[i] as PlacementNode)) i++;
  return i;
}

const isPD: Matcher = (n) => n.detailed && n.priorityExistence;
const isP: Matcher = (n) => !n.detailed && n.priorityExistence;
const isD: Matcher = (n) => n.detailed && !n.priorityExistence;
const anyNode: Matcher = () => true;

function fillPrioritySlots(list: readonly PlacementNode[], f: Filler): boolean {
  for (const n of list) {
    if (f.maxNum === 0 || !n.priorityExistence) break;
    if (n.hasSoldier || n.team !== Team.ENEMY) continue;
    if (!f.chooseClass(n)) return false;
  }
  return true;
}

function fillLeftovers(list: readonly PlacementNode[], f: Filler, rolls: RollSource): void {
  let free = 0;
  for (const n of list) if (!n.hasSoldier && n.team === Team.ENEMY) free = u8(free + 1);
  for (const n of list) {
    if (free === 0 || f.maxNum === 0) break;
    if (n.hasSoldier || n.team !== Team.ENEMY) continue;
    if (free <= f.maxNum || rolls.int(free) < f.maxNum) {
      if (!f.chooseClass(n)) return;
    }
    free = u8(free - 1);
  }
}

export function addSoldierInitListEnemyDefenceSoldiers(
  sorted: readonly PlacementNode[],
  totals: DefenceTotals,
  rolls: RollSource,
  add: AddPlacement,
): void {
  const f = new Filler(sorted, totals, rolls, add);
  if (!priorityDetailedPass(sorted, f) || f.maxNum === 0) return;
  let mark = skipWhile(sorted, 0, isPD);
  if (!blockPass(sorted, mark, isP, Block.P, f) || f.maxNum === 0) return;
  mark = skipWhile(sorted, mark, isP);
  if (!blockPass(sorted, mark, isD, Block.D, f) || f.maxNum === 0) return;
  mark = skipWhile(sorted, mark, isD);
  if (!fillPrioritySlots(sorted, f) || f.maxNum === 0) return;
  if (!blockPass(sorted, mark, anyNode, Block.B, f) || f.maxNum === 0) return;
  fillLeftovers(sorted, f, rolls);
}

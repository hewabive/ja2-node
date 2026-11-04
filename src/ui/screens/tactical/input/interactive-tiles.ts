// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-11-04. See LICENSE (SFI-SCLA).
// @src src/game/TileEngine/Interactive_Tiles.cc ShouldCheckForMouseDetections (a check only when the pointer or the
// @src render centre moved), BeginCurInteractiveTileCheck, LogMouseOverInteractiveTile (the stack in sweep order and the
// @src node whose rectangle reaches lowest, the first of a tie, none reaching no lower than the screen top),
// @src EndCurInteractiveTileCheck (the found or cycled node every frame, its stack slot never cleared),
// @src CycleIntTileFindStack; src/game/TileEngine/RenderWorld.cc RenderTiles (TILES_DYNAMIC_CHECKFOR_INT_TILE).

import type { InteractiveNode, InteractiveNodeRef, RenderCentre } from '../environment.ts';

export interface CheckPoint extends RenderCentre {
  readonly x: number;
  readonly y: number;
}

const SCREEN_TOP = 0;

function sameCheckPoint(a: CheckPoint | null, b: CheckPoint): boolean {
  return a !== null && a.x === b.x && a.y === b.y && a.centerX === b.centerX && a.centerY === b.centerY;
}

export class InteractiveTileCheck {
  readonly #stack: InteractiveNodeRef[] = [];
  #stackCount = 0;
  #stackCurrent = 0;
  #cycling = false;
  #found = false;
  #lowest = SCREEN_TOP;
  #best: InteractiveNodeRef | null = null;
  #over: InteractiveNodeRef | null = null;
  #checkedAt: CheckPoint | null = null;

  get over(): InteractiveNodeRef | null {
    return this.#over;
  }

  begin(): void {
    this.#over = null;
    this.#cycling = false;
    this.#lowest = SCREEN_TOP;
    this.#found = false;
    this.#stackCount = 0;
  }

  frame(at: CheckPoint | null, nodesUnder: () => readonly InteractiveNode[]): void {
    if (at && this.#moved(at)) {
      this.begin();
      for (const node of nodesUnder()) this.#log(node);
    }
    this.#end();
  }

  cycle(): void {
    this.#cycling = true;
    this.#stackCurrent++;
    if (this.#stackCurrent === this.#stackCount) this.#stackCurrent = 0;
  }

  #moved(at: CheckPoint): boolean {
    const moved = !sameCheckPoint(this.#checkedAt, at);
    this.#checkedAt = at;
    return moved;
  }

  #log(node: InteractiveNode): void {
    this.#found = true;
    const ref: InteractiveNodeRef = { gridNo: node.gridNo, index: node.index, tile: node.tile };
    this.#stack[this.#stackCount++] = ref;
    if (node.bottom <= this.#lowest) return;
    this.#lowest = node.bottom;
    this.#best = ref;
    this.#stackCurrent = this.#stackCount - 1;
  }

  #end(): void {
    if (!this.#found) {
      this.#cycling = false;
      return;
    }
    this.#over = (this.#cycling ? this.#stack[this.#stackCurrent] : this.#best) ?? null;
  }
}

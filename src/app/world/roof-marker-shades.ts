// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-11-09. See LICENSE (SFI-SCLA).
// @src src/game/Tactical/Soldier_Control.cc HandlePlacingRoofMarker (a new roof node whose natural and current shade are
// @src DEFAULT_SHADE_LEVEL, its sums 0); src/game/TileEngine/Lighting.cc LightAddTile and LightSubtractTile (a roof light
// @src drawn or erased while the node exists: LightAddTileNode, LightSubtractTileNode), LightSetBaseLevel
// @src (LightSetNaturalTile gives every node the natural level, LightSpriteRenderAll draws every light again over it);
// @src src/game/Tactical/Overhead.cc ExecuteOverhead (a stop places the marker before DeleteSoldierLight and
// @src PositionSoldierLight draw the merc's light again, unless TOPTION_MERC_ALWAYS_LIGHT_UP).

import { clamp, u8 } from '../../core/int.ts';
import type { RoofMarkerChange } from './roof-markers.ts';
import type { RoofLight } from './world-lighting.ts';

const DEFAULT_SHADE_LEVEL = 4;
const SHADE_MAX = 1;
const SHADE_MIN = 15;
const OUR_TEAM = 0;

interface MarkerNode {
  asTheRoof: boolean;
  sum: number;
  strongest: number;
}

export class RoofMarkerShades {
  readonly #nodes = new Map<number, MarkerNode>();
  #drawn: ReadonlyMap<number, RoofLight> = new Map();

  baseLevelSet(): void {
    for (const node of this.#nodes.values()) node.asTheRoof = true;
  }

  update(lights: ReadonlyMap<number, RoofLight>, changes: readonly RoofMarkerChange[], lightRedrawnAtStop: boolean): void {
    for (const [soldier, drawn] of this.#drawn) if (lights.get(soldier)?.key !== drawn.key) this.#erase(drawn);
    for (const [soldier, light] of lights) if (this.#drawn.get(soldier)?.key !== light.key) this.#draw(light);
    this.#drawn = lights;
    for (const change of changes) this.#apply(change, lightRedrawnAtStop);
  }

  shade(gridNo: number, roofShade: number): number {
    const node = this.#nodes.get(gridNo);
    if (!node || node.asTheRoof) return roofShade;
    return clamp(DEFAULT_SHADE_LEVEL - node.strongest, SHADE_MAX, SHADE_MIN);
  }

  reset(): void {
    this.#nodes.clear();
    this.#drawn = new Map();
  }

  #apply(change: RoofMarkerChange, lightRedrawnAtStop: boolean): void {
    if (change.kind === 'placed') this.#nodes.set(change.gridNo, { asTheRoof: false, sum: 0, strongest: 0 });
    else if (change.kind === 'removed') this.#nodes.delete(change.gridNo);
    else if (lightRedrawnAtStop && change.team === OUR_TEAM) this.#redraw(change.soldier);
  }

  #redraw(soldier: number): void {
    const light = this.#drawn.get(soldier);
    if (!light) return;
    this.#erase(light);
    this.#draw(light);
  }

  #draw(light: RoofLight): void {
    for (const [gridNo, node] of this.#nodes) {
      const amount = light.roof.get(gridNo) ?? 0;
      if (node.asTheRoof || amount === 0) continue;
      node.sum = u8(node.sum + amount);
      node.strongest = Math.max(node.strongest, amount);
    }
  }

  #erase(light: RoofLight): void {
    for (const [gridNo, node] of this.#nodes) {
      const amount = light.roof.get(gridNo) ?? 0;
      if (node.asTheRoof || amount === 0) continue;
      node.sum = amount > node.sum ? 0 : node.sum - amount;
      node.strongest = Math.min(node.strongest, node.sum);
    }
  }
}

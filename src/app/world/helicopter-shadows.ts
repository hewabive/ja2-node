// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-11-08. See LICENSE (SFI-SCLA).
// @src src/game/Tactical/Merc_Entering.cc HandleHeliDrop HELI_SHOW_HELI (heli_sh.sti on the shadow layer at the sweet
// @src spot, ANITILE_FORWARD | ANITILE_LOOPING from frame 0 every sDelay 90 ms); src/game/TileEngine/Tile_Animation.cc
// @src UpdateAniTiles (the next frame once the delay has passed, the first again after the last); Tile_Cache.cc
// @src AddCachedTile (the frame count from the first picture's aux data).

import type { HelicopterShadowView } from '../../protocol/view.ts';

const FRAME_DELAY_MS = 90;

export interface HelicopterShadowFrame extends HelicopterShadowView {
  readonly frame: number;
}

interface ShadowTile {
  frame: number;
  lastStepMs: number;
}

export class HelicopterShadows {
  readonly #tiles: ShadowTile[] = [];

  update(shadows: readonly HelicopterShadowView[], clockMs: number, frameCount: number | null): HelicopterShadowFrame[] {
    this.#tiles.length = Math.min(this.#tiles.length, shadows.length);
    while (this.#tiles.length < shadows.length) this.#tiles.push({ frame: 0, lastStepMs: clockMs });
    if (frameCount === null || frameCount <= 0) return [];
    return shadows.flatMap((s, k) => {
      const tile = this.#tiles[k];
      return tile ? [{ ...s, frame: this.#animate(tile, clockMs, frameCount) }] : [];
    });
  }

  #animate(tile: ShadowTile, clockMs: number, frameCount: number): number {
    const steps = Math.max(0, Math.floor((clockMs - tile.lastStepMs) / FRAME_DELAY_MS));
    tile.lastStepMs += steps * FRAME_DELAY_MS;
    tile.frame = (tile.frame + steps) % frameCount;
    return tile.frame;
  }
}

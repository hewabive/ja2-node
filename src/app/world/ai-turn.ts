// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-19. See LICENSE (SFI-SCLA).
// @src src/game/TacticalAI/AIMain.cc StartNPCAI (SOLDIER_UNDERAICONTROL set), EndAIGuysTurn (cleared);
// @src src/game/TileEngine/RenderWorld.cc RenderTiles (the baton holder glows during the enemy turn).

import type { SimEvent } from '../../sim/events.ts';

export class AiTurnHolder {
  #soldier: number | null = null;

  get soldier(): number | null {
    return this.#soldier;
  }

  observe(events: readonly SimEvent[]): void {
    for (const e of events) {
      if (e.type === 'aiTurn') this.#soldier = e.soldier;
      else if (e.type === 'turnStarted' || e.type === 'combatEnded' || e.type === 'interrupt' || e.type === 'interruptEnded')
        this.#soldier = null;
    }
  }

  reset(): void {
    this.#soldier = null;
  }

  holds(id: number): boolean {
    return this.#soldier === id;
  }
}

import type { WireframeRecalculation, WireframeRecalculations } from '../../render/world/reveal.ts';
import type { SimEvent } from '../../sim/events.ts';

export class WireframeRecalculationLog {
  #generation = 0;
  #list: WireframeRecalculation[] = [];

  get recalculations(): WireframeRecalculations {
    return { generation: this.#generation, list: this.#list };
  }

  follow(events: readonly SimEvent[]): void {
    for (const e of events) {
      if (e.type === 'sectorLoaded') this.restart();
      else if (e.type === 'wireframesRecalculated') this.#list.push({ tiles: e.tiles, revealed: e.revealed });
    }
  }

  restart(): void {
    this.#generation++;
    this.#list = [];
  }
}

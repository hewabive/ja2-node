import { bulletsShownToPlayer } from '../sim/knowledge/sim-view.ts';
import type { Bullet } from '../sim/tactical/combat/bullets.ts';
import type { TacticalState } from '../sim/tactical/state.ts';
import type { BulletView } from '../sim/tactical/world-view.ts';

export class BulletFlights {
  readonly #since = new WeakMap<Bullet, number>();

  views(t: TacticalState, tick: number): BulletView[] {
    return bulletsShownToPlayer(t, (b) => this.#firstSeen(b, tick));
  }

  #firstSeen(b: Bullet, tick: number): number {
    const known = this.#since.get(b);
    if (known !== undefined) return known;
    this.#since.set(b, tick);
    return tick;
  }
}

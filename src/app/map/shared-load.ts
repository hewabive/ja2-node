import type { LoadProgress } from '../../ui/screens/front-end/flow.ts';

export type DeferStart = (start: () => void) => void;

interface Reached {
  readonly done: number;
  readonly total: number;
}

export class SharedLoad {
  readonly #run: (progress: LoadProgress) => Promise<void>;
  readonly #defer: DeferStart;
  readonly #followers = new Set<LoadProgress>();
  #reached: Reached | null = null;
  #running: Promise<void> | null = null;
  #backgroundAsked = false;

  constructor(run: (progress: LoadProgress) => Promise<void>, defer: DeferStart) {
    this.#run = run;
    this.#defer = defer;
  }

  load(follower?: LoadProgress): Promise<void> {
    if (follower) this.#follow(follower);
    this.#running ??= this.#run((done, total) => this.#report(done, total)).finally(() => {
      this.#running = null;
      this.#reached = null;
      this.#followers.clear();
    });
    return this.#running;
  }

  background(): void {
    if (this.#backgroundAsked) return;
    this.#backgroundAsked = true;
    this.#defer(() => {
      this.load().catch(() => undefined);
    });
  }

  #follow(follower: LoadProgress): void {
    this.#followers.add(follower);
    if (this.#reached) follower(this.#reached.done, this.#reached.total);
  }

  #report(done: number, total: number): void {
    this.#reached = { done, total };
    for (const follower of this.#followers) follower(done, total);
  }
}

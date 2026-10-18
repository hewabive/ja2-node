import type { MirrorReport, Player } from './player.ts';

export interface ReloadPlan {
  readonly exactInBattle: number | null;
  readonly playerLoadAfter: string | null;
}

export interface ReloadReport {
  readonly exact: {
    readonly battle: number;
    readonly round: number;
    readonly save: string;
    readonly from: string;
    readonly to: string;
    readonly steps: number;
    readonly differences: readonly string[];
  } | null;
  readonly player: {
    readonly after: string;
    readonly save: string;
    readonly from: string;
    readonly to: string;
    readonly seed: number | null;
  } | null;
}

export const NO_RELOADS: ReloadPlan = { exactInBattle: null, playerLoadAfter: null };

const EXACT_SAVE = 'campaign-bot-battle';
const PLAYER_SAVE = 'campaign-bot-player';

export class Reloads {
  readonly plan: ReloadPlan;
  exact: ReloadReport['exact'] = null;
  player: ReloadReport['player'] = null;
  #pending: { battle: number; round: number; save: string; from: string } | null = null;

  constructor(plan: ReloadPlan) {
    this.plan = plan;
  }

  report(): ReloadReport {
    return { exact: this.exact, player: this.player };
  }

  wantsExactLoad(p: Player, round: number): boolean {
    return (
      this.plan.exactInBattle !== null && this.exact === null && this.#pending === null && round >= this.plan.exactInBattle && !p.mirror
    );
  }

  async startExactLoad(p: Player, round: number): Promise<boolean> {
    const saved = await p.game.save(p.session, EXACT_SAVE, `round ${round} of battle ${p.tally.battles}`);
    if (!saved.ok) {
      p.log(`  save in battle refused: ${saved.refused ?? ''} ${saved.reason ?? ''}`);
      return false;
    }
    const loaded = await p.game.load(EXACT_SAVE, false);
    if (!loaded.ok) {
      p.log(`  exact load refused: ${loaded.refused ?? ''} ${loaded.reason ?? ''}`);
      return false;
    }
    p.mirror = { session: loaded.session, steps: 0, differences: [] };
    this.#pending = { battle: p.tally.battles, round, save: EXACT_SAVE, from: p.session };
    p.log(`  saved in round ${round} and loaded the save exactly into ${loaded.session}: both sessions play on`);
    return true;
  }

  finishExactLoad(p: Player): void {
    const mirror: MirrorReport | null = p.mirror;
    const pending = this.#pending;
    if (!mirror || !pending) return;
    p.mirror = null;
    this.#pending = null;
    this.exact = { ...pending, to: mirror.session, steps: mirror.steps, differences: [...mirror.differences] };
    p.log(
      `  the reloaded session matched the original for ${mirror.steps} steps (${mirror.differences.length} differences); playing on in ${mirror.session}`,
    );
    p.session = mirror.session;
  }

  wantsPlayerLoad(step: string): boolean {
    return this.plan.playerLoadAfter === step && this.player === null;
  }

  async playerLoad(p: Player, step: string): Promise<void> {
    const saved = await p.game.save(p.session, PLAYER_SAVE, `after ${step}`);
    if (!saved.ok) {
      p.log(`  save after ${step} refused: ${saved.refused ?? ''} ${saved.reason ?? ''}`);
      return;
    }
    const loaded = await p.game.load(PLAYER_SAVE, true);
    if (!loaded.ok) {
      p.log(`  player load refused: ${loaded.refused ?? ''} ${loaded.reason ?? ''}`);
      return;
    }
    this.player = { after: step, save: PLAYER_SAVE, from: p.session, to: loaded.session, seed: loaded.seed ?? null };
    p.log(`  saved after ${step} and loaded it as a player into ${loaded.session} (seed ${loaded.seed ?? '?'})`);
    p.session = loaded.session;
  }
}

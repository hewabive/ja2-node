import type { CommandEnvelope } from '../protocol/messages.ts';
import type { PlayerView } from '../protocol/view.ts';
import type { CampaignSim } from '../sim/campaign/campaign-sim.ts';
import type { Roster } from '../sim/campaign/roster.ts';
import type { CommandResult } from '../sim/command.ts';
import type { SimEvent } from '../sim/events.ts';
import { isTimeBeingCompressed, worldDay, worldHour, worldMinute } from '../sim/strategic/time/world-clock.ts';
import type { TacticalSim } from '../sim/tactical/tactical-sim.ts';
import { tacticalPlayerView } from './sandbox.ts';
import type { SessionSim } from './session.ts';

export class CampaignSession implements SessionSim {
  readonly campaign: CampaignSim;
  readonly roster: Roster | null;

  constructor(campaign: CampaignSim, roster: Roster | null = null) {
    this.campaign = campaign;
    this.roster = roster;
  }

  get sim(): TacticalSim {
    const tactical = this.campaign.tactical;
    if (!tactical) throw new Error('no sector is loaded');
    return tactical;
  }

  get tick(): number {
    return this.campaign.tick;
  }

  isIdle(): boolean {
    return this.campaign.isIdle();
  }

  hasPendingDecision(): boolean {
    return this.campaign.hasPendingDecision();
  }

  step(): void {
    this.campaign.step();
  }

  drainEvents(): SimEvent[] {
    return this.campaign.drainEvents();
  }

  dispatch(cmd: CommandEnvelope): CommandResult {
    return this.campaign.dispatch(cmd);
  }

  view(): PlayerView {
    const c = this.campaign.state.clock;
    const clock = { day: worldDay(c), hour: worldHour(c), minute: worldMinute(c), compressing: isTimeBeingCompressed(c) };
    const tactical = this.campaign.tactical;
    if (!tactical) return { tick: this.tick, mapPath: null, clock, soldiers: [] };
    return { ...tacticalPlayerView(tactical, this.tick), clock };
  }
}

import type { CommandEnvelope } from '../protocol/messages.ts';
import type { PlayerView, SoldierView } from '../protocol/view.ts';
import type { WorldTimeControl } from '../sim/advance.ts';
import type { CampaignSim } from '../sim/campaign/campaign-sim.ts';
import type { Roster } from '../sim/campaign/roster.ts';
import type { CommandResult } from '../sim/command.ts';
import type { SimEvent } from '../sim/events.ts';
import { isTimeBeingCompressed, worldDay, worldHour, worldMinute } from '../sim/strategic/time/world-clock.ts';
import { Team } from '../sim/tactical/soldier.ts';
import type { TacticalSim } from '../sim/tactical/tactical-sim.ts';
import { autoresolveView, promptView } from './battle-view.ts';
import { contractPromptView } from './contract-view.ts';
import { laptopView } from './laptop-view.ts';
import { tacticalPlayerView } from './sandbox.ts';
import type { SessionSim } from './session.ts';
import { strategicView } from './strategic-view.ts';
import type { WorldCache } from './world-cache.ts';

function withMerchantLabels(campaign: CampaignSim, soldiers: readonly SoldierView[]): SoldierView[] {
  const shop = campaign.shop;
  const t = campaign.tactical?.state;
  if (!shop || !t) return [...soldiers];
  return soldiers.map((v) => {
    const s = t.soldiers[v.id];
    if (!s || s.team === Team.OUR) return v;
    const label = shop.merchantLabel(s.profile);
    return label ? { ...v, merchant: label } : v;
  });
}

export class CampaignSession implements SessionSim {
  readonly campaign: CampaignSim;
  readonly roster: Roster | null;
  readonly worlds: WorldCache | null;

  constructor(campaign: CampaignSim, roster: Roster | null = null, worlds: WorldCache | null = null) {
    this.campaign = campaign;
    this.roster = roster;
    this.worlds = worlds;
  }

  async prepare(cmd: CommandEnvelope): Promise<void> {
    const flow = this.campaign.sectors;
    if (!flow || !this.worlds) return;
    await this.worlds.prepare(flow.mapsNeededSoon(cmd.type === 'enterSector' ? cmd.sector : undefined));
  }

  get sim(): TacticalSim {
    const tactical = this.campaign.tactical;
    if (!tactical) throw new Error('no sector is loaded');
    return tactical;
  }

  get tick(): number {
    return this.campaign.tick;
  }

  get worldClock(): WorldTimeControl {
    return this.campaign.worldClock;
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
    const strategic = strategicView(this.campaign);
    const battle = this.campaign.battle
      ? {
          prompt: promptView(this.campaign),
          ...(this.campaign.contracts ? { contractPrompt: contractPromptView(this.campaign) } : {}),
          autoresolve: autoresolveView(this.campaign),
        }
      : {};
    const shop = this.campaign.shop ? { shop: this.campaign.shop.view() } : {};
    const laptop = this.campaign.laptop ? { laptop: laptopView(this.campaign) } : {};
    const extra = strategic ? { clock, strategic, ...battle, ...shop, ...laptop } : { clock, ...battle, ...shop, ...laptop };
    const tactical = this.campaign.tactical;
    if (!tactical) return { tick: this.tick, mapPath: null, soldiers: [], ...extra };
    const view = tacticalPlayerView(tactical, this.tick);
    return { ...view, soldiers: withMerchantLabels(this.campaign, view.soldiers), ...extra };
  }
}

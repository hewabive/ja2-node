import type { PresentationTimeline } from '../content/anim/timelines.ts';
import type { TextKey } from '../content/narrative/dialogue-text.ts';
import type { CommandEnvelope } from '../protocol/messages.ts';
import { initialMusic, type MusicFacts, type MusicState } from '../protocol/music.ts';
import type {
  BoxingView,
  CampaignEndedView,
  ConversationView,
  MeanwhileSceneView,
  NpcRequestPromptView,
  PlayerView,
  SoldierView,
} from '../protocol/view.ts';
import type { WorldTimeControl } from '../sim/advance.ts';
import type { CampaignSim } from '../sim/campaign/campaign-sim.ts';
import { MercKind, type Roster } from '../sim/campaign/roster.ts';
import type { CommandResult } from '../sim/command.ts';
import type { SimEvent } from '../sim/events.ts';
import { numHostilesInSector } from '../sim/strategic/forces/groups.ts';
import { isTimeBeingCompressed, worldDay, worldHour, worldMinute } from '../sim/strategic/time/world-clock.ts';
import { BoxingState, boxingStateName } from '../sim/tactical/narrative/boxing-state.ts';
import type { SaveImportReport } from '../sim/tactical/save-import.ts';
import { Team } from '../sim/tactical/soldier.ts';
import type { TacticalSim } from '../sim/tactical/tactical-sim.ts';
import { autoresolveView, npcRequestView, promptView } from './battle-view.ts';
import type { CampaignParts } from './campaign-factory.ts';
import { contractPromptView } from './contract-view.ts';
import { laptopView } from './laptop-view.ts';
import { tacticalPlayerView } from './sandbox.ts';
import type { SessionSim } from './session.ts';
import { strategicView } from './strategic-view.ts';
import type { WorldCache } from './world-cache.ts';

export interface TextSource {
  text(key: TextKey): string | null;
}

const NO_PROFILE = 200;

const RECRUITED_KINDS: Readonly<Record<number, string>> = { [MercKind.NPC]: 'rpc', [MercKind.EPC]: 'epc' };

function ownSoldierLabels(campaign: CampaignSim, v: SoldierView): SoldierView {
  const roster = campaign.battle?.roster;
  const m = roster?.get(v.id);
  if (!roster || !m) return v;
  const kind = RECRUITED_KINDS[m.kind];
  const recruited = kind ? { kind, profile: m.profile } : {};
  return { ...v, ...recruited, ...(m.isRobot ? { controlled: roster.canRobotBeControlled(m.id) } : {}) };
}

function withMerchantLabels(campaign: CampaignSim, soldiers: readonly SoldierView[]): SoldierView[] {
  const shop = campaign.shop;
  const talk = campaign.talk;
  const t = campaign.tactical?.state;
  if (!t) return [...soldiers];
  return soldiers.map((v) => {
    const s = t.soldiers[v.id];
    if (s?.team === Team.OUR) return ownSoldierLabels(campaign, v);
    if (!s || (!shop && !talk)) return v;
    const label = shop?.merchantLabel(s.profile) ?? null;
    const talkable = talk?.talkableLabel(s) ?? null;
    const profile = s.profile !== NO_PROFILE && (label || talkable) ? { profile: s.profile } : {};
    return { ...v, ...(label ? { merchant: label } : {}), ...(talkable ? { talkable } : {}), ...profile };
  });
}

function isTextKey(value: unknown): value is TextKey {
  if (typeof value !== 'object' || value === null) return false;
  const k = value as Record<string, unknown>;
  return typeof k.file === 'string' && typeof k.row === 'number' && typeof k.width === 'number';
}

function withText<T>(value: T, texts: TextSource | null): T {
  if (!texts) return value;
  if (Array.isArray(value)) return value.map((v) => withText(v, texts)) as T;
  if (typeof value !== 'object' || value === null || Object.getPrototypeOf(value) !== Object.prototype) return value;
  const o = value as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const [key, v] of Object.entries(o)) out[key] = withText(v, texts);
  if (isTextKey(o.textKey) && o.text === undefined) {
    const text = texts.text(o.textKey);
    if (text !== null) out.text = text;
  }
  return out as T;
}

export interface CampaignOrigin {
  readonly kind: 'campaign' | 'imported';
  readonly parts: CampaignParts;
  readonly report?: SaveImportReport;
}

export class CampaignSession implements SessionSim {
  readonly campaign: CampaignSim;
  readonly presentation: PresentationTimeline;
  readonly roster: Roster | null;
  readonly worlds: WorldCache | null;
  readonly texts: TextSource | null;
  readonly origin: CampaignOrigin | null;
  initialMusic: MusicState = initialMusic();

  constructor(
    campaign: CampaignSim,
    presentation: PresentationTimeline,
    roster: Roster | null = null,
    worlds: WorldCache | null = null,
    texts: TextSource | null = null,
    origin: CampaignOrigin | null = null,
  ) {
    this.campaign = campaign;
    this.presentation = presentation;
    this.roster = roster;
    this.worlds = worlds;
    this.texts = texts;
    this.origin = origin;
  }

  async prepare(cmd: CommandEnvelope): Promise<void> {
    const flow = this.campaign.sectors;
    if (!flow || !this.worlds) return;
    await this.worlds.prepare(flow.mapsNeededSoon(cmd.type === 'enterSector' ? cmd.sector : undefined));
  }

  preparedMaps(): readonly string[] {
    return this.worlds?.preparedPaths() ?? [];
  }

  async prepareMaps(paths: readonly string[]): Promise<void> {
    await this.worlds?.prepare(paths);
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
    return withText(this.campaign.drainEvents(), this.texts);
  }

  dispatch(cmd: CommandEnvelope): CommandResult {
    return withText(this.campaign.dispatch(cmd), this.texts);
  }

  get holdsCreationEvents(): boolean {
    return this.origin?.kind === 'campaign';
  }

  #conversation(): { conversation?: ConversationView | null; npcRequest?: NpcRequestPromptView | null; scriptedSequence?: boolean } {
    const talk = this.campaign.talk;
    if (!talk) return {};
    const conversation = withText(talk.view(), this.texts);
    return { conversation, npcRequest: npcRequestView(this.campaign), ...(talk.scriptedSequence() ? { scriptedSequence: true } : {}) };
  }

  #story(): { meanwhile?: MeanwhileSceneView | null; ended?: CampaignEndedView | null } {
    const c = this.campaign;
    const victory = c.state.ending.victory;
    const meanwhile = c.meanwhile.sceneView();
    return {
      ...(meanwhile ? { meanwhile } : {}),
      ...(victory
        ? { ended: { outcome: 'victory', at: victory.at, day: victory.day, ending: victory.ending, mercDeaths: victory.mercDeaths } }
        : {}),
    };
  }

  ended(): boolean {
    return this.campaign.ended();
  }

  musicFacts(): MusicFacts {
    const c = this.campaign;
    const s = c.state;
    const world = c.tactical ? s.worldSector : null;
    const strategic = c.strategic;
    return {
      creature: s.creatures.useCreatureMusic,
      inCombat: c.tactical?.state.inCombat ?? false,
      sectorLoaded: world !== null,
      hostiles: world && strategic ? numHostilesInSector(strategic, world) : 0,
      gameJustStarted: s.didGameJustStart,
    };
  }

  #boxing(): { boxing?: BoxingView | null } {
    const t = this.campaign.tactical?.state;
    if (!t || !this.campaign.talk) return {};
    const b = t.boxing;
    if (b.state === BoxingState.NOT_BOXING) return { boxing: null };
    const boxers = t.soldiers.filter((s) => s?.placed && s.boxer).map((s) => s.id);
    return { boxing: { state: boxingStateName(b.state) as BoxingView['state'], boxers, uiLocked: b.uiLocked } };
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
    const talk = { ...this.#conversation(), ...this.#boxing() };
    const story = this.#story();
    const extra = strategic
      ? { clock, strategic, ...battle, ...shop, ...laptop, ...talk, ...story }
      : { clock, ...battle, ...shop, ...laptop, ...talk, ...story };
    const tactical = this.campaign.tactical;
    if (!tactical) return { tick: this.tick, mapPath: null, soldiers: [], ...extra };
    const imp = this.campaign.state.laptop.imp.voices;
    const view = tacticalPlayerView(tactical, this.tick, this.presentation, (profile) => imp.get(profile) ?? profile);
    return { ...view, soldiers: withMerchantLabels(this.campaign, view.soldiers), ...extra };
  }
}

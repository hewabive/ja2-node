import type { AnimationTimelines, PresentationTimeline } from '../content/anim/timelines.ts';
import type { TextKey } from '../content/narrative/dialogue-text.ts';
import { type ProfileFaceRecord, profileFaceRecord } from '../content/narrative/profile-presentation.ts';
import type { UiStrings } from '../content/text/strings.ts';
import type { CommandEnvelope } from '../protocol/messages.ts';
import { initialMusic, type MusicFacts, type MusicState } from '../protocol/music.ts';
import type {
  BoxingView,
  BulletView,
  CampaignEndedView,
  ConversationView,
  MeanwhileSceneView,
  NpcRequestPromptView,
  PlayerView,
  SoldierView,
} from '../protocol/view.ts';
import type { WorldTimeControl } from '../sim/advance.ts';
import type { CampaignSim } from '../sim/campaign/campaign-sim.ts';
import { findEmail } from '../sim/campaign/laptop/mail.ts';
import { laptopRefusal } from '../sim/campaign/laptop/refusals.ts';
import { MercKind, type Roster, type RosterMerc } from '../sim/campaign/roster.ts';
import type { CommandResult } from '../sim/command.ts';
import type { SimEvent } from '../sim/events.ts';
import type { StrategicRules } from '../sim/knowledge/strategic.ts';
import { Assignment } from '../sim/strategic/forces/constants.ts';
import { numHostilesInSector } from '../sim/strategic/forces/groups.ts';
import type { TacticalContent } from '../sim/tactical/content.ts';
import { BoxingState, boxingStateName } from '../sim/tactical/narrative/boxing-state.ts';
import type { SaveImportReport } from '../sim/tactical/save-import.ts';
import { SoldierStatusFlags, Team } from '../sim/tactical/soldier.ts';
import type { TacticalSim } from '../sim/tactical/tactical-sim.ts';
import { autoresolveView, npcRequestView, promptView } from './battle-view.ts';
import { BulletFlights } from './bullet-flights.ts';
import type { CampaignParts } from './campaign-factory.ts';
import { contractPromptView } from './contract-view.ts';
import { laptopView } from './laptop-view.ts';
import { emailText } from './mail-text.ts';
import { clockView } from './map-screen-view.ts';
import { type MessageFacts, tacticalMessageFacts } from './message-facts.ts';
import { tacticalPlayerView } from './sandbox.ts';
import type { SessionSim } from './session.ts';
import { strategicView } from './strategic-view.ts';
import type { WorldCache } from './world-cache.ts';

export interface TextSource {
  text(key: TextKey): string | null;
}

const NO_PROFILE = 200;
const EMAIL_TEXT = 'emailText';

const RECRUITED_KINDS: Readonly<Record<number, string>> = { [MercKind.NPC]: 'rpc', [MercKind.EPC]: 'epc' };

function crewFields(m: RosterMerc): Pick<SoldierView, 'asleep' | 'squad' | 'vehicle'> {
  const vehicle =
    m.assignment === Assignment.VEHICLE ? { id: m.vehicleId, driver: (m.statusFlags & SoldierStatusFlags.DRIVER) !== 0 } : null;
  return { asleep: m.asleep, squad: m.assignment < Assignment.ON_DUTY ? m.assignment : null, vehicle };
}

function ownSoldierLabels(campaign: CampaignSim, v: SoldierView): SoldierView {
  const roster = campaign.battle?.roster;
  const m = roster?.get(v.id);
  if (!roster || !m) return v;
  const kind = RECRUITED_KINDS[m.kind];
  const recruited = kind ? { kind, profile: m.profile } : {};
  return { ...v, ...crewFields(m), ...recruited, ...(m.isRobot ? { controlled: roster.canRobotBeControlled(m.id) } : {}) };
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
  #strategicRules: StrategicRules | null = null;
  readonly #flights = new BulletFlights();
  #labels: UiStrings | null = null;

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

  tacticalContent(): TacticalContent | null {
    return this.campaign.tactical?.state.content ?? null;
  }

  animationTimelines(): AnimationTimelines | null {
    const content = this.tacticalContent();
    return content ? { logic: content.timeline, presentation: this.presentation } : null;
  }

  bulletViews(): BulletView[] {
    const tactical = this.campaign.tactical;
    return tactical ? this.#flights.views(tactical.state, this.tick) : [];
  }

  strategicRules(): StrategicRules | null {
    if (this.#strategicRules) return this.#strategicRules;
    const content = this.campaign.strategic?.content;
    const economy = this.campaign.economy?.economy;
    const items = this.campaign.battle?.content.items;
    const worlds = this.worlds;
    if (!content || !economy || !items || !worlds) return null;
    this.#strategicRules = { content, economy, items, mapExists: (path) => worlds.exists(path) };
    return this.#strategicRules;
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
    if (cmd.type === EMAIL_TEXT) return this.#emailText(cmd);
    return withText(this.campaign.dispatch(cmd), this.texts);
  }

  get skipsSpeech(): boolean {
    return this.campaign.talk?.skipsSpeech ?? false;
  }

  skipSpeech(skip: boolean): void {
    this.campaign.talk?.skipSpeech(skip);
  }

  #emailText(cmd: CommandEnvelope): CommandResult {
    const id = cmd.id;
    const mail = typeof id === 'number' && Number.isInteger(id) ? findEmail(this.campaign.state.laptop, id) : undefined;
    if (!mail) return laptopRefusal('noSuchMail');
    const text = this.texts ? emailText(this.campaign, mail, this.texts) : null;
    return text ? { ok: true, data: text } : laptopRefusal('noText');
  }

  useLabels(labels: UiStrings | null): void {
    this.#labels = labels;
  }

  get labels(): UiStrings | null {
    return this.#labels;
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

  profileFaceRecords(): ProfileFaceRecord[] {
    const imp = this.campaign.state.laptop.imp.profiles;
    const base = this.origin?.parts.content.profiles ?? this.campaign.battle?.content.profiles ?? [];
    return base.filter((p) => p !== undefined).map((p) => profileFaceRecord(imp.get(p.id) ?? p));
  }

  messageFacts(): MessageFacts {
    const c = this.campaign;
    const soldierOf = (id: number) => c.tactical?.state.soldiers[id] ?? c.battle?.roster.get(id)?.soldier ?? null;
    const profiles = c.battle?.content.profiles ?? [];
    return {
      ...tacticalMessageFacts(c.tactical, soldierOf),
      profileName: (profile) => profiles[profile]?.nickname ?? null,
    };
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
    const clock = clockView(this.campaign);
    const strategic = strategicView(this.campaign);
    const battle = this.campaign.battle
      ? {
          prompt: promptView(this.campaign),
          ...(this.campaign.contracts ? { contractPrompt: contractPromptView(this.campaign) } : {}),
          autoresolve: autoresolveView(this.campaign),
        }
      : {};
    const shop = this.campaign.shop ? { shop: this.campaign.shop.view() } : {};
    const laptop = this.campaign.laptop ? { laptop: laptopView(this.campaign, { texts: this.texts, labels: this.#labels }) } : {};
    const talk = { ...this.#conversation(), ...this.#boxing() };
    const story = this.#story();
    const extra = strategic
      ? { clock, strategic, ...battle, ...shop, ...laptop, ...talk, ...story }
      : { clock, ...battle, ...shop, ...laptop, ...talk, ...story };
    const tactical = this.campaign.tactical;
    if (!tactical) return { tick: this.tick, mapPath: null, soldiers: [], ...extra };
    const imp = this.campaign.state.laptop.imp.voices;
    const stepping = this.campaign.state.flow === 'tactical';
    const view = tacticalPlayerView(tactical, this.tick, this.presentation, (profile) => imp.get(profile) ?? profile, stepping);
    return { ...view, soldiers: withMerchantLabels(this.campaign, view.soldiers), ...extra };
  }
}

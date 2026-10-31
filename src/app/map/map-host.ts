import { ClientRandom, seedFromText } from '../../audio/client-random.ts';
import type { UiLanguage } from '../../content/text/data-version.ts';
import type { ViewFrame } from '../../protocol/view.ts';
import type { GameOptions } from '../../ui/client/api-types.ts';
import type { LayoutModel } from '../../ui/layout/model.ts';
import type { MessageBoxes } from '../../ui/message-boxes.ts';
import { BATTLE_LAYOUTS, type BattleEnvironment, type BattleLayout } from '../../ui/screens/battle/environment.ts';
import type { MapEntry, MapPort } from '../../ui/screens/front-end/flow.ts';
import { MAP_LAYOUTS, type MapEnvironment, type MapFlow, type MapLayout } from '../../ui/screens/map/environment.ts';
import { mapFacts } from '../../ui/screens/map/facts.ts';
import { type InvasionEvent, invasionBoxesOf } from '../../ui/screens/map/invasion.ts';
import { MapScreen } from '../../ui/screens/map/map-screen.ts';
import type { MercTextBoxArt } from '../../ui/widgets/merc-text-box.ts';
import type { MessageBoxLabels, MessageBoxStyle } from '../../ui/widgets/message-box.ts';
import { SessionBattleClient } from '../battle/battle-client.ts';
import { attachBattleHook, type BattleHook } from '../battle/battle-hook.ts';
import { BattleSound } from '../battle/battle-sound.ts';
import type { GamePage } from '../game/game-page.ts';
import { loadLayouts, type UiBoot } from '../game/ui-boot.ts';
import { ClientKnowledge } from '../hints/client-knowledge.ts';
import { createHintHook, type HintHook } from '../hints/hint-hook.ts';
import { HintProvider } from '../hints/hint-provider.ts';
import type { SessionClient } from '../net/session-client.ts';
import { loadSettings } from '../settings.ts';
import { fetchItemCatalogue, fetchProfiles } from '../tactical/tactical-media.ts';
import { BOARD_KEYS, BOARD_PCX, boardImages } from './map-board.ts';
import { SessionMapClient } from './map-client.ts';
import { attachMapHook, type MapHook } from './map-hook.ts';
import { MapMediaStore } from './map-media.ts';
import { MapSound } from './map-sound.ts';

const SHADOW_HINTS_PARAM = 'shadowHints';
const PIN_CLOCK_PARAM = 'pinClock';
const HOLD_TIME_PARAM = 'holdTime';
const KEPT_COMMANDS = 64;
const LOAD_STEPS = 4;

export interface MapHostOptions {
  readonly page: GamePage;
  readonly ui: UiBoot;
  readonly session: SessionClient;
  readonly boxes: MessageBoxes;
  readonly basicTextBox: MercTextBoxArt;
  readonly messageBoxStyle: (style: number) => MessageBoxStyle;
  readonly messageBoxLabels: MessageBoxLabels;
  readonly language: () => UiLanguage | null;
  readonly version: string;
  readonly gameOptions: () => Promise<GameOptions | null>;
}

interface Loaded {
  readonly media: MapMediaStore;
  readonly layouts: ReadonlyMap<MapLayout, LayoutModel>;
  readonly knowledge: ClientKnowledge;
  readonly sound: MapSound;
  readonly battleLayouts: ReadonlyMap<BattleLayout, LayoutModel>;
  readonly battleSound: BattleSound;
}

type PreBattleEvent = Extract<NonNullable<ViewFrame['events']>[number], { readonly type: 'preBattle' }>;

function autoStartOf(frames: readonly ViewFrame[]): PreBattleEvent | null {
  let found: PreBattleEvent | null = null;
  for (const frame of frames) for (const e of frame.events ?? []) if (e.type === 'preBattle' && e.autoStart) found = e;
  return found;
}

export class MapHost implements MapPort {
  readonly hook: MapHook;
  readonly battleHook: BattleHook;
  readonly #o: MapHostOptions;
  readonly #battleClient: SessionBattleClient;
  #pendingAutoStart: PreBattleEvent | null = null;
  readonly #pendingInvasions: InvasionEvent[] = [];
  readonly #hints: HintProvider;
  readonly #hintHook: HintHook;
  readonly #client: SessionMapClient;
  readonly #random: ClientRandom;
  readonly #requestedProfiles = new Set<number>();
  #knowledge: ClientKnowledge | null = null;
  #loaded: Loaded | null = null;
  #loading: Promise<void> | null = null;
  #screen: MapScreen | null = null;
  #refreshing = false;

  constructor(options: MapHostOptions) {
    this.#o = options;
    const params = new URLSearchParams(location.search);
    const shadow = params.get(SHADOW_HINTS_PARAM) === '1';
    this.#hints = new HintProvider({ channel: options.session, knowledge: () => this.#knowledge, now: () => performance.now(), shadow });
    this.#hintHook = createHintHook(this.#hints);
    this.#client = new SessionMapClient(options.session, this.#hints, params.get(HOLD_TIME_PARAM) === '1');
    this.#random = new ClientRandom(seedFromText(`${options.session.session ?? 'map'}/map`));
    this.hook = this.#createHook();
    attachMapHook(options.page.hook, this.hook);
    this.#battleClient = new SessionBattleClient(options.session);
    this.battleHook = this.#createBattleHook();
    attachBattleHook(options.page.hook, this.battleHook);
  }

  get session(): SessionClient {
    return this.#o.session;
  }

  get loaded(): boolean {
    return this.#loaded !== null;
  }

  load(onProgress: (done: number, total: number) => void): Promise<void> {
    this.#loading ??= this.#load(onProgress).finally(() => {
      this.#loading = null;
    });
    return this.#loading;
  }

  async #openKnowledge(): Promise<ClientKnowledge> {
    const identity = this.#o.session.identity;
    if (!identity) throw new Error('the session has not identified its rules');
    const knowledge = await ClientKnowledge.open(this.#o.ui.source, identity);
    if (!knowledge.rules.strategic) throw new Error('the rule pack has no strategic content');
    const mapPath = this.#o.session.latestView?.mapPath;
    this.#knowledge = knowledge;
    if (mapPath) void knowledge.worlds.ensure(mapPath).then(() => this.#hints.warm());
    this.#hints.warm();
    this.#hintHook.usable = knowledge.usable;
    this.#hintHook.ready = true;
    return knowledge;
  }

  async #load(onProgress: (done: number, total: number) => void): Promise<void> {
    const ui = this.#o.ui;
    const session = this.#o.session;
    let done = 0;
    const step = <T>(value: T): T => {
      onProgress(++done, LOAD_STEPS);
      return value;
    };
    onProgress(done, LOAD_STEPS);
    const battleSound = new BattleSound(ui.audio.engine, ui.source, session.session ?? 'battle');
    const sound = new MapSound(ui.audio.engine, ui.source, () => session.view, session.session ?? 'map');
    const [knowledge, layouts, , media, battleLayouts] = await Promise.all([
      (this.#knowledge ? Promise.resolve(this.#knowledge) : this.#openKnowledge()).then(step),
      loadLayouts(ui, MAP_LAYOUTS).then(step),
      this.#loadBoard().then(step),
      this.#mediaStore(),
      loadLayouts(ui, BATTLE_LAYOUTS),
      sound.load(),
      battleSound.load(),
    ]);
    onProgress(LOAD_STEPS, LOAD_STEPS);
    this.#loaded = { media, layouts, knowledge, sound, battleLayouts, battleSound };
    this.hook.error = null;
  }

  async #loadBoard(): Promise<void> {
    const ui = this.#o.ui;
    const images = boardImages(await ui.source.read(BOARD_PCX));
    for (const key of Object.keys(BOARD_KEYS) as (keyof typeof BOARD_KEYS)[]) ui.assets.addRgb(BOARD_KEYS[key], images[key]);
  }

  async #mediaStore(): Promise<MapMediaStore> {
    const ui = this.#o.ui;
    const session = this.#o.session;
    const [catalogue, profiles, gunNut] = await Promise.all([
      fetchItemCatalogue(this.#o.language()),
      fetchProfiles(session.session ?? ''),
      this.#o.gameOptions().then(
        (options) => options?.gunNut ?? false,
        () => false,
      ),
    ]);
    return new MapMediaStore({
      assets: ui.assets,
      source: ui.source,
      edt: ui.edt,
      catalogue,
      profiles,
      speech: () => null,
      gunNut,
      messages: () => session.messages,
    });
  }

  async enter(abandonFight: boolean): Promise<MapEntry> {
    const reply = await this.#o.session.command({ type: 'mapScreen', ...(abandonFight ? { abandonFight: true } : {}) });
    const refusal = (reply.data as { refusal?: string } | undefined)?.refusal;
    return { ok: reply.ok, ...(reply.reason ? { reason: reply.reason } : {}), ...(refusal ? { refusal } : {}) };
  }

  screen(flow: MapFlow): MapScreen {
    const loaded = this.#loaded;
    if (!loaded) throw new Error('the map screen is not loaded');
    if (this.#screen) return this.#screen;
    const strategic = loaded.knowledge.rules.strategic;
    if (!strategic) throw new Error('the rule pack has no strategic content');
    const ui = this.#o.ui;
    const env: MapEnvironment = {
      runtime: ui.runtime,
      text: ui.text,
      layout: (name) => {
        const model = loaded.layouts.get(name);
        if (!model) throw new Error(`map layout ${name} is not loaded`);
        return model;
      },
      boxes: this.#o.boxes,
      messageBoxStyle: this.#o.messageBoxStyle,
      messageBoxLabels: this.#o.messageBoxLabels,
      basicTextBox: this.#o.basicTextBox,
      client: this.#client,
      media: loaded.media,
      facts: mapFacts(strategic.content, strategic.economy),
      flow,
      sounds: loaded.sound,
      random: (range) => this.#random.int(range),
      metric: () => loadSettings().display.useMetricSystem,
      notifySleepWake: () => loadSettings().sleepWakeNotification,
      battle: this.#battleEnvironment(loaded, flow),
      version: this.#o.version,
      gameOptions: () => this.#o.gameOptions().catch(() => null),
    };
    this.#screen = new MapScreen(env);
    if (this.#pendingAutoStart) this.#screen.battle.pendAutoStart(this.#pendingAutoStart);
    this.#pendingAutoStart = null;
    this.#screen.noticeInvasions(this.#pendingInvasions.splice(0));
    return this.#screen;
  }

  #battleEnvironment(loaded: Loaded, flow: MapFlow): BattleEnvironment {
    const ui = this.#o.ui;
    return {
      runtime: ui.runtime,
      text: ui.text,
      layout: (name) => {
        const model = loaded.battleLayouts.get(name);
        if (!model) throw new Error(`battle layout ${name} is not loaded`);
        return model;
      },
      client: this.#battleClient,
      sounds: loaded.battleSound,
      media: {
        image: (path) => loaded.media.image(path),
        faceIndex: (profile) => loaded.media.profile(profile)?.faceIndex ?? null,
      },
      boxes: this.#o.boxes,
      flow: { exitGame: () => flow.exitGame() },
      random: (range) => this.#random.int(range),
      instantOpenings: new URLSearchParams(location.search).has(PIN_CLOCK_PARAM),
    };
  }

  frameTime(): void {
    if (this.#screen && this.#o.page.host.screen === this.#screen) this.#o.session.skipToLatest();
    this.#syncHook();
  }

  frames(frames: readonly ViewFrame[]): void {
    if (this.#unknownProfile()) void this.#refreshProfiles();
    if (!this.#screen) {
      this.#pendingAutoStart = autoStartOf(frames) ?? this.#pendingAutoStart;
      this.#pendingInvasions.push(...invasionBoxesOf(frames));
    }
    this.#screen?.frames(frames);
  }

  #unknownProfile(): boolean {
    const media = this.#loaded?.media;
    if (!media || this.#refreshing) return false;
    const unknown = (this.#o.session.strategic?.mercs ?? []).flatMap((m) =>
      m.profile !== undefined && !media.profile(m.profile) ? [m.profile] : [],
    );
    const fresh = unknown.filter((p) => !this.#requestedProfiles.has(p));
    for (const p of fresh) this.#requestedProfiles.add(p);
    return fresh.length > 0;
  }

  async #refreshProfiles(): Promise<void> {
    const session = this.#o.session.session;
    if (!session || !this.#loaded) return;
    this.#refreshing = true;
    try {
      this.#loaded.media.useProfiles(await fetchProfiles(session));
    } catch {
      return;
    } finally {
      this.#refreshing = false;
    }
  }

  dispose(): void {
    this.#screen = null;
  }

  #createHook(): MapHook {
    return {
      ready: false,
      error: null,
      screen: null,
      holds: [],
      lagTicks: 0,
      pendingImages: 0,
      commands: [],
      hints: this.#hintHook,
      command: (cmd) => this.#o.session.command(cmd),
      advance: (until) => this.#o.session.advance(until),
      sectorPoint: (sector) => this.#screen?.sectorPoint(sector) ?? null,
      rowPoint: (row, column) => this.#screen?.rowPoint(row, column) ?? null,
      helicopterPoint: () => this.#screen?.heliIcon() ?? null,
    };
  }

  #createBattleHook(): BattleHook {
    return {
      ready: false,
      state: null,
      drives: [],
      commands: [],
      sounds: [],
      buttonPoint: (id) => {
        const widget = this.#o.ui.runtime.describe().find((w) => w.id === id);
        return widget
          ? { x: widget.rect.x + Math.floor(widget.rect.width / 2), y: widget.rect.y + Math.floor(widget.rect.height / 2) }
          : null;
      },
    };
  }

  #syncBattleHook(): void {
    const battle = this.#screen?.battle ?? null;
    const hook = this.battleHook;
    hook.ready = battle !== null;
    hook.state = battle?.hook() ?? null;
    hook.drives = this.#battleClient.drives.slice(-KEPT_COMMANDS).map((d) => (d.mode === 'realtime' ? `realtime:${d.speed}` : d.mode));
    hook.commands = this.#battleClient.commands.slice(-KEPT_COMMANDS).map((c) => `${c.cmd.type}:${c.reply.ok ? 'ok' : 'refused'}`);
    hook.sounds = (this.#loaded?.battleSound.played ?? []).slice(-KEPT_COMMANDS);
  }

  #syncHook(): void {
    this.#syncBattleHook();
    const hook = this.hook;
    const screen = this.#screen;
    hook.ready = screen !== null && this.#o.ui.runtime !== null && this.#o.page.host.screen === screen;
    hook.holds = this.#client.holds;
    hook.lagTicks = this.#o.session.latestTick - this.#o.session.shownTick;
    hook.pendingImages = this.#loaded?.media.loading ?? 0;
    hook.commands = this.#client.commands
      .slice(-KEPT_COMMANDS)
      .map((c) => ({ type: c.cmd.type, ok: c.reply.ok, reason: c.reply.reason ?? null }));
    if (this.#client.commands.length > KEPT_COMMANDS) this.#client.commands.splice(0, this.#client.commands.length - KEPT_COMMANDS);
    hook.screen = screen?.hook() ?? null;
  }
}

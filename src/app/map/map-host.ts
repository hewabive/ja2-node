import { ClientRandom, seedFromText } from '../../audio/client-random.ts';
import type { UiLanguage } from '../../content/text/data-version.ts';
import type { ViewFrame } from '../../protocol/view.ts';
import type { LayoutModel } from '../../ui/layout/model.ts';
import { ORIGINAL_SKIN } from '../../ui/layout/types.ts';
import type { MessageBoxes } from '../../ui/message-boxes.ts';
import type { MapEntry, MapPort } from '../../ui/screens/front-end/flow.ts';
import { MAP_LAYOUTS, type MapEnvironment, type MapFlow, type MapLayout } from '../../ui/screens/map/environment.ts';
import { mapFacts } from '../../ui/screens/map/facts.ts';
import { MapScreen } from '../../ui/screens/map/map-screen.ts';
import type { MercTextBoxArt } from '../../ui/widgets/merc-text-box.ts';
import type { MessageBoxLabels, MessageBoxStyle } from '../../ui/widgets/message-box.ts';
import type { GamePage } from '../game/game-page.ts';
import { preloadLayout, type UiBoot } from '../game/ui-boot.ts';
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
  readonly gunNut: () => Promise<boolean>;
}

interface Loaded {
  readonly media: MapMediaStore;
  readonly layouts: ReadonlyMap<MapLayout, LayoutModel>;
  readonly knowledge: ClientKnowledge;
  readonly sound: MapSound;
}

export class MapHost implements MapPort {
  readonly hook: MapHook;
  readonly #o: MapHostOptions;
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
    const shadow = new URLSearchParams(location.search).get(SHADOW_HINTS_PARAM) === '1';
    this.#hints = new HintProvider({ channel: options.session, knowledge: () => this.#knowledge, now: () => performance.now(), shadow });
    this.#hintHook = createHintHook(this.#hints);
    this.#client = new SessionMapClient(options.session, this.#hints);
    this.#random = new ClientRandom(seedFromText(`${options.session.session ?? 'map'}/map`));
    this.hook = this.#createHook();
    attachMapHook(options.page.hook, this.hook);
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
    this.#knowledge = knowledge;
    this.#hints.warm();
    this.#hintHook.usable = knowledge.usable;
    this.#hintHook.ready = true;
    return knowledge;
  }

  async #load(onProgress: (done: number, total: number) => void): Promise<void> {
    const ui = this.#o.ui;
    const session = this.#o.session;
    let done = 0;
    const step = () => onProgress(++done, LOAD_STEPS);
    onProgress(done, LOAD_STEPS);
    const knowledge = this.#knowledge ?? (await this.#openKnowledge());
    step();
    const layouts = new Map<MapLayout, LayoutModel>();
    for (const name of MAP_LAYOUTS) {
      const model = await ui.layouts.load(ORIGINAL_SKIN, name);
      await preloadLayout(ui, model);
      layouts.set(name, model);
    }
    step();
    const board = await ui.source.read(BOARD_PCX);
    const images = boardImages(board);
    for (const key of Object.keys(BOARD_KEYS) as (keyof typeof BOARD_KEYS)[]) ui.assets.addRgb(BOARD_KEYS[key], images[key]);
    step();
    const [catalogue, profiles, gunNut] = await Promise.all([
      fetchItemCatalogue(this.#o.language()),
      fetchProfiles(session.session ?? ''),
      this.#o.gunNut().catch(() => false),
    ]);
    const media = new MapMediaStore({
      assets: ui.assets,
      source: ui.source,
      edt: ui.edt,
      catalogue,
      profiles,
      speech: () => null,
      gunNut,
      messages: () => session.messages,
    });
    const sound = new MapSound(ui.audio.engine, ui.source, () => session.view, session.session ?? 'map');
    await sound.load();
    step();
    this.#loaded = { media, layouts, knowledge, sound };
    this.hook.error = null;
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
    };
    this.#screen = new MapScreen(env);
    return this.#screen;
  }

  frameTime(): void {
    this.#syncHook();
  }

  frames(frames: readonly ViewFrame[]): void {
    if (this.#unknownProfile()) void this.#refreshProfiles();
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
      commands: [],
      hints: this.#hintHook,
      command: (cmd) => this.#o.session.command(cmd),
      advance: (until) => this.#o.session.advance(until),
      sectorPoint: (sector) => this.#screen?.sectorPoint(sector) ?? null,
      rowPoint: (row, column) => this.#screen?.rowPoint(row, column) ?? null,
      helicopterPoint: () => this.#screen?.heliIcon() ?? null,
    };
  }

  #syncHook(): void {
    const hook = this.hook;
    const screen = this.#screen;
    hook.ready = screen !== null && this.#o.ui.runtime !== null && this.#o.page.host.screen === screen;
    hook.holds = this.#client.holds;
    hook.commands = this.#client.commands
      .slice(-KEPT_COMMANDS)
      .map((c) => ({ type: c.cmd.type, ok: c.reply.ok, reason: c.reply.reason ?? null }));
    if (this.#client.commands.length > KEPT_COMMANDS) this.#client.commands.splice(0, this.#client.commands.length - KEPT_COMMANDS);
    hook.screen = screen?.hook() ?? null;
  }
}

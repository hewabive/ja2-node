import { ClientRandom, seedFromText } from '../../audio/client-random.ts';
import { cueOf } from '../../content/audio/cue.ts';
import type { UiLanguage } from '../../content/text/data-version.ts';
import type { CommandEnvelope } from '../../protocol/messages.ts';
import type { PlayerView, ViewFrame } from '../../protocol/view.ts';
import { WorldRenderer } from '../../render/world/world-renderer.ts';
import type { LayoutModel } from '../../ui/layout/model.ts';
import type { MessageBoxes } from '../../ui/message-boxes.ts';
import type { BattleSound } from '../../ui/screens/tactical/environment.ts';
import {
  TACTICAL_LAYOUTS,
  type TacticalEnvironment,
  type TacticalFlow,
  type TacticalLayout,
} from '../../ui/screens/tactical/environment.ts';
import { parseUiCursorTable, UI_CURSORS_TABLE_PATH, type UiCursorTable } from '../../ui/screens/tactical/input/ui-cursors.ts';
import { TacticalScreen } from '../../ui/screens/tactical/tactical-screen.ts';
import { SpeechPresenter, type SpeechSettings } from '../../ui/speech.ts';
import type { MercTextBoxArt } from '../../ui/widgets/merc-text-box.ts';
import type { GamePage, WorldLayer } from '../game/game-page.ts';
import { TimeSamples } from '../game/time-samples.ts';
import { loadLayouts, type UiBoot } from '../game/ui-boot.ts';
import { ClientKnowledge } from '../hints/client-knowledge.ts';
import { attachHintHook, createHintHook, type HintHook } from '../hints/hint-hook.ts';
import { HintProvider } from '../hints/hint-provider.ts';
import type { SessionClient } from '../net/session-client.ts';
import { fetchVfsFile, fetchVfsList, readVfsFileOrNull } from '../net/vfs.ts';
import { loadSettings, saveSettings } from '../settings.ts';
import { TacticalSound } from '../sound/tactical-sound.ts';
import { tacticalOptionsOf } from '../world/display-options.ts';
import { LightTemplates } from '../world/light-templates.ts';
import { radarPathForMap } from '../world/radar.ts';
import { SoldierAssets } from '../world/soldier-assets.ts';
import { loadSoldierFrames, type SoldierFrames } from '../world/soldier-frames.ts';
import { TacticalWorldView } from '../world/tactical-world-view.ts';
import { WorldEffects } from '../world/world-effects.ts';
import { loadSmallTiles, OverheadPicture } from './overhead-map.ts';
import { engineSpeechVoices, storedSpeechSettings } from './speech-voices.ts';
import { storyCameraTarget } from './story-camera.ts';
import { SessionTacticalClient } from './tactical-client.ts';
import { attachTacticalHook, LOAD_PHASES, type LoadPhase, type ShopSample, type TacticalHook, type TalkSample } from './tactical-hook.ts';
import { fetchItemCatalogue, fetchProfiles, type SpeechSource, TacticalMediaStore } from './tactical-media.ts';
import { TacticalWorldPresenter } from './world-presenter.ts';

const NEW_MESSAGE_SOUND = 'sounds/newbeep.wav';
const MIDVOLUME = 65;
const SHADOW_HINTS_PARAM = 'shadowHints';
const WORLD_CHECK_PARAM = 'worldCheck';
const DRIVE_PARAM = 'drive';
const MANUAL_DRIVE = 'manual';
const KEPT_COMMANDS = 64;
const OUR_TEAM = 0;
const KEPT_DIALOGUE_FRAMES = 64;

export interface TacticalHostOptions {
  readonly page: GamePage;
  readonly ui: UiBoot;
  readonly session: SessionClient;
  readonly boxes: MessageBoxes;
  readonly basicTextBox: MercTextBoxArt;
  readonly language: () => UiLanguage | null;
  readonly gunNut: () => Promise<boolean>;
}

interface Loaded {
  readonly presenter: TacticalWorldPresenter;
  readonly media: TacticalMediaStore;
  readonly layouts: ReadonlyMap<TacticalLayout, LayoutModel>;
  readonly uiCursors: UiCursorTable;
}

export class TacticalHost {
  readonly hook: TacticalHook;
  readonly #o: TacticalHostOptions;
  readonly #renderer: WorldRenderer;
  readonly #sound: TacticalSound;
  readonly #hints: HintProvider;
  readonly #hintHook: HintHook;
  readonly #client: SessionTacticalClient;
  readonly #random: ClientRandom;
  readonly #frameTimes = new TimeSamples();
  readonly #worldTimes = new TimeSamples();
  #frames: SoldierFrames | null = null;
  #knowledge: ClientKnowledge | null = null;
  #knowledgeOpening: Promise<void> | null = null;
  #loaded: Loaded | null = null;
  #loading: Promise<void> | null = null;
  #screen: TacticalScreen | null = null;
  #screenFor: Loaded | null = null;
  #loadScreen: number | null = null;
  #refreshing = false;
  readonly #requestedProfiles = new Set<number>();
  readonly #speechSettings: () => SpeechSettings;
  readonly #presenter: SpeechPresenter;
  #spoken = 0;
  #beep: ReturnType<TacticalSound['engine']['play']> | null = null;
  readonly #dialogueBeforeScreen: ViewFrame[] = [];

  constructor(options: TacticalHostOptions) {
    this.#o = options;
    const params = new URLSearchParams(location.search);
    this.#renderer = new WorldRenderer(options.page.gl, { checkPartialRedraws: params.get(WORLD_CHECK_PARAM) === '1' });
    this.#sound = new TacticalSound({ engine: options.ui.audio.engine, music: false, dataVersion: options.ui.dataVersion });
    this.#speechSettings = storedSpeechSettings(() => performance.now());
    this.#presenter = new SpeechPresenter({ voices: engineSpeechVoices(this.#sound.engine), settings: this.#speechSettings });
    this.#presenter.onLineStarted(() => {
      this.#spoken++;
    });
    const shadow = params.get(SHADOW_HINTS_PARAM) === '1';
    this.#hints = new HintProvider({ channel: options.session, knowledge: () => this.#knowledge, now: () => performance.now(), shadow });
    this.#hintHook = createHintHook(this.#hints);
    attachHintHook(this.#hintHook);
    this.#client = new SessionTacticalClient(options.session, this.#hints, params.get(DRIVE_PARAM) === MANUAL_DRIVE);
    this.#random = new ClientRandom(seedFromText(options.session.session ?? 'tactical'));
    this.hook = this.#createHook();
    attachTacticalHook(options.page.hook, this.hook);
  }

  get session(): SessionClient {
    return this.#o.session;
  }

  get loadScreen(): number | null {
    return this.#loadScreen;
  }

  get loaded(): boolean {
    const mapPath = this.#o.session.view?.mapPath ?? null;
    return this.#loaded !== null && mapPath !== null && this.#loaded.presenter.mapPath === mapPath;
  }

  get stale(): boolean {
    const mapPath = this.#o.session.view?.mapPath ?? null;
    return this.#loaded !== null && mapPath !== null && this.#loaded.presenter.mapPath !== mapPath;
  }

  #openKnowledgeAfterNextFrame(): void {
    requestAnimationFrame(() => setTimeout(() => this.#openKnowledgeOnce(), 0));
  }

  #openKnowledgeOnce(): void {
    this.#knowledgeOpening ??= this.#openKnowledge().then((knowledge) => {
      this.#knowledge = knowledge;
    });
  }

  async #openKnowledge(): Promise<ClientKnowledge | null> {
    const identity = this.#o.session.identity;
    if (!identity) return null;
    try {
      const knowledge = await ClientKnowledge.open(this.#o.ui.source, identity);
      const mapPath = this.#o.session.latestView?.mapPath;
      if (mapPath) await knowledge.worlds.ensure(mapPath);
      this.#hints.warm();
      this.#hintHook.usable = knowledge.usable;
      this.#hintHook.error = mapPath ? (knowledge.worlds.failures.get(mapPath) ?? null) : null;
      this.#hintHook.ready = true;
      return knowledge;
    } catch (err) {
      this.#hintHook.error = (err as Error).message;
      this.#hintHook.ready = true;
      return null;
    }
  }

  load(onProgress: (done: number, total: number) => void): Promise<void> {
    this.#loading ??= this.#load(onProgress).finally(() => {
      this.#loading = null;
    });
    return this.#loading;
  }

  async #load(onProgress: (done: number, total: number) => void): Promise<void> {
    const session = this.#o.session;
    const mapPath = session.view?.mapPath;
    if (!mapPath) throw new Error('no sector is loaded in this session');
    const started = performance.now();
    const phases: Partial<Record<LoadPhase, number>> = {};
    let done = 0;
    const timed =
      (phase: LoadPhase) =>
      <T>(value: T): T => {
        phases[phase] = Math.round(performance.now() - started);
        return value;
      };
    const reached =
      (phase: LoadPhase) =>
      <T>(value: T): T => {
        onProgress(++done, LOAD_PHASES.length);
        return timed(phase)(value);
      };
    onProgress(done, LOAD_PHASES.length);
    const listing = await fetchVfsList();
    const available = new Set(listing.map((f) => f.path));
    const assets = SoldierAssets.load(available).then(reached('assets'));
    const presentation = Promise.all([
      assets,
      loadSoldierFrames({ available, read: fetchVfsFile, serverScripts: session.rules?.scripts ?? null, preferStubScripts: false }),
      assets.then((a) => WorldEffects.load(fetchVfsFile, available, a.palettes)),
      LightTemplates.load(listing, fetchVfsFile),
    ]).then(reached('presentation'));
    const preparing = TacticalWorldView.prepare(mapPath, available).then(timed('map'));
    const worldView = Promise.all([presentation, preparing]).then(([[soldierAssets, frames, effects, lightTemplates], prepared]) => {
      this.#frames = frames;
      const presented = { soldiers: TacticalWorldView.soldierScene(soldierAssets), frames, effects, lightTemplates };
      return reached('world')(TacticalWorldView.create(this.#renderer, prepared, presented));
    });
    void Promise.all([this.#loadSound(available, assets), preparing])
      .then(([, p]) => this.#sound.setWorld(p.world))
      .then(timed('sound'), () => undefined);
    const media = Promise.all([assets, this.#mediaStore()])
      .then(([a, store]) => this.#preloadMedia(store, a, mapPath, available))
      .then(reached('media'));
    const [soldierAssets, world, layouts, loadedMedia, uiCursors] = await Promise.all([
      assets,
      worldView,
      loadLayouts(this.#o.ui, TACTICAL_LAYOUTS).then(reached('layouts')),
      media,
      this.#loadUiCursors(),
    ]);
    const presenter = new TacticalWorldPresenter(
      world,
      this.#renderer,
      this.#o.ui.assets,
      soldierAssets.tables,
      {
        view: () => session.view,
        shownTick: () => session.shownTick,
        bullets: () => session.bullets,
        clockMs: () => this.#o.ui.runtime.clock.ja2Now,
        options: () => tacticalOptionsOf(loadSettings()),
      },
      loadedMedia.radarImage,
    );
    const geometry = this.#o.page.geometry();
    presenter.resize(geometry.width, geometry.height);
    const own = session.soldiers.find((s) => s.team === OUR_TEAM);
    presenter.centerOn(own?.gridNo ?? world.world.map.info.centerGridNo);
    presenter.setOverheadLoader(async () => {
      const small = await loadSmallTiles(world.world, available, fetchVfsFile);
      return OverheadPicture.compose(`overhead:${mapPath}`, world.world, small, {
        addRgb: (key, width, height, pixels) => this.#o.ui.assets.addRgb(key, { kind: 'rgb', width, height, flags: 0, pixels }),
      });
    });
    this.#loaded = { presenter, media: loadedMedia.store, layouts, uiCursors };
    this.#openKnowledgeAfterNextFrame();
    this.hook.map = mapPath;
    this.hook.error = null;
    this.hook.loadMs = { total: Math.round(performance.now() - started), sincePageStart: Math.round(performance.now()), phases };
  }

  async #loadSound(available: ReadonlySet<string>, assets: Promise<SoldierAssets>): Promise<void> {
    const session = this.#o.session;
    await this.#sound.load(
      available,
      assets.then((a) => a.tables),
      session.session ?? 'local',
    );
    this.#sound.director?.reset(session.soldiers);
    this.#sound.director?.setSpeechOwner({
      isTalking: (soldier) => {
        const speaking = this.#presenter.speaking;
        return speaking !== null && speaking.speaker === soldier && speaking.playing;
      },
      cut: (soldier) => this.#presenter.cutSpeaker(soldier),
    });
  }

  async #mediaStore(): Promise<TacticalMediaStore> {
    const [catalogue, profiles, gunNut] = await Promise.all([
      fetchItemCatalogue(this.#o.language()),
      fetchProfiles(this.#o.session.session ?? ''),
      this.#o.gunNut().catch(() => false),
    ]);
    return new TacticalMediaStore(this.#o.ui.assets, catalogue, profiles, () => this.#speech(), gunNut);
  }

  async #preloadMedia(
    store: TacticalMediaStore,
    assets: SoldierAssets,
    mapPath: string,
    available: ReadonlySet<string>,
  ): Promise<{ readonly store: TacticalMediaStore; readonly radarImage: string | null }> {
    const session = this.#o.session;
    const radarPath = radarPathForMap(mapPath);
    const radarImage = available.has(radarPath) ? radarPath : null;
    await Promise.all([
      ...(radarImage ? [store.preload([radarImage])] : []),
      ...session.soldiers.flatMap((s) => assets.preload(s)),
      store.preload(this.#inventoryGraphics(session.view, store)),
    ]);
    return { store, radarImage };
  }

  async #loadUiCursors(): Promise<ReturnType<typeof parseUiCursorTable>> {
    return parseUiCursorTable(JSON.parse(new TextDecoder().decode(await fetchVfsFile(UI_CURSORS_TABLE_PATH))));
  }

  #inventoryGraphics(view: PlayerView | null, media: TacticalMediaStore): string[] {
    const paths = new Set<string>();
    for (const s of view?.soldiers ?? []) {
      if (s.team !== OUR_TEAM) continue;
      for (const entry of s.inventory ?? []) {
        const item = media.item(entry.item);
        if (item) paths.add(item.inventoryGraphics.small.path);
        for (const attachment of entry.attachments ?? []) {
          const a = media.item(attachment.item);
          if (a) paths.add(a.inventoryGraphics.small.path);
        }
      }
    }
    return [...paths];
  }

  #speech(): SpeechSource | null {
    return this.#sound.director;
  }

  screen(flow: TacticalFlow): TacticalScreen {
    const loaded = this.#loaded;
    if (!loaded) throw new Error('the tactical sector is not loaded');
    this.#o.page.world = this.#worldLayer();
    const target = storyCameraTarget(this.#o.session.view);
    if (target !== null) loaded.presenter.centerOn(target);
    if (this.#screen && this.#screenFor === loaded) return this.#screen;
    const ui = this.#o.ui;
    const env: TacticalEnvironment = {
      runtime: ui.runtime,
      text: ui.text,
      layout: (name) => {
        const model = loaded.layouts.get(name);
        if (!model) throw new Error(`tactical layout ${name} is not loaded`);
        return model;
      },
      boxes: this.#o.boxes,
      basicTextBox: this.#o.basicTextBox,
      client: this.#client,
      world: loaded.presenter,
      media: loaded.media,
      flow,
      sounds: {
        attention: (soldier) => this.#sound.director?.attention(soldier),
        newMessageBeep: () => this.#newMessageBeep(),
      },
      random: (range) => this.#random.int(range),
      metric: () => loadSettings().display.useMetricSystem,
      speech: this.#presenter,
      speechSettings: this.#speechSettings,
      rpcSpeechPrefixed: this.#sound.rpcSpeechPrefixed,
      prepareText: (file) => this.#prepareText(file),
      uiCursors: loaded.uiCursors,
      display: () => loadSettings().display,
      setDisplay: (change) => {
        const settings = loadSettings();
        saveSettings({ ...settings, display: { ...settings.display, ...change } });
      },
      battleSound: (soldier, sound) => this.#battleSound(soldier, sound),
    };
    this.#screen = new TacticalScreen(env);
    this.#screenFor = loaded;
    this.#screen.dialogue.frames(this.#dialogueBeforeScreen.splice(0));
    return this.#screen;
  }

  #battleSound(soldier: number, sound: BattleSound): void {
    const director = this.#sound.director;
    if (!director) return;
    if (sound === 'ok') director.confirm(soldier);
    else if (sound === 'attention') director.attention(soldier);
    else if (sound === 'curse') director.curse(soldier);
    else director.locked(soldier);
  }

  #newMessageBeep(): void {
    if (this.#beep?.active) return;
    this.#beep = this.#sound.engine.play(cueOf(NEW_MESSAGE_SOUND, 'fixed', MIDVOLUME));
  }

  #worldLayer(): WorldLayer {
    return {
      render: (width, height) => {
        const loaded = this.#loaded;
        if (!loaded || !this.loaded) return null;
        const started = performance.now();
        loaded.presenter.resize(width, height);
        const picture = loaded.presenter.render();
        this.#worldTimes.add(performance.now() - started);
        this.#updateSound(loaded.presenter);
        return picture;
      },
      present: (target, height) => this.#loaded?.presenter.present(target, height),
    };
  }

  #updateSound(presenter: TacticalWorldPresenter): void {
    const session = this.#o.session;
    this.#sound.update({
      camera: presenter.camera,
      width: presenter.viewport.width,
      height: presenter.viewport.height,
      selected: this.#screen?.selected ?? null,
      inCombat: session.combat !== null,
      clock: session.clock,
    });
  }

  frameTime(ms: number): void {
    this.#frameTimes.add(ms);
    this.#syncHook();
  }

  frames(frames: readonly ViewFrame[]): void {
    this.#sound.frames(frames);
    for (const frame of frames) {
      this.#loaded?.presenter.aiTurns.observe(frame.events ?? []);
      this.#loaded?.presenter.observe(frame.events ?? []);
    }
    if (this.#unknownProfile(frames)) void this.#refreshProfiles();
    for (const frame of frames)
      for (const event of frame.events ?? []) if (event.type === 'sectorLoaded' && event.loadScreen) this.#loadScreen = event.loadScreen.id;
    if (this.#screen) this.#screen.frames(frames);
    else this.#keepDialogue(frames);
  }

  #keepDialogue(frames: readonly ViewFrame[]): void {
    this.#dialogueBeforeScreen.push(...frames.filter((f) => f.conversation !== undefined || (f.events?.length ?? 0) > 0));
    const excess = this.#dialogueBeforeScreen.length - KEPT_DIALOGUE_FRAMES;
    if (excess > 0) this.#dialogueBeforeScreen.splice(0, excess);
  }

  received(frames: readonly ViewFrame[]): void {
    for (const frame of frames) this.#frames?.observe(frame.events ?? []);
    this.#loaded?.presenter.observeEffects(frames.flatMap((f) => f.effects ?? []));
  }

  welcome(): void {
    this.#sound.director?.reset(this.#o.session.soldiers);
    this.#frames?.reset();
    this.#loaded?.presenter.aiTurns.reset();
    this.#loaded?.presenter.resetEffects();
  }

  #unknownProfile(frames: readonly ViewFrame[]): boolean {
    const media = this.#loaded?.media;
    if (!media || this.#refreshing) return false;
    const unknown = frames.flatMap((f) =>
      f.changed.flatMap((s) => (s.team === OUR_TEAM && s.profile !== undefined && !media.profile(s.profile) ? [s.profile] : [])),
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
    this.#o.page.world = null;
    this.#screen = null;
    this.#screenFor = null;
    this.#renderer.dispose();
  }

  #command(cmd: CommandEnvelope): Promise<unknown> {
    return this.#o.session.command(cmd);
  }

  #createHook(): TacticalHook {
    const frameTimes = this.#frameTimes;
    const worldTimes = this.#worldTimes;
    const renderer = this.#renderer;
    return {
      ready: false,
      loadMs: null,
      error: null,
      map: null,
      panel: null,
      selected: null,
      smMerc: null,
      squad: 0,
      slots: [],
      radarShown: true,
      paused: false,
      driver: 'manual',
      faces: [],
      messages: [],
      feedback: null,
      cursorItem: null,
      descriptionOpen: false,
      descriptionItem: null,
      pickupOpen: false,
      stackOpen: false,
      keyRingOpen: false,
      commands: [],
      camera: null,
      drawCalls: 0,
      drawnSoldiers: 0,
      drawnBullets: 0,
      drawnImpacts: 0,
      pendingImages: 0,
      enemyBar: { counter: 0, max: 0 },
      topMessage: null,
      talk: { open: false, profile: null, busy: false, line: null, queued: 0, spoken: 0, textBox: null, facePopup: false, civQuote: null },
      shop: {
        open: false,
        dealer: null,
        page: 0,
        pages: 0,
        dealerBoxes: [],
        doa: [],
        poa: [],
        totals: null,
        transactionEnabled: false,
        doneEnabled: false,
        lastQuote: null,
        subtitle: null,
        held: null,
      },
      uiMode: null,
      uiCursor: null,
      uiLock: null,
      markers: [],
      apNumber: null,
      movementMenuOpen: false,
      doorMenuOpen: false,
      exitDialogOpen: false,
      overheadOpen: false,
      get frameMs() {
        return frameTimes.summary();
      },
      get worldMs() {
        return worldTimes.summary();
      },
      get worldChecks() {
        return renderer.checks;
      },
      command: (cmd) => this.#command(cmd),
      advance: (until) => this.#o.session.advance(until),
      inventory: (soldier) => this.#o.session.soldiers.find((s) => s.id === soldier)?.inventory ?? [],
      soldiers: () => this.#o.session.soldiers.map((s) => ({ id: s.id, team: s.team, gridNo: s.gridNo, level: s.level })),
      items: () => this.#o.session.items,
      soldierScreen: (soldier) => this.#loaded?.presenter.soldierTrueScreenPosition(soldier) ?? null,
      gridNoScreen: (gridNo) => this.#loaded?.presenter.gridNoPickPoint(gridNo) ?? null,
      gridNoAt: (x, y) => this.#loaded?.presenter.gridNoAt(x, y) ?? null,
      soldierAt: (x, y) => this.#loaded?.presenter.soldierAt(x, y) ?? null,
      centerOn: (gridNo) => this.#loaded?.presenter.centerOn(gridNo),
      resetTimes: () => {
        this.#frameTimes.reset();
        this.#worldTimes.reset();
      },
    };
  }

  #prepareText(file: string): void {
    const edt = this.#o.ui.edt;
    if (edt.has(file)) return;
    void readVfsFileOrNull(file).then((bytes) => {
      if (bytes && !edt.has(file)) edt.add(file, bytes);
    });
  }

  #shopSample(screen: TacticalScreen): ShopSample {
    const panel = screen.dialogue.shop;
    const model = panel.model;
    const shop = this.#o.session.view?.shop ?? null;
    const enable = model.enableState();
    const held = model.held;
    return {
      open: panel.open,
      dealer: panel.open ? panel.dealer : null,
      page: model.page,
      pages: model.pages,
      dealerBoxes: (shop?.boxes ?? []).map((b, k) => ({ item: b.item, count: model.left(k) })),
      doa: model.dealerOffer.map((s) => (s ? { item: s.item, count: s.count } : null)),
      poa: model.playerOffer.map((s) => (s ? { item: s.item, count: 1 } : null)),
      totals: model.quote?.totals ?? null,
      transactionEnabled: enable.transaction,
      doneEnabled: enable.done,
      lastQuote: model.lastQuote,
      subtitle: panel.subtitleText,
      held: held ? (held.kind === 'pocket' ? held.item : held.offer.item) : null,
    };
  }

  #talkSample(screen: TacticalScreen): TalkSample {
    const presenter = this.#presenter;
    const current = presenter.current;
    const dialogue = screen.dialogue;
    return {
      open: dialogue.talk.open,
      profile: dialogue.talk.profile,
      busy: dialogue.talk.busy,
      line: current
        ? {
            surface: current.line.surface,
            profile: current.line.profile,
            soldier: current.line.soldier,
            text: current.line.text,
            phase: current.phase,
            subtitles: current.subtitles,
          }
        : null,
      queued: presenter.queued.length,
      spoken: this.#spoken,
      textBox: dialogue.surfaces.textBoxText,
      facePopup: dialogue.surfaces.facePopupShown,
      civQuote: dialogue.surfaces.civQuoteText,
    };
  }

  #syncHook(): void {
    const hook = this.hook;
    const screen = this.#screen;
    const presenter = this.#loaded?.presenter ?? null;
    hook.ready = screen !== null && this.loaded;
    hook.paused = this.#client.paused;
    hook.driver = this.#client.driver;
    hook.commands = this.#client.commands
      .slice(-KEPT_COMMANDS)
      .map((c) => ({ type: c.cmd.type, ok: c.reply.ok, reason: c.reply.reason ?? null }));
    if (this.#client.commands.length > KEPT_COMMANDS) this.#client.commands.splice(0, this.#client.commands.length - KEPT_COMMANDS);
    hook.camera = presenter?.camera ?? null;
    hook.drawCalls = presenter?.stats?.drawCalls ?? 0;
    hook.drawnSoldiers = presenter?.drawnSoldiers ?? 0;
    hook.drawnBullets = presenter?.drawnBullets ?? 0;
    hook.drawnImpacts = presenter?.drawnImpacts ?? 0;
    hook.pendingImages = this.#loaded?.media.loading ?? 0;
    if (!screen) return;
    hook.panel = screen.panel;
    hook.selected = screen.selected;
    hook.smMerc = screen.smMerc;
    hook.squad = screen.currentSquad;
    hook.slots = screen.teamSlots;
    hook.radarShown = screen.radarShown;
    hook.messages = screen.messageLines;
    hook.feedback = screen.feedbackText;
    hook.enemyBar = screen.enemyBar;
    hook.topMessage = this.#o.session.combat?.topMessage?.kind ?? null;
    hook.talk = this.#talkSample(screen);
    hook.shop = this.#shopSample(screen);
    hook.cursorItem = screen.inventory.cursor?.item ?? null;
    hook.descriptionOpen = screen.description.open;
    hook.descriptionItem = screen.description.item;
    hook.pickupOpen = screen.pickup.open;
    hook.stackOpen = screen.stack.open;
    hook.keyRingOpen = screen.keyRing.open;
    const controls = screen.controls;
    hook.uiMode = controls.input.mode;
    hook.uiCursor = controls.input.uiCursor;
    hook.uiLock = controls.input.lock;
    hook.markers = controls.input.markers().map((m) => `${m.gridNo}:${m.tile}`);
    hook.apNumber = controls.input.apNumber()?.value ?? null;
    hook.movementMenuOpen = controls.movementMenu.open;
    hook.doorMenuOpen = controls.doorMenu.open;
    hook.exitDialogOpen = controls.exitDialog.open;
    hook.overheadOpen = controls.overhead.open;
    hook.faces = this.#o.session.soldiers
      .filter((s) => s.team === OUR_TEAM)
      .flatMap((s) => {
        const face = screen.faceOf(s.id);
        return face ? [{ id: s.id, path: face.record.path, eye: face.eyeFrame, mouth: face.mouthFrame }] : [];
      });
  }
}

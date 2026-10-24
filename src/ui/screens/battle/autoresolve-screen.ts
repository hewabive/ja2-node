// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-24. See LICENSE (SFI-SCLA).
// @src src/game/Strategic/Auto_Resolve.cc AutoResolveScreenHandle (the map screen shaded and kept as the background),
// @src DoTransitionFromPreBattleInterfaceToAutoResolve (laptop power up, the panel growing from 0, 0 over 1 s with the
// @src cubic easing), RenderAutoResolve (the interface buffer, the cells, the encounter header, the sector, "%d vs. %d"
// @src coloured by the ratio, the surrender offer, the result in indent.sti, the elapsed time), CreateAutoResolveInterface
// @src (the blanket at MSYS_PRIORITY_HIGH - 1, autobtns.sti, the merc cell regions), DepressAutoButton, PauseButtonCallback,
// @src PlayButtonCallback, FastButtonCallback, FinishButtonCallback (AUTORESOLVE_FINISHFX and the sounds off),
// @src RetreatButtonCallback, MercCellMouseMoveCallback, MercCellMouseClickCallback, BandageButtonCallback,
// @src AutoBandageMercs (the STR_LATE_13 or STR_LATE_10 box), DetermineBandageButtonState, DoneButtonCallback,
// @src SetupDoneInterface, SetupSurrenderInterface, HideSurrenderInterface (after a refusal every button stays hidden),
// @src AcceptSurrenderCallback, RejectSurrenderCallback, HandleAutoResolveInput (Space keeps the speed, Alt+X).
// @src See docs/28 §8.2, docs/19 §5.2.

import { DEFAULT_SHADOW, FontColor } from '../../../content/text/font-colors.ts';
import type { DriverMode } from '../../../protocol/messages.ts';
import type { AutoresolveView, PromptView, StrategicView, ViewFrame } from '../../../protocol/view.ts';
import { type DrawItem, type DrawList, rgb } from '../../draw-list.ts';
import { isPointerEvent, type UiInputEvent } from '../../input/events.ts';
import { MouseReason, Priority } from '../../input/mouse.ts';
import type { MouseRegion } from '../../input/regions.ts';
import { type ControllerContract, ViewModelController } from '../../layout/controller.ts';
import type { LayoutModel } from '../../layout/model.ts';
import { type CustomRenderer, LayoutView } from '../../layout/view.ts';
import type { Screen } from '../../screen.ts';
import type { BitmapFont } from '../../text/bitmap-font.ts';
import { FontName } from '../../text/fonts.ts';
import { stringPixLength } from '../../text/measure.ts';
import { fontColors, mprint } from '../../text/print.ts';
import { printf } from '../../text/printf.ts';
import { displayWrappedString, TextFlag } from '../../text/wrap.ts';
import { UiScreenKind } from '../../widgets/button-sounds.ts';
import { portraitPath } from '../../widgets/portrait.ts';
import type { WidgetInfo } from '../../widgets/widget-info.ts';
import {
  cellFace,
  cellStatus,
  conscious,
  type DisplayCell,
  drawCellBars,
  flashAfterRender,
  isCreatureCell,
  RED_FACE_SHADE,
} from './autoresolve-cells.ts';
import {
  ArButton,
  type ArGeometry,
  ArPiece,
  autoresolveGeometry,
  buttonPositions,
  CELL_HEIGHT,
  CELL_WIDTH,
  easeInOutCubic,
  openingRect,
  type PlacedPiece,
  type Point,
  panelPieces,
  piecesTouching,
  type Rect,
  type TextAnchors,
  textAnchors,
  timeModifierPercentage,
} from './autoresolve-geometry.ts';
import { type ArEvent, ArPlayback, type DisplayState, type PlaybackSpeed, speedPercent } from './autoresolve-playback.ts';
import { autoresolveSounds, soundMemory } from './autoresolve-sounds.ts';
import { type BattleEnvironment, BattleLayout } from './environment.ts';
import { STRATEGIC, StrategicString } from './pre-battle-text.ts';

export const AUTORESOLVE_SCREEN = 'autoresolve';
const OWNER = 'autoresolve';
const SNAPSHOT = 'autoresolve.opening';
const OPENING_MS = 1000;
const FULL_SPEED = 100;
const MANUAL: DriverMode = { mode: 'manual' };
const LATE = 'gzLateLocalizedString';
const STR_LATE_08 = 7;
const STR_LATE_09 = 8;
const STR_LATE_10 = 9;
const STR_LATE_11 = 10;
const STR_LATE_12 = 11;
const STR_LATE_13 = 12;
const STR_LATE_17 = 16;
const TIME_STRINGS = 'gsTimeStrings';
const TIME_MINUTES = 1;
const TIME_SECONDS = 2;
const SECONDS_PER_MINUTE = 60;
const MERC_FACE_DX = 3;
const OTHER_FACE_DX = 9;
const FACE_DY = 3;
const FACE_WIDTH = 30;
const FACE_HEIGHT = 26;
const BAR_WELL = [36, 2, 44, 30] as const;
const STATUS_RESTORE = [2, 32, 46, 10] as const;
const STATUS_DX = 25;
const STATUS_DY = 33;
const RETREAT_TEXT_DY = 12;
const OKLIFE = 15;
const WHITE = rgb(255, 255, 255);
const BLACK = rgb(0, 0, 0);
const GOOD_RATIO = [3, 2] as const;
const BAD_RATIO = [2, 3] as const;
const BANDAGE_HELP: Readonly<Record<string, number>> = { nobodyWounded: STR_LATE_11, noDoctor: STR_LATE_08, noKit: STR_LATE_09 };
const RESULT_TEXT: Readonly<Record<string, number>> = {
  victory: StrategicString.AR_OVER_VICTORY,
  defeat: StrategicString.AR_OVER_DEFEAT,
  surrendered: StrategicString.AR_OVER_SURRENDERED,
  captured: StrategicString.AR_OVER_CAPTURED,
  retreat: StrategicString.AR_OVER_RETREATED,
};
const RESULT_COLOUR: Readonly<Record<string, number>> = {
  victory: FontColor.LTGREEN,
  defeat: FontColor.RED,
  surrendered: FontColor.RED,
  captured: FontColor.RED,
  retreat: FontColor.YELLOW,
};
const ENCOUNTER_HEADERS: Readonly<Record<string, number>> = {
  enemyEncounter: StrategicString.AR_ENCOUNTER_HEADER,
  enemyInvasion: StrategicString.AR_DEFEND_HEADER,
  creatureAttack: StrategicString.AR_DEFEND_HEADER,
};

export const AUTORESOLVE_CONTRACT: ControllerContract = {
  id: AUTORESOLVE_SCREEN,
  actions: {
    pause: {},
    play: {},
    fast: {},
    finish: {},
    retreat: {},
    bandage: {},
    done: {},
    accept: {},
    reject: {},
    space: {},
    exitGame: {},
  },
  bindings: { buttons: 'object' },
};

interface ButtonModel {
  readonly x: number;
  readonly y: number;
  visible: boolean;
  enabled: boolean;
  clicked: boolean;
  help: string;
}

type Interface = 'battle' | 'surrender' | 'hidden' | 'done';
type SpeedButton = typeof ArButton.PAUSE | typeof ArButton.PLAY | typeof ArButton.FAST | typeof ArButton.FINISH;

export interface AutoresolveHook {
  readonly opening: boolean;
  readonly status: string;
  readonly speed: PlaybackSpeed;
  readonly paused: boolean;
  readonly interface: Interface;
  readonly pending: number;
  readonly cells: readonly { readonly key: string; readonly state: string; readonly rect: Rect }[];
  readonly result: string | null;
  readonly elapsed: string | null;
  readonly ratio: string;
}

export interface AutoresolveScreenOptions {
  readonly backdrop: readonly DrawItem[];
  readonly strategic: () => StrategicView | undefined;
  readonly sectorName: (label: string) => string;
  readonly finished: () => void;
}

export class AutoresolveScreen implements Screen {
  readonly id = AUTORESOLVE_SCREEN;
  readonly soundScreen = UiScreenKind.OTHER;
  readonly rendersTooltips = true;
  readonly #env: BattleEnvironment;
  readonly #options: AutoresolveScreenOptions;
  readonly #model: LayoutModel;
  readonly #playback: ArPlayback;
  readonly #geometry: ArGeometry;
  readonly #anchors: TextAnchors;
  readonly #timeModifier: number;
  readonly #pieces: readonly PlacedPiece[];
  readonly #controller: ViewModelController;
  readonly #view: LayoutView;
  readonly #buttons: Record<ArButton, ButtonModel>;
  readonly #hover = new Set<string>();
  readonly #ordered = new Set<number>();
  readonly #regions: MouseRegion[] = [];
  readonly #soundMemory = soundMemory();
  #openingBlock: MouseRegion | null = null;
  #openedAt = 0;
  #opening = true;
  #lastNow = 0;
  #speed: PlaybackSpeed = 'play';
  #pressed: SpeedButton = ArButton.PLAY;
  #sound = true;
  #interface: Interface = 'battle';
  #answered = new Set<string>();
  #driven = '';
  #finishing = false;
  #finished = false;

  constructor(env: BattleEnvironment, view: AutoresolveView, prompt: PromptView | null, options: AutoresolveScreenOptions) {
    this.#env = env;
    this.#options = options;
    this.#model = env.layout(BattleLayout.AUTORESOLVE);
    this.#playback = new ArPlayback(view, prompt);
    const sizes = teamSizes(view);
    const g = env.runtime.geometry();
    this.#geometry = autoresolveGeometry(sizes, g);
    this.#anchors = textAnchors(this.#geometry, g.stdY);
    this.#timeModifier = timeModifierPercentage(sizes);
    this.#pieces = panelPieces(this.#geometry);
    const positions = buttonPositions(this.#geometry, g.height);
    this.#buttons = Object.fromEntries(
      (Object.values(ArButton) as ArButton[]).map((b) => [b, { ...positions[b], visible: false, enabled: true, clicked: false, help: '' }]),
    ) as Record<ArButton, ButtonModel>;
    this.#controller = new ViewModelController(AUTORESOLVE_CONTRACT, { buttons: this.#buttons }, this.#handlers());
    this.#view = new LayoutView({
      model: this.#model,
      controller: this.#controller,
      services: env.runtime,
      sliders: env.runtime.sliders,
      text: env.text,
      custom: this.#renderers(),
      owner: OWNER,
    });
  }

  get geometry(): ArGeometry {
    return this.#geometry;
  }

  get state(): DisplayState {
    return this.#playback.state;
  }

  #handlers() {
    return {
      pause: () => this.#depress(ArButton.PAUSE),
      play: () => this.#setSpeed(ArButton.PLAY, 'play'),
      fast: () => this.#setSpeed(ArButton.FAST, 'fast'),
      finish: () => this.#finish(),
      retreat: () => void this.#retreatAll(),
      bandage: () => void this.#bandage(),
      done: () => void this.#answerDone('done'),
      accept: () => void this.#answerSurrender('accept'),
      reject: () => void this.#answerSurrender('reject'),
      space: () => this.#depress(this.#pressed === ArButton.PAUSE ? ArButton.PLAY : ArButton.PAUSE),
      exitGame: () => this.#env.flow.exitGame(),
    };
  }

  enter(): void {
    const now = this.#env.runtime.clock.ja2Now;
    this.#openedAt = now;
    this.#lastNow = now;
    this.#opening = true;
    this.#view.build();
    this.#defineCellRegions();
    this.#openingBlock = this.#env.runtime.regions.define({
      x1: 0,
      y1: 0,
      x2: 0xffff,
      y2: 0xffff,
      priority: Priority.HIGHEST,
      cursor: 0,
      owner: OWNER,
      id: 'autoresolveOpening',
    });
    this.#env.client.drive(MANUAL);
    this.#env.sounds.powerUp();
    if (this.#env.instantOpenings) this.#opened();
  }

  exit(): void {
    this.#env.client.drive(MANUAL);
    this.#view.dispose();
    for (const r of this.#regions) r.remove();
    this.#regions.length = 0;
    this.#env.runtime.regions.removeOwner(OWNER);
  }

  frames(frames: readonly ViewFrame[]): void {
    for (const frame of frames) this.#playback.push(frame);
  }

  #defineCellRegions(): void {
    const mercs = this.#playback.state.cells.filter((c) => c.side === 'merc');
    for (const cell of mercs) {
      const at = this.#geometry.mercCells[cell.index];
      if (!at) continue;
      const key = `merc:${cell.index}`;
      this.#regions.push(
        this.#env.runtime.regions.define({
          x1: at.x,
          y1: at.y,
          x2: at.x + CELL_WIDTH,
          y2: at.y + CELL_HEIGHT,
          priority: Priority.HIGH,
          cursor: 0,
          owner: OWNER,
          id: `arCell.${key}`,
          onMove: (r, reason) => this.#cellHover(key, r, reason),
          onButton: (_r, reason) => {
            if (reason & MouseReason.LBUTTON_UP) void this.#retreatOne(cell.index);
          },
        }),
      );
    }
  }

  #cellHover(key: string, region: MouseRegion, _reason: number): void {
    if (region.inArea && this.#interface !== 'surrender') this.#hover.add(key);
    else this.#hover.delete(key);
  }

  #depress(button: SpeedButton): void {
    if (this.#interface === 'done') return;
    this.#pressed = button;
    this.#applySpeed();
  }

  #setSpeed(button: SpeedButton, speed: PlaybackSpeed): void {
    this.#speed = speed;
    this.#depress(button);
  }

  #finish(): void {
    this.#speed = 'finish';
    this.#sound = false;
    this.#env.sounds.play({ kind: 'effect', name: 'AUTORESOLVE_FINISHFX', loud: true });
    this.#depress(ArButton.FINISH);
  }

  get #paused(): boolean {
    return this.#pressed === ArButton.PAUSE;
  }

  #battleRunning(): boolean {
    const prompt = this.#env.client.view?.prompt;
    return (
      !this.#opening &&
      !this.#paused &&
      this.#interface !== 'done' &&
      !prompt &&
      this.#env.client.view?.autoresolve?.status === 'inProgress'
    );
  }

  #applySpeed(): void {
    if (!this.#battleRunning()) {
      this.#drive('manual', MANUAL);
      return;
    }
    if (this.#speed === 'finish') {
      if (this.#finishing) return;
      this.#finishing = true;
      this.#drive('manual', MANUAL);
      void this.#env.client.advance({ idle: true }).finally(() => {
        this.#finishing = false;
      });
      return;
    }
    const speed = speedPercent(this.#speed, this.#timeModifier) / FULL_SPEED;
    this.#drive(`realtime:${speed}`, { mode: 'realtime', speed });
  }

  #drive(key: string, driver: DriverMode): void {
    if (this.#driven === key) return;
    this.#driven = key;
    this.#env.client.drive(driver);
  }

  async #retreatAll(): Promise<void> {
    const reply = await this.#env.client.command({ type: 'autoresolveRetreat' });
    if (!reply.ok) return;
    for (const c of this.#playback.state.cells)
      if (c.side === 'merc' && c.soldier !== undefined && !this.#isRobot(c.soldier)) this.#ordered.add(c.soldier);
  }

  async #retreatOne(index: number): Promise<void> {
    if (this.#interface !== 'battle' && this.#interface !== 'hidden') return;
    const cell = this.#playback.state.cells.find((c) => c.side === 'merc' && c.index === index);
    if (!cell || cell.soldier === undefined || cell.state === 'retreating' || cell.state === 'retreated') return;
    const reply = await this.#env.client.command({ type: 'autoresolveRetreat', soldier: cell.soldier });
    if (reply.ok) this.#ordered.add(cell.soldier);
  }

  #isRobot(soldier: number): boolean {
    return this.#options.strategic()?.mercs.find((m) => m.id === soldier)?.controlled !== undefined;
  }

  async #answerSurrender(choice: 'accept' | 'reject'): Promise<void> {
    const prompt = this.#playback.state.prompt;
    if (prompt?.kind !== 'surrender' || this.#answered.has(prompt.id)) return;
    this.#answered.add(prompt.id);
    const reply = await this.#env.client.command({ type: 'answer', prompt: prompt.id, choice });
    if (!reply.ok) return;
    this.#interface = choice === 'reject' ? 'hidden' : 'done';
    this.#applySpeed();
  }

  async #answerDone(choice: 'bandage' | 'done'): Promise<void> {
    const prompt = this.#playback.state.prompt;
    if (prompt?.kind !== 'autoresolveDone' || this.#answered.has(prompt.id)) return;
    this.#answered.add(prompt.id);
    const reply = await this.#env.client.command({ type: 'answer', prompt: prompt.id, choice });
    if (choice !== 'bandage' || !reply.ok) return;
    const bandaged = (reply.data as { bandaged?: string } | undefined)?.bandaged;
    await this.#env.boxes.alert(this.#late(bandaged === 'complete' ? STR_LATE_13 : STR_LATE_10));
  }

  #bandage(): Promise<void> {
    return this.#answerDone('bandage');
  }

  #late(index: number): string {
    return this.#env.text.string(LATE, index) ?? '';
  }

  update(now: number): void {
    this.#env.client.showLatest();
    const elapsed = Math.max(0, now - this.#lastNow);
    this.#lastNow = now;
    if (this.#opening && now - this.#openedAt >= OPENING_MS) this.#opened();
    if (!this.#opening && (!this.#paused || this.#speed === 'finish')) this.#advance(elapsed);
    this.#syncInterface();
    this.#syncOrders();
    this.#applySpeed();
    this.#syncButtons();
    this.#view.update();
    this.#checkFinished();
  }

  #opened(): void {
    this.#opening = false;
    this.#openingBlock?.remove();
    this.#openingBlock = null;
  }

  #advance(elapsed: number): void {
    const release = (e: ArEvent) => this.#release(e);
    if (this.#speed === 'finish') this.#playback.flush(release);
    else this.#playback.advance(elapsed, speedPercent(this.#speed, this.#timeModifier), release);
  }

  #release(e: ArEvent): void {
    const ctx = { encounter: this.#encounter(), random: this.#env.random, voiceOf: (soldier: number) => this.#voice(soldier) };
    for (const out of autoresolveSounds(e, this.#playback.state, ctx, this.#soundMemory))
      if (this.#sound || out.ungated) this.#env.sounds.play(out.request);
  }

  #voice(soldier: number): number | null {
    return this.#options.strategic()?.mercs.find((m) => m.id === soldier)?.profile ?? null;
  }

  #syncInterface(): void {
    const prompt = this.#playback.state.prompt;
    if (prompt?.kind === 'autoresolveDone') this.#interface = 'done';
    else if (prompt?.kind === 'surrender' && !this.#answered.has(prompt.id) && !this.#opening) this.#interface = 'surrender';
  }

  #syncOrders(): void {
    for (const c of this.#playback.state.cells) if (c.soldier !== undefined && c.state !== 'alive') this.#ordered.delete(c.soldier);
  }

  #syncButtons(): void {
    const b = this.#buttons;
    const battle = this.#interface === 'battle';
    for (const key of [ArButton.PLAY, ArButton.FAST, ArButton.FINISH, ArButton.PAUSE, ArButton.RETREAT]) b[key].visible = battle;
    for (const key of [ArButton.PLAY, ArButton.FAST, ArButton.FINISH, ArButton.PAUSE]) b[key].clicked = this.#pressed === key;
    b.retreat.enabled = this.#playback.state.cells.some((c) => c.side === 'merc');
    b.yes.visible = this.#interface === 'surrender';
    b.no.visible = this.#interface === 'surrender';
    const done = this.#interface === 'done';
    const prompt = this.#playback.state.prompt;
    const won = this.#playback.state.status === 'victory' && this.#playback.state.alive.mercs > 0;
    b.doneWin.visible = done && won;
    b.bandage.visible = done && won;
    b.doneLose.visible = done && !won;
    const doneReady = prompt?.kind === 'autoresolveDone' && !this.#answered.has(prompt.id);
    b.doneWin.enabled = doneReady;
    b.doneLose.enabled = doneReady;
    b.bandage.enabled = doneReady && prompt.canBandage;
    const refusal = prompt?.kind === 'autoresolveDone' ? (prompt.bandageRefusal ?? null) : null;
    b.bandage.help = this.#late(refusal ? (BANDAGE_HELP[refusal] ?? STR_LATE_08) : STR_LATE_12);
    for (const r of this.#regions) r.setEnabled(!done);
  }

  #checkFinished(): void {
    if (this.#finished) return;
    const view = this.#env.client.view;
    if (view?.autoresolve || view?.strategic?.flow === 'autoresolve' || this.#playback.pending > 0) return;
    this.#finished = true;
    this.#options.finished();
  }

  input(event: UiInputEvent): boolean {
    if (this.#opening) return true;
    if (this.#view.input(event)) return true;
    return !isPointerEvent(event);
  }

  render(list: DrawList): void {
    if (!this.#opening) {
      this.#backdrop(list);
      this.#view.render(list);
      this.#afterRender();
      return;
    }
    this.#backdrop(list);
    this.#view.render(list);
    list.capture(SNAPSHOT);
    this.#backdrop(list);
    const now = this.#env.runtime.clock.ja2Now;
    const progress = easeInOutCubic(this.#openedAt, this.#openedAt + OPENING_MS, Math.min(now, this.#openedAt + OPENING_MS));
    list.snapshot(SNAPSHOT, this.#geometry.rect, openingRect(this.#geometry.rect, progress));
  }

  #afterRender(): void {
    const now = this.#env.runtime.clock.ja2Now;
    const state = this.#playback.state;
    this.#playback.state = { ...state, cells: state.cells.map((c) => flashAfterRender(c, now)) };
  }

  #backdrop(list: DrawList): void {
    const { width, height } = this.#env.runtime.geometry();
    list.items.push(...this.#options.backdrop);
    list.shadow(0, 0, width, height);
  }

  #renderers(): Readonly<Record<string, CustomRenderer>> {
    return { autoresolvePanel: (list) => this.#renderPanel(list) };
  }

  #font(name: string): BitmapFont {
    return this.#env.runtime.fonts.get(name);
  }

  #asset(name: string): string {
    return this.#model.asset(name).path;
  }

  #restore(list: DrawList, clip: Rect): void {
    const rect = this.#geometry.rect;
    const x1 = Math.max(rect.x, clip.x);
    const y1 = Math.max(rect.y, clip.y);
    const x2 = Math.min(rect.x + rect.width, clip.x + clip.width);
    const y2 = Math.min(rect.y + rect.height, clip.y + clip.height);
    if (x2 <= x1 || y2 <= y1) return;
    list.pushClip(x1, y1, x2, y2);
    const art = this.#asset('panel');
    for (const piece of piecesTouching(this.#pieces, { x: x1, y: y1, width: x2 - x1, height: y2 - y1 }))
      list.image(art, piece.frame, piece.x, piece.y);
    list.popClip();
  }

  #renderPanel(list: DrawList): void {
    this.#restore(list, this.#geometry.rect);
    const state = this.#playback.state;
    for (const cell of state.cells) this.#renderCell(list, cell, state.status);
    this.#renderTitles(list, state);
    if (this.#interface === 'surrender') this.#renderOffer(list);
    if (state.status !== 'inProgress') this.#renderResult(list, state);
  }

  #cellPoint(cell: DisplayCell): Point | null {
    const g = this.#geometry;
    const cells = cell.side === 'merc' ? g.mercCells : cell.side === 'militia' ? g.civCells : g.enemyCells;
    return cells[cell.index] ?? null;
  }

  #displayed(cell: DisplayCell): DisplayCell {
    return cell.soldier !== undefined && this.#ordered.has(cell.soldier) && cell.state === 'alive'
      ? { ...cell, state: 'retreating' }
      : cell;
  }

  #renderCell(list: DrawList, raw: DisplayCell, status: string): void {
    const at = this.#cellPoint(raw);
    if (!at) return;
    const cell = this.#displayed(raw);
    const panel = this.#asset('panel');
    let x = at.x + MERC_FACE_DX;
    const y = at.y + FACE_DY;
    if (cell.side === 'merc') {
      const [x1, y1, x2, y2] = BAR_WELL;
      list.fill(at.x + x1, at.y + y1, at.x + x2, at.y + y2, BLACK);
      list.image(panel, ArPiece.MERC_PANEL, at.x, at.y);
      drawCellBars(list, cell, at.x, at.y);
    } else {
      list.image(panel, ArPiece.OTHER_PANEL, at.x, at.y);
      x = at.x + OTHER_FACE_DX;
    }
    this.#renderFace(list, cell, x, y);
    this.#renderStatus(list, cell, at, status);
  }

  #renderFace(list: DrawList, cell: DisplayCell, x: number, y: number): void {
    const face = cellFace(cell);
    const art = face.kind === 'merc' ? this.#mercFace(face.profile) : this.#asset('faces');
    const frame = face.kind === 'merc' ? 0 : face.frame;
    if (cell.state === 'dead') {
      list.image(this.#asset('faces'), frame, x, y);
      return;
    }
    if (cell.flash === 'white') list.fill(x, y, x + FACE_WIDTH, y + FACE_HEIGHT, WHITE);
    else {
      if (cell.flash === 'red') list.fill(x, y, x + FACE_WIDTH, y + FACE_HEIGHT, BLACK);
      if (art) list.image(art, frame, x, y, { shade: cell.flash === 'red' ? RED_FACE_SHADE : null });
    }
    const out = cell.side === 'merc' ? (cell.life ?? 0) < OKLIFE : cell.state === 'unconscious';
    if (out && cell.flash === 'none' && !isCreatureCell(cell)) list.shadow(x, y, x + FACE_WIDTH, y + FACE_HEIGHT);
  }

  #mercFace(profile: number | null): string | null {
    const face = profile === null ? null : this.#env.media.faceIndex(profile);
    if (face === null) return null;
    const path = portraitPath(face, 'medium');
    return this.#env.media.image(path) ? path : null;
  }

  #renderStatus(list: DrawList, cell: DisplayCell, at: Point, status: string): void {
    const [dx, dy, w, h] = STATUS_RESTORE;
    this.#restore(list, { x: at.x + dx, y: at.y + dy, width: w, height: h });
    const font = this.#font(FontName.SMALLCOMPFONT);
    const now = this.#env.runtime.clock.ja2Now;
    const key = `${cell.side}:${cell.index}`;
    const showRetreat =
      this.#hover.has(key) && status === 'inProgress' && cell.state !== 'retreating' && cell.state !== 'retreated' && conscious(cell);
    if (showRetreat) {
      const text = this.#env.text.string(STRATEGIC, StrategicString.AR_MERC_RETREAT) ?? '';
      mprint(
        list,
        font,
        at.x + STATUS_DX - Math.trunc(stringPixLength(text, font) / 2),
        at.y + RETREAT_TEXT_DY,
        text,
        fontColors(FontColor.YELLOW),
      );
    }
    const s = cellStatus(this.#env.text, cell, status, now);
    mprint(list, font, at.x + STATUS_DX - Math.trunc(stringPixLength(s.text, font) / 2), at.y + STATUS_DY, s.text, fontColors(s.colour));
  }

  #centred(list: DrawList, font: BitmapFont, y: number, text: string, colour: number): void {
    mprint(
      list,
      font,
      this.#anchors.titleCenterX - Math.trunc(stringPixLength(text, font) / 2),
      y,
      text,
      fontColors(colour, DEFAULT_SHADOW),
    );
  }

  #encounter(): string {
    return this.#env.client.view?.autoresolve?.encounter ?? '';
  }

  #ratio(state: DisplayState): { text: string; colour: number } {
    const good = state.alive.mercs + state.alive.militia;
    const bad = state.alive.enemies;
    const text = printf(this.#late(STR_LATE_17), [good, bad]);
    if (good * GOOD_RATIO[0] <= bad * GOOD_RATIO[1]) return { text, colour: FontColor.LTRED };
    if (good * BAD_RATIO[0] >= bad * BAD_RATIO[1]) return { text, colour: FontColor.LTGREEN };
    return { text, colour: FontColor.YELLOW };
  }

  #renderTitles(list: DrawList, state: DisplayState): void {
    const a = this.#anchors;
    const header = ENCOUNTER_HEADERS[this.#encounter()];
    const headerText = header === undefined ? '' : (this.#env.text.string(STRATEGIC, header) ?? '');
    this.#centred(list, this.#font(FontName.FONT10ARIALBOLD), a.titleY, headerText, FontColor.WHITE);
    const sector = this.#options.sectorName(state.sector.split('-')[0] ?? state.sector);
    this.#centred(list, this.#font(FontName.FONT10ARIAL), a.sectorY, sector, FontColor.GRAY2);
    const ratio = this.#ratio(state);
    this.#centred(list, this.#font(FontName.FONT14ARIAL), a.ratioY, ratio.text, ratio.colour);
  }

  #renderOffer(list: DrawList): void {
    const a = this.#anchors;
    const text = this.#env.text.string(STRATEGIC, StrategicString.ENEMY_SURRENDER_OFFER) ?? '';
    displayWrappedString(
      list,
      a.offer.x,
      a.offer.y,
      a.offerWidth,
      2,
      this.#font(FontName.FONT10ARIAL),
      fontColors(FontColor.YELLOW, DEFAULT_SHADOW, FontColor.BLACK),
      text,
      TextFlag.LEFT_JUSTIFIED,
    );
  }

  #resultText(status: string): string {
    const index = RESULT_TEXT[status];
    return index === undefined ? '' : (this.#env.text.string(STRATEGIC, index) ?? '');
  }

  #elapsedText(seconds: number): string {
    const text = this.#env.text;
    const minutes = Math.trunc(seconds / SECONDS_PER_MINUTE);
    const rest = String(seconds % SECONDS_PER_MINUTE).padStart(2, '0');
    return `${text.string(STRATEGIC, StrategicString.AR_TIME_ELAPSED) ?? ''}:  ${minutes}${text.string(TIME_STRINGS, TIME_MINUTES) ?? ''} ${rest}${text.string(TIME_STRINGS, TIME_SECONDS) ?? ''}`;
  }

  #renderResult(list: DrawList, state: DisplayState): void {
    const a = this.#anchors;
    if (state.status === 'captured') {
      const text = this.#env.text.string(STRATEGIC, StrategicString.ENEMY_CAPTURED) ?? '';
      displayWrappedString(
        list,
        a.captured.x,
        a.captured.y,
        a.offerWidth,
        2,
        this.#font(FontName.FONT10ARIAL),
        fontColors(FontColor.YELLOW, DEFAULT_SHADOW, FontColor.BLACK),
        text,
        TextFlag.LEFT_JUSTIFIED,
      );
    }
    list.image(this.#asset('indent'), 0, a.indent.x, a.indent.y);
    this.#centred(
      list,
      this.#font(FontName.BLOCKFONT2),
      a.resultY,
      this.#resultText(state.status),
      RESULT_COLOUR[state.status] ?? FontColor.YELLOW,
    );
    this.#centred(list, this.#font(FontName.FONT10ARIAL), a.elapsedY, this.#elapsedText(state.battleSeconds), FontColor.YELLOW);
  }

  describe(): readonly WidgetInfo[] {
    return [
      ...this.#view.describe(),
      ...this.#playback.state.cells.flatMap((c) => {
        const at = this.#cellPoint(c);
        return at
          ? [
              {
                id: `arCell.${c.side}:${c.index}`,
                kind: 'arCell',
                rect: { x: at.x, y: at.y, width: CELL_WIDTH, height: CELL_HEIGHT },
                visible: true,
                enabled: c.side === 'merc' && this.#interface !== 'done',
                state: this.#displayed(c).state,
                text: c.name ?? c.kind,
                frame: null,
              },
            ]
          : [];
      }),
    ];
  }

  hook(): AutoresolveHook {
    const state = this.#playback.state;
    const over = state.status !== 'inProgress';
    return {
      opening: this.#opening,
      status: state.status,
      speed: this.#speed,
      paused: this.#paused,
      interface: this.#interface,
      pending: this.#playback.pending,
      cells: state.cells.map((c) => {
        const at = this.#cellPoint(c) ?? { x: 0, y: 0 };
        return {
          key: `${c.side}:${c.index}`,
          state: this.#displayed(c).state,
          rect: { x: at.x, y: at.y, width: CELL_WIDTH, height: CELL_HEIGHT },
        };
      }),
      result: over ? this.#resultText(state.status) : null,
      elapsed: over ? this.#elapsedText(state.battleSeconds) : null,
      ratio: this.#ratio(state).text,
    };
  }
}

function teamSizes(view: AutoresolveView) {
  const count = (side: string) => view.cells.filter((c) => c.side === side).length;
  return { mercs: count('merc'), civs: count('militia'), enemies: count('enemy') };
}

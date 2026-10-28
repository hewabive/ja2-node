// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-24. See LICENSE (SFI-SCLA).
// @src src/game/Strategic/PreBattle_Interface.cc InitPreBattleInterface (the blanket region over the left panel, the three
// @src buttons with their enable states and fast help), DoTransitionFromMapscreenToPreBattleInterface (laptop power up, the
// @src 1 s stretch from the battle sector, no input until the panel is up), RenderPreBattleInterface and RenderPBHeader (the
// @src main panel, the header and its title bars, the uninvolved header, the labels, the columns, the location, the counts
// @src and the rows of the involved and the uninvolved mercs or None), ActivatePreBattleAutoresolveAction,
// @src ActivatePreBattleEnterSectorAction, ActivatePreBattleRetreatAction (a, e and r act only on enabled buttons),
// @src ActivateAutomaticAutoResolveStart (the Autoresolve button shown pressed), KillPreBattleInterface; src/game/Strategic/
// @src MapScreen.cc HandleKeyESC (Esc closes the non-persistent panel).

import type { InvolvedMercView, PromptOptionView, StrategicView, UninvolvedMercView } from '../../../protocol/view.ts';
import type { DrawItem, DrawList } from '../../draw-list.ts';
import type { UiInputEvent } from '../../input/events.ts';
import { Priority } from '../../input/mouse.ts';
import type { MouseRegion } from '../../input/regions.ts';
import { type ControllerContract, ViewModelController } from '../../layout/controller.ts';
import type { LayoutModel } from '../../layout/model.ts';
import { type CustomRenderer, LayoutView } from '../../layout/view.ts';
import type { BitmapFont } from '../../text/bitmap-font.ts';
import { stringPixLength } from '../../text/measure.ts';
import { fontColors, mprint } from '../../text/print.ts';
import type { WidgetInfo } from '../../widgets/widget-info.ts';
import { assignmentString, locationString } from '../map/character-list.ts';
import { LayoutParams, type Params } from '../map/layout-params.ts';
import { type BattleEnvironment, BattleLayout } from './environment.ts';
import {
  buttonStates,
  conditionText,
  departureText,
  enemyLabel,
  headerBlinks,
  headerColour,
  headerText,
  PBI_HEIGHT,
  PBI_WIDTH,
  type PbiButtonState,
  PbiChoice,
  pbiTransition,
  percentText,
  STRATEGIC,
  StrategicString,
} from './pre-battle-text.ts';

export const PRE_BATTLE_SCREEN = 'preBattle';
const OWNER = 'preBattle';
const SNAPSHOT = 'preBattle.opening';
const UNKNOWN_ENEMIES = '?';

export const PRE_BATTLE_CONTRACT: ControllerContract = {
  id: PRE_BATTLE_SCREEN,
  actions: { choose: { args: 1 }, close: {} },
  bindings: { buttons: 'list', autoPressed: 'boolean' },
};

export interface PreBattleData {
  readonly prompt: string | null;
  readonly sector: string;
  readonly persistent: boolean;
  readonly encounter: string;
  readonly enemies: number | 'unknown';
  readonly militia: number;
  readonly involved: readonly InvolvedMercView[];
  readonly uninvolved: readonly UninvolvedMercView[];
  readonly options: readonly PromptOptionView[];
  readonly involvedGroups: number;
  readonly autoStart: boolean;
}

export interface PreBattleHost {
  readonly env: BattleEnvironment;
  origin(): { readonly x: number; readonly y: number };
  sectorPoint(label: string): { readonly x: number; readonly y: number } | null;
  strategic(): StrategicView | undefined;
  sectorName(label: string): string;
  choose(choice: string): void;
  autoStartShown(): void;
}

type Phase = 'opening' | 'shown' | 'pressing' | 'pressed';

export class PreBattlePanel {
  readonly data: PreBattleData;
  readonly #host: PreBattleHost;
  readonly #model: LayoutModel;
  readonly #controller: ViewModelController;
  readonly #view: LayoutView;
  readonly #openedAt: number;
  #phase: Phase = 'opening';
  #inputBlock: MouseRegion | null = null;
  #renderedBefore = false;
  #rect = { x: 0, y: 0, width: 1, height: 1 };

  constructor(host: PreBattleHost, data: PreBattleData) {
    this.#host = host;
    this.data = data;
    const env = host.env;
    this.#model = env.layout(BattleLayout.PRE_BATTLE);
    this.#controller = new ViewModelController(
      PRE_BATTLE_CONTRACT,
      { buttons: this.#buttons(), autoPressed: false },
      { choose: ([i]) => this.#choose(i ?? 0), close: () => this.#close() },
    );
    this.#view = new LayoutView({
      model: this.#model,
      controller: this.#controller,
      services: env.runtime,
      sliders: env.runtime.sliders,
      text: env.text,
      custom: this.#renderers(),
      owner: OWNER,
    });
    this.#openedAt = env.runtime.clock.ja2Now;
    this.#view.build();
    this.#inputBlock = env.runtime.regions.define({
      x1: 0,
      y1: 0,
      x2: 0xffff,
      y2: 0xffff,
      priority: Priority.HIGHEST,
      cursor: 0,
      owner: OWNER,
      id: 'preBattleOpening',
    });
    env.sounds.powerUp();
    this.#updateRect(this.#openedAt);
    if (env.instantOpenings) this.#opened();
  }

  get phase(): Phase {
    return this.#phase;
  }

  get opening(): boolean {
    return this.#phase === 'opening';
  }

  #buttons(): PbiButtonState[] {
    return buttonStates(this.#host.env.text, this.data.persistent, this.data.options, this.data.involvedGroups);
  }

  #choose(index: number): void {
    const state = this.#buttons()[index];
    if (this.#phase !== 'shown' || !state?.enabled) return;
    this.#host.choose(state.choice);
  }

  #close(): void {
    if (this.#phase === 'shown' && !this.data.persistent) this.#host.choose(PbiChoice.CLOSE);
  }

  #updateRect(now: number): void {
    const start = this.#host.sectorPoint(this.data.sector) ?? this.#host.origin();
    const transition = pbiTransition(start, this.#host.origin(), now - this.#openedAt);
    this.#rect = transition.rect;
    if (transition.done && this.#phase === 'opening') this.#opened();
  }

  #opened(): void {
    this.#inputBlock?.remove();
    this.#inputBlock = null;
    this.#phase = this.data.autoStart ? 'pressing' : 'shown';
    if (this.data.autoStart) this.#controller.model.autoPressed = true;
  }

  update(now: number): void {
    if (this.#phase === 'opening') this.#updateRect(now);
    this.#controller.model.buttons = this.#buttons();
    this.#view.update();
  }

  input(event: UiInputEvent): boolean {
    if (this.#phase === 'opening') return true;
    return this.#view.input(event);
  }

  render(list: DrawList, below: readonly DrawItem[]): void {
    this.#view.render(list);
    if (this.#phase !== 'opening') this.#renderedBefore = true;
    if (this.#phase === 'pressing') {
      this.#phase = 'pressed';
      this.#host.autoStartShown();
    }
    if (this.#phase !== 'opening') return;
    const o = this.#host.origin();
    list.capture(SNAPSHOT);
    list.items.push(...below);
    list.snapshot(SNAPSHOT, { x: o.x, y: o.y, width: PBI_WIDTH, height: PBI_HEIGHT }, this.#rect);
  }

  dispose(): void {
    this.#inputBlock?.remove();
    this.#inputBlock = null;
    this.#view.dispose();
    this.#host.env.runtime.regions.removeOwner(OWNER);
  }

  describe(): WidgetInfo[] {
    return [
      ...this.#view.describe(),
      {
        id: 'preBattle.panel',
        kind: 'preBattle',
        rect: this.#phase === 'opening' ? this.#rect : { ...this.#host.origin(), width: PBI_WIDTH, height: PBI_HEIGHT },
        visible: true,
        enabled: this.#phase === 'shown',
        state: this.#phase,
        text: headerText(this.#host.env.text, this.data.persistent, this.data.encounter),
        frame: null,
      },
    ];
  }

  #renderers(): Readonly<Record<string, CustomRenderer>> {
    return {
      preBattlePanel: (list, _rect, params) => this.#renderPanel(list, new LayoutParams(this.#model, params, this.#host.env.runtime.fonts)),
    };
  }

  #colour(p: LayoutParams, key: string): number {
    const colours = p.raw('colors') as Params;
    return this.#model.color(colours[key] as string, 0);
  }

  #renderPanel(list: DrawList, p: LayoutParams): void {
    const o = this.#host.origin();
    const art = p.asset('panel');
    list.image(art, this.#model.number('MAINPANEL'), o.x, o.y);
    const header = this.#renderHeader(list, p);
    this.#renderTitleBars(list, p, header);
    this.#renderFrames(list, p);
    this.#renderLabels(list, p);
    this.#renderCounts(list, p);
    this.#renderInvolved(list, p);
    this.#renderUninvolved(list, p);
  }

  #renderHeader(list: DrawList, p: LayoutParams): { x: number; width: number } {
    const o = this.#host.origin();
    const font = p.font('headerFont');
    const text = headerText(this.#host.env.text, this.data.persistent, this.data.encounter);
    const blinks = headerBlinks(this.data.persistent, this.data.encounter, this.#renderedBefore);
    const colour = this.#colour(p, headerColour(blinks, this.#host.env.runtime.clock.ja2Now));
    const width = stringPixLength(text, font);
    const x = p.number('headerCenter') - Math.trunc(width / 2);
    mprint(list, font, o.x + x, o.y + p.number('headerY'), text, fontColors(colour, this.#colour(p, 'shadow')));
    return { x, width };
  }

  #renderTitleBars(list: DrawList, p: LayoutParams, header: { x: number; width: number }): void {
    const o = this.#host.origin();
    const art = p.asset('panel');
    const frame = this.#model.number('TITLE_BAR_PIECE');
    const [leftGap, minX, rightGap, maxX, step, y] = p.numbers('titleBars') as [number, number, number, number, number, number];
    for (let x = header.x - leftGap; x > minX; x -= step) list.image(art, frame, o.x + x, o.y + y);
    for (let x = header.x + header.width + rightGap; x < maxX; x += step) list.image(art, frame, o.x + x, o.y + y);
  }

  #uninvolvedRows(): number {
    return Math.max(this.data.uninvolved.length, 1);
  }

  #renderFrames(list: DrawList, p: LayoutParams): void {
    const o = this.#host.origin();
    const art = p.asset('panel');
    const rowHeight = this.#model.number('ROW_HEIGHT');
    const bottom = this.#model.number('BOTTOM_Y');
    const top = this.#model.number('TOP_Y');
    const rows = this.#uninvolvedRows();
    const [headerX, bottomColumnX, topColumnX, totalRows] = p.numbers('columns') as [number, number, number, number];
    list.image(
      art,
      this.#model.number('UNINVOLVED_HEADER'),
      o.x + headerX,
      o.y + bottom - this.#model.number('ACTUAL_HEIGHT') - rowHeight * rows,
    );
    for (let i = 0; i < rows; i++)
      list.image(art, this.#model.number('BOTTOM_COLUMN'), o.x + bottomColumnX, o.y + bottom - rowHeight * (i + 1) + 1);
    for (let i = 0; i < totalRows - rows; i++)
      list.image(art, this.#model.number('TOP_COLUMN'), o.x + topColumnX, o.y + top + rowHeight * i);
  }

  #printConfined(list: DrawList, p: LayoutParams, at: readonly number[], text: string): void {
    const o = this.#host.origin();
    const [x = 0, y = 0, maxWidth = 0] = at;
    let font = p.font('labelFont');
    let width = stringPixLength(text, font);
    if (width >= maxWidth) {
      font = p.font('labelNarrowFont');
      width = stringPixLength(text, font);
    }
    mprint(list, font, o.x + x - width, o.y + y, text, fontColors(this.#colour(p, 'beige'), this.#colour(p, 'shadow')));
  }

  #renderLabels(list: DrawList, p: LayoutParams): void {
    const text = this.#host.env.text;
    const labels = p.raw('labels') as Params;
    const numbers = (key: string) => (labels[key] as readonly (number | string)[]).map((v) => this.#model.number(v));
    this.#printConfined(list, p, numbers('location'), text.string(STRATEGIC, StrategicString.PB_LOCATION) ?? '');
    this.#printConfined(list, p, numbers('enemies'), enemyLabel(text, this.data.encounter));
    this.#printConfined(list, p, numbers('mercs'), text.string(STRATEGIC, StrategicString.PB_MERCS) ?? '');
    this.#printConfined(list, p, numbers('militia'), text.string(STRATEGIC, StrategicString.PB_MILITIA) ?? '');
  }

  #centered(list: DrawList, font: BitmapFont, x: number, y: number, width: number, text: string, colour: number, shadow: number): void {
    const o = this.#host.origin();
    mprint(list, font, o.x + x + Math.trunc((width - stringPixLength(text, font)) / 2), o.y + y, text, fontColors(colour, shadow));
  }

  #renderCounts(list: DrawList, p: LayoutParams): void {
    const o = this.#host.origin();
    const text = this.#host.env.text;
    const yellow = this.#colour(p, 'yellow');
    const shadow = this.#colour(p, 'shadow');
    const [lx, ly] = p.numbers('location') as [number, number];
    const location = `${text.string(STRATEGIC, StrategicString.PB_SECTOR) ?? ''} ${this.#host.sectorName(this.data.sector)}`;
    mprint(list, p.font('locationFont'), o.x + lx, o.y + ly, location, fontColors(yellow, shadow));
    const font = p.font('countFont');
    const counts = p.raw('counts') as Params;
    const at = (key: string) => (counts[key] as readonly (number | string)[]).map((v) => this.#model.number(v)) as [number, number, number];
    const enemies = this.data.enemies === 'unknown' ? UNKNOWN_ENEMIES : String(this.data.enemies);
    for (const [key, value] of [
      ['enemies', enemies],
      ['mercs', String(this.data.involved.length)],
      ['militia', String(this.data.militia)],
    ] as const) {
      const [x, y, width] = at(key);
      this.#centered(list, font, x, y, width, value, yellow, shadow);
    }
  }

  #columns(p: LayoutParams, key: string): Readonly<Record<string, readonly [number, number]>> {
    const raw = p.raw(key) as Params;
    return Object.fromEntries(
      Object.entries(raw).map(([name, v]) => [
        name,
        (v as readonly (number | string)[]).map((n) => this.#model.number(n)) as [number, number],
      ]),
    );
  }

  #merc(id: number) {
    return this.#host.strategic()?.mercs.find((m) => m.id === id) ?? null;
  }

  #assignment(soldier: number, assignment: number): string {
    const strategic = this.#host.strategic();
    const m = this.#merc(soldier);
    if (strategic && m) return assignmentString(this.#host.env.text, strategic, m);
    return this.#host.env.text.string('pAssignmentStrings', assignment) ?? '';
  }

  #renderInvolved(list: DrawList, p: LayoutParams): void {
    const text = this.#host.env.text;
    const font = p.font('rowFont');
    const colour = this.#colour(p, 'yellow');
    const shadow = this.#colour(p, 'rowShadow');
    const c = this.#columns(p, 'involved');
    const cell = (column: string, y: number, value: string) => {
      const [x, width] = c[column] ?? [0, 0];
      this.#centered(list, font, x, y, width, value, colour, shadow);
    };
    let y = this.#model.number('TOP_Y') + 1;
    for (const m of this.data.involved) {
      cell('name', y, m.name);
      cell('assignment', y, this.#assignment(m.soldier, m.assignment));
      cell('condition', y, conditionText(text, m.condition));
      cell('hp', y, percentText(m.hp));
      cell('bp', y, percentText(m.bp));
      y += this.#model.number('ROW_HEIGHT');
    }
  }

  #location(m: UninvolvedMercView): string {
    const merc = this.#merc(m.soldier);
    if (merc) return locationString(this.#host.env.text, merc);
    const sector = m.location.replace('-', '');
    return m.betweenSectors ? `(${sector})` : sector;
  }

  #renderUninvolved(list: DrawList, p: LayoutParams): void {
    const text = this.#host.env.text;
    const font = p.font('rowFont');
    const colour = this.#colour(p, 'yellow');
    const shadow = this.#colour(p, 'rowShadow');
    const c = this.#columns(p, 'uninvolved');
    const rowHeight = this.#model.number('ROW_HEIGHT');
    const bottom = this.#model.number('BOTTOM_Y');
    const cell = (column: string, y: number, value: string) => {
      const [x, width] = c[column] ?? [0, 0];
      this.#centered(list, font, x, y, width, value, colour, shadow);
    };
    if (this.data.uninvolved.length === 0) {
      cell('name', bottom - rowHeight + 2, text.string(STRATEGIC, StrategicString.PB_NONE) ?? '');
      return;
    }
    let y = bottom - rowHeight * this.data.uninvolved.length + 2;
    for (const m of this.data.uninvolved) {
      cell('name', y, m.name);
      cell('assignment', y, this.#assignment(m.soldier, m.assignment));
      cell('location', y, this.#location(m));
      if (m.destination) cell('destination', y, m.destination);
      cell('departure', y, departureText(text, m.departure));
      y += rowHeight;
    }
  }
}

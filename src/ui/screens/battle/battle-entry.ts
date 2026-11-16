// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-24. See LICENSE (SFI-SCLA).
// @src src/game/Strategic/PreBattle_Interface.cc InitPreBattleInterface (the panel over the map screen),
// @src HandlePreBattleInterfaceStates and ActivateAutomaticAutoResolveStart (an automatic start shows the panel with the
// @src Autoresolve button pressed, then autoresolve), AutoResolveBattleCallback, GoToSectorCallback, RetreatMercsCallback
// @src (the choice is the server's answer), KillPreBattleInterface; src/game/Strategic/Auto_Resolve.cc EnterAutoResolveMode
// @src and AutoResolveScreenHandle (a separate screen over the shaded map screen, back to the map when it closes);
// @src src/game/Strategic/MapScreen.cc (the non-persistent panel from the battle locator or a refused compression);
// @src src/game/Tactical/Dialogue_Control.cc HandleDialogue (FACE_TRIGGER_PREBATTLE_INT: the panel of the enemy-presence
// @src line opens once the face that says it is done talking, 2026-11-16).

import type { PlayerView, PromptView, StrategicView, ViewFrame } from '../../../protocol/view.ts';
import type { DrawItem, DrawList } from '../../draw-list.ts';
import type { UiInputEvent } from '../../input/events.ts';
import type { WidgetInfo } from '../../widgets/widget-info.ts';
import { type AutoresolveHook, AutoresolveScreen } from './autoresolve-screen.ts';
import type { BattleEnvironment, BattleReply } from './environment.ts';
import { type PreBattleData, PreBattlePanel } from './pre-battle.ts';
import { PbiChoice } from './pre-battle-text.ts';

type PreBattlePrompt = Extract<PromptView, { readonly kind: 'preBattle' }>;
type BattleEvent = NonNullable<ViewFrame['events']>[number];
type PreBattleEvent = Extract<BattleEvent, { readonly type: 'preBattle' }>;
type PromptLine = NonNullable<PreBattleEvent['line']>;

const AUTO_START_REASON = 'autoStart';

export interface BattleEntryHost {
  readonly env: BattleEnvironment;
  view(): PlayerView | null;
  origin(): { readonly x: number; readonly y: number };
  sectorPoint(label: string): { readonly x: number; readonly y: number } | null;
  mapItems(): readonly DrawItem[];
  sectorName(label: string): string;
  preparePanel(sector: string): void;
  saying(line: PromptLine): boolean;
}

export interface BattleEntryHook {
  readonly screen: 'preBattle' | 'autoresolve' | null;
  readonly preBattle: {
    readonly prompt: string | null;
    readonly persistent: boolean;
    readonly encounter: string;
    readonly phase: string;
    readonly autoStart: boolean;
  } | null;
  readonly autoresolve: AutoresolveHook | null;
  readonly commands: readonly { readonly type: string; readonly choice: string | null; readonly ok: boolean }[];
}

function promptData(prompt: PreBattlePrompt): PreBattleData {
  return {
    prompt: prompt.id,
    sector: prompt.sector,
    persistent: prompt.persistent,
    encounter: prompt.encounter,
    enemies: prompt.enemies,
    militia: prompt.militia,
    involved: prompt.involved,
    uninvolved: prompt.uninvolved,
    options: prompt.options,
    involvedGroups: prompt.involvedGroups ?? 1,
    autoStart: false,
  };
}

function autoStartData(e: PreBattleEvent): PreBattleData | null {
  const panel = e.panel;
  if (!panel) return null;
  return {
    prompt: null,
    sector: panel.sector,
    persistent: e.persistent,
    encounter: e.encounter,
    enemies: panel.enemies,
    militia: panel.militia,
    involved: panel.involved,
    uninvolved: panel.uninvolved,
    options: [
      { choice: PbiChoice.AUTORESOLVE, enabled: true },
      { choice: PbiChoice.ENTER, enabled: false, reason: AUTO_START_REASON },
      { choice: PbiChoice.RETREAT, enabled: false, reason: AUTO_START_REASON },
    ],
    involvedGroups: panel.involvedGroups,
    autoStart: true,
  };
}

export class BattleEntry {
  readonly #host: BattleEntryHost;
  readonly #commands: { type: string; choice: string | null; ok: boolean }[] = [];
  #panel: PreBattlePanel | null = null;
  #autoStart: PreBattleData | null = null;
  #promptLine: { readonly prompt: string; readonly line: PromptLine } | null = null;
  #ar: AutoresolveScreen | null = null;
  #autoStartShown = false;
  #answering = false;

  constructor(host: BattleEntryHost) {
    this.#host = host;
  }

  get panel(): PreBattlePanel | null {
    return this.#panel;
  }

  get autoresolve(): AutoresolveScreen | null {
    return this.#ar;
  }

  get active(): boolean {
    return this.#panel !== null || this.#ar !== null;
  }

  get battleGroupSector(): string | null {
    return this.#panel?.battleGroupSector ?? null;
  }

  get retreatPaths(): boolean {
    return this.#panel?.showsRetreatPaths() ?? false;
  }

  frames(frames: readonly ViewFrame[]): void {
    for (const frame of frames) for (const e of frame.events ?? []) if (e.type === 'preBattle') this.pendPreBattle(e);
    this.#ar?.frames(frames);
  }

  pendPreBattle(e: PreBattleEvent): void {
    if (e.autoStart) this.#autoStart = autoStartData(e) ?? this.#autoStart;
    else if (e.prompt && e.line) this.#promptLine = { prompt: e.prompt, line: e.line };
  }

  #strategic(): StrategicView | undefined {
    return this.#host.view()?.strategic;
  }

  update(now: number): void {
    const host = this.#host.env.runtime.host;
    if (this.#ar && host.screen !== this.#ar) this.#ar = null;
    if (this.#ar) return;
    const view = this.#host.view();
    const prompt = view?.prompt?.kind === 'preBattle' ? view.prompt : null;
    const autoresolve = view?.strategic?.flow === 'autoresolve' && view.autoresolve != null;
    if (prompt) this.#showPrompt(prompt);
    else if (autoresolve && this.#autoStart && !this.#panel) this.#open(this.#autoStart);
    else if (this.#panel?.data.prompt) this.#closePanel();
    if (autoresolve && (!this.#panel || this.#panel.data.prompt || this.#autoStartShown)) {
      this.#startAutoresolve();
      return;
    }
    if (!autoresolve && this.#panel?.data.autoStart) this.#closePanel();
    this.#panel?.update(now);
  }

  #showPrompt(prompt: PreBattlePrompt): void {
    if (this.#panel?.data.prompt === prompt.id) return;
    this.#closePanel();
    if (!this.#waitsForItsLine(prompt.id)) this.#open(promptData(prompt));
  }

  #waitsForItsLine(prompt: string): boolean {
    const held = this.#promptLine;
    if (held?.prompt !== prompt) return false;
    if (this.#host.saying(held.line)) return true;
    this.#promptLine = null;
    return false;
  }

  #open(data: PreBattleData): void {
    this.#autoStartShown = false;
    this.#host.preparePanel(data.sector);
    this.#panel = new PreBattlePanel(
      {
        env: this.#host.env,
        origin: () => this.#host.origin(),
        sectorPoint: (label) => this.#host.sectorPoint(label),
        strategic: () => this.#strategic(),
        sectorName: (label) => this.#host.sectorName(label),
        choose: (choice) => void this.#choose(choice),
        autoStartShown: () => {
          this.#autoStartShown = true;
        },
      },
      data,
    );
  }

  #closePanel(): void {
    this.#panel?.dispose();
    this.#panel = null;
    this.#autoStartShown = false;
  }

  async #choose(choice: string): Promise<void> {
    const prompt = this.#panel?.data.prompt;
    if (!prompt || this.#answering) return;
    this.#answering = true;
    let reply: BattleReply;
    try {
      reply = await this.#host.env.client.command({ type: 'answer', prompt, choice });
    } finally {
      this.#answering = false;
    }
    this.#commands.push({ type: 'answer', choice, ok: reply.ok });
  }

  #startAutoresolve(): void {
    const view = this.#host.view();
    const ar = view?.autoresolve;
    if (!view || !ar) return;
    const backdrop = this.#host.mapItems();
    this.#closePanel();
    this.#autoStart = null;
    const screen = new AutoresolveScreen(this.#host.env, ar, view.prompt ?? null, {
      backdrop,
      strategic: () => this.#strategic(),
      sectorName: (label) => this.#host.sectorName(label),
      finished: () => this.#finished(screen),
    });
    this.#ar = screen;
    this.#host.env.runtime.host.push(screen);
  }

  #finished(screen: AutoresolveScreen): void {
    if (this.#ar !== screen) return;
    this.#ar = null;
    const host = this.#host.env.runtime.host;
    if (host.screen === screen) host.pop();
  }

  async showBattle(): Promise<BattleReply> {
    const reply = await this.#host.env.client.command({ type: 'showBattle' });
    this.#commands.push({ type: 'showBattle', choice: null, ok: reply.ok });
    return reply;
  }

  input(event: UiInputEvent): boolean {
    return this.#panel?.input(event) ?? false;
  }

  render(list: DrawList, below: readonly DrawItem[]): void {
    this.#panel?.render(list, below);
  }

  suspend(): void {
    this.#closePanel();
  }

  describe(): readonly WidgetInfo[] {
    return this.#panel?.describe() ?? [];
  }

  hook(): BattleEntryHook {
    const panel = this.#panel;
    return {
      screen: this.#ar ? 'autoresolve' : panel ? 'preBattle' : null,
      preBattle: panel
        ? {
            prompt: panel.data.prompt,
            persistent: panel.data.persistent,
            encounter: panel.data.encounter,
            phase: panel.phase,
            autoStart: panel.data.autoStart,
          }
        : null,
      autoresolve: this.#ar?.hook() ?? null,
      commands: [...this.#commands],
    };
  }
}

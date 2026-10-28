// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-21. See LICENSE (SFI-SCLA).
// @src src/game/Strategic/Assignments.cc CreateContractBox ("Contract Options:" in yellow, a blank line, the three offers
// @src with their price in "( $x )", Dismiss, Cancel; at ContractPosition or the row's giBoxY),
// @src ContractMenuBtnCallbackPrimary (the extensions, Dismiss asking STR_LATE_48 outside the renewal sequence, Cancel
// @src letting the merc go during the renewal sequence), CloseContractMenu; src/game/Strategic/MapScreen.cc
// @src HandleShadingOfLinesForContractMenu (the shading comes from contractOptions or the renewal prompt).

import type { ContractOptionView } from '../../../protocol/view.ts';
import type { DrawList } from '../../draw-list.ts';
import type { RegionDispatcher } from '../../input/regions.ts';
import { sprintMoney } from '../../text/money.ts';
import type { UiTextService } from '../../text/text-service.ts';
import type { PopupBoxStyle, PopupLine } from '../../widgets/popup-box.ts';
import type { WidgetInfo } from '../../widgets/widget-info.ts';
import { MapMenu } from './map-menu.ts';

const CONTRACT_STRINGS = 'pContractStrings';
const LATE = 'gzLateLocalizedString';
const STR_LATE_48 = 47;
const TITLE = 0;
const BLANK = 1;
const DAY = 2;
const WEEK = 3;
const TWO_WEEKS = 4;
const DISMISS = 5;
const CANCEL = 6;
const CONTRACT_X = 120;
const CONTRACT_Y = 50;
const CHOICES: Readonly<Record<number, string>> = { [DAY]: 'day', [WEEK]: 'week', [TWO_WEEKS]: 'twoWeeks', [DISMISS]: 'dismiss' };

export interface ContractMenuHost {
  readonly regions: RegionDispatcher;
  readonly text: UiTextService;
  readonly owner: unknown;
  readonly style: () => PopupBoxStyle;
  readonly origin: () => { x: number; y: number };
  readonly query: (soldier: number) => Promise<readonly ContractOptionView[] | null>;
  readonly send: (cmd: { type: string; [key: string]: unknown }) => Promise<{ ok: boolean }>;
  readonly confirm: (text: string) => Promise<boolean>;
  readonly closed: () => void;
}

export interface RenewalPrompt {
  readonly id: string;
  readonly options: readonly ContractOptionView[];
}

export class ContractMenu {
  readonly #host: ContractMenuHost;
  #menu: MapMenu | null = null;
  #soldier = -1;
  #options: readonly ContractOptionView[] = [];
  #renewal: RenewalPrompt | null = null;
  #pending = false;

  constructor(host: ContractMenuHost) {
    this.#host = host;
  }

  get open(): boolean {
    return this.#menu !== null;
  }

  get soldier(): number {
    return this.#soldier;
  }

  get renewalId(): string | null {
    return this.#renewal?.id ?? null;
  }

  async show(soldier: number, boxY: number | null): Promise<void> {
    if (this.#pending) return;
    this.close(false);
    this.#pending = true;
    const options = await this.#host.query(soldier);
    this.#pending = false;
    if (!options) return;
    this.#present(soldier, boxY, options, null);
  }

  showRenewal(soldier: number, boxY: number | null, prompt: RenewalPrompt): void {
    this.close(false);
    this.#present(soldier, boxY, prompt.options, prompt);
  }

  #present(soldier: number, boxY: number | null, options: readonly ContractOptionView[], renewal: RenewalPrompt | null): void {
    this.#soldier = soldier;
    this.#options = options;
    this.#renewal = renewal;
    const text = this.#host.text;
    const lines: PopupLine[] = [];
    for (let i = TITLE; i <= CANCEL; i++) {
      const base = text.string(CONTRACT_STRINGS, i) ?? '';
      const choice = CHOICES[i];
      const option = choice ? options.find((o) => o.choice === choice) : undefined;
      const label = i >= DAY && i <= TWO_WEEKS ? `${base} ( ${sprintMoney(option?.cost ?? 0)} )` : base;
      const shaded = choice !== undefined && option !== undefined && !option.enabled;
      lines.push({ text: label, shade: shaded ? 'shade' : 'none' });
    }
    const o = this.#host.origin();
    this.#menu = new MapMenu(this.#host.style(), o.x + CONTRACT_X, o.y + (boxY ?? CONTRACT_Y), lines, {
      id: 'contractMenu',
      owner: this.#host.owner,
      regions: this.#host.regions,
      select: (line) => void this.#select(line),
    });
    this.#menu.box.lines[TITLE] = { ...(this.#menu.box.lines[TITLE] as PopupLine), shade: 'secondary' };
    this.#menu.show();
  }

  async #select(line: number): Promise<void> {
    if (line === TITLE || line === BLANK) return;
    const choice = CHOICES[line];
    const option = choice ? this.#options.find((o) => o.choice === choice) : undefined;
    if (choice && option && !option.enabled) return;
    const soldier = this.#soldier;
    const renewal = this.#renewal;
    if (line === CANCEL) {
      this.close(true);
      if (renewal) await this.#host.send({ type: 'answer', prompt: renewal.id, choice: 'letGo' });
      return;
    }
    if (line === DISMISS) {
      if (!renewal && !(await this.#host.confirm(this.#host.text.string(LATE, STR_LATE_48) ?? ''))) return;
      this.close(true);
      if (renewal) await this.#host.send({ type: 'answer', prompt: renewal.id, choice: 'dismiss' });
      else await this.#host.send({ type: 'dismiss', soldier });
      return;
    }
    this.close(true);
    if (renewal) await this.#host.send({ type: 'answer', prompt: renewal.id, choice });
    else await this.#host.send({ type: 'extendContract', soldier, length: choice });
  }

  close(notify: boolean): void {
    const wasOpen = this.#menu !== null;
    this.#menu?.hide();
    this.#menu = null;
    this.#renewal = null;
    if (wasOpen && notify) this.#host.closed();
  }

  render(list: DrawList): void {
    this.#menu?.render(list);
  }

  describe(): WidgetInfo[] {
    return this.#menu?.describe() ?? [];
  }
}

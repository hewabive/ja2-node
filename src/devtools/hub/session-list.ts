import type { DriverMode } from '../../protocol/messages.ts';
import type { SessionSummary } from '../../ui/client/api-types.ts';
import { driverChoiceOf, driverChoices } from './drivers.ts';

export interface SessionListContext {
  readonly gameUrl: (session: string) => string;
  readonly drive: (session: string, driver: DriverMode) => void;
  readonly runUntilIdle: (session: string) => void;
  readonly close: (session: string) => void;
}

const COLUMNS = ['session', 'screen', 'sector', 'tick', 'time', 'viewers', ''] as const;
const SANDBOX_SCREEN = 'sandbox';
const IDLE_MARK = 'idle';
const REALTIME_HINT = 'Real time runs while a page watches the session; the server pauses it when the last one leaves.';

function cell(text: string): HTMLTableCellElement {
  const td = document.createElement('td');
  td.textContent = text;
  return td;
}

function button(text: string, className: string, click: () => void): HTMLButtonElement {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = className;
  b.textContent = text;
  b.addEventListener('click', click);
  return b;
}

export class SessionList {
  readonly #table: HTMLTableElement;
  readonly #ctx: SessionListContext;

  constructor(ctx: SessionListContext) {
    this.#table = document.getElementById('sessionList') as HTMLTableElement;
    this.#ctx = ctx;
  }

  render(sessions: readonly SessionSummary[]): void {
    const head = document.createElement('tr');
    for (const column of COLUMNS) {
      const th = document.createElement('th');
      th.textContent = column;
      head.append(th);
    }
    this.#table.replaceChildren(head, ...sessions.map((s) => this.#row(s)));
  }

  #row(s: SessionSummary): HTMLTableRowElement {
    const tr = document.createElement('tr');
    tr.dataset.session = s.session;
    tr.append(
      this.#gameCell(s.session),
      cell(s.flow ?? SANDBOX_SCREEN),
      cell(s.sector ?? ''),
      cell(s.tick === undefined ? '' : String(s.tick)),
      this.#timeCell(s),
      cell(s.viewers === undefined ? '' : String(s.viewers)),
      this.#actionsCell(s.session),
    );
    return tr;
  }

  #gameCell(session: string): HTMLTableCellElement {
    const td = document.createElement('td');
    const a = document.createElement('a');
    a.className = 'game';
    a.textContent = session;
    a.href = this.#ctx.gameUrl(session);
    td.append(a);
    return td;
  }

  #timeCell(s: SessionSummary): HTMLTableCellElement {
    const td = document.createElement('td');
    const select = document.createElement('select');
    select.className = 'driver';
    select.title = REALTIME_HINT;
    const choices = driverChoices(s.driver);
    const current = s.driver ? driverChoiceOf(s.driver).value : '';
    for (const choice of choices) {
      const o = document.createElement('option');
      o.value = choice.value;
      o.textContent = choice.label;
      o.selected = choice.value === current;
      select.append(o);
    }
    select.addEventListener('change', () => {
      const chosen = choices.find((c) => c.value === select.value);
      if (chosen) this.#ctx.drive(s.session, chosen.driver);
    });
    td.append(select);
    if (s.idle) td.append(` ${IDLE_MARK}`);
    return td;
  }

  #actionsCell(session: string): HTMLTableCellElement {
    const td = document.createElement('td');
    td.append(
      button('run until idle', 'run-idle', () => this.#ctx.runUntilIdle(session)),
      ' ',
      button('close', 'close-session', () => this.#ctx.close(session)),
    );
    return td;
  }
}

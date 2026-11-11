import type { DriverMode } from '../../protocol/messages.ts';
import type { SessionSummary } from '../../ui/client/api-types.ts';
import { type OpenPage, openPageUrl } from './open-page.ts';

export interface SessionListContext {
  readonly gameUrl: (session: string) => string;
  readonly close: (session: string) => void;
}

const COLUMNS = ['session', 'screen', 'sector', 'tick', 'driver', 'viewers', 'pages', ''] as const;
const SANDBOX_SCREEN = 'sandbox';

function cell(text: string): HTMLTableCellElement {
  const td = document.createElement('td');
  td.textContent = text;
  return td;
}

function driverText(driver: DriverMode | undefined): string {
  if (!driver) return '';
  return driver.mode === 'realtime' ? `realtime ${driver.speed}×` : driver.mode;
}

function link(text: string, href: string, page: OpenPage): HTMLAnchorElement {
  const a = document.createElement('a');
  a.textContent = text;
  a.href = href;
  a.dataset.page = page;
  return a;
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
    const idle = s.idle ? ' · idle' : '';
    tr.append(
      cell(s.session),
      cell(s.flow ?? SANDBOX_SCREEN),
      cell(s.sector ?? ''),
      cell(s.tick === undefined ? '' : String(s.tick)),
      cell(`${driverText(s.driver)}${idle}`),
      cell(s.viewers === undefined ? '' : String(s.viewers)),
      this.#pages(s),
      this.#closeCell(s.session),
    );
    return tr;
  }

  #pages(s: SessionSummary): HTMLTableCellElement {
    const td = document.createElement('td');
    const links = [link('game', this.#ctx.gameUrl(s.session), 'play')];
    if (s.flow) links.push(link('strategic page', openPageUrl('strategic', s.session, []), 'strategic'));
    if (s.map) links.push(link('tactical page', openPageUrl('tactical', s.session, []), 'tactical'));
    td.append(...links.flatMap((a, i) => (i > 0 ? [' · ', a] : [a])));
    return td;
  }

  #closeCell(session: string): HTMLTableCellElement {
    const td = document.createElement('td');
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'close-session';
    button.textContent = 'close';
    button.addEventListener('click', () => this.#ctx.close(session));
    td.append(button);
    return td;
  }
}

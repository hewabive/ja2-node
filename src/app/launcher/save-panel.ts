import type { UiLanguage } from '../../content/text/data-version.ts';
import type { Health, SaveListing, SessionSummary } from '../../ui/client/api-types.ts';
import type { StartPage } from '../../ui/client/campaign-form.ts';
import type { MessageBoxes } from '../../ui/message-boxes.ts';
import { type SaveApi, SaveController } from '../../ui/saves/save-controller.ts';
import { overwriteTarget, type SaveRow, saveRow, uploadName } from '../../ui/saves/save-rows.ts';
import type { LabelId, Labels } from '../../ui/text/labels.ts';
import {
  ApiError,
  createSession,
  deleteSave,
  fetchSaves,
  fetchSessions,
  loadIntoSession,
  saveFileUrl,
  saveSession,
  uploadSave,
} from './api.ts';

export interface SavePanelContext {
  readonly labels: () => Labels;
  readonly health: () => Health | null;
  readonly language: () => UiLanguage | null;
  readonly box: MessageBoxes;
  readonly status: (text: string, error?: boolean) => void;
  readonly open: (page: StartPage, session: string) => void;
  readonly sessionsChanged: (sessions: readonly SessionSummary[]) => void;
}

export interface SavePanelHook {
  rows: string[];
  selected: string | null;
  sessions: string[];
}

const LAUNCHER_SAVE_API: SaveApi = {
  save: saveSession,
  loadInPlace: loadIntoSession,
  createSession: async (start) => {
    const created = await createSession(start);
    return { session: created.session, load: created.load ?? null };
  },
  deleteSave,
};

const SAVE_EXTENSION = '.j2s';
const SANDBOX_SESSION = 'sandbox';
const COLUMNS: readonly (LabelId | null)[] = [null, null, 'sectorColumn', 'mercsColumn', 'balanceColumn', 'description'];

function element<T extends HTMLElement>(id: string): T {
  const found = document.getElementById(id);
  if (!found) throw new Error(`missing #${id}`);
  return found as T;
}

function cell(text: string, className?: string): HTMLTableCellElement {
  const td = document.createElement('td');
  td.textContent = text;
  if (className) td.className = className;
  return td;
}

function sessionLabel(s: SessionSummary): string {
  const where = [s.flow, s.sector].filter(Boolean).join(' ');
  return where ? `${s.session} (${where})` : s.session;
}

function option(value: string, text: string, selected: boolean): HTMLOptionElement {
  const o = document.createElement('option');
  o.value = value;
  o.textContent = text;
  o.selected = selected;
  return o;
}

export class SavePanel {
  readonly hook: SavePanelHook = { rows: [], selected: null, sessions: [] };
  readonly #ctx: SavePanelContext;
  readonly #sessionSelect = element<HTMLSelectElement>('saveSession');
  readonly #loadTarget = element<HTMLSelectElement>('loadTarget');
  readonly #table = element<HTMLTableElement>('saveList');
  readonly #description = element<HTMLInputElement>('saveDescription');
  readonly #saveNew = element<HTMLButtonElement>('saveNew');
  readonly #saveOver = element<HTMLButtonElement>('saveOver');
  readonly #load = element<HTMLButtonElement>('loadSave');
  readonly #delete = element<HTMLButtonElement>('deleteSave');
  readonly #download = element<HTMLButtonElement>('downloadSave');
  readonly #upload = element<HTMLInputElement>('uploadSave');
  #listings: SaveListing[] = [];
  #rows: SaveRow[] = [];
  #sessions: SessionSummary[] = [];
  #selected: string | null = null;
  #preferredSession: string | null;
  readonly #saves: SaveController;

  constructor(ctx: SavePanelContext, preferredSession: string | null) {
    this.#ctx = ctx;
    this.#saves = new SaveController({ labels: ctx.labels, health: ctx.health, box: ctx.box, api: LAUNCHER_SAVE_API });
    this.#preferredSession = preferredSession;
    this.#saveNew.addEventListener('click', () => void this.#save(false));
    this.#saveOver.addEventListener('click', () => void this.#save(true));
    this.#load.addEventListener('click', () => void this.#loadSelected());
    this.#delete.addEventListener('click', () => void this.#deleteSelected());
    this.#download.addEventListener('click', () => this.#downloadSelected());
    this.#upload.addEventListener('change', () => void this.#uploadFile());
    this.#sessionSelect.addEventListener('change', () => {
      this.#preferredSession = this.#sessionSelect.value || null;
      this.#updateButtons();
    });
  }

  async refresh(): Promise<void> {
    const [listings, sessions] = await Promise.all([fetchSaves().catch(() => this.#listings), fetchSessions().catch(() => this.#sessions)]);
    this.#listings = listings;
    this.#sessions = sessions;
    if (this.#selected && !listings.some((l) => l.name === this.#selected)) this.#selected = null;
    this.render();
    this.#ctx.sessionsChanged(sessions);
  }

  render(): void {
    const labels = this.#ctx.labels();
    this.#rows = this.#listings.map((l) => saveRow(l, labels));
    this.hook.rows = this.#rows.map((r) => r.name);
    this.hook.sessions = this.#sessions.map((s) => s.session);
    this.#renderSessions(labels);
    this.#renderTable(labels);
    this.#updateButtons();
  }

  #renderSessions(labels: Labels): void {
    const wanted = this.#preferredSession ?? this.#sessionSelect.value;
    const fallback = this.#sessions.at(-1)?.session ?? '';
    const chosen = this.#sessions.some((s) => s.session === wanted) ? wanted : fallback;
    this.#sessionSelect.replaceChildren(...this.#sessions.map((s) => option(s.session, sessionLabel(s), s.session === chosen)));
    const target = this.#loadTarget.value;
    this.#loadTarget.replaceChildren(
      option('', labels.text('newSession'), target === ''),
      ...this.#sessions.map((s) => option(s.session, sessionLabel(s), s.session === target)),
    );
  }

  #renderTable(labels: Labels): void {
    const head = document.createElement('tr');
    for (const column of COLUMNS) {
      const th = document.createElement('th');
      th.textContent = column ? labels.text(column) : '';
      head.append(th);
    }
    if (this.#rows.length === 0) {
      const empty = document.createElement('tr');
      const td = cell(labels.text('noSaves'), 'empty');
      td.colSpan = COLUMNS.length;
      empty.append(td);
      this.#table.replaceChildren(head, empty);
      return;
    }
    this.#table.replaceChildren(head, ...this.#rows.map((row) => this.#rowElement(row, labels)));
  }

  #rowElement(row: SaveRow, labels: Labels): HTMLTableRowElement {
    const tr = document.createElement('tr');
    tr.className = 'save';
    tr.classList.toggle('selected', row.name === this.#selected);
    tr.classList.toggle('incompatible', !row.compatible);
    tr.dataset.save = row.name;
    tr.dataset.native = String(row.native);
    tr.title = row.problems.length > 0 ? `${row.tooltip}\n${row.problems.join(', ')}` : row.tooltip;
    const description = cell(row.description, 'description');
    if (row.native) {
      const mark = document.createElement('span');
      mark.className = 'native';
      mark.textContent = ` · ${labels.text('nativeSave')}`;
      description.append(mark);
    }
    tr.append(
      cell(row.deadIsDead ? labels.text('deadIsDeadMark') : '', 'mark'),
      cell(row.date),
      cell(row.sector),
      cell(row.mercs),
      cell(row.balance),
      description,
    );
    tr.addEventListener('click', () => this.select(row.name));
    tr.addEventListener('dblclick', () => void this.#loadSelected());
    return tr;
  }

  select(name: string | null): void {
    this.#selected = name;
    this.hook.selected = name;
    for (const tr of this.#table.querySelectorAll<HTMLTableRowElement>('tr.save'))
      tr.classList.toggle('selected', tr.dataset.save === name);
    this.#updateButtons();
  }

  #selectedRow(): SaveRow | null {
    return this.#rows.find((r) => r.name === this.#selected) ?? null;
  }

  #selectedListing(): SaveListing | null {
    return this.#listings.find((l) => l.name === this.#selected) ?? null;
  }

  #updateButtons(): void {
    const labels = this.#ctx.labels();
    const row = this.#selectedRow();
    const session = this.#sessionSelect.value;
    this.#saveNew.disabled = !session;
    this.#saveOver.disabled = !session || row === null || overwriteTarget(row) === null;
    this.#load.disabled = row === null || !row.compatible;
    this.#load.textContent = labels.text(row?.native ? 'importNative' : 'loadSelected');
    this.#delete.disabled = !row || row.native;
    this.#download.disabled = !row || row.native;
  }

  #downloadSelected(): void {
    const row = this.#selectedRow();
    if (!row || row.native) return;
    const link = document.createElement('a');
    link.href = saveFileUrl(row.name);
    link.download = `${row.name}${SAVE_EXTENSION}`;
    document.body.append(link);
    link.click();
    link.remove();
  }

  async #save(overwrite: boolean): Promise<void> {
    const labels = this.#ctx.labels();
    const session = this.#sessionSelect.value;
    if (!session) return;
    const row = this.#selectedRow();
    if (overwrite && !row) return;
    if (!overwrite) this.#ctx.status(labels.text('saving'));
    const outcome =
      overwrite && row
        ? await this.#saves.saveOver(session, row, this.#description.value)
        : await this.#saves.saveNew(session, this.#description.value);
    if (!outcome.ok) {
      if (!outcome.cancelled) this.#ctx.status(outcome.text, true);
      return;
    }
    this.#ctx.status(labels.text('saveOk'));
    this.#description.value = '';
    await this.refresh();
    this.select(outcome.name);
  }

  async #loadSelected(): Promise<void> {
    const labels = this.#ctx.labels();
    const listing = this.#selectedListing();
    if (!listing?.compatible) return;
    const target = this.#loadTarget.value;
    const outcome = await this.#saves.load(
      listing,
      target ? { kind: 'inPlace', session: target } : { kind: 'newSession' },
      this.#ctx.language(),
    );
    if (!outcome.ok) {
      if (!outcome.cancelled) this.#ctx.status(outcome.text, true);
      return;
    }
    this.#ctx.status(outcome.warnings.length > 0 ? `${labels.text('loadOk')} (${outcome.warnings.join(', ')})` : labels.text('loadOk'));
    const sandbox = !listing.native && listing.header?.session === SANDBOX_SESSION;
    this.#ctx.open(sandbox ? 'tactical' : 'strategic', outcome.session);
  }

  async #deleteSelected(): Promise<void> {
    const labels = this.#ctx.labels();
    const row = this.#selectedRow();
    if (!row) return;
    const outcome = await this.#saves.delete(row);
    if (!outcome.ok) {
      if (!outcome.cancelled) this.#ctx.status(outcome.text, true);
      return;
    }
    this.select(null);
    await this.refresh();
    this.#ctx.status(`${labels.text('delete')}: ${row.name}`);
  }

  async #uploadFile(): Promise<void> {
    const labels = this.#ctx.labels();
    const file = this.#upload.files?.[0];
    this.#upload.value = '';
    if (!file) return;
    const name = uploadName(
      file.name,
      this.#listings.filter((l) => !l.native).map((l) => l.name),
    );
    try {
      const outcome = await uploadSave(name, new Uint8Array(await file.arrayBuffer()));
      const warnings = outcome.warnings.length > 0 ? ` (${outcome.warnings.join(', ')})` : '';
      this.#ctx.status(`${labels.text('upload')}: ${outcome.name}${warnings}`);
      await this.refresh();
      this.select(outcome.name);
    } catch (err) {
      const problem = err instanceof ApiError && err.refused ? `${err.refused}: ` : '';
      this.#ctx.status(`${labels.text('upload')}: ${problem}${(err as Error).message}`, true);
    }
  }
}

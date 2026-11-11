import { LAUNCHER_SAVE_API } from '../../app/launcher/save-panel.ts';
import type { Health, SessionSummary } from '../../ui/client/api-types.ts';
import type { MessageBoxes } from '../../ui/message-boxes.ts';
import { type LoadTarget, SaveController } from '../../ui/saves/save-controller.ts';
import { overwriteTarget, type SaveRow } from '../../ui/saves/save-rows.ts';
import type { Labels } from '../../ui/text/labels.ts';

export interface SessionSavesContext {
  readonly labels: () => Labels;
  readonly health: () => Health | null;
  readonly box: MessageBoxes;
  readonly status: (text: string, error?: boolean) => void;
  readonly selectedRow: () => SaveRow | null;
  readonly saved: (name: string) => Promise<void>;
}

const NEW_SESSION = '';

function element<T extends HTMLElement>(id: string): T {
  const found = document.getElementById(id);
  if (!found) throw new Error(`missing #${id}`);
  return found as T;
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

export class SessionSaves {
  readonly #ctx: SessionSavesContext;
  readonly #sessionSelect = element<HTMLSelectElement>('saveSession');
  readonly #loadTarget = element<HTMLSelectElement>('loadTarget');
  readonly #description = element<HTMLInputElement>('saveDescription');
  readonly #saveNew = element<HTMLButtonElement>('saveNew');
  readonly #saveOver = element<HTMLButtonElement>('saveOver');
  readonly #saves: SaveController;
  #preferredSession: string | null;

  constructor(ctx: SessionSavesContext, preferredSession: string | null) {
    this.#ctx = ctx;
    this.#saves = new SaveController({ labels: ctx.labels, health: ctx.health, box: ctx.box, api: LAUNCHER_SAVE_API });
    this.#preferredSession = preferredSession;
    this.#saveNew.addEventListener('click', () => void this.#save(false));
    this.#saveOver.addEventListener('click', () => void this.#save(true));
    this.#sessionSelect.addEventListener('change', () => {
      this.#preferredSession = this.#sessionSelect.value || null;
      this.updateButtons();
    });
  }

  render(sessions: readonly SessionSummary[]): void {
    const wanted = this.#preferredSession ?? this.#sessionSelect.value;
    const fallback = sessions.at(-1)?.session ?? '';
    const chosen = sessions.some((s) => s.session === wanted) ? wanted : fallback;
    this.#sessionSelect.replaceChildren(...sessions.map((s) => option(s.session, sessionLabel(s), s.session === chosen)));
    const target = this.#loadTarget.value;
    this.#loadTarget.replaceChildren(
      option(NEW_SESSION, 'a new session', target === NEW_SESSION),
      ...sessions.map((s) => option(s.session, sessionLabel(s), s.session === target)),
    );
    this.updateButtons();
  }

  loadTarget(): LoadTarget {
    const session = this.#loadTarget.value;
    return session === NEW_SESSION ? { kind: 'newSession' } : { kind: 'inPlace', session };
  }

  updateButtons(): void {
    const row = this.#ctx.selectedRow();
    const session = this.#sessionSelect.value;
    this.#saveNew.disabled = !session;
    this.#saveOver.disabled = !session || row === null || overwriteTarget(row) === null;
  }

  async #save(overwrite: boolean): Promise<void> {
    const labels = this.#ctx.labels();
    const session = this.#sessionSelect.value;
    if (!session) return;
    const row = this.#ctx.selectedRow();
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
    await this.#ctx.saved(outcome.name);
  }
}

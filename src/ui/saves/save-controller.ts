// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-19. See LICENSE (SFI-SCLA).
// @src src/game/SaveLoadScreen.cc SaveLoadSelectedSave (overwrite asks SLG_CONFIRM_SAVE; one warning box before a load),
// @src ConfirmSavedGameMessageBoxCallBack, ConfirmDeleteSavedGameCallBack (SLG_CONFIRM_DELETE), DoSaveGame, DoQuickSave
// @src (SLG_SAVE_GAME_ERROR), DoneFadeOutForSaveLoadScreen (SLG_LOAD_GAME_ERROR); SaveLoadGame.cc SaveGame (MSG_NODESC for
// @src an empty description, the saving box, sCurrentSavedGameName set by a save) and LoadSavedGame (and by a load).

import type { UiLanguage } from '../../content/text/data-version.ts';
import type { Health, LoadSuccess, LoadWarning, Refusal, SaveListing, SaveSuccess } from '../client/api-types.ts';
import type { MessageBoxes } from '../message-boxes.ts';
import type { Labels } from '../text/labels.ts';
import { clampDescription, loadWarningText, overwriteTarget, predictLoadWarnings, QUICK_SAVE_ALIAS, type SaveRow } from './save-rows.ts';

export interface SaveRequest {
  readonly name?: string;
  readonly description?: string;
}

export interface CreatedSession {
  readonly session: string;
  readonly load: LoadSuccess | null;
}

export interface SessionStart {
  readonly load?: string;
  readonly save?: string;
  readonly language?: UiLanguage;
}

export interface SaveApi {
  save(session: string, request: SaveRequest): Promise<SaveSuccess | Refusal>;
  loadInPlace(session: string, name: string): Promise<LoadSuccess>;
  createSession(start: SessionStart): Promise<CreatedSession>;
  deleteSave(name: string): Promise<boolean>;
}

export interface SavingIndicator {
  begin(): void;
  end(): void;
}

export interface SaveControllerContext {
  readonly labels: () => Labels;
  readonly health: () => Health | null;
  readonly box: MessageBoxes;
  readonly api: SaveApi;
  readonly saving?: SavingIndicator;
  readonly remember?: (name: string) => void;
}

export type LoadTarget = { readonly kind: 'inPlace'; readonly session: string } | { readonly kind: 'newSession' };

export type Failure =
  | { readonly ok: false; readonly cancelled: true }
  | { readonly ok: false; readonly cancelled: false; readonly text: string };
export type SaveOutcome = { readonly ok: true; readonly name: string } | Failure;
export type LoadOutcome =
  | { readonly ok: true; readonly session: string; readonly native: boolean; readonly warnings: readonly LoadWarning[] }
  | Failure;

const IRON_MAN_REFUSAL = 'ironMan';
const AUTO_SAVE_KIND = 'auto';
const CANCELLED: Failure = { ok: false, cancelled: true };

function failed(text: string): Failure {
  return { ok: false, cancelled: false, text };
}

export class SaveController {
  readonly #ctx: SaveControllerContext;

  constructor(ctx: SaveControllerContext) {
    this.#ctx = ctx;
  }

  refusalText(refused: string, reason: string): string {
    const labels = this.#ctx.labels();
    if (refused === IRON_MAN_REFUSAL) return labels.text('ironManCannotSave');
    return `${labels.text('saveError')} (${refused}: ${reason})`;
  }

  async #store(session: string, request: SaveRequest, silent = false): Promise<SaveOutcome> {
    const saving = silent ? undefined : this.#ctx.saving;
    saving?.begin();
    try {
      const outcome = await this.#ctx.api.save(session, request);
      if (!outcome.ok) return failed(this.refusalText(outcome.refused, outcome.reason));
      this.#ctx.remember?.(outcome.name);
      return { ok: true, name: outcome.name };
    } catch (err) {
      return failed(`${this.#ctx.labels().text('saveError')} (${(err as Error).message})`);
    } finally {
      saving?.end();
    }
  }

  saveNew(session: string, description: string): Promise<SaveOutcome> {
    return this.#store(session, { description: this.#describedOrNot(description) });
  }

  #describedOrNot(description: string): string {
    return clampDescription(description).trim() || this.#ctx.labels().text('noDescription');
  }

  quickSave(session: string, silent = false): Promise<SaveOutcome> {
    return this.#store(session, { name: QUICK_SAVE_ALIAS }, silent);
  }

  async saveOver(session: string, row: SaveRow, description = ''): Promise<SaveOutcome> {
    const target = overwriteTarget(row);
    if (!target) return CANCELLED;
    const labels = this.#ctx.labels();
    if (!(await this.#ctx.box.confirm(labels.format('confirmOverwrite', row.description || row.name)))) return CANCELLED;
    return this.#store(session, {
      name: target,
      description: clampDescription(description).trim() || row.description || this.#describedOrNot(''),
    });
  }

  predictedWarnings(listing: SaveListing): LoadWarning[] {
    const health = this.#ctx.health();
    if (listing.native || !listing.header || !health) return [];
    return predictLoadWarnings(listing.header, health, listing.warnings);
  }

  async confirmWarnings(listing: SaveListing): Promise<boolean> {
    const warnings = this.predictedWarnings(listing);
    return warnings.length === 0 || this.#ctx.box.confirm(loadWarningText(this.#ctx.labels(), warnings));
  }

  async load(listing: SaveListing, target: LoadTarget, language: UiLanguage | null = null): Promise<LoadOutcome> {
    if (!listing.compatible) return CANCELLED;
    if (!(await this.confirmWarnings(listing))) return CANCELLED;
    return this.loadConfirmed(listing, target, language);
  }

  async loadConfirmed(listing: SaveListing, target: LoadTarget, language: UiLanguage | null = null): Promise<LoadOutcome> {
    try {
      const loaded = await this.#loadListing(listing, target, language);
      if (listing.native || listing.header?.kind !== AUTO_SAVE_KIND) this.#ctx.remember?.(listing.name);
      return loaded;
    } catch (err) {
      return failed(this.#ctx.labels().format('loadError', (err as Error).message));
    }
  }

  async #loadListing(listing: SaveListing, target: LoadTarget, language: UiLanguage | null): Promise<LoadOutcome> {
    const languagePart = language ? { language } : {};
    if (listing.native) {
      const created = await this.#ctx.api.createSession({ save: listing.name, ...languagePart });
      return { ok: true, session: created.session, native: true, warnings: [] };
    }
    if (target.kind === 'inPlace') {
      const loaded = await this.#ctx.api.loadInPlace(target.session, listing.name);
      return { ok: true, session: target.session, native: false, warnings: loaded.warnings };
    }
    const created = await this.#ctx.api.createSession({ load: listing.name, ...languagePart });
    return { ok: true, session: created.session, native: false, warnings: created.load?.warnings ?? [] };
  }

  async delete(row: SaveRow): Promise<SaveOutcome> {
    if (row.native) return CANCELLED;
    const labels = this.#ctx.labels();
    if (!(await this.#ctx.box.confirm(labels.format('confirmDelete', row.description || row.name)))) return CANCELLED;
    try {
      await this.#ctx.api.deleteSave(row.name);
      return { ok: true, name: row.name };
    } catch (err) {
      return failed((err as Error).message);
    }
  }
}

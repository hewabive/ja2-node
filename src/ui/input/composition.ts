// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-11-09. See LICENSE (SFI-SCLA).
// @src src/sgp/SGP.cc (SDL_EVENT_TEXT_INPUT is queued and SDL_EVENT_TEXT_EDITING is not: nothing of a composition reaches
// @src the game before its commit, the keys the IME takes included), src/sgp/Input.cc TextInput (the committed text as
// @src one TEXT_INPUT event), src/game/Utils/Text_Input.cc SetEditingStatus (SDL_StartTextInput while a field is edited,
// @src SDL_StopTextInput after), HandleTextInput (TEXT_INPUT replaces the selection and goes in character by character).

import type { RawKey, UiTextEvent } from './events.ts';

export const IME_PROCESS_KEY = 'Process';

type EditingListener = (editing: boolean) => void;

export class TextInputState {
  readonly #editing = new Set<object>();
  readonly #listeners = new Set<EditingListener>();

  get editing(): boolean {
    return this.#editing.size > 0;
  }

  set(owner: object, editing: boolean): void {
    const before = this.editing;
    if (editing) this.#editing.add(owner);
    else this.#editing.delete(owner);
    if (this.editing !== before) for (const listener of this.#listeners) listener(this.editing);
  }

  listen(listener: EditingListener): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }
}

export class TextComposition {
  #composing = false;
  readonly #keysToIme = new Set<string>();

  get composing(): boolean {
    return this.#composing;
  }

  start(): void {
    this.#composing = true;
  }

  commit(text: string): UiTextEvent[] {
    this.#composing = false;
    return text.length > 0 ? [{ kind: 'text', text }] : [];
  }

  takesKeyDown(raw: Pick<RawKey, 'key' | 'code'>, imeAttached: boolean): boolean {
    const toIme = this.#composing || (imeAttached && raw.key === IME_PROCESS_KEY);
    if (toIme) this.#keysToIme.add(raw.code);
    else this.#keysToIme.delete(raw.code);
    return toIme;
  }

  takesKeyUp(raw: Pick<RawKey, 'code'>): boolean {
    return this.#keysToIme.delete(raw.code);
  }
}

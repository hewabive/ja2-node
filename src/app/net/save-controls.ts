// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-18. See LICENSE (SFI-SCLA).
// @src src/game/Tactical/Turn_Based_Input.cc (Alt+S quick save, the Iron Man message box; Alt+L quick load);
// @src src/game/Strategic/MapScreen.cc (the same keys on the map screen); src/game/SaveLoadScreen.cc DoQuickSave,
// @src DoQuickLoad (nothing happens without a quick save). See docs/27 §1.8.

import { fetchLabels, type Labels } from '../launcher/labels.ts';
import { QUICK_SAVE_ALIAS, QUICK_SAVE_NAME } from '../launcher/save-rows.ts';
import { loadSettings } from '../settings.ts';
import type { CommandReply, SessionClient } from './session-client.ts';

export type SaveAction = 'save' | 'load';

export interface SaveControlsHook {
  ready: boolean;
  busy: boolean;
  saves: number;
  loads: number;
  last: { action: SaveAction; ok: boolean; text: string } | null;
}

declare global {
  interface Window {
    __ja2SaveKeys: SaveControlsHook;
  }
}

export interface SaveControlsOptions {
  readonly client: () => SessionClient | null;
  readonly show: (text: string, error: boolean) => void;
  readonly toolbar?: HTMLElement | null;
}

const SAVE_KEY = 'KeyS';
const LOAD_KEY = 'KeyL';
const IRON_MAN_REFUSAL = 'ironMan';
const NOT_FOUND = 'notFound';
const EDITABLE = new Set(['INPUT', 'TEXTAREA', 'SELECT']);

interface RefusalData {
  readonly reason?: string;
  readonly warnings?: readonly string[];
}

function refusalReason(reply: CommandReply): string {
  return (reply.data as RefusalData | undefined)?.reason ?? reply.reason ?? 'refused';
}

function saveText(labels: Labels, reply: CommandReply): string {
  if (reply.ok) return labels.text('gameSaved');
  if (reply.reason === IRON_MAN_REFUSAL) return labels.text('ironManCannotSave');
  return `${labels.text('saveError')} (${reply.reason ?? 'refused'}: ${refusalReason(reply)})`;
}

function loadText(labels: Labels, reply: CommandReply): string {
  if (reply.ok) {
    const warnings = (reply.data as RefusalData | undefined)?.warnings ?? [];
    return warnings.length > 0 ? `${labels.text('loadOk')} (${warnings.join(', ')})` : labels.text('loadOk');
  }
  if (reply.reason === NOT_FOUND) return labels.text('noQuickSave');
  return labels.format('loadError', refusalReason(reply));
}

function shortcut(event: KeyboardEvent): SaveAction | null {
  if (!event.altKey || event.ctrlKey || event.metaKey || event.repeat) return null;
  if (event.target instanceof HTMLElement && EDITABLE.has(event.target.tagName)) return null;
  if (event.code === SAVE_KEY) return 'save';
  if (event.code === LOAD_KEY) return 'load';
  return null;
}

function button(text: string, action: SaveAction, run: (action: SaveAction) => Promise<void>): HTMLButtonElement {
  const b = document.createElement('button');
  b.type = 'button';
  b.textContent = text;
  b.dataset.quick = action;
  b.addEventListener('click', () => void run(action));
  return b;
}

function savesLink(text: string, session: () => string | null): HTMLAnchorElement {
  const link = document.createElement('a');
  link.textContent = text;
  link.className = 'saves-link';
  link.href = '/#saves';
  link.addEventListener('click', () => {
    const id = session();
    link.href = id ? `/?session=${encodeURIComponent(id)}#saves` : '/#saves';
  });
  return link;
}

export function installSaveControls(options: SaveControlsOptions): SaveControlsHook {
  const hook: SaveControlsHook = { ready: false, busy: false, saves: 0, loads: 0, last: null };
  window.__ja2SaveKeys = hook;
  let labels: Labels | null = null;

  const run = async (action: SaveAction): Promise<void> => {
    const client = options.client();
    if (!client || !labels || hook.busy) return;
    hook.busy = true;
    try {
      const reply = action === 'save' ? await client.save({ name: QUICK_SAVE_ALIAS }) : await client.load(QUICK_SAVE_NAME);
      const text = action === 'save' ? saveText(labels, reply) : loadText(labels, reply);
      if (action === 'save') hook.saves++;
      else hook.loads++;
      hook.last = { action, ok: reply.ok, text };
      options.show(text, !reply.ok);
    } finally {
      hook.busy = false;
    }
  };

  window.addEventListener('keydown', (event) => {
    const action = shortcut(event);
    if (!action) return;
    event.preventDefault();
    void run(action);
  });

  void fetchLabels(loadSettings().language).then((loaded) => {
    labels = loaded;
    const toolbar = options.toolbar;
    if (toolbar) {
      const group = document.createElement('span');
      group.className = 'group save-controls';
      group.append(
        button(loaded.text('quickSave'), 'save', run),
        button(loaded.text('quickLoad'), 'load', run),
        savesLink(loaded.text('savedGames'), () => options.client()?.session ?? null),
      );
      toolbar.insertBefore(group, toolbar.querySelector('.status'));
    }
    hook.ready = true;
  });
  return hook;
}

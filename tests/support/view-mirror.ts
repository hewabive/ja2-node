import { expect } from 'vitest';
import { predictedFrameSlot } from '../../src/content/anim/schedule-track.ts';
import { type AnimationTimelines, spriteFrameAt } from '../../src/content/anim/timelines.ts';
import { type ServerMessage, TICK_MS } from '../../src/protocol/messages.ts';
import { applyViewFrame, type PlayerView, type SoldierView } from '../../src/protocol/view.ts';
import type { Session } from '../../src/server/session.ts';

type ShownSoldier = Omit<SoldierView, 'frameSlot' | 'nextFrameTick'>;

function shownSoldier(s: SoldierView, timelines: AnimationTimelines | null, tick: number): ShownSoldier {
  const { frameSlot, nextFrameTick: _next, ...rest } = s;
  if (!timelines) return rest;
  return { ...rest, frame: spriteFrameAt(timelines.presentation, predictedFrameSlot(timelines, s, tick, TICK_MS) ?? frameSlot) };
}

export function canonicalView(
  view: PlayerView,
  timelines: AnimationTimelines | null = null,
  tick = view.tick,
): Omit<PlayerView, 'tick' | 'music' | 'soldiers'> & { readonly music: unknown; readonly soldiers: readonly ShownSoldier[] } {
  const { tick: _tick, ...rest } = view;
  return {
    ...rest,
    soldiers: [...view.soldiers].sort((a, b) => a.id - b.id).map((s) => shownSoldier(s, timelines, tick)),
    prompt: view.prompt ?? null,
    contractPrompt: view.contractPrompt ?? null,
    autoresolve: view.autoresolve ?? null,
    shop: view.shop ?? null,
    laptop: view.laptop ?? null,
    conversation: view.conversation ?? null,
    npcRequest: view.npcRequest ?? null,
    scriptedSequence: view.scriptedSequence ?? false,
    meanwhile: view.meanwhile ?? null,
    ended: view.ended ?? null,
    boxing: view.boxing ?? null,
    openDoors: view.openDoors ?? [],
    openContainers: view.openContainers ?? [],
    doors: view.doors ?? [],
    combat: view.combat ?? null,
    revealedRooms: view.revealedRooms ?? [],
    items: view.items ?? [],
    corpses: view.corpses ?? [],
    smoke: view.smoke ?? [],
    light: view.light ?? null,
    tileChanges: view.tileChanges ?? [],
    music: view.music ? { mode: view.music.mode, creature: view.music.creature } : undefined,
  };
}

function currentView(session: Session): PlayerView {
  let view: PlayerView | null = null;
  const unsubscribe = session.subscribe((m) => {
    if (m.t === 'welcome') view = m.view;
  });
  unsubscribe();
  if (!view) throw new Error('the session sent no welcome');
  return view;
}

export class ViewMirror {
  #view: PlayerView | null = null;
  #frames = 0;

  constructor(session: Session) {
    session.subscribe((m) => this.#receive(m));
  }

  get frames(): number {
    return this.#frames;
  }

  #receive(m: ServerMessage): void {
    if (m.t === 'welcome') this.#view = m.view;
    if (m.t !== 'frames' || !this.#view) return;
    for (const frame of m.frames) this.#view = applyViewFrame(this.#view, JSON.parse(JSON.stringify(frame)));
    this.#frames += m.frames.length;
  }

  expectMatches(session: Session): void {
    const mirrored = this.#view;
    if (!mirrored) throw new Error('the mirror saw no welcome');
    const view = currentView(session);
    expect(mirrored.tick).toBeLessThanOrEqual(view.tick);
    const timelines = session.sim.animationTimelines?.() ?? null;
    expect(canonicalView(mirrored, timelines, view.tick), 'the view rebuilt from frames').toEqual(
      canonicalView(JSON.parse(JSON.stringify(view)), timelines),
    );
  }
}

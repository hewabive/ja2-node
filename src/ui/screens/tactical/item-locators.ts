// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-11-03. See LICENSE (SFI-SCLA).
// @src src/game/Tactical/Handle_Items.cc SetItemPoolLocator (a locked locator with flash colour 59 and radio frame 0),
// @src GetFreeFlashItemSlot (the first free of 50 slots), RemoveFlashItemSlot (the first slot of the pool),
// @src RecountFlashItemSlots, HandleFlashingItems (every CYCLERENDERITEMCOLOR 40 ms counter while the clock runs: a locked
// @src locator waits while fLockItemLocators holds, else unlocks; the radio frame steps once more than 80 ms have passed;
// @src the locator ends as its INT8 colour reaches 1, removing the pool's first slot), RenderTopmostFlashingItems (only
// @src unlocked locators); src/game/Tactical/Interface.cc BeginMultiPurposeLocator, HandleMultiPurposeLocator (a frame
// @src once more than 80 ms have passed, 8 cycles of 5 frames), RenderTopmostMultiPurposeLocator.

import { i8 } from '../../../core/int.ts';

export interface TileLocation {
  readonly gridNo: number;
  readonly level: number;
}

export interface ShownLocator extends TileLocation {
  readonly frame: number;
}

const NUM_ITEM_FLASH_SLOTS = 50;
const FLASH_COLOUR_START = 59;
const FLASH_COLOUR_END = 1;
const FLASH_COLOUR_REMOVED = 0;
const CYCLE_RENDER_ITEM_COLOUR_MS = 40;
const RADIO_FRAME_MS = 80;
const RADIO_FRAMES = 5;
const MULTI_PURPOSE_LOCATOR_CYCLES = 8;

interface ItemLocatorSlot extends TileLocation {
  flashColour: number;
  radioFrame: number;
  lastFrameUpdate: number;
  locked: boolean;
}

function sameTile(a: TileLocation, b: TileLocation): boolean {
  return a.gridNo === b.gridNo && a.level === b.level;
}

export class ItemLocators {
  readonly #slots: (ItemLocatorSlot | null)[] = [];
  #cycleDoneAt = 0;

  add(pool: TileLocation, now: number): void {
    const slot = {
      gridNo: pool.gridNo,
      level: pool.level,
      flashColour: FLASH_COLOUR_START,
      radioFrame: 0,
      lastFrameUpdate: now,
      locked: true,
    };
    const free = this.#slots.indexOf(null);
    if (free >= 0) this.#slots[free] = slot;
    else if (this.#slots.length < NUM_ITEM_FLASH_SLOTS) this.#slots.push(slot);
  }

  remove(pool: TileLocation): void {
    const at = this.#slots.findIndex((slot) => slot !== null && sameTile(slot, pool));
    if (at >= 0) this.#slots[at] = null;
  }

  removeWhere(gone: (pool: TileLocation) => boolean): void {
    this.#slots.forEach((slot, k) => {
      if (slot && gone(slot)) this.#slots[k] = null;
    });
    this.#recount();
  }

  unlock(): void {
    for (const slot of this.#slots) if (slot) slot.locked = false;
  }

  step(now: number, locked: boolean, clockPaused: boolean): void {
    if (clockPaused || now < this.#cycleDoneAt) return;
    this.#cycleDoneAt = now + CYCLE_RENDER_ITEM_COLOUR_MS;
    for (const slot of this.#slots) {
      if (!slot) continue;
      if (slot.locked) {
        if (locked) continue;
        slot.locked = false;
      }
      if (now - slot.lastFrameUpdate > RADIO_FRAME_MS) {
        slot.lastFrameUpdate = now;
        if (++slot.radioFrame === RADIO_FRAMES) slot.radioFrame = 0;
      }
      slot.flashColour = i8(slot.flashColour - 1);
      if (slot.flashColour === FLASH_COLOUR_END) {
        slot.flashColour = FLASH_COLOUR_REMOVED;
        this.remove(slot);
      }
    }
    this.#recount();
  }

  shown(): readonly ShownLocator[] {
    return this.#slots.flatMap((slot) =>
      slot && !slot.locked ? [{ gridNo: slot.gridNo, level: slot.level, frame: slot.radioFrame }] : [],
    );
  }

  #recount(): void {
    while (this.#slots.length > 0 && this.#slots[this.#slots.length - 1] === null) this.#slots.pop();
  }
}

export class MultiPurposeLocator {
  #on = false;
  #lastUpdate = 0;
  #frame = 0;
  #cycles = 0;
  #at: TileLocation = { gridNo: 0, level: 0 };

  begin(at: TileLocation): void {
    this.#lastUpdate = 0;
    this.#cycles = 0;
    this.#frame = 0;
    this.#on = true;
    this.#at = at;
  }

  step(now: number): void {
    if (!this.#on || now - this.#lastUpdate <= RADIO_FRAME_MS) return;
    this.#lastUpdate = now;
    if (++this.#frame === RADIO_FRAMES) {
      this.#frame = 0;
      this.#cycles++;
    }
    if (this.#cycles === MULTI_PURPOSE_LOCATOR_CYCLES) this.#on = false;
  }

  shown(): ShownLocator | null {
    return this.#on ? { ...this.#at, frame: this.#frame } : null;
  }
}

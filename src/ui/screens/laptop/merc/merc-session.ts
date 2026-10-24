// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-24. See LICENSE (SFI-SCLA).
// @src src/game/Laptop/Mercs.cc gubCurMercIndex, gubArrivedFromMercSubSite, gusMercVideoSpeckSpeech, EnterInitMercSite (the
// @src files page index cleared on every laptop entry), gfJustHiredAMercMerc; src/game/Laptop/Mercs_Files.cc
// @src BtnMercHireButtonCallback (the arrival box after a hire). See docs/28 §9.5.

import { LaptopMode } from '../laptop-modes.ts';

export const MERC_SUB_PAGES: ReadonlySet<number> = new Set([LaptopMode.MERC_ACCOUNT, LaptopMode.MERC_NO_ACCOUNT, LaptopMode.MERC_FILES]);

export interface MercHireArrival {
  readonly profile: number;
  readonly arrivalMinute: number;
  readonly sector: string;
}

export class MercSession {
  index = 0;
  pendingQuotes: number[] = [];
  arrival: MercHireArrival | null = null;

  takeQuotes(): number[] {
    const quotes = this.pendingQuotes;
    this.pendingQuotes = [];
    return quotes;
  }

  takeArrival(): MercHireArrival | null {
    const arrival = this.arrival;
    this.arrival = null;
    return arrival;
  }
}

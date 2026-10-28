// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-24. See LICENSE (SFI-SCLA).
// @src src/game/Laptop/AIMHistory.cc ChangingAimHistorySubPage, EnterInitAimHistory; AIMPolicies.cc
// @src ChangingAimPoliciesSubPage, EnterInitAimPolicies; AIMArchives.cc ChangingAimArchiveSubPage, EnterInitAimArchives (the
// @src visited flags of each site, reset at every laptop entry, a first visit loads slowly); src/game/Utils/WordWrap.cc
// @src DisplayWrappedString (the height of a wrapped paragraph).

import { u16 } from '../../../../core/int.ts';
import { type BitmapFont, fontHeight } from '../../../text/bitmap-font.ts';
import { lineWrap } from '../../../text/wrap.ts';
import type { LaptopShell } from '../laptop-shell.ts';

export class SubPageVisits {
  readonly #visited: boolean[];

  constructor(count: number, firstVisited: boolean) {
    this.#visited = Array.from({ length: count }, (_, page) => firstVisited && page === 0);
  }

  visit(page: number): boolean {
    const fast = this.#visited[page] === true;
    this.#visited[page] = true;
    return fast;
  }
}

const sessions = new WeakMap<LaptopShell, Map<string, SubPageVisits>>();

export function subPageVisits(shell: LaptopShell, site: string, count: number, firstVisited = false): SubPageVisits {
  const sites = sessions.get(shell) ?? new Map<string, SubPageVisits>();
  sessions.set(shell, sites);
  const known = sites.get(site);
  if (known) return known;
  const fresh = new SubPageVisits(count, firstVisited);
  sites.set(site, fresh);
  return fresh;
}

export function changeSubPage(shell: LaptopShell, visits: SubPageVisits, page: number): void {
  shell.connectToSubPage(visits.visit(page));
}

export function wrappedHeight(font: BitmapFont, width: number, gap: number, text: string): number {
  return lineWrap(font, width, text).length * u16(fontHeight(font) + gap);
}

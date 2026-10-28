// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-19. See LICENSE (SFI-SCLA).
// @src src/game/Laptop/EMail.cc SortMessages (each mail inserted before the first one it orders after, in the current
// @src list order; the direction flags toggled before each sort; READ puts unread mails first), AddMessageToPages and
// @src PlaceMessagesinPages (pages of MAX_MESSAGES_PAGE, the current page clamped), OpenMostRecentUnreadEmail (the unread
// @src mail with the lowest date, the first on a tie), DisplayWhichPageOfEmailProgramIsDisplayed.

import type { LaptopEmailView } from '../../../../protocol/view.ts';

export const MAX_MESSAGES_PAGE = 18;
export const MINUTES_PER_DAY = 1440;

export type EmailSortCriterion = 'received' | 'sender' | 'subject' | 'read';

export interface SortableMail {
  readonly id: number;
  readonly date: number;
  readonly sender: string;
  readonly subject: string;
  readonly read: boolean;
}

function compareCodePoints(a: string, b: string): number {
  const x = [...a];
  const y = [...b];
  for (let i = 0; i < Math.min(x.length, y.length); i++) {
    const d = (x[i]?.codePointAt(0) ?? 0) - (y[i]?.codePointAt(0) ?? 0);
    if (d !== 0) return d;
  }
  return x.length - y.length;
}

export function sortMails<T extends SortableMail>(list: readonly T[], criterion: EmailSortCriterion, upwards: boolean): T[] {
  const order = (mail: T, other: T): number => {
    switch (criterion) {
      case 'received':
        return upwards ? other.date - mail.date : mail.date - other.date;
      case 'sender': {
        const c = compareCodePoints(mail.sender, other.sender);
        return upwards ? -c : c;
      }
      case 'subject': {
        const c = compareCodePoints(mail.subject, other.subject);
        return upwards ? -c : c;
      }
      default:
        return Number(other.read) - Number(mail.read);
    }
  };
  const sorted: T[] = [];
  for (const mail of list) {
    let at = sorted.length;
    for (let i = 0; i < sorted.length; i++) {
      if (order(mail, sorted[i] as T) > 0) {
        at = i;
        break;
      }
    }
    sorted.splice(at, 0, mail);
  }
  return sorted;
}

export class MailOrder {
  #ids: number[] = [];
  readonly #upwards: Record<'received' | 'sender' | 'subject', boolean> = { received: false, sender: false, subject: false };

  sync(mails: readonly LaptopEmailView[]): void {
    const present = new Set(mails.map((m) => m.id));
    const known = new Set(this.#ids);
    this.#ids = [...this.#ids.filter((id) => present.has(id)), ...mails.filter((m) => !known.has(m.id)).map((m) => m.id)];
  }

  ordered<T extends { readonly id: number }>(mails: readonly T[]): T[] {
    const byId = new Map(mails.map((m) => [m.id, m]));
    return this.#ids.flatMap((id) => {
      const mail = byId.get(id);
      return mail ? [mail] : [];
    });
  }

  sort(criterion: EmailSortCriterion, mails: readonly SortableMail[]): void {
    let upwards = false;
    if (criterion !== 'read') {
      this.#upwards[criterion] = !this.#upwards[criterion];
      upwards = this.#upwards[criterion];
    }
    this.#ids = sortMails(this.ordered(mails), criterion, upwards).map((m) => m.id);
  }
}

export function lastListPage(count: number): number {
  return count === 0 ? -1 : Math.ceil(count / MAX_MESSAGES_PAGE) - 1;
}

export function pageLabel(current: number, last: number): { readonly current: number; readonly last: number } {
  return last < 0 ? { current: 1, last: 1 } : { current: current + 1, last: last + 1 };
}

export function oldestUnread(mails: readonly SortableMail[]): number | null {
  let found: SortableMail | null = null;
  for (const mail of mails) if (!mail.read && (found === null || mail.date < found.date)) found = mail;
  return found?.id ?? null;
}

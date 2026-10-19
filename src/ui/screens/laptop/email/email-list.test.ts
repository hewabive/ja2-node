import { describe, expect, it } from 'vitest';
import type { LaptopEmailView } from '../../../../protocol/view.ts';
import { lastListPage, MailOrder, oldestUnread, pageLabel, type SortableMail, sortMails } from './email-list.ts';

function mail(id: number, date: number, sender: string, subject: string, read: boolean): SortableMail {
  return { id, date, sender, subject, read };
}

const MAILS = [
  mail(1, 10, 'Enrico', 'b', true),
  mail(2, 30, 'AIM', 'a', false),
  mail(3, 20, 'Bobby', 'c', true),
  mail(4, 30, 'AIM', 'd', false),
];
const ids = (list: readonly SortableMail[]) => list.map((m) => m.id);

describe('the email list', () => {
  it('inserts each mail before the first one it orders after, as the original sort does', () => {
    expect(ids(sortMails(MAILS, 'received', false))).toEqual([2, 4, 3, 1]);
    expect(ids(sortMails(MAILS, 'received', true))).toEqual([1, 3, 2, 4]);
    expect(ids(sortMails(MAILS, 'sender', false))).toEqual([1, 3, 2, 4]);
    expect(ids(sortMails(MAILS, 'subject', true))).toEqual([2, 1, 3, 4]);
    expect(ids(sortMails(MAILS, 'read', false))).toEqual([2, 4, 1, 3]);
  });

  it('keeps the arrival order until a header is clicked and toggles the direction per header', () => {
    const order = new MailOrder();
    const views = MAILS as unknown as LaptopEmailView[];
    order.sync(views);
    expect(ids(order.ordered(MAILS))).toEqual([1, 2, 3, 4]);
    order.sort('received', MAILS);
    expect(ids(order.ordered(MAILS))).toEqual([1, 3, 2, 4]);
    order.sort('received', MAILS);
    expect(ids(order.ordered(MAILS))).toEqual([2, 4, 3, 1]);
    const arrived = [...MAILS, mail(5, 40, 'Kingpin', 'e', false)];
    order.sync(arrived as unknown as LaptopEmailView[]);
    expect(ids(order.ordered(arrived))).toEqual([2, 4, 3, 1, 5]);
    order.sync(arrived.filter((m) => m.id !== 3) as unknown as LaptopEmailView[]);
    expect(ids(order.ordered(arrived))).toEqual([2, 4, 1, 5]);
  });

  it('pages eighteen mails a page and opens the oldest unread mail first', () => {
    expect(lastListPage(0)).toBe(-1);
    expect(lastListPage(18)).toBe(0);
    expect(lastListPage(19)).toBe(1);
    expect(pageLabel(0, -1)).toEqual({ current: 1, last: 1 });
    expect(pageLabel(1, 2)).toEqual({ current: 2, last: 3 });
    expect(oldestUnread(MAILS)).toBe(2);
    expect(oldestUnread(MAILS.filter((m) => m.read))).toBeNull();
  });
});

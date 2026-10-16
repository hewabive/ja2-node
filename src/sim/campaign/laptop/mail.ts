// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-16. See LICENSE (SFI-SCLA).
// @src src/game/Laptop/EMail.cc AddEmailMessage, AddEmail, AddPreReadEmail, AddEmailWithSpecialData,
// @src HandleAnySpecialEmailMessageEvents, HandleMailSpecialMessages (the bookmarks), DeleteEmail; Laptop/EMail.h (offsets,
// @src senders). See docs/21 §6.1.

import { FormatError } from '../../../content/binary/errors.ts';
import type { LaptopContent } from '../../../content/strategic/laptop-content.ts';
import { i32, u8, u16, u32 } from '../../../core/int.ts';
import { Bookmark, type Email, type LaptopState, setBookmark } from './laptop-state.ts';

export interface MailSpec {
  readonly name: string;
  readonly offset: number;
  readonly length: number;
}

const LENGTH_NAMES: Readonly<Record<string, string>> = {
  MERC_UP_LEVEL_BIFF: 'MERC_UP_LEVEL_LENGTH_BIFF',
  AIM_REPLY_BARRY: 'AIM_REPLY_LENGTH_BARRY',
};
const IMP_BOOKMARK_MAILS = ['IMP_EMAIL_INTRO', 'IMP_EMAIL_AGAIN'];
const MERC_BOOKMARK_MAILS = ['MERC_INTRO', 'MERC_NEW_SITE_ADDRESS'];
const SERIES = [
  { first: 'MERC_UP_LEVEL_BIFF', count: 10, name: 'MERC_UP_LEVEL' },
  { first: 'AIM_REPLY_BARRY', count: 40, name: 'AIM_REPLY' },
] as const;
const LENGTH_SUFFIX = '_LENGTH';

function lookup(content: LaptopContent, name: string): number {
  const value = content.mail[name];
  if (value === undefined) throw new FormatError(`unknown mail define ${name}`);
  return value;
}

export function mailSpec(content: LaptopContent, name: string, index = 0): MailSpec {
  const length = lookup(content, LENGTH_NAMES[name] ?? `${name}${LENGTH_SUFFIX}`);
  return { name, offset: lookup(content, name) + index * length, length };
}

export function sender(content: LaptopContent, name: string): number {
  const value = content.senders[name];
  if (value === undefined) throw new FormatError(`unknown mail sender ${name}`);
  return value;
}

export function addEmail(l: LaptopState, spec: MailSpec, from: number, date: number, firstData = 0, secondData = 0, read = false): Email {
  const mail: Email = {
    id: l.nextEmailId++,
    offset: u16(spec.offset),
    length: u16(spec.length),
    sender: u8(from),
    date: u32(date),
    firstData: i32(firstData),
    secondData: u32(secondData),
    read,
  };
  l.emails.push(mail);
  return mail;
}

export function findEmail(l: LaptopState, id: number): Email | undefined {
  return l.emails.find((m) => m.id === id);
}

export function readEmail(content: LaptopContent, l: LaptopState, mail: Email): void {
  mail.read = true;
  if (IMP_BOOKMARK_MAILS.some((name) => lookup(content, name) === mail.offset)) setBookmark(l, Bookmark.IMP);
  if (MERC_BOOKMARK_MAILS.some((name) => lookup(content, name) === mail.offset)) setBookmark(l, Bookmark.MERC);
}

export function deleteEmail(l: LaptopState, id: number): boolean {
  const at = l.emails.findIndex((m) => m.id === id);
  if (at < 0) return false;
  l.emails.splice(at, 1);
  return true;
}

export interface MailType {
  readonly type: string;
  readonly index?: number;
}

export function mailType(content: LaptopContent, offset: number): MailType {
  for (const s of SERIES) {
    const first = mailSpec(content, s.first);
    const k = (offset - first.offset) / first.length;
    if (Number.isInteger(k) && k >= 0 && k < s.count) return { type: s.name, index: k };
  }
  for (const [name, value] of Object.entries(content.mail)) {
    if (name.includes(LENGTH_SUFFIX) || value !== offset) continue;
    return { type: name };
  }
  return { type: 'UNKNOWN' };
}

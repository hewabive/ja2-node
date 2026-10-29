import type { CatalogueItem } from '../../../protocol/items.ts';
import type { MessageArg, MessageEntry } from '../../../protocol/message-log.ts';
import { sprintMoney } from '../../text/money.ts';
import { printf } from '../../text/printf.ts';
import type { UiTextService } from '../../text/text-service.ts';

export interface MessageFormatSources {
  readonly text: UiTextService;
  readonly itemByIndex: (index: number) => CatalogueItem | null;
}

const DIRECTIVE = /%(%|s|d|u|i)/g;

function argText(arg: MessageArg, sources: MessageFormatSources): string | number {
  if ('text' in arg) return arg.text;
  if ('number' in arg) return arg.number;
  if ('money' in arg) return sprintMoney(arg.money);
  if ('string' in arg) return sources.text.string(arg.string.table, arg.string.index) ?? '';
  const item = sources.itemByIndex(arg.item);
  return (arg.name === 'short' ? item?.shortName : item?.longName) ?? '';
}

function directiveCount(template: string): number {
  let count = 0;
  for (const m of template.matchAll(DIRECTIVE)) if (m[1] !== '%') count++;
  return count;
}

function entryText(entry: MessageEntry, sources: MessageFormatSources): string {
  const args = (entry.args ?? []).map((a) => argText(a, sources));
  if (entry.table === undefined || entry.index === undefined) return args.map(String).join(' ');
  const template = sources.text.string(entry.table, entry.index) ?? '';
  const used = directiveCount(template);
  const extra = args.slice(used).map(String);
  const body = printf(template, args);
  return extra.length > 0 ? [body, ...extra].join(' ') : body;
}

export function formatMessageEntry(entry: MessageEntry, sources: MessageFormatSources): string {
  const text = entryText(entry, sources);
  return entry.quoted ? `"${text}"` : text;
}

export function showsInTacticalLog(entry: MessageEntry): boolean {
  return entry.kind !== 'dialog';
}

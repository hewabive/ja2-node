export const MESSAGE_LOG_SIZE = 256;

export type MessageKind = 'interface' | 'dialog' | 'uiFeedback' | 'skullFeedback';

export interface MessageStringRef {
  readonly table: string;
  readonly index: number;
}

export type MessageArg =
  | { readonly text: string }
  | { readonly number: number }
  | { readonly money: number }
  | { readonly string: MessageStringRef }
  | { readonly item: number; readonly name: 'short' | 'long' };

export interface MessageTextKey {
  readonly file: string;
  readonly row: number;
  readonly width: number;
}

export interface MessageEntry {
  readonly tick: number;
  readonly kind: MessageKind;
  readonly colour: number;
  readonly table?: string;
  readonly index?: number;
  readonly textKey?: MessageTextKey;
  readonly speaker?: number;
  readonly args?: readonly MessageArg[];
  readonly quoted?: true;
}

export const GAME_SAVED_MESSAGE: MessageStringRef = { table: 'pMessageStrings', index: 8 };

export function isSessionMessage(entry: Pick<MessageEntry, 'table' | 'index'>): boolean {
  return entry.table === GAME_SAVED_MESSAGE.table && entry.index === GAME_SAVED_MESSAGE.index;
}

export function storedInLog(entry: MessageEntry): boolean {
  return entry.kind === 'interface' || entry.kind === 'dialog';
}

export function appendToLog(log: readonly MessageEntry[], added: readonly MessageEntry[]): MessageEntry[] {
  const kept = [...log, ...added.filter(storedInLog)];
  return kept.length > MESSAGE_LOG_SIZE ? kept.slice(kept.length - MESSAGE_LOG_SIZE) : kept;
}

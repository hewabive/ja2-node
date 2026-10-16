import { FormatError } from '../binary/errors.ts';

const QUOTE = '"';
const BACKSLASH = '\\';

function stripComments(text: string): string {
  let out = '';
  let i = 0;
  let inString = false;
  while (i < text.length) {
    const c = text[i] ?? '';
    const next = text[i + 1] ?? '';
    if (inString) {
      out += c;
      if (c === BACKSLASH) {
        out += next;
        i += 2;
        continue;
      }
      if (c === QUOTE) inString = false;
      i++;
      continue;
    }
    if (c === QUOTE) {
      inString = true;
      out += c;
      i++;
    } else if (c === '/' && next === '/') {
      while (i < text.length && text[i] !== '\n') i++;
    } else if (c === '/' && next === '*') {
      const end = text.indexOf('*/', i + 2);
      if (end < 0) throw new FormatError('unterminated block comment');
      i = end + 2;
    } else {
      out += c;
      i++;
    }
  }
  return out;
}

export function parseJsonc(text: string): unknown {
  return JSON.parse(stripComments(text));
}

export function parseJsoncBytes(bytes: Uint8Array): unknown {
  return parseJsonc(new TextDecoder().decode(bytes));
}

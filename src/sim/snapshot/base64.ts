const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const PAD = '=';
const CHUNK_BYTES = 3 * 4096;
const LOOKUP = new Int16Array(128).fill(-1);
for (let i = 0; i < ALPHABET.length; i++) LOOKUP[ALPHABET.charCodeAt(i)] = i;

function sextet(text: string, i: number): number {
  const code = text.charCodeAt(i);
  const value = code < LOOKUP.length ? (LOOKUP[code] ?? -1) : -1;
  if (value < 0) throw new SyntaxError(`invalid base64 character at ${i}`);
  return value;
}

function letter(index: number): string {
  return ALPHABET.charAt(index);
}

function encodeChunk(bytes: Uint8Array, start: number, end: number): string {
  let out = '';
  let i = start;
  for (; i + 2 < end; i += 3) {
    const n = ((bytes[i] ?? 0) << 16) | ((bytes[i + 1] ?? 0) << 8) | (bytes[i + 2] ?? 0);
    out += letter(n >>> 18) + letter((n >>> 12) & 63) + letter((n >>> 6) & 63) + letter(n & 63);
  }
  const rest = end - i;
  if (rest === 1) {
    const n = (bytes[i] ?? 0) << 16;
    out += letter(n >>> 18) + letter((n >>> 12) & 63) + PAD + PAD;
  } else if (rest === 2) {
    const n = ((bytes[i] ?? 0) << 16) | ((bytes[i + 1] ?? 0) << 8);
    out += letter(n >>> 18) + letter((n >>> 12) & 63) + letter((n >>> 6) & 63) + PAD;
  }
  return out;
}

export function encodeBase64(bytes: Uint8Array): string {
  const parts: string[] = [];
  for (let start = 0; start < bytes.length; start += CHUNK_BYTES)
    parts.push(encodeChunk(bytes, start, Math.min(bytes.length, start + CHUNK_BYTES)));
  return parts.join('');
}

export function decodeBase64(text: string): Uint8Array {
  if (text.length % 4 !== 0) throw new SyntaxError('base64 length must be a multiple of 4');
  const padding = text.endsWith(PAD + PAD) ? 2 : text.endsWith(PAD) ? 1 : 0;
  const out = new Uint8Array((text.length / 4) * 3 - padding);
  let o = 0;
  for (let i = 0; i < text.length; i += 4) {
    const last = i + 4 === text.length;
    const c = last && padding === 2 ? 0 : sextet(text, i + 2);
    const d = last && padding >= 1 ? 0 : sextet(text, i + 3);
    const n = (sextet(text, i) << 18) | (sextet(text, i + 1) << 12) | (c << 6) | d;
    out[o++] = n >>> 16;
    if (o < out.length) out[o++] = (n >>> 8) & 255;
    if (o < out.length) out[o++] = n & 255;
  }
  return out;
}

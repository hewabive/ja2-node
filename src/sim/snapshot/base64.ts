const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const PAD = 61;
const ENCODE = Uint8Array.from(ALPHABET, (c) => c.charCodeAt(0));
const DECODE = new Int16Array(256).fill(-1);
for (let i = 0; i < ENCODE.length; i++) DECODE[ENCODE[i] ?? 0] = i;
const ASCII = new TextDecoder();
const BYTES = new TextEncoder();

export function encodeBase64(bytes: Uint8Array): string {
  const n = bytes.length;
  const out = new Uint8Array(Math.ceil(n / 3) * 4);
  let o = 0;
  let i = 0;
  for (; i + 2 < n; i += 3) {
    const v = ((bytes[i] ?? 0) << 16) | ((bytes[i + 1] ?? 0) << 8) | (bytes[i + 2] ?? 0);
    out[o++] = ENCODE[v >>> 18] ?? 0;
    out[o++] = ENCODE[(v >>> 12) & 63] ?? 0;
    out[o++] = ENCODE[(v >>> 6) & 63] ?? 0;
    out[o++] = ENCODE[v & 63] ?? 0;
  }
  if (i < n) {
    const two = i + 1 < n;
    const v = ((bytes[i] ?? 0) << 16) | (two ? (bytes[i + 1] ?? 0) << 8 : 0);
    out[o++] = ENCODE[v >>> 18] ?? 0;
    out[o++] = ENCODE[(v >>> 12) & 63] ?? 0;
    out[o++] = two ? (ENCODE[(v >>> 6) & 63] ?? 0) : PAD;
    out[o++] = PAD;
  }
  return ASCII.decode(out);
}

function sextet(codes: Uint8Array, i: number): number {
  const value = DECODE[codes[i] ?? 0] ?? -1;
  if (value < 0) throw new SyntaxError(`invalid base64 character at ${i}`);
  return value;
}

export function decodeBase64(text: string): Uint8Array {
  const codes = BYTES.encode(text);
  if (codes.length !== text.length || codes.length % 4 !== 0) throw new SyntaxError('base64 text must be ASCII in groups of 4');
  const padding = codes[codes.length - 1] === PAD ? (codes[codes.length - 2] === PAD ? 2 : 1) : 0;
  const out = new Uint8Array((codes.length / 4) * 3 - padding);
  const full = codes.length - (padding > 0 ? 4 : 0);
  let o = 0;
  let i = 0;
  for (; i < full; i += 4) {
    const v = (sextet(codes, i) << 18) | (sextet(codes, i + 1) << 12) | (sextet(codes, i + 2) << 6) | sextet(codes, i + 3);
    out[o++] = v >>> 16;
    out[o++] = (v >>> 8) & 255;
    out[o++] = v & 255;
  }
  if (padding > 0) {
    const third = padding === 1 ? sextet(codes, i + 2) << 6 : 0;
    const v = (sextet(codes, i) << 18) | (sextet(codes, i + 1) << 12) | third;
    out[o++] = v >>> 16;
    if (padding === 1) out[o++] = (v >>> 8) & 255;
  }
  return out;
}

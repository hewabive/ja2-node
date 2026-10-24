const ROUND_CONSTANTS = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be,
  0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa,
  0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967, 0x27b70a85,
  0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3,
  0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070, 0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f,
  0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);
const INITIAL_STATE = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];
const BLOCK_BYTES = 64;
const BLOCK_WORDS = 16;
const SCHEDULE_WORDS = 64;
const WORD_BYTES = 4;
const LENGTH_BYTES = 8;
const BITS_PER_BYTE = 8;
const TWO_POW_32 = 0x1_0000_0000;
const END_MARKER = 0x80;
const HEX_RADIX = 16;
const WORD_HEX_DIGITS = 8;

function rotr(x: number, n: number): number {
  return (x >>> n) | (x << (32 - n));
}

function at(words: Uint32Array, i: number): number {
  return words[i] ?? 0;
}

function padded(bytes: Uint8Array): DataView {
  const total = Math.ceil((bytes.length + 1 + LENGTH_BYTES) / BLOCK_BYTES) * BLOCK_BYTES;
  const out = new Uint8Array(total);
  out.set(bytes);
  out[bytes.length] = END_MARKER;
  const view = new DataView(out.buffer);
  const bits = bytes.length * BITS_PER_BYTE;
  view.setUint32(total - LENGTH_BYTES, Math.floor(bits / TWO_POW_32));
  view.setUint32(total - WORD_BYTES, bits >>> 0);
  return view;
}

function expandSchedule(schedule: Uint32Array, message: DataView, offset: number): void {
  for (let i = 0; i < BLOCK_WORDS; i++) schedule[i] = message.getUint32(offset + i * WORD_BYTES);
  for (let i = BLOCK_WORDS; i < SCHEDULE_WORDS; i++) {
    const back15 = at(schedule, i - 15);
    const back2 = at(schedule, i - 2);
    const sigma0 = rotr(back15, 7) ^ rotr(back15, 18) ^ (back15 >>> 3);
    const sigma1 = rotr(back2, 17) ^ rotr(back2, 19) ^ (back2 >>> 10);
    schedule[i] = at(schedule, i - 16) + sigma0 + at(schedule, i - 7) + sigma1;
  }
}

function compress(state: Uint32Array, schedule: Uint32Array): void {
  let a = at(state, 0);
  let b = at(state, 1);
  let c = at(state, 2);
  let d = at(state, 3);
  let e = at(state, 4);
  let f = at(state, 5);
  let g = at(state, 6);
  let h = at(state, 7);
  for (let i = 0; i < SCHEDULE_WORDS; i++) {
    const sum1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
    const choice = (e & f) ^ (~e & g);
    const t1 = (h + sum1 + choice + at(ROUND_CONSTANTS, i) + at(schedule, i)) | 0;
    const sum0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
    const majority = (a & b) ^ (a & c) ^ (b & c);
    const t2 = (sum0 + majority) | 0;
    h = g;
    g = f;
    f = e;
    e = (d + t1) | 0;
    d = c;
    c = b;
    b = a;
    a = (t1 + t2) | 0;
  }
  [a, b, c, d, e, f, g, h].forEach((word, i) => {
    state[i] = at(state, i) + word;
  });
}

export function sha256Hex(bytes: Uint8Array): string {
  const message = padded(bytes);
  const state = Uint32Array.from(INITIAL_STATE);
  const schedule = new Uint32Array(SCHEDULE_WORDS);
  for (let offset = 0; offset < message.byteLength; offset += BLOCK_BYTES) {
    expandSchedule(schedule, message, offset);
    compress(state, schedule);
  }
  return [...state].map((word) => word.toString(HEX_RADIX).padStart(WORD_HEX_DIGITS, '0')).join('');
}

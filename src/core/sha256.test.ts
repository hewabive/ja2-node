import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { Rng } from './rng.ts';
import { sha256Hex } from './sha256.ts';

function nodeSha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function randomBytes(length: number, seed: number): Uint8Array {
  const rng = Rng.fromSeed(seed);
  return Uint8Array.from({ length }, () => rng.nextU32() & 0xff);
}

describe('sha256Hex', () => {
  it('matches the published test vectors', () => {
    expect(sha256Hex(new Uint8Array())).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
    expect(sha256Hex(new TextEncoder().encode('abc'))).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });

  it('matches node:crypto around the padding boundaries and on a large input', () => {
    for (const length of [1, 55, 56, 57, 63, 64, 65, 119, 120, 127, 128, 1000, 300_000]) {
      const bytes = randomBytes(length, length);
      expect(sha256Hex(bytes), `length ${length}`).toBe(nodeSha256(bytes));
    }
  });

  it('hashes only the viewed bytes of a subarray', () => {
    const whole = randomBytes(200, 3);
    const part = whole.subarray(17, 150);
    expect(sha256Hex(part)).toBe(nodeSha256(part));
  });
});

// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-18. See LICENSE (SFI-SCLA).
// @src src/game/Tactical/Gap.cc AudioGapListInit, PollAudioGap; src/game/Tactical/Gap.h AUDIO_GAP.

export const GAP_EXTENSION = 'gap';
export const AUDIO_GAP_BYTES = 8;
const U32_BYTES = 4;

export interface AudioGap {
  readonly start: number;
  readonly end: number;
}

export function gapPathFor(soundPath: string): string {
  const dot = soundPath.lastIndexOf('.');
  const slash = soundPath.lastIndexOf('/');
  return `${dot > slash ? soundPath.slice(0, dot) : soundPath}.${GAP_EXTENSION}`;
}

export function parseGap(bytes: Uint8Array): AudioGap[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const count = Math.floor(bytes.length / AUDIO_GAP_BYTES);
  return Array.from({ length: count }, (_, i) => ({
    start: view.getUint32(i * AUDIO_GAP_BYTES, true),
    end: view.getUint32(i * AUDIO_GAP_BYTES + U32_BYTES, true),
  }));
}

export function encodeGap(gaps: readonly AudioGap[]): Uint8Array {
  const out = new Uint8Array(gaps.length * AUDIO_GAP_BYTES);
  const view = new DataView(out.buffer);
  gaps.forEach((gap, i) => {
    view.setUint32(i * AUDIO_GAP_BYTES, gap.start, true);
    view.setUint32(i * AUDIO_GAP_BYTES + U32_BYTES, gap.end, true);
  });
  return out;
}

export function inAudioGap(gaps: readonly AudioGap[], timeMs: number): boolean {
  const current = gaps.find((gap) => timeMs <= gap.end);
  return current !== undefined && current.start < timeMs && timeMs < current.end;
}

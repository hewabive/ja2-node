export function hexDump(bytes: Uint8Array, limit = 1024): string {
  const lines: string[] = [];
  for (let off = 0; off < Math.min(bytes.length, limit); off += 16) {
    const row = bytes.subarray(off, Math.min(off + 16, bytes.length));
    const hex = [...row].map((b) => b.toString(16).padStart(2, '0')).join(' ');
    const ascii = [...row].map((b) => (b >= 32 && b < 127 ? String.fromCharCode(b) : '.')).join('');
    lines.push(`${off.toString(16).padStart(8, '0')}  ${hex.padEnd(47)}  ${ascii}`);
  }
  if (bytes.length > limit) lines.push(`… ${bytes.length - limit} more bytes`);
  return lines.join('\n');
}

import type { FileHandle } from 'node:fs/promises';

export async function readExactly(handle: FileHandle, position: number, length: number): Promise<Uint8Array<ArrayBuffer>> {
  const buf = new Uint8Array(length);
  let done = 0;
  while (done < length) {
    const { bytesRead } = await handle.read(buf, done, length - done, position + done);
    if (bytesRead === 0) throw new Error(`unexpected end of file at ${position + done}`);
    done += bytesRead;
  }
  return buf;
}

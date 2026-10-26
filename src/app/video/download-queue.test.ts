import { describe, expect, it } from 'vitest';
import { downloadInOrder, unlessAborted } from './download-queue.ts';

interface Pending {
  readonly path: string;
  resolve(bytes: Uint8Array | null): void;
  reject(err: Error): void;
}

function fakeServer(): { readonly fetch: (path: string) => Promise<Uint8Array | null>; readonly started: Pending[] } {
  const started: Pending[] = [];
  return {
    started,
    fetch: (path) =>
      new Promise((resolve, reject) => {
        started.push({ path, resolve, reject });
      }),
  };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
const bytes = (n: number) => new Uint8Array([n]);

describe('video downloads in sequence order', () => {
  it('starts every download as soon as the one before it arrives, before anyone asks for it', async () => {
    const server = fakeServer();
    downloadInOrder(['a.smk', 'b.smk', 'c.smk'], server.fetch);
    await settle();
    expect(server.started.map((p) => p.path)).toEqual(['a.smk']);
    server.started[0]?.resolve(bytes(1));
    await settle();
    expect(server.started.map((p) => p.path)).toEqual(['a.smk', 'b.smk']);
    server.started[1]?.resolve(null);
    await settle();
    expect(server.started.map((p) => p.path)).toEqual(['a.smk', 'b.smk', 'c.smk']);
  });

  it('hands each queued download out once and fetches anew afterwards or for a path it never queued', async () => {
    const server = fakeServer();
    const downloads = downloadInOrder(['a.smk'], server.fetch);
    await settle();
    server.started[0]?.resolve(bytes(1));
    expect(await downloads.fetch('a.smk')).toEqual(bytes(1));
    void downloads.fetch('a.smk');
    void downloads.fetch('z.smk');
    await settle();
    expect(server.started.map((p) => p.path)).toEqual(['a.smk', 'a.smk', 'z.smk']);
  });

  it('goes on after a failed download and reports the failure to whoever asks for that one', async () => {
    const server = fakeServer();
    const downloads = downloadInOrder(['a.smk', 'b.smk'], server.fetch);
    await settle();
    server.started[0]?.reject(new Error('HTTP 500'));
    await settle();
    expect(server.started.map((p) => p.path)).toEqual(['a.smk', 'b.smk']);
    await expect(downloads.fetch('a.smk')).rejects.toThrow('HTTP 500');
  });

  it('starts nothing new once stopped and lets the running download finish', async () => {
    const server = fakeServer();
    const downloads = downloadInOrder(['a.smk', 'b.smk'], server.fetch);
    await settle();
    downloads.stop();
    server.started[0]?.resolve(bytes(1));
    await settle();
    expect(server.started.map((p) => p.path)).toEqual(['a.smk']);
  });
});

describe('waiting for a download unless the video was skipped', () => {
  it('answers the value when it arrives first', async () => {
    expect(await unlessAborted(Promise.resolve(7), new AbortController().signal)).toEqual({ value: 7 });
  });

  it('answers null at once when the signal aborts first, without waiting for the work', async () => {
    const controller = new AbortController();
    const waiting = unlessAborted(new Promise<number>(() => {}), controller.signal);
    controller.abort();
    expect(await waiting).toBeNull();
  });

  it('answers null for an already aborted signal even when the work is done', async () => {
    const controller = new AbortController();
    controller.abort();
    expect(await unlessAborted(Promise.resolve(7), controller.signal)).toBeNull();
  });

  it('passes a failure on when it comes first and swallows one that comes after the skip', async () => {
    await expect(unlessAborted(Promise.reject(new Error('gone')), new AbortController().signal)).rejects.toThrow('gone');
    const controller = new AbortController();
    let fail: (err: Error) => void = () => {};
    const waiting = unlessAborted(
      new Promise<number>((_, reject) => {
        fail = reject;
      }),
      controller.signal,
    );
    controller.abort();
    fail(new Error('late'));
    expect(await waiting).toBeNull();
  });
});

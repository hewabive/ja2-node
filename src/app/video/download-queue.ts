import type { FetchVideo } from './player.ts';

export interface VideoDownloads {
  readonly fetch: FetchVideo;
  stop(): void;
}

export function downloadInOrder(paths: readonly string[], fetchVideo: FetchVideo): VideoDownloads {
  let stopped = false;
  const queued = new Map<string, Promise<Uint8Array | null>>();
  let previous: Promise<unknown> = Promise.resolve();
  for (const path of paths) {
    if (queued.has(path)) continue;
    const download = previous.then(() => (stopped ? null : fetchVideo(path)));
    queued.set(path, download);
    previous = download.catch(() => null);
  }
  return {
    fetch: (path) => {
      const download = queued.get(path);
      queued.delete(path);
      return download ?? fetchVideo(path);
    },
    stop: () => {
      stopped = true;
    },
  };
}

export function unlessAborted<T>(work: Promise<T>, signal: AbortSignal): Promise<{ readonly value: T } | null> {
  return new Promise((resolve, reject) => {
    const abandon = () => resolve(null);
    work.then(
      (value) => {
        signal.removeEventListener('abort', abandon);
        resolve({ value });
      },
      (err: unknown) => {
        signal.removeEventListener('abort', abandon);
        reject(err);
      },
    );
    if (signal.aborted) abandon();
    else signal.addEventListener('abort', abandon, { once: true });
  });
}

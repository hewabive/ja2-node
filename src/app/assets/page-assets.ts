import { HttpAssetSource } from './asset-source.ts';

let opening: Promise<HttpAssetSource> | null = null;

export function pageAssetSource(): Promise<HttpAssetSource> {
  opening ??= HttpAssetSource.open().catch((err: unknown) => {
    opening = null;
    throw err;
  });
  return opening;
}

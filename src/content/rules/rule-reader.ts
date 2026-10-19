import { normalizeVfsPath } from '../vfs/path.ts';
import type { ReadFile } from '../world/tileset-loader.ts';
import { isRuleFile } from './families.ts';
import { encodeGraphicFacts, graphicFactsOf, graphicOfFactsPath, isGraphicFactsPath } from './graphic-facts.ts';
import { NotARuleFileError, type RuleListingEntry } from './pack.ts';

export interface RuleReader {
  readonly read: ReadFile;
  exists(path: string): boolean;
  layers(path: string): number;
}

export function liveRuleReader(listing: readonly RuleListingEntry[], readListed: (path: string) => Promise<Uint8Array>): RuleReader {
  const listed = new Map(listing.map((e) => [normalizeVfsPath(e.path), e]));
  const facts = new Map<string, Promise<Uint8Array>>();
  const factsOf = (graphic: string): Promise<Uint8Array> => {
    let pending = facts.get(graphic);
    if (!pending) {
      pending = readListed(graphic).then((bytes) => encodeGraphicFacts(graphicFactsOf(graphic, bytes)));
      facts.set(graphic, pending);
    }
    return pending;
  };
  const listedRule = (path: string): string | null => {
    const normalized = normalizeVfsPath(path);
    if (isGraphicFactsPath(normalized)) return listed.has(graphicOfFactsPath(normalized)) ? normalized : null;
    if (isRuleFile(normalized)) return listed.has(normalized) ? normalized : null;
    throw new NotARuleFileError(path);
  };
  return {
    read: async (path) => {
      const found = listedRule(path);
      if (found === null) return null;
      return isGraphicFactsPath(found) ? factsOf(graphicOfFactsPath(found)) : readListed(found);
    },
    exists: (path) => listedRule(path) !== null,
    layers: (path) => listed.get(normalizeVfsPath(path))?.layers ?? 0,
  };
}

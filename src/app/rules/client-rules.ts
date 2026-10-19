import {
  type RuleListingWithHash,
  type RuleSource,
  rulePackHash,
  rulePackIdentityOfListing,
  type Sha256,
  scriptsHashOfListing,
} from '../../content/rules/pack.ts';
import { liveRuleReader, type RuleReader } from '../../content/rules/rule-reader.ts';
import { type AssetManifest, entryLayers } from '../../protocol/assets.ts';
import type { RulePackIdentityView } from '../../protocol/messages.ts';
import type { AssetSource } from '../assets/asset-source.ts';

const HEX_RADIX = 16;
const BYTE_HEX_DIGITS = 2;

export interface RulesCheck {
  readonly expected: RulePackIdentityView;
  readonly actual: RulePackIdentityView;
  readonly packMatches: boolean;
  readonly scriptsMatch: boolean;
}

export interface ClientRules extends RuleReader {
  readonly check: RulesCheck;
}

export interface ClientRulesOptions {
  readonly sha256?: Sha256;
  readonly onMismatch?: (check: RulesCheck) => void;
}

export const subtleSha256: Sha256 = async (bytes) => {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new Uint8Array(bytes)));
  return [...digest].map((b) => b.toString(HEX_RADIX).padStart(BYTE_HEX_DIGITS, '0')).join('');
};

export function manifestRuleListing(manifest: AssetManifest): RuleListingWithHash[] {
  return manifest.files.map((e) => ({ path: e[0], size: e[1], hash: e[2], layers: entryLayers(e) }));
}

export async function clientRulePackIdentity(source: AssetSource, sha256: Sha256 = subtleSha256): Promise<RulePackIdentityView> {
  const listing = manifestRuleListing(source.manifest);
  const ruleSource: RuleSource = source.manifest.source;
  const identity = await rulePackIdentityOfListing(ruleSource, listing, (path) => source.read(path));
  return { pack: await rulePackHash(identity, sha256), scripts: scriptsHashOfListing(listing) };
}

export async function loadClientRules(
  source: AssetSource,
  expected: RulePackIdentityView,
  options: ClientRulesOptions = {},
): Promise<ClientRules> {
  const actual = await clientRulePackIdentity(source, options.sha256);
  const check: RulesCheck = {
    expected,
    actual,
    packMatches: actual.pack === expected.pack,
    scriptsMatch: actual.scripts === expected.scripts,
  };
  if (!check.packMatches || !check.scriptsMatch) options.onMismatch?.(check);
  const reader = liveRuleReader(manifestRuleListing(source.manifest), (path) => source.read(path));
  return { ...reader, check };
}

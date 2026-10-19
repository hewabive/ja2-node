export const COMPRESSION_REFUSALS = {
  noMercsHired: 'no merc has been hired yet',
  meanwhileStarting: 'a meanwhile scene is about to start',
  noUsableMercs: 'no usable mercs are left on the team',
  inCombat: 'combat is in progress',
  enemiesPresent: 'enemies are present in the loaded sector',
  creatureMine: 'mercs are in a creature-infested mine',
  bloodcatAmbush: 'bloodcats are attacking',
  contractRenewal: 'the contract renewal sequence is on',
  pauseLocked: 'the game is paused',
} as const;

export type CompressionRefusal = keyof typeof COMPRESSION_REFUSALS;

const TOKEN_OF_REASON: ReadonlyMap<string, CompressionRefusal> = new Map(
  (Object.entries(COMPRESSION_REFUSALS) as [CompressionRefusal, string][]).map(([token, reason]) => [reason, token]),
);
const OTHER_REFUSAL = 'compressionRefused';

export function compressionRefusalToken(reason: string): string {
  return TOKEN_OF_REASON.get(reason) ?? OTHER_REFUSAL;
}

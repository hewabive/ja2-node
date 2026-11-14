import { refusalMessage, refusalOf } from '../protocol/refusals.ts';

export interface RefusableReply {
  readonly ok: boolean;
  readonly reason?: string;
  readonly data?: unknown;
}

export type RefusalListener = (reply: RefusableReply) => void;

const IGNORED_BY_THE_LOCKED_INPUT: readonly string[] = [
  'paused',
  'notYourTurn',
  'uiLocked',
  'attackResolving',
  'orderQueued',
  'mercActing',
  'firing',
  'busy',
  'scriptedSequence',
  'stopTimeQuote',
  'autoBandaging',
  'helicopterDrop',
  'boxingUiLock',
  'cannotAct',
];

const ANSWERED_WITHOUT_A_LINE: readonly string[] = ['refusesOrder', 'noAmmo', 'weaponBroken', 'cannotReach', 'alreadyFacing'];

const ITEM_PANEL_REFUSALS: readonly string[] = [
  'emptySlot',
  'sameSlot',
  'nailsVest',
  'doesNotFit',
  'noRoom',
  'cannotAttach',
  'noAttachment',
  'inseparable',
  'notAGun',
  'gunEmpty',
  'wrongAmmo',
  'cannotReload',
  'robot',
  'unconsciousTarget',
  'cannotApply',
  'notMoney',
  'notEnoughMoney',
  'notAKey',
  'keyRingFull',
  'noKeyRing',
  'useMoveItem',
];

const ANSWERED_BY_THE_SCREENS: readonly string[] = [
  'noRoofEdge',
  'useAttach',
  'mergePrompt',
  'permanentAttachment',
  'noMilitiaHere',
  'alreadyInSquad',
  'boxingInProgress',
];

const NO_FALLBACK: ReadonlySet<string> = new Set([
  ...IGNORED_BY_THE_LOCKED_INPUT,
  ...ANSWERED_WITHOUT_A_LINE,
  ...ITEM_PANEL_REFUSALS,
  ...ANSWERED_BY_THE_SCREENS,
]);

function refusalToken(reply: RefusableReply): string | null {
  return refusalOf(reply.data) ?? reply.reason ?? null;
}

export function fallbackRefusalLine(reply: RefusableReply): string | null {
  if (reply.ok) return null;
  const token = refusalToken(reply);
  if (token !== null && (NO_FALLBACK.has(token) || refusalMessage(token) !== null)) return null;
  return reply.reason ?? token;
}

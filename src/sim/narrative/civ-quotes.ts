// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-16. See LICENSE (SFI-SCLA).
// @src src/game/Tactical/Civ_Quotes.cc DetermineCivQuoteEntry, StartCivQuote, BeginCivQuote, GetCivQuoteText,
// @src EXTREAMLY_LOW_TOWN_LOYALTY, HIGH_TOWN_LOYALTY; TacticalAI/NPC.cc FindCivQuoteFileIndex, ConsiderCivilianQuotes.

import { NO_QUEST, NUM_NPC_QUOTE_RECORDS, QuoteFlag } from '../../content/formats/npc.ts';
import { civQuoteTextKey, type TextKey } from '../../content/narrative/dialogue-text.ts';
import {
  Approach,
  CIV_QUOTE_SECTORS,
  CivQuote,
  civQuoteEntries,
  MINERS_CIV_QUOTE_INDEX,
  NO_PROFILE,
} from '../../content/narrative/npc-constants.ts';
import { i8, u8 } from '../../core/int.ts';
import { Fact } from '../strategic/narrative/fact-ids.ts';
import { AiAction } from '../tactical/ai/actions.ts';
import { CivilianGroup, NO_CIV_QUOTE, type Soldier, SoldierClass, Team } from '../tactical/soldier.ts';
import { selectEnv } from './converse.ts';
import type { NarrativeHost } from './host.ts';
import type { SectorRef } from './records.ts';
import { ensureCivQuoteFileLoaded } from './records.ts';
import { npcConsiderQuote } from './select.ts';
import { CivType, getCivType } from './talkable.ts';

const NO_HINT = -1;
const NO_FILE = -1;
const EXTREMELY_LOW_TOWN_LOYALTY = 20;
const HIGH_TOWN_LOYALTY = 80;
const ENEMY_HURT_LIFE = 30;
const HINT_DROP_RANGE = 100;
const HINT_DROP_BELOW = 25;
const UNUSED_ENTRIES = 2;
const DELTA_CYCLE = 2;
const ATTACK_ACTIONS: ReadonlySet<number> = new Set([AiAction.TOSS_PROJECTILE, AiAction.FIRE_GUN, AiAction.KNIFE_MOVE]);

export const TownId = { BLANK: 0, SAN_MONA: 7, MEDUNA: 11 } as const;

export interface CivQuoteSaid {
  readonly soldier: number;
  readonly quote: number;
  readonly entry: number;
  readonly hint: boolean;
  readonly textKey: TextKey;
  readonly chars: number;
}

interface CivQuoteChoice {
  readonly quote: number;
  readonly hint: number;
}

function findCivQuoteFileIndex(sector: SectorRef): number {
  if (sector.z > 0) return MINERS_CIV_QUOTE_INDEX;
  const index = CIV_QUOTE_SECTORS.findIndex(([x, y]) => x === sector.x && y === sector.y);
  return index === -1 ? NO_FILE : index;
}

export function considerCivilianQuotes(host: NarrativeHost, sector: SectorRef, setAsUsed: boolean): number {
  const index = findCivQuoteFileIndex(sector);
  if (index === NO_FILE) return NO_HINT;
  const quotes = ensureCivQuoteFileLoaded(host, index);
  if (!quotes) return NO_HINT;
  const env = selectEnv(host);
  for (let i = 0; i < NUM_NPC_QUOTE_RECORDS; i++) {
    if (!npcConsiderQuote(env, NO_PROFILE, Approach.NONE, i, 0, quotes)) continue;
    const q = quotes[i];
    if (!q) continue;
    if (setAsUsed) q.flags |= QuoteFlag.SAID;
    if (q.startQuest !== NO_QUEST) host.quests.startQuest(q.startQuest, host.worldSector());
    return q.quoteNum;
  }
  return NO_HINT;
}

function byAge(adult: boolean, adultQuote: number, kidQuote: number): number {
  return adult ? adultQuote : kidQuote;
}

function enemyQuote(civ: Soldier): number {
  if (ATTACK_ACTIONS.has(civ.ai.action)) return CivQuote.ENEMY_THREAT;
  if (civ.ai.action === AiAction.OFFER_SURRENDER) return CivQuote.ENEMY_OFFER_SURRENDER;
  if (civ.life < ENEMY_HURT_LIFE) return CivQuote.ENEMY_HURT;
  if (civ.soldierClass === SoldierClass.ELITE) return CivQuote.ENEMY_ELITE;
  return CivQuote.ENEMY_ADMIN;
}

function militiaQuote(civ: Soldier): number | null {
  if (civ.soldierClass === SoldierClass.GREEN_MILITIA) return CivQuote.GREEN_MILITIA;
  if (civ.soldierClass === SoldierClass.REG_MILITIA) return CivQuote.MEDIUM_MILITIA;
  if (civ.soldierClass === SoldierClass.ELITE_MILITIA) return CivQuote.ELITE_MILITIA;
  return null;
}

function groupQuote(civ: Soldier): number | null {
  if (civ.civilianGroup === CivilianGroup.HICKS) return civ.neutral ? CivQuote.HICKS_FRIENDLY : CivQuote.HICKS_ENEMIES;
  if (civ.civilianGroup === CivilianGroup.KINGPIN) return civ.neutral ? CivQuote.GOONS_FRIENDLY : CivQuote.GOONS_ENEMIES;
  return null;
}

function laterGroupQuote(host: NarrativeHost, civ: Soldier, adult: boolean, town: number, surface: boolean): number | null {
  switch (civ.civilianGroup) {
    case CivilianGroup.FACTORY_KIDS:
      return host.facts.checkFact(Fact.DOREEN_HAD_CHANGE_OF_HEART, 0) || !host.facts.checkFact(Fact.DOREEN_ALIVE, 0)
        ? CivQuote.KID_SLAVES_FREE
        : CivQuote.KID_SLAVES;
    case CivilianGroup.BEGGARS:
      if (town !== TownId.BLANK && surface && town === TownId.SAN_MONA && adult) return CivQuote.SAN_MONA_BEGGERS;
      return byAge(adult, CivQuote.ADULTS_BEGGING, CivQuote.KIDS_BEGGING);
    case CivilianGroup.REBEL:
      return byAge(adult, CivQuote.ADULTS_REBELS, CivQuote.KIDS_REBELS);
    default:
      return null;
  }
}

export function determineCivQuoteEntry(host: NarrativeHost, civ: Soldier, canUseHints: boolean): CivQuoteChoice {
  const t = host.tactical();
  const sector = host.worldSector() ?? { x: 0, y: 0, z: 0 };
  const civType = t ? getCivType(t, civ) : CivType.NA;
  const plain = (quote: number): CivQuoteChoice => ({ quote, hint: 0 });
  if (civType === CivType.ENEMY) return plain(enemyQuote(civ));
  const town = host.civ.townOfSector(sector);
  const surface = sector.z === 0;
  const adult = civType === CivType.ADULT;
  if (civType === CivType.MARRIED_PC) return plain(CivQuote.PC_MARRIED);
  const group = groupQuote(civ);
  if (group !== null) return plain(group);
  if (civ.cowering || (civ.team === Team.CIV && t?.inCombat === true))
    return plain(byAge(adult, CivQuote.ADULTS_COWER, CivQuote.KIDS_COWER));
  const later = laterGroupQuote(host, civ, adult, town, surface);
  if (later !== null) return plain(later);
  if (civ.team === Team.MILITIA) {
    const militia = militiaQuote(civ);
    if (militia !== null) return plain(militia);
  }
  if (town === TownId.MEDUNA && host.facts.checkFact(Fact.QUEEN_DEAD, 0)) return plain(CivQuote.DEIDRANNA_DEAD);
  let low = false;
  let high = false;
  if (town !== TownId.BLANK && surface && host.civ.townUsesLoyalty(town)) {
    const rating = host.townRating(town);
    low = rating < EXTREMELY_LOW_TOWN_LOYALTY;
    high = rating >= HIGH_TOWN_LOYALTY;
  }
  let hint = canUseHints ? considerCivilianQuotes(host, sector, false) : NO_HINT;
  const miner = civ.soldierClass === SoldierClass.MINER;
  if (miner && hint === NO_HINT)
    return plain(host.civ.playerControlsMineOf(sector) ? CivQuote.MINERS_FOR_PLAYER : CivQuote.MINERS_NOT_FOR_PLAYER);
  if (hint !== NO_HINT && low && !miner && host.random(HINT_DROP_RANGE) < HINT_DROP_BELOW) hint = NO_HINT;
  if (hint !== NO_HINT && adult) {
    considerCivilianQuotes(host, sector, true);
    return { quote: CivQuote.HINT, hint };
  }
  if (low) return plain(byAge(adult, CivQuote.ADULTS_EXTREMLY_LOW_LOYALTY, CivQuote.KIDS_EXTREMLY_LOW_LOYALTY));
  if (high) return plain(byAge(adult, CivQuote.ADULTS_HIGH_LOYALTY, CivQuote.KIDS_HIGH_LOYALTY));
  return plain(byAge(adult, CivQuote.ADULTS_ALL_PURPOSE, CivQuote.KIDS_ALL_PURPOSE));
}

export function beginCivQuote(host: NarrativeHost, civ: Soldier, quote: number, entry: number): CivQuoteSaid | null {
  const sector = host.worldSector() ?? { x: 0, y: 0, z: 0 };
  const textKey = civQuoteTextKey(quote, entry, sector);
  const chars = host.quoteLengths.chars(textKey);
  if (chars === 0) return null;
  const said = { soldier: civ.id, quote, entry, hint: quote === CivQuote.HINT, textKey, chars };
  host.emit({ type: 'civQuote', ...said });
  return said;
}

export function startCivQuote(host: NarrativeHost, civ: Soldier): CivQuoteSaid | null {
  let choice: CivQuoteChoice;
  if (civ.currentCivQuote === CivQuote.HINT) {
    civ.currentCivQuote = NO_CIV_QUOTE;
    civ.currentCivQuoteDelta = 0;
    choice = determineCivQuoteEntry(host, civ, false);
  } else choice = determineCivQuoteEntry(host, civ, true);
  const { quote } = choice;
  let entry: number;
  if (quote !== CivQuote.HINT) {
    if (civ.currentCivQuote === NO_CIV_QUOTE) {
      civ.currentCivQuote = i8(host.talk.fx.int(civQuoteEntries(quote) - UNUSED_ENTRIES));
      civ.currentCivQuoteDelta = 0;
    }
    entry = u8(civ.currentCivQuote + civ.currentCivQuoteDelta);
  } else {
    entry = u8(choice.hint);
    civ.currentCivQuote = quote;
    civ.currentCivQuoteDelta = i8(entry);
  }
  const said = beginCivQuote(host, civ, quote, entry);
  if (quote !== CivQuote.HINT) {
    civ.currentCivQuoteDelta++;
    if (civ.currentCivQuoteDelta === DELTA_CYCLE) civ.currentCivQuoteDelta = 0;
  }
  return said;
}

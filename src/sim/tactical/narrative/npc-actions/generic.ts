// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-16. See LICENSE (SFI-SCLA).
// @src src/game/Tactical/Interface_Dialogue.cc HandleNPCDoAction (the generic actions: facing, guns, running, recruiting,
// @src hostility, combat, traversal, drinks, bartenders, stationary NPCs, removal, say-later, conversation mode, experience,
// @src history, Tixa and Orta, closest doors and cabinets); TacticalAI/NPC.cc TriggerFriendWithHostileQuote. See docs/25 §3.2.

import { ItemClass } from '../../../../content/items/items.ts';
import { Approach, QuoteActionId } from '../../../../content/narrative/npc-constants.ts';
import { DIRECTION_INCREMENT, Direction } from '../../../../content/world/grid.ts';
import { i8 } from '../../../../core/int.ts';
import { swapObjects } from '../../../items/object.ts';
import { closestPC, initiateConversationFull, npcDoAction, triggerNpcWithIHateYouQuote } from '../../../narrative/converse.ts';
import { Town } from '../../../strategic/economy/constants.ts';
import { Fact } from '../../../strategic/narrative/fact-ids.ts';
import { NarrativeHistory } from '../../../strategic/narrative/history-codes.ts';
import { Npc } from '../../../strategic/narrative/npc-ids.ts';
import { ExperienceBonus } from '../../../strategic/narrative/rewards.ts';
import { AiAction } from '../../ai/actions.ts';
import { cancelAIAction } from '../../ai/control.ts';
import { findAIUsableObjClass } from '../../ai/utils.ts';
import { AnimHeight, endHeight, setDesiredDirection } from '../../animation.ts';
import { soldierReadyWeapon } from '../../combat/attack.ts';
import { Insertion } from '../../insertion.ts';
import { autoPlaceObject, InvSlot, NO_SLOT } from '../../inventory.ts';
import { directionToward } from '../../movement.ts';
import { recalculateOppCntsDueToBecomingNeutral, removeManAsTarget } from '../../perception/sight.ts';
import { removeSoldierFromTacticalSector } from '../../sector-presence.ts';
import { Body, CivilianGroup, NO_PROFILE, NOWHERE, OKBREATH, OKLIFE, Orders, type Soldier, Team } from '../../soldier.ts';
import { soldierInventoryContext } from '../../soldier-inventory.ts';
import { whoIsThere } from '../../state.ts';
import { checkForEndOfBattle, enterCombatMode, exitCombatMode } from '../../turns/turns.ts';
import { addToShouldBecomeHostileOrSayQuoteList, civilianGroupMemberChangesSides, makeCivHostile } from '../civ-hostility.ts';
import { CivGroupHostility } from '../constants.ts';
import { NpcActionCode as A } from './codes.ts';
import { closeMenu, destSoldier, npcSoldier, ProfileMiscFlag, ProfileMiscFlag3, profileOf, tactical } from './common.ts';
import type { NpcActionEnv } from './env.ts';
import { getItemsFromClosestCabinet, openClosestThing } from './open-thing.ts';

const MANNY_GRIDNO = 19904;
const PAUSE_ALL_AI_DELAY_MS = 1500;

const HISTORY_ACTIONS: Readonly<Record<number, number>> = {
  [A.HISTORY_GOT_ROCKET_RIFLES]: NarrativeHistory.GOT_ROCKET_RIFLES,
  [A.HISTORY_DEIDRANNA_DEAD_BODIES]: NarrativeHistory.DEIDRANNA_DEAD_BODIES,
  [A.HISTORY_BOXING_MATCHES]: NarrativeHistory.BOXING_MATCHES,
  [A.HISTORY_SOMETHING_IN_MINES]: NarrativeHistory.SOMETHING_IN_MINES,
  [A.HISTORY_DEVIN]: NarrativeHistory.DEVIN,
  [A.HISTORY_MIKE]: NarrativeHistory.MIKE,
  [A.HISTORY_TONY]: NarrativeHistory.TONY,
  [A.HISTORY_KROTT]: NarrativeHistory.KROTT,
  [A.HISTORY_KYLE]: NarrativeHistory.KYLE,
  [A.HISTORY_MADLAB]: NarrativeHistory.MADLAB,
  [A.HISTORY_GABBY]: NarrativeHistory.GABBY,
  [A.HISTORY_KEITH_OUT_OF_BUSINESS]: NarrativeHistory.KEITH_OUT_OF_BUSINESS,
  [A.HISTORY_HOWARD_CYANIDE]: NarrativeHistory.HOWARD_CYANIDE,
  [A.HISTORY_KEITH]: NarrativeHistory.KEITH,
  [A.HISTORY_HOWARD]: NarrativeHistory.HOWARD,
  [A.HISTORY_PERKO]: NarrativeHistory.PERKO,
  [A.HISTORY_SAM]: NarrativeHistory.SAM,
  [A.HISTORY_FRANZ]: NarrativeHistory.FRANZ,
  [A.HISTORY_ARNOLD]: NarrativeHistory.ARNOLD,
  [A.HISTORY_FREDO]: NarrativeHistory.FREDO,
  [A.HISTORY_RICHGUY_BALIME]: NarrativeHistory.RICHGUY_BALIME,
  [A.HISTORY_JAKE]: NarrativeHistory.JAKE,
  [A.HISTORY_BUM_KEYCARD]: NarrativeHistory.BUM_KEYCARD,
  [A.HISTORY_WALTER]: NarrativeHistory.WALTER,
  [A.HISTORY_DAVE]: NarrativeHistory.DAVE,
  [A.HISTORY_PABLO]: NarrativeHistory.PABLO,
  [A.HISTORY_KINGPIN_MONEY]: NarrativeHistory.KINGPIN_MONEY,
  [A.HISTORY_ASSASSIN]: NarrativeHistory.ASSASSIN,
};

const EXPERIENCE_ACTIONS: Readonly<Record<number, number>> = {
  [A.GRANT_EXPERIENCE_1]: ExperienceBonus.MINIMUM,
  [A.GRANT_EXPERIENCE_2]: ExperienceBonus.SMALL,
  [A.GRANT_EXPERIENCE_3]: ExperienceBonus.AVERAGE,
  [A.GRANT_EXPERIENCE_4]: ExperienceBonus.LARGE,
  [A.GRANT_EXPERIENCE_5]: ExperienceBonus.MAXIMUM,
};

const TRAVERSALS: Readonly<Record<number, number>> = {
  [A.TRAVERSE_MAP_EAST]: QuoteActionId.TRAVERSE_EAST,
  [A.TRAVERSE_MAP_SOUTH]: QuoteActionId.TRAVERSE_SOUTH,
  [A.TRAVERSE_MAP_WEST]: QuoteActionId.TRAVERSE_WEST,
  [A.TRAVERSE_MAP_NORTH]: QuoteActionId.TRAVERSE_NORTH,
};

const DRINKS: Readonly<Record<number, number>> = { [A.DRINK_DRINK_DRINK]: 1, [A.DRINK_WINE]: 2, [A.DRINK_BOOZE]: 4 };

const BARTENDERS: Readonly<Record<number, number>> = {
  [A.MAKE_NPC_FIRST_BARTENDER]: 1,
  [A.MAKE_NPC_SECOND_BARTENDER]: 2,
  [A.MAKE_NPC_THIRD_BARTENDER]: 3,
  [A.MAKE_NPC_FOURTH_BARTENDER]: 4,
};

export function faceToward(env: NpcActionEnv, s: Soldier, gridNo: number): void {
  const t = tactical(env);
  if (!t) return;
  const dir = directionToward(s.gridNo, gridNo);
  if (s.direction !== dir) setDesiredDirection(t, s, dir);
}

export function turnToFaceNearestMerc(env: NpcActionEnv, npc: number): void {
  const s = npcSoldier(env, npc);
  if (!s) return;
  const g = closestPC(env.host, s);
  if (g !== NOWHERE) faceToward(env, s, g);
}

export function faceProfile(env: NpcActionEnv, npc: number, other: number): void {
  const s = npcSoldier(env, npc);
  const target = npcSoldier(env, other);
  if (s && target) faceToward(env, s, target.gridNo);
}

function gridAhead(s: Soldier): number {
  return s.gridNo + (DIRECTION_INCREMENT[s.direction] ?? 0);
}

function threateninglyRaiseGun(env: NpcActionEnv, npc: number): void {
  const t = tactical(env);
  const s = npcSoldier(env, npc);
  if (!t || !s) return;
  const slot = findAIUsableObjClass(t, s, ItemClass.GUN);
  const hand = s.inv[InvSlot.HAND];
  const gun = s.inv[slot];
  if (slot === NO_SLOT || slot === InvSlot.HAND || !hand || !gun) return;
  swapObjects(hand, gun);
  soldierReadyWeapon(t, s, gridAhead(s), false);
}

function lowerGun(env: NpcActionEnv, npc: number): void {
  const t = tactical(env);
  const s = npcSoldier(env, npc);
  const hand = s?.inv[InvSlot.HAND];
  if (!t || !s || !hand || hand.item === 0) return;
  const gun = hand.item;
  autoPlaceObject(soldierInventoryContext(t, s), s, hand);
  const newSlot = s.inv.findIndex((o) => o.item === gun);
  const p = profileOf(env, npc);
  if (newSlot === NO_SLOT || !p || p.inventory[newSlot] !== 0) return;
  const oldSlot = p.inventory.indexOf(gun);
  if (oldSlot < 0) return;
  p.inventory[newSlot] = gun;
  p.inventoryCount[newSlot] = 1;
  p.inventoryStatus[newSlot] = p.inventoryStatus[oldSlot] ?? 0;
  p.inventory[oldSlot] = 0;
  p.inventoryCount[oldSlot] = 0;
  p.inventoryStatus[oldSlot] = 0;
}

function readyGun(env: NpcActionEnv, npc: number): void {
  const t = tactical(env);
  const s = npcSoldier(env, npc);
  if (t && s && (s.inv[InvSlot.HAND]?.item ?? 0) !== 0) soldierReadyWeapon(t, s, gridAhead(s), false);
}

function faceDirection(env: NpcActionEnv, npc: number, direction: number): void {
  const t = tactical(env);
  const s = npcSoldier(env, npc);
  if (t && s) setDesiredDirection(t, s, direction);
}

function recruit(env: NpcActionEnv, npc: number): void {
  closeMenu(env);
  if (env.playerTeamFull()) {
    env.message('teamFull', npc);
    return;
  }
  env.recruit.recruitRpc(npc);
  env.message('recruited', npc);
}

function becomeEnemy(env: NpcActionEnv, npc: number): void {
  const t = tactical(env);
  const s = npcSoldier(env, npc);
  if (!t || !s) return;
  if (s.civilianGroup !== CivilianGroup.NONE) civilianGroupMemberChangesSides(t, s);
  if (s.profile !== NO_PROFILE && s.life >= OKLIFE) addToShouldBecomeHostileOrSayQuoteList(t, s);
}

export function enterCombat(env: NpcActionEnv, npc: number): void {
  const t = tactical(env);
  const s = npcSoldier(env, npc);
  if (!t || !s) return;
  if (s.civilianGroup !== CivilianGroup.NONE) {
    if ((t.civGroups.hostility[s.civilianGroup] ?? 0) === CivGroupHostility.NEUTRAL) civilianGroupMemberChangesSides(t, s);
  } else makeCivHostile(t, s);
  closeMenu(env);
  if (!t.inCombat) enterCombatMode(t, s.team);
}

export function getOutOfWheelchair(env: NpcActionEnv, npc: number): void {
  const t = tactical(env);
  const s = npcSoldier(env, npc);
  if (!t || !s || s.bodyType !== Body.CRIPPLECIV) return;
  closeMenu(env);
  env.kickOutOfWheelchair(s);
}

function becomeFriendlyEndCombat(env: NpcActionEnv, npc: number): void {
  const t = tactical(env);
  const s = npcSoldier(env, npc);
  if (!t || !s) return;
  closeMenu(env);
  env.setSoldierNeutral(s);
  recalculateOppCntsDueToBecomingNeutral(t, s);
  if ((t.turn.numFoughtInBattle[Team.CIV] ?? 0) === 0) t.turn.enemyInSector = false;
  if (!t.turn.enemyInSector) exitCombatMode(t);
  cancelAIAction(t, s);
  if (npc === Npc.SLAY && s.bodyType === Body.CRIPPLECIV) getOutOfWheelchair(env, Npc.SLAY);
  else if (endHeight(t.content, s.state) !== AnimHeight.STAND) {
    s.ai.nextAction = AiAction.CHANGE_STANCE;
    s.ai.nextActionData = AnimHeight.STAND;
  }
}

function terroristRevealsSelf(env: NpcActionEnv, npc: number): void {
  const name = env.profileName(npc);
  const p = profileOf(env, npc);
  if (p) p.nickname = name;
  const s = npcSoldier(env, npc);
  if (s) s.name = name;
  env.presentation('terroristRevealed', npc);
}

function initiateShop(env: NpcActionEnv): void {
  const npc = env.host.talk.charNum;
  if (env.shopKeeperShutDown(npc)) return;
  closeMenu(env);
  env.openShop(npc);
}

function makeStationary(env: NpcActionEnv, npc: number, gridNo: number | null): void {
  const s = npcSoldier(env, npc);
  const p = profileOf(env, npc);
  const target = gridNo ?? s?.gridNo;
  if (gridNo === null && !s) return;
  if (p && target !== undefined) {
    p.miscFlags3 |= ProfileMiscFlag3.PERMANENT_INSERTION_CODE;
    p.insertionCode = Insertion.GRIDNO;
    p.insertionData = target;
    p.useProfileInsertion = true;
  }
  if (s) s.ai.orders = Orders.STATIONARY;
}

function removeNpc(env: NpcActionEnv, npc: number): void {
  const t = tactical(env);
  const s = npcSoldier(env, npc);
  if (!t || !s) return;
  t.hooks.endAiGuysTurn(t, s);
  removeManAsTarget(t, s);
  removeSoldierFromTacticalSector(t, s);
  const p = profileOf(env, npc);
  if (p) {
    p.sectorX = 0;
    p.sectorY = 0;
    p.sectorZ = 0;
  }
  checkForEndOfBattle(t);
}

function removeMercForMarriage(env: NpcActionEnv, npc: number): void {
  const s = npcSoldier(env, npc);
  if (!s) return;
  const p = profileOf(env, npc);
  if (p) {
    p.sectorX = 0;
    p.sectorY = 0;
    p.sectorZ = 0;
  }
  env.recruit.turnIntoAnonymousCivilian(s);
}

function sayLater(env: NpcActionEnv, nice: boolean): void {
  env.setFactTrue(Fact.NEED_TO_SAY_SOMETHING);
  const dest = destSoldier(env);
  const profile = dest?.profile ?? NO_PROFILE;
  if (nice) env.host.talk.niceNpc = profile;
  else env.host.talk.nastyNpc = profile;
}

function invokeConversationMode(env: NpcActionEnv, npc: number): void {
  const t = tactical(env);
  if (env.host.talk.inPanel || !t) return;
  const s = npcSoldier(env, npc);
  if (!s) return;
  const g = closestPC(env.host, s);
  const pc = g !== NOWHERE ? whoIsThere(t, g, 0) : null;
  if (pc) initiateConversationFull(env.host, s, pc, Approach.NPC_INITIAL_QUOTE, 0, null, 'npc');
}

export function triggerFriendWithHostileQuote(env: NpcActionEnv, npc: number): void {
  const t = tactical(env);
  const s = npcSoldier(env, npc);
  if (!t || !s) return;
  const candidates: number[] = [];
  for (const m of t.soldiers) {
    if (!m?.placed || m.team !== s.team) continue;
    if (m.life < OKLIFE || m.breath < OKBREATH || m.ai.oppCount <= 0 || m.profile === NO_PROFILE) continue;
    if (s.team === Team.CIV && s.civilianGroup !== CivilianGroup.NONE && m.civilianGroup !== s.civilianGroup) continue;
    if (((profileOf(env, m.profile)?.miscFlags ?? 0) & ProfileMiscFlag.SAID_HOSTILE_QUOTE) === 0) candidates.push(m.profile);
  }
  if (s.team === Team.CIV && s.civilianGroup !== CivilianGroup.NONE) {
    if ((t.civGroups.hostility[s.civilianGroup] ?? 0) === CivGroupHostility.NEUTRAL) civilianGroupMemberChangesSides(t, s);
  }
  if (candidates.length > 0) {
    t.turn.pauseAiUntil = t.clockMs + PAUSE_ALL_AI_DELAY_MS;
    triggerNpcWithIHateYouQuote(env.host, candidates[env.random(candidates.length)] as number);
  } else npcDoAction(env.host, npc, A.ENTER_COMBAT, 0);
}

function showTown(env: NpcActionEnv, town: number, history: number): void {
  env.setTownAsFound(town);
  env.history(history, env.worldSector());
}

function adjustNpcData(env: NpcActionEnv, npc: number, change: (value: number) => number): void {
  const p = profileOf(env, npc);
  if (p) p.npcData = i8(change(p.npcData));
}

export function handleGenericAction(env: NpcActionEnv, npc: number, code: number, record: number): boolean {
  const history = HISTORY_ACTIONS[code];
  if (history !== undefined) {
    env.history(history, env.worldSector());
    return true;
  }
  const bonus = EXPERIENCE_ACTIONS[code];
  if (bonus !== undefined) {
    env.awardExperience(bonus);
    return true;
  }
  const traversal = TRAVERSALS[code];
  if (traversal !== undefined) {
    const s = npcSoldier(env, npc);
    if (s) s.quoteActionId = traversal;
    return true;
  }
  const drink = DRINKS[code];
  if (drink !== undefined) {
    adjustNpcData(env, npc, (v) => v + drink);
    return true;
  }
  const bartender = BARTENDERS[code];
  if (bartender !== undefined) {
    adjustNpcData(env, npc, () => bartender);
    return true;
  }
  if (code >= A.FACE_NORTH_EAST && code <= A.FACE_NORTH_WEST) {
    faceDirection(env, npc, Direction.NORTH + (code - A.FACE_NORTH_EAST));
    return true;
  }
  switch (code) {
    case A.DONT_ACCEPT_ITEM:
      return true;
    case A.OPEN_CLOSEST_DOOR:
    case A.OPEN_CLOSEST_CABINET:
      openClosestThing(env, npc, code === A.OPEN_CLOSEST_DOOR);
      return true;
    case A.GET_ITEMS_FROM_CLOSEST_CABINET:
      getItemsFromClosestCabinet(env, npc);
      return true;
    case A.FACE_CLOSEST_PLAYER: {
      const s = npcSoldier(env, npc);
      if (!s) return true;
      s.quoteRecord = record;
      s.quoteActionId = QuoteActionId.TURNTOWARDSPLAYER;
      s.ai.handleEveryFrame = true;
      return true;
    }
    case A.THREATENINGLY_RAISE_GUN:
      if (!npcSoldier(env, npc)) return true;
      threateninglyRaiseGun(env, npc);
      turnToFaceNearestMerc(env, npc);
      return true;
    case A.TURN_TO_FACE_NEAREST_MERC:
      turnToFaceNearestMerc(env, npc);
      return true;
    case A.LOWER_GUN:
      lowerGun(env, npc);
      return true;
    case A.READY_GUN:
      readyGun(env, npc);
      return true;
    case A.START_RUNNING:
    case A.STOP_RUNNING: {
      const s = npcSoldier(env, npc);
      if (s) s.uiMovementFast = code === A.START_RUNNING;
      return true;
    }
    case A.BOOST_TOWN_LOYALTY:
      env.loyaltyForNpcAction(npc);
      return true;
    case A.STOP_PLAYER_GIVING_FIRST_AID:
      return true;
    case A.FACE_NORTH:
      faceDirection(env, npc, Direction.NORTHWEST);
      return true;
    case A.RECRUIT: {
      const p = profileOf(env, npc);
      if (p) p.salary = 0;
      recruit(env, npc);
      return true;
    }
    case A.RECRUIT_WITH_SALARY:
      recruit(env, npc);
      return true;
    case A.BECOME_ENEMY:
      becomeEnemy(env, npc);
      return true;
    case A.CLOSE_DIALOGUE_PANEL:
    case A.TRIGGER_FRIEND_WITH_HOSTILE_QUOTE:
      closeMenu(env);
      return true;
    case A.ENTER_COMBAT:
      enterCombat(env, npc);
      return true;
    case A.END_COMBAT: {
      const t = tactical(env);
      if (t) exitCombatMode(t);
      return true;
    }
    case A.BECOME_FRIENDLY_END_COMBAT:
      becomeFriendlyEndCombat(env, npc);
      return true;
    case A.TERRORIST_REVEALS_SELF:
      terroristRevealsSelf(env, npc);
      return true;
    case A.INITIATE_SHOPKEEPER_INTERFACE:
      initiateShop(env);
      return true;
    case A.REPORT_BALANCE:
      env.message('balanceOwed', npc, -(profileOf(env, npc)?.balance ?? 0));
      return true;
    case A.CHANGE_MANNY_POSITION:
      makeStationary(env, Npc.MANNY, env.params.gridNo(code, MANNY_GRIDNO));
      closeMenu(env);
      return true;
    case A.MAKE_BRENDA_STATIONARY:
      makeStationary(env, Npc.BRENDA, null);
      return true;
    case A.MAKE_MIGUEL_STATIONARY:
      makeStationary(env, Npc.MIGUEL, null);
      return true;
    case A.CANCEL_WAYPOINTS: {
      const s = npcSoldier(env, npc);
      if (s) s.ai.orders = Orders.ONGUARD;
      return true;
    }
    case A.REMOVE_NPC:
      removeNpc(env, npc);
      return true;
    case A.REMOVE_MERC_FOR_MARRIAGE:
      removeMercForMarriage(env, npc);
      return true;
    case A.PLAYER_SAYS_NICE_LATER:
    case A.PLAYER_SAYS_NASTY_LATER:
      sayLater(env, code === A.PLAYER_SAYS_NICE_LATER);
      return true;
    case A.INVOKE_CONVERSATION_MODE:
      invokeConversationMode(env, npc);
      return true;
    case A.SHOW_TIXA:
      showTown(env, Town.TIXA, NarrativeHistory.DISCOVERED_TIXA);
      return true;
    case A.SHOW_ORTA:
      showTown(env, Town.ORTA, NarrativeHistory.DISCOVERED_ORTA);
      return true;
    default:
      return false;
  }
}

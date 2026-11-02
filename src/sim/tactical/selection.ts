// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-31. See LICENSE (SFI-SCLA).
// @src src/game/Tactical/Overhead.cc SelectSoldier (InternalSelectSoldier: its checks, the squad, PutMercInAwakeState and
// @src the psycho's personality quote), SelectNextAvailSoldier; Tactical/Soldier_Macros.h OK_CONTROLLABLE_MERC,
// @src OK_INTERRUPT_MERC; Tactical/Handle_UI.cc EndMultiSoldierSelection (the wake of the multi-selected mercs);
// @src GameScreen.cc EnterTacticalScreen (a selected merc out of control or asleep), MainGameScreenHandle (the forced
// @src reselect on entry), TacticalScreenLocateToSoldier; Tactical/Overhead.cc HandlePlayerTeamMemberDeath and
// @src RemoveSoldierFromTacticalSector (the next selection), FindActiveAndAliveMerc, FindNextActiveSquad;
// @src Tactical/Squads.cc UpdateCurrentlySelectedMerc; Tactical/Soldier_Create.cc InternalTacticalRemoveSoldier;
// @src Tactical/Squads.cc SetCurrentSquad (the forced selection of the squad's first merc), SetDefaultSquadOnSectorEntry,
// @src RebuildCurrentSquad (its squad check; the team panel stays the client's),
// @src the end of AddCharacterToSquad; SaveLoadGame.cc LoadSavedGame (the forced reselect in tactical) (2026-11-01).

import { NO_CURRENT_SQUAD, NUMBER_OF_SQUADS } from '../strategic/forces/constants.ts';
import { soldierAssignment } from './narrative/assignment.ts';
import { MercQuote, markQuoteSaid, okControllableMerc, QuoteSaidFlag, quoteSaid } from './narrative/merc-quotes.ts';
import { isVehicleBody } from './person-structure.ts';
import type { Refusal } from './refusal.ts';
import { NO_PROFILE, OKLIFE, Personality, type Soldier, TEAM_FIRST_ID, TEAM_SIZES, Team } from './soldier.ts';
import { okInterruptMerc } from './soldier-view.ts';
import { type TacticalState, teamMembers } from './state.ts';

export const NO_SELECTION = -1;

export const SelectFlags = { NONE: 0, FORCE_RESELECT: 1 } as const;

const PERSONALITY_QUOTE_ODDS = 50;

const NOT_CONTROLLABLE: Refusal = { token: 'cannotAct', reason: 'soldier cannot act' };
const ON_ASSIGNMENT: Refusal = { token: 'onAssignment', reason: 'the soldier is on an assignment, not on a squad' };
const UNAVAILABLE: Refusal = { token: 'mercUnavailable', reason: 'soldier has no move in this interrupt' };

export function selectedSoldier(t: TacticalState): Soldier | null {
  return t.soldiers[t.turn.selected] ?? null;
}

export function selectionRefusal(t: TacticalState, s: Soldier): Refusal | null {
  if (!okControllableMerc(t, s)) return s.life < OKLIFE ? NOT_CONTROLLABLE : ON_ASSIGNMENT;
  if (!okInterruptMerc(t, s)) return UNAVAILABLE;
  return null;
}

export function selectSoldier(t: TacticalState, s: Soldier, flags: number = SelectFlags.NONE): boolean {
  if (selectionRefusal(t, s)) return false;
  if (s.id === t.turn.selected && !(flags & SelectFlags.FORCE_RESELECT)) return false;
  t.turn.selected = s.id;
  setCurrentSquad(t, soldierAssignment(t, s), false);
  wakeIfAsleep(t, s);
  maySayPersonalityQuote(t, s);
  return true;
}

export function selectOrderedMerc(t: TacticalState, s: Soldier, multiSelected = false): void {
  if (multiSelected) wakeIfAsleep(t, s);
  else selectSoldier(t, s);
}

export function wakeIfAsleep(t: TacticalState, s: Soldier): void {
  if (t.narrative.mercAsleep(s)) t.narrative.putMercInAwakeState(s);
}

function maySayPersonalityQuote(t: TacticalState, s: Soldier): void {
  if (s.team !== Team.OUR || s.profile === NO_PROFILE || t.narrative.isPlayerCharacter(s)) return;
  if (quoteSaid(t, s).quoteSaidFlags & QuoteSaidFlag.PERSONALITY) return;
  if (s.personalityTrait !== Personality.PSYCHO || t.rng.int(PERSONALITY_QUOTE_ODDS) !== 0) return;
  t.narrative.sayQuote(s, MercQuote.PERSONALITY_TRAIT);
  markQuoteSaid(t, s, QuoteSaidFlag.PERSONALITY);
}

export function selectNextAvailSoldier(t: TacticalState, last: Soldier): void {
  const next = teamMembers(t, last.team).find((s) => okControllableMerc(t, s));
  if (next) selectSoldier(t, next);
  else t.turn.selected = NO_SELECTION;
}

export function endMultiSoldierSelection(t: TacticalState, chosen: Soldier, members: readonly Soldier[]): void {
  for (const s of teamMembers(t, Team.OUR)) if (s === chosen || members.includes(s)) wakeIfAsleep(t, s);
  if (chosen.id !== t.turn.selected) selectSoldier(t, chosen, SelectFlags.FORCE_RESELECT);
}

export function currentSquad(t: TacticalState): number {
  return t.narrative.currentSquad();
}

export function setCurrentSquad(t: TacticalState, squad: number, force: boolean): void {
  if (!t.narrative.inTacticalScreen()) return;
  if (squad === NO_CURRENT_SQUAD) {
    t.narrative.changeCurrentSquad(NO_CURRENT_SQUAD);
    return;
  }
  if (squad < 0 || squad >= NUMBER_OF_SQUADS) return;
  if (squad === currentSquad(t) && !force) return;
  t.narrative.changeCurrentSquad(squad);
  const selected = selectedSoldier(t);
  if (!selected || soldierAssignment(t, selected) !== squad) selectFirstOfSquad(t, squad);
}

function selectFirstOfSquad(t: TacticalState, squad: number): void {
  const first = t.narrative.squadMembers(squad)[0];
  if (first) selectSoldier(t, first, SelectFlags.FORCE_RESELECT);
}

export function setDefaultSquadOnSectorEntry(t: TacticalState, force: boolean): void {
  if (t.narrative.squadOnCurrentTacticalMap(currentSquad(t))) return;
  const squad = firstSquadOnCurrentTacticalMap(t);
  if (squad === null) setCurrentSquad(t, NO_CURRENT_SQUAD, false);
  else setCurrentSquad(t, squad, force);
}

function firstSquadOnCurrentTacticalMap(t: TacticalState): number | null {
  for (let squad = 0; squad < NUMBER_OF_SQUADS; squad++) if (t.narrative.squadOnCurrentTacticalMap(squad)) return squad;
  return null;
}

export function rebuildCurrentSquad(t: TacticalState): void {
  const squad = currentSquad(t);
  if (squad < 0 || squad >= NUMBER_OF_SQUADS) return;
  setDefaultSquadOnSectorEntry(t, true);
}

export function setCurrentSquadAfterJoin(t: TacticalState, joiner: Soldier, squad: number): void {
  const current = currentSquad(t);
  if (current === NO_CURRENT_SQUAD || t.narrative.squadMembers(current).length === 0) setCurrentSquad(t, squad, true);
  if (joiner.id === t.turn.selected) setCurrentSquad(t, squad, true);
}

export function enterTacticalScreenAfterLoad(t: TacticalState): void {
  const selected = selectedSoldier(t);
  if (selected) selectSoldier(t, selected, SelectFlags.FORCE_RESELECT);
  enterTacticalScreen(t);
}

export function enterTacticalScreen(t: TacticalState): void {
  replaceSelectionUnfitForTactical(t);
  setDefaultSquadOnSectorEntry(t, false);
  const selected = selectedSoldier(t);
  if (selected && okInterruptMerc(t, selected)) selectSoldier(t, selected, SelectFlags.FORCE_RESELECT);
}

function replaceSelectionUnfitForTactical(t: TacticalState): void {
  const selected = selectedSoldier(t);
  if (!selected) return;
  if (!okControllableMerc(t, selected)) selectNextAvailSoldier(t, selected);
  const kept = selectedSoldier(t);
  if (kept && t.narrative.mercAsleep(kept)) selectNextAvailSoldier(t, kept);
}

export function locateToSoldier(t: TacticalState, preferred: Soldier | null): Soldier | null {
  const mayAct = (s: Soldier) => okControllableMerc(t, s) && okInterruptMerc(t, s);
  const chosen = preferred && mayAct(preferred) ? preferred : teamMembers(t, Team.OUR).find(mayAct);
  if (!chosen) return null;
  selectSoldier(t, chosen, SelectFlags.FORCE_RESELECT);
  return chosen;
}

export function deathSuccessor(t: TacticalState, dead: Soldier): Soldier | null {
  return teamMembers(t, dead.team).find((s) => s.life >= OKLIFE) ?? null;
}

export function selectAfterPlayerTeamMemberDeath(t: TacticalState, dead: Soldier, successor: Soldier | null): void {
  if (t.turn.selected !== dead.id) return;
  if (successor) selectSoldier(t, successor);
  else t.turn.selected = NO_SELECTION;
}

export function selectAfterRemovalFromSector(t: TacticalState, removed: Soldier): void {
  if (!t.narrative.inTacticalScreen()) {
    t.turn.selected = NO_SELECTION;
    return;
  }
  if (t.turn.selected !== removed.id) return;
  const next = findNextActiveAndAliveMerc(t, removed) ?? findNextActiveSquadMember(t, removed);
  if (next) selectSoldier(t, next);
  else t.turn.selected = NO_SELECTION;
}

export function updateCurrentlySelectedMerc(t: TacticalState, leaving: Soldier): void {
  if (t.turn.selected !== leaving.id) return;
  const next = findNextActiveAndAliveMerc(t, leaving);
  if (next) selectSoldier(t, next);
  else t.turn.selected = NO_SELECTION;
}

export function unselectRemovedSoldier(t: TacticalState, removed: Soldier): void {
  if (t.turn.selected === removed.id) t.turn.selected = NO_SELECTION;
}

function findNextActiveAndAliveMerc(t: TacticalState, current: Soldier): Soldier | null {
  const first = TEAM_FIRST_ID[current.team] ?? 0;
  const size = TEAM_SIZES[current.team] ?? 0;
  const assignment = soldierAssignment(t, current);
  for (let step = 1; step < size; step++) {
    const s = t.soldiers[first + ((current.id - first + step) % size)];
    if (!s || soldierAssignment(t, s) !== assignment || !okInterruptMerc(t, s)) continue;
    if (s.placed && s.life >= OKLIFE) return s;
  }
  return null;
}

function findNextActiveSquadMember(t: TacticalState, current: Soldier): Soldier | null {
  const squad = soldierAssignment(t, current);
  return firstActiveSquadMember(t, squad + 1, NUMBER_OF_SQUADS) ?? firstActiveSquadMember(t, 0, Math.min(squad, NUMBER_OF_SQUADS));
}

function firstActiveSquadMember(t: TacticalState, begin: number, end: number): Soldier | null {
  for (let squad = begin; squad < end; squad++) {
    const found = t.narrative
      .squadMembers(squad)
      .find((s) => s.placed && okInterruptMerc(t, s) && okControllableMerc(t, s) && !isVehicleBody(s));
    if (found) return found;
  }
  return null;
}

<!-- Combat AI (YELLOW, RED, BLACK, turn-based driver): an implementable spec for M3. 2026-10-15.
Source: reference/stracciatella/src (ae6bf01, same snapshot as docs 01–09), cross-checked against vanilla
(reference/vanilla/ja2/Build). Read-only research: nothing was built. -->

# 13 — Combat AI

**Conventions.** As in `09`: paths are relative to `reference/stracciatella/src/game/`, `V:` is vanilla `Build/`,
"(inferred)" marks conclusions not traced end to end, `Random` = our `main` stream, `PreRandom` = our `pre` stream.
"TB" = turn-based (`gfTurnBasedAI = INCOMBAT`), "RT" = real time. All `(INT16)PreRandom(100) < iChance` tests draw
even when `iChance <= 0`; the draw is skipped only where a condition before it short-circuits (each case is stated).
Distances: `SpacesAway` = Chebyshev tiles, `PythSpacesAway` = rounded Euclidean tiles (`07`).
`MaxDistanceVisible() = 26` (`Tactical/OppList.cc:875`).

**Action ids** (`TacticalAI/AI.h:29-90`, continuing `09`): SEEK_OPPONENT 3, TAKE_COVER 4, GET_CLOSER 5, RUN_AWAY 10,
KNIFE_MOVE 11, PICKUP_ITEM 15, MOVE_TO_CLIMB 19, YELLOW_ALERT 22, RED_ALERT 23, CREATURE_CALL 24, PULL_TRIGGER 25,
USE_DETONATOR 26, FIRE_GUN 27, TOSS_PROJECTILE 28, KNIFE_STAB 29, THROW_KNIFE 30, GIVE_AID 31, DROP_ITEM 34, COWER 35,
STOP_COWERING 36, OPEN_OR_CLOSE_DOOR 37, LOWER_GUN 40, CLIMB_ROOF 42, END_TURN 43, TRAVERSE_DOWN 45,
OFFER_SURRENDER 46. Morale (`Tactical/Overhead_Types.h:137`): `HOPELESS 0, WORRIED 1, NORMAL 2, CONFIDENT 3,
FEARLESS 4`. Stance heights: `ANIM_STAND 6, ANIM_CROUCH 3, ANIM_PRONE 1` (`06`).

**AP constants** (`Tactical/Points.h`): `MAX_AP_CARRIED 5`, `AP_RADIO 5`, `AP_CROUCH 2`, `AP_PRONE 2`,
`AP_LOOK_STANDING 1`, `AP_LOOK_CROUCHED 2`, `AP_LOOK_PRONE 2`, `AP_MAX_AIM_ATTACK 4`, `AP_RELOAD_GUN 5`,
`AP_CLIMBROOF 10`, `AP_CLIMBOFFROOF 6`, `AP_PICKUP_ITEM 3`; `BP_RADIO 0`. AI: `BURSTING 5`,
`MIN_PERCENT_BETTER 5`, `MAX_THREAT_RANGE 400`, `STOPSHORTDIST 5`, `FLAG_CAUTIOUS 1`, `FLAG_STOPSHORT 2`
(`TacticalAI/AIInternals.h:70-123`). Weapons: `MIN_PRONE_RANGE 50`, `POINT_BLANK_RANGE 16` (cell units, 10 per tile),
`AIM_BONUS_CROUCHING 10`, `AIM_PENALTY_TARGET_CROUCHED 20` (`Tactical/Weapons.h`).

**Dependencies kept abstract.** Attacks (chance to hit, damage estimates, AP costs, bursts, throws, stabs) and items
(inventory slots, ammo, item classes, pocket swaps, item search) are specified by the attack and item docs (11/12).
This doc names the queries the AI makes (§7.5, §12) and assumes they exist. The turn-based core (team turns, AP
refresh, interrupts, `ubAttackBusyCount`, `DeductPoints`) is assumed as in `03` §4.

---

## 1. The turn-based driver

### 1.1 `HandleSoldierAI` in TB (`TacticalAI/AIMain.cc:86-519`)

Same function as the RT path of `09` §1.2, with these TB differences, in order:
1. Gates `:91-99` as in RT. `gfTurnBasedAI = TRUE` (`:118-126`).
2. `:128-158`: return if `bTeam != OUR && ubCurrentTeam == OUR`; return unless `SOLDIER_UNDERAICONTROL`; a soldier not
   on `ubCurrentTeam` loses the flag and returns; `bMoved` → `EndAIGuysTurn`, return. No `AICounter` gate.
3. `fGettingHit` → return; boxing, dying (`bLife < OKLIFE`), `AI_ASLEEP` (a **visible** sleeper wakes up in TB,
   `:216-235`), `!bInSector`, vehicle/robot, `bCollapsed` (`CancelAIAction` first) → each `EndAIGuysTurn`, return.
4. Profiles SERGEANT/MIKE/JOE in combat with a talk panel or a non-empty dialogue queue → return (`:281-284`).
5. **New situation** (`:288-357`): if `bNewSituation == IS`: with `ubAttackBusyCount > 0` it is processed only if the
   soldier's action is FIRE_GUN and no bullet is in flight (`guiNumBullets == 0`), or TOSS_PROJECTILE and no physics
   object is in flight (`guiNumObjectSlots == 0`; this one also zeroes the busy count). Processing: `CancelAIAction`;
   `bNextAction = NONE` (the END_COWER_AND_MOVE guard is always true, `09` §1.2); `DecideAlertStatus`. Else `NOT`.
6. `:366-381` 15 s deadlock breaker (not ported, `deviations.md`).
7. `bAction == NONE` → `EndMuzzleFlash`, **`TurnBasedHandleNPCAI`**; else the **continue branch** `:408-511`, shared
   with RT: for `FIRST_MOVEMENT_ACTION <= bAction <= LAST_MOVEMENT_ACTION` (1..21, Strac) and not `fDelayedMovement`:
   path exhausted → `MOVE_TO_CLIMB` at its destination becomes a queued CLIMB_ROOF if affordable (`:464-480`:
   `bAction = CLIMB_ROOF; if IsActionAffordable: bAction = NONE, bNextAction = CLIMB_ROOF`), then `ActionDone`;
   then `fNoAPToFinishMove` → `SoldierTriesToContinueAlongPath`, or stationary-animation continue as in `09` §1.2.

Because `TurnBasedHandleNPCAI` is only reached with `bAction == NONE`, an action in progress is never re-decided:
it ends only through one of the completion hooks of §1.4.

### 1.2 `TurnBasedHandleNPCAI` (`AIMain.cc:965-1222`)

```
(:1032-1066 dead: bAction is always NONE here, so ActionInProgress is never called; same in RTHandleAI)
bActionInProgress = false; bPathStored = false
if bNextAction != NONE:
   END_COWER_AND_MOVE: as RT (09 §1.3): STOP_COWERING / CHANGE_STANCE(ANIM_STAND) / NONE, then WALK to the data or NONE
   else: bAction = bNextAction; usActionData = usNextActionData; bTargetLevel = bNextTargetLevel; clear the three (data 0)
   PICKUP_ITEM: uiPendingActionData1 = iNextActionSpecialData                                     // items doc
elif sAbsoluteFinalDestination != NOWHERE: bAction = schedule ? SCHEDULE_MOVE : WALK; usActionData = it    // hook
elif !ENGAGED_IN_CONV: bAction = creature ? CreatureDecideAction : crow ? CrowDecideAction : DecideAction(s)
if bAction == ABSOLUTELY_NONE: bAction = NONE
if bAction == NONE: NPCDoesNothing(s) → EndAIGuysTurn(s); return
if IsActionAffordable(s):
   NPCDoesAct(s)                      // TB: hidden-interrupt display hooks; bDesiredDirection = bDirection
   bActionInProgress = ExecuteAction(s)
   if !bActionInProgress && sAbsoluteFinalDestination != NOWHERE: EndAIGuysTurn(s)
else: HaltMoveForSoldierOutOfPoints(s)   // Movement.cc:616-632: unless ANIM_SPECIALMOVE: fNoAPToFinishMove = true,
                                         // EndAIGuysTurn; the action is KEPT for the next turn
```
A kept action resumes next turn through the continue branch (`fNoAPToFinishMove` → `SoldierTriesToContinueAlongPath`)
at GREEN/YELLOW; at RED/BLACK `RefreshAI` sets a new situation, which cancels it first (§1.5). A kept non-movement
action has no continue path and would hang until the deadlock breaker; the deciders never pick one they cannot
afford, so this is unreachable (inferred).
Consequences: every AI decision in TB happens in the overhead pass right after the previous action's completion hook
fired, for one soldier at a time (the AI list order, §1.5). RNG order across soldiers is therefore the AI list order.

### 1.3 `IsActionAffordable` (`TacticalAI/AIUtils.cc:438-549`)

`need > bActionPoints` → false. `need` by action:

| Action | Points needed |
|---|---|
| NONE, GIVE_AID, COWER, STOP_COWERING, LOWER_GUN, END_COWER_AND_MOVE, TRAVERSE_DOWN, OFFER_SURRENDER, WAIT, END_TURN, unlisted | 0 |
| CHANGE_FACING | `GetAPsToLook` = stand 1, crouch 2, prone `2 + 2·AP_PRONE` = 6 (`Tactical/Points.cc:1566-1585`) |
| all movement (RANDOM_PATROL … WALK, MOVE_TO_CLIMB, door actions) | `MinPtsToMove` = cheapest `ActionPointCost` of the 8 neighbours in `usUIMovementMode`, 127 for tanks (`Points.cc:1217-1240`) |
| PICKUP_ITEM | `max(MinPtsToMove, 3)`; DROP_ITEM 3 |
| FIRE_GUN, TOSS_PROJECTILE, KNIFE_MOVE, THROW_KNIFE | `MinAPsToAttack(s, usActionData, ADDTURNCOST)` (attack doc) |
| YELLOW_ALERT, RED_ALERT, CREATURE_CALL | `AP_RADIO` 5 |
| CHANGE_STANCE | `AP_CROUCH` 2 (whatever the target stance) |
| CLIMB_ROOF | 10 up, 6 down |
| PULL_TRIGGER / USE_DETONATOR | `AP_PULL_TRIGGER` / `AP_USE_REMOTE` |

RT: `bActionPoints` is refreshed by `CalcNewActionPoints` on every RT turn start and never spent (`DeductPoints`
zeroes AP costs outside combat, `Points.cc:488-498`), so RT checks pass except right after combat ends (inferred).

### 1.4 How actions end (completion hooks)

| Action | Ends when | Source |
|---|---|---|
| movement group | path exhausted in the continue branch (`ActionDone`); out of APs: `SoldierTriesToContinueAlongPath` → `CancelAIAction` | `AIMain.cc:413-509`, `Movement.cc:546-613` |
| CHANGE_FACING | `FreeUpNPCFromTurning` when the turn completes (`Soldier_Control.cc:4332`), or earlier by the truncation below | `AIMain.cc:742-751` |
| CHANGE_STANCE, COWER, STOP_COWERING | `FreeUpNPCFromStanceChange` on every `EVENT_InitNewSoldierAnim` when `ubHeight == usActionData` (`Soldier_Control.cc:1763, 3693`); CHANGE_STANCE also by the truncation below | `AIMain.cc:754-770` |
| FIRE_GUN, TOSS_PROJECTILE, KNIFE_MOVE, THROW_KNIFE | `FreeUpNPCFromAttacking` → `ActionDone` when `ubAttackBusyCount` reaches 0 | `Overhead.cc:5694`, `AIMain.cc:685-688` |
| YELLOW_ALERT, RED_ALERT | opcode 499 of `AI_RADIO`/`AI_CR_RADIO` → `FreeUpNPCFromPendingAction` → `ActionDone`; immediately if no radio animation (§1.6) | `Soldier_Ani.cc:1740-1765`, `AIMain.cc:649-682` |
| CLIMB_ROOF | `FreeUpNPCFromRoofClimb` at the climb commit opcodes | `Soldier_Ani.cc:252, 269, 1172` |
| WAIT, LOWER_GUN, END_TURN | inside `ExecuteAction` | §1.6 |

**Truncation (inferred from the call graph; the first thing to check with the oracle).** Strac's
`LAST_MOVEMENT_ACTION = CHANGE_STANCE` puts CHANGE_FACING and CHANGE_STANCE into the continue branch. Their path data
is empty (`EVENT_StopMerc` cleared it), so on the next overhead pass after `ExecuteAction` the branch calls
`ActionDone` (`AIMain.cc:482`) and then, because the animation is stationary, `SoldierTriesToContinueAlongPath`, which
finds `usActionData == NOWHERE` and calls `CancelAIAction` (`Movement.cc:563-567`). Effects in TB:
1. The AI re-decides 1–2 passes later while the turn or stance animation is still running (`ActionDone` does not stop
   either). If the new decision is again CHANGE_FACING (for example RED "look toward the closest opponent", §5),
   `NPCDoesAct` cancels the turn in progress and the new turn is charged again: `AP_LOOK_STANDING/CROUCHED/PRONE` =
   1/2/2 by end height, in `EVENT_InternalSetSoldierDesiredDirection` (`Soldier_Control.cc:3859-3881`). A visible
   enemy turns one octant per ~200 ms frame, so repeated re-decisions can drain APs. Unseen soldiers animate with
   delay 0 in combat (`08` §2.7) and finish the turn at once.
2. The extra `CancelAIAction` resets `SkipCoverCheck = FALSE` and `bBypassToGreen = 0`, so the cover-check skip set by
   CHANGE_FACING/CHANGE_STANCE (§1.6) never survives to the next decision, and every movement action that ends
   through the continue branch also clears the bypass (RT too: `09` §1.2 called it "harmless", but it does reset
   these two).
Vanilla ends the range at MOVE_TO_CLIMB (`V:TacticalAI/AI.h:32`): the turn ends in `FreeUpNPCFromTurning`, the stance
in `FreeUpNPCFromStanceChange`, and `SkipCoverCheck` stays set. Keep `LAST_MOVEMENT_ACTION` as a named constant
(`09`), port the Strac value, and make the vanilla value a one-line switch tested against the oracle. Note also that
`IsActionAffordable` asks for 6 APs to turn when prone (`GetAPsToLook`) but only 2 are charged.

### 1.5 Turn start, turn end, AI list

- `BeginTeamTurn(team)` (`Tactical/TeamTurns.cc:297-375`): `DecayPublicOpplist(team)`, `EVENT_BeginMercTurn` for
  each living member (opplist decay, `CalcNewActionPoints`: `min(ap, 5) + CalcActionPoints`, capped by body type,
  `bInitialActionPoints = ap`, `Soldier_Control.cc:410-436`), Strac's `BuildAIExposedTileMap` only with
  `avoid_light_tiles_at_night` (default off), then `BuildAIListForTeam` and `StartNPCAI(first)`.
- `StartNPCAI(s)` (`AIMain.cc:605-646`): `SOLDIER_UNDERAICONTROL`, `fTurnInProgress`, `sLastTwoLocations = NOWHERE`,
  **`RefreshAI(s)`**, locator (presentation), **`DecideAlertStatus(s)`** again.
- `RefreshAI(s)` (`:1228-1266`): `bLastAttackHit = false`; `DecideAlertStatus`; YELLOW → `SkipCoverCheck = false`;
  TB: RED/BLACK → `bNewSituation = IS` (fresh rethink at turn start, which also zaps any queued `bNextAction` on the
  first visit, §1.1 step 5); GREEN/YELLOW → `bPathStored = false` and `ManChecksOnFriends(s)`; `bLastAction = NONE`.
- `ManChecksOnFriends(s)` (`:1937-1986`), TB only: for each active merc (`ActiveMercs`, slot order) on the same side,
  not neutral, not self, with `PythSpacesAway <= DistanceVisible(s, IRRELEVANT, IRRELEVANT, friend)` and
  `SoldierToSoldierLineOfSightTest(s, friend, dist, TRUE)`: friend RED/BLACK, under fire or `bLife < OKLIFE` →
  `s` RED, `CheckForChangingOrders`, `SetNewSituation`, stop; friend YELLOW while `s` is GREEN → `s` YELLOW,
  `SetNewSituation`, `sNoiseGridno = friend.sGridNo`, `ubNoiseVolume = 3`, continue.
- `EndAIGuysTurn(s)` (`:522-574`), TB only: close-call quotes, hostile civ group spreads, `EndRadioLocator`,
  clear `SOLDIER_UNDERAICONTROL` and `fTurnInProgress`, `bMoved = TRUE`, **`bBypassToGreen = 0`**, then the next AI
  list entry (`StartNPCAI`) or `EndAITurn`.
- `BuildAIListForTeam` / AI list priorities: §1.8.

### 1.6 `ExecuteAction` for combat actions (`AIMain.cc:1305-1829`)

Entry: `SkipCoverCheck = FALSE; bLastAttackHit = FALSE`. Then (green actions as `09` §1.7):
- **WAIT** in TB: nothing, `ActionDone` (a RT leftover). **END_TURN**: `ActionDone`, TB `EndAIGuysTurn`, return false.
- **CHANGE_FACING**: `SkipCoverCheck = TRUE`, desired-direction event. **CHANGE_STANCE**: already at `usActionData`
  → `ActionDone`, false; else `SkipCoverCheck = TRUE`, `ChangeSoldierStance`.
- **Movement group** (`:1376-1560`) as `09` §1.7 plus: MOVE_TO_CLIMB with `usActionData == sGridNo` becomes CLIMB_ROOF
  and recurses if affordable (else returns false, the action stays); the **TB loop detector** (`:1410-1434`, TB and
  alert < BLACK): `sLastTwoLocations[0..1]` fill with the grid at each move start; when
  `usActionData == last[1] && sGridNo == last[0]` → `ActionDone` + `EndAIGuysTurn` (and the move still continues to
  `NewDest`, quirk, inferred harmless because the turn ended); else shift. Bloodcat growl `Random(2)` in combat (skip).
- **TOSS_PROJECTILE** → `LoadWeaponIfNeeded`; **KNIFE_MOVE** → `usUIMovementMode = DetermineMovementMode(KNIFE_MOVE)`;
  then FIRE_GUN/THROW_KNIFE too: if `bVisible != -1`, not militia, merc body without profile: `Random(50) == 0` →
  `StartCivQuote` (**main-stream draw on every visible attack**); `HandleItem(s, usActionData, bTargetLevel,
  inv[HANDPOS], FALSE)` (attack doc); not OK → `CancelAIAction`, `EndAIGuysTurn`.
- **RED_ALERT** (`:1657-1671`): non-PC and (`!bAwareOfOpposition` or (panic triggers here and no chosen one)) →
  `HandleInitialRedAlert(team)`; then falls into **YELLOW_ALERT** (`:1672-1681`): `DeductPoints(AP_RADIO, 0)`,
  `RadioSightings(s, EVERYBODY, team)` (`08` §2.5), `AIDecideRadioAnimation(s)`, return true.
- `AIDecideRadioAnimation` (`:1269-1302`): body not REGMALE/BIGMALE → `ActionDone` (STOCKYMALE and women have
  surfaces but never play it); CIV team except Kingpin's group → `ActionDone`; end height STAND → `AI_RADIO`, CROUCH →
  `AI_CR_RADIO`, PRONE → `ActionDone`. With `ActionDone` inside, the call still returns true, so
  `bActionInProgress = TRUE` with `bAction = NONE` (harmless, as WAIT in `09`).
- **COWER**: cowering → `ActionDone`, false; else `usActionData = ANIM_CROUCH`, `SetSoldierCowerState(TRUE)`
  (`START_COWER`, `ubDesiredHeight = CROUCH`, `Soldier_Control.cc:8462-8495`). **STOP_COWERING** as `09`.
- **LOWER_GUN**: `ActionDone` ("for now"). **CLIMB_ROOF**: `BeginSoldierClimbUpRoof` / `…DownRoof` by `bLevel`.
- **OFFER_SURRENDER**: `StartCivQuote` (strategic hook). PICKUP/DROP/GIVE_AID/doors/panic: items and NPC docs.

### 1.7 Movement in TB: AP reserve, budget, continuing

- **`InternalGoAsFarAsPossibleTowards(s, des, reserve, action, flags)`** (`TacticalAI/Movement.cc:281-539`), TB
  additions to `09` §2.4: `reserve = -1` → 0 for creatures, else `MAX_AP_CARRIED` (5). Mode is computed first; with
  `FLAG_CAUTIOUS` RUNNING becomes WALKING (`:318-322`). In the step loop, TB only: at step 0 add `AP_START_RUN_COST`
  when running; add `EstimateActionPointCost(s, t, dir, mode, i, ubPathDataSize)`; `apsLeft = bActionPoints − cost`;
  `apsLeft < reserve` → stop before `t`; else accept `t` and stop if `apsLeft == reserve`. RT never stops for APs.
  `FLAG_STOPSHORT` stops when `SpacesAway(des, t) <= 5`.
- **`gubNPCAPBudget` / `gubNPCDistLimit`**: reset to 0 at the end of every overhead pass (`Overhead.cc:1138-1139`).
  Only the cover/flight searches set them (§8): the path search then floods only tiles reachable within the budget.
  `FindBestPath` clears both whenever it plans a route the budget cannot pay (`PathAI.cc:676-708, 1494-1520`), so a
  failed budgeted search leaves them 0 (`07` §3).
- **`SoldierTriesToContinueAlongPath`** (`Movement.cc:546-613`), from the continue branch when `fNoAPToFinishMove`:
  new situation → cancel; data ≥ GRIDSIZE → cancel; `!NewOKDestination(data, people)` → cancel; affordable → if not in
  progress: `NPCDoesAct`, `ExecuteAction`; else `CancelAIAction`. Then the next step's `EstimateActionPointCost` ≤ APs →
  `NewDest(s, nextTile)`, `bActionInProgress = TRUE`; else `CancelAIAction`. (The second part runs even after a cancel,
  quirk: it reads the path that `ActionDone`/`EVENT_StopMerc` just cleared, inferred harmless.)
- **Out of points while walking**: the walking code halts the soldier (`HaltGuyFromNewGridNoBecauseOfNoAPs` /
  `HaltMoveForSoldierOutOfPoints`, `Overhead.cc:866, 1143-1159`): `fNoAPToFinishMove`, stop at the tile. The next
  visit's continue branch then cancels the action (no APs), the next decision usually returns NONE and the turn ends.
- **`NewDest`** (`AIUtils.cc:356-435`), combat cases: TAKE_COVER by a merc body with attitude DEFENSIVE/CUNNINGSOLO/
  CUNNINGAID and `SoldierDifficultyLevel >= 2`: mode `m = MovementMode[TAKE_COVER][Urgency[alert][morale]]` (always
  RUNNING); if `m != SWATTING`: SWATTING if `EnoughPoints(s, RecalculatePathCost(s, SWATTING), 0, FALSE)` or
  (`bLastAction == TAKE_COVER && usUIMovementMode == SWATTING`), else `m`. Otherwise **ENEMY team at RED**:
  `PreRandom(5 − SoldierDifficultyLevel) == 0` and `MostImportantNoiseHeard` within `26 + 10` Pyth tiles → SWATTING;
  else `DetermineMovementMode(bAction)`. SWATTING on non-merc bodies → WALKING. Then
  `EVENT_InternalGetNewSoldierPath(…, force = fNoAPToFinishMove)`.

### 1.8 AI list (who acts in which order) and the TB visit cadence

See §10.3 (from `TacticalAI/AIList.cc`).

---

## 2. Knowledge and alert helpers

### 2.1 `MostImportantNoiseHeard(s) → {grid, value, climb, reachable}` (`TacticalAI/Knowledge.cc:26-300`)

The grid part is ported (`src/sim/tactical/perception/knowledge.ts`, `09` §4.2). Combat needs the outputs too:
- `value` = the best (largest, ≤ 0) candidate value; initial best `−10000`, strict `>` keeps the first of equal values.
- `reachable` (only when a grid was found, `:247-288`): starts true. The civ/profiled room test (`:251-263`) compares
  `GetRoom(usPatrolGrid[0])` with itself, so it never fires (same in vanilla, `V:Knowledge.c:243-254`; quirk, port
  as dead). Then `GetInterveningClimbingLocation(s, grid, level)` (§2.4): climbing needed and no climb point →
  `reachable = false`; climbing needed and found → **the returned grid becomes the climb point** and `climb = true`.
- Callers that pass no out-parameters get only the grid (no climb substitution).

### 2.2 `WhatIKnowThatPublicDont(s, inSightOnly)` (`Knowledge.cc:303-349`)

`UINT8` total (wraps at 256, never in practice). Non-creatures add `ubNoiseVolume − gubPublicNoiseVolume[team]` when
positive. Then for every merc in `MercSlots` order that is not `CONSIDERED_NEUTRAL(s, o)` and not on `s.bSide`:
`inSightOnly` → `+1` if personal is `SEEN_CURRENTLY` and public is not; else `+gubKnowledgeValue[public+4][personal+4]`
(`08` §2.5).

### 2.3 Radio, `HandleInitialRedAlert`, `last_merc_to_radio`

- `RadioSightings(s, EVERYBODY, team)` is in `08` §2.5. Add: its first statement sets
  `Team[s.bTeam].last_merc_to_radio = s` (`Tactical/OppList.cc:2479`), for every caller (the automatic radio after a
  sighting too). It is cleared when that soldier is removed as a target (`:2106`), by `DecayPublicOpplist` when the team
  knows nothing publicly (`:4527`), and on sector init (`Overhead.cc:365, 5973`). The port has no such field yet.
- `HandleInitialRedAlert(team)` (`AIMain.cc:1899-1934`): ENEMY team with panic triggers → `MakeClosestEnemyChosenOne`
  (panic hook); ENEMY team in Meduna (P3) → Queen and Joe to RED; then `Team[team].bAwareOfOpposition = TRUE`. Callers:
  the RED_ALERT action (§1.6), `RadioSightings` to MILITIA (`08` §2.5). Every non-CIV soldier of an aware team goes RED
  at his next `DecideAlertStatus` (`09` §2.2).

### 2.4 Climbing helpers (`TacticalAI/AIUtils.cc:1191-1391`)

- `FindClosestClimbPointAvailableToAI(s, start, desired, up)` (`:1191-1237`): roaming origin/range (`09` §2.4; a PC
  under AI uses own grid / 99); Strac policy `stay_on_rooftop` (default **off**) forbids ONGUARD/CLOSEPATROL/FARPATROL
  roof soldiers to climb down; `g = FindClosestClimbPoint(start, desired, up)` (`Tactical/Structure_Wrap`/building
  code, roof doc); `PythSpacesAway(origin, g) + 1 > range` → NOWHERE, else `g`.
- `GetInterveningClimbingLocation(s, dest, destLevel, &climb)` (`:1258-1291`): same level and (ground, or same
  `gubBuildingInfo`) → no climb, NOWHERE; same level, different buildings → climb, closest climb-**down** point of the
  current building (`start = desired = s.sGridNo`); level 0 → 1 → climb-up point toward `dest`; 1 → 0 → climb-down point.
- `EstimatePathCostToLocation(s, dest, destLevel, addAfterClimbUp, &climb, &climbGrid)` (`:1293-1391`): no climb →
  `EstimatePlotPath(s, dest, NO_COPY, NO_PLOT, WALKING, 0)` (`07` §3.6); otherwise find the climb point as above; none
  → 0; else `PlotPath` to it (0 → unreachable, return 0), plus `AP_CLIMBROOF` (up) or `AP_CLIMBOFFROOF` (down), plus
  `(AP_MOVEMENT_FLAT + WALKCOST) × PythSpacesAway(climbGrid, dest)` (going down between buildings: with
  `addAfterClimbUp` add `AP_CLIMBOFFROOF + AP_CLIMBROOF` and the full walk, else `AP_CLIMBOFFROOF` and half the walk);
  `climb = true`, `climbGrid` set. Each `PlotPath`/`EstimatePlotPath` runs `FindBestPath` (counts in
  `gubNPCPathCount`).
- `ClimbingNecessary(s, dest, level)` (`:1239-1256`): the boolean part of the above.

### 2.5 `ClosestReachableFriendInTrouble(s, &climb)` (`AIUtils.cc:1418-1479`)

```
if s is on the CIV team: return NOWHERE (climb not written; callers pass a variable they initialised earlier, inferred)
best = NOWHERE; shortest = 1000; bestClimb = false
for f in MercSlots order: skip f.bNeutral or f.bSide != s.bSide; skip f == s
   skip unless f.bUnderFire or (f == Team[f.bTeam].last_merc_to_radio and GuySawEnemyThisTurnOrBefore(f))
      // GuySawEnemyThisTurnOrBefore: any id in a team of another side with f.bOppList[id] >= SEEN_CURRENTLY (1..5)
   skip if SpacesAway(s, f) == 1
   cost = EstimatePathCostToLocation(s, f.sGridNo, f.bLevel, TRUE, &c, &cg)
   if cost != 0 and cost < shortest: best = c ? cg : f.sGridNo; shortest = cost; bestClimb = c
climb = bestClimb; return best
```

### 2.6 Watched locations (`Tactical/OppList.cc:134-141, 4805-5060`)

Per soldier, 3 slots `{grid, level, points ≤ 4, reset, incrementedThisLook}` (`NUM_WATCHED_LOCS 3`,
`MAX_WATCHED_LOC_POINTS 4`, `WATCHED_LOC_RADIUS 1`). Used by RED "watch" (§5) and interrupt points (`03` §4).
- `HandleSight` clears every `incrementedThisLook` of the looker (`:656-659`).
- `ManSeesMan`, hostile new opponent not `SEEN_THIS_TURN` → `IncrementWatchedLoc(s, opp.grid, opp.level)`
  (`:1790`); already seen this turn → `SetWatchedLocAsUsed` (reset = false) (`:1801`).
- `IncrementWatchedLoc` (`:4963-5000`): find a slot on the same level within `SpacesAway ≤ 1`; none → first free slot,
  else first slot with points ≤ 1 → `{grid, level, 1}` and `CommunicateWatchedLoc(…, 1)`; found and not yet
  incremented this look and < 4 → `++points`, communicate the new value; reset = false, incremented = true.
- `CommunicateWatchedLoc(watcher, grid, level, pts)` (`:4917-4960`): every other teammate valid for sightings with
  `bLife >= OKLIFE`: same search; new → free slot or a slot with points ≤ `pts`, set to `pts`; existing → `max`.
- `DecayWatchedLocs(team)` (`:5032-5060`, from `DecayPublicOpplist`): each used slot whose 3×3 area holds nobody of
  another team: reset set → clear it and halve points (0 → slot freed); else set reset.
- `GetHighestWatchedLocPoints(s)` = max points of used slots, 0 if none (`:4901-4914`).
  `GetHighestVisibleWatchedLoc(s)` (`:4873-4898`): first slot with strictly more points than the best so far that passes
  `SoldierTo3DLocationLineOfSightTest(s, grid, level, cubeLevel 3, DistanceVisible(s, IRRELEVANT, IRRELEVANT, grid,
  level), TRUE)`; −1 if none.

### 2.7 `CheckForChangingOrders` at RED/BLACK and difficulty

`AIMain.cc:1859-1883` (the GREEN case is in `09` §2.2): ONGUARD → CLOSEPATROL, CLOSEPATROL → FARPATROL (`bOrders++`);
else MILITIA → SEEKENEMY; else creatures not STATIONARY/ONCALL → SEEKENEMY; WARDEN → `MakeClosestEnemyChosenOne`
(panic hook). Called by `DecideAlertStatus` on every BLACK evaluation (`bOppCnt > 0`, so a soldier seeing enemies is
re-escalated at each status check: ONGUARD reaches FARPATROL after two checks) and on the first RED/BLACK entry.
`gbDiff` (`AIMain.cc:53-62`) and `SoldierDifficultyLevel`: §4.3.

---

## 3. `DecideActionYellow` (`TacticalAI/DecideAction.cc:1075-1445`)

`fCivilian = CIV team && (NON_CIV_GROUP || bNeutral || FATCIV <= body <= CRIPPLECIV)` (same as green).

```
 1. civilian: cowering → usActionData = ANIM_STAND, STOP_COWERING
              RT and profiled → a = DecideActionNamedNPC(s) (hook, 09 §5); a != NONE → return a
 2. {noise, value, climb, reachable} = MostImportantNoiseHeard(s)            // §2.1
    noise == NOWHERE → NONE
 3. TURN (:1135-1159): dir = GetDirectionToGridNoFromGridNo(s.grid, noise)
    if (RT or GetAPsToLook <= AP) and bDirection != dir and PythSpacesAway(s, noise) <= 26:
       chance = (STATIONARY or ONGUARD) ? 60 : 35; DEFENSIVE +15
       if PreRandom(100) < chance and InternalIsValidStance(s, dir, endHeight): usActionData = dir → CHANGE_FACING
 4. RADIO (:1168-1211): if !fCivilian and AP >= AP_RADIO and Team[team].bMenInSector > 1:
       chance = 5 · WhatIKnowThatPublicDont(s, FALSE)
       if chance != 0 and !DeepWater(s.grid):
          chance += gbDiff[DIFF_RADIO_RED_ALERT][SoldierDifficultyLevel(s)] / 2        // 25, 32, 40, 45, 47
          orders: STATIONARY +20, ONGUARD +15, ONCALL +10, CLOSE/RNDPT/POINT 0, FARPATROL −10, SEEKENEMY −20
          attitude: DEFENSIVE +20, BRAVESOLO −10, BRAVEAID 0, CUNNINGSOLO −5, CUNNINGAID 0, AGGRESSIVE −20,
                    ATTACKSLAYONLY = 0 (assignment)
          if PreRandom(100) < chance → YELLOW_ALERT
 5. tank → NONE
 6. bBreath < 25 and !MercInWater → usActionData = NOWHERE, NONE
 7. unless (CIV team and profiled and not ELDIN):
    a. forget (:1233-1243): reachable and !climb and RT and (MILITIA or CIV team) and PythSpacesAway(s, noise) < 5
       and SoldierTo3DLocationLineOfSightTest(s, noise, s.bLevel, cubeLevel 0, 6, TRUE):
       reachable = false; sNoiseGridno = NOWHERE; ubNoiseVolume = 0
    b. SEEK NOISE (:1249-1301), if reachable:
       chance = 95 + value / 3 (C truncation toward 0; value <= 0)
       orders: STATIONARY −20, ONGUARD −15, ONCALL 0, CLOSEPATROL −10, RNDPT/POINT 0, FARPATROL +10, SEEKENEMY +25
       attitude: DEFENSIVE −10, BRAVESOLO +10, BRAVEAID +5, CUNNINGSOLO +5, CUNNINGAID 0, AGGRESSIVE +20, ATTACKSLAYONLY +20
       chance −= 100 − bBreath
       if PreRandom(100) < chance:
          usActionData = GoAsFarAsPossibleTowards(s, noise, SEEK_NOISE)
          if != NOWHERE: (climb and usActionData == noise) ? MOVE_TO_CLIMB : SEEK_NOISE
    c. SEEK FRIEND (:1308-1359): friend = ClosestReachableFriendInTrouble(s, &climb)      // §2.5, overwrites climb
       if friend != NOWHERE:
          chance = 50 − SpacesAway(s, friend)
          orders: STATIONARY −20, ONGUARD −15, ONCALL +20, CLOSEPATROL −10, RNDPT/POINT −10, FARPATROL 0, SEEKENEMY +10
          attitude: DEFENSIVE −10, BRAVESOLO 0, BRAVEAID +20, CUNNINGSOLO 0, CUNNINGAID +20, AGGRESSIVE −20, ATTACKSLAYONLY −20
          chance −= 100 − bBreath
          if PreRandom(100) < chance:
             usActionData = GoAsFarAsPossibleTowards(s, friend, SEEK_FRIEND)
             if != NOWHERE: (climb and usActionData == friend) ? MOVE_TO_CLIMB : SEEK_FRIEND
    d. COVER (:1366-1410), TB only and !SkipCoverCheck:
       chance = 25; orders: STATIONARY +20, ONGUARD +15, ONCALL 0, CLOSEPATROL +10, RNDPT/POINT 0, FARPATROL −5,
       SEEKENEMY −20; attitude: DEFENSIVE +10, BRAVESOLO −15, BRAVEAID −20, CUNNINGSOLO +20, CUNNINGAID +15,
       AGGRESSIVE −10, ATTACKSLAYONLY −10; chance −= 100 − bBreath
       if PreRandom(100) < chance:
          bAIMorale = CalcMorale(s)                                                    // §4.1
          usActionData = FindBestNearbyCover(s, bAIMorale, &dummy)                    // §8.2
          if != NOWHERE → TAKE_COVER
 8. BYPASS (:1416-1421): if PreRandom(100) < 50: bBypassToGreen = 15; return DecideActionGreen(s)    // 09 §2.3
 9. CROUCH (:1429-1436): !fCivilian and !PTR_CROUCHED (ubHeight != CROUCH; a prone soldier qualifies) and
    IsValidStance(s, ANIM_CROUCH) and (RT or GetAPsToChangeStance(s, CROUCH) <= AP):
    usActionData = ANIM_CROUCH → CHANGE_STANCE
10. usActionData = NOWHERE → NONE
```

Notes:
- `PreRandom(100)` in step 4 is drawn even when ATTACKSLAYONLY zeroed the chance; in step 3 it is skipped when the
  soldier already faces the noise or it is farther than 26 tiles.
- Step 3's `dir` is `GetDirectionToGridNoFromGridNo` (the 8-way direction of the grid delta, `Isometric_Utils`), not
  `atan8`.
- Step 7 is skipped entirely for profiled civilians other than Eldin (Fatima, Pacos): they turn, else 50 % green, else
  NONE (they are civilians, so no crouch).
- `RT` radio: `bActionPoints >= 5` passes (§1.3), so the radio is reachable in RT for troops.
- In RT none of the YELLOW actions queues a WAIT (unlike green): after CHANGE_FACING, SEEK_NOISE, SEEK_FRIEND,
  YELLOW_ALERT or CHANGE_STANCE the soldier re-decides at the first visit after the action ends. NONE becomes WAIT
  `REALTIME_AI_DELAY` / `REALTIME_CIV_AI_DELAY` in `RTHandleAI` (`09` §1.3).
- The bypass: in RT `DecideAction` clears `bBypassToGreen` only when it enters through the bypass branch, so the
  decision after a step-8 bypass is green again (+15) and then YELLOW resumes. In TB the bypass lasts until
  `CancelAIAction` (new situation, the truncation of §1.4) or `EndAIGuysTurn`.
- Movement mode at YELLOW: `Urgency[YELLOW] = {HIGH, MED, MED, LOW, LOW}` by `bAIMorale`. `bAIMorale` is only
  recomputed by `CalcMorale` (§4.1) at RED/BLACK or in step 7d, and it starts at the placement value: 0 = HOPELESS for
  basic placements (zero-initialised create struct; `Soldier_Create.cc:823`; inferred for map placements, check the
  detailed-placement value). A soldier who never computed morale therefore has urgency HIGH at YELLOW: SEEK_NOISE and
  SEEK_FRIEND **run** (`MovementMode` rows `{WALKING, SWATTING, RUNNING}` and `{WALKING, RUNNING, RUNNING}`). The
  port's `ai.morale` default 0 matches.

### 3.1 RNG order of one YELLOW decision

1. `DecideAlertStatus` (RT `RefreshAI`): `Random(1000)` only if it calls `SetNewSituation` (RT only).
2. Named-NPC hook (RT civilians with profile).
3. `MostImportantNoiseHeard`: none (LOS tests and path costs only).
4. Turn: `PreRandom(100)` if the guard passed.
5. Radio: `PreRandom(100)` if the guard and `chance != 0 && !deep water` passed.
6. Seek noise: `PreRandom(100)` if reachable; on success `GoAsFar` (main-stream shuffle only when the noise tile itself
   is not a legal destination, `09` §2.4; kids `Random(10)` only at GREEN, so none here).
7. Friend: `PreRandom(100)` if a friend was found; on success `GoAsFar` as above.
8. Cover (TB): `PreRandom(100)`; on success `CalcMorale` (no draws) and `FindBestNearbyCover` (§8.2 lists its draws).
9. Bypass: `PreRandom(100)`; on success the whole green RNG sequence of `09` §2.5 with `bBypassToGreen = 15`.
10. RT NONE → the WAIT draw. Execution of a move → `NewDest` (§1.7: ENEMY at RED only, so no swat roll at YELLOW).

---

## 4. Morale, threat, difficulty

(filled from `AIUtils.cc` below)

---

## 5. `DecideActionRed(s, unconsciousOK)` (`DecideAction.cc:1448-2454`)

`fCivilian` differs from green/yellow/black: `CIV team && (NON_CIV_GROUP || (bNeutral && fCivGroupHostile[group] ==
CIV_GROUP_NEUTRAL) || FATCIV <= body <= CRIPPLECIV)` (`:1462-1468`). `DecideAction` calls it with `unconsciousOK =
TRUE`; BLACK calls it with FALSE (§6.3).

```
 1. AP == 0 → usActionData = NOWHERE, NONE
    canMove = AP >= MinPtsToMove(s)
 2. PANIC (:1481-1500): (not CIV team or WARDEN) and (bAwareOfOpposition or s is the chosen one or WARDEN) and panic
    bombs/triggers here → PanicAI(s, canMove) (§9.4); result != -1 → return it
 3. QUEEN/JOE in Meduna, canMove, not the alternate position → HeadForTheStairCase (hook); != NONE → return it
 4. inWater = Water, inDeepWater = DeepWater, inGas = InGasOrSmoke(s, grid)        // gas: items/explosions doc
 5. TIXA only, !inGas: PreRandom(10) == 0 and WearGasMaskIfAvailable(s) → re-evaluate inGas      // draw only in Tixa
 6. inGas and canMove: d = FindNearestUngassedLand(s) (§8.4); != NOWHERE → LEAVE_WATER_GAS
 7. CIVILIAN COWER (:1553-1617), fCivilian and body not COW/CRIPPLECIV and FindAIUsableObjClass(s, IC_WEAPON) ==
    ITEM_NOT_FOUND: → §9.1 block (returns in every branch)
 8. LIGHT (:1622-1653): lit = InLightAtNight(grid, level) (§8.5)
    if lit and policy avoid_light_tiles_at_night (default OFF): militia → lit = false; else no known opponent or
       PythSpacesAway(s, ClosestKnownOpponent) > 26 + STRAIGHT (13) → lit = false
    if canMove and lit and orders != STATIONARY: d = FindNearbyDarkerSpot(s) (§8.5); != NOWHERE → LEAVE_WATER_GAS
 9. CIVILIAN COWER again (:1655-1719): the identical block (unreachable: step 7 already returned for the same condition)
10. LONG-RANGE TOSS (:1726-1789), TB only, !fCivilian, !inWater, !inGas, not boxer, CanNPCAttack(s) == TRUE:
       CheckIfTossPossible(s, &bestThrow) (§7.2)
       possible: mortar needs room (§6.6 mortar rule; may return GET_CLOSER one tile back); bring the item to hand
          (RearrangePocket FOREVER); usActionData = target; bAimTime = bestThrow.ubAimTime → TOSS_PROJECTILE
       not possible: if bestThrow.bWeaponIn != NO_SLOT and CalcMaxTossRange(s, item, TRUE) > 26 and men > 1 and
          ubSpottersCalledForBy == NOBODY: ubSpottersCalledForBy = s; AP = 0; usActionData = NOWHERE → NONE
11. BREATH (:1797-1810): bBreath < 25 and !inWater and !bUnderFire:
       !fCivilian and !PTR_CROUCHED and IsValidStance(CROUCH) and (RT or GetAPsToChangeStance(CROUCH) <= AP)
          → usActionData = ANIM_CROUCH, CHANGE_STANCE
       usActionData = NOWHERE → NONE
12. bAIMorale = CalcMorale(s) (§4.1)
13. HOPELESS and canMove: d = FindSpotMaxDistFromOpponents(s) (§8.3); != NOWHERE → RUN_AWAY
14. RADIO RED ALERT (:1839-1901): !fCivilian and AP >= 5 and men > 1:
       chance = (!bAwareOfOpposition or NeedToRadioAboutPanicTrigger()) ? gbDiff[RADIO][diff]   // 50/65/80/90/95
                                                                      : 10 · WhatIKnowThatPublicDont(s, FALSE)
       if chance != 0 and !inDeepWater:
          orders: STATIONARY +20, ONGUARD +15, ONCALL +10, CLOSEPATROL 0, RNDPT/POINT −5, FARPATROL −10, SEEKENEMY −20
          attitude: DEFENSIVE +20, BRAVESOLO −10, BRAVEAID 0, CUNNINGSOLO −5, CUNNINGAID 0, AGGRESSIVE −20,
                    ATTACKSLAYONLY = 0
          unless (panic triggers here and !aware): morale HOPELESS ×3, WORRIED ×2, NORMAL ×1, CONFIDENT /2, FEARLESS /3
          if PreRandom(100) < chance → RED_ALERT
15. MAIN RED (:1903-2243), not a tank:
    if canMove and AP > MAX_AP_CARRIED (5) and !fCivilian:        // civilians never enter; the inner civilian case is dead
       watch = GetHighestWatchedLocPoints(s) (§2.6); watch <= 0 → −99
       seek = help = hide = 0
       morale:   HOPELESS seek=−99 help=−99 hide=+1 watch=−99 (assignments); WORRIED −1/0/+1/+1; NORMAL 0/0/0/0;
                 CONFIDENT +1/0/−1/0; FEARLESS +1/0/hide=−1 (assignment)/0
       orders:   STATIONARY −1/−1/+1/+1; ONGUARD −1/0/+1/+1; CLOSE, RNDPT, POINT, FAR 0/0/0/0; ONCALL 0/+1/−1/0;
                 SEEKENEMY +1/0/−1/−1
       attitude: DEFENSIVE −1/0/+1/+1; BRAVESOLO +1/−1/−1/−1; BRAVEAID +1/+1/−1/−1; CUNNINGSOLO 0/−1/+1/0;
                 CUNNINGAID 0/+1/+1/0; AGGRESSIVE +1/0/−1/0; ATTACKSLAYONLY +1/0/−1/0
       (INT8 arithmetic; −99 ± 3 stays below −90)
       RT: hide = −99
       while seek > −90 or help > −90 or hide > −90:              // watch is not part of the loop condition
          if seek > −90 and seek >= help, hide, watch:     SEEK (a); seek = −99
          if watch > −90 and watch >= seek, help, hide:    WATCH (b); watch = −99
          if help > −90 and help >= seek, hide, watch:     HELP (c); help = −99
          if hide > −90 and hide >= seek, help, watch:     HIDE (d); hide = −99
       (each test uses the values as updated by the earlier tests of the same iteration)
    (a) d = ClosestReachableDisturbance(s, unconsciousOK, &climb) (§4.4)
        if d != NOWHERE:
           usActionData = GoAsFarAsPossibleTowards(s, d, SEEK_OPPONENT)
           corpse-warning policy (default OFF): ArmySeesOpponents false and a rotting-corpse warning at the target →
              NOWHERE
           if usActionData != NOWHERE:
              climb and usActionData == d → MOVE_TO_CLIMB
              attitude DEFENSIVE/CUNNINGSOLO/CUNNINGAID:
                 if PythSpacesAway(usActionData, d) < 5 or LocationToLocationLineOfSightTest(usActionData, level, d,
                    level, 26, TRUE):
                    usActionData = InternalGoAsFar(s, d, reserve = MinAPsToAttack(s, d, ADDTURNCOST, AFTER_MOVING) +
                                   AP_CROUCH, SEEK_OPPONENT, FLAG_CAUTIOUS)
                    if != NOWHERE: fAIFlags |= AI_CAUTIOUS; bNextAction = END_TURN → SEEK_OPPONENT
                    (NOWHERE: fall through to seek = −99; the first GoAsFar's path state stays, inferred harmless)
                 else → SEEK_OPPONENT
              other attitudes → SEEK_OPPONENT
    (b) loc = GetHighestVisibleWatchedLoc(s) (§2.6); if loc != −1:
           dir = GetDirectionToGridNoFromGridNo(s.grid, watchedGrid)
           bDirection != dir and InternalIsValidStance(s, dir, endHeight) → usActionData = dir, bNextAction = END_TURN,
              CHANGE_FACING
           else if endHeight == STAND and InternalIsValidStance(s, dir, CROUCH) → CROUCH, bNextAction = END_TURN,
              CHANGE_STANCE
           else if ubHeight != PRONE:
              if (PreRandom(2) == 0 or policy ai_go_prone_more_often (default OFF; the draw happens first)) and
                 InternalIsValidStance(s, dir, PRONE) → PRONE, bNextAction = END_TURN, CHANGE_STANCE
              → END_TURN
           (a prone watcher facing the spot falls through: watch = −99)
    (c) f = ClosestReachableFriendInTrouble(s, &climb) (§2.5)
        if f != NOWHERE: usActionData = GoAsFar(s, f, SEEK_OPPONENT)      // movement mode of SEEK_OPPONENT
           if != NOWHERE: (climb and usActionData == f) ? MOVE_TO_CLIMB : SEEK_FRIEND
    (d) opp = ClosestKnownOpponent(s) (§4.4)
        if !SkipCoverCheck and opp != NOWHERE:
           usActionData = FindBestNearbyCover(s, bAIMorale, &dummy) (§8.2)
           if != NOWHERE:
              d = ClosestReachableDisturbance(s, unconsciousOK, &climb)
              if d != NOWHERE and (SpacesAway(cover, d) < 5 or SpacesAway(cover, d) + 5 < SpacesAway(s, d)):
                 if InternalGoAsFar(s, cover, reserve = MinAPsToAttack(s, opp, ADDTURNCOST, AFTER_MOVING) + AP_CROUCH,
                                    TAKE_COVER, 0) == cover → TAKE_COVER
              else → TAKE_COVER
16. UNDER FIRE (:2200-2242), not a tank: if bUnderFire or fCivilian:
       if bShock > 0 or fCivilian: d = FindSpotMaxDistFromOpponents(s); != NOWHERE → RUN_AWAY
       if !fCivilian:
          ubHeight == STAND and IsValidStance(CROUCH) and (RT or crouch APs) → CROUCH, CHANGE_STANCE
          else if ubHeight != PRONE: PreRandom(2) == 0 and IsValidStance(PRONE) → PRONE, CHANGE_STANCE
17. LOOK (:2250-2289): if RT or GetAPsToLook <= AP:
       opp = ClosestKnownOpponent(s); if opp != NOWHERE:
          dir = GetDirectionToGridNoFromGridNo(s.grid, opp)
          dist = DistanceVisible(s, IRRELEVANT, IRRELEVANT, opp, level 0)       // level 0 always (source comment)
          if bDirection != dir and PythSpacesAway(s, opp) <= dist:
             chance = (STATIONARY or ONGUARD) ? 50 : 25; DEFENSIVE +25; tank +50
             if PreRandom(100) < chance and InternalIsValidStance(s, dir, endHeight) → usActionData = dir, CHANGE_FACING
18. TANK (:2291-2338): random look (PreRandom(8) / PreRandom(100) < 60 / PreRandom(100) < 60 for the next-action
    END_TURN or WAIT REALTIME_AI_DELAY); then NONE. (Skip: no tanks before late game.)
19. PICKUP (:2351-2359): canMove and !bNeutral and (TB or ENEMY team): a = SearchForItems(s, SEARCH_GENERAL_ITEMS,
    inv[HANDPOS]) (items doc); != NONE → return a
20. BYPASS TO GREEN (:2385-2398): alert != BLACK and !bUnderFire and canMove and (RT or AP >= bInitialActionPoints)
    and ClosestReachableDisturbance(s, TRUE, &climb) == NOWHERE:
       bBleeding > MIN_BLEEDING_THRESHOLD (12) → bBleeding = max(0, bBleeding − AP); NONE
       bBypassToGreen = 30; return DecideActionGreen(s)
21. CROUCH (:2406-2418): !fCivilian and !inWater and ubHeight == STAND and IsValidStance(CROUCH):
       opp = ClosestKnownOpponent(s)
       if (opp != NOWHERE and PythSpacesAway(s, opp) < 26·3/2 = 39) or PreRandom(4) == 0:   // draw only if the first
          (RT or crouch APs) → CROUCH, CHANGE_STANCE                                       // part is false
22. PRONE UNDER FIRE (:2424-2446): !fCivilian and bUnderFire and AP >= bInitialActionPoints − GetAPsToLook and
    IsValidStance(PRONE): d = MostImportantNoiseHeard(s) (grid only); if d != NOWHERE:
       dir = direction to d; bDirection != dir → (RT or look APs) → CHANGE_FACING dir
       else (RT or prone APs) and InternalIsValidStance(s, dir, PRONE) → bNextAction = END_TURN, PRONE, CHANGE_STANCE
23. usActionData = NOWHERE → NONE
```

Notes:
- RT RED (after combat, or after a team radio made the team aware): no long-range toss, no hiding (`hide = −99`), the
  breath/crouch branches skip their AP checks. SEEK_OPPONENT/SEEK_FRIEND/RUN_AWAY queue no WAIT; NONE → WAIT
  `REALTIME_AI_DELAY`. The bypass of step 20 needs `ClosestReachableDisturbance == NOWHERE`, i.e. nothing known or
  reachable.
- `bNextAction = END_TURN` in RT: `RTHandleAI` turns it into the action; `ExecuteAction(END_TURN)` does `ActionDone`
  only (no turn to end), returns false.
- Step 15 loop termination: every iteration sets at least the best of the four to −99, so it ends.

### 5.1 RNG order of one RED decision (TB, ENEMY, no panic, not Tixa)

`DecideAlertStatus` (no draw in TB) → step 6/8 searches (§8 lists draws) → step 10 `CheckIfTossPossible` (§7.2) →
step 13 `FindSpotMaxDistFromOpponents` (if HOPELESS) → step 14 `PreRandom(100)` (if `chance != 0`) → step 15 in loop
order: seek (`GoAsFar` shuffle if the target tile is illegal), watch (`PreRandom(2)` only on the prone branch), help
(`GoAsFar`), hide (`FindBestNearbyCover`) → step 16 `FindSpotMaxDistFromOpponents`, `PreRandom(2)` → step 17
`PreRandom(100)` → step 19 `SearchForItems` → step 20 green sequence → step 21 `PreRandom(4)` → execution: `NewDest`
swat roll `PreRandom(5 − diff)` (ENEMY at RED, every move start, §1.7), `Random(50)` civ quote on attacks.

---

## 6. `DecideActionBlack(s)` (`DecideAction.cc:2457-3639`)

`fCivilian` as green/yellow (`bNeutral` alone). `BestShot/BestThrow/BestStab/BestAttack` are `ATTACKTYPE`
(`AIInternals.h:105-116`: `opponent, ubPossible, ubAimTime, ubChanceToReallyHit, iAttackValue, sTarget,
bTargetLevel, ubAPCost, bWeaponIn`). Only `ubPossible` is reset before use (`:2774-2778`); the other fields keep
garbage until a `CalcBest*` fills them (they call `InitAttackType` themselves, §7).

### 6.1 Prelude (`:2487-2654`)

```
 1. AP == 0 → usActionData = NOWHERE, NONE; canMove = AP >= MinPtsToMove(s)
 2. PANIC: (ENEMY team or WARDEN) and panic triggers here and no chosen one: closest panic trigger, not (an alarm
    while the team is aware), within Pyth < 10 → PossiblyMakeThisEnemyChosenOne(s); s is the chosen one →
    PanicAI(s, canMove); != -1 → return it                                                     // §9.4
 3. QUEEN in Meduna → HeadForTheStairCase (hook)
 4. boxer: PRE_BOXING → DecideActionBoxerEnteringRing (hook); BOXING → inDeepWater = inGas = false, bAIMorale =
    CalcMorale; other state → NONE
    else: inDeepWater = WaterTooDeepForAttacks(grid); inGas = InGasOrSmoke; bAIMorale = CalcMorale(s) (§4.1)
          TIXA only, !inGas: PreRandom(10) == 0 and WearGasMaskIfAvailable → inGas = false
          if inGas or bBreath < 5: canMove → d = FindSpotMaxDistFromOpponents(s); != NOWHERE → RUN_AWAY
                                   bAIMorale = HOPELESS
 5. (inDeepWater or inGas) and canMove: FindNearestUngassedLand → LEAVE_WATER_GAS; else FindSpotMaxDistFromOpponents
    → RUN_AWAY; else bAIMorale = HOPELESS
 6. SURRENDER (:2641-2654): ENEMY team, bVisible == TRUE (1), not yet offered, bLife >= bLifeMax / 2, no active MILITIA
    team, NumPCsInSector() < 4, Team[ENEMY].bMenInSector >= 3 · NumPCsInSector(), quest HELD_IN_ALMA not started (or
    done and INTERROGATION not started) → ENEMY_OFFERED_SURRENDER flag, OFFER_SURRENDER (strategic hook; M3: treat as
    a stub that never fires or log a deviation)
```

### 6.2 Can attack? (`:2662-2771`)

```
if AP < 2 or inDeepWater or inGas: canAttack = false
elif boxer: canAttack = true; tryPunching = true
else:
   loop:
      canAttack = CanNPCAttack(s)                      // §7.1: TRUE or a NOSHOOT_* code (negative)
      if canAttack != TRUE:
         if fCivilian:
            NOSHOOT_NOWEAPON and not boxer and body not COW/CRIPPLECIV → civilian cower block (§9.1, BLACK variant)
            (other codes: canAttack keeps the negative code → the loop repeats forever? no: the do-while condition is
             `canAttack != TRUE && canAttack != FALSE`, and a negative code is neither → infinite loop for an armed
             civilian whose CanNPCAttack returns e.g. NOSHOOT_NOAMMO (inferred; avoid: treat as FALSE and log))
         elif NOSHOOT_NOAMMO and canMove and !bNeutral:
            a = SearchForItems(s, SEARCH_AMMO, inv[HANDPOS]) (items doc); a != NONE → return a
            else: inv[HANDPOS].fFlags |= OBJECT_AI_UNUSABLE; AutoPlaceObject(hand item) (moves it to a pocket); loop again
         else canAttack = false
   while canAttack is neither TRUE nor FALSE
   if !canAttack: bAIMorale = min(bAIMorale, WORRIED); !fCivilian → canAttack = true, tryPunching = true
no gun anywhere (FindAIUsableObjClass(s, IC_GUN) == ITEM_NOT_FOUND) and canMove and !bNeutral:
   a = SearchForItems(s, SEARCH_WEAPONS, inv[HANDPOS]); != NONE → return a
```
(The civilian-loop hazard: a civilian with a weapon but no ammo. Inferred; reproduce only if the oracle shows it.)

### 6.3 Attack selection (`:2774-3054`), if `canAttack`

```
bAimShotLocation = AIM_SHOT_RANDOM
GUN: w = FindAIUsableObjClass(s, IC_GUN); if w != NO_SLOT:
   BestShot.bWeaponIn = w; w != HANDPOS → RearrangePocket(HANDPOS, w, TEMPORARILY) (swap)
   if hand item is IC_GUN and bGunStatus >= USABLE and AP >= MinAPsToAttack(s, sLastTarget, DONTADDTURNCOST):
      CalcBestShot(s, &BestShot) (§7.2)
      OUR team (PC under AI) and BestShot.ubChanceToReallyHit < 30 → not possible
      if possible:
         if BestShot.opponent.bLife < OKLIFE and (attitude != AGGRESSIVE or chance < 60):
            if ClosestReachableDisturbance(s, FALSE, &climb) != NOWHERE → return DecideActionRed(s, FALSE)
         NPCDoesAct(s)
   w != HANDPOS → swap back (TEMPORARILY)
TOSS: CheckIfTossPossible(s, &BestThrow) (§7.2)
   possible and the item is MORTAR: dir = GetDirectionFromGridNo(target, s); check = NewGridNo(grid, dir)
      !OKFallDirection(s, check, level, dir, anim) → not possible; behind = NewGridNo(grid, opposite(dir));
         OKFallDirection(s, behind, …, opposite(dir), anim) → usActionData = behind, GET_CLOSER
   still possible → NPCDoesAct(s)
KNIFE: w = FindAIUsableObjClass(s, IC_BLADE | IC_THROWING_KNIFE); if w != NO_SLOT:
   BestStab.bWeaponIn = w; swap in; if AP >= MinAPsToAttack(s, sLastTarget, DONTADDTURNCOST):
      throwing knife in hand: CalcBestShot(s, &BestStab); possible: opponent.bLife < OKLIFE → not possible;
                              NPCDoesAct(s) (even when just made impossible, quirk)
      else: CalcBestStab(s, &BestStab, TRUE); possible → NPCDoesAct
   swap back
CHOOSE: best = BestShot.possible ? (BestShot.value, FIRE_GUN) : (0, NONE)
   BestStab.possible and (value > best or best is NONE) → (BestStab.value, THROW_KNIFE if the stab weapon is a
      throwing knife else KNIFE_MOVE)
   BestThrow.possible and (value > best or NONE) → TOSS_PROJECTILE (value not stored; nothing compares after it)
PUNCH: action NONE and tryPunching: w = FindObjWithin(s, NOTHING, HANDPOS, SMALLPOCK8POS) (an empty hand/pocket slot)
   if w != NO_SLOT: BestStab.bWeaponIn = w; swap in; AP >= MinAPsToAttack(s, sLastTarget, DONTADDTURNCOST) →
      CalcBestStab(s, &BestStab, FALSE); possible → NPCDoesAct, KNIFE_MOVE; swap back
BestAttack = the struct of the chosen action (FIRE_GUN → BestShot, TOSS → BestThrow, knife/punch → BestStab,
   none → zeroed)
```
`BestAttack.ubChanceToReallyHit = 0` is set before the block (`:2778`) and only matters when nothing was chosen.

### 6.4 Low-chance shot reconsidered (`:3057-3078`)

```
if AP == bInitialActionPoints and action == FIRE_GUN and bShock == 0 and bLife >= bLifeMax / 2
   and BestAttack.ubChanceToReallyHit < 30
   and PythSpacesAway(s, target) > Weapon[gun].usRange / 10        // beyond the gun's normal range in tiles
   and RangeChangeDesire(s) >= 4 (§4.5):
   if canMove and orders != STATIONARY and !gfHiddenInterrupt and not boxer:
      militia: PreRandom(20) > chance, others: PreRandom(40) > chance → allowCoverCheck = true
         and PreRandom(10) > chance → action = NONE ("screw the attack")
```
The draws happen only when every condition before them holds; militia and others draw from different ranges.

### 6.5 Cover check and attack-vs-cover (`:3087-3164`)

```
if (canMove and !SkipCoverCheck and !gfHiddenInterrupt and (action == NONE or bLastAttackHit)
    and (team != OUR or AI_RTP_OPTION_CAN_SEEK_COVER) and not boxer) or allowCoverCheck:
   bestCover = FindBestNearbyCover(s, bAIMorale, &percentBetter) (§8.2)
if action != NONE and bestCover != NOWHERE:
   offense = BestAttack.ubChanceToReallyHit; defense = percentBetter
   morale: FEARLESS offense += offense/2; CONFIDENT offense += offense/4; WORRIED defense += defense/4;
           HOPELESS defense += defense/2
   wisdom >= 80 → defense += 10; wisdom < 50 → defense −= 10
   SEEKENEMY → offense += 10; STATIONARY or ONGUARD → defense += 10
   attitude: DEFENSIVE def +20, BRAVESOLO def −10, BRAVEAID def −10, CUNNINGSOLO def +10, CUNNINGAID def +10,
             AGGRESSIVE off +20, ATTACKSLAYONLY off +30
   defense > offense → action = NONE
```
`bLastAttackHit` is cleared by `RefreshAI` at turn start and by every `ExecuteAction`, and set by the attack code
when the soldier's attack hits (attack doc). So in practice the cover search runs only when no attack was chosen
(or it was dropped by §6.4), unless the previous action of this turn was a hit and nothing executed since (inferred).

### 6.6 Executing the attack (`:3168-3372`)

```
if action != NONE:
   changeStanceFirst = false; bAimTime = BestAttack.ubAimTime; bDoBurst = 0
   FIRE_GUN:
      STANCE: if not tank and AP − (ubAPCost − ubAimTime) >= AP_CROUCH + GetAPsToReadyWeapon(s, anim):
         chance = endHeight != STAND ? 100 : 50 + attitude (DEFENSIVE +20, BRAVESOLO −10, BRAVEAID −10,
                  CUNNINGSOLO +10, CUNNINGAID +10, AGGRESSIVE −20, ATTACKSLAYONLY −30)
         if PreRandom(100) < chance or GetRangeInCellCoordsFromGridNoDiff(s, target) <= MIN_PRONE_RANGE (50):
            dir = GetDirectionToGridNoFromGridNo(s, target)
            stance = ShootingStanceChange(s, &BestAttack, dir) (§6.7)
            if stance != 0:
               bDirection != dir and InternalIsValidStance(s, dir, endHeight) → usActionData = dir, CHANGE_FACING
                  (the attack is dropped; it will be re-decided after the turn)
               changeStanceFirst = true
               cost = GetAPsToChangeStance(s, stance)
               if ubAPCost + cost > AP: ubAimTime −= (ubAimTime − cost)    // = cost: quirk, also in vanilla
               else ubAPCost += cost
      BURST: if IsGunBurstCapable(s, BestAttack.bWeaponIn) and BestShot.opponent.bLife >= OKLIFE and
             inv[weaponIn].ubGunShotsLeft > 1 and team != OUR:
         burstAPs = CalcAPsToBurst(CalcActionPoints(s), inv[weaponIn])
         reraise = changeStanceFirst and anim flags & (ANIM_FIREREADY | ANIM_FIRE) ? Weapon[gun].ubReadyTime : 0
                                                                                  // Strac addition (PR #2566)
         if AP − (ubAPCost − ubAimTime) − reraise >= burstAPs:
            chance = tank ? 100 : 25 / (ubAimTime + 1) + attitude (DEFENSIVE −5, BRAVESOLO +5, BRAVEAID +5,
                     CUNNING* 0, AGGRESSIVE +10, ATTACKSLAYONLY +30)
                     + if Pyth(s, target) < 10: (10 − dist) · (1 + SoldierDifficultyLevel)
                       and for ATTACKSLAYONLY also + 5 · (10 − dist)
            if PreRandom(100) < chance:
               ubAimTime = BURSTING (5)
               ubAPCost = ubAPCost − ubAimTime + CalcAPsToBurst(CalcActionPoints(s), inv[HANDPOS])
                          // subtracts 5 (the new value), quirk; ubAPCost is not read afterwards
               attitude != ATTACKSLAYONLY → CalcSpreadBurst(s, target, targetLevel) (§7.4)
      ubAimTime == BURSTING → bAimTime = 0, bDoBurst = 1
   THROW_KNIFE: weapon not in hand and endHeight == STAND → bAction = LOWER_GUN, usActionData = 0,
      bNextAction = THROW_KNIFE, usNextActionData = target, bNextTargetLevel = level
      (writing bAction inside the decider is overwritten by the return value below, so the LOWER_GUN never runs; only
       the queued THROW_KNIFE survives and repeats after the knife throw, quirk, inferred)
   weaponIn != HANDPOS → RearrangePocket(HANDPOS, weaponIn, FOREVER)
   changeStanceFirst → bNextAction = FIRE_GUN, usNextActionData = target, bNextTargetLevel = level,
                       usActionData = stance → CHANGE_STANCE
   else usActionData = target; bTargetLevel = level → action
```
`bAimTime`/`bDoBurst`/`bAimShotLocation` are the soldier's attack parameters read by `HandleItem` (attack doc).
`ubReadyTime` re-raise is a Strac deviation from vanilla (`V:DecideAction.c:3360` lacks it).

### 6.7 `ShootingStanceChange` and `StanceChange` (`TacticalAI/AIUtils.cc:120-311`)

```
ShootingStanceChange(s, attack, dir):
   minBonus = 20 − 3 · attack.ubAimTime                     // UINT32: aim > 6 wraps → never change
   left = AP − attack.ubAPCost − GetAPsToReadyWeapon(s, anim); left < AP_CROUCH → 0
   cur = {STAND 0, CROUCH 1, PRONE 2}[endHeight]; range = GetRangeInCellCoordsFromGridNoDiff(s, target)
   best = 0; bestState = anim; bestDiff = −1; curValue = 0
   for loop in 0..2:                                          // stand, crouch, prone
      diff = |loop − cur|; diff == 2 and left < AP_CROUCH + AP_PRONE → skip
      !InternalIsValidStance(s, dir, {STAND, CROUCH, PRONE}[loop]) → skip
      temporarily set usAnimState = STANDING / CROUCHING / PRONE
      v = SoldierToLocationChanceToGetThrough(s, target, s.bTargetLevel, s.bTargetCubeLevel, attack.opponent)
          · CalcChanceToHitGun(s, target, attack.ubAimTime, AIM_SHOT_TORSO, false) / 100     // attack doc
      if v > 0: CROUCHING: range > 16 + 10·(20/3) = 76 → +10; else range > 16 → +3·((range − 16) / 10)
                PRONE: range <= 50 → v = 0; else +3·((range − 16) / 10)
      diff == 0 → curValue = v;  v > best → best = v, bestState, bestDiff = diff
   restore usAnimState
   bestDiff == 0 or (best − curValue) / bestDiff < minBonus → 0 (UINT32 math: bestDiff −1 → huge → 0)
   else endHeight(bestState)
StanceChange(s, attackAPCost):           // §6.8 crouch step
   standing: AP − cost >= AP_CROUCH: (AP − cost >= 4 and IsValidStance(PRONE) and ConsiderProne(s)) → PRONE;
             elif IsValidStance(CROUCH) → CROUCH
   crouched: AP − cost >= AP_PRONE and IsValidStance(PRONE) and ConsiderProne(s) → PRONE
   → 0
ConsiderProne(s): bAIMorale >= NORMAL → false; ClosestKnownOpponent(s, &g, &lvl);
   GetRangeFromGridNoDiff(s, g) > 10 → true (Euclidean tiles, `(INT16)hypot`, `TileEngine/Isometric_Utils.cc:356-370`)
```
Note the `s.bTargetLevel`/`bTargetCubeLevel` read from the soldier (left over from the last attack), not from the
attack struct (quirk).

### 6.8 After no attack (`:3374-3639`)

```
tank → NONE
boxer: canMove and ClosestSeenOpponent → orders CLOSEPATROL temporarily, GoAsFar(GET_CLOSER), restore STATIONARY;
       found → truncate to 1 step (sGridNo + DirectionInc(ubPathingData[0])), sFinalDestination, bNextAction = END_TURN,
       GET_CLOSER; else NONE
bestCover != NOWHERE → usActionData = bestCover → TAKE_COVER
canMove and (team != OUR or AI_RTP_OPTION_CAN_RETREAT) and (HOPELESS or !canAttack):
   FindSpotMaxDistFromOpponents → RUN_AWAY
SPOTTERS: ubSpottersCalledForBy != NOBODY and AP >= 5 and bOppCnt > 1 and !fCivilian and men > 1 and !inDeepWater:
   chance = 25 · WhatIKnowThatPublicDont(s, TRUE); chance != 0 and PreRandom(100) < chance → RED_ALERT
CROUCH: if RT or GetAPsToChangeStance(s, CROUCH) <= AP:           // note: crouch cost tested even for a prone result
   if !fCivilian and !gfHiddenInterrupt and IsValidStance(CROUCH):
      st = StanceChange(s, BestAttack.ubAPCost) (§6.7); if st != 0:
         st == PRONE and (RT or GetAPsToLook <= AP − GetAPsToChangeStance(st)) and (morale > HOPELESS or canMove):
            opp = ClosestSeenOpponent(s); if opp != NOWHERE and bDirection != dir(opp):
               InternalIsValidStance(s, dir, PRONE) → bNextAction = CHANGE_STANCE, usNextActionData = PRONE,
                  usActionData = dir → CHANGE_FACING
               elif InternalIsValidStance(s, dir, CROUCH) → CROUCH, bNextAction = END_TURN → CHANGE_STANCE
         bNextAction = END_TURN; usActionData = st → CHANGE_STANCE
FACE: (RT or look APs) and !gfHiddenInterrupt and (morale > HOPELESS or canMove):
   opp = ClosestSeenOpponent(s); opp != NOWHERE and bDirection != dir and InternalIsValidStance(dir, endHeight)
   → usActionData = dir, CHANGE_FACING
MILITIA RADIO (:3561-3625): MILITIA team and AP >= 5 and men > 1: chance as RED step 14 (gbDiff if not aware, else
   10 · WhatIKnow…), same orders/attitude table; morale multiplier only when NOT aware (here the test is plain
   `bAwareOfOpposition`, no panic-trigger clause); then chance /= 2; chance != 0 and !inDeepWater →
   PreRandom(100) < chance → RED_ALERT
usActionData = NOWHERE → NONE
```
`BestAttack.ubAPCost` in the crouch step is 0 when no attack was chosen (zeroed struct) or the dropped attack's cost.

### 6.9 RNG order of one BLACK decision (TB, ENEMY, armed with a gun only)

`CalcMorale` (none) → Tixa mask roll → `FindSpotMaxDistFromOpponents` (gassed/exhausted only) → `CalcBestShot` (§7.2) →
`CheckIfTossPossible` (§7.2) → knife evaluation → §6.4 `PreRandom(40)`/`(20)`, `PreRandom(10)` → `FindBestNearbyCover`
(§8.2) → §6.6 stance `PreRandom(100)` → `ShootingStanceChange` (none) → burst `PreRandom(100)` → `CalcSpreadBurst`
(§7.4) → fallbacks: `FindSpotMaxDistFromOpponents`, spotter `PreRandom(100)`, militia radio `PreRandom(100)` →
execution: `Random(50)` civ quote, then the attack's own draws (attack doc).


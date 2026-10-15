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


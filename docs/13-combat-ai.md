# 13 — Combat AI

**Scope.** The AI above GREEN: YELLOW, RED and BLACK decisions, their attack, cover and flight searches, the combat
actions and their completion, the civilian, militia and creature variants. The turn-based loop (team turns, AI list,
`TurnBasedHandleNPCAI`) is `10` §6; the real-time scheduler, `DecideAlertStatus` and the green decision are `09`.

**Conventions.** As in `09`: paths relative to `reference/stracciatella/src/game/`; `V:` = vanilla `Build/`;
"(inferred)" = not traced end to end; `Random` = the `main` stream (`t.rng`), `PreRandom` = the `pre` stream (`t.pre`);
TB = turn-based (`gfTurnBasedAI = INCOMBAT`), RT = real time, Strac = Stracciatella. Every `(INT16)PreRandom(100) <
iChance` test draws even when `iChance <= 0` unless an earlier condition short-circuits it (each case is stated).
Strac's AI policies (`avoid_light_tiles_at_night`, `stay_on_rooftop`, `ai_go_prone_more_often`,
`ai_better_aiming_choice`, the corpse warning) are not configurable in ja2-node: all run as their default (off).
`SpacesAway` = Chebyshev tiles, `PythSpacesAway` = rounded Euclidean tiles (`07`); `MaxDistanceVisible() = 26`
(`Tactical/OppList.cc:875`).

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

**Stance validity.** `InternalIsValidStance(s, dir, stance)` (`Tactical/Soldier_Control.cc:7606-7697`): vehicles and
`ROBOTNOWEAPON` only stand; in water no crouch/prone; EPCs never prone; collapsed with `bBreath < OKBREATH` → no stand
or crouch; then the stance's animation structure (`STANDING`/`CROUCHING`/`PRONE` surface for the body) must fit at
`sGridNo, bLevel` facing `dir` (`OkayToAddStructureToWorld`; prone = 2-tile footprint). `IsValidStance(s, st)` uses
`bDirection`. ja2-node: `person-structure.ts` `internalIsValidStance`, `isValidStance` (soldiers carry person
structures).

**Dependencies.** Attacks (chance to hit, AP costs, bursts, throws, stabs): `11` §1–§2, §4; items (inventory slots,
ammo, item classes): `12`; §7.6 lists the AI's queries and their ja2-node modules. Turn-based core (team turns, AP
refresh, interrupts, `ubAttackBusyCount`, `DeductPoints`): `10`, `10` §5.

---

## 1. The turn-based driver

### 1.1 `HandleSoldierAI` in TB (`TacticalAI/AIMain.cc:86-519`)

Gate order: `10` §6.2 (RT: `09` §1.2). Combat-relevant details:
- A TB sleeper wakes when `bVisible != 0`; −1 counts as true, so nearly every sleeper does (`:216-235`).
- SERGEANT/MIKE/JOE in combat with a talk panel or a non-empty dialogue queue → return (`:281-284`).
- **New situation** (`:288-357`): with `ubAttackBusyCount > 0`, processed only for FIRE_GUN with no bullet in flight
  (`guiNumBullets == 0`) or TOSS_PROJECTILE with no physics object in flight (`guiNumObjectSlots == 0`; this one also
  zeroes the busy count). Processing: `CancelAIAction`; `bNextAction = NONE`; `DecideAlertStatus`.
- Continue branch (`:408-511`): MOVE_TO_CLIMB with an exhausted path at its destination → queued CLIMB_ROOF if
  affordable (`:464-480`: `bAction = CLIMB_ROOF; if IsActionAffordable: bAction = NONE, bNextAction = CLIMB_ROOF`),
  then `ActionDone`.

`TurnBasedHandleNPCAI` runs only with `bAction == NONE`: an action in progress is never re-decided and ends only
through a completion hook (§1.4).

### 1.2 `TurnBasedHandleNPCAI` (`AIMain.cc:965-1222`)

Flow: `10` §6.5. A queued `bNextAction` is taken with `usNextActionData` and `bNextTargetLevel` (all three cleared,
data to 0). Unaffordable → `HaltMoveForSoldierOutOfPoints` (`Movement.cc:616-632`: unless `ANIM_SPECIALMOVE`,
`fNoAPToFinishMove = true`, `EndAIGuysTurn`), which **keeps** the action: at GREEN/YELLOW it resumes next turn through
the continue branch (`fNoAPToFinishMove` → `SoldierTriesToContinueAlongPath`); at RED/BLACK the new situation set by
`RefreshAI` cancels it first (§1.5). A kept non-movement action has no continue path and would hang until the deadlock
breaker; unreachable, since the deciders never pick an unaffordable one (inferred).

TB decisions happen one soldier at a time, in the overhead pass after the previous action's completion hook fired, so
the RNG order across soldiers is the AI list order (§10.3).

### 1.3 `IsActionAffordable` (`TacticalAI/AIUtils.cc:438-549`)

`need > bActionPoints` → false. `need` by action:

| Action | Points needed |
|---|---|
| NONE, GIVE_AID, COWER, STOP_COWERING, LOWER_GUN, END_COWER_AND_MOVE, TRAVERSE_DOWN, OFFER_SURRENDER, WAIT, END_TURN, unlisted | 0 |
| CHANGE_FACING | `GetAPsToLook` = stand 1, crouch 2, prone `2 + 2·AP_PRONE` = 6 (`Tactical/Points.cc:1566-1585`) |
| all movement (RANDOM_PATROL … WALK, MOVE_TO_CLIMB, door actions) | `MinPtsToMove` = cheapest `ActionPointCost` of the 8 neighbours in `usUIMovementMode`, 127 for tanks (`Points.cc:1217-1240`) |
| PICKUP_ITEM | `max(MinPtsToMove, 3)`; DROP_ITEM 3 |
| FIRE_GUN, TOSS_PROJECTILE, KNIFE_MOVE, THROW_KNIFE | `MinAPsToAttack(s, usActionData, ADDTURNCOST)` (`11` §1.5) |
| YELLOW_ALERT, RED_ALERT, CREATURE_CALL | `AP_RADIO` 5 |
| CHANGE_STANCE | `AP_CROUCH` 2 (whatever the target stance) |
| CLIMB_ROOF | 10 up, 6 down |
| PULL_TRIGGER / USE_DETONATOR | `AP_PULL_TRIGGER` / `AP_USE_REMOTE` |

RT: `CalcNewActionPoints` refreshes `bActionPoints` at every RT turn start and `DeductPoints` zeroes AP costs outside
combat (`Points.cc:488-498`), so RT checks pass except right after combat ends (inferred).

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

**Truncation (inferred from the call graph, not oracle-checked).** Strac's `LAST_MOVEMENT_ACTION = CHANGE_STANCE` puts
CHANGE_FACING and CHANGE_STANCE into the continue branch. Their path data is empty (`EVENT_StopMerc` cleared it): on
the next overhead pass after `ExecuteAction` the branch calls `ActionDone` (`AIMain.cc:482`), then, the animation being
stationary, `SoldierTriesToContinueAlongPath`, which finds `usActionData == NOWHERE` → `CancelAIAction`
(`Movement.cc:563-567`). Effects in TB:
1. The AI re-decides 1–2 passes later while the turn or stance animation still runs (`ActionDone` stops neither). A
   new CHANGE_FACING (e.g. RED step 17 LOOK, §5) makes `NPCDoesAct` cancel the turn in progress, and the new turn is
   charged again (`AP_LOOK_STANDING/CROUCHED/PRONE` = 1/2/2 by end height, in
   `EVENT_InternalSetSoldierDesiredDirection`, `Soldier_Control.cc:3859-3881`). A visible enemy turns one octant per ~200 ms frame, so repeated re-decisions can
   drain APs. Unseen soldiers animate with delay 0 in combat (`08` §2.7) and finish the turn at once (ja2-node without
   the fade: gaps "Unseen soldiers in combat").
2. The extra `CancelAIAction` resets `SkipCoverCheck = FALSE` and `bBypassToGreen = 0`: the skip set by
   CHANGE_FACING/CHANGE_STANCE (§1.6) never reaches the next decision, and every movement action ending through the
   continue branch clears the bypass (RT too, which `09` §1.2 calls "harmless").

Vanilla ends the range at MOVE_TO_CLIMB (`V:TacticalAI/AI.h:32`): turn and stance end in `FreeUpNPCFromTurning` /
`FreeUpNPCFromStanceChange`, and `SkipCoverCheck` stays set. ja2-node uses the Strac value (`ai/actions.ts`).
`IsActionAffordable` asks 6 APs for a prone turn (`GetAPsToLook`), but 2 are charged.

### 1.5 Turn start, turn end, AI list

`BeginTeamTurn`: `10` §2.1 (`CalcNewActionPoints` `10` §2.5; Strac's `BuildAIExposedTileMap` only with
`avoid_light_tiles_at_night`); `StartNPCAI`, `RefreshAI`, `ManChecksOnFriends`: `10` §6.4; `EndAIGuysTurn`: `10` §6.8;
AI list: `10` §6.3 (combat view §10.3). Combat-relevant:
- `RefreshAI(s)` (`AIMain.cc:1228-1266`): `bLastAttackHit = false`; YELLOW → `SkipCoverCheck = false`; TB RED/BLACK →
  `bNewSituation = IS` (a rethink at turn start that also zaps a queued `bNextAction` on the first visit, §1.1);
  GREEN/YELLOW → `bPathStored = false`, `ManChecksOnFriends(s)` (`:1937-1986`; friends within
  `DistanceVisible(s, IRRELEVANT, IRRELEVANT, friend)` with `SoldierToSoldierLineOfSightTest(s, friend, dist, TRUE)`);
  `bLastAction = NONE`. `StartNPCAI` then calls `DecideAlertStatus` again.
- `EndAIGuysTurn(s)` (`:522-574`) clears **`bBypassToGreen`**.

### 1.6 `ExecuteAction` for combat actions (`AIMain.cc:1305-1829`)

Entry: `SkipCoverCheck = FALSE; bLastAttackHit = FALSE`. Green actions as `09` §1.7. Then:
- **WAIT** in TB: `ActionDone` only (a RT leftover). **END_TURN**: `ActionDone`, TB `EndAIGuysTurn`, return false.
- **CHANGE_FACING**: `SkipCoverCheck = TRUE`, desired-direction event. **CHANGE_STANCE**: already at `usActionData`
  → `ActionDone`, false; else `SkipCoverCheck = TRUE`, `ChangeSoldierStance`.
- **Movement group** (`:1376-1560`) as `09` §1.7 plus: MOVE_TO_CLIMB with `usActionData == sGridNo` becomes CLIMB_ROOF
  and recurses if affordable (else returns false, the action stays); the **TB loop detector** (`:1410-1434`, TB and
  alert < BLACK): `sLastTwoLocations[0..1]` fill with the grid at each move start;
  `usActionData == last[1] && sGridNo == last[0]` → `ActionDone` + `EndAIGuysTurn` (the move still continues to
  `NewDest`: quirk, inferred harmless since the turn ended); else shift. Bloodcat growl `Random(2)` in combat
  (`:1436-1446`; cosmetic, not drawn: deviations "Cosmetic draws of creatures").
- **TOSS_PROJECTILE** → `LoadWeaponIfNeeded`; **KNIFE_MOVE** → `usUIMovementMode = DetermineMovementMode(KNIFE_MOVE)`;
  then, with FIRE_GUN/THROW_KNIFE: if `bVisible != -1`, not militia, merc body without profile: `Random(50) == 0` →
  `StartCivQuote` (`:1585-1603`, **main-stream draw on every visible attack**; not drawn in ja2-node, §13.4);
  `HandleItem(s, usActionData, bTargetLevel, inv[HANDPOS], FALSE)` (`11` §1.3); not OK → `CancelAIAction`,
  `EndAIGuysTurn`.
- **RED_ALERT** (`:1657-1671`): non-PC and (`!bAwareOfOpposition` or (panic triggers here and no chosen one)) →
  `HandleInitialRedAlert(team)`; falls into **YELLOW_ALERT** (`:1672-1681`): `DeductPoints(AP_RADIO, 0)`,
  `RadioSightings(s, EVERYBODY, team)` (`08` §2.5), `AIDecideRadioAnimation(s)`, return true.
- `AIDecideRadioAnimation` (`:1269-1302`): body not REGMALE/BIGMALE → `ActionDone` (STOCKYMALE and women have surfaces
  but never play it); CIV team except Kingpin's group → `ActionDone`; end height STAND → `AI_RADIO`, CROUCH →
  `AI_CR_RADIO`, PRONE → `ActionDone`. An inner `ActionDone` still returns true, leaving `bActionInProgress = TRUE`
  with `bAction = NONE` (harmless, as WAIT in `09`).
- **COWER**: cowering → `ActionDone`, false; else `usActionData = ANIM_CROUCH`, `SetSoldierCowerState(TRUE)`
  (`START_COWER`, `ubDesiredHeight = CROUCH`, `Soldier_Control.cc:8462-8495`). **STOP_COWERING** as `09`.
- **LOWER_GUN**: `ActionDone` ("for now"). **CLIMB_ROOF**: `BeginSoldierClimbUpRoof` / `…DownRoof` by `bLevel`.
- **OFFER_SURRENDER**: `StartCivQuote` (offer and answer: `24` §8.5). PICKUP/DROP/GIVE_AID/doors/panic: `12`, `24`,
  `35` §5.4, `25` §4.3.

### 1.7 Movement in TB: AP reserve, budget, continuing

- **`InternalGoAsFarAsPossibleTowards(s, des, reserve, action, flags)`** (`TacticalAI/Movement.cc:281-539`), TB
  additions to `09` §2.4: `reserve = -1` → 0 for creatures, else `MAX_AP_CARRIED` (5). Mode first; `FLAG_CAUTIOUS`
  turns RUNNING into WALKING (`:318-322`). TB step loop: step 0 adds `AP_START_RUN_COST` when running; each step adds
  `EstimateActionPointCost(s, t, dir, mode, i, ubPathDataSize)`; `apsLeft = bActionPoints − cost`; `apsLeft < reserve`
  → stop before `t`; else accept `t`, stop if `apsLeft == reserve`. RT never stops for APs. `FLAG_STOPSHORT` stops at
  `SpacesAway(des, t) <= 5`.
- **`gubNPCAPBudget` / `gubNPCDistLimit`**: reset to 0 at the end of every overhead pass (`Overhead.cc:1138-1139`)
  and by `FindBestPath` on exit (`PathAI.cc:1785, 1812`), so they never leak into a later search (`07` §3). Only the
  cover/flight/item searches set them (§8.1), limiting the flood to tiles reachable within the budget.
- **`SoldierTriesToContinueAlongPath`** (`Movement.cc:546-613`) and **out of points while walking**
  (`HaltGuyFromNewGridNoBecauseOfNoAPs` → `HaltMoveForSoldierOutOfPoints`, `Overhead.cc:866, 1143-1159`): `10` §6.7.
  The continue step runs even after its own `CancelAIAction`, reading the path `ActionDone`/`EVENT_StopMerc` just
  cleared (quirk, inferred harmless); a halted soldier keeps his action (§1.2).
- **`NewDest`** (`AIUtils.cc:356-435`), combat cases: TAKE_COVER by a merc body with attitude DEFENSIVE/CUNNINGSOLO/
  CUNNINGAID and `SoldierDifficultyLevel >= 2`: `m = MovementMode[TAKE_COVER][Urgency[alert][morale]]` (always
  RUNNING); if `m != SWATTING`: SWATTING if `EnoughPoints(s, RecalculatePathCost(s, SWATTING), 0, FALSE)` or
  (`bLastAction == TAKE_COVER && usUIMovementMode == SWATTING`), else `m`. Otherwise **ENEMY team at RED**:
  `PreRandom(5 − SoldierDifficultyLevel) == 0` and `MostImportantNoiseHeard` within `26 + 10` Pyth tiles → SWATTING;
  else `DetermineMovementMode(bAction)`. SWATTING on non-merc bodies → WALKING. Then
  `EVENT_InternalGetNewSoldierPath(…, force = fNoAPToFinishMove)`.

---

## 2. Knowledge and alert helpers

### 2.1 `MostImportantNoiseHeard(s) → {grid, value, climb, reachable}` (`TacticalAI/Knowledge.cc:26-300`)

Grid: `09` §4.2. ja2-node: `perception/knowledge.ts` (`noiseHeard` returns all four outputs, `mostImportantNoiseHeard`
the grid only).
- `value` = the best (largest, ≤ 0) candidate value; initial best `−10000`, strict `>` keeps the first of equal values.
- `reachable` (only when a grid was found, `:247-288`) starts true. The civ/profiled room test (`:251-263`) compares
  `GetRoom(usPatrolGrid[0])` with itself and never fires (dead code, also vanilla `V:Knowledge.c:243-254`). Then
  `GetInterveningClimbingLocation(s, grid, level)` (§2.4): climb needed, no climb point → `reachable = false`; climb
  needed and found → **the returned grid becomes the climb point**, `climb = true`.
- Callers passing no out-parameters get only the grid (no climb substitution).

### 2.2 `WhatIKnowThatPublicDont(s, inSightOnly)` (`Knowledge.cc:303-349`)

`UINT8` total (wraps at 256, never in practice). Non-creatures add `ubNoiseVolume − gubPublicNoiseVolume[team]` when
positive. Then every merc in `MercSlots` order, not `CONSIDERED_NEUTRAL(s, o)` and not on `s.bSide`: `inSightOnly` →
`+1` if personal is `SEEN_CURRENTLY` and public is not; else `+gubKnowledgeValue[public+4][personal+4]` (`08` §2.5).

### 2.3 Radio, `HandleInitialRedAlert`, `last_merc_to_radio`

- `RadioSightings(s, EVERYBODY, team)` (`08` §2.5) first sets `Team[s.bTeam].last_merc_to_radio = s`
  (`Tactical/OppList.cc:2479`), for every caller including the automatic radio after a sighting. Cleared when that
  soldier is removed as a target (`:2106`), by `DecayPublicOpplist` when the team knows nothing publicly (`:4527`), on
  sector init (`Overhead.cc:365, 5973`). ja2-node: `t.perception.lastMercToRadio[team]`, set by `radioSightings`,
  cleared by `removeManAsTarget`, by `decayPublicOpplist` (`08` §2.6) and with each new sector's perception.
- `HandleInitialRedAlert(team)` (`AIMain.cc:1899-1934`): ENEMY team with panic triggers → `MakeClosestEnemyChosenOne`
  (panic, §9.4); ENEMY team in Meduna (P3) → Queen and Joe to RED; then `Team[team].bAwareOfOpposition = TRUE`.
  Callers: the RED_ALERT action (§1.6), `RadioSightings` to MILITIA (`08` §2.5). Every non-CIV soldier of an aware team
  goes RED at his next `DecideAlertStatus` (`09` §2.2).

### 2.4 Climbing helpers (`TacticalAI/AIUtils.cc:1191-1391`)

- `FindClosestClimbPointAvailableToAI(s, start, desired, up)` (`:1191-1237`): roaming origin/range (`09` §2.4; a PC
  under AI: own grid / 99); policy `stay_on_rooftop` (default **off**) forbids ONGUARD/CLOSEPATROL/FARPATROL roof
  soldiers to climb down; `g = FindClosestClimbPoint(start, desired, up)` (`TileEngine/Buildings.cc:412-448`: in the
  building of `desired`, the climb spot pair with ground and roof tile both free, minimum Pyth from `start`, strict,
  start 1000); `PythSpacesAway(origin, g) + 1 > range` → NOWHERE, else `g`.
- `GetInterveningClimbingLocation(s, dest, destLevel, &climb)` (`:1258-1291`): same level and (ground, or same
  `gubBuildingInfo`) → no climb, NOWHERE; same level, different buildings → climb, closest climb-**down** point of the
  current building (`start = desired = s.sGridNo`); level 0 → 1 → climb-up point toward `dest`; 1 → 0 → climb-down point.
- `EstimatePathCostToLocation(s, dest, destLevel, addAfterClimbUp, &climb, &climbGrid)` (`:1293-1391`): no climb →
  `EstimatePlotPath(s, dest, NO_COPY, NO_PLOT, WALKING, 0)` (`07` §3.6); otherwise find the climb point as above; none
  → 0; else `PlotPath` to it (0 → unreachable, return 0), plus `AP_CLIMBROOF` (up) or `AP_CLIMBOFFROOF` (down), plus
  `(AP_MOVEMENT_FLAT + WALKCOST) = 2` × `PythSpacesAway(climbGrid, dest)` (going down between buildings: with
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
`MAX_WATCHED_LOC_POINTS 4`, `WATCHED_LOC_RADIUS 1`). Used by RED "watch" (§5) and interrupt points (`10` §5).
ja2-node: `t.turn.watched` (`perception/duel.ts`).
- `HandleSight` clears every `incrementedThisLook` of the looker (`:656-659`).
- `ManSeesMan`, hostile new opponent not `SEEN_THIS_TURN` → `IncrementWatchedLoc(s, opp.grid, opp.level)`
  (`:1790`); already seen this turn → `SetWatchedLocAsUsed` (reset = false) (`:1801`).
- `IncrementWatchedLoc` (`:4963-5000`): find a slot on the same level within `SpacesAway ≤ 1`; none → first free slot,
  else first slot with points ≤ 1 → `{grid, level, 1}` and `CommunicateWatchedLoc(…, 1)`; found, not yet incremented
  this look and < 4 → `++points`, communicate the new value; reset = false, incremented = true.
- `CommunicateWatchedLoc(watcher, grid, level, pts)` (`:4917-4960`): every other teammate valid for sightings with
  `bLife >= OKLIFE`: same search; new → free slot or a slot with points ≤ `pts`, set to `pts`; existing → `max`.
- `DecayWatchedLocs(team)` (`:5032-5060`, from `DecayPublicOpplist`, `08` §2.6): every slot of every id in the team's
  range (also ids nobody holds) whose 3×3 area (`GridSquare`, clipped at the map edge; `WhoIsThere2` on the slot's
  level) holds nobody of another team: reset set → clear it and halve points (0 → slot freed); else set reset.
- `GetHighestWatchedLocPoints(s)` = max points of used slots, 0 if none (`:4901-4914`).
  `GetHighestVisibleWatchedLoc(s)` (`:4873-4898`): first slot with strictly more points than the best so far that passes
  `SoldierTo3DLocationLineOfSightTest(s, grid, level, cubeLevel 3, DistanceVisible(s, IRRELEVANT, IRRELEVANT, grid,
  level), TRUE)`; −1 if none.

### 2.7 `CheckForChangingOrders` at RED/BLACK and difficulty

`AIMain.cc:1859-1883` (GREEN case: `09` §2.2): ONGUARD → CLOSEPATROL, CLOSEPATROL → FARPATROL (`bOrders++`); else
MILITIA → SEEKENEMY; else creatures not STATIONARY/ONCALL → SEEKENEMY; WARDEN → `MakeClosestEnemyChosenOne` (panic,
§9.4). `DecideAlertStatus` calls it on the first RED/BLACK entry and on every BLACK evaluation (`bOppCnt > 0`), so a
soldier seeing enemies is re-escalated at each status check: ONGUARD reaches FARPATROL after two. `gbDiff`
(`AIMain.cc:53-62`) and `SoldierDifficultyLevel`: §4.3.

---

## 3. `DecideActionYellow` (`TacticalAI/DecideAction.cc:1075-1445`)

`fCivilian = CIV team && (NON_CIV_GROUP || bNeutral || FATCIV <= body <= CRIPPLECIV)` (same as green).

```
 1. civilian: cowering → usActionData = ANIM_STAND, STOP_COWERING
              RT and profiled → a = DecideActionNamedNPC(s) (09 §5); a != NONE → return a
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
- Step 4 draws even when ATTACKSLAYONLY zeroed the chance; step 3 does not draw when the soldier already faces the
  noise or it is farther than 26 tiles.
- "Direction to X" in all deciders = `GetDirectionToGridNoFromGridNo(s.sGridNo, X)` =
  `atan8(tileX(s), tileY(s), tileX(X), tileY(X))` on `ConvertGridNoToXY` tile coordinates
  (`Tactical/Soldier_Control.cc:6334-6352`; the parameters are named "dest, src", but the AI passes its own grid first
  and gets the direction from itself to X). `GetDirectionFromGridNo(g, s)` is the same.
- Profiled civilians other than Eldin (Fatima, Pacos) skip step 7: turn, else 50 % green, else NONE (civilians: no
  crouch).
- RT radio: `bActionPoints >= 5` passes (§1.3), so troops radio in RT too.
- RT: no YELLOW action queues a WAIT (unlike green); after CHANGE_FACING, SEEK_NOISE, SEEK_FRIEND, YELLOW_ALERT or
  CHANGE_STANCE the soldier re-decides at the first visit after it ends. NONE → WAIT `REALTIME_AI_DELAY` /
  `REALTIME_CIV_AI_DELAY` in `RTHandleAI` (`09` §1.3).
- Bypass: `DecideAction` clears `bBypassToGreen` (RT only) when it enters through the bypass branch, and any
  `CancelAIAction` clears it (a new situation; the continue-branch cancel after a move, turn or stance change, §1.4).
  So in RT the decision after a step-8 bypass is green again (+15) only if that green decision was NONE (a WAIT ends
  through `ActionDone`, not `CancelAIAction`); after a green move or turn YELLOW resumes (inferred). In TB it also lasts
  until `EndAIGuysTurn`.
- YELLOW movement mode: `Urgency[YELLOW] = {HIGH, MED, MED, LOW, LOW}` by `bAIMorale`, which only `CalcMorale` (§4.1)
  updates (RED/BLACK, step 7d). It starts at the placement value: 0 = HOPELESS for basic placements (zero-initialised
  create struct, `Soldier_Create.cc:823`; inferred for map placements, check the detailed-placement value). A soldier
  who never computed morale thus has urgency HIGH: SEEK_NOISE and SEEK_FRIEND **run** (`MovementMode` rows
  `{WALKING, SWATTING, RUNNING}` and `{WALKING, RUNNING, RUNNING}`).

### 3.1 RNG order of one YELLOW decision

1. `DecideAlertStatus` (RT `RefreshAI`): `Random(1000)` only when it calls `SetNewSituation` (RT only).
2. Named NPC (RT civilians with profile).
3. `MostImportantNoiseHeard`: none (LOS tests and path costs).
4. Turn: `PreRandom(100)` if the guard passed.
5. Radio: `PreRandom(100)` if the guard and `chance != 0 && !deep water` passed.
6. Seek noise: `PreRandom(100)` if reachable; on success `GoAsFar` (main-stream shuffle only if the noise tile is not a
   legal destination, `09` §2.4; the kids' `Random(10)` is GREEN only).
7. Friend: `PreRandom(100)` if one was found; on success `GoAsFar` as above.
8. Cover (TB): `PreRandom(100)`; on success `CalcMorale`, `FindBestNearbyCover` (no draws, §4.1, §8.2).
9. Bypass: `PreRandom(100)`; on success the green sequence of `09` §2.5 with `bBypassToGreen = 15`.
10. RT NONE → the WAIT draw. A move's `NewDest` swat roll is ENEMY at RED only (§1.7): none at YELLOW.

---

## 4. Morale, threat, difficulty, closest opponents (`TacticalAI/AIUtils.cc`)

**Knowledge choice** (used by every helper below): personal value `pers = s.bOppList[o]`, public `publ =
gbPublicOpplist[team][o]`; if `gubKnowledgeValue[publ+4][pers+4] > 0 || pers == publ` use the personal last-known grid
and level (`gsLastKnownOppLoc`, `gbLastKnownOppLevel`), else the public ones. `ThreatPercent[value+4]`
(`AIMain.cc:872`): `−4..5 → 20, 40, 60, 80, 25 (0), 100, 90, 75, 60, 45`.

### 4.1 `CalcMorale(s)` (`:1606-1826`, same as vanilla)

```
ENEMY team and FindAIUsableObjClass(s, IC_WEAPON) == NO_SLOT → HOPELESS
their = 0 (INT32); our = 0 (INT32)
for opp in MercSlots: skip opp.bLife < OKLIFE; CONSIDERED_NEUTRAL(s, opp) or same side; Carmen rule
   if pers == 0 and publ == 0: skip unless gbSeenOpponents[s][opp] (then value 0 → 25 %)
   else value = knowledge choice (pers or publ)
   oppT = i16(idiv(ThreatPercent[value+4] · CalcManThreatValue(opp, s.grid, FALSE, s), 100)); their += oppT
   for f in MercSlots (s itself included): skip f.bLife < OKLIFE;
      skip f.bNeutral unless (s.ubCivilianGroup != NON_CIV_GROUP and s.ubCivilianGroup == f.ubCivilianGroup);
      skip f.bSide != s.bSide
      pct = ThreatPercent[f.bOppList[opp] + 4]                  // a friend who knows nothing still gives 25
      if f.bOppList[opp] <= HEARD_LAST_TURN (−2): pct −= 2 · PythSpacesAway(s.grid, f.grid); pct <= 0 → skip
      frT = i16(idiv(pct · CalcManThreatValue(f, opp.sGridNo /*real*/, FALSE, s), 100))
      our += oppT · frT
m = their == 0 ? 500 : i16(idiv(100 · idiv(our, their), their))     // double division is original
cat = m <= 25 HOPELESS, <= 50 WORRIED, <= 150 NORMAL, <= 300 CONFIDENT, else FEARLESS
attitude: DEFENSIVE −1, BRAVESOLO/BRAVEAID +2, AGGRESSIVE +1 (CUNNING*, ATTACKSLAYONLY 0); ADMINISTRATOR class +2
breath > 75 → +1, else (< 40 → −1; < 10 → −1 more); life > 75 → +1, else (< 40 → −1; < 20 → −1 more)
!bUnderFire → +1; clamp 0..4; BRAVE* at HOPELESS → WORRIED
```
No RNG. Only the deciders write `bAIMorale` (§3 step 7d, RED step 12, BLACK prelude and its overrides).

### 4.2 `CalcManThreatValue(enemy, myGrid, reduceForCover, me)` (`:1828-1937`)

```
!enemy.bActive or !enemy.bInSector or enemy.bLife == 0 → −999; boxing and enemy not a boxer → −999
me is a creature/bloodcat: t = idiv((life + bleeding) · 10, 10 + Pyth(myGrid, enemy))
else: t = bExpLevel + CalcActionPoints(enemy) + idiv(bActionPoints, 2) + idiv(bLife, 10)
      if enemy.bAssignment < ON_DUTY (20; AI soldiers 0, inferred):
         t += idiv(ArmourPercent(enemy), 4) + idiv(bMarksmanship, 5) + (weapon in hand ? Weapon.ubDeadliness : 0)
      t −= idiv(bBleeding, 5) + idiv(100 − bBreath, 10) + bShock
if myGrid != NOWHERE: enemy.sLastTarget == myGrid → t += t/10; elif enemy.bDirection == dir(enemy → myGrid) → t += t/20
if enemy.bLife >= OKLIFE: reduceForCover and myGrid != NOWHERE →
      t = idiv(t · SoldierToLocationChanceToGetThrough(enemy, myGrid, me.bLevel, 0, me), 100)
elif t > 0: t = idiv(t, 4 + (OKLIFE − enemy.bLife))
return max(t, 1)
```
Items: `ArmourPercent`, `ubDeadliness`. LOS: the cover call (`11` §3.6; it writes `enemy.CTGTTarget`).

### 4.3 Difficulty: `gbDiff` and `SoldierDifficultyLevel` (`AIMain.cc:53-62`, `AIUtils.cc:2068-2120`)

| `gbDiff` row | 0 | 1 | 2 | 3 | 4 | used by |
|---|---|---|---|---|---|---|
| `DIFF_RADIO_RED_ALERT` | 50 | 65 | 80 | 90 | 95 | YELLOW/RED/militia radio |
| `DIFF_MAX_COVER_RANGE` | 4 | 6 | 8 | 10 | 13 | `FindBestNearbyCover`, `SearchForItems` |
| `DIFF_ENEMY_TO_HIT_MOD` | −10 | −5 | 0 | 5 | 10 | CTH (`11` §2) |

```
SoldierDifficultyLevel(s): base = 1 + idiv(CalcDifficultyModifier(class), 34)       // 0..33 → 1, 34..67 → 2, 68+ → 3
   ADMINISTRATOR base − 1; ARMY base; ELITE base + 1; GREEN/REG/ELITE militia 2/3/4
   other: creature team base + bLevel/4, else base + bLevel/4 − 1 (bLevel is 0/1, so base / base − 1); clamp 0..4
```
`CalcDifficultyModifier` (`Tactical/Soldier_Create.cc:1035-1111`): the strategic 0..100 value (`17` §11); its class
argument matters only for militia, fixed here. ja2-node: `combat/chance.ts` `soldierDifficultyLevel` reads
`t.campaign.difficultyModifier`, computed once at sector load for ARMY (deviations "Difficulty and progress in
tactical"); the sandbox fixes it at 30 → base 1: admins 0, troops 1, elites 2.

### 4.4 Closest opponents and disturbances

- **`ClosestKnownOpponent(s, &g, &lvl)`** (`:964-1061`): opponents (not neutral, other side, Carmen rule) known
  personally or publicly, unconscious allowed; location by knowledge choice; skip NOWHERE (Strac only), own grid, and
  `lvl != s.bLevel` in the same building; minimum `GetRangeInCellCoordsFromGridNoDiff` (strict, start 1500); outputs
  default NOWHERE / −1. ja2-node (`perception/knowledge.ts`) returns the grid only; gaps: §13.4.
- **`ClosestSeenOpponent(s, &g, &lvl)`** (`:1063-1136`): same with `pers == SEEN_CURRENTLY` and the real grid/level.
- **`ClosestReachableDisturbance(s, unconsciousOK, &climb)`** (`:776-961`); `unconsciousOK` is **unused**:
  ```
  climb = false; best = NOWHERE; closest = NOWHERE; dmin = 1000
  for opp in MercSlots (not neutral, other side; no Carmen rule):
     pers == 0 and publ == 0 → skip
     pers == SEEN_CURRENTLY and opp.bLife >= OKLIFE → return NOWHERE        // never approach a visible healthy enemy
     g = knowledge choice; skip g == s.grid or g == NOWHERE
     Pyth(s, g) < dmin → closest = g, level, dmin
  closest != NOWHERE: cost = EstimatePathCostToLocation(s, closest, level, FALSE, &c, &cg) (§2.4); cost != 0 →
     best = c ? cg : closest; bestClimb = c
  personal noise: sNoiseGridno != NOWHERE and != best:
     == s.grid → sNoiseGridno = NOWHERE, ubNoiseVolume = 0 (forget)
     else cost …; reachable → best = noise (or climb point)    // overwrites, no comparison
  public noise: gsPublicNoiseGridno[team] != NOWHERE and != best:
     different level or Pyth >= 6 or !SoldierTo3DLocationLineOfSightTest(s, g, lvl, 0, 26, FALSE):
        cost …; reachable → best = it (overwrites)
     else gsPublicNoiseGridno[team] −= 2                          // shifts the GRID two tiles west (quirk)
  climb = bestClimb; return best
  ```
  Priority: public noise > personal noise > closest known opponent, whenever reachable. No RNG.

### 4.5 `RangeChangeDesire(s)` (`:2176-2196`)

`bAIMorale − 1` + attitude (DEFENSIVE −1, BRAVE* +2, CUNNING* 0, AGGRESSIVE/ATTACKSLAYONLY +1) +
`gTacticalStatus.bConsNumTurnsWeHaventSeenButEnemyDoes` when positive (team-turn bookkeeping, `Overhead.cc:4290-4312`).

---

## 5. `DecideActionRed(s, unconsciousOK)` (`DecideAction.cc:1448-2454`)

`fCivilian` differs from green/yellow/black: `CIV team && (NON_CIV_GROUP || (bNeutral && fCivGroupHostile[group] ==
CIV_GROUP_NEUTRAL) || FATCIV <= body <= CRIPPLECIV)` (`:1462-1468`). `DecideAction` calls it with `unconsciousOK =
TRUE`, BLACK with FALSE (§6.3).

```
 1. AP == 0 → usActionData = NOWHERE, NONE
    canMove = AP >= MinPtsToMove(s)
 2. PANIC (:1481-1500): (not CIV team or WARDEN) and (bAwareOfOpposition or s is the chosen one or WARDEN) and panic
    bombs/triggers here → PanicAI(s, canMove) (§9.4); result != -1 → return it
 3. QUEEN/JOE in Meduna, canMove, not the alternate position → HeadForTheStairCase (§9.3); != NONE → return it
 4. inWater = Water, inDeepWater = DeepWater, inGas = InGasOrSmoke(s, grid)        // gas: doc 12
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
       CheckIfTossPossible(s, &bestThrow) (§7.3)
       possible: mortar needs room (the §6.3 mortar rule; may return GET_CLOSER one tile back); bring the item to hand
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
    inv[HANDPOS]) (§8.6); != NONE → return a
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
- RT RED (after combat, or after a team radio made the team aware): no long-range toss, no hiding (`hide = −99`),
  breath/crouch branches skip their AP checks; SEEK_OPPONENT/SEEK_FRIEND/RUN_AWAY queue no WAIT; NONE → WAIT
  `REALTIME_AI_DELAY`. The step-20 bypass needs `ClosestReachableDisturbance == NOWHERE` (nothing known or reachable).
- RT `bNextAction = END_TURN`: `RTHandleAI` makes it the action; `ExecuteAction(END_TURN)` only does `ActionDone` (no
  turn to end) and returns false.
- Step 15 terminates: each iteration sets at least the best of the four to −99.
- ja2-node: steps 2 (panic) and 5 (Tixa mask) not ported (gaps "Combat AI specials"); step 9 omitted
  (unreachable).

### 5.1 RNG order of one RED decision (TB, ENEMY, no panic, not Tixa)

`DecideAlertStatus` (no draw in TB) → steps 6/8 searches (no draws, §8) → step 10 `CheckIfTossPossible` (§7.3, §7.7) →
step 13 `FindSpotMaxDistFromOpponents` (if HOPELESS) → step 14 `PreRandom(100)` (if `chance != 0`) → step 15 in loop
order: seek (`GoAsFar` shuffle if the target tile is illegal), watch (`PreRandom(2)` only on the prone branch), help
(`GoAsFar`), hide (`FindBestNearbyCover`) → step 16 `FindSpotMaxDistFromOpponents`, `PreRandom(2)` → step 17
`PreRandom(100)` → step 19 `SearchForItems` → step 20 green sequence → step 21 `PreRandom(4)` → execution: `NewDest`
swat roll `PreRandom(5 − diff)` (ENEMY at RED, every move start, §1.7), `Random(50)` civ quote on attacks.

---

## 6. `DecideActionBlack(s)` (`DecideAction.cc:2457-3639`)

`fCivilian` as green/yellow (`bNeutral` alone). `BestShot/BestThrow/BestStab/BestAttack` are `ATTACKTYPE`
(`AIInternals.h:105-116`: `opponent, ubPossible, ubAimTime, ubChanceToReallyHit, iAttackValue, sTarget,
bTargetLevel, ubAPCost, bWeaponIn`). Only `ubPossible` is reset before use (`:2774-2778`); other fields hold garbage
until a `CalcBest*` fills them (each calls `InitAttackType`, §7).

### 6.1 Prelude (`:2487-2654`)

```
 1. AP == 0 → usActionData = NOWHERE, NONE; canMove = AP >= MinPtsToMove(s)
 2. PANIC: (ENEMY team or WARDEN) and panic triggers here and no chosen one: closest panic trigger, not (an alarm
    while the team is aware), within Pyth < 10 → PossiblyMakeThisEnemyChosenOne(s); s is the chosen one →
    PanicAI(s, canMove); != -1 → return it                                                     // §9.4
 3. QUEEN in Meduna → HeadForTheStairCase (§9.3)
 4. boxer: PRE_BOXING → DecideActionBoxerEnteringRing (`25` §3); BOXING → inDeepWater = inGas = false, bAIMorale =
    CalcMorale; other state → NONE
    else: inDeepWater = WaterTooDeepForAttacks(grid); inGas = InGasOrSmoke; bAIMorale = CalcMorale(s) (§4.1)
          TIXA only, !inGas: PreRandom(10) == 0 and WearGasMaskIfAvailable → inGas = false
          if inGas or bBreath < 5: canMove → d = FindSpotMaxDistFromOpponents(s); != NOWHERE → RUN_AWAY
                                   bAIMorale = HOPELESS
 5. (inDeepWater or inGas) and canMove: FindNearestUngassedLand → LEAVE_WATER_GAS; else FindSpotMaxDistFromOpponents
    → RUN_AWAY; else bAIMorale = HOPELESS
 6. SURRENDER (:2641-2654): ENEMY team, bVisible == TRUE (1), not yet offered, bLife >= bLifeMax / 2, no active MILITIA
    team, NumPCsInSector() < 4, Team[ENEMY].bMenInSector >= 3 · NumPCsInSector(), quest HELD_IN_ALMA not started (or
    done and INTERROGATION not started) → ENEMY_OFFERED_SURRENDER flag, OFFER_SURRENDER (the offer: `24` §8.5)
```
ja2-node: step 2 (panic) and the Tixa mask draw are not ported (gaps "Combat AI specials"); step 6 is
`offersSurrender` with `t.turn.enemyOfferedSurrender`.

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
            any other case leaves the negative code in canAttack, which is neither TRUE nor FALSE, so the do-while
            repeats with the same result forever (inferred; ja2-node: "cannot attack", deviations "Armed civilian
            without ammo")
         elif NOSHOOT_NOAMMO and canMove and !bNeutral:
            a = SearchForItems(s, SEARCH_AMMO, inv[HANDPOS]) (§8.6); a != NONE → return a
            else: inv[HANDPOS].fFlags |= OBJECT_AI_UNUSABLE; AutoPlaceObject(hand item) (moves it to a pocket); loop again
         else canAttack = false
   while canAttack is neither TRUE nor FALSE
   if !canAttack: bAIMorale = min(bAIMorale, WORRIED); !fCivilian → canAttack = true, tryPunching = true
no gun anywhere (FindAIUsableObjClass(s, IC_GUN) == ITEM_NOT_FOUND) and canMove and !bNeutral:
   a = SearchForItems(s, SEARCH_WEAPONS, inv[HANDPOS]); != NONE → return a
```
The civilian loop catches a hostile civilian whose weapon lacks ammo (NOAMMO after a failed reload) or a load, and a
COW/CRIPPLECIV body without a weapon. Neutral civilians never reach BLACK (`bOppCnt` counts only non-neutral
opponents, `08` §2.3).

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
TOSS: CheckIfTossPossible(s, &BestThrow) (§7.3)
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
`BestAttack.ubChanceToReallyHit = 0` is set before the block (`:2778`) and matters only when nothing was chosen.
ja2-node gaps: a throwing knife in the KNIFE branch is rated "not possible" (gaps "Combat AI specials"); the
TOSS branch skips the mortar room rule (only RED's long-range toss applies it, §13.4).

### 6.4 Low-chance shot reconsidered (`:3057-3078`)

```
if AP == bInitialActionPoints and action == FIRE_GUN and bShock == 0 and bLife >= bLifeMax / 2
   and BestAttack.ubChanceToReallyHit < 30
   and PythSpacesAway(s, target) > Weapon[gun].usRange / 10        // beyond the gun's normal range in tiles
   and RangeChangeDesire(s) >= 4 (§4.5):
   if canMove and orders != STATIONARY and !gfHiddenInterrupt and not boxer:
      if (militia ? PreRandom(20) : PreRandom(40)) > chance:          // exactly one draw, by team
         allowCoverCheck = true
         if PreRandom(10) > chance: action = NONE                    // "screw the attack"
```
The draws happen only when every condition before them holds.

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
`bLastAttackHit`: cleared by `RefreshAI` at turn start and at the start of every `ExecuteAction`, set on the attacker
when his attack hits (`EVENT_SoldierGotHit`, `Tactical/Soldier_Control.cc:2649`). So the cover search runs when no
attack was chosen (or §6.4 dropped or allowed it), and right after a hit: a soldier who just wounded someone weighs
"shoot again" against "move to better cover".

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
`bAimTime`/`bDoBurst`/`bAimShotLocation` are the soldier's attack parameters read by `HandleItem` (`11` §1.3). The
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
          · CalcChanceToHitGun(s, target, attack.ubAimTime, AIM_SHOT_TORSO, false) / 100     // 11 §2
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
`s.bTargetLevel`/`bTargetCubeLevel` are read from the soldier (left over from the last attack), not from the attack
struct (quirk).

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
`BestAttack.ubAPCost` in the crouch step is 0 when no attack was chosen (zeroed struct), the dropped attack's cost
otherwise, and uninitialised when the attack block was skipped (AP < 2, deep water, gas); use 0 there (inferred
unreachable in practice: those soldiers cannot crouch or already ran).

### 6.9 RNG order of one BLACK decision (TB, ENEMY, armed with a gun only)

1. `CalcMorale` (none); Tixa mask `PreRandom(10)` (Tixa only); `FindSpotMaxDistFromOpponents` (gassed/exhausted, none).
2. `CanNPCAttack` (none; a reload is a side effect); `CalcBestShot` (none, §7.2); `CheckIfTossPossible` (§7.7:
   `PreRandom(2)` for LAW owners, `PreRandom(3)` per heard target); knife evaluation (none; `PlotPath` only).
3. §6.4: `PreRandom(20)` or `PreRandom(40)`, then `PreRandom(10)`.
4. `FindBestNearbyCover` (none, §8.2).
5. §6.6: stance `PreRandom(100)`; `ShootingStanceChange` (none); burst `PreRandom(100)`; `CalcSpreadBurst` `Random(2)`.
6. Fallbacks: `FindSpotMaxDistFromOpponents` (none), spotter `PreRandom(100)`, militia radio `PreRandom(100)`.
7. Execution: `Random(50)` civ quote on a visible attack, then the attack's own draws (`11` §5).

---

## 7. Attack evaluation (`TacticalAI/Attacks.cc`)

Iteration is `MercSlots` order everywhere (stable vector; ties go to the earlier slot). `idiv` = C division
(truncates toward zero). Attack values are int32 products that can overflow ("about 1.8 billion", source comment):
compute with wrapping int32 multiplication left to right (`Math.imul`), then `idiv(·, 1000)`.
`CONSIDERED_NEUTRAL(me, them) = them.bNeutral && (me.bTeam != CREATURE_TEAM || them is a vehicle)`
(`Soldier_Control.h:273`).

### 7.1 `CanNPCAttack(s)` and `OKToAttack` (`Attacks.cc:1546-1597`, `AIUtils.cc:76-117`)

```
CanNPCAttack: CIV team and bNeutral → FALSE
   r = OKToAttack(s, NOWHERE): target == own grid → NOSHOOT_MYSELF; WaterTooDeepForAttacks → NOSHOOT_WATER;
       !WeaponInHand → NOSHOOT_NOWEAPON; IC_GUN: TANK_CANNON without a shell elsewhere → NOLOAD, ubGunShotsLeft == 0 →
       NOSHOOT_NOAMMO; IC_LAUNCHER without a launchable → NOLOAD; else TRUE
   NOAMMO → TryToReload: FindAmmo(calibre, magSize) and ReloadGun (charges AP_RELOAD_GUN in combat) → TRUE, else NOAMMO
   NOWEAPON → slot = FindAIUsableObjClass(IC_WEAPON); found: swap into HANDPOS (FOREVER); a one-handed gun in hand →
              a second one-handed gun from BIGPOCK1..SMALLPOCK8 goes to SECONDHANDPOS; recurse; none → NOWEAPON
   NOLOAD and the others → returned as is
```
**Reload is a side effect of `CanNPCAttack`** (the AI reloads during the BLACK decision, paying APs in TB), and an
unarmed soldier with a weapon in a pocket draws it here. Items (`12`): `FindAmmo`, `ReloadGun`, `FindAIUsableObjClass`
(first slot 0..18 with the class mask, not `OBJECT_AI_UNUSABLE`, `bStatus[0] >= 10`; with `IC_GUN` it skips
`EXPLOSIVE_GUN` items).

### 7.2 `CalcBestShot(s, &best)` (`Attacks.cc:91-292`)

Guns, throwing knives (rated with the **gun** formula) and creatures.
```
s.usAttackingWeapon = inv[HANDPOS].usItem                     // persistent side effect, read by CTH and cover code
InitAttackType(best)                                          // AIMain.cc:1887-1897; not bTargetLevel/bWeaponIn
for opp in MercSlots:
   skip: opp.bLife == 0; CONSIDERED_NEUTRAL(s, opp) or same side; s.bOppList[opp] != SEEN_CURRENTLY;
         ATTACKSLAYONLY and opp is not Slay
   minAP = MinAPsToAttack(s, opp.grid, ADDTURNCOST); skip if minAP > AP
   ctgt = AISoldierToSoldierChanceToGetThrough(s, opp); skip if 0          // LOS.cc:2979, fakes STANDING
   monsters: skip if their structure does not fit facing opp
   raw = MinAPsToShootOrStab(s, opp.grid, DONTADDTURNCOST); opp.grid != sLastTarget → raw = u8(raw − 1)
   tank: skip unless AP − minAP >= burstAPs; maxAim = 0. else maxAim = min(4, AP − minAP)
   bestRate = 0
   for aim in 0..maxAim:
      cth = u8(AICalcChanceToHitGun(s, opp.grid, aim, AIM_SHOT_TORSO))   // fakes STANDING; no RNG (fModify false)
      rate = idiv(AP · cth, raw + aim); rate > bestRate → bestRate, bestAim, bestCth         // ties keep lower aim
   skip if bestRate == 0
   ctrh = u8(idiv(bestCth · ctgt, 100)); skip if 0
   throwing knife: skip if ctrh < 30 or Pyth(s, opp) > idiv(CalcMaxTossRange(s, THROWING_KNIFE, FALSE), 2)
   threat = CalcManThreatValue(opp, s.grid, TRUE, s)                         // §4.2
   value = idiv(EstimateShotDamage(s, opp, bestCth) · bestRate · ctrh · threat, 1000)
   assassins (JIM..TYRONE) vs MILITIA: value /= 2
   SWITCH RULE (shared with CalcBestStab):
   if value > 0 or ctrh > best.ctrh:
      if best.ctrh > 0:
         pct = idiv(ctrh · 100, best.ctrh) − 100
         if pct < −50 and best.opponent.bLife >= OKLIFE: skip         // much worse shot at a healthy target
         if pct < 50 and value < best.value: skip                     // equal value goes to the NEW target
      best = {possible, opp, bestAim, ctrh, opp.grid, opp.bLevel, value, ubAPCost = minAP + bestAim}
```
The aim choice maximises "hits per AP" `AP·cth/(raw+aim)`, not the hit chance. `ai_better_aiming_choice` (default off)
would pass `bAimShotLocation`, which DecideActionBlack sets to RANDOM, equivalent to TORSO here: no effect. No RNG.

### 7.3 Throws: `CheckIfTossPossible` and `CalcBestThrow` (`Attacks.cc:1599-1654, 357-922`)

```
CheckIfTossPossible(s, &best):
   tank: weaponIn = FindObj(TANK_CANNON)
   else: weaponIn = FindAIUsableObjClass(IC_LAUNCHER)                // GL / mortar
         none: weaponIn = FindObj(ROCKET_LAUNCHER)
               none → FindThrowableGrenade(s)
               found and bAIMorale > WORRIED and PreRandom(2) != 0 → FindThrowableGrenade(s)  // may be NO_SLOT: LAW lost
   weaponIn != NO_SLOT: swap into hand; AP >= MinAPsToAttack(s, sLastTarget, DONTADDTURNCOST) → CalcBestThrow; swap back
FindThrowableGrenade (Items.cc:488): ambient light 12 (night) and bLife > bLifeMax/2 → first BREAK_LIGHT;
   else first IC_GRENADE that is not launchable
```
`CalcBestThrow` (`calcBestThrow` in `ai/attack-choice.ts`):
- Range: LAW/tank cannon `usRange/10`, else `CalcMaxTossRange(s, item, TRUE)`. Launchers need a launchable (else
  return before `InitAttackType`); safety margin = explosive's `max(blast r, stun r, smoke maxR, light r/2)` (LAW: C1
  blast radius 6).
- Friends: every living, non-`bNeutral`, same-side soldier **including `s`**.
- Targets: MORTAR/GL need `SEEN_CURRENTLY` personally or publicly (real grid); others: SEEN_CURRENTLY → real grid;
  SEEN_LAST_TURN → `CloseEnoughForGrenadeToss(real, lastKnown)` and last-known grid/level; HEARD_LAST_TURN →
  **`PreRandom(3)`, skip on 0**, then close-enough, then only a BREAK_LIGHT or when `bUnderFire`/`bShock`.
  `threat[k] = CalcManThreatValue(opp, s.grid, FALSE, s)`. ja2-node aims at the opponent's current level (gaps
  "AI throw targets").
- Pre-gate (not BREAK_LIGHT), fewer than 2 targets: difficulty 0–1 and `bLife > bLifeMax/2` → none; difficulty 2 and
  `bLife > idiv(bLifeMax, 4)·3` → none.
- Candidate tiles: the 3×3 around each target in order (`dy` outer, `dx` inner, raw `+dx+160·dy`, bounds only),
  within range, not already in gas of the same kind, not excluded, `MinAPsToAttack(s, g, ADDTURNCOST) <= AP`, no
  friend on that level within the margin. Score: for each target within Pyth ≤ 3: `e = EstimateThrowDamage`, scaled
  `(100 − 20·dist)%`, `total += threat·e`; live targets count `inRange`, `adj` (dist < 2). Easy difficulty skips tiles
  with no direct hit and fewer than 2 adjacent; others need `inRange > 0` (underground also the direct/adjacent test,
  `Attacks.cc:768`; missing in ja2-node, §13.4). Tiles with `adj >= 1` are excluded from re-evaluation (max 100).
- Cover: LAW/cannon `AISoldierToLocationChanceToGetThrough`; thrown/launched `CalculateLaunchItemChanceToGetThrough`
  (`34` §6) → 100, or a landing-distance penalty when it falls short on the same level. The original's landing
  test only succeeds when the arc ends in a structure or a body (quirk, kept).
- MORTAR or LAW with fewer than 2 targets in range and `bLife > bLifeMax/2` → skip.
- Aim is always the maximum `min(4, AP − minAP)`; `cth` by `AICalcChanceToHitGun` (LAW/cannon, +50 %, cap 100,
  not mortar) or `CalcThrownChanceToHit`; `value = idiv(rate · ctrh · total, 1000)`; strictly highest value wins.
- Final filter → none: difficulty 0–1 with `ctrh < 70`, difficulty 2 with `ctrh < 50`.
- Quirk: `usAttackingWeapon` is not set, so LAW/cannon CTH and cover use the gun set by `CalcBestShot`.

### 7.4 Stabs, punches, spread bursts

- **`CalcBestStab(s, &best, blade)`** (`Attacks.cc:928-1120`): `usAttackingWeapon = hand item`; temporarily
  `usUIMovementMode = RUNNING`. Targets: SEEN_CURRENTLY, same level, Carmen rule; `minAP = CalcTotalAPsToAttack(s,
  opp.grid, ADDTURNCOST, 0)` (walk-to-adjacent cost via `PlotPath` with budget = AP, cached in `sWalkToAttack*`); skip
  if `> AP` or 0. `raw = max(1, MinAPsToAttack(s, opp, DONTADDTURNCOST) − (new target ? 1 : 0))`; surprise = the target
  does not see `s` → `cth = MAXCHANCETOHIT` (policy, default 99); else `CalcChanceToStab`/`CalcChanceToPunch`.
  Same aim loop and switch rule as §7.2, cover ignored (`ctrh = cth`), threat without cover, value with
  `EstimateStabDamage`. (Vanilla subtracts 1 unconditionally, no floor.)
- **KNIFE_MOVE execution**: `HandleItem` walks to the target and stabs (`11` §4.1).
- **`CalcSpreadBurst(s, first, level)`** (`Attacks.cc:1786-1955`): up to 4 seen soldiers adjacent to the target in a
  fixed direction pattern (`CountAdjacentSpreadTargets`), recursing toward a better-packed neighbour; with more than
  one, **`Random(2)`** (main) may reverse the list and `AIPickBurstLocations` spreads `ubShotsPerBurst` shots over
  them (float32 step), `fDoSpread = TRUE`. No side or life check on the extra targets.
- `LoadWeaponIfNeeded` (`:47-85`) attaches a launchable to GL/mortar/cannon at TOSS execution.
- `CalcTentacleAttack` (queen) and `AdvanceToFiringRange` (creatures): §12.2.

### 7.5 AI damage estimates (`Attacks.cc:1266-1543`)

AI-only; they read item and armour data and draw no RNG.
```
EstimateShotDamage(s, opp, cth):
   ammo = throwing knife in s.ubAttackingHand ? AMMO_KNIFE : inv[ubAttackingHand].ubGunAmmoType
   rng = GetRangeInCellCoordsFromGridNoDiff(s, opp); w = Weapon[inv[HANDPOS]]          // base usRange, no extender
   dmg = idiv(w.ubImpact · (100 − idiv(50 · rng, w.usRange) + u8(idiv(cth, 4))), 100)  // may go negative
   head  = helmet ? idiv(prot(helmet) · status, 100) : 0
   torso = vest (not MONSTER/KNIFE ammo) ? idiv(prot · status, 100) : 0; + CERAMIC_PLATES attachment idiv(prot · status, 100)
   legs  = leggings (not MONSTER/KNIFE) ? idiv(prot · status, 100) : 0
   tp = idiv(15·head + 75·torso + 5·legs, 100); HP ammo tp·3/2, AP ammo tp·3/4, SUPER_AP tp/2 (idiv each)
   dmg −= tp; HP ammo: dmg = idiv(dmg · 17, 10)
   MONSTER spit: + idiv(gas damage · NumMercsCloseTo(opp.grid, gas maxRadius) · 3, 2)     // §12.2
   return max(dmg, 1)
EstimateThrowDamage(s, pocket, opp, g):
   smoke grenades → 5; BREAK_LIGHT → 5 · (LightTrueLevel(opp) − 3); X = explosive (LAW: C1)
   ex = blast ? idiv(blast.damage · 3, 2) : 0; br = stun ? idiv(stun.breath · 5, 4) : 0; gas adds the same
   gas with damage: terrain not FLAT_FLOOR → br /= 2; gas mask worn → br = idiv(br · (100 − mask status), 100)
   else ex: ex −= idiv(ex · ArmourVersusExplosivesPercent(opp), 100), min 1      // vanilla used the thrower's armour
   d = (opp end height STAND ? 15 : 0) + ex + idiv(br', 3) with br' = 0 if opp.bBreath < OKBREATH or robot
                                                                       // vanilla used the thrower's stance
   return idiv(d · inv[pocket].bStatus[0], 100)
EstimateStabDamage(s, opp, cth, blade):
   blade: imp = Weapon[usAttackingWeapon].ubImpact + idiv(EffectiveStrength, 20)
   punch: imp = (weapon and !MARTIALARTS ? ubImpact : 5) + idiv(EffectiveStrength, 5)
   imp += idiv(bExpLevel, 2); imp = idiv(imp · (100 + idiv(cth, 4)), 100)
   punch: ×(100 + 30·MARTIALARTS traits)/100, ×(100 + 15·HANDTOHAND traits)/100, then /4 (idiv each)
   return max(imp, 1)
```

### 7.6 Queries into attacks and items

Modules are under `src/sim/tactical/`.

| Query | Source | ja2-node | Used by |
|---|---|---|---|
| `MinAPsToAttack(s, grid, addTurn, afterMoving)` | `Tactical/Points.cc:964` | `combat/ap.ts` | affordability, attack pre-checks, seek reserves |
| `MinAPsToShootOrStab`, `MinAPsToThrow`, `CalcTotalAPsToAttack`, `CalcAPsToBurst`, `GetAPsToReadyWeapon` | `Points.cc:1081, 1692, 866, 843, 1612` | `combat/ap.ts`; `points.ts` (`apsToReadyWeapon`) | §6, §7 |
| `AICalcChanceToHitGun(s, grid, aim, pos)` (no RNG), `CalcChanceToHitGun`, `CalcThrownChanceToHit`, `CalcChanceToStab/Punch`, `CalcMaxTossRange` | `Weapons.cc:2551, 1979, 3585, 3489/3494, 3525` | `combat/chance.ts`, `explosions/throwing.ts`, `combat/melee.ts` | §6.7, §7 |
| `AISoldierToSoldierChanceToGetThrough`, `AISoldierToLocationChanceToGetThrough`, `SoldierToLocationChanceToGetThrough`, `CalculateLaunchItemChanceToGetThrough` | `LOS.cc:2979, 3010, 2954`; `Physics.cc:1613` | `combat/bullets.ts`, `explosions/trajectory.ts` | §4.2, §6.7, §7, §8 |
| armour protection and status, `ArmourPercent`, `ArmourVersusExplosivesPercent`, explosive data, `EffectiveStrength`, skill traits, `LightTrueLevel` | `Weapons.cc:123, 177`, items, `SkillCheck.cc:14`, `Lighting.cc:508` | `combat/armour.ts`, `explosions/blast-damage.ts`, `skills.ts`, `lighting/lighting.ts` | §4.2, §7.5 |
| `IsGunBurstCapable`, `Weapon[].usRange/ubReadyTime/ubShotsPerBurst/ubDeadliness/ubImpact`, `ubGunShotsLeft`, `bGunStatus` | items | `hand-item.ts`, item content | §6.6, §4.2 |
| `FindAIUsableObjClass`, `FindObj`, `FindObjWithin`, `FindThrowableGrenade`, `FindLaunchable`, `FindAmmo`, `ReloadGun`, `RearrangePocket` (= swap), `AutoPlaceObject`, `SearchForItems` | `Items.cc`, `AIUtils.cc:2013`, `FindLocations.cc` | `ai/utils.ts`, `ai/attack-choice.ts`, `inventory.ts`, `ai/item-search.ts` | §6.2, §6.3, §7 |
| `HandleItem(s, grid, level, item, FALSE)` (starts the attack), `bAimTime/bDoBurst/bAimShotLocation/fDoSpread/sSpreadLocations`, `bLastAttackHit` | `Handle_Items.cc` | `combat/attack.ts` (`handleItem`, through `turnHooks.aiAttack`) | §1.6, §6.6 |

### 7.7 RNG inside attack evaluation

`CheckIfTossPossible` `PreRandom(2)` (LAW owner with morale > WORRIED); `CalcBestThrow` `PreRandom(3)` per
HEARD_LAST_TURN target; `CalcSpreadBurst` `Random(2)`. Nothing else: CTH, cover and damage estimates draw nothing in
Strac (vanilla's barrel-extender `Random` draws inside `CalcChanceToHitGun` are gated by `fModify` in Strac). Strac's
`FindBestPath` skip list draws `Random(4)` per inserted node, reached here through `CalcTotalAPsToAttack` → `PlotPath`;
ja2-node has no such draws (deviations "Pathfinder RNG").

---

## 8. Cover, flight and locations (`TacticalAI/FindLocations.cc`)

### 8.1 Shared search pattern

- Square around `s.grid` with radius `R`: `maxLeft = min(R, g%160)`, `maxRight = min(R, 159 − g%160)`, `maxUp =
  min(R, g/160)`, `maxDown = min(R, 159 − g/160)`; scan `dy` outer from `−maxUp`, `dx` inner from `−maxLeft`; skip grids
  outside the world. Strict comparisons everywhere: the first tile in scan order wins ties.
- **Reachability flood**: clear `MAPELEMENT_REACHABLE` over the square; `gubNPCDistLimit = R` (square, `SpacesAway`);
  optionally `gubNPCAPBudget`; `FindBestPath(s, NOWHERE, s.bLevel, mode, COPYREACHABLE or COPYREACHABLE_AND_APS, 0)`
  (people block); clear REACHABLE on the own tile. `COPYREACHABLE_AND_APS` clamps the distance limit to
  `AI_PATHCOST_RADIUS` 9 and writes the cheapest AP cost per tile into `gubAIPathCosts[9+dx][9+dy]` while the budget
  is non-zero (costs exclude the start-movement cost, inferred); a budget of 0 means unlimited; a budget smaller than
  `MinAPsToStartMovement` floods nothing (`PathAI.cc:640-710`, `07` §3). Both globals are reset after the search.
- Strac's `avoid_light_tiles_at_night` (default off) would make the flood avoid exposed lit tiles; no other policy is
  read in this file.

### 8.2 `CalcCoverValue` and `FindBestNearbyCover(s, morale, &pctBetter)` (`:51-983`)

```
FindBestNearbyCover:
   night = surface sector and ambient >= NORMAL_LIGHTLEVEL_DAY + 2 (5); bgPct = night ? gbLightSighting[0][ambient] : 0
   R = gbDiff[MAX_COVER_RANGE][diff]; R = min(R, idiv(bWisdom, 8)); RT → R /= 2
   alert >= RED: R = min(R, max(0, AP − MinAPsToStartMovement(s, DetermineMovementMode(s, TAKE_COVER))))
   R <= 0 → NOWHERE (pctBetter untouched)
   maxThreatRange = 400 + 10·R; myThreat = CalcManThreatValue(s, NOWHERE, FALSE, s)
   THREATS (MercSlots): skip bLife < OKLIFE, neutral/same side, unknown, Carmen; loc/certainty by knowledge choice
      (certainty = ThreatPercent); range = GetRangeInCellCoordsFromGridNoDiff(s.grid, loc) > maxThreatRange → skip;
      v = CalcManThreatValue(opp, s.grid, FALSE, s); −999 → skip
      Threat[n++] = {opp, loc, v, certainty, origRange = range, aps = CalcActionPoints(opp)}
   n == 0 → NOWHERE
   cur = Σ_{i: origRange <= 400} CalcCoverValue(s, s.grid, myThreat, AP, i, origRange, &curScale)
   cur −= idiv(cur, 10) · NumberOfTeamMatesAdjacent(s, s.grid)          // sign-agnostic here (quirk)
   roam = RoamingRange(s, &origin); distFromOrigin = (alert != BLACK and roam < 160 and origin != NOWHERE) ?
      SpacesAway(origin, s.grid) : −1
   flood: budget = alert >= RED ? AP : CalcActionPoints(s); limit R (clamped to 9); mode TAKE_COVER;
          COPYREACHABLE_AND_APS
   best = cur; bestTile = NOWHERE
   for t in scan order:
      skip if distFromOrigin != −1 and SpacesAway(origin, t) > roam and distFromOrigin <= SpacesAway(origin, t)
      skip if !REACHABLE(t); skip InGas(s, t) (mask-aware); skip t == sBlackList
      left = AP − gubAIPathCosts[9+dx][9+dy]
      cv = Σ_{i: r = range(t, Threat[i].loc) <= 400} CalcCoverValue(s, t, myThreat, left, i, r, &cvScale)
      n = NumberOfTeamMatesAdjacent(s, t); cv >= 0 ? cv −= idiv(cv, 10)·n : cv += idiv(cv, 10)·n
      night and GetRoom(t) == NO_ROOM: d = u8(gbLightSighting[0][LightTrueLevel(t, level)] − bgPct)
                                       cv >= 0 ? cv −= idiv(cv, 100)·d : cv += idiv(cv, 100)·d
      cv > best → best, bestTile = t, bestScale = cvScale
   reset budget/limit
   bestTile != NOWHERE: pctBetter = CalcPercentBetter(cur, best, curScale, bestScale); pctBetter >= 5 → bestTile
   → NOWHERE
CalcPercentBetter(old, new, oldScale, newScale): change = new − old <= 0 → 0; sum = oldScale + newScale <= 0 → 0;
   idiv(change · 100, sum)                       (vanilla returns NOWHERE on both failures; unreachable, inferred)
NumberOfTeamMatesAdjacent(s, g): neighbours t != g in 8 directions with WhoIsThere2(t, s.bLevel) of the same TEAM,
   not s (vanilla looked at the centre tile, so it was always 0: Strac applies a penalty vanilla never did)
```

```
CalcCoverValue(me, myGrid, myThreat, myAps, i, range, &totalScale):   // `morale` argument unused
   T = Threat[i]; temporarily place me at myGrid and T.opp at T.loc (grid and centre XY)
   hisActual = InWaterOrGas(him, T.loc) ? 0 : CalcWorstCTGTForPosition(him, me, myGrid, me.bLevel, myAps)
   hisCTGT = hisActual
   if hisActual < 100: hisBest = CalcBestCTGT(him, me, myGrid, me.bLevel, myAps)
                       hisBest > hisActual → hisCTGT = idiv(2·hisBest + hisActual, 3)
   myCTGT = InWaterGasOrSmoke(me, myGrid) ? 0 : CalcAverageCTGTForPosition(me, him, T.loc, him.bLevel, myAps)
            (him back at T.loc first); myCTGT < 5 (SEE_THRU_COVER_THRESHOLD) → 0
   restore both
   hisPos = hisCTGT · T.value · T.aps; myPos = myCTGT · myThreat · myAps        // myAps may be negative below RED
   him.bOppCnt > 1 → hisPos /= him.bOppCnt; me.bOppCnt > 1 → myPos /= me.bOppCnt
   myPos > 0 and myAps < 2 → myPos −= idiv(myPos · (20 + idiv(range, 10)), 100)  // cannot crouch
   mult = RangeChangeDesire(me); rc = T.origRange − range
   if mult != 0 and rc != 0: rf = idiv(rc · mult, 2)
      myPos += idiv(100 · rf · (5 − SoldierDifficultyLevel(me)), 5)
      rf > 0: myPos = idiv(myPos · (100 + rf), 100); hisPos = idiv(100 · hisPos, 100 + rf)
      rf < 0: myPos = idiv(100 · myPos, 100 − rf); hisPos = idiv(hisPos · (100 − rf), 100)
   red = idiv((400 − range) · T.certainty, 400)
   totalScale += idiv(idiv(max(myPos, hisPos), 100) · red, 100)
   return idiv(idiv(myPos − hisPos, 100) · red, 100)
CalcWorstCTGTForPosition(shooter, target, g, lvl, aps): min over cube 1 (prone; only if aps >= 4), 2 (crouch; aps
   >= 2), 3 (stand) of SoldierToLocationChanceToGetThrough(shooter, g, lvl, cube, target); start 100; stop at 0
CalcAverageCTGTForPosition: same skips, integer average of the valid cubes (cube 3 always)
CalcBestCTGT(him, me, myGrid, myLvl, myAps): for d = 1..8 (DirectionInc(8) = inc(1): NE twice, N never, as in `09`):
   adj = NewGridNo(him.grid, inc(d)); off-map → next
   NewOKDestination(him, adj, IGNOREPEOPLE, myLvl) > 0 and !InWaterOrGas(him, adj):
      check = N/E/S/W → adj; NE/NW → his north neighbour; SE/SW → his south neighbour; d == 8 → unchanged
      NewOKDestination(him, check, people block, myLvl) → move him to adj (grid + centre XY),
         v = CalcWorstCTGTForPosition(him, me, myGrid, myLvl, myAps); best = max; 100 → stop
   (the caller restores his position)
```
Deterministic: the CTGT queries are `SoldierToLocationChanceToGetThrough` (`11` §3.6, a simulated bullet with no RNG,
inferred); ja2-node's pathfinder draws no `Random(4)` (deviations "Pathfinder RNG").

### 8.3 `FindSpotMaxDistFromOpponents(s)` (`:985-1254`)

```
threats: as §8.2 but the −999 test comes first and there is no range cap; keep only loc;
   closest = min range(s.grid, loc) (start 1500); none → NOWHERE
CIV team: roam = RoamingRange(s, &origin); roam == 0 → NOWHERE.  others: roam = 100, origin = s.grid
alert == BLACK: R = AP/2, budget = AP;  else budget = min(AP/2, CalcActionPoints), R = budget/2
RT and R > 4: R /= 2, budget /= 2
budget = clamp(budget − GetAPsToChangeStance(s, ANIM_STAND), 0, 255)          // 0 = unlimited
flood: mode RUN_AWAY, COPYREACHABLE
for t in scan order: skip !REACHABLE, sBlackList, gas without a mask; CIV: skip Pyth(origin, t) > roam
   ENEMY team and GridNoOnEdgeOfMap(t, &dir) (tests NE, SE, SW, NW for TRAVELCOST_OFF_MAP):
      v = 1500 − Pyth(s.grid, t)        // edge tiles beat everything (units mixed on purpose)
   else dir = −1; v = min over threats of range(t, loc) (start 1500)
   v > closest → closest = v, best = t, bestDir = dir
reset; bestDir != −1 → s.ubQuoteActionID = GetTraversalQuoteActionID(bestDir) (TRAVERSE_*: the soldier will leave
   the map at the edge, AIMain.cc:442-459); return best
```
Fleeing enemies thus head for the map edge and leave the sector (`HandleAITacticalTraversal` →
`TacticalRemoveSoldier`, `AIMain.cc:2013-2044`). ja2-node: `executeMovement` (`ai/control.ts`) extends the path off the
map with `adjustSoldierPathToGoOffEdge` (`sector-exit.ts`; `AIMain.cc:1521-1541`); at the path's end
`handleAITacticalTraversal` clears `quoteActionId`, ends the turn, removes the soldier as a target, moves a scheduled
civilian to the away slots and otherwise removes the soldier through `sectorHooks.soldierLeftMap` (campaign:
init-list death effects and `processQueenCmdImplicationsOfDeath`, `17` §10), then runs `checkForEndOfBattle`.

### 8.4 `FindNearestUngassedLand(s)` (`:1256-1349`)

For `R = 5, 10, 15, 20, 25`: flood (no budget, limit R, mode LEAVE_WATER_GAS, COPYREACHABLE); for each reachable,
non-blacklisted tile `c = LegalNPCDestination(s, t, ENSURE_PATH_COST, NOWATER, 0)` (rejects gas, water, own tile);
`c != 0 and c < shortest` (start 1000, kept across rings) → best; stop at the first ring with a result. Green also calls
it (`09` §2.3 step 6), where a kid civilian's `DetermineMovementMode` draws `Random(10)` once per ring.

### 8.5 Light at night

- `InLightAtNight(g, lvl)` (`AIUtils.cc:1580-1604`): false underground, if ambient < 5, or indoors (`GetRoom != NO_ROOM`);
  else `LightTrueLevel(g, lvl) < ambient` (lower level = brighter).
- `FindNearbyDarkerSpot(s)` (`FindLocations.cc:1351-1474`): `cur = LightTrueLevel(s.grid)`; for `R = 5, 10, 15`: flood as
  §8.4; tiles within `Pyth(origin, t) <= roam`; `diff = gbLightSighting[0][cur] − gbLightSighting[0][LightTrueLevel(t)]`,
  skip `diff <= 1`; `c = LegalNPCDestination(ENSURE_PATH_COST)`, skip 0; `v = 2c − diff < best` (start 1000, kept) →
  spot; stop at the first ring with a spot.
- `LightTrueLevel` is the true light level of `20`.

### 8.6 `SearchForItems(s, reason, hand)` (`:1487-1689`)

`AP < 3` or non-merc body → NONE. `R = gbDiff[MAX_COVER_RANGE][diff]` + attitude (DEFENSIVE −1, BRAVE* +2, CUNNING* −2,
AGGRESSIVE +1), `min(R, wisdom/10)`, RT halves, then halves again. Flood with budget `AP − 3` (exactly 3 → unlimited),
mode PICKUP_ITEM; candidate tiles with an item pool, not in gas/smoke, best `3·value / (3 + Pyth)`; item status ≥ 70;
scores: gun `shotsLeft · deadliness / myDeadliness`, ammo `TotalPoints`, weapon `100·new/cur` (or `200 + deadliness`
when unarmed); Strac never picks armour. A gun that does not fit queues DROP_ITEM then PICKUP_ITEM. No RNG.
ja2-node: PICKUP_ITEM walks through `turnHooks.aiPickup` and picks up in the arrival pending-action hook.

---

## 9. Civilians, militia, special cases

### 9.1 Civilian cowering

RED block (`DecideAction.cc:1553-1617`, repeated at `:1655-1719`), for `fCivilian` (RED definition), body not COW or
CRIPPLECIV, and no usable weapon (`FindAIUsableObjClass(s, IC_WEAPON) == ITEM_NOT_FOUND`):
```
battle = TB or fEnemyInSector
cowering:
   battle: bLastAction == COWER → NOWHERE, NONE
           else next = FindSpotMaxDistFromOpponents(s) (§8.3) into usNextActionData;
                != NOWHERE → bNextAction = RUN_AWAY, usActionData = ANIM_STAND → STOP_COWERING; else NONE
   not battle: bNewSituation == NOT → bAlertStatus = GREEN (direct write) → STOP_COWERING; else NONE
not cowering:
   battle → usActionData = ANIM_CROUCH → COWER
   else → bNextAction = WAIT, usNextActionData = REALTIME_CIV_AI_DELAY (draws Random(3)), ANIM_CROUCH → COWER
```
BLACK block (`:2679-2714`, inside the `CanNPCAttack` loop, `NOSHOOT_NOWEAPON`, not boxer, not COW/CRIPPLECIV):
cowering → `bLastAction == COWER` ? NONE : (flee spot → `RUN_AWAY` queued + STOP_COWERING, else NONE); not cowering →
COWER (no battle test, no WAIT).
- `RefreshAI` resets `bLastAction` to NONE at each TB turn start, so a cowering civilian alternates: turn start →
  STOP_COWERING + queued RUN_AWAY (if a flee spot exists); after the run, COWER again at the next decision (inferred
  from the flow).
- `fEnemyInSector` is set by `SetEnemyPresence` only on the first enemy sighting in a *virgin* sector
  (`Overhead.cc:4105-4132`), cleared when a battle is won or lost (`:4463, :4524`) and on sector load
  (`Strategic/StrategicMap.cc:2922, 3115`). In RT without it, a RED civilian cowers for one `REALTIME_CIV_AI_DELAY`,
  then (no new situation) stands up and is forced GREEN.
- Armed civilians (hostile civ groups, e.g. Kingpin's men) skip cowering and use the soldier logic, except that they are
  `fCivilian` for radio (never), RED main loop (never) and RED step 16 (always try to run away).
- GREEN civilians who are still cowering stop (`09` §2.3); YELLOW civilians likewise (§3 step 1).

### 9.2 Militia

Same deciders, movement modes, cover and attack evaluation as soldiers (`fCivilian` false); militia are on the
player's `bSide`, so their opponents are the enemies and hostile civilians. Differences:
- RT waits and green seek-friend waits use `REALTIME_CIV_AI_DELAY` (`09` §1.4); green uses `fCivOrMilitia`.
- YELLOW step 7a: RT militia within 5 tiles who see the noise spot forget it. RED step 8: with the light policy on
  (default off) they never avoid light.
- `CheckForChangingOrders` at RED/BLACK: militia not ONGUARD/CLOSEPATROL become SEEKENEMY (roam the whole map).
- BLACK: `PreRandom(20)` instead of `PreRandom(40)` (§6.4); the militia-only radio at the end (§6.8).
- `RadioSightings` to the militia team triggers `HandleInitialRedAlert(MILITIA)` (`08` §2.5). In TB militia act on
  their own team turn through the AI list (§10.3).

### 9.3 Profiled NPCs, Queen, Joe, Warden, boxers, tanks, creatures

| Special | Original | ja2-node |
|---|---|---|
| Named NPCs | `DecideActionNamedNPC` (RT YELLOW/GREEN only) | `ai/decide-named-npc.ts` (`24`) |
| Queen and Joe in Meduna | `HeadForTheStairCase` (RED step 3, BLACK step 3), TRAVERSE_DOWN | `ai/queen-escape.ts` (`26` §5.2) |
| Boxers | `DecideActionBoxerEnteringRing`, punch-only BLACK and its closing in (§6.8) | `ai/decide-boxing.ts` (`25` §3) |
| Creatures, bloodcats, crows | `CreatureDecideAction`, `CrowDecideAction` | `ai/creature-decide.ts` (§12) |
| Warden, `the_chosen_one`, panic (§9.4) | scripted sectors (Tixa, alarm switches) | not ported |
| Tanks | `TANK()` branches | the branches exist, no vehicles in tactical |

"Not ported" and the tanks are gaps "Combat AI specials".

### 9.4 Panic AI (`TacticalAI/PanicButtons.cc`)

Not ported; scripted sectors only. `InitPanicSystem` (from `InitAI`) scans world bombs with `PANIC_FREQUENCY(_2/_3)`
(`Tactical/World_Items.cc:72`): a SWITCH sets a trigger (grid, tolerance, alarm flag) and `PANIC_TRIGGERS_HERE`, any
other such bomb `PANIC_BOMBS_HERE`. Without them (most sectors) `fPanicFlags = 0` and nothing below runs.
- `PanicAI(s, canMove)`: panic bombs and `s` holds a `REMOTEBOMBTRIGGER` → USE_DETONATOR if `AP >= 2`, else NONE;
  triggers and `s` is `the_chosen_one`: on the trigger → PULL_TRIGGER (AP ≥ 2); reachable → GET_CLOSER to it; cannot
  move → NONE; otherwise lose the status and `MakeClosestEnemyChosenOne`; else −1 (no decision).
- `MakeClosestEnemyChosenOne` (cheapest `PlotPath` to the trigger among conscious, rested, unengaged ground troops;
  raises him to RED, `SetNewSituation`, grants keys) and `PossiblyMakeThisEnemyChosenOne` (`AP_PULL_TRIGGER +
  PlotPath(RUNNING) <= 2·CalcActionPoints`); `ClosestPanicTrigger` (eligible when `PercentEnemiesKilled >= tolerance`).
- `NeedToRadioAboutPanicTrigger` feeds the radio chance (§5 step 14, §6.8). No RNG anywhere in the file.

---

## 10. Cadence: real time at YELLOW+, green in TB, the AI list

### 10.1 Real time at YELLOW, RED, BLACK

- Scheduler as green (`09` §1): visits every 110 ms, `RTHandleAI`, NONE → WAIT. YELLOW/RED/BLACK actions queue no
  WAIT (§3, §5 notes): an alerted soldier re-decides about one visit after each action ends and waits
  `REALTIME_AI_DELAY` (10–11 s) only after NONE.
- RT only: YELLOW forget-the-noise (§3 step 7a), named NPCs. RT disables YELLOW cover, RED long-range toss and RED
  hiding (`hide = −99`) and skips every AP test written `(!gfTurnBasedAI || …)`.
- BLACK in RT lasts only until combat starts: the first hostile sighting enters combat in the same look (`08` §2.9)
  unless `EnterCombatMode` refuses (no capable enemy). RED in RT is common after combat (RED never drops, `09` §2.2)
  and after a team radio.
- The `NewDest` swat roll applies at RED in RT too (ENEMY team).

### 10.2 GREEN and YELLOW soldiers in TB

`DecideActionGreen` in TB (`09` §2.3 with the TB guards): civilians skip the schedule/named-NPC prelude; the look
branch needs `GetAPsToLook <= AP`; no WAIT is queued after anything; `RandDestWithinRange` makes 10 tries. YELLOW
soldiers use the AP-gated turn and crouch and may take cover. A GREEN/YELLOW soldier's unfinished move is kept into
his next turn (§1.2), and `RefreshAI` runs `ManChecksOnFriends` for them.

### 10.3 AI list (`TacticalAI/AIList.cc`)

List and conditions: `10` §6.3 (ja2-node `turns/ai-list.ts`). For the combat AI:
- Priority `bAlertStatus + (bVisible == TRUE ? 3 : 0)`, FIFO among equals: visible BLACK 6, visible RED 5, visible
  YELLOW 4, visible GREEN = unseen BLACK 3, unseen RED 2, YELLOW 1, GREEN 0.
- Idle neutral civilians (alert < RED) act 1 turn in 10: the `PreRandom(10)` is drawn before the quote-record test.
  A cowering neutral civilian at RED+ is skipped only when `bVisible == 0` (limbo); −1 passes (quirk).
- `RemoveFirstAIListEntry` re-checks without random checks, but `DecideAlertStatus` runs again.
- Callers: enemy/militia/civ team start (`TeamTurns.cc:366`) and interrupt rebuilds (`:655, 881-887`), each re-drawing
  the civilian `PreRandom`s in slot order.

---

## 11. Quirks to keep

Index of the quirks stated in their sections:
- §1.3–§1.7: the Strac movement-range truncation (re-paid turns; the extra `CancelAIAction` clears `SkipCoverCheck` and
  `bBypassToGreen`; vanilla differs; unverified); a prone turn needs 6 APs but costs 2; CHANGE_STANCE always needs 2;
  the loop detector still starts the move after `EndAIGuysTurn`; `SoldierTriesToContinueAlongPath` continues after its
  own `CancelAIAction`.
- §2.1 the dead room test; §2.7 `CheckForChangingOrders` on every BLACK status check; §3 `bAIMorale` starting at 0
  (YELLOW moves run) and the ATTACKSLAYONLY radio draw; §4.4 `unconsciousOK` unused, public noise grid −2.
- §5: the duplicate cowering block, the unreachable civilian hide case, the level-0 LOOK, the watch `PreRandom(2)`
  before the prone policy, the spotter caller losing all APs.
- §6: the armed-civilian infinite loop (§6.2); `NPCDoesAct` for a rejected throwing-knife target (§6.3);
  `ubAimTime = stance cost`, the burst `ubAPCost` minus `BURSTING`, burst APs for `inv[HANDPOS]` vs `inv[weaponIn]`,
  THROW_KNIFE's lost LOWER_GUN and second queued THROW_KNIFE (§6.6); `ShootingStanceChange` reading the last attack's
  `bTargetLevel/bTargetCubeLevel` (§6.7).
- §7: equal shot values switch to the new target (§7.2); `CalcBestThrow` keeps the stale `usAttackingWeapon`, counts
  the thrower as a friend and keeps the first of equal tiles (§7.3).

Stated only here:
- `SkipCoverCheck` is **one global** for all soldiers (`AIMain.cc:866`), set by any soldier's facing/stance execution
  and cleared by any `ExecuteAction`/`CancelAIAction`/YELLOW `RefreshAI`.
- Tired GREEN (`bBreath < 75`) / YELLOW (`< 50`) soldiers get `SetNewSituation` on every status check: in TB the action
  chosen on a pass is cancelled on the next pass and re-decided (with fresh draws) until a decision returns NONE
  (inferred from the flow).
- `ManChecksOnFriends` makes a GREEN soldier "hear" a YELLOW friend at the friend's grid with volume 3.
- `FindSpotMaxDistFromOpponents` sets `ubQuoteActionID = TRAVERSE_*` for an edge spot and nothing clears it on a
  cancel, so a later move of any kind is extended off the map and ends in `HandleAITacticalTraversal` (inferred).

---

## 12. Creatures and bloodcats (`TacticalAI/CreatureDecideAction.cc`)

### 12.1 Dispatch and alert status

- `CREATURE_OR_BLOODCAT(s)` (bodies `ADULTFEMALEMONSTER`..`QUEENMONSTER` and `BLOODCAT`) → `CreatureDecideAction`,
  `CROW` → `CrowDecideAction`, everyone else `DecideAction` (§1.2, RT `RTDecideAction`).
- `DecideAlertStatus` hands `SOLDIER_MONSTER` (the seven creature bodies) to `CreatureDecideAlertStatus`; bloodcats
  use the human version, so their `bMobility` stays 0 (MOBILE). `CreatureDecideAlertStatus` sets the mobility (MOBILE
  for adults, young and infants, IMMOBILE for the queen, CRAWLER for larvae) and the status: larvae stay GREEN;
  otherwise BLACK on sight, BLACK drops to RED, GREEN/YELLOW → RED when the team is aware or under fire, GREEN →
  YELLOW on a heard noise, YELLOW → GREEN when no noise is left and no action runs. Status changes call
  `SetNewSituation` (unless RED↔BLACK) and `CheckForChangingOrders` (first time ≥ RED); unchanged GREEN/YELLOW with low
  breath re-decides. A crawler whose AP are below its initial AP does nothing at any status.
- `CreatureDecideAction` by status: GREEN (track a scent, point patrols, leave gas, random patrol
  `PreRandom(100) < chance` with the orders/attitude table, look around), YELLOW (turn to the noise, seek it, track),
  RED (hurt call, sighting call `PreRandom(100) < 20` while the team is unaware, unarmed bodies run away, follow the
  caller, seek the closest reachable disturbance, eat when hunting, track, turn to the closest opponent), BLACK §12.2.
  In RT the GREEN patrols and look-arounds queue `AI_ACTION_WAIT` for `REALTIME_CREATURE_AI_DELAY = 10000 +
  1000·Random(3)` ms (twice that for a crawler's random patrol); `RTDecideAction` uses the same delay between decisions
  of creatures and bloodcats that are not hunting.

### 12.2 BLACK

1. No AP → NONE; resting crawler → NONE.
2. Calls (not bloodcats, larvae or infants; `AP ≥ AP_RADIO`, more than one in sector): hurt (`bLife < bOldLife` and
   `bLifeMax / bLife > 2`) → CALL_ATTACKED (sets `bOldLife`); else, team unaware: `Random(100) < 20·oppCnt` (100 for the
   queen) → CALL_1_PREY or CALL_MULTIPLE_PREY.
3. Gas or breath < 5 → run away; gas → nearest ungassed land.
4. `CanNPCAttack`; out of spit (`NOSHOOT_NOAMMO`) → hand marked `OBJECT_AI_UNUSABLE`, then a blade swapped in
   (`IC_TENTACLES` for the queen) or the body flees.
5. Spit (`IC_GUN` with shots): temporary swap, `MinAPsToAttack(sLastTarget)`, `CalcBestShot` (spit adds the gas damage
   times the mercs inside the gas radius, §7.5), swap back.
6. Blade: the queen looks for `IC_TENTACLES`; a bloodcat claws on `PreRandom(3) != 0`, else bites; a spitter considers
   its claws only when `Random(4) == 0`. The swap back sits inside the AP check, so an unaffordable blade stays in hand
   (Strac quirk, kept). `CalcBestStab` runs with `usUIMovementMode = RUNNING` and caches the walk in
   `sWalkToAttackGridNo/WalkToCost`; `CalcTentacleAttack` sums the values of every merc in tentacle reach.
7. Stab beats spit when its value exceeds `1.2 ×` the spit value; the weapon is swapped in for good; aim, and
   `AIM_SHOT_HEAD` for spit with `> 50` chance, else random. Creature code never sets `bTargetLevel`.
8. Otherwise, more than 2 tiles from `ClosestKnownOpponent`, close in: spitters `AdvanceToFiringRange` (keeps the AP of
   `MinAPsToAttack` with the hand item, claws for males, quirk kept) then `GoAsFarAsPossibleTowards`; else turn to face
   (`ValidCreatureTurn`: every intermediate facing must fit the standing structure). Fleeing bodies run away.

### 12.3 Calls, scent, eating

- `CreatureCall`: team aware, `MONSTER_UP`/`QUEEN_CALL`; priority `gbCallPriority[call][female|male|queen]` (hunting
  females `gbHuntCallPriority`) minus `Pyth/30`; receivers below BLACK, alive ≥ OKLIFE, not larvae, infants or the
  queen, get RED, caller, grid and `CancelAIAction`; priority > 8 frenzies (A)F (APs × 1.3). `AddOneOpponent` resets the
  caller of a monster.
- `TrackScent` sniffs human smells 3 tiles around but tests `LegalNPCDestination` on `usActionData`, not on the tile,
  so it works only when the stale action data is a legal grid (Strac quirk, kept); ties keep the first trail and draw
  `Random(2)` only when the facing difference equals the best one.
- Hunting females at RED look for the nearest `ROTTING_STAGE2` corpse within 5 tiles and approach it. A blade attack on
  a helpless victim (`bLife < OKLIFE` or collapsed) plays the eating animations with opcode 761 (a head bite with item 2,
  25/25, range 50) and adds a regeneration point; each point heals 10 life at the creature's next turn.

### 12.4 Senses, smell and blood

- Monsters see by smell: `DistanceVisible` is `DistanceSmellable` (0 for an empty tile, `26·(normal − monster)/10` for
  a human target), the line of sight runs with `fSmell` (trees and open windows pass, other obstacles cost 80); hearing
  −10; larvae neither see nor hear. Spit in the face blinds (`bBlindedCounter`, sight 0, opplist decays).
- `DropSmell` on every new grid (blood blocks it), `DropBlood` from wounds (`min(life/10, 7)`) and bleeding, the
  `Random(3)` decay delay; `DecaySmells` at each TB end of round, `DecayBloodAndSmells` after more than 100 game
  seconds in RT (compression periods: deviation "Blood and smell decay period"). Savegames restore both maps, and a
  sector keeps both when it is left (`16`). The other drops (a pass-through, the flyback, corpses wiping blood):
  `33`.
- Movement noise: bloodcats +50, `STEALTHY` +25 per trait.

### 12.5 Data quirks

- Strac's `CREATURE_QUEEN_TENTACLES` has `internalType` BLADE (vanilla `IC_TENTACLES`), so `FindObjClass(IC_TENTACLES)`
  finds nothing: the queen only spits and calls. `CalcTentacleAttack`, `QUEEN_SWIPE` and opcode 755
  (`DishoutQueenSwipeDamage`) are ported but unreachable with that data.
- Creatures and bloodcats are multi-tile: paths, destinations and adjacent attack tiles use their animation structures
  (`07` §3.3).

---

## 13. Implementation in ja2-node

### 13.1 State

- `Soldier` (`src/sim/tactical/soldier.ts`). `ai: AiState` holds the decider state: `alertStatus`, `orders`,
  `attitude`, `action`/`actionData`, `nextAction`/`nextActionData`/`nextTargetLevel`, `lastAction`,
  `actionInProgress`, `newSituation` (`Situation` in `ai/actions.ts`), `bypassToGreen`, `blackList`,
  `noiseGridNo`/`noiseLevel`/`noiseVolume`, `oppCount`, `underFire`, `morale` (`bAIMorale`, starts at 0), `cautious`
  (`AI_CAUTIOUS`) and the creature fields (`mobility`, `callPriority`, `caller`, `callerGridNo`, `callActedUpon`,
  `frenzied`). Turn and attack fields sit on the soldier: `actionPoints`, `initialActionPoints`, `moved`,
  `aiTurnControl`, `turnInProgress`, `lastTwoLocations`, `shock`, `bleeding`, `lastTarget`, `attackingWeapon`,
  `aimTime`, `aimShotLocation`, `doBurst`, `doSpread`, `spreadLocations`, `targetLevel`, `targetCubeLevel`,
  `lastAttackHit`, `ctgtTarget`, `quoteActionId`, `walkToAttackGridNo`/`walkToAttackCost`, `oppList`, `lastKnownOpp`.
- `TurnState` (`t.turn`, `turns/turn-state.ts`): `aiList`, `skipCoverCheck` (the one global of §11),
  `spottersCalledForBy` (−1 = NOBODY), `consNumTurnsWeHaventSeenButEnemyDoes`, `enemyInSector`, `hiddenInterrupt`,
  `seenOpponents` (`gbSeenOpponents`), `watched` (§2.6, 3 slots per soldier), `enemyOfferedSurrender`,
  `attackBusyCount`.
- `Perception` (`t.perception`, `perception/sight.ts`): `publicOpp`, `publicLastKnown`,
  `publicNoiseGridNo/Volume/Level`, `lastMercToRadio`, `awareOfOpposition` (`bAwareOfOpposition`).
- `t.campaign.difficultyModifier` (§4.3).
- Not stored: the personal and public last-known opponent levels (`gbLastKnownOppLevel`,
  `gbPublicLastKnownOppLevel`); the helpers use the opponent's current level.
- `gubNPCAPBudget`/`gubNPCDistLimit` are arguments of `reachabilityFlood` (`ai/cover.ts` → `findBestPath`), not
  globals, so nothing can leak between searches; `gubAIPathCosts` is a fresh array per flood (deviations "AI
  path-cost cache").
- Fixed-width arithmetic goes through `src/core/int.ts` (`i8` for the RED points, `i16` for chances, `u8` for chances
  to hit, aim and AP costs).

### 13.2 Modules (`src/sim/tactical/`)

| Module | Contents |
|---|---|
| `ai/actions.ts` | action ids, `FIRST_MOVEMENT_ACTION`/`LAST_MOVEMENT_ACTION` (Strac range, §1.4), `Situation`, `URGENCY`, `MOVEMENT_MODE`, delays |
| `ai/control.ts` | `handleSoldierAI` (RT and TB paths, the new-situation busy-count rule of §1.1), `executeAction` (§1.6), `actionDone`, `cancelAIAction`, the completion hooks `freeUpFromTurning`/`StanceChange`/`RoofClimb`/`PendingAction` (§1.4), `npcDoesAct`, `newDest` (§1.7), the loop detector, `triesToContinueAlongPath`, `handleAITacticalTraversal` (§8.3), the RT cadence (`beginAiPass`, `aiForSlot`, away slots); `createAiControl` wires the deciders |
| `ai/turn-based.ts` | `isActionAffordable` (§1.3), `startNPCAI`, `refreshAI`, `manChecksOnFriends`, `turnBasedHandleNPCAI`, `endAIGuysTurn` |
| `turns/ai-list.ts` | `buildAIListForTeam`, `removeFirstAIListEntry`, `moveToFrontOfAIList` (§10.3) |
| `ai/decide.ts` | `decideAction`, `decideAlertStatus`, `checkForChangingOrders` (§2.7), `determineMovementMode`, the green decision (`09`) |
| `ai/combat-decide.ts` | `decideActionYellow` (§3), `decideActionRed` with `redMainChoice`, `longRangeToss`, `civilianCower` (§5, §9.1), `decideActionBlack` with `executeAttackChoice` and `offersSurrender` (§6) |
| `ai/attack-choice.ts` | §7: `canNPCAttack`/`okToAttack`, `calcBestShot`, `checkIfTossPossible`/`calcBestThrow`, `calcBestStab`, `calcTentacleAttack`, `calcSpreadBurst` (with `AIPickBurstLocations`), the damage estimates, `shootingStanceChange`, `stanceChange`, `loadWeaponIfNeeded`, `rearrangePocket` |
| `ai/morale.ts` | `calcMorale`, `calcManThreatValue`, `rangeChangeDesire`, `threatPercent`, the knowledge choice of §4 |
| `ai/cover.ts` | §8: `findBestNearbyCover` with `calcCoverValue` and the CTGT helpers, `findSpotMaxDistFromOpponents`/`findFleeSpot` and the edge-escape quote actions, `findNearestUngassedLand`, `findNearbyDarkerSpot`, `inLightAtNight`, `reachabilityFlood` |
| `ai/utils.ts` | `closestReachableDisturbance`, `closestReachableFriendInTrouble`, `estimatePathCostToLocation` (§2.4, §2.5, §4.4), `closestSeenOpponent`, the watched-location queries, `findAIUsableObjClass`, `recalculatePathCost` |
| `ai/destinations.ts` | `internalGoAsFarAsPossibleTowards` (TB reserve and flags, §1.7), `legalNPCDestination`, roaming range |
| `ai/item-search.ts` | `searchForItems` (§8.6) |
| `perception/knowledge.ts` | `noiseHeard`/`mostImportantNoiseHeard`, `whatIKnowThatPublicDont`, `closestKnownOpponent`, `guySawEnemyThisTurnOrBefore` |
| `perception/duel.ts`, `perception/sight.ts` | watched locations (§2.6); `radioSightings`, the public opplist and its decay |
| `buildings.ts`, `roofs.ts` | climb points and `getInterveningClimbingLocation` (§2.4), roof climbing and `freeUpFromRoofClimb` |
| `ai/queen-escape.ts`, `ai/decide-boxing.ts`, `ai/decide-named-npc.ts` | the specials of §9.3 |
| `ai/creature-decide.ts`, `smell.ts`, `multi-tile.ts` | §12: creature, bloodcat and crow decisions, calls and scent; smell and blood map; multi-tile structures with the multi-tile part of `pathfinding.ts` (`07` §3.3); the creature branches live in `combat/melee.ts`, `combat/hit.ts`, `perception/` and `turns/` |

### 13.3 Wiring

`TacticalSim` (`tactical-sim.ts`) builds the `AiControl` (`createAiControl`), runs `beginAiPass` before each overhead
pass and `aiForSlot` for every merc slot; in combat every slot is handled on every pass (`10` §6.1). Team turns
(`turns/turns.ts`) build the AI list and start the first soldier. The deciders reach the rest of the tactical layer
through hooks on the state: attacks through `turnHooks.aiAttack` (`handleItem`, `combat/attack.ts`), pickups and drops
through `turnHooks.aiPickup`/`aiDropHandItem`, the surrender offer through `t.narrative.offerSurrender` (`24` §8.5),
edge escapes through `sectorHooks.soldierLeftMap` (§8.3).

### 13.4 Gaps

Deviations (`deviations.md`): "Armed civilian without ammo", "AI climb that cannot start", "Watchdogs", "Recalculated
path cost", "GoAsFar fallback", "AI path-cost cache", "Difficulty and progress in tactical". Gaps (`gaps.md`): "Combat
AI specials", "AI threat value", "AI throw targets". Other gaps:
- `handleInitialRedAlert` only sets `awareOfOpposition`: no chosen one, no Queen and Joe to RED in Meduna (§2.3).
- The `Random(50)` civilian quote on a visible AI attack (§1.6) is not drawn: such an attack takes one main-stream
  number less than in the original.
- `closestKnownOpponent` has neither the Carmen rule nor the same-building level skip (§4.4).
- BLACK's toss branch skips the mortar room rule (§6.3).
- `calcBestThrow` lacks the underground direct/adjacent test (§7.3).

### 13.5 Verification

Unit tests next to the modules (`ai/*.test.ts`) cover morale and threat, cover, flight and light, `calcBestShot`,
`canNPCAttack`, `calcBestStab`, `calcSpreadBurst` and short turn-based scenarios (shooting, an interrupt, seeking
after a radio call, an item pickup, knife attacks). Oracle probes (`tools/oracle/README.md`): `bestshot`
(`CalcBestShot` for every armed soldier of the saves), `civ` (the surrender condition, the named-NPC AI), `boxing`,
and `creature-ai` (creature and bloodcat decisions, melee choice, calls, smell and scent, draw for draw). No probe
compares the human YELLOW/RED/BLACK decisions.

---

## 14. Unverified

Not traced end to end in the original:
- The TB truncation of CHANGE_FACING/CHANGE_STANCE and its AP drain (§1.4); ja2-node follows it.
- `bAIMorale = 0` for map placements (§3), which makes YELLOW movement urgent.
- The BLACK civilian infinite loop (§6.2), the basis of the "Armed civilian without ammo" deviation.
- The cowering alternation of §9.1.
- Tired soldiers re-deciding every pass (§11).
- `ubQuoteActionID` persisting after a cancelled flight (§8.3, §11).
- Costs in `gubAIPathCosts` excluding the start cost (§8.1).
- `SoldierToLocationChanceToGetThrough` drawing no RNG (§8.2).
- The THROW_KNIFE double queue (§6.6).

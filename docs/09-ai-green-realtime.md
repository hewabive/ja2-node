# 09 — Green-alert AI in real time

**Conventions.** Paths are relative to `reference/stracciatella/src/game/`; `V:` is vanilla `Build/`. "(inferred)"
marks conclusions not traced end to end. `Random` = the `main` stream, `PreRandom` = the `pre` stream (`01` §3.6). All
times are **game milliseconds**; a tick is 5 ms. A **visit** is a `HandleSoldierAI` call for one soldier that passes
its timer gate (§1.2). Orders: `STATIONARY 0, ONGUARD 1, CLOSEPATROL 2, FARPATROL 3, POINTPATROL 4, ONCALL 5,
SEEKENEMY 6, RNDPTPATROL 7`. Attitudes: `DEFENSIVE 0, BRAVESOLO 1, BRAVEAID 2, CUNNINGSOLO 3, CUNNINGAID 4,
AGGRESSIVE 5, ATTACKSLAYONLY 6`. Alert: `GREEN 0, YELLOW 1, RED 2, BLACK 3`. Action ids: `AI.h:29-90` (NONE 0,
RANDOM_PATROL 1, SEEK_FRIEND 2, POINT_PATROL 6, LEAVE_WATER_GAS 7, SEEK_NOISE 8, WALK 17, MOVE_TO_CLIMB 19,
CHANGE_FACING 20, CHANGE_STANCE 21, YELLOW_ALERT 22, WAIT 32, COWER 35, STOP_COWERING 36, ABSOLUTELY_NONE 41,
END_COWER_AND_MOVE 44). Turn-based AI and the YELLOW/RED/BLACK deciders: `13`.

---

## 1. Real-time scheduling

### 1.1 The overhead AI tick (`Tactical/Overhead.cc:109-116, 388-445, 491-514, 1032-1071, 1138-1139`)

```
RT_DELAY_BETWEEN_AI_HANDLING = 50; RT_AI_TIMESLICE = 10; PAUSE_ALL_AI_DELAY = 1500
state: lastRtAi = 0 (guiRTAILastUpdateTime), cursor = 0 (guiAISlotToHandle), OFFMAP = 0xFFFF
every overhead pass (5 ms):
  if pauseAll && pauseTimer && now − pauseTimer > 1500: pauseAll = false        // set 1500 ms on leaving combat (:4085)
  handleAI = false
  if !pauseAll && !INCOMBAT && now − lastRtAi > 50: lastRtAi = now; handleAI = nextAIToHandle(cursor)
  for cnt in 0 .. MercSlots.length−1 (insertion order, vector erase on removal):
     s = MercSlots[cnt]; …animation / movement for s (07 §4.3); the `continue`s at :689,799,860,952,964 skip s's AI this pass
     if !pauseAll && (INCOMBAT || (handleAI && cursor == cnt) || s.fAIFlags & AI_HANDLE_EVERY_FRAME || autoBandage):
        HandleSoldierAI(s)
        if !INCOMBAT: handleAI = (clock − passStart > 10) ? false : nextAIToHandle(cursor)
  away slots (:1058-1070): if !pauseAll && !INCOMBAT && cursor == OFFMAP && awayCursor != RESET:
     HandleSoldierAI(AwaySlots[awayCursor]) if it has AI_CHECK_SCHEDULE   // off-map schedule NPCs (25)
  end of pass: gubNPCAPBudget = gubNPCDistLimit = 0
nextAIToHandle(cur): for c from (cur >= len ? 0 : cur+1) to len−1: if team != OUR (or PC under AI): cursor = c; return true
                     cursor = OFFMAP; (away-slot cursor advance); return false
```

Consequences:
- The strict `>` makes the tick period **55 ms** with 5 ms passes.
- On any modern CPU one AI tick never exceeds 10 ms of wall clock, so each tick visits **every AI slot after the cursor
  in slot order**, and the next tick restarts at slot 0 (cursor = OFFMAP). ja2-node has no slice limit (deviations
  "Timing"). Quirk: the initial cursor 0 makes the very first tick start at slot 1.
- `HandleSoldierAI(s)` runs after `s`'s own frame step and before `s+1`'s, inside the same pass. This order fixes the
  RNG order (all AI soldiers in `MercSlots` order).

### 1.2 `HandleSoldierAI`, real-time path (`TacticalAI/AIMain.cc:86-511`), in order

1. Return if `SOLDIER_ENGAGEDINACTION`, `fEnemySightingOnTheirTurn`, or the explosion queue is non-empty/active (`:91-99`).
2. Player soldiers return unless autobandage / PC under AI control with a quote record or boxer (`:101-116`).
3. `gfTurnBasedAI = INCOMBAT` (`:119-126`). In RT, unless `AI_HANDLE_EVERY_FRAME`:
   `if !TIMECOUNTERDONE(AICounter, AI_DELAY = 100) return` (`:40, 159-166`). "Done" means `now >= AICounter`; when
   done the counter is re-armed to `now + 100` (`Utils/Timer_Control.cc:165-172`). A new soldier has `AICounter = 0`,
   so he is due at the first tick. Vanilla keeps the 100 per soldier in `uiAIDelay` (`V:TacticalAI/AIMain.c:219-224`,
   `V:Tactical/SoldierCreate.c:1024`). With 55 ms ticks an idle soldier is visited every **110 ms**.
4. Clear `AI_HANDLE_EVERY_FRAME` unless `ubQuoteActionID == TURNTOWARDSPLAYER` (`:168-175`).
5. Return on `fGettingHit` (`:181`); boxing gate (`:186-199`); `bLife < OKLIFE` or inactive (`:202-215`); `AI_ASLEEP`
   without `AI_CHECK_SCHEDULE` (`:217-233`); `!bInSector` (`:237`); vehicle/robot (`:248`); `bCollapsed` →
   `CancelAIAction` (`:260-275`). `EndAIGuysTurn` is a no-op in RT (`:517`).
6. **New situation** (`:288-353`, the same block in TB): if `bNewSituation == IS_NEW_SITUATION`, it is processed when
   `ubAttackBusyCount == 0`, or (busy-count hack) when the soldier's action is FIRE_GUN and no bullet is in flight, or
   TOSS_PROJECTILE and no physics object is in flight (this one zeroes the busy count). Processing: a soldier under AI
   control traversing off the map (TRAVERSE quote action, off the visible world) ignores it; else with
   `ubQuoteRecord == 0` and no autobandage: `CancelAIAction(s)`; `bNextAction = NONE` (the guard
   `bAction != END_COWER_AND_MOVE` is always true because `CancelAIAction` already cleared `bAction`);
   `DecideAlertStatus(s)`; else a quote record sets alert = GREEN, and `bNewSituation = WAS`. Otherwise (`!= IS`):
   `bNewSituation = NOT_NEW_SITUATION`.
7. `bAction == NONE` → `EndMuzzleFlash`; `RTHandleAI(s)` (`:382-404`).
8. Else **continue** (`:408-511`): if `FIRST_MOVEMENT_ACTION <= bAction <= LAST_MOVEMENT_ACTION && !fDelayedMovement`:
   - if `ubPathIndex == ubPathDataSize` (path done or empty): NPC-script destination handling when
     `sAbsoluteFinalDestination != NOWHERE` (`:451` sets `uiStatusFlags |= AI_HANDLE_EVERY_FRAME`, the wrong field:
     0x10 there is `SOLDIER_ATTACK_NOTICED`, quirk); traversal; MOVE_TO_CLIMB → CLIMB_ROOF; then **`ActionDone(s)`**
     (`:482`);
   - then: `fNoAPToFinishMove` → `SoldierTriesToContinueAlongPath`; else if the animation is `ANIM_STATIONARY` and not
     `fContinueMoveAfterStanceChange`, not `bEndDoorOpenCode`, no moving pending animation →
     `SoldierTriesToContinueAlongPath` (`:485-509`).
   - **Range:** Strac `LAST_MOVEMENT_ACTION = AI_ACTION_CHANGE_STANCE` (`AI.h:28`) includes CHANGE_FACING and
     CHANGE_STANCE. Vanilla ends at MOVE_TO_CLIMB (`V:TacticalAI/AI.h:32`). Strac widened it together with the
     `MovementMode` table ("extrapolated" rows, `AIUtils.cc:68-71`). Effect in §1.7.

`SoldierTriesToContinueAlongPath` (`Movement.cc:546-613`): new situation → `CancelAIAction`; `usActionData >= GRIDSIZE`
→ `CancelAIAction` (this is what happens right after `ActionDone`, which set it to NOWHERE: an extra cancel, which also
clears `SkipCoverCheck` and `bBypassToGreen`, `13` §1.4); `!NewOKDestination(usActionData, people)` → cancel;
affordable (RT APs are never spent, so always, inferred) → if not in progress `ExecuteAction`; then `NewDest(s, next
tile of the path)` if the estimated AP cost fits. Rare in green RT.

### 1.3 `RTHandleAI` (`TacticalAI/Realtime.cc:93-248`)

```
(:99-107 is dead here: HandleSoldierAI only calls it with bAction == NONE)
if bNextAction == NONE: bActionInProgress = false; RefreshAI(s)       // RT part = DecideAlertStatus (AIMain.cc:1228-1265)
bPathStored = false
if bNextAction != NONE:
   if END_COWER_AND_MOVE: bAction = cowering ? STOP_COWERING(ANIM_STAND) : endHeight < STAND ? CHANGE_STANCE(ANIM_STAND) : NONE
                          bNextAction = sGridNo == usNextActionData ? NONE (data NOWHERE) : WALK (data kept)
   else: bAction = bNextAction; usActionData = usNextActionData; bTargetLevel = bNextTargetLevel; clear the three (data 0)
elif sAbsoluteFinalDestination != NOWHERE: bAction = schedule ? SCHEDULE_MOVE : WALK; usActionData = it
elif !(uiFlags & ENGAGED_IN_CONV): bAction = RTDecideAction(s)
if bAction == NONE: bAction = WAIT; usActionData = civ/militia (not Kingpin) ? REALTIME_CIV_AI_DELAY
                                                 : creature && !hunting ? REALTIME_CREATURE_AI_DELAY
                                                 : REALTIME_AI_DELAY (÷3 for Kingpin men in the brothel)
elif bAction == ABSOLUTELY_NONE: bAction = NONE                        // re-think at the next visit, no wait
NPCDoesAct(s)              // RT: if bDesiredDirection != bDirection: bDesiredDirection = bDirection (AIMain.cc:876-901)
bActionInProgress = ExecuteAction(s)
```
`RTDecideAction` (`:34-63`): creatures → `CreatureDecideAction`, crows → `CrowDecideAction` (`13` §12), OUR team →
autobandage or `DecideAction`; others: NPC "done traversal" (→ WAIT 100), else `DecideAction`.

### 1.4 Delays (`TacticalAI/AIInternals.h:59-61`, `Realtime.cc:65-90`)

| Macro | Value | Example |
|---|---|---|
| `REALTIME_AI_DELAY` | `10000 + Random(1000)` | troops: 10000–10999 |
| `REALTIME_CIV_AI_DELAY` | `1000·(Team[MILITIA].bMenInSector + Team[CIV].bMenInSector) + 5000 + 2000·Random(3)` | 2 civs: 7000 / 9000 / 11000 |
| `REALTIME_CREATURE_AI_DELAY` | `10000 + 1000·Random(3)` | — |

`RealtimeDelay(s)` picks by the same classes as the WAIT conversion of §1.3 (Kingpin's men get `REALTIME_AI_DELAY`,
÷3 in the brothel). Green branches call it **at decision time** (one `Random` draw then), while the NONE→WAIT
conversion draws in `RTHandleAI`. Every `RESETTIMECOUNTER` is multiplied by `g_durations_multiplier` (1.0 by default,
`Timer_Control.cc:159-163`).

### 1.5 State fields and defaults

`bAction, usActionData` (grid, direction, stance height or ms), `bNextAction, usNextActionData, bNextTargetLevel`,
`bActionInProgress, bLastAction`, `bNewSituation` (NOT 0 / WAS 1 / IS 2, `AI.h:116-118`), `bAlertStatus,
bBypassToGreen`, `fAIFlags` (`AI_CAUTIOUS 0x08, AI_HANDLE_EVERY_FRAME 0x10, AI_ASLEEP 0x20, AI_CHECK_SCHEDULE 0x80`,
`AI.h:110-114`), `AICounter, bPathStored, sBlackList`, `bOrders, bAttitude, usPatrolGrid[10], bPatrolCnt,
bNextPatrolPnt, bDominantDir`, `sNoiseGridno, bNoiseLevel, ubNoiseVolume, bOppCnt, bUnderFire, bAIMorale`,
`sAbsoluteFinalDestination, sInitialGridNo, fDelayedMovement, ubQuoteRecord, ubQuoteActionID, uiTimeSinceLastSpoke`.

Defaults: the struct is zero-initialised, so GREEN, NONE, NOT_NEW_SITUATION; `sNoiseGridno = NOWHERE`,
`bNextPatrolPnt = 1`, `sAbsoluteFinalDestination = NOWHERE`, `bBreath = 99` (`Tactical/Soldier_Create.cc:913-955`);
`bDominantDir = bDirection = placement direction` (`:213-216`); `bActionPoints = CalcActionPoints` (`:210`; RT never
deducts, `Tactical/Points.cc:462-465`). `sInitialGridNo` and `usPatrolGrid[0]` are set to the first tile the soldier
occupies (after the sweet-spot search) (`Tactical/Soldier_Control.cc:1946-1950`). `bOrders/bAttitude` come from the
placement (§2.6).

### 1.6 `ActionDone`, `CancelAIAction`, `SetNewSituation`

```
ActionDone(s) (AIMain.cc:789-834): if bAction != NONE:
   sFinalDestination = sGridNo
   if !fNoAPToFinishMove: EVENT_StopMerc(s); AdjustNoAPToFinishMove(s, false)
   bLastAction = bAction; bAction = NONE; usActionData = NOWHERE; bActionInProgress = false
   fDelayedMovement = false; bPathStored = false
CancelAIAction(s) (:920-938): SkipCoverCheck = false; if bNewSituation == IS: bNewSituation = WAS
   bBypassToGreen = 0; ActionDone(s)                                     // bNextAction is NOT cleared
SetNewSituation(s) (:1989-2010): if team != OUR && ubQuoteRecord == 0 && !autobandage && !(bNeutral && ENGAGED_IN_CONV):
   bNewSituation = IS; if !INCOMBAT: AICounter = now + Random(1000)      // cuts any wait short
```
`EVENT_StopMerc` (`Soldier_Control.cc:7372-7421`, `07` §4.6) snaps to the tile centre, clears the path and re-sets
`bDirection` to itself; it does **not** touch `bDesiredDirection`.

### 1.7 `ExecuteAction` for the green actions (`AIMain.cc:1305-1828`)

- **NONE** → `true`.
- **WAIT** → `AICounter = now + usActionData`; `ActionDone`; `true` (`:1330-1341`). `bActionInProgress` stays true while
  `bAction == NONE` until the next `RTHandleAI` clears it (harmless, but `DecideAlertStatus`'s YELLOW→GREEN test reads it
  when called from the new-situation path).
- **CHANGE_FACING** → `SendSoldierSetDesiredDirectionEvent(usActionData)` (`:1343-1366`): a game event, applied after the
  overhead pass (`GameScreen.cc:427, 456`; `Utils/Event_Pump.cc:195-214`) by `EVENT_SetSoldierDesiredDirection`
  (`Soldier_Control.cc:3833-3941`: `bTurningIncrement = QuickestDirection`, no AP in RT). One octant per frame of the
  STANDING animation (`2·bBreath + 100 − bLife` ms, ≥ 40; troops with breath 99 and life 40–55 ≈ 243–258 ms; enemies
  never fast-turn, `06` §5.4). Each stationary octant does `HandleSight(LOOK|RADIO)` + `HandleSystemNewAISituation` on the
  next frame (`:4229-4240, 4466-4470`). When `bDirection == bDesiredDirection`, `FreeUpNPCFromTurning` → `ActionDone`
  (`:4332`; `AIMain.cc:742-751`).
  **Strac truncation (inferred from the code path):** CHANGE_FACING is inside the Strac movement range and its path is
  empty, so the next visit (+110 ms) calls `ActionDone`; the visit after (+220 ms) starts the queued WAIT, and
  `NPCDoesAct` sets `bDesiredDirection = bDirection`. A random green turn therefore gets ≈ 220 ms: usually one octant,
  sometimes none (frame ≈ 250 ms). In vanilla the action lasts until the turn completes. ja2-node follows Strac;
  `LAST_MOVEMENT_ACTION` is a named constant, so the vanilla variant is a one-line switch.
- **Movement** (RANDOM_PATROL, SEEK_FRIEND, POINT_PATROL, LEAVE_WATER_GAS, WALK, APPROACH_MERC, SCHEDULE_MOVE…;
  `:1392-1559`):
  ```
  [TB-only loop detector :1427-1449, 13]
  if !bPathStored:
     flags = (sAbsoluteFinalDestination != NOWHERE || autobandage) && !INCOMBAT ? PATH_THROUGH_PEOPLE : 0
     if LegalNPCDestination(s, usActionData, ENSURE_PATH, WATEROK, flags): bPathStored = true
     if still none: scripted NPC move → retries / WAIT REALTIME_AI_DELAY; else CancelAIAction; return false
  traversal path extension (map-edge escape, 13)
  NewDest(s, usActionData)                                        // §3
  if sFinalDestination != usActionData: sBlackList = usActionData; CancelAIAction; return false
  sBlackList = NOWHERE; return true
  ```
  Green deciders always leave `bPathStored = true` with the route in `ubPathingData` (§2.4), so no new search happens
  here and the destination is not re-validated (inferred).
- **CHANGE_STANCE** (`:1689-1700`): already at `usActionData` height → `ActionDone`, `false`; else
  `ChangeSoldierStance`; finished by `FreeUpNPCFromStanceChange` (`:755-768`). Also inside the Strac movement range →
  ended at the next visit like CHANGE_FACING (the stance animation itself continues) (inferred).
- **STOP_COWERING** (`:1717-1729`): cowering → `usActionData = ANIM_STAND; SetSoldierCowerState(false)`; else
  `ActionDone`, `false`.
- **default** → `false`.

### 1.8 When the AI decides again

| Decision | Timeline (t0 = deciding visit; visits on 55 ms ticks) |
|---|---|
| NONE | WAIT d (§1.4) armed at t0 → next decision at the first tick ≥ t0 + d |
| RANDOM_PATROL / POINT_PATROL / LEAVE_WATER_GAS | walk (`07` §4); visits during the walk do nothing; arrival stops him (`Overhead.cc:745-908`, path index = size = 0) → next visit: `ActionDone` → next visit (+110): queued WAIT d → decide after d |
| SEEK_FRIEND, enemy | same, but **no WAIT is queued** → decides again one visit after `ActionDone` |
| SEEK_FRIEND, civ/militia | queued WAIT `REALTIME_CIV_AI_DELAY` |
| CHANGE_FACING | `ActionDone` at t0+110, WAIT d starts at t0+220 |
| new situation | wait cut to `Random(1000)`; next visit cancels the current action (a walker stops at his tile centre) and re-decides |

---

## 2. Decision

### 2.1 `DecideAction` (`TacticalAI/DecideAction.cc:3641-3718`)

Clear `AI_CAUTIOUS`. If `bBypassToGreen && bAlertStatus < BLACK` → `DecideActionGreen`, then (RT) `bBypassToGreen = 0`.
Else by `bAlertStatus`: GREEN → `DecideActionGreen`, YELLOW → `DecideActionYellow`, RED → `DecideActionRed(TRUE)`,
BLACK → `DecideActionBlack` (`13` §3, `13` §5, `13` §6).

### 2.2 `DecideAlertStatus` (`:3721-3866`)

```
if SOLDIER_MONSTER: CreatureDecideAlertStatus; return                  // creatures: 13
old = bAlertStatus
if bOppCnt > 0: BLACK; CheckForChangingOrders(s)
else switch old:
  BLACK → RED
  RED → RED (never drops)
  YELLOW: if !CIV && (Team[team].bAwareOfOpposition || bUnderFire): RED
          elif MostImportantNoiseHeard == NOWHERE && !bActionInProgress: GREEN; CheckForChangingOrders(s)
  GREEN:  if !CIV && (bAwareOfOpposition || bUnderFire): RED
          elif MostImportantNoiseHeard != NOWHERE: YELLOW
if not boxing:
  if changed: if old < RED || new < RED: SetNewSituation(s)          // Random(1000)
              if old < RED && new >= RED: CheckForChangingOrders(s)
  elif (GREEN && bBreath < 75) || (YELLOW && bBreath < 50), not in water:
      SetNewSituation(s); if YELLOW && no noise: GREEN; CheckForChangingOrders(s)
```
`CheckForChangingOrders` (`AIMain.cc:1831-1897`): GREEN (non-creature): neutral CIV with profile and
`sPreCombatGridNo != NOWHERE` (not Queen's group) → `bNextAction = END_COWER_AND_MOVE` to it, then `sPreCombatGridNo =
NOWHERE`; cowering → STOP_COWERING; else `bNextAction = CHANGE_STANCE(ANIM_STAND)`. YELLOW: nothing. RED/BLACK:
ONGUARD→CLOSEPATROL, CLOSEPATROL→FARPATROL (`bOrders++`), militia → SEEKENEMY, creatures → SEEKENEMY (unless
STATIONARY/ONCALL), Warden → `MakeClosestEnemyChosenOne`. The queued next action is usually zapped by the
new-situation path of §1.2 step 6 on the following visit.

### 2.3 `DecideActionGreen` (`:641-1072`), every branch in order

0. `fCivilian = CIV team && (NON_CIV_GROUP || bNeutral || FATCIV <= body <= CRIPPLECIV)`; `fCivOrMilitia`;
   `gubNPCPathCount = 0` (`:646-655`). `FindBestPath` increments `gubNPCPathCount` on every call that passes its early
   exits (`Tactical/PathAI.cc:659`).
1. Boxing (`:657-723`, `25` §3). Tank → NONE (`:725`).
2. `bInWater = Water(grid)`, `bInGas = InGasOrSmoke(s, grid)` (`:731-734`).
3. **Civilians** (`:739-792`): cowering → `usActionData = ANIM_STAND`, STOP_COWERING. RT only: `AI_CHECK_SCHEDULE` →
   `DecideActionSchedule` (`35` §3); profile → `DecideActionNamedNPC` (§5), non-NONE result returned;
   `uiTimeSinceLastSpoke && now < uiTimeSinceLastSpoke + 60000` → NONE, else clear it. Then
   `!bInWater && PreRandom(5) != 0` → **NONE (80%)** (`PreRandom` only drawn when not in water).
4. **POINTPATROL** and `bBreath >= 75` (`:800-817`): `PointPatrolAI` true → `bNextAction = WAIT, usNextActionData =
   RealtimeDelay` (RT) → POINT_PATROL; false → `gubNPCPathCount = 0`.
5. **RNDPTPATROL** and `bBreath >= 75` (`:819-837`): same with `RandomPointPatrolAI`.
6. **Water / gas** (`:844-851`): `FindNearestUngassedLand` (`13` §8.4) != NOWHERE → LEAVE_WATER_GAS (no wait queued).
7. **Rest**: `bBreath < 75 && !bInWater` → NONE, `usActionData = NOWHERE` (`:859-865`).
8. **Random patrol** (`:872-945`), only if `gubNPCPathCount == 0`:
   `iChance = 25 + bBypassToGreen`; orders: STATIONARY −20, ONGUARD −15, ONCALL 0, CLOSEPATROL +15, POINT/RNDPT
   **= 0** (assignment, drops the bypass), FARPATROL +25, SEEKENEMY −10; attitude: DEFENSIVE −10, BRAVESOLO +5,
   BRAVEAID 0, CUNNINGSOLO +5, CUNNINGAID 0, AGGRESSIVE +10, ATTACKSLAYONLY +10; `− (bLifeMax − bLife) − (100 −
   bBreath)`. If `bInWater || (INT16)PreRandom(100) < iChance`: `dest = RandDestWithinRange(s)`; if != NOWHERE:
   `dest = GoAsFarAsPossibleTowards(s, dest, RANDOM_PATROL)`; if != NOWHERE: (RT) `bNextAction = WAIT,
   usNextActionData = RealtimeDelay(s)`, `usActionData = dest` → **RANDOM_PATROL**.
9. **Seek friend** (`:947-1004`), only if `gubNPCPathCount == 0` — any path search in step 8 suppresses it:
   `iChance = 25 + bBypassToGreen`; orders: STATIONARY −20, ONGUARD −15, ONCALL 0, CLOSEPATROL +10, POINT/RNDPT **= −10**,
   FARPATROL +20, SEEKENEMY −10; attitude: BRAVESOLO `/2`, CUNNINGSOLO `/2` (C truncation), BRAVEAID +10, CUNNINGAID +10,
   others 0; `− injury − (100 − bBreath)`. If `PreRandom(100) < iChance && RandomFriendWithin(s) &&
   GoAsFarAsPossibleTowards(s, usActionData, SEEK_FRIEND) == usActionData` (only a full-length approach counts):
   civ/militia (RT) → `bNextAction = WAIT, usNextActionData = REALTIME_CIV_AI_DELAY` → **SEEK_FRIEND**. A partial result
   still leaves `GoAsFar`'s side effects (`sFinalDestination`, `ubPathDataSize`, mode) until the next `ActionDone`.
10. **Look around** (`:1010-1061`), only if `!gfTurnBasedAI || GetAPsToLook <= bActionPoints` and `bLastAction !=
    CHANGE_FACING` (in RT `bLastAction` is normally WAIT here, so the guard rarely fires, inferred): `iChance = 25 +
    bBypassToGreen + (STATIONARY ? 25) + (ONGUARD ? 20) + (DEFENSIVE ? 25)`. If `PreRandom(100) < iChance`:
    ```
    do { if 0 <= bDominantDir <= 8 && bDirection != bDominantDir && PreRandom(2): dir = bDominantDir   // 8 is accepted (quirk)
         else dir = PreRandom(8) } while (dir == bDirection)
    ```
    If `InternalIsValidStance(s, dir, endHeight)` (`Soldier_Control.cc:7606`; true for a standing single-tile soldier,
    inferred): (RT) `bNextAction = WAIT, usNextActionData = RealtimeDelay(s)` → **CHANGE_FACING** (`usActionData = dir`).
11. **NONE**, `usActionData = NOWHERE` (`:1070`).

There is no roof climbing, stance change or item pickup in green; climbing (`AI_ACTION_MOVE_TO_CLIMB` /
`AI_ACTION_CLIMB_ROOF`, `BeginSoldierClimbUpRoof`) belongs to yellow and above.

### 2.4 Helpers

**`RoamingRange(s, &origin)`** (`TacticalAI/AIUtils.cc:1945-2011`). Origin: creatures at BLACK → current grid, range 160;
POINT/RNDPT → `usPatrolGrid[bNextPatrolPnt]`; SEEKENEMY → current grid; else `usPatrolGrid[0]`.

| Orders | Range (Chebyshev `SpacesAway` from origin) |
|---|---|
| STATIONARY | 0 if profiled, or alert < BLACK and not under fire; else 5 |
| ONGUARD / CLOSEPATROL | 5 / 15 |
| POINT / RNDPT | 10 (around the next patrol point) |
| FARPATROL | 25 below RED, 50 otherwise |
| ONCALL | 10 below RED, 30 otherwise |
| SEEKENEMY | `MAX_ROAMING_RANGE` = 160 (`AIInternals.h:55`) |

**`RandDestWithinRange(s)`** (`:641-774`): RT makes **one** try (TB 10). `room = GetRoom(usPatrolGrid[0])` if orders
≤ CLOSEPATROL and (CIV or profiled). If `range < 159`: `origX/Y` from origin; `maxLeft = min(range, origX)`,
`maxRight = min(range, 159 − origX)`, `maxUp = min(range, origY)`, `maxDown = min(range, 159 − origY)`;
`dest = origin + (Random(maxLeft+maxRight+1) − maxLeft) + 160·(Random(maxUp+maxDown+1) − maxUp)` (two `Random` draws,
x first; `Random(1)` must still consume a draw for call parity, inferred). Else `dest = PreRandom(GRIDSIZE)` (the whole
map). Room filter: reject if `GetRoom(dest)` is a **different room** (outdoor `NO_ROOM` tiles pass). Then
`LegalNPCDestination(dest, ENSURE_PATH, NOWATER, 0)`; success sets `bPathStored`. Larvae: ±1 tile variant.

**`InternalGoAsFarAsPossibleTowards(s, des, reserve=-1, action, flags=0)`** (`TacticalAI/Movement.cc:281-539`; TB AP
reserve and flags: `13` §1.7):
```
range = RoamingRange(s, &origin)
roomRequired = orders <= CLOSEPATROL && (CIV || profiled) && sAbsoluteFinalDestination != NOWHERE ? GetRoom(usPatrolGrid[0]) : NO_ROOM
usUIMovementMode = DetermineMovementMode(s, action)              // before the early exits (RNG for kids, §3)
if des == sGridNo || Water(des): return NOWHERE
if !LegalNPCDestination(des, ENSURE_PATH, NOWATER, creature ? PATH_CLOSE_GOOD_ENOUGH : 0):
   creature: return NOWHERE
   shuffle [0..7] with the main engine (std::shuffle); first d with NewGridNo(des, d) in bounds and
   LegalNPCDestination(…, ENSURE_PATH, NOWATER, 0) becomes des; none → NOWHERE
go = sGridNo
for i in 0 .. ubPathDataSize − ubPathIndex − 1:                  // stored route, at most 30 steps (MAX_PATH_LIST_SIZE)
   t = NewGridNo(go, DirectionInc(ubPathingData[i])); if t == go: break
   if SpacesAway(origin, t) > range: break
   if roomRequired != NO_ROOM && GetRoom(t) != roomRequired: break
   if (flags & STOPSHORT) && SpacesAway(des, t) <= 5: break
   if !LegalNPCDestination(t, IGNORE_PATH, WATEROK, 0): break     // occupied, gas, blacklisted, own tile…
   [TB AP reserve checks]
   go = t
if go == sGridNo: return NOWHERE
if go == des: bPathStored = true; sFinalDestination = go
elif ubPathIndex == 0: bPathStored = true; sFinalDestination = go; ubPathDataSize = i + 1    // one step too many (quirk,
return go                                                                                     // harmless: he stops at sFinalDestination)
```
- A green leg is therefore at most 30 tiles, even for SEEKENEMY's map-wide destinations (inferred from the loop bound).
- **Strac vs vanilla:** vanilla applies the room limit only when `sAbsoluteFinalDestination == NOWHERE`
  (`V:TacticalAI/Movement.c:393-400`); Strac's condition is inverted, so ordinary green wandering is not room-limited
  here (only by `RandDestWithinRange`'s filter). Vanilla also picks the fallback neighbour with a `Random(8)` loop and
  `DirectionInc(dir + 1)` (`V:Movement.c:465-490`). ja2-node follows Strac and replaces `std::shuffle` by a
  Fisher–Yates shuffle on the main stream (deviations "GoAsFar fallback").

**`RandomFriendWithin(s)`** (`AIUtils.cc:552-638`): range/origin as above; origin ≥ GRIDSIZE → false. Friends (in
`MercSlots` order): every other soldier with `candidate.bNeutral ? s.bNeutral : s.bSide == candidate.bSide` and
`SpacesAway > 1`. Because the CIV team's side is ENEMY (`Tactical/Overhead.cc:219-224`), **neutral civilians count
non-neutral enemies as friends**, but not vice versa. Loop while friends remain: `idx = PreRandom(count)`; if
`SpacesAway(origin, friend) − 1 <= range`: up to 8 directions, each picked by `do Random(8) while checked`;
`dest = NewGridNo(friend, DirectionInc(dir + 1))` (`dir 7 → DirectionInc(8) → NE`, so NE is tried twice and N never:
quirk, `Isometric_Utils.cc:307-315`); skip out-of-bounds; accept if `SpacesAway(origin, dest) <= range &&
LegalNPCDestination(dest, ENSURE_PATH, NOWATER, 0)` → `usActionData = dest, bPathStored = true`, true. Remove the friend
(`friends[idx] = friends[--count]`). Vanilla's removal indexes by soldier ID (memory bug); Strac's is correct.

**`LegalNPCDestination(s, g, mode, waterOK, flags)`** (`Movement.cc:24-94`): `g` outside `[0, GRIDSIZE)` → false;
different `sHeight` from the soldier's tile → false; `NewOKDestination(s, g, skipMercs = TB && mode != IGNORE_PATH &&
adjacent, bLevel)` and not in gas and `g != sGridNo` and `g != sBlackList`; `!waterOK && Water(g)` → false; then
IGNORE_PATH → true; ENSURE_PATH → `FindBestPath(s, g, bLevel, WALKING, COPYROUTE, flags) != 0` (mode hard-coded);
ENSURE_PATH_COST → `PlotPath`.

**Patrol points** (`Movement.cc:128-277`). `NextPatrolPoint`: `bPatrolCnt` outside `[1, 9]` → NOWHERE;
`bNextPatrolPnt++`, past `bPatrolCnt` → 1 (slot 0 is the home grid); return `usPatrolGrid[bNextPatrolPnt]`.
`PointPatrolAI`: `p = usPatrolGrid[bNextPatrolPnt]`; if at it or `bNextPatrolPnt == 0`: advance while `p != NOWHERE &&
NewOKDestination(p, IGNOREPEOPLE) < 1`; back at own grid → NOWHERE. NOWHERE → `bOrders = FARPATROL`, false. Reachable
(`LegalNPCDestination ENSURE_PATH`) → `usActionData = p`, true; else temporarily ONCALL, `GoAsFar(p, bAction)`, restore;
NOWHERE → false. `RandomPointPatrolAI`: same, but the next point is `usPatrolGrid[PreRandom(bPatrolCnt) + 1]`, repeated
while it equals the own grid or (counter < cnt and invalid); if the counter reached `bPatrolCnt`, reset
`bNextPatrolPnt = 0` and search linearly; at own grid → false (no order change); temporary orders SEEKENEMY.

### 2.5 RNG call order of one green decision (enemy; nothing is drawn in `HandleSoldierAI` itself)

1. `DecideAlertStatus` (via `RefreshAI`): `Random(1000)` only if it calls `SetNewSituation`.
2. Random patrol: `PreRandom(100)`; on success `RandDestWithinRange` (`Random(xRange)`, `Random(yRange)` or
   `PreRandom(25600)`); `GoAsFar` (kids: `Random(10)`; fallback shuffle only if the destination itself is illegal, which
   cannot happen after `RandDestWithinRange`); on success `RealtimeDelay` (`Random(1000)` / `Random(3)`).
3. Seek friend (if no path search happened): `PreRandom(100)`; `PreRandom(count)` per friend tried, `Random(8)` per
   direction draw (rejection loop); `GoAsFar` (kids `Random(10)`); civ/militia `Random(3)`.
4. Look: `PreRandom(100)`; per loop iteration `PreRandom(2)` (only when the dominant test reaches it) and/or
   `PreRandom(8)`; `RealtimeDelay`.
5. NONE → `RTHandleAI` draws the WAIT (`Random(1000)` / `Random(3)` / creature).
6. Execution of a move: `NewDest` → `DetermineMovementMode` again (kids `Random(10)`); each tile step then draws the
   footstep `PreRandom(2)` for army soldiers (`08` §3.2).

### 2.6 Orders and attitude sources

Basic placements copy `bOrders, bAttitude, bDirection` (`Soldier_Create.cc:1216-1218`); profiled detailed placements
copy them from the basic placement and return early (`:1480-1491`); `RandomizeNewSoldierStats` (random attitude,
FARPATROL) is only used by debug creation (`:99-119, 1950`).

Edge case of the §2.3 formulas: a profiled STATIONARY / DEFENSIVE civilian (unhurt, breath 99) has range 0, a patrol
chance of −6 (`PreRandom(100)` is still drawn and never succeeds) and a seek-friend chance of 4 that `RandomFriendWithin`
cannot use with range 0, so after the 1-in-5 civilian gate he only turns (look chance 75): he **never walks in green**.

---

## 3. Movement modes, path calls, blocking

- **`DetermineMovementMode(s, action)`** (`AIUtils.cc:314-353`), first match: `fUIMovementFast` → RUNNING; creature →
  GREEN ? WALKING : RUNNING; cow/crow → WALKING; `AI_CAUTIOUS` and table says RUNNING → WALKING; SEEK_NOISE by a
  non-merc-body civilian → WALKING; `(HATKIDCIV || KIDCIV) && GREEN && Random(10) == 0` → **KID_SKIPPING**;
  else `MovementMode[action][Urgency[alert][bAIMorale]]` (`:36-72`). `Urgency[GREEN][*]` is all LOW, and the LOW column
  is WALKING for every green action (RUNNING only for TAKE_COVER, ESCORTED_MOVE, KNIFE_MOVE, TRACK, EAT, RUN). **Green
  AI always walks** (kids skip 10% of the time; NPC scripts may set `fUIMovementFast`).
- **`NewDest(s, grid)`** (`:356-435`): the TAKE_COVER swat logic and the ENEMY-at-RED `PreRandom(5 − difficulty)`
  swat roll (`13` §1.7) do not apply in green; `usUIMovementMode = DetermineMovementMode(s, bAction)`; SWATTING on a
  non-merc body → WALKING; `EVENT_InternalGetNewSoldierPath(s, grid, mode, fromUI = 0, force = fNoAPToFinishMove)` —
  with `bPathStored` it reuses the stored route, then starts the walk (`07` §4.1; the AI never takes the re-path branch).
- **Path searches in green**: `FindBestPath(s, dest, bLevel, WALKING, COPYROUTE, 0)` via `LegalNPCDestination`.
  `gubNPCDistLimit` and `gubNPCAPBudget` stay 0 (they are only set by `FindLocations.cc`, `Map_Edgepoints.cc` and
  `PathAI.cc:1857`; `Movement.cc:343` is commented out). `PATH_THROUGH_PEOPLE` only for scripted NPC moves,
  `PATH_CLOSE_GOOD_ENOUGH` only for creatures. The person at the destination is no obstacle for AI paths
  (`fConsiderPersonAtDestAsObstacle` is player-only, `Tactical/PathAI.cc:638`), but `NewOKDestination` already rejects
  occupied destinations.
- **Doors:** AI soldiers path through closed, unlocked doors (or locked ones with `bHasKeys`) (`07` §3.4). At the door
  `HandleGotoNewGridNo` opens it and sets `bEndDoorOpenCode = 1` (`Overhead.cc:1331-1384`); at the end of the open-door
  animation opcode 499 sets it to 2 and re-paths to `sFinalDestination` (`Soldier_Ani.cc:1837-1860`); entering the next
  tile closes the door behind him (`Soldier_Control.cc:1933-1937`). Opening runs opcode 495 (door noise, look for all,
  `HandleSystemNewAISituation`, `01` §3.5). Wandering troops do this.
- **Blocked**: `HandleNextTile` / `TileIsClear` / `HandleNextTileWaiting` (`07` §4.5), including the AI-only
  repath-or-swap with a mutually blocked soldier and the forced swap at waiting value 3. While `fDelayedMovement` is set
  the continue branch of §1.2 is skipped, so the action stays in progress until the waiting logic re-paths or gives up
  (`SetFinalTile` → stop); the next visit then calls `ActionDone`. `NewDest` failure blacklists the target
  (`sBlackList`) until the next successful move. A path that cannot even start makes `RandDestWithinRange`/`GoAsFar`
  return NOWHERE, and the decision falls through.

---

## 4. Leaving green

### 4.1 Who calls `SetNewSituation` (sight/noise side in `08`)

`ManSeesMan` for a hostile pair on a new or moved opponent, or during RANDOM_PATROL / SEEK_FRIEND / POINT_PATROL /
LEAVE_WATER_GAS / SEEK_OPPONENT / SEEK_NOISE (`Tactical/OppList.cc:1800-1832`); `HearNoise` whenever the maker stays
unseen (`:4025-4064`); `DecideAlertStatus` on a status change or low breath; assassin case (`:1595-1615`);
`CallAvailableTeamEnemiesTo` (`TacticalAI/Knowledge.cc:28-46`).

### 4.2 GREEN → YELLOW

Only through `DecideAlertStatus` when `MostImportantNoiseHeard` (`Knowledge.cc:125-299`, full description `13` §2.1)
is not NOWHERE. It returns the best (closest to zero) of: personal HEARD entries `bOppList[x] < 0` of **hostile**
soldiers (value × `SpacesAway` to the last known grid); public HEARD entries likewise; the personal misc noise
`sNoiseGridno` (`(ubNoiseVolume/2 − 6) × distance`) — **not filtered by hostility** — unless it is on the same level
within 6 tiles and in line of sight, which wipes it; the team's public misc noise (non-CIV teams and Kingpin's men only).

Consequence (frequency inferred): `ProcessNoise`/`HearNoise` have no neutrality filter (`OppList.cc:3428-3770,
3895-4080`), only "listener already sees the maker" and a few team exceptions. A civilian who hears an unseen army
soldier walk (footstep 8–9, heard ≈ 9 tiles outdoors, ≈ 4 through a floor/outdoor boundary, `08` §3.4) stores
`sNoiseGridno` and goes **YELLOW without the player being involved**; troops hearing a walking civilian likewise.
SEEKENEMY troops roam the whole map, so this happens wherever they share a map with civilians. The noise is forgotten after
`ubNoiseVolume` real-time turns (one per 5 s, `08` §2.6) or when seen up close. Radio (AI_ACTION_YELLOW_ALERT /
RED_ALERT, `AIMain.cc:1659-1679`) copies a louder personal noise into the team's public noise (`08` §2.5); it is only
chosen at YELLOW or above. `ManChecksOnFriends` (a friend at YELLOW/RED seen nearby) runs **only in turn-based**
(`AIMain.cc:1243-1263, 1937-1986`, `13` §1.5).

### 4.3 → RED and → BLACK

- BLACK: `AddOneOpponent` on the first hostile sighting sets BLACK at once (`OppList.cc:2017-2052`); `DecideAlertStatus`
  keeps BLACK while `bOppCnt > 0`; losing all opponents drops to RED (`:2055-2067`).
- RED: team `bAwareOfOpposition` (set by `HandleInitialRedAlert` when an AI executes RED_ALERT, `AIMain.cc:1899-1934`) or
  `bUnderFire` (non-civilians); unseen gunfire/bullet impact with volume ≥ 3 (`OppList.cc:4029-4036`), explosion or
  silent alarm with volume ≥ 3 (`:4145-4155`), a seen grenade/impact spot (`:4187-4197`); a neutral who *sees* gunfire
  with volume ≥ 3 (`:4008-4021`).
- A hostile sighting in real time also feeds the best-sighting list, which enters turn-based combat (`08` §2.9,
  `10` §1.2).

### 4.4 `HandleSystemNewAISituation`, halts, `NewDest`

- `HandleSystemNewAISituation` (`Soldier_Control.cc:8774-8817`) acts only if `ubCurrentTeam != OUR_TEAM` and
  `bNewSituation == IS`: clears pending animation/direction/action and `bEndDoorOpenCode`; for soldiers under AI control
  cancels turn-to-shoot and throws. In real time `ubCurrentTeam` is OUR_TEAM (initial value; reset by
  `StartPlayerTeamTurn`/`BeginTeamTurn`, `Tactical/TeamTurns.cc:89, 274, 306`), so it is a **no-op in RT** (inferred).
- Movement is stopped by `HandleSight`: it saves and clears `bNewSituation`, runs the looks, and if any look set a new
  situation on a non-PC calls `HaultSoldierFromSighting` → `EVENT_StopMerc` outside combat (`OppList.cc:664-697`;
  `Soldier_Control.cc:7271-7320`). A noise only marks the new situation; the stop happens at the next visit
  (`CancelAIAction` → `ActionDone` → `EVENT_StopMerc`), i.e. within `Random(1000)` ms.
- Status change on the same visit: the new-situation path calls `DecideAlertStatus`, which may `SetNewSituation`
  again, so the action chosen right after a GREEN→YELLOW change is usually cancelled at the next visit and re-decided
  (ported literally).

### 4.5 The YELLOW decision (`DecideAction.cc:1075-1446`)

Owned by `13` §3. In short: civilians stop cowering, profiled ones try `DecideActionNamedNPC`; no noise → NONE; then
turn to the noise, radio, seek the noise, seek a friend who radioed, and **50%: `bBypassToGreen = 15` and
`DecideActionGreen`**. For profiled civilians other than Eldin (Fatima, Pacos) this reduces to: turn toward the noise
(75%), else 50% green behaviour, else NONE.

---

## 5. Civilians

- **Green civilians** take the civilian prelude of §2.3 step 3 (80% NONE), then the same branches as soldiers, with civ
  waits (§1.4). Cowering is chosen only at RED/BLACK (`DecideAction.cc:1602-1613, 1704-1715, 2710-2712`: cower in battle,
  or cower + WAIT `REALTIME_CIV_AI_DELAY` when no enemy is in the sector; `13` §9.1); a green civilian who is still
  cowering stops.
- **Profiled NPCs**: `DecideActionNamedNPC` (`:553-638`): a pending quote record with
  `QUOTE_ACTION_ID_TURNTOWARDSPLAYER` → face the closest PC / trigger when within `2 × NPC_TALK_RADIUS` (8), returning
  ABSOLUTELY_NONE; otherwise `NPCConsiderInitiatingConv` (`TacticalAI/NPC.cc:1960-2006`: a friendly merc this NPC
  currently sees, with an initiating quote) → APPROACH_MERC; assassins (Jim, Jack, Olaf, Ray, Olga, Tyrone) stalk the
  closest PC (`24`). After a conversation they idle for 60 s (`uiTimeSinceLastSpoke`). Then generic civilian logic;
  with STATIONARY orders (range 0, §2.6) **they stay at their spots and only turn**.
- Quirk: Prof.dat gives some placed NPCs (Fatima, Pacos) `sPreCombatGridNo = 0`, not NOWHERE. After a YELLOW→GREEN drop
  `CheckForChangingOrders` queues END_COWER_AND_MOVE to grid 0; it becomes a WAIT and is zapped by the pending new
  situation, then `sPreCombatGridNo = NOWHERE` (inferred; harmless). `sPreCombatGridNo` is set when combat starts
  (`10` §1.4).
- **Schedules**: `DecideActionSchedule` (`:58-516`) and the away slots: `35` §3. `SCHEDULE_ACTION_STAYINSECTOR` (8) has
  no runtime handler (only `Editor/EditorMercs.cc`), so a map schedule made only of STAYINSECTOR entries never sets
  `AI_CHECK_SCHEDULE` (`Strategic/Scheduling.cc:237`; inferred from data + code).

---

## 6. Quirks to keep

- 55 ms AI tick; every AI slot visited per tick; per-soldier 100 ms gate → 110 ms visits; first tick starts at slot 1.
- CHANGE_FACING/CHANGE_STANCE inside the Strac movement range (turn cut after ≈ 220 ms); vanilla differs.
- `NPCDoesAct` cancels any turn in progress whenever the next action starts.
- Enemies queue no WAIT after SEEK_FRIEND; ABSOLUTELY_NONE re-thinks at the next visit.
- `RandomFriendWithin` never tries N and tries NE twice; civilians count enemies as friends.
- Seek friend is skipped whenever the random-patrol branch made a path search.
- POINT/RNDPT patrol resets the random-patrol chance to 0 and seek-friend to −10 (the bypass bonus is lost).
- `bDominantDir <= 8` accepted; `GoAsFar` sets `ubPathDataSize` one too large; misc noise not filtered by hostility.
- Strac's inverted room condition in `GoAsFar`.
- `AI_HANDLE_EVERY_FRAME` written into `uiStatusFlags` at `AIMain.cc:451` (NPC scripts only): ja2-node sets
  `attackNoticed` there (`markAttackNoticedByMisplacedEveryFrameFlag`).

---

## 7. Implementation in ja2-node

### 7.1 State

- `Soldier.ai: AiState` (`src/sim/tactical/soldier.ts`) holds the AI fields of §1.5 in camelCase without the type
  prefix (`counter` = `AICounter` as an absolute game-ms deadline, `morale` = `bAIMorale`, `patrolCount` =
  `bPatrolCnt`); the `fAIFlags` bits are booleans `cautious`, `handleEveryFrame`, `asleep`, `checkSchedule`. The
  soldier itself carries `pathStored`, `delayedMovement`, `absoluteFinalDestination`, `initialGridNo`, `quoteRecord`,
  `quoteActionId`, `timeSinceLastSpoke`, `underAiControl` (`SOLDIER_PCUNDERAICONTROL`) and `aiTurnControl`
  (`SOLDIER_UNDERAICONTROL`, `10`). `patrolGrid[0]` and `initialGridNo` are set on the first `setSoldierGridNo`
  (`movement.ts`).
- `TacticalState.aiPass: AiPassState` (`state.ts`): `lastTickMs` (`guiRTAILastUpdateTime`), `cursor` (starts 0),
  `awayCursor`, `handleThisPass`, `paused`. `TurnState.pauseAllAi` / `pauseAllAiSinceMs` are `gfPauseAllAI` and its
  timer (`ai/pause.ts`, `PAUSE_ALL_AI_DELAY_MS` 1500).
- `gubNPCPathCount` is `pathEnv.stats.searches` (incremented by `findBestPath` after its early exits, wraps at 256).
- Constants in `ai/actions.ts`: `AiAction`, `FIRST_MOVEMENT_ACTION`, `LAST_MOVEMENT_ACTION` (= `CHANGE_STANCE`),
  `Situation`, `AI_DELAY` 100, `RT_DELAY_BETWEEN_AI_HANDLING` 50, `MAX_ROAMING_RANGE` 160,
  `NEW_SITUATION_DELAY_RANGE` 1000, `URGENCY`, `MOVEMENT_MODE`. The delay constants of §1.4 are in `ai/decide.ts`.
- RNG: `t.rng` is `Random`, `t.pre` is `PreRandom`. Waits and `uiTimeSinceLastSpoke` run on game time (deviations
  "Frame timers").

### 7.2 Modules (`src/sim/tactical/ai/`)

| Module | Contents |
|---|---|
| `control.ts` | `handleSoldierAI` (§1.2, both paths), `rtHandleAI` (§1.3), `executeAction`, `actionDone`, `cancelAIAction`, `npcDoesAct`, the `FreeUpNPCFrom*` hooks, `triesToContinueAlongPath`, `newDest`, the pass scheduler `beginAiPass` / `aiForSlot` / `awayAiForPass` with `nextAIToHandle` (§1.1); `createAiControl` binds the deciders |
| `decide.ts` | `decideAction`, `decideAlertStatus`, `checkForChangingOrders`, `setNewSituation`, `decideActionGreen` (§2.3), `realtimeDelay` and the delays, `determineMovementMode` |
| `destinations.ts` | `roamingRange`, `randDestWithinRange`, `internalGoAsFarAsPossibleTowards` (with the Fisher–Yates fallback), `randomFriendWithin`, `legalNPCDestination`, `nextPatrolPoint`, `pointPatrolAI`, `randomPointPatrolAI` |
| `pause.ts`, `system-situation.ts` | `gfPauseAllAI` (§1.1); `handleSystemNewAISituation` (§4.4) |
| `decide-named-npc.ts`, `decide-schedule.ts`, `decide-boxing.ts` | §5 and `24`, `35` §3, `25` §3 |
| `combat-decide.ts`, `creature-decide.ts`, `turn-based.ts` | YELLOW/RED/BLACK, creatures and crows, the turn-based driver (`13`) |

`MostImportantNoiseHeard` is `perception/knowledge.ts`. Doors opened by walking AI soldiers are `doors/` (`07`).

### 7.3 Wiring

`TacticalSim` (`src/sim/tactical/tactical-sim.ts`) creates the `AiControl` with the real `mostImportantNoiseHeard` and
`awareOfOpposition` and installs the overhead hooks: `beforePass` ends a timed AI pause (`endTimedAiPause`), runs the
real-time turn and the enemy-sighting pause, then `beginAiPass`; `executeOverhead` (`overhead.ts`) calls `aiForSlot`
for each `mercSlots` entry right after its frame step; `afterPass` runs `awayAiForPass` and then drains the game-event
queue (where the CHANGE_FACING desired-direction event lands). Turning, stance changes, roof climbs and pending actions
reach the AI through `TacticalHooks` (`turnFinished` → `freeUpFromTurning`, `stanceFreeUp`, …).

### 7.4 Known gaps

Differences from the original found in the code and not in `deviations.md`:
- `realtimeDelay` treats Kingpin's men as civilians (`REALTIME_CIV_AI_DELAY`) and has no brothel ÷3 (§1.4).
- The look-around branch of `decideActionGreen` has neither the turn-based `GetAPsToLook <= bActionPoints` gate nor the
  `InternalIsValidStance` test (§2.3 step 10), so in turn-based combat a soldier without the APs draws `PreRandom(100)`
  and may choose an unaffordable turn.
- `checkForChangingOrders` has no END_COWER_AND_MOVE branch (`sPreCombatGridNo` is not modelled, §2.2, §5).
- The new-situation block of `handleSoldierAI` has no quote-record / autobandage branch (alert GREEN, `WAS`), and its
  off-map traversal test uses `offMap` instead of the visible-world test (§1.2 step 6).
- `randomFriendWithin` builds the friend list from `t.soldiers` (soldier-id order), not `MercSlots` order, which changes
  which friend `PreRandom(count)` picks when the two orders differ.

---

## 8. Unverified

- The 55 ms tick and "all slots per tick" assume ideal 5 ms passes and a fast CPU; ja2-node's model is built on them.
- The CHANGE_FACING / CHANGE_STANCE truncation in practice (§1.7, `13` §1.4).
- RT AP checks always passing; `HandleSystemNewAISituation` being a no-op in RT; 30-tile green legs.
- `InternalIsValidStance` being true for every standing soldier in the look-around branch.

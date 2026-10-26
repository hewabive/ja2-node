<!-- Turn-based combat core: an implementable spec for M3. 2026-10-15.
Source: reference/stracciatella/src (ae6bf01, same snapshot as docs 01–09), cross-checked against vanilla
(reference/vanilla/ja2/Build) where marked. Read-only research: nothing was built or run. -->

# 10 — Turn-based combat: entering, turns, AP, interrupts, the AI turn, leaving

**Conventions.** Paths are relative to `reference/stracciatella/src/game/`; `V:` is vanilla `Build/`. "(inferred)"
marks conclusions not traced end to end; everything else was read in the code. C integer semantics apply:
`/` truncates toward zero (`idiv`), `INT8`/`UINT8` stores wrap (`i8`/`u8`). `Random` = `main` stream, `PreRandom` =
`pre` stream (`01` §3.6). Times are game milliseconds; a tick is 5 ms. Teams: `OUR 0, ENEMY 1, CREATURE 2,
MILITIA 3, CIV 4` (`LAST_TEAM = CIV`, `MAXTEAMS 6`, `Tactical/Overhead_Types.h:35,244`). `FOR_EACH_IN_TEAM` walks one
team by soldier id; `FOR_EACH_MERC` walks `MercSlots` (sector insertion order); `FOR_EACH_SOLDIER` walks all ids
(`Tactical/Overhead.h:184-200`, `08` §2.4). "Policy" values are Stracciatella defaults from
`assets/externalized/game.json`. `NO_INTERRUPT 127`, `AUTOMATIC_INTERRUPT 100` (`Tactical/OppList.h:29-30`).

Companions: `03` §3–§5 (coupling overview), `07` §3.5–§3.6, §4.6, §4.10 (movement AP and the NoAP freeze),
`08` §2 (sight, opplists, best sighting in real time), `09` (AI state, `ActionDone`, green/yellow decisions).

---

## 0. State this spec adds

**Tactical status** (`TacticalStatusType`): `inCombat` (`INCOMBAT`), `currentTeam` (`ubCurrentTeam`), `attackBusyCount`
(`ubAttackBusyCount`, UINT8), `consNumTurnsNotSeen`, `consNumTurnsWeHaventSeenButEnemyDoes`, `numFoughtInBattle[6]`,
`enemyInSector`, `virginSector`, `interruptOccurred` (`fInterruptOccurred`), `enemySightingOnTheirTurn` {enemy,
since}, `killedEnemyOnAttack`, `checkSightAtEndOfAttack` (`CHECK_SIGHT_AT_END_OF_ATTACK`), `teamAware[6]`
(`bAwareOfOpposition`, exists), `selectedSoldier` (UI concept; §9). Interrupt module: `intList[1..n]`
(`gOutOfTurnOrder`, index 0 unused), `intCount` (`gubOutOfTurnPersons`), `hiddenInterrupt`, `lastInterruptedGuy`,
`unlockUIAfterHiddenInterrupt`, `interruptProvoker`, `whoThrewRock`. Sight module: `best[0..5]` with size 0/3/6
(exists, must become ordered, §1.2), `delayResolvingBestSightingDueToDoor`, `seenOpponents[156][156]`
(`gbSeenOpponents`: 0 never, −1 first sighting just now, 1 seen before), watched locations (§4.9). AI module: the AI
list (§6.3), `pauseAllAI` timer (exists as `paused`, needs the 1500 ms deadline). Deferred noise queue (§5).

**Soldier**: `actionPoints` (`bActionPoints`, INT8), `initialActionPoints`, `intStartAPs`, `moved` (`bMoved`),
`movedPriorToInterrupt`, `passedLastInterrupt`, `aiTurnControl` (`SOLDIER_UNDERAICONTROL` 0x40; **not** the existing
`underAiControl`, which is `SOLDIER_PCUNDERAICONTROL` 0x20, `Soldier_Control.h:48-49`), `turnInProgress`,
`lastTwoLocations[2]`, `shock` (`bShock`), `underFire` (exists in `ai`), `bleeding`, `nextBleed` (float),
`suppressionPoints`, `apsLostToSuppression`, `reasonCantFinishMove` (NO_APS / STOPPED_SIGHT), `oldLife`,
`weightCarriedAtTurnStart` (percent), `lastRenderVisible` (`bLastRenderVisibleValue`, created −1,
`Soldier_Create.cc:931`), fade state, `pauseAllAnimation`, `numHitsThisTurn`, `closeCall`, `lastTarget`,
`dontChargeTurningAPs`, `dontChargeAPsForStanceChange`, `dontChargeReadyAPs`, `goodContPath`, `contPathLocation`,
`collapsedTurns`. Initial `actionPoints = CalcActionPoints(s)` (`Tactical/Soldier_Create.cc:210`).

---

## 1. Entering combat

### 1.1 Triggers

| Trigger | Call | Source |
|---|---|---|
| New hostile sighting in real time (look, door opening, sector load) | best-sighting list → `HandleBestSightingPositionInRealtime` → `EnterCombatMode(team)` (+ interrupt) | `Tactical/OppList.cc:372-430`; `08` §2.9 |
| A noticed attack finishes (busy count reaches 0, attacker's attack noticed, `ProcessImplicationsOfPCAttack` allows) | `EnterCombatMode(attacker.team)` | `Tactical/Overhead.cc:5700-5712` |
| An AI soldier in real time decides FIRE_GUN, TOSS_PROJECTILE, KNIFE_MOVE, KNIFE_STAB, THROW_KNIFE | `NPCDoesAct` → `DisplayHiddenTurnbased(s)` | `TacticalAI/AIMain.cc:876-901`; `Tactical/TeamTurns.cc:428-464` |
| Player key `d` with policy `can_enter_turnbased` (default **false**) | `EnterCombatMode(OUR)` | `Tactical/Turn_Based_Input.cc:1450-1468` |
| Explosions, quest scripts, boxing | various | out of scope (hooks) |

### 1.2 Who starts: the best-sighting list in real time

Outside combat every `HandleSight` resets the list to size 3 (`BEST_SIGHTING_ARRAY_SIZE_NONCOMBAT`); in combat to
size 0 (no entries possible); `AllTeamsLookForAll` and `InitOpplistForDoorOpening` use 6 (`OppList.cc:633-655,
1152-1221`). `ManSeesMan` (`OppList.cc:1847-1864`) adds a looker who gains a **new** hostile opponent, only for callers
MANLOOKSFOROTHERTEAMS, OTHERTEAMSLOOKFORMAN, UNKNOWN (hearing), only if size ≠ 0 and not boxing:
in combat (door case) only if `StandardInterruptConditionsMet(s, opp, oldOpp)`; outside combat if `s.team != OUR ||
opp.life >= OKLIFE`. Points are `CalcInterruptDuelPts(s, opp, TRUE)` (§1.3), computed **before** `seenOpponents`
is updated for this sighting (`:1868-1879`). Door-noise listeners add `pts + volume/2` (`OppList.cc:4096-4114`).

```
ReevaluateBestSightingPosition(s, pts):                                   // OppList.cc:257-369
  if pts == NO_INTERRUPT: return
  if s.duelPts != NO_INTERRUPT && pts < s.duelPts:                         // points got lower
    i = index of s in best[0 .. size-2]
    if found: s.duelPts = pts
              for j in i+1 .. size-1: if best[j] && best[j-1].duelPts < best[j].duelPts: swap(j-1, j) else break
    elif s == best[size-1]: s.duelPts = pts
  elif s not in best[0 .. size-1]:
    for i in 0 .. size-1:
      if best[i] == null || pts > best[i].duelPts:                         // strict: ties keep the earlier sighter
        if best[size-1]: best[size-1].duelPts = NO_INTERRUPT               // falls off
        s.duelPts = pts; shift best[i .. size-2] right by one; best[i] = s; break
  // already listed and points not lower: nothing (keeps the lowest points seen)
```

```
HandleBestSightingPositionInRealtime():                                   // OppList.cc:372-430
  if delayResolvingBestSightingDueToDoor: return
  if best[0]:
    if !best[1] || best[0].team == best[1].team || !best[2] || best[0].team == best[2].team:
      EnterCombatMode(best[0].team)
    else:                                                                  // 2nd best's team starts, best interrupts
      EnterCombatMode(best[1].team)
      AddToIntList(best[1], FALSE); AddToIntList(best[0], TRUE); DoneAddingToIntList()
    for e in best: e.duelPts = NO_INTERRUPT
```
(The three-entry rule is literal: with entries A(enemy), B(merc), C(merc) the mercs' team starts and A interrupts;
with A, B and no C, A's team starts.) The M2 placeholder (`SIGHTING_POINTS = 1`, unordered push,
`perception/sight.ts:190-198`) is replaced by the two functions above.

### 1.3 `CalcInterruptDuelPts(s, opp, useWatchSpots)` (`Tactical/TeamTurns.cc:1139-1296`, = V)

```
if s.neutral: return NO_INTERRUPT
p = robot controlled by remote holder ? EffectiveExpLevel(holder) - 2 : EffectiveExpLevel(s) - (s controls a robot ? 2 : 0)
if useWatchSpots: p += GetWatchedLocPoints(s, opp.gridNo, opp.level)            // 0..4, §4.9
if s.oppCnt > 2: p -= (s.oppCnt - 1) / 2
if s.oppList[opp] == HEARD_THIS_TURN: p -= 1
p -= s.shock
d = u8(PythSpacesAway(s.gridNo, opp.gridNo))
if inCombat && s.team != currentTeam: p -= d / 10                                // passive side: range penalty
elif !seenOpponents[opp][s]:                                                     // active (mover) or out of combat,
  if s.state == SWATTING && d > 26/2: p += 1                                     // MaxDistanceVisible() = 2*STRAIGHT = 26
  elif s.state == CRAWLING && d > 26/4: p += d / 13                              // STRAIGHT = 13 (Overhead_Types.h:173-190)
if s.state == RUNNING && !seenOpponents[s][opp]: p -= 2
if s.servicePartner: p -= 2                                                      // bandaging / being bandaged
if NIGHTOPS: if LightTrueLevel(s) > 3 + 3: p += traitCount                       // NORMAL_LIGHTLEVEL_DAY 3
if s is PC: if s.assignment >= ON_DUTY: p = -10
            if seenOpponents[s][opp] == 1: p += 1                                // == TRUE, not −1
elif s.team == ENEMY: if seenOpponents[s][opp] == 1: p += 1 elif publicOpp[ENEMY][opp] != 0: p += 1
if TANK(s): p /= 2
if p >= 100: p = 99
return i8(p)
```
The difficulty modifier is commented out (`:1161-1168`). `EffectiveExpLevel` = `bExpLevel` + drunk modifier
(0/0/−1/−2/0) − 1 if claustrophobic underground, at least 1 (`Tactical/SkillCheck.cc:67-103`).

### 1.4 `EnterCombatMode` and `CommonEnterCombatModeCode`

```
EnterCombatMode(startTeam):                                               // Overhead.cc:3984-4037
  if inCombat: return
  if NumCapableEnemyInSector() == 0: return                               // §8.2
  SetEnemyPresence()                                                      // enemyInSector = true (+ message/music if virgin)
  CommonEnterCombatModeCode()
  if startTeam == OUR:
    if selected == null || selected.oppCnt == 0:
      for s in team OUR by id: if controllable && s.oppCnt > 0: select(s)  // the LAST such merc ends up selected
    StartPlayerTeamTurn(doBattleSnd=false, entering=true)                 // §2.3
  else:
    EndTurn(startTeam)                                                    // §2.2: freezes UI, BeginTeamTurn(startTeam)

CommonEnterCombatModeCode():                                              // Overhead.cc:3890-3982
  inCombat = true
  numFoughtInBattle[*] = 0; lastBattleWon = false; itemsSeenOnAttack = false
  cancel item pointer, reset UI and multi-selection                       // UI only
  for s in all soldiers by id, inSector && body != CROW:
    clear quote flags IN_SHIT, MULTIPLE_CREATURES
    EVENT_StopMerc(s)                                                     // snap to centre of current sGridNo (07 §4.6)
    CancelAIAction(s)                                                     // 09 §1.6
    s.aiTurnControl = false
    CheckForPotentialAddToBattleIncrement(s)                              // non-neutral non-friendly: numFoughtInBattle[team]++
                                                                          // (CIV only for REBEL/KINGPIN/HICKS groups with a weapon)
    if asleep: ChangeSoldierState(WKAEUP_FROM_SLEEP)
    CalcNewActionPoints(s)                                                // §2.5
    profiled: neutral CIV → profile.preCombatGridNo = gridNo if unset; else preCombatGridNo = NOWHERE
  hasEnteredCombatModeSinceEntering = true
  SyncStrategicTurnTimes()                                                // restart the 5 s real-time turn clock
  sound + battle music                                                    // presentation
```

**APs at entry (inferred from the code path).** Real time never deducts APs (`Points.cc:462-465, 495-498`), so a
soldier's `actionPoints` stays at its creation value or at the last real-time `CalcNewActionPoints`
(`HandleTacticalEndTurn` → `EVENT_BeginMercTurn`), both ≥ 10. Entering combat therefore gives everyone
`min(5 + CalcActionPoints(s), maxAP)`: a full turn plus the maximum carry-over. When the starting team is not OUR,
that team then runs `EVENT_BeginMercTurn` once more (§2.2), which regenerates breath from the unused APs and
recomputes the same value.

### 1.5 The hand-off, end to end

The sighting happens inside `HandleAtNewGridNo` of a walker (or a door opcode, a turn, a stance end) during an overhead
pass. Everything below runs synchronously in that call; the rest of the pass continues with `inCombat` set.

| Case | Sequence |
|---|---|
| A. OUR starts | `EnterCombatMode(OUR)` → everyone stops and gets APs → `StartPlayerTeamTurn(false, true)`: `currentTeam = OUR`, no end-of-combat check → control to the player (§9). The intList is empty (cleared on the last exit). |
| B. AI team T starts | `EndTurn(T)`: intList empty → `AddPossiblePendingEnemiesToBattle` (hook) → for team `currentTeam` (still OUR from real time) in sector: `moved = true` and the "cancel move" rule (§3.5) → `currentTeam = T` → `BeginTeamTurn(T)` (§2.1: decay T's public opplist, `EVENT_BeginMercTurn` for T, AI list, `StartNPCAI(first)`) → `BetweenTurnsVisibilityAdjustments`. |
| C. 2nd best starts, best interrupts | As A or B for the 2nd best's team, then `AddToIntList(2nd, lose)`, `AddToIntList(best, gain)`, `DoneAddingToIntList` → `StartInterrupt` (§4.6). If the best is an enemy, the interrupt is **hidden** until he acts. If the 2nd best's team was an AI team, the soldier `StartNPCAI` picked keeps `aiTurnControl` but `HandleSoldierAI` ignores him while `currentTeam == OUR` (§6.2). |
| D. AI attack in real time | `DisplayHiddenTurnbased(s)` (`TeamTurns.cc:428-464`): skipped in meanwhiles or if already in combat; `currentTeam = s.team`; `CommonEnterCombatModeCode` (no capable-enemy check, no `BeginTeamTurn`, no `EVENT_BeginMercTurn`); `SetSoldierAsUnderAiControl(s)`; `s.turnInProgress = true`; freeze UI. The attack then executes as his TB action. No AI list is built, so after him `EndAIGuysTurn` → `EndAITurn` → the next team (inferred: his teammates do not act this round). |
| E. Attack noticed | at the end of `InternalReduceAttackBusyCount` (§5.3): `EnterCombatMode(attacker.team)` unless in a meanwhile. |

In all cases `CancelAIAction` + `EVENT_StopMerc` leave walkers at tile centres with empty paths; the player's pending
moves are lost (re-issue).

---

## 2. Team turns

### 2.1 `BeginTeamTurn(team)` (`Tactical/TeamTurns.cc:298-385`)

```
loop:
  if team > LAST_TEAM: team = currentTeam = OUR; EndTurnEvents()          // round boundary, §2.2
  elif !IsTeamActive(team): team++; currentTeam++; continue                // bMenInSector == 0
  DecayPublicOpplist(team)                                                 // 08 §2.6 (×7/10 noise in combat) + DecayWatchedLocs
  for s in team by id: if s.life > 0: EVENT_BeginMercTurn(s)               // §2.4 (no inSector check)
  if boxing round over: return
  if team == OUR:
    ClearAIExposedTileMap()                                                // policy avoid_light_tiles_at_night (off)
    if inCombat: StartPlayerTeamTurn(true, false)                          // they may have bled out of combat above
    return
  if team == ENEMY && inCombat && policy avoid_light_tiles_at_night: BuildAIExposedTileMap()
  if BuildAIListForTeam(team) && (s = RemoveFirstAIListEntry()):           // §6.3
    "computer's turn" message; StartNPCAI(s); return
  team++; currentTeam++
```
Order of a round: OUR → ENEMY → CREATURE → MILITIA → CIV → (EndTurnEvents) → OUR. Inactive teams are skipped;
an AI team with nobody eligible for the AI list is skipped after its `EVENT_BeginMercTurn` pass.

### 2.2 Ending turns

```
EndTurn(nextTeam):                                                        // TeamTurns.cc:182-231 (player's End Turn)
  DoDeadIsDeadSaveIfNecessary()                                            // not ported
  if intCount > 0: EndInterrupt(FALSE); return                             // INTERRUPT_QUEUED: nextTeam is ignored
  AddPossiblePendingEnemiesToBattle()                                      // hook (strategic reinforcements)
  FreezeInterfaceForEnemyTurn()                                            // UI lock
  for s in team currentTeam by id, s.inSector:
    s.moved = true
    if EnoughPoints(s, PtsToMoveDirection(s, s.path[0]), 0): s.finalDestination = s.gridNo; s.noAPToFinishMove = false
  currentTeam = nextTeam; BeginTeamTurn(currentTeam); BetweenTurnsVisibilityAdjustments()

EndAITurn():                                                              // :233-252 (last AI soldier of a team done)
  if intCount > 0: EndInterrupt(FALSE); return
  for s in team currentTeam by id: s.moved = true; s.oldLife = s.life
  currentTeam++; BeginTeamTurn(currentTeam)

EndAllAITurns():                                                          // :254-277 (end of battle)
  if intCount > 0: EndInterrupt(FALSE)
  if currentTeam != OUR: for s in team currentTeam: moved = true; aiTurnControl = false; oldLife = life
                         currentTeam = OUR                                 // no BeginTeamTurn

EndTurnEvents():                                                          // :280-295, once per round before OUR's turn
  HandleTeamServices(OUR)        // first aid in progress (hook until medical)
  DecaySmells(); DecayBombTimers(); DecaySmokeEffects(now, true); DecayLightEffects(now, true)
  DecayRottingCorpseAIWarnings() // policy corpse_warning_duration 0: inert
```
`PtsToMoveDirection(s, s.path[0])` reads path step **0**, not `pathIndex` (quirk, keep). `UIHandleEndTurn`
(`Handle_UI.cc:1066-1087`) first calls `CheckForEndOfCombatMode(FALSE)` and returns if combat ended, autosaves, then
`EndTurn(OUR + 1)`.

### 2.3 `StartPlayerTeamTurn(doBattleSnd, entering)` (`TeamTurns.cc:81-157`)

`currentTeam = OUR`; UI bar; if in combat: end-turn sound, reselect if the selected merc is below OKLIFE
(`SelectNextAvailSoldier`), locator, attention sound; `UpdateClock()` (no-op in combat, `Strategic/Game_Clock.cc:616-617`);
**if !entering: `CheckForEndOfCombatMode(TRUE)`** (§8.1, the only call that increments the not-seen counter);
unlock UI; `killedEnemyOnAttack = false`; Dead-is-Dead save (not ported); `HandleTacticalUI`.

### 2.4 `EVENT_BeginMercTurn(s)`, exact order (`Tactical/Soldier_Control.cc:3998-4152`)

Runs for each living member of the team whose turn starts (and every 5 s in real time for everyone, `Tactical_Turns.cc:80-158`).

1. `if underFire != 0: underFire--` (2 = shot at this turn, 1 = last turn).
2. `HandleEndTurnDrugAdjustments` (hook until drugs).
3. Unless auto-bandaging, for non-vehicles/robots with `bleeding != 0 || life < OKLIFE`: `CheckBleeding` (§2.7), drop blood if in sector.
4. `if life == 0: return` (bled to death; death handling follows the usual path).
5. `shock /= 2`.
6. Noise memory: `if noiseGridNo != NOWHERE && noiseVolume != 0: if --noiseVolume == 0: noiseGridNo = NOWHERE`.
7. `SOLDIER_GASSED` cleared if wearing a gas mask or no smoke effect on the tile.
8. `if blindedCounter > 0 && --blindedCounter == 0: HandleSight(LOOK)`.
9. `weightCarriedAtTurnStart = CalculateCarriedWeight(s)` (percent of capacity; 0 until items, then `rules`).
10. `UnusedAPsToBreath(s)` (§2.6) — uses last turn's leftover APs.
11. Quote flags: low breath reset if breath > 80, drowning if > 50; `turnsUntilCanSayHeardNoise--` if > 0.
12. In sector: `CheckForBreathCollapse(s)` (`:7565-7604`: warn quote at breathMax > 70, breath < 20, standing;
    `breath == 0 && !collapsed && !vehicle/animal/monster` → `breathCollapsed = true`).
13. `CalcNewActionPoints(s)` (§2.5).
14. `tilesMoved = 0`.
15. In sector: `BeginSoldierGetup(s)` (`:5266`: collapsed with life ≥ OKLIFE, breath ≥ OKBREATH, no sleep drug →
    stand up animation); **in combat** `VerifyAndDecayOpplist(s)` (`08` §2.6) and X-ray off; OUR profiled mercs:
    phobia/nervous morale events (hooks; CLAUSTROPHOBIC draws `Random(6 − z)` underground).
16. Reset: quote flags BEING_PUMMELED, CLOSE_CALL; `numHitsThisTurn = 0; suppressionPoints = 0;
    apsLostToSuppression = 0; closeCall = false; movementNoiseHeard = 0`.
17. `if actionPoints > 0: moved = false; passedLastInterrupt = false`.

### 2.5 `CalcActionPoints` and `CalcNewActionPoints` (`Soldier_Control.cc:288-445`)

```
CalcActionPoints(s):                                                      // returns INT8; ubPoints is UINT8
  if s.life == 0: return 0
  if s.sleepDrugCounter > 0 && s.collapsed: return 0
  p = 5 + (10*EffExp(s) + 3*EffAgi(s) + 2*s.lifeMax + 2*EffDex(s) + 20) / 40
  if s.life < s.lifeMax: p -= (2*p*(s.lifeMax - effectiveLife(s))) / (3*s.lifeMax)
  if s.breath < 100:     p -= (p*(100 - s.breath)) / 200
  if s.weightCarriedAtTurnStart > 100: p = p*100 / s.weightCarriedAtTurnStart
  p = max(p, AP_MINIMUM 10); p = min(p, maxAP[body])                       // 25; monsters 40; vehicles 50
  if body == BLOODCAT: p = p*15/10
  elif monster: young (YAF, YAM, INFANT) p = p*15/10; if frenzied p = p*13/10
  if profiled: CLAUSTROPHOBIC && sector z > 0: p = p*9/10
               elif FEAR_OF_INSECTS && MercSeesCreature(s): p = p*8/10
  HandleAPEffectDueToDrugs(s, &p)                                          // adrenaline +effect; side effect −, ≥10; hangover (hook)
  if vehicle: p += 35
  if boxing or pre-boxing: p /= 2
effectiveLife(s) = s.life + (s.lifeMax - s.life - s.bleeding) / 2          // Soldier_Control.h:821 (bandaged half counts)
EffAgi = drunk(agility), then ×100/weight if weight > 100                  // SkillCheck.cc:35-40 (weight applies twice, = V)
EffDex = drunk(dexterity); drunk(x) = x * {100,75,...}[drunkLevel] / 100

CalcNewActionPoints(s):
  carry = boxing ? MAX_AP_CARRIED/2 (2) : MAX_AP_CARRIED (5)
  if s.actionPoints > carry: s.actionPoints = carry                         // a debt (< 0) is kept
  s.actionPoints = i8(s.actionPoints + CalcActionPoints(s))
  if !adrenaline: s.actionPoints = min(s.actionPoints, maxAP[body])
  s.initialActionPoints = s.actionPoints
```
Vanilla subtracts `lifeMax − life + bandage/2`, so bandaging *lowered* APs (`V:Tactical/SoldierControl.c:395-402`);
Strac's `effectiveLife` fixes it. Follow Strac.

### 2.6 Breath between turns: `UnusedAPsToBreath` (`Points.cc:641-761`)

```
if vehicle: return
TB:  change = 0
     if s.actionPoints > 5:
       bpa = GetBreathPerAP(s, s.state)
       if bpa < 0 && s.gassed: return                                      // no drug adjustment either
       bpa = bpa*100 / BreathPointAdjustmentForCarriedWeight(s)            // 100; 101–150%: 100+3(w−100); … (:117-151)
       change = (s.actionPoints - 5) * bpa
     HandleBPEffectDueToDrugs(s, &change); DeductPoints(s, 0, change)
RT:  bpa = GetBreathPerAP(s, s.state)*100/weightAdj; change = 3*bpa; drugs
     if change > 0: change = 0
     elif tilesMovedPerRTBreathUpdate > 0:
       m = GetBreathPerAP(s, lastMovementAnimPerRTBreathUpdate) * tilesMovedPerRTBreathUpdate
       if m > 0: change += m;  if change < 0: change = 0      // quirk as written: any exertion cancels the whole gain
     change *= 1 (TB_BREATH_RECOVER_MODIFIER); DeductPoints(s, 0, change); tilesMovedPerRTBreathUpdate = 0
GetBreathPerAP(s, anim):                                                  // :764-840; later flags override earlier
  VARIABLE_EFFORT: −100; in water: STANDING −50, WALKING +25; else STANDING −200, WALKING −50
  NO_EFFORT −200; MIN_EFFORT −100; LIGHT_EFFORT −50; MODERATE_EFFORT +25; none of these: 0
```
Flags: `ANIM_NO_EFFORT 0x400000, MIN 0x800000, LIGHT 0x1000000, MODERATE 0x2000000, VARIABLE 0x8000000`
(`Animation_Control.h:57-62`); add them to `content/anim/tables.ts`. Negative `change` is a gain, scaled by
`AdjustBreathPts` as `cost*100/factor` (`07` §3.6, `points.ts`).

### 2.7 Bleeding (`CheckBleeding`, `Soldier_Control.cc:7804-7918`; `CalcSoldierNextBleed :8056-8063`)

Only if `life != 0` and (`bleeding > MIN_BLEEDING_THRESHOLD 12` or `life < OKLIFE`) and nobody is servicing him:
blood drop `= tilesMoved < 1 ? min((bleeding − 12) / BLOODDIVISOR 10, 7) : NOBLOOD`; `nextBleed −= 1` (TB) or `0.5` (RT);
at `nextBleed <= 0`: bandaged (`lifeMax − bleeding − life ≠ 0`) and life ≥ OKLIFE → `bleeding++` (bleeds through,
no damage); else if dying: dying quote once (life ≥ CONSCIOUSNESS 10), and if `lifeMax >= OKLIFE`: `lifeMax−−,
bleeding−−` (permanent, also in the profile); then **always** `SoldierTakeDamage(1, 100, BLOODLOSS)` (the bandaged
branch calls it with "bandaged bleed" = no damage, see `SoldierBleed :7927-7943`); warn quote; `nextBleed = 1 +
f32(effectiveLife) / (10 + tilesMoved)`. Needs wounds (M3 combat); hook until then.

---

## 3. AP accounting in combat

### 3.1 `EnoughPoints` and `DeductPoints` (`Tactical/Points.cc:439-582`)

```
EnoughPoints(s, ap, bp, msg):
  if s.waitActionToDo: return true; if s.collapsed: return false
  if s.quoteActionID in TRAVERSE_EAST..TRAVERSE_NORTH: return true
  if !inCombat: ap = 0
  return s.actionPoints - ap >= 0                                          // bp is never checked

DeductPoints(s, ap, bp):
  if !inCombat: ap = 0
  n = s.actionPoints - ap
  if n < 0 && s.actionPoints > 0: n = 0                                    // Strac: only a positive pool is floored
  n = max(n, -MAX_AP_DEBT 100); s.actionPoints = i8(n)
  if robot: bp = 0
  if bp: (07 §3.6 / points.ts deductBreath, plus:)
    newBreath = trunc(breathMax − f32(breathRed/100))   // (UINT8) cast of a value in [−100,100] → i8 (inferred: x86 wrap)
    if newBreath < 0: s.actionPoints += newBreath / 5; if s.actionPoints < 0: s.actionPoints = 0; newBreath = 0
```
The breath penalty (`:543-552`) is missing from M2's `deductBreath`; note it also erases an AP debt. Vanilla floors
every deduction at 0 (`V:Tactical/Points.c:483-486`), refunding suppression debt (`02` §1 row "Carry-over").

### 3.2 Cost table (charge points)

| Action | AP | BP | Checked | Deducted |
|---|---|---|---|---|
| Step | `ActionPointCost` (`07` §3.6) | `TerrainBreathPoints` | first step by the UI/AI (§3.4) | each step at the tile centre, `HandleGotoNewGridNo` (`Overhead.cc:1387-1388, 1566`) |
| Start running | `AP_START_RUN_COST 1` | 0 | in `MinAPsToStartMovement`/`PtsToMoveDirection` | entering RUNNING from another state (`Soldier_Control.cc:1446-1455`) |
| Turn (stand/crouch/prone) | `AP_LOOK_STANDING 1 / CROUCHED 2 / PRONE 2` | 0 | `GetAPsToLook` = 1 / 2 / **6** (prone: up 2 + look 2 + down 2) | at `EVENT_InternalSetSoldierDesiredDirection` if the anim has `BREATH \| OK_CHARGE_AP_FOR_TURN \| FIREREADY`, not an initial move, not `dontChargeTurningAPs` (`:3859-3880`); prone also pays `PRONE_UP`/`PRONE_DOWN` |
| Stand↔crouch | `AP_CROUCH 2` | `BP_CROUCH 10` | `SoldierCanAffordNewStance` (`Handle_UI.cc:3583-3615`, checks AP only) | KNEEL_UP/DOWN start unless `dontChargeAPsForStanceChange` (`:1467-1478`) |
| Crouch↔prone | `AP_PRONE 2` | `BP_PRONE 10` | same | PRONE_UP/DOWN start, only at final tile or `pathIndex == 0`, not while turning from prone (`:1480-1492`) |
| Fence hop | `AP_JUMPFENCE 6` (+ stance to stand) | 200 | `GetAPsToJumpFence` | HOPFENCE start (`:1550`) |
| Climb roof up / down | 10 / 6 (+ stance to stand / crouch) | 500 / 250 | `GetAPsToClimbRoof` (`Points.cc:1648`) | CLIMBUPROOF / CLIMBDOWNROOF start (`:1574-1588`) |
| Jump over a person | 6 (+ stance to stand) | 250 | `GetAPsToJumpOver` | JUMP_OVER_BLOCKING_PERSON start |
| Open/close door or struct | `doorAPs[handle]` 3 / 4 / 5 (AI: always 3) | `BP_OPEN_DOOR 30` | `EnoughPoints` before the interaction (`Overhead.cc:837`) | `HandleOpenableStruct` at opcode 494/495 (`Handle_Doors.cc:309-810`) |
| Lockpick / examine / boot / crowbar / unlock / lock / explode / untrap | 10 / 5 / 8 / 10 / 6 / 6 / 10 / 10 | −250 / −250 / 200 / 350 / 50 / 50 / −250 / 150 | UI | same function |
| Ready weapon | `ubReadyTime` of the gun (dual 1) | 0 | in attack cost | READY_* start unless `dontChargeReadyAPs` (`:1407-1424`) |
| Pick up / give / drop bomb / remote / reload / first aid / wire cutters / steal / talk / radio | 3 / 1 / 3 / 2 / 5 / 5 / 10 / 10 / 6 / 5 | — | UI / `IsActionAffordable` | pick-up at opcode 493; others at their animation or command (`Points.h`) |
| Wounded | `damage / AP_GET_WOUNDED_DIVISOR 4` | breath loss | — | `SoldierTakeDamage` (`:5670-5677`) |
| Fall from hit, standing / crouched | 4 / 2 | 250 / 125 | — | FALLBACK_HIT_STAND, FALLFORWARD_FROMHIT_* start (`:1554-1562`) |
| Suppression | up to 8 | — | — | `HandleSuppressionFire` (§5.4) |
| Attacks | `CalcTotalAPsToAttack`, `MinAPsToAttack` (`Points.cc:866, 964`) | per weapon | command | fire opcode (`03` §3); separate combat spec |

`GetAPsToChangeStance` (`Points.cc:1526-1563`): stand↔crouch 2, stand↔prone 4, crouch↔prone 2.

### 3.3 Movement in turn-based (`07` §4.10 for the full RT/TB table)

- **Order check.** The player's move is accepted if `PtsToMoveDirection(s, path[0]) + GetAPsToChangeStance(s,
  height(uiMovementMode))` is affordable (`SelectedMercCanAffordMove`, `Handle_UI.cc:2478-2503`); otherwise the
  target is remembered as `contPathLocation`, `goodContPath = true`, and the order is refused. The whole path may be
  longer than the APs.
- **Per step** (`HandleGotoNewGridNo`, `Overhead.cc:1386-1630`): costs are computed for `path[pathIndex]`;
  `HandleNextTile` (no reservation in TB); mine sense on the next tile; then in order: `noAPToFinishMove && !initial`
  → keepMoving = false; empty path → false; `EnoughPoints(ap)` → hazards (gas 1/5 `PreRandom`, marbles, drunk,
  forgetful) → `DeductPoints(ap, bp)` (skipped for the first CRAWLING step after turning from prone) →
  `EVENT_InternalSetSoldierDestination` → `AdjustNoAPToFinishMove(false)`; else
  `HaltGuyFromNewGridNoBecauseOfNoAPs` (`:1143-1160`: `HaltMoveForSoldierOutOfPoints` (§6.7), clear pending animation,
  unreserve, "out of APs" message for OUR, `UnSetUIBusy`).
- M2's `movement.ts handleGotoNewGridNo` deducts only breath; add the AP cost, the `EnoughPoints` branch and the halt.

### 3.4 The NoAP freeze and continuing a move

`AdjustNoAPToFinishMove(s, set)` (`Soldier_Control.cc:193-217`; crows exempt; clearing resets
`reasonCantFinishMove = NO_APS`). While set, a MOVING or SPECIALMOVE animation does not advance
(`Overhead.cc:683-685`; M2 `overhead.ts:57`). Setters: out of APs (above), an interrupt at a tile centre (§4.10),
`HaultSoldierFromSighting` in combat (`reason = STOPPED_SIGHT`, `:7313-7324`), `fEnemySightingOnTheirTurn` at a tile
centre (§6.9), `StartInterrupt`/`DisplayHiddenInterrupt`/`VerifyOutOfTurnOrderArray` on the interrupted soldier.
Clearers: `07` §4.6, plus `EndTurn` (§2.2) and `ExitCombatMode` (§8.3).

Continuing:
- **Player:** `ContinueMercMovement(s)` (`Soldier_Control.cc:7519-7562`) after `CheckForMercContMove(s)`
  (`Points.cc:1588-1609`: in combat, no item in hand, life ≥ OKLIFE, `gridNo != finalDestination || goodContPath`,
  selected, on screen, path exists, first step affordable). Target `goodContPath ? contPathLocation :
  finalDestination` (else `pendingActionAnimCount = 0`); `FindBestPath`; if affordable: OK sound, clear NoAP,
  `SetUIBusy`, `EVENT_InternalGetNewSoldierPath(s, target, uiMovementMode, FALSE, TRUE)`.
- **End of the player's turn:** a merc whose next step is still affordable (stopped by an interrupt or a sighting)
  loses the pending move; a merc stopped for lack of APs keeps `finalDestination` and NoAP into the next turn (§2.2).
- **AI:** §6.5–6.7.

---

## 4. Interrupts

### 4.1 Where duel points are set

`bInterruptDuelPts` is per soldier, `NO_INTERRUPT` at rest; every duel and every best-sighting resolution resets it.

| Situation | Who gets points | Source |
|---|---|---|
| In-combat look, `OtherTeamsLookForMan(mover)`, list size 0, looker gained new opponents (`newOppCnt`) | looker: `SIGHT_INTERRUPT` flag and `StandardInterruptConditionsMet(looker, mover, oldOpp)` ? `CalcInterruptDuelPts(looker, mover, TRUE)` : NO_INTERRUPT | `OppList.cc:1986-2001` |
| Hearing a noise in combat (not a door) | listener (mutual hostiles): standard conditions ? calc : NO_INTERRUPT | `:4116-4128` |
| Rock impact noise in combat | every eligible listener (`StandardInterruptConditionsMet(l, NULL, FALSE)`, needs `whoThrewRock`): AUTOMATIC_INTERRUPT | `:4202-4212` |
| Door opening (list size 6) | lookers and listeners via `ReevaluateBestSightingPosition` (§4.8) | `:1847-1864, 4096-4114` |
| Unseen attacker noticed | defender, then a one-on-one duel (§4.9) | `:4718-4748` |
| Real-time best sighting | sighters (§1.2) | — |

### 4.2 `StandardInterruptConditionsMet(s, opp, oldOpp)` (`TeamTurns.cc:917-1136`)

```
if inCombat && !(sightFlags & SIGHT_INTERRUPT): false
if attackBusyCount > 0: false
if opp == null && whoThrewRock == null: false
if inCombat && bestSize != 6:
  if s.team == currentTeam: false                       // nobody interrupts his own team
  if boxing: false
if !active || !inSector || life < OKLIFE || breath < OKBREATH || collapsed: false
if actionPoints < MIN_APS_TO_INTERRUPT 4: false
if gassed: false
if policy interrupt_after_being_under_fire (false) ? underFire == 2 : underFire != 0: false
if neutral || (EPC && !robot) || (OUR && assignment >= ON_DUTY): false
need = AP_CHANGE_FACING 1
if opp:
  if s.side == opp.side: if s is PC || s on CIV team: false; elif s.team != opp.team: false
  if opp.team == OUR: if selected == null || (opp != selected && s.side != selected.side): false
  elif !opp.aiTurnControl && s.side != opp.side: false
  if opp.team != currentTeam && s.team != currentTeam: false
  if s.oppList[opp] == SEEN_CURRENTLY:                  // seeing interrupt
    if oldOpp == SEEN_CURRENTLY || oldOpp == SEEN_THIS_TURN: false
    if OppositeDirection(s.desiredDirection) == atan8(s, opp) && PythSpacesAway > EffectiveExpLevel(s): false
    need = !crouched(s) ? AP_CROUCH 2 : MinPtsToMove(s)
  else:                                                 // hearing interrupt
    if opp.oppList[s] != SEEN_CURRENTLY || s.oppCnt > 0 || oldOpp == HEARD_THIS_TURN: false
if actionPoints < need: false
if passedLastInterrupt && !policy multiple_interrupts (false): false
true
```
`PTR_CROUCHED` is `gAnimControl[state].ubHeight == ANIM_CROUCH` (`Soldier_Control.h:994`). `MinPtsToMove` (`Points.cc:1217-1241`): min over 8 neighbours of `ActionPointCost(s, nb, d,
uiMovementMode)`, 127 for tanks.

### 4.3 `InterruptDuel(a, b)` (`TeamTurns.cc:1298-1322`)

`a` wins automatically if `a` sees `b` and `b` does not see `a` (then `a.duelPts = max(a.duelPts, b.duelPts)`);
otherwise `a` wins only if `a.duelPts > b.duelPts` (**ties go to the mover**). No randomness.

### 4.4 `ResolveInterruptsVs(mover, kind)` (`TeamTurns.cc:1525-1691`)

```
if !inCombat: return
wins = []                                                     // (opp, diff) in team order, then id order
for team in 0..5: if IsTeamActive(team) && side(team) != mover.side && team != CIV:
  for opp in team by id: if opp.inSector && opp.life >= OKLIFE && !opp.collapsed:
    if kind == NOISE: if PythSpacesAway(mover, opp) > 26: opp.duelPts = NO_INTERRUPT; continue
    elif opp.oppList[mover] != SEEN_CURRENTLY: opp.duelPts = NO_INTERRUPT; continue
    switch opp.duelPts:
      NO_INTERRUPT: occurs = false
      AUTOMATIC_INTERRUPT: mover.duelPts = 0; occurs = true
      default: mover.duelPts = CalcInterruptDuelPts(mover, opp, TRUE); occurs = InterruptDuel(opp, mover)
    if occurs: wins.push(opp, u8(opp.duelPts - mover.duelPts))
    mover.duelPts = opp.duelPts = NO_INTERRUPT
if wins.length:
  if currentTeam != mover.team && !human(currentTeam):        // e.g. a scream on another team's turn
    for s in team currentTeam by id: if s.aiTurnControl: s.aiTurnControl = false; AddToIntList(s, lose); break
  else: AddToIntList(mover, lose)
  repeat wins.length times:
    pick the first slot with the smallest diff < 127                        // ties: earlier slot first
    if none: continue                                                       // a diff ≥ 127 is never queued (inferred edge)
    AddToIntList(opp, gain)
    if intCount == 1: EndInterrupt(TRUE); return                            // a loop removed everyone
    mark slot used
  DoneAddingToIntList()
```
Because the smallest margin is added first and `StartInterrupt` pops from the end, **the biggest margin acts first**;
among equal margins the later team/id acts first. Callers: `HandleSight(…INTERRUPT)` in combat after the looks
(`OppList.cc:680-685`), `OurNoise` in combat unless the door flag is set (`:3403-3419`).

### 4.5 The interrupt queue

```
AddToIntList(s, gain):                                         // TeamTurns.cc:1351-1400
  for i in 2..intCount: if intList[i] == s:
    if !gain: lastInterruptedGuy = s; return                    // already queued: keep him where he is
    else DeleteFromIntList(i)
  intList[++intCount] = s
  if gain: s.intStartAPs = s.actionPoints
  else: lastInterruptedGuy = s; s.aiTurnControl = false
DeleteFromIntList(i): shift intList[i+1..] left; intList[intCount--] = null      // :1325-1348
DoneAddingToIntList(): VerifyOutOfTurnOrderArray(); EveryoneInInterruptListOnSameTeam() ? EndInterrupt(TRUE) : StartInterrupt()
```
`VerifyOutOfTurnOrderArray` (`:1403-1508`), port literally: (1) walk the list remembering each team's highest index;
when a team reappears after another team's later entry (a loop A→B→A), delete every entry between the earlier
occurrence and this one (each gets NoAP set and `turningFromPronePosition = false`) and restart the scan; (2) if
three or more teams remain, delete every entry not on the team of `intList[1]` (same freezing).

### 4.6 `StartInterrupt` (`TeamTurns.cc:513-691`)

```
first = intList[intCount]; team = first.team
interruptOccurred = true
for s in all soldiers: s.movedPriorToInterrupt = s.moved; s.moved = true
if team == OUR:
  pop from the end while same team: each popped s.moved = false            // all trailing OUR winners act together
  "Interrupt for <names>" message (squad order), select(first), locator on lastInterruptedGuy
  currentTeam = OUR; unlock UI; UI bar; sound; SayCloseCallQuotes()       // Random(3) per eligible merc (main stream)
else:
  pop trailing winners of that team (moved = false); the lowest id is computed but unused (quirk)
  if !BuildAIListForTeam(team): EndInterrupt(false); return                // Strac guard; V crashes here
  s = RemoveFirstAIListEntry()                                             // AI-list priority, not queue order
  hiddenInterrupt = true; unlockUIAfterHiddenInterrupt = false             // also for AI-vs-AI (condition always true)
  currentTeam = s.team; StartNPCAI(s)
if !hiddenInterrupt: latest = intList[intCount]; NoAP(latest) = true; latest.turningFromPronePosition = false
```

**Hidden interrupts.** An AI interrupt is not shown until an interrupter acts: `NPCDoesAct` → `DisplayHiddenInterrupt`
(`:387-426`): locator (if visible), lock UI, NoAP on `intList[intCount]` (the interrupted soldier), message
"Interrupt!"/"militia interrupt", `hiddenInterrupt = false`. If every interrupter does nothing, `EndInterrupt` hides
it completely (§4.7). The interrupted mover is frozen at his tile centre in either case (§4.10).

### 4.7 `EndInterrupt(markOccurred)` (`TeamTurns.cc:694-914`)

```
interruptOccurred = markOccurred
for s in team currentTeam by id:                               // those who passed on reacting
  if s.inSector && !s.moved && s.actionPoints == s.intStartAPs:
    m = MinAPsToAttack(s, s.lastTarget, FALSE); if 0 < m <= s.actionPoints: s.passedLastInterrupt = true
if !EveryoneInInterruptListOnSameTeam(): hiddenInterrupt = false; StartInterrupt(); return   // nested interrupt resumes
interrupted = intList[intCount]
for s in all soldiers: s.moved = s.actionPoints == 0 ? true
                               : (s.team != OUR && s.newSituation == IS) ? false : s.movedPriorToInterrupt
currentTeam = interrupted.team
if interrupted.team == OUR:
  ClearIntList(); select(interrupted) (or next available if < OKLIFE)
  if hiddenInterrupt:
    hiddenInterrupt = false; sel = selected
    if sel.noAPToFinishMove && interrupted.reasonCantFinishMove != STOPPED_SIGHT:
      clear NoAP(sel); sel.gridNo != sel.finalDestination ? EVENT_GetNewSoldierPath(sel, finalDestination, uiMovementMode)
                                                         : UnSetUIBusy(interrupted)
    else UnSetUIBusy(interrupted)
    if unlockUIAfterHiddenInterrupt: …= false; UnSetUIBusy(interrupted)
  else: unlock UI, locator, attention sound, UI bar (no timer reset)
else:
  hiddenInterrupt = false
  found = any s with id in [Team[ENEMY].firstID .. Team[currentTeam].lastID] active, in sector, life >= OKLIFE   // quirk: starts at ENEMY
  if found && BuildAIListForTeam(currentTeam):
    for i in 1..intCount: MoveToFrontOfAIList(intList[i])
    if s = RemoveFirstAIListEntry(): StartNPCAI(s) else found = false
  "computer's turn"; lock UI; ClearIntList(); if !found: EndAITurn()
```
An interrupted AI soldier with a new situation gets to act again (`moved = false`).

### 4.8 Doors in turn-based

Opcode 495 (`Soldier_Ani.cc:1589-1622`): `InitOpplistForDoorOpening()` (size 6, door flag on, clear list) →
`MakeNoise(CREAKING)` (listeners join the list with `pts + volume/2`; `OurNoise` skips `ResolveInterruptsVs` while the
door flag is set) → `interruptProvoker = opener` → `AllTeamsLookForAll(TRUE)` (door flag off, everyone with life ≥
OKLIFE `HandleSight(LOOK)`, OUR radios, then in combat `HandleBestSightingPositionInTurnbased`) →
`HandleSystemNewAISituation(opener)`.

```
HandleBestSightingPositionInTurnbased():                       // OppList.cc:439-494
  if best[0] && best[0].team != currentTeam:
    find the first i with best[i] == null (then best[i] = interruptProvoker, or abort if none) or best[i].team == currentTeam
    AddToIntList(best[i], lose); for j < i: AddToIntList(best[j], gain); DoneAddingToIntList()
  for e in best: e.duelPts = NO_INTERRUPT
```

### 4.9 Prerequisites: seen-opponents and watched locations

- `seenOpponents[s][opp]` (`OppList.cc:1868-1879`): on each `ManSeesMan`, 0 → −1, else → 1. Cleared for everyone by
  `InitOpponentKnowledgeSystem`, for one soldier's row by `InitSoldierOppList`, and per pair when an opponent's
  knowledge of a dead target is wiped (`OppList.cc:2100, 2211-2262`); saved with the game.
- Watched locations (`OppList.cc:4805-5066`, `NUM_WATCHED_LOCS 3`, `MAX_WATCHED_LOC_POINTS 4`, radius 1 by
  `SpacesAway` on the same level): `IncrementWatchedLoc` when a looker gains a new opponent not seen earlier this turn
  (`:1790`): existing loc → +1 (max 4, once per `HandleSight`, flag `incremented`) and `CommunicateWatchedLoc` to
  living teammates (max with theirs); new loc → slot with NOWHERE, else one with ≤ 1 point, 1 point.
  `SetWatchedLocAsUsed` on re-sighting (`:1801`) clears the reset flag. `DecayWatchedLocs(team)` at
  `DecayPublicOpplist`: for each loc whose radius holds nobody of another team: if the reset flag is set, halve the
  points (0 → forget) and clear the flag, else set it. `GetWatchedLocPoints` returns the raw points.

### 4.10 Effect on the soldier who was interrupted

At a tile centre (`HandleAtNewGridNo`, `Overhead.cc:1795-1855`, `07` §4.7): `interruptOccurred = false` → movement
noise (`OurNoise` → `ResolveInterruptsVs(NOISE)`) → **sight only if no interrupt yet** (a noise interrupt skips this
tile's look) → if `interruptOccurred`: NoAP on, keepMoving = false, clear pending animation/direction, drop the
pending action if at the final tile, reset the flag, end the enemy-sighting pause if it was this soldier. Note that
`EndInterrupt(TRUE)` from a loop also sets `interruptOccurred`, so the mover freezes even if control never changed
(quirk, keep). Interrupts are only checked at tile centres, at the end of stance changes (busy count 0, no pending
animation), at roof-climb commits and at doors; turning looks never interrupt (`08` §2.8).

### 4.11 `NoticeUnseenAttacker` (one-on-one, `OppList.cc:4608-4750`)

After the defender notices (sees: radio/alert; or hears: new situation, RED, `HEARD_THIS_TURN`), if
`StandardInterruptConditionsMet(defender, attacker, oldOpp)`: `defender.duelPts = Calc(defender, attacker, FALSE)`,
`attacker.duelPts = Calc(attacker, defender, FALSE)`; if `InterruptDuel(defender, attacker)`: `AddToIntList(attacker,
lose); AddToIntList(defender, gain); DoneAddingToIntList()`; reset both. Called from the end of an attack (§5.3);
needs attacks.

---

## 5. The attack busy count (barrier)

**Up** (`03` §4): attack start (`Soldier_Control.cc:2125`), toss (`Handle_Items.cc:846, 906`), blade/punch/knife throw
(`:6583, 6735, 6845`), steal (`:8525`), each hit animation (`:2663`), explosion (`Explosion_Control.cc:113`), blast hit (`:726`),
opcode 757 (`Soldier_Ani.cc:2272`), suppression stance change in combat (`Overhead.cc:5309`), door traps going off
(`Keys.cc:567, 580`). **Down**: `ReduceAttackBusyCount` / `FreeUpAttacker*` (bullet end, hit release 480/497/death,
448, 753, physics object end, explosion end, `HaultSoldierFromSighting` aborting a throw/turn-to-shoot, end of a
suppression stance change at 499 `Soldier_Ani.cc:1794-1799`). Out of combat `HandleItem` zeroes it
(`Handle_Items.cc:215-219`).

**What waits on it while > 0:** interrupts (`StandardInterruptConditionsMet`), noise (`MakeNoise` queues
`EV_S_NOISE` as a demand event, `OppList.cc:3380-3397`), AI new situations (`AIMain.cc:288-357`; a FIRE_GUN with
no bullets in flight or a TOSS with no objects is processed anyway, the latter zeroing the count), end of battle
(`Overhead.cc:4415`), `UnSetUIBusy` and the interrupt-enabled look at the end of a stance change
(`Soldier_Ani.cc:1803-1817`), AI switch pulls.

### 5.3 `InternalReduceAttackBusyCount(attacker, byAttacker, target)` (`Overhead.cc:5510-5787`)

```
if attacker == null: target = null
if byAttacker && attacker holds a gun && attacker.bulletsLeft > 0: return target
attackBusyCount = max(0, attackBusyCount - 1)                  // never wraps
if attackBusyCount > 0: return target
if inCombat: HandleSuppressionFire(attacker?.target, attacker); if attackBusyCount > 0: return target
if meanwhile && attacker && attacker.profile != QUEEN: return target
if target: target.numPelletsHitBy = 0
if attacker:
  attacker.attackingHand = HANDPOS
  enter = false
  if target && attacker.attackNoticed:
    if target.body != CROW && attacker.team == OUR: enter = ProcessImplicationsOfPCAttack(attacker, target, NORMAL)  // :5344-5507, hook
    if target.body == CROW: crows that see the attacker fly away; enter = false
    boxing: a dead boxer ends the match
    if attacker.team != OUR || target.team != OUR:
      if target.oppList[attacker] != SEEN_CURRENTLY: NoticeUnseenAttacker(attacker, target, 0)
      target.underFire = 2
  ammo quote; attacker is PC ? UnSetUIBusy(attacker) : FreeUpNPCFromAttacking(attacker)   // = ActionDone
  if enter && !inCombat && !meanwhile: EnterCombatMode(attacker.team)
  attacker.attackNoticed = false
if killedEnemyOnAttack: killed quote; = false
HandleAnyStatChangesAfterAttack()
if itemsSeenOnAttack && currentTeam == OUR: item locator quote
if checkSightAtEndOfAttack: AllTeamsLookForAll(FALSE); OUR mercs RevealRoofsAndItems; clear flag
DequeueAllDemandGameEvents()                                    // deferred noises → OurNoise → their interrupts
CheckForEndOfBattle(FALSE)
if !inCombat && attacker: EndMuzzleFlash(attacker)
if attacker: weaponMode ATTACHED → NORMAL; attacker.lastTarget = attacker.targetGridNo
return target
```
Port the counter, the deferred-noise queue and this order now; attacks plug into it later.

### 5.4 `HandleSuppressionFire(targeted, attacker)` (`Overhead.cc:5103-5341`)

```
for s in MercSlots: if merc body && life >= OKLIFE && s.suppressionPoints > 0:
  tol = 2*expLevel + (PC ? (morale - 50)/10 : (aiMorale - MORALE_NORMAL 2)*2)
        + (profiled ? {ATT_AGGRESSIVE +2, ATT_COWARD −2}[profile.attitude] : {BRAVESOLO/BRAVEAID +2, AGGRESSIVE +1, DEFENSIVE −1}[attitude])
  tol = max(tol, 0)
  lost = min((((pts * modifier 6) / (tol + 6)) * 2 + 1) / 2, MAX_APS_SUPPRESSED 8); total = lost
  if s.apsLostToSuppression >= lost: continue
  repeat (total/2 − apsLost/2) times: HandleMoraleEvent(s, MORALE_SUPPRESSED)
  lost -= s.apsLostToSuppression; stance = 0
  if pts >= threshold 130 / (6 + tol):
    CROUCH end height: total >= 2 && valid PRONE && (no known opponent || SpacesAway(closest) > 8) → PRONE
    STAND (not in water): total >= 4 && valid PRONE: far → CROUCH (stand can only crouch); near && valid CROUCH → CROUCH
                          elif total >= 2 && end height != CROUCH && valid CROUCH → CROUCH
  s.actionPoints -= lost (i8, may go negative); s.apsLostToSuppression = total
  PC && pts > 8 && s == targeted: "under heavy fire" quote once
  if stance: if inCombat: attackBusyCount++; s.suppressor = attacker
             changingStanceDueToSuppression = dontChargeAPsForStanceChange = true
             AI: CancelAIAction; action = CHANGE_STANCE(stance); inProgress = true
             cancel giving aid; pendingAnimation = none; inNonintAnim = rtNonint = false; ChangeSoldierStance(s, stance)
```
Strac charges nothing extra for the crouch→prone drop; vanilla refunded `AP_PRONE − lost` (`V:Tactical/Overhead.c:5874-5888`).

---

## 6. The turn-based AI loop

### 6.1 Cadence

In combat `ExecuteOverhead` calls `HandleSoldierAI` for **every** merc slot on **every** 5 ms pass, right after that
soldier's frame step (`Overhead.cc:1032-1053`); there is no 55 ms tick, no slot cursor, no time slice and no per-soldier
`AICounter` gate. The only budgets are APs and the per-pass path limits `gubNPCAPBudget`/`gubNPCDistLimit`, which
pathing callers set and the pass end zeroes (`:1138-1139`). The 1500 ms `pauseAllAI` after leaving combat (§8.3)
gates the call.

### 6.2 `HandleSoldierAI`, turn-based path (`TacticalAI/AIMain.cc:86-511`)

1. Return if `ENGAGEDINACTION`, `enemySightingOnTheirTurn`, or the explosion queue is busy (`:91-99`).
2. PCs return unless auto-bandage or PC-under-AI with a quote record/boxer (also clears `AI_HANDLE_EVERY_FRAME`).
3. `gfTurnBasedAI = inCombat`. TB gates (`:128-157`): non-OUR soldier while `currentTeam == OUR` → return;
   `!aiTurnControl` → return; `team != currentTeam` → clear `aiTurnControl`, return; `moved` → `EndAIGuysTurn`, return.
4. Clear `AI_HANDLE_EVERY_FRAME` unless quote action TURNTOWARDSPLAYER (no timer is involved in TB).
5. `gettingHit` → return. Boxing non-boxer → `EndAIGuysTurn`. `life < OKLIFE` or inactive → end muzzle flash,
   `EndAIGuysTurn`. Asleep: visible in TB → wake; else without schedule → `EndAIGuysTurn`. Not in sector without
   schedule → `EndAIGuysTurn`. Vehicle/robot (not tank) → `EndAIGuysTurn`. Collapsed → `CancelAIAction`,
   `EndAIGuysTurn`. Krott/Mike/Joe during dialogue → return.
6. New situation block exactly as in RT (`09` §1.2 step 6), including the busy-count hack.
7. Deadlock: `now − timeSinceMercAIStart > 15000` → `EndAIDeadlock` (not ported, `deviations.md` "Watchdogs").
8. `action == NONE` → end muzzle flash, `TurnBasedHandleNPCAI(s)` (§6.5).
9. Else the continue branch as in RT (`09` §1.2 step 8): path done → `ActionDone` (MOVE_TO_CLIMB at the final tile →
   if CLIMB_ROOF affordable, queue it as next action); then `noAPToFinishMove` → `SoldierTriesToContinueAlongPath`;
   or stationary animation without door/fence/stance continuation or moving pending animation →
   `SoldierTriesToContinueAlongPath`.

### 6.3 The AI list (`TacticalAI/AIList.cc`)

```
BuildAIListForTeam(team):                                      // :192-218
  TurnOffTeamsMuzzleFlashes(team); clear
  for s in MercSlots with s.team == team: if SatisfiesAIListConditions(s, &nDone, randomChecks=true):
    InsertIntoAIList(s, s.alertStatus + (s.visible == 1 ? 3 : 0))
  return count > 0
InsertIntoAIList: before the first entry with a lower priority (FIFO among equals)            // :103-115
SatisfiesAIListConditions(s, nDone, random):                   // :117-172
  boxing non-boxer, inactive, !inSector, life < OKLIFE, breath < OKBREATH: false
  if s.moved: if s.actionPoints <= 1 && nDone: nDone++; false
  DecideAlertStatus(s)                                         // side effects: may SetNewSituation
  CIV team: CROW/COW → false
    neutral and (no civ group or group neutral):
      alert < RED: if random && PreRandom(10) != 0 && !quoteRecord: false
      else cowering: invisible → false; profiled → false; random && PreRandom(3) != 0 → false
           CRIPPLECIV: random && PreRandom(3) != 0 → false
    cowering: lastAction = NONE
  true
RemoveFirstAIListEntry: pop until an entry satisfies the conditions (no random checks)        // :75-87
MoveToFrontOfAIList(s): if conditions hold: remove s, insert at the head with the head's priority (100 if empty)
```

### 6.4 `StartNPCAI(s)` and `RefreshAI` (`AIMain.cc:605-646, 1228-1265`)

`SetSoldierAsUnderAiControl(s)` (clears `aiTurnControl` on every soldier, sets it on `s`, `Soldier_Control.cc:8921-8934`);
`turnInProgress = true`; `lastTwoLocations = [NOWHERE, NOWHERE]`; `RefreshAI(s)`: `lastAttackHit = false`;
`DecideAlertStatus`; YELLOW → `SkipCoverCheck = false`; in TB: RED/BLACK → `newSituation = IS`; else `pathStored =
false` and `ManChecksOnFriends(s)` (`:1937-1986`: each non-neutral same-side friend in `ActiveMercs` order within
`DistanceVisible` and LOS: friend RED+ or under fire or dying → s RED, `CheckForChangingOrders`, `SetNewSituation`,
stop; friend YELLOW and s GREEN → s YELLOW, new situation, `noiseGridNo = friend.gridNo`, `noiseVolume = 3`);
`lastAction = NONE`. Then `timeSinceMercAIStart = now`, locator/UI (presentation), `DecideAlertStatus(s)` again.

### 6.5 `TurnBasedHandleNPCAI(s)` (`AIMain.cc:965-1222`)

Only called with `action == NONE` (so its `ActionInProgress` branch, `:1032-1061`, is dead in Strac).
```
actionInProgress = false; pathStored = false
if nextAction != NONE: END_COWER_AND_MOVE expansion or take the next action (09 §1.3); PICKUP_ITEM restores its data
elif absoluteFinalDestination != NOWHERE: SCHEDULE_MOVE or WALK to it
elif !ENGAGED_IN_CONV: action = creature/bloodcat ? CreatureDecideAction : crow ? CrowDecideAction : DecideAction(s)
if action == ABSOLUTELY_NONE: action = NONE
if action == NONE: NPCDoesNothing(s) → EndAIGuysTurn(s); return
if IsActionAffordable(s):
  NPCDoesAct(s)                                 // hidden interrupt shown; bDesiredDirection = bDirection
  actionInProgress = ExecuteAction(s)
  if !actionInProgress && absoluteFinalDestination != NOWHERE: EndAIGuysTurn(s)
else: HaltMoveForSoldierOutOfPoints(s)          // NoAP even for non-moves (harmless) + EndAIGuysTurn
```
The soldier keeps deciding, pass after pass, until he chooses NONE, cannot afford his action, runs out of APs on a
step, or is marked `moved`. `DecideAction` → `DecideActionGreen/Yellow/Red/Black` by alert status (`09` §2.1); the
TB-specific branches of the green and yellow trees are marked `gfTurnBasedAI` in `DecideAction.cc` (AP checks such as
`GetAPsToLook <= APs`, `RandDestWithinRange` 10 tries, `GoAsFar` AP reserve).

### 6.6 `IsActionAffordable(s)` (`TacticalAI/AIUtils.cc:438-551`)

Minimum APs by action: NONE 0; CHANGE_FACING `GetAPsToLook`; every movement action (RANDOM_PATROL, SEEK_FRIEND,
SEEK_OPPONENT, TAKE_COVER, GET_CLOSER, POINT_PATROL, LEAVE_WATER_GAS, SEEK_NOISE, ESCORTED_MOVE, RUN_AWAY,
APPROACH_MERC, TRACK, EAT, SCHEDULE_MOVE, WALK, MOVE_TO_CLIMB) and door actions `MinPtsToMove`; PICKUP_ITEM
`max(MinPtsToMove, 3)`; DROP_ITEM 3; FIRE_GUN/TOSS_PROJECTILE/KNIFE_MOVE/THROW_KNIFE `MinAPsToAttack(…, ADDTURNCOST)`;
PULL_TRIGGER 2; USE_DETONATOR 2; YELLOW/RED_ALERT, CREATURE_CALL 5; CHANGE_STANCE `AP_CROUCH` 2; GIVE_AID 0;
CLIMB_ROOF 10 (ground) / 6; COWER, STOP_COWERING, LOWER_GUN, END_COWER_AND_MOVE, TRAVERSE_DOWN, OFFER_SURRENDER 0;
other 0. Affordable iff `min <= actionPoints`.

### 6.7 Continuing, halting, loops

- `ExecuteAction` in TB: WAIT does nothing but `ActionDone` (`AIMain.cc:1330-1341`). Movement actions below BLACK run
  the loop detector first (`:1427-1449`): fill `lastTwoLocations[0]`, then `[1]`; afterwards if `actionData ==
  last[1] && gridNo == last[0]` → `ActionDone` + `EndAIGuysTurn`; else shift. `LegalNPCDestination` in TB skips tiles
  with mercs one step away (`Movement.cc:40`). `NewDest` for RED enemies draws `PreRandom(5 − difficulty)` for swatting
  toward a near noise (`AIUtils.cc:356-430`, roll at `:399`).
- `SoldierTriesToContinueAlongPath(s)` (`TacticalAI/Movement.cc:546-613`): new situation, `actionData >= GRIDSIZE`,
  or `!NewOKDestination(actionData, people)` → `CancelAIAction`, return; affordable ? (not in progress →
  `NPCDoesAct`, `ExecuteAction`) : `CancelAIAction`; then (even after a cancel) `cost = EstimateActionPointCost(s,
  next tile, path[pathIndex], uiMovementMode, pathIndex, pathSize)` (`Points.cc:330-437`); `APs >= cost` →
  `NewDest(s, next tile)`, `actionInProgress = true`; else `CancelAIAction`.
- `HaltMoveForSoldierOutOfPoints(s)` (`Movement.cc:616-633`): not for SPECIALMOVE animations; NoAP on, action kept;
  if `aiTurnControl` → `EndAIGuysTurn`. Next turn RED/BLACK soldiers re-decide (new situation; `ActionDone` does not
  stop a NoAP soldier and leaves the flag on, and the new path restarts the animation); GREEN/YELLOW continue
  through the continue branch.
- `InternalGoAsFarAsPossibleTowards` in TB stops where fewer than `reserveAPs` (5) would remain, counting
  `AP_START_RUN_COST` for runners plus `EstimateActionPointCost` per step (`Movement.cc:454-512`).

### 6.8 `EndAIGuysTurn(s)` (`AIMain.cc:514-575`)

No-op unless `gfTurnBasedAI`. `someoneHit ? someoneHit = false : SayCloseCallQuotes()`; hostile civ-group member →
`CivilianGroupMembersChangeSidesWithinProximity` (hook); roof render flag; `aiTurnControl = false; turnInProgress =
false; moved = true; bypassToGreen = false`; next = `RemoveFirstAIListEntry()` → `StartNPCAI(next)` or `EndAITurn()`.

### 6.9 Enemy sighted on their turn (3 s pause)

When an OUR radioer reveals an enemy while `currentTeam != OUR` (`OppList.cc:2583-2602`): set
`enemySightingOnTheirTurn` (or move it from the previous enemy), remember the enemy and the time, and set his
`pauseAllAnimation` (all his frames stop, `Overhead.cc:685`). While set: every `HandleSoldierAI` returns, and any
soldier reaching a tile centre is halted with NoAP (`Overhead.cc:1853-1858`). After 3000 ms (`GameScreen.cc:310-326`):
if `currentTeam != OUR` clear that enemy's NoAP; clear `pauseAllAnimation` and the flag. An interrupt at that enemy's
tile ends the pause early (§4.10). The original's clock keeps running while the player decides, so the pause also
ends during our interrupt; here the simulation is not idle while the flag is set, so an `advance` to idle and the
real-time driver run the 3000 ms out before they stop for the interrupt decision (otherwise every step of a merc
ordered during that interrupt would halt at the next tile centre). Our merc is halted too (`OurTeamSeesSomeone` → `HaultSoldierFromSighting`, which in
combat sets NoAP with `STOPPED_SIGHT`, cancels turn-to-shoot and pending actions, `Soldier_Control.cc:7271-7368`).

### 6.10 RNG consumers in the TB loop

`pre`: `BuildAIListForTeam` civilian checks (`PreRandom(10)`, `PreRandom(3)`), gas on a step (`PreRandom(5)`), `NewDest`
swat roll, AI decisions (`09` §2.5 and the RED/BLACK trees). `main`: `SayCloseCallQuotes` (`Random(3)` per eligible OUR
merc), forgetful trait, claustrophobia, `OurTeamRadiosRandomlyAbout`. Keep call order: `MercSlots` order for AI-list
building, team-then-id order in `ResolveInterruptsVs`.

---

## 7. Animation speed in combat

`SetSoldierAniSpeed` (`Soldier_Control.cc:4921-4960`): in combat (or auto-bandage), `aniDelay = 0` iff `visible == −1
&& lastRenderVisible == −1` (and not MONSTER_UP); otherwise the table speed or the computed delay, halved in combat
(`03` §0; M2 `animation.ts:135-167` checks only `visible`). Delay 0 means one frame per pass, i.e. per tick.

`lastRenderVisible` and the fade are updated by the overhead pass before the frame step (`Overhead.cc:545-634`):
`visible == −1` with `lastRender >= 0` starts a fade-out (`fadeLevel = land shade`, `visible = −2`); every 60 ms
(`NEW_FADE_DELAY`) the shade rises by 1 until `>= SHADE_MIN − 3 = 12`, then `visible = −1` and the speed is reset —
while `lastRender` is still −2, so the speed stays normal until the next `SetSoldierAniSpeed` call (new animation,
tile change `:2105`, visibility gain `OppList.cc:1914`) (inferred from the order of the code). Fade-in for non-OUR
soldiers who become visible. `HandleAtNewGridNo` cancels a fade-in started on another tile. Keep `visible`,
`lastRenderVisible` and the fade timer as simulation state: they set how many ticks an unseen enemy's action takes.

---

## 8. Leaving combat

### 8.1 `CheckForEndOfCombatMode(increment)` (`Overhead.cc:4237-4375`)

```
if !inCombat || boxing: false
if CheckForEndOfBattle(FALSE): true
weSeeNoOne = no OUR merc (MercSlots) with oppCnt > 0
nobodyAlerted = no non-OUR, non-neutral merc with life >= OKLIFE and alert >= RED
if weSeeNoOne && nobodyAlerted: consNotSeen = 5                                  // "hack": exit now
else:
  for s in MercSlots: if s.life >= OKLIFE && !s.neutral && SoldierHasSeenEnemiesLastFewTurns(s):
    consNotSeen = 0; someone = true; if s.team == OUR || (MILITIA && FRIENDLY): we = true; break
  if someone: consWeHaventSeenButEnemyDoes = we ? 0 : +1; return false
  if increment: consNotSeen++
consWeHaventSeenButEnemyDoes = 0
if consNotSeen > 1: consNotSeen = 0; ExitCombatMode(); quotes (worried about creatures / outstanding enemies); music; true
false
SoldierHasSeenEnemiesLastFewTurns(s): any in-sector soldier of another side (not OUR → life >= OKLIFE;
  not CONSIDERED_NEUTRAL(s, other)) with s.oppList[other] in {SEEN_CURRENTLY, SEEN_THIS_TURN}   // :4135-4159
CONSIDERED_NEUTRAL(me, them) = them.neutral && (me.team != CREATURE || them is a vehicle)
```
Only `StartPlayerTeamTurn` increments, so combat ends at the start of the second consecutive player turn on which
nobody has a hostile at SEEN_CURRENTLY/SEEN_THIS_TURN, or at once when nobody sees anyone and no hostile is RED+.
Other callers: `UIHandleEndTurn`, dialogue, boxing, strategic map (`FALSE`).

### 8.2 `CheckForEndOfBattle(enemyRetreated)` (`Overhead.cc:4392-4705`)

```
if boxing: false; if !inCombat && !enemyInSector: false; if attackBusyCount > 0: false; if killingGuysForLosingBattle: false
won = NumCapableEnemyInSector() == 0        // counts non-neutral, non-friendly, in sector, !DEAD, life >= OKLIFE or life == 0
                                            // (a soldier at life 0 in his death animation still counts, :4914-4931)
lost = CheckForLosingEndOfBattle()          // :4937-5081: all OUR in sector (no vehicles) dead or < OKLIFE, or only EPCs
                                            //  left; friendly militia → autoresolve hook; capture (2–3 unconscious real
                                            //  mercs, enemy team present, quest state) or kill the unconscious; timers
if surface && won && pendingEnemies: won = false                                    // reinforcements hook
if lost: EndAllAITurns(); enemyInSector = false; UnSetUIBusy; if inCombat: ExitCombatMode(); morale/loyalty/music/facts
         hooks; sector enemy-controlled; log; true
if won:
  lastBattleWon = true; if KillIncompacitatedEnemyInSector(): false     // dying enemies bleed out; their deaths re-check
  enemyInSector = false; EndAllAITurns(); UnSetUIBusy; unlock UI; if inCombat: ExitCombatMode()
  if numFoughtInBattle[ENEMY] + [CREATURE] + [CIV] > 0:
    OUR in sector: battlesFought++; standing up (life >= OKLIFE, not collapsed, not on duty): stealth off,
      stand (ChangeSoldierStance(STAND)) or lower a raised weapon; morale/loyalty, music, auto-bandage, quotes
  else: music, auto-bandage
  MILITIA in sector: alert GREEN, CheckForChangingOrders, noise forgotten, newSituation = 0, orders STATIONARY, bleeding 0 if alive
  teamAware[MILITIA] = false; CIV in sector: GREEN, noise forgotten, newSituation = 0, CheckForChangingOrders; teamAware[CIV] = false
  victory log, sector control, NPC victory, first-battle facts; 3 s "someone else here" notice; true
false
```
Called after every death (`Overhead.cc:2254, 2528`), at the end of each attack (§5.3), and from §8.1.

### 8.3 `ExitCombatMode` (`Overhead.cc:4040-4105`): what is reset

`inCombat = false`; top message ends; **`virginSector = true`**; for every in-sector soldier: NoAP with life ≥ OKLIFE →
clear + `SoldierGotoStationaryStance`; remove pending animation; `moved = false`; `finalDestination = gridNo`;
`aiTurnControl = false`. Music; `BetweenTurnsVisibilityAdjustments()` (`OppList.cc:2265-2278`: non-OUR/militia
soldiers no OUR merc sees → `visible = −1`); `PauseAITemporarily()` (1500 ms, `:450-454`); all muzzle flashes off;
`ClearIntList()`; unless in conversation `HandleStrategicTurnImplicationsOfExitingCombatMode()` (sync the real-time turn
clock and run `HandleTacticalEndTurn` now, i.e. a real-time `EVENT_BeginMercTurn` for everyone,
`Strategic/Strategic_Turns.cc:91-95`); force an opplist decay (`lastDecay = now − 20`; `NonCombatDecayPublicOpplist`).
Not reset: `actionPoints` (real time recomputes them), alert statuses (except on victory), opplists, the AI list.

### 8.4 Time

World time is frozen in combat (`UpdateClock` returns, `Game_Clock.cc:616-617`); the 5 s real-time turn does not run
and its clock is re-synced every pass (`Strategic_Turns.cc:56-59`). Tactical ticks keep running for animations, bullets
and explosions. Port: in combat set `RealtimeTurns.lastTurnMs = clockMs` every pass (`perception/wiring.ts`).

---

## 9. Where the player decides, and the API

The original has no modal box for turn-based play: control passes to the player and he acts with eligible mercs until
he presses End Turn. The simulation turns these points into stops (D15, `01` §3.8, `04` §4.2):

| Point | Original | ja2-node |
|---|---|---|
| Player's turn starts (`StartPlayerTeamTurn`, case A, `EndInterrupt` back to OUR) | UI unlocked, all OUR mercs with `moved == false` act | `advance` stops with `idle` once `currentTeam == OUR`, the busy count is 0, no OUR soldier is in a non-stationary animation and no interrupt prompt is open |
| Interrupt in the player's favour (`StartInterrupt`, OUR) | "Interrupt for A, B" message; only mercs with `moved == false` may act (`OK_INTERRUPT_MERC`, `Soldier_Macros.h:63`) | open `Prompt{kind:'interrupt', soldiers}`; `advance` stops with `decision`; commands for other mercs are refused; the prompt is answered by `endTurn` (or `answer{done}`), which runs `UIHandleEndTurn` → `EndTurn` → `EndInterrupt(FALSE)` |
| AI interrupt (hidden) | nothing shown until an interrupter acts | no event until `DisplayHiddenInterrupt`; then `interrupt{team}` event. A fully hidden interrupt leaves no trace in the player view (D16) |
| Merc runs out of APs mid-move / stopped by sighting | message; move can be continued later | event `stopped{reason:'noAP'|'sighting'|'interrupt'}`; `move` again (or `continue`) re-plans with `ContinueMercMovement` rules |

**Commands in TB** (`Handle_UI.cc`): `move` (§3.3 check; select the soldier; `SetUIBusy`), `turn` (`MakeSoldierTurn`
`:3829-3860`: `EnoughPoints(GetAPsToLook)`, a NoAP soldier first goes stationary), `stance` (`SoldierCanAffordNewStance`,
then `ChangeSoldierStance`, `finalDestination = gridNo`, `goodContPath = false`, `:2842-2856`), `endTurn` (only when
`currentTeam == OUR`; `Turn_Based_Input.cc:1450-1463`), door/attack/item commands with their checks. All commands are
refused while the UI would be locked: not OUR team's control, busy count > 0, or another OUR soldier still acting
(the original's `SetUIBusy`/`UnSetUIBusy` lock on the selected merc, `Handle_UI.cc:4851-4881`; inferred equivalent).
`selected` = the OUR soldier of the last accepted command (initially chosen by `EnterCombatMode`); it matters for
`StandardInterruptConditionsMet`, `EndInterrupt` and `CheckForMercContMove`.

**Events**: `combatStarted{team}`, `turnStarted{team}`, `interrupt{team, soldiers?}` (visible only),
`interruptEnded`, `apChanged{soldier, ap}` (or AP in the soldier snapshot), `combatEnded{reason:'lull'|'won'|'lost'}`.
Remove `combatWouldStart`, `combatPending` and the sandbox `endCombat` command.

---

## 10. Minimal M3 implementation (turn-based core)

Goal: in the A9 sandbox a hostile sighting starts turn-based play with the right team and interrupt, teams alternate
with exact AP pools, mercs walk/turn/crouch for APs, sighting and noise interrupts resolve in the original order, the AI
takes its turns (green/yellow trees, RED/BLACK as a hook), and combat ends by the lull rule. No attacks yet.

**Port exactly, in this order** (`sim/tactical/turns/` unless noted):
1. *State* (§0): tactical-status fields, interrupt/AI-list modules, soldier fields; rename or document the existing
   `underAiControl` (PC-under-AI) vs the new `aiTurnControl`.
2. *AP rules* (`points.ts`): `CalcActionPoints`, `CalcNewActionPoints`, `EnoughPoints`, the AP half of `DeductPoints`
   with the debt floor and the negative-breath penalty, `MinPtsToMove`, `PtsToMoveDirection`,
   `EstimateActionPointCost`, `GetAPsToChangeStance`, `GetAPsToLook`, `GetAPsToJumpFence/ClimbRoof`,
   `UnusedAPsToBreath` (TB and RT branches) + `GetBreathPerAP` + effort flags, `BreathPointAdjustmentForCarriedWeight`
   (weight 0 until items).
3. *TB movement*: AP check, deduction and halt in `handleGotoNewGridNo`; AP charges at animation start (run, kneel,
   prone, hop fence, climb, fall); turning AP in `setDesiredDirection`; door AP at 494/495.
4. *Busy barrier* (§5): counter, deferred noise queue, `InternalReduceAttackBusyCount` skeleton with
   `HandleSuppressionFire` (inert until bullets add points) and hooks for attack implications.
5. *Perception for TB*: `seenOpponents`, watched locations + `DecayWatchedLocs`, `CalcInterruptDuelPts`, ordered
   `ReevaluateBestSightingPosition`, `HandleBestSightingPositionInRealtime` with the interrupt case,
   `HandleBestSightingPositionInTurnbased` and the door path, duel points in `OtherTeamsLookForMan` and `HearNoise`,
   `ResolveInterruptsVs` calls in `HandleSight`/`OurNoise`, TB branches of `HaultSoldierFromSighting` and
   `OurTeamSeesSomeone`, the 3 s enemy-sighting pause, active `HandleSystemNewAISituation`,
   `BetweenTurnsVisibilityAdjustments`, `VerifyAndDecayOpplist` per merc in combat, `lastRenderVisible` + fade +
   unseen speed (§7).
6. *Combat mode* (§1.4, §8): `EnterCombatMode`, `CommonEnterCombatModeCode`, `NumCapableEnemyInSector`,
   `CheckForEndOfCombatMode`, `CheckForEndOfBattle` (win/loss core), `ExitCombatMode`, real-time turn sync.
7. *Team turns* (§2): `BeginTeamTurn`, `EndTurn`, `EndAITurn`, `EndAllAITurns`, `StartPlayerTeamTurn`,
   `EndTurnEvents` (hooks), `EVENT_BeginMercTurn` in full order.
8. *Interrupts* (§4): queue, `StandardInterruptConditionsMet`, `InterruptDuel`, `ResolveInterruptsVs`,
   `AddToIntList`, `DeleteFromIntList`, `VerifyOutOfTurnOrderArray`, `DoneAddingToIntList`, `StartInterrupt`,
   `EndInterrupt`, hidden interrupts, `interruptOccurred` handling in `handleAtNewGridNo`.
9. *TB AI* (`sim/tactical/ai/`): TB gates of `handleSoldierAI`, AI list, `StartNPCAI`, `RefreshAI`,
   `ManChecksOnFriends`, `TurnBasedHandleNPCAI`, `IsActionAffordable`, full `SoldierTriesToContinueAlongPath`,
   `HaltMoveForSoldierOutOfPoints`, loop detector, WAIT in TB, `EndAIGuysTurn`, `NPCDoesAct`/`NPCDoesNothing`, every-pass
   cadence, 1500 ms pause on exit, TB branches of the green/yellow trees (port `DecideActionYellow` now if not done).
10. *API* (§9): commands `move`/`turn`/`stance`/`endTurn` with TB checks, `selected`, the interrupt prompt, stop reasons,
    events, `observe` with AP and whose turn; replace `combatWouldStart`/`endCombat`.

**Can wait** (hooks with the default in brackets): `DecideActionRed/Black` [NONE → soldier ends his turn], attacks and
`MinAPsToAttack` [0, so `passedLastInterrupt` is never set], `NoticeUnseenAttacker`, rock automatic interrupts,
`DisplayHiddenTurnbased` (AI attacks in real time), `ProcessImplicationsOfPCAttack`, bleeding and `CheckBleeding`
[no wounds], drugs, phobias and personality events, boxing, vehicles/robots/tanks, creatures/bloodcats/crows,
reinforcements (`AddPossiblePendingEnemiesToBattle`, `gfPendingEnemies`), capture sequence and autoresolve on loss,
first aid/team services, smells/bombs/smoke/light decay, quotes/music/locators, morale and loyalty events, Dead-is-Dead
saves, timed turns (option off by default), `avoid_light_tiles_at_night` (off), the AI deadlock breaker.

**Deviations to log** (`docs/deviations.md`):
- Remove the "Combat entry" row; update "Breath regeneration" when `UnusedAPsToBreath` lands.
- *TB UI lock*: commands accepted only when the original UI would be unlocked, approximated as "OUR control, busy
  count 0, no OUR soldier acting"; `selected` = last commanded soldier.
- *Continue move*: `CheckForMercContMove`'s on-screen requirement dropped (UI-only).
- *Interrupt prompt*: the original has no modal prompt; ja2-node opens one so agents know the subset of eligible mercs.
- *Enemy-sighting pause*: 3000 ms of game time instead of wall clock (with the other timers).
- Any hook left at its default (RED/BLACK decisions, attacks, bleeding, reinforcements), as temporary rows.
- If the fade state machine of §7 is simplified, log the changed unseen-speed onset.

**Quirks to keep**: three-entry best-sighting rule; points computed before `seenOpponents` updates; ties go to the
mover; biggest margin first, equal margins later team/id first; diffs ≥ 127 dropped; `EndTurn` reads `path[0]`;
`EndInterrupt` scans from ENEMY's first id; AI interrupters act in AI-list order; `interruptOccurred` set by loop
resolution freezes the mover; noise interrupts skip the tile's look; entering combat gives `5 + CalcActionPoints`;
AP debt erased by negative breath; `ActionInProgress` dead branch; `HaltMoveForSoldierOutOfPoints` on unaffordable
non-moves; unseen speed only after the next speed reset.

**Tests**: `CalcActionPoints` table (exp/agi/dex/life/breath/weight/bandage); `CalcNewActionPoints` carry and debt;
`DeductPoints` floor, −100 cap, breath penalty; `CalcInterruptDuelPts` per term; `ReevaluateBestSightingPosition`
ordering and lowering; the three hand-off cases and `DisplayHiddenTurnbased`; `ResolveInterruptsVs` order with stubbed
points; `VerifyOutOfTurnOrderArray` loop and three-team cases; hidden interrupt that never acts → the mover continues;
`EndInterrupt` restoring `moved`; `EndTurn` keep-or-cancel rule; `CheckForEndOfCombatMode` counter timeline; `ExitCombatMode`
resets; AI list priority/FIFO and civilian `PreRandom` draws; an A9 seeded sandbox battle that cycles ≥ 10 rounds
without a hang and is identical under the instant and manual drivers.

---

## 11. Verified vs inferred

**Verified** by reading Strac (vanilla cross-checks where marked): every function quoted with a line range — combat
entry/exit, team turn loop, `EVENT_BeginMercTurn`, AP formulas and charges, `EnoughPoints`/`DeductPoints`, interrupt
conditions, points, duel, queue, start/end, best-sighting code, busy count and suppression, AI list and TB AI loop,
end-of-combat and end-of-battle rules, the 3 s pause, `SetSoldierAniSpeed`. **Inferred**: APs at combat entry
(5 + calc) from real time never spending them; teammates of a `DisplayHiddenTurnbased` soldier not acting that round;
the unseen-speed onset after a fade; `(UINT8)` breath cast behaving as an INT8 wrap; diffs ≥ 127
being dropped in practice; the "UI lock" equivalence of §9.

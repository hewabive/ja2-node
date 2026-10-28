# 19 — Before and after a battle: pre-battle interface, autoresolve, retreat, sector capture

**Conventions.** Paths are relative to `reference/stracciatella/src/game/`, except `sgp/…` (`reference/stracciatella/src/sgp/`)
and the `*.json` files (`reference/stracciatella/assets/externalized/`, copied unchanged to `data/externalized/`); V marks
vanilla (`reference/vanilla/ja2/Build/`). "(inferred)" marks conclusions not traced end to end (§8). C integer semantics
apply: `/` truncates toward zero (`idiv`), `UINT16` fields wrap (`u16`), `INT8` fields wrap (`i8`). **AR** = autoresolve,
**PBI** = pre-battle interface. Q*n* are the quirks of §7.1, D*n* the deviations of §7.2.

**RNG.** `pre(n)` = `PreRandom(n)` (stream `pre`), `main(n)` = `Random(n)` (stream `main`), `chance(p)` = `main(100) < p`,
`fx(n)` = ja2-node's cosmetic stream. `n = 0` returns 0 and draws nothing (`sgp/Random.cc:63-84`). Every `pre` call also
refills the used ring slot from the `main` engine (`sgp/Random.cc:17-35`), so in the original every `pre` call advances `main`
too; ja2-node does the same (docs/01 §3.6).

**Constants.** `OKLIFE 15`, `CONSCIOUSNESS 10` (`Tactical/Overhead_Types.h:70-71`), `OKBREATH 10`,
`MIN_BLEEDING_THRESHOLD 12` (`Tactical/Soldier_Control.h:131`), `MAX_ALLOWABLE_MILITIA_PER_SECTOR 20`
(`Strategic/Town_Militia.h:13`), `MAX_STRATEGIC_TEAM_SIZE 20`, `RT_FIRST_AID_GAIN_MODIFIER 12` (`Tactical/RT_Time_Defines.h:11`),
native `NOWHERE = GRIDSIZE + 1 = 25601` (`TileEngine/Isometric_Utils.h:15`; ja2-node's soldier `NOWHERE` is −1, see §2.8.4).
Teams: OUR 0, ENEMY 1, CREATURE 2, MILITIA 3, CIV 4. Difficulty `DIF_LEVEL_EASY 1`, `MEDIUM 2`, `HARD 3` (`GameSettings.h:78-80`).
Sector `A9` = (x 9, y 1); a sector ID byte is `(y − 1)·16 + (x − 1)`.

**Clocks.** "World time" is the strategic clock in seconds/minutes (docs/15). "Battle ms" is AR's private clock
(`uiTotalElapsedBattleTimeInMilliseconds`), converted to world time only when AR closes (§2.16, §2.18).

**Ownership.** Specified elsewhere and only summarised here: when an arrival becomes an encounter and the bloodcat ambush
roll (docs/16, `CheckConditionsForBattle`, `TestForBloodcatAmbush`), travel times and the retreat trip itself (docs/16),
enemy strategic counts, garrisons and `ProcessQueenCmdImplicationsOfDeath` (docs/17), militia counts and promotions,
loyalty event values and their distance fan-out, doctoring (docs/18), the tactical end-of-battle core (docs/10 §8.2),
`BulletImpact`, armour, `HTHImpact`, `StatChange`, morale (docs/11 §4, §6.5, §9, §10), the prompts, commands, events and
the AR view of the agent API (`04` §6), the PBI panel and AR screen (`28`).

---

## 0. Overview

```
group arrival event (docs/15/16) ── CheckConditionsForBattle (docs/16) ─┬─ reinforcements into a running tactical battle (docs/16)
                                                                         ├─ bloodcat ambush / lair: notice box ──────────┐
                                                                         ├─ no conscious merc: notice box, AR auto-start ┤
                                                                         └─ a merc says QUOTE_ENEMY_PRESENCE (paused) ───┤
creature attack on a town sector (Creature_Spreading.cc) ────────────────────────────────────────────────────────────┤
                                                                                                                      ▼
                             InitPreBattleInterface(group, persistent = true): encounter code, buttons            §1
                               ├─ Autoresolve ─► AR setup ─► 1000 ms battle slices ─► end ─► bookkeeping ─► warp clock    §2
                               ├─ Enter sector ─► (placement GUI) ─► tactical battle ─► CheckForEndOfBattle         §3.2
                               └─ Retreat ─► involved groups head back; militia left? ─► AR without mercs; else +5 min  §1.5.3
tactical battle viewed from the map ─► non-persistent PBI: Go to sector, or Autoresolve for some codes              §1.4
tactical: every merc down or gone while militia still fight ─► non-persistent AR, auto-start, tactical enemies copied §3.3
after any battle: sector control (Player_Command.cc), loyalty, morale, militia, enemy counts, deaths, captures       §3
```

Invariants:
1. **No world time passes inside the PBI or AR.** The battle time is applied when AR closes, multiplied by 3 (+5 min on a
   retreat), as one jump that does not process events (§2.16, §2.18, docs/15).
2. **AR is a cell model.** Each side's cells attack on randomized timers; targets are picked with probability proportional to
   their defence; a hit runs the tactical `BulletImpact` without criticals or specials, or `HTHImpact` (§2.5–§2.9).
3. **Slice size matters.** The original sizes slices from the wall clock and the speed button; ja2-node always uses the
   original's "Finish" semantics, fixed 1000 ms slices, the only deterministic mode of the original (§2.6, §4.2, D1).
4. **Strategic bookkeeping happens when AR closes** (enemy deaths, militia deaths and promotions, merc deaths and captures,
   corpses, items), except the morale/loyalty/control block, which runs at the moment the battle ends (§2.16, §2.18).
5. **Every change of sector control goes through `SetThisSectorAsPlayerControlled` / `SetThisSectorAsEnemyControlled`**
   (`Strategic/Player_Command.cc:56-324`, §3.1).

---

## 1. The pre-battle interface (`Strategic/PreBattle_Interface.cc`)

### 1.1 State

Saved globals (`PreBattle_Interface.h:51-75`, "SAVE START … SAVE END"):

| Global | Meaning |
|---|---|
| `gfPersistantPBI` | `TRUE` for the real PBI before a battle; `FALSE` for the summary shown over a running tactical battle (§1.4) |
| `gubEnemyEncounterCode` | `NO_ENCOUNTER 0`, `ENEMY_INVASION 1`, `ENEMY_ENCOUNTER 2`, `ENEMY_AMBUSH 3`, `ENTERING_ENEMY_SECTOR 4`, `CREATURE_ATTACK 5`, `BLOODCAT_AMBUSH 6`, `ENTERING_BLOODCAT_LAIR 7` (`PreBattle_Interface.h:24-41`) |
| `gubExplicitEnemyEncounterCode` | superset for the non-persistent PBI: the codes above plus `FIGHTING_CREATURES 8`, `HOSTILE_CIVILIANS 9`, `HOSTILE_BLOODCATS 10` (declared `BOOLEAN`, holds these values) |
| `gfBlitBattleSectorLocator`, `gubPBSector` | a battle is going on in `gubPBSector` (map locator); used by `GetCurrentBattleSectorXYZ` |
| `gfCantRetreatInPBI` | the next PBI must disable Retreat (set by an intercepted retreating group, §1.2) |

Unsaved state used around it: `gpBattleGroup` (the initiating group, `NULL` for creatures), `gfAutomaticallyStartAutoResolve`,
`gfDelayAutoResolveStart` (`Strategic/Strategic_Movement.cc:65`), `gfHighPotentialForAmbush`, `gfAutoAmbush` (a cheat toggle,
`MapScreen.cc:2926`), `gfUsePersistantPBI`, `gfEnteringMapScreenToEnterPreBattleInterface`,
`gfTransferTacticalOppositionToAutoResolve` (`Auto_Resolve.cc:64`), `gubNumCreaturesAttackingTown`, `gubSectorIDOfCreatureAttack`,
`gubCreatureBattleCode` (`Creature_Spreading.cc`).

ja2-node keeps all of it as saved plain data: `StrategicState.encounter` (`EncounterState`,
`src/sim/strategic/forces/flow-state.ts`: the codes, the ambush, retreat and auto-start flags, `battleGroup`, the PBI
hand-off of docs/16), `StrategicState.battle` (`BattleState`, `forces/battle-state.ts`: `persistent`, `sector`, `locator`,
`autoStart`, `transferTacticalOpposition`, the post-AR globals, the open prompt and the AR session) and
`StrategicState.creatures.attack`.

### 1.2 What opens it

| # | Trigger | Where | PBI | Notes |
|---|---|---|---|---|
| 1 | A player group arrives where enemies are, or an enemy group arrives where mercs or militia are | `CheckConditionsForBattle` (`Strategic_Movement.cc:704-880`, docs/16) | persistent, `group` = the arriving group | see the three paths below |
| 2 | Bloodcat ambush or entering the known lair | `TestForBloodcatAmbush` (`:3263-3360`, docs/16) → `NotifyPlayerOfBloodcatBattle` (`:3363-3384`): message box, then `TriggerPrebattleInterface` | persistent | code set by the bloodcat test before the PBI |
| 3 | Creatures attack a town sector | `CreatureAttackTown` (`Creature_Spreading.cc:512-603`) | persistent, `group = NULL` → `CREATURE_ATTACK` | player groups in the unloaded sector → PBI; sector loaded in tactical → creatures added tactically, no PBI; militia only → PBI with auto-start; nobody → civilians eaten (loyalty, docs/18), no battle; enemy-controlled sector → nothing |
| 4 | In tactical every merc is dead or below `OKLIFE` while friendly militia (life ≥ `OKLIFE`) fight on, or every merc left the sector while militia and enemies remain | `CheckForLosingEndOfBattle` (`Tactical/Overhead.cc:4985-5000`), `CheckAndHandleUnloadingOfCurrentWorld` (`StrategicMap.cc:3051`) → `HandlePotentialBringUpAutoresolveToFinishBattle` (`StrategicMap.cc:2956-3000`) | **non-persistent**, auto-start | sets `gfTransferTacticalOppositionToAutoResolve`; code forced to `ENEMY_INVASION` unless `CREATURE_ATTACK` (§3.3) |
| 5 | On the map screen during a tactical battle in the loaded sector: a click on the battle sector while the locator is on, or an attempt to compress time | `MapScreen.cc:2475-2480`, `:6297-6310` | non-persistent | not when only hostile civilians are left (a message instead) |

Path 1 (`CheckConditionsForBattle`, docs/16 owns the conditions):
- **A conscious merc can talk** (dialog group has a merc with life ≥ `OKLIFE`, not robot, vehicle or EPC):
  `PrepareForPreBattleInterface(dialogGroup, group)` (`:608-694`) picks the speaker `mercs[main(count)]` (`:652` or `:679`),
  sets `gfCantRetreatInPBI` if the dialog group carries `GROUPFLAG_JUST_RETREATED_FROM_BATTLE` (`:647`, `:674`), queues
  `QUOTE_ENEMY_PRESENCE` with `FACE_TRIGGER_PREBATTLE_INT`, then `InterruptTime`, `PauseGame`, `LockPauseState`. When the face
  finishes talking, `Tactical/Dialogue_Control.cc:412-417` unlocks the pause state and calls `InitPreBattleInterface(group, true)`.
  An enemy group arriving into the loaded surface sector takes the same quote path; a tactical-traversal group gets no quote
  and no PBI, only the pause, because it enters the sector tactically (`:643-662`).
- **Nobody can talk but someone is alive** (only unconscious mercs, EPCs, the robot, or militia): `gfDelayAutoResolveStart =
  TRUE`, a message box (the invasion notice when militia are present, else `STR_DIALOG_ENEMIES_ATTACK_UNCONCIOUSMERCS`); on OK,
  `TriggerPrebattleInterface` (`:905-910`) → `InitPreBattleInterface(group, true)`. On the next map frames
  `HandlePreBattleInterfaceStates` (`PreBattle_Interface.cc:1429-1454`) first converts the delay flag into
  `gfAutomaticallyStartAutoResolve`, then `ActivateAutomaticAutoResolveStart` (`:1139-1144`) starts AR.
- **Nobody alive** (empty vehicle, all dead): no battle; enemies ignore it (`:829-833`).

`InitPreBattleInterface(…, true)` called while the tactical screen is up only stores the group and switches to the map
screen; `HandlePreBattleInterfaceStates` calls it again there (`:191-198`, `:1431-1442`). With `gfTacticalTraversal` and the
traversal group (or underground) it returns without a PBI (`:200-203`): the traversing group fights in tactical.

ja2-node: the movement code leaves the hand-off in `encounter.preBattle` and `BattleFlow` (`src/sim/campaign/battle-flow.ts`)
opens the PBI at the end of the step, without the quote time (D4); a delayed auto-start emits `preBattle {autoStart: true}`
and starts AR at once.

### 1.3 `InitPreBattleInterface(group, persistent)` in order (`:169-527`)

```
abort map route plotting (UI)
if PBI active: return
gfPersistantPBI = persistent
if persistent:
   locator on, header blink off
   if code ∉ {BLOODCAT_AMBUSH, ENTERING_BLOODCAT_LAIR} and !FACT_FIRST_BATTLE_FOUGHT: FACT_FIRST_BATTLE_BEING_FOUGHT = TRUE
   if tactical screen and (group or persistent): gpBattleGroup = group; go to the map screen; return      // re-entered there
   if gfTacticalTraversal and (group == traversal group or world z > 0): return
   gpBattleGroup = group; gubPBSector = group ? group.sector : SGPSector(gubSectorIDOfCreatureAttack)
else:                                                                                                      // :228-264
   explicit = HostileCiviliansPresent() ? HOSTILE_CIVILIANS
            : HostileBloodcatsPresent() ? HOSTILE_BLOODCATS
            : world z != 0 ? (SectorInfo[gubPBSector].creaturesInBattle ? FIGHTING_CREATURES        // surface record, sic
                             : any admins/troops/elites in battle ? ENTERING_ENEMY_SECTOR : unchanged)
            : code ∈ {ENTERING_ENEMY_SECTOR, ENEMY_ENCOUNTER, ENEMY_AMBUSH, ENEMY_INVASION,
                      BLOODCAT_AMBUSH, ENTERING_BLOODCAT_LAIR, CREATURE_ATTACK} ? code
            : (locator off; return)                                                                       // no PBI
select gubPBSector on the map; enter the map screen if in tactical; show teams (UI)
create the panel and buttons (UI); gfPreBattleInterfaceActive = TRUE
CheckForRobotAndIfItsControlled()             // :1370-1390, refresh robot_remote_holder
WakeUpAllMercsInSectorUnderAttack()           // :1281-1294, involved sleeping mercs: SetMercAwake(s, FALSE, TRUE)
count involved / uninvolved live, non-vehicle OUR soldiers (§1.6); for the first involved one:
   if !gpBattleGroup: gpBattleGroup = his group
   if his ubPrevSectorID == 255: CalculateGroupRetreatSector(his group)        // §3.5
   (bestExpLevel: `if (best > s.bExpLevel) best = s.bExpLevel` from 0, so it stays 0, :325)
if persistent: determine gubEnemyEncounterCode (below)
gfHighPotentialForAmbush = FALSE
if gfAutomaticallyStartAutoResolve: disable Enter and Retreat
StopTimeCompression()
if code == ENEMY_ENCOUNTER: SectorInfo[s].uiFlags |= SF_PLAYER_KNOWS_ENEMIES_ARE_HERE; gfResetAllPlayerKnowsEnemiesFlags = TRUE
button states and help texts (§1.4); options button off; music
```

**Encounter code** (persistent only, `:345-409`):
```
if !group:                         CREATURE_ATTACK
else if group.fPlayer:
  if code ∉ {BLOODCAT_AMBUSH, ENTERING_BLOODCAT_LAIR}:
    if NumStationaryEnemiesInSector(s) > 0:   ENTERING_ENEMY_SECTOR          // a garrison, roadblocks excluded (Queen_Command.cc:134-152)
    else:
      ENEMY_ENCOUNTER
      if gfHighPotentialForAmbush:
         if chance(90): ENEMY_AMBUSH                                          // main
      else if gfAutoAmbush and mobile > mercs: ENEMY_AMBUSH                   // cheat
      else if WhatPlayerKnowsAboutEnemiesInSector(s) == KNOWS_NOTHING and progress >= 30 − 5·difficulty:
         if mobile > mercs and !(SectorInfo[s].uiFlags & SF_ALREADY_VISITED):
            ch = u8(4 − 0 + 2·difficulty + progress/10)
            if SectorInfo[s].uiFlags & SF_ENEMY_AMBUSH_LOCATION: ch += 20
            if gfCantRetreatInPBI: ch += 20
            if pre(100) < ch: ENEMY_AMBUSH                                    // pre
else:                              // the enemy group initiated
  GetTownIdForSector(s) != BLANK_SECTOR or IsThisSectorASAMSector(s) ? ENEMY_INVASION : ENEMY_ENCOUNTER
```
`mobile` = `NumMobileEnemiesInSector` (`Queen_Command.cc:154-176`: enemy groups in the sector, plus the stationary troops when
the sector's garrison id equals `ROADBLOCK`, Q12), `mercs` = `PlayerMercsInSector`, `progress` =
`CurrentPlayerProgressPercentage()` (docs/17). `CheckConditionsForBattle` sets `gfHighPotentialForAmbush` when the arriving
player group carries `GROUPFLAG_HIGH_POTENTIAL_FOR_AMBUSH` (`Strategic_Movement.cc:791-796`); only `AllMercsWalkedToExitGrid`
sets that flag (`StrategicMap.cc:1618-1622`, `:3207-3222`: the group left through an exit grid from a sector with enemies
before combat started).

`WhatPlayerKnowsAboutEnemiesInSector` (`Strategic/Map_Screen_Interface_Map.cc:3511-3561`) returns `KNOWS_HOW_MANY` or
`KNOWS_THEYRE_THERE` as soon as an awake merc with life ≥ `OKLIFE`, not between sectors and not in the helicopter, stands in
the sector (`CanMercsScoutThisSector`, `:3565-3600`), and `WakeUpAllMercsInSectorUnderAttack` has just woken the involved
mercs. So the random-ambush branch runs only when every merc in the sector is below `OKLIFE` or aboard the helicopter
(inferred; V has the same check). Kept as written (Q2).

### 1.4 Codes, buttons and disabled reasons

Persistent PBI (`:445-484`):

| Code | Header | Autoresolve | Enter | Retreat | Placement GUI on Enter | AR player defence bonus |
|---|---|---|---|---|---|---|
| `ENEMY_INVASION` | enemy invasion | enabled | enabled | enabled¹ | no (the battle group is the enemy's) | 0 |
| `ENEMY_ENCOUNTER` | enemy encounter | enabled | enabled | enabled¹ | yes if a player group arrived; no if an enemy group arrived | **+21** (whoever arrived) |
| `ENEMY_AMBUSH` | ambush (blinks) | disabled: ambush (`gzNonPersistantPBIText[3]`) | enabled | disabled | no: mercs start at the map centre (`StrategicMap.cc:954-962`) | 0² |
| `ENTERING_ENEMY_SECTOR` | attacking a garrison | disabled: player-initiated attack (`STR_PB_DISABLED_AUTORESOLVE_FASTHELP`) | enabled | enabled¹ | yes | – |
| `CREATURE_ATTACK` | creature attack | enabled | enabled | disabled | no | 0 |
| `BLOODCAT_AMBUSH` | bloodcat ambush | disabled: ambush | enabled | disabled | no: map centre | – |
| `ENTERING_BLOODCAT_LAIR` | entering the lair | disabled: player-initiated attack | enabled | enabled¹ | yes | – |

¹ Retreat is also disabled when `gfAutomaticallyStartAutoResolve` or `gfCantRetreatInPBI` is set; disabling consumes
`gfCantRetreatInPBI` (reset to `FALSE`, `:473-481`). Enter is disabled when `gfAutomaticallyStartAutoResolve` (`:413-417`, `:469`).
² An auto-started AR ignores the button state (§1.5.1); with an ambush code `EnterAutoResolveMode` logs "illegal" and the
bonus stays 0 (`Auto_Resolve.cc:452-456`).

Non-persistent PBI (`:485-513`): Retreat always disabled ("battle in progress", `gzNonPersistantPBIText[0]`); Go to sector
always enabled; Autoresolve enabled only for the explicit codes `CREATURE_ATTACK`, `ENEMY_ENCOUNTER`, `ENEMY_INVASION`, and
disabled with a reason for `ENTERING_ENEMY_SECTOR` (`[3]`), `ENEMY_AMBUSH` (`[4]`), `FIGHTING_CREATURES` (`[5]`),
`HOSTILE_CIVILIANS` (`[6]`), the bloodcat codes (`[7]`). Escape closes the non-persistent PBI only.
`CalculateNonPersistantPBIInfo` (`:1147-1199`) recomputes the codes when the locator is off or elsewhere: hostile civilians,
bloodcats, else creatures in battle → `FIGHTING_CREATURES`, enemies in battle → `ENTERING_ENEMY_SECTOR` (both codes). It runs
when a soldier turns hostile or neutral (`Tactical/Overhead.cc:2564-2590`) and on loading a traversed sector
(`StrategicMap.cc:658-661`).

What the panel shows (`RenderPreBattleInterface`, `:745-944`; the `preBattle` prompt carries the same, `04` §6):
- sector; enemies: `?` for creature and bloodcat codes or unless `WhatPlayerKnowsAboutEnemiesInSector == KNOWS_HOW_MANY`
  (a stationary garrison always shows `?`), else `NumEnemiesInSector` (stationary + mobile, creatures excluded); involved mercs
  count; `CountAllMilitiaInSector`;
- involved mercs: name, assignment, condition (`GetSoldierConditionInfo`, `:1098-1112`: dead; dying = life < `OKLIFE` and
  bleeding; unconscious = breath < `OKBREATH` and collapsed; bleeding > 12; wounded < 50 % life; fatigued = breath < 50;
  fair < 67 %; good < 86 %; else excellent), HP % = `life·100/lifeMax`, BP % = `breath`;
- uninvolved mercs: name, assignment, location, destination, departure.

### 1.5 The three choices

#### 1.5.1 Autoresolve (`AutoResolveBattleCallback`, `:947-975`)
Sets `gfEnterAutoResolveMode`; at the end of the next `RenderPreBattleInterface` → `EnterAutoResolveMode(gubPBSector)`
(`:937-941`) → §2. ALT with the cheat level (persistent only) runs `EliminateAllEnemies` instead (§2.19).
`ActivateAutomaticAutoResolveStart` calls the callback directly, without checking whether the button is enabled.

#### 1.5.2 Enter sector (`GoToSectorCallback`, `:982-1046`)
```
if persistent and gpBattleGroup and gpBattleGroup.fPlayer and code ∉ {ENEMY_AMBUSH, CREATURE_ATTACK, BLOODCAT_AMBUSH}:
   gfEnterTacticalPlacementGUI = TRUE                              // deployment screen (TileEngine/Tactical_Placement_GUI.cc, docs/16)
s = gubPBSector with z = 0; if s == gWorldSector: gfGotoSectorTransition = TRUE
if persistent:
   PutNonSquadMercsInBattleSectorOnSquads(exitVehicles = TRUE)      // :1204-1279
   ClearMovementForAllInvolvedPlayerGroups()                       // clear paths and waypoints, :1297-1306
else: gpBattleGroup = NULL
SetCurrentWorldSector(gubPBSector)                                 // load the map and populate it (docs/16, docs/17)
KillPreBattleInterface()
```
`PutNonSquadMercsInBattleSectorOnSquads(exitVehicles)`, per involved group: a grounded helicopter group →
`MoveAllInHelicopterToFootMovementGroup`; otherwise every live, non-vehicle, involved member whose assignment is ≥ `ON_DUTY`
(any off-duty assignment, vehicle passengers included): in a vehicle group and `exitVehicles` → `TakeSoldierOutOfVehicle` and
`AddCharacterToSquad(first empty squad)` (one squad per vehicle group); in a vehicle group without `exitVehicles` → nothing;
else `AddCharacterToAnySquad`; then `MakeSoldiersTacticalAnimationReflectAssignment`. ja2-node has no placement GUI: the
mercs keep the automatic edgepoints (deviations.md "Tactical placement").

#### 1.5.3 Retreat (`RetreatMercsCallback`, `:1049-1085`)
```
RetreatAllInvolvedPlayerGroups()                                  // :1308-1323
HandleLoyaltyImplicationsOfMercRetreat(RETREAT_PBI, s)            // docs/18: militia present → ABANDON_MILITIA; MORALE_RAN_AWAY
if CountAllMilitiaInSector(s) > 0:
   gfEnterAutoResolveMode = TRUE; return                          // the militia fight on: AR with no mercs (§2)
WarpGameTime(300, WARPTIME_NO_PROCESSING_OF_EVENTS)                // +5 min (docs/15)
ResetMovementForEnemyGroupsInLocation()                           // §3.6
close the PBI; gpBattleGroup = NULL; locator off; music
```
`RetreatAllInvolvedPlayerGroups`: `PutNonSquadMercsInBattleSectorOnSquads(FALSE)`, then for every involved group except
vehicle groups without passengers: `ClearMercPathsAndWaypointsForAllInGroup`, `RetreatGroupToPreviousSector` (§3.5).
`HandleLoyaltyImplicationsOfMercRetreat` (`Strategic/Strategic_Town_Loyalty.cc:1187-1206`): militia in the sector →
`GLOBAL_LOYALTY_ABANDON_MILITIA`; then `MORALE_RAN_AWAY` (for `RETREAT_PBI` and `RETREAT_AUTORESOLVE` always; for a tactical
retreat only if enemies are present and `PlayerStrength·2 >= EnemyStrength`).

### 1.6 Who is involved (`:1329-1368`)

- `PlayerMercInvolvedInThisCombat(s)`: not between sectors; assignment ∉ {`IN_TRANSIT`, `ASSIGNMENT_POW`,
  `ASSIGNMENT_DEAD`}; not a vehicle; the robot only with a controller; not aboard an airborne helicopter;
  `s.sSector == GetCurrentBattleSectorXYZ()` (AR sector if AR is open, else the PBI sector if the PBI is open, else the
  loaded world, `Auto_Resolve.cc:3746-3769`). Unconscious mercs are involved.
- `PlayerGroupInvolvedInThisCombat(g)`: player group, size > 0, not between sectors, no in-transit, dead or POW members, not the
  airborne helicopter, in the battle sector.

### 1.7 Timing relative to the clock

- The arrival event fires at its minute (docs/15, docs/16). Before the PBI opens the game is paused (`PauseGame` and
  `LockPauseState` in `PrepareForPreBattleInterface`, `Strategic_Movement.cc:660-662`, `:681-683`; `CreatureAttackTown`
  `Creature_Spreading.cc:603-605`), the speaker's quote plays, and `InitPreBattleInterface` stops time compression. The paths
  that open the PBI without the quote rely on the message box and `StopTimeCompression` (inferred: at 1× the clock could tick
  under such a PBI); ja2-node freezes the clock under every `preBattle` prompt (D4).
- Under AR the world clock is frozen: `UpdateClock` returns at once outside the game and map screens (`Game_Clock.cc:602-607`).
  The battle time is applied when AR closes (§2.18).
- Retreat: the groups' arrival times are computed from the current minute, then the 300 s warp happens, so 5 minutes of the
  trip are spent at once (§3.5).
- Enter: time resumes in tactical (frozen during turn-based combat, docs/10 §8.4).

### 1.8 UI-only parts

The 1 s zoom transitions (`:530-622`, `Auto_Resolve.cc:364-411`, wall clock), the header blink (667 ms of each 1000), the
retreat arrows drawn while the mouse is over Retreat, help texts, music, sounds, button art. None of them changes state.

---

## 2. Autoresolve (`Strategic/Auto_Resolve.cc`)

### 2.1 Lifecycle

```
EnterAutoResolveMode(sector)                                  :413-458    status, slice, defence advantage
AutoResolveScreenHandle, first frame                          :471-498
  KillPreBattleInterface()
  CalculateAutoResolveInfo()                                  :2070-2128  enemy/militia/merc counts, merc cells     §2.3
  CalculateSoldierCells()                                     :616-733    alive counts, time modifier, cell classes §2.3
  CreateAutoResolveInterface()                                :1461-1610  militia/enemy/creature soldiers, groups,
                                                                           unload the battle sector if loaded        §2.4
  DetermineTeamLeader(TRUE), DetermineTeamLeader(FALSE)       :2414-2455                                             §2.5
  CalculateAttackValues()                                     :2469-2643  ratings and first timers                  §2.5
  DoTransitionFromPreBattleInterfaceToAutoResolve()           :364-411    UI only
every frame while IN_PROGRESS and no surrender is pending: ProcessBattleFrame()   :3522-3723                         §2.6
first render after the end: morale, loyalty, control, ×3     RenderAutoResolve :1271-1347                            §2.16
optional Bandage button: AutoBandageMercs()                   :1076-1149                                             §2.17
Done button: RemoveAutoResolveInterface()                     :1634-1840  bookkeeping, warp the clock               §2.18
map screen, following frames: HandlePostAutoresolveMessages() MapScreen.cc:7594-7630                                §2.18
```

### 2.2 State (logic fields only)

`SOLDIERCELL` (`:93-110`): `pSoldier`, `uiFlags`, `usAttack`, `usDefence` (u16), `usNextAttack` (u16 ms), `usNextHit[3]` (u16 ms),
`usHitDamage[3]` (u16), `pAttacker[3]` (cells), `bWeaponSlot` (i8). UI-only: mouse region, face object and index, position,
frame, flash time.

`AUTORESOLVE_STRUCT` (`:112-174`), logic fields: the u16 team sums `usPlayerAttack`, `usPlayerDefence`, `usEnemyAttack`,
`usEnemyDefence`; `ubPlayerLeadership`, `ubEnemyLeadership`; `ubSector`; `ubMercs` (≤ 20), `ubCivs` (≤ 20), `ubEnemies`
(≤ 32), `ubAdmins`, `ubTroops`, `ubElites`, four creature counts; `ubAliveMercs`, `ubAliveCivs`, `ubAliveEnemies`
(decremented only when a cell reaches life 0); `uiTotalElapsedBattleTimeInMilliseconds` (u32), `uiTimeSlice`,
`ubTimeModifierPercentage`; `ubBattleStatus` (`IN_PROGRESS 0`, `VICTORY 1`, `DEFEAT 2`, `RETREAT 3`, `SURRENDERED 4`,
`CAPTURED 5`, `:219-227`); `pRobotCell`; `ubPlayerDefenceAdvantage`; `fSound`, `fPlayerRejectedSurrenderOffer`,
`fPendingSurrender`, `fMoraleEventsHandled`, `fCaptureNotPermittedDueToEPCs`, `fPaused`. Never assigned:
`ubEnemyDefenceAdvantage` (0), `fAllowCapture` (`FALSE`), `fInstantFinish` (`FALSE`); `uiPreRandomIndex` is recorded at
entry and never used in Strac (V's debug replay restored it).

Cell flags (`:177-216`): `MERC`, `MILITIA`, `ELITE`, `TROOP`, `ADMIN`, `AF/AM/YF/YM_CREATURE`, `TEAMLEADER` (debug text only),
`FIREDATTARGET`/`DODGEDATTACK`/`HITBYATTACKER`/`HITLASTFRAME`/`SHOWRETREATTEXT`/`DIRTY` (UI), `RETREATING`, `RETREATED`,
`PROCESSED`, `ASSIGNED`, `EPC`, `ROBOT`. Groups: `PLAYER = MERC|MILITIA`, `ENEMY = ELITE|TROOP|ADMIN`, `CREATURE` = the four,
`FEMALECREATURE = AF|YF`, `MALECREATURE = AM|YM`.

ja2-node (`src/sim/strategic/forces/autoresolve/state.ts`): `AutoresolveState` is plain data with `mercs[]`, `militia[]`,
`enemies[]` (`ArCell`) in index order, the same flag values (`CellFlag`, `CellGroup`) and statuses (`BattleStatus`); a
cell reference (`pAttacker`, event targets) is `CellRef {side: 'merc' | 'militia' | 'enemy', index}`; `robot` is the
robot's merc index (−1 none). The created militia, enemy and creature soldiers live inside the cells (the original's heap
soldiers with id 255); merc cells hold the roster's soldiers, which AR mutates in place (life, bleeding, ammo, armour,
stats, profile counters). `uiPreRandomIndex`, `fSound`, `fInstantFinish`, `fPaused` and `ubTimeModifierPercentage` have no
counterpart.

### 2.3 Entry, counts and cell classes

`EnterAutoResolveMode` (`:413-458`): `gubCreatureBattleCode = NONE`; status `IN_PROGRESS`; `uiTimeSlice = 1000`; elapsed 0;
`fSound = TRUE`; player defence advantage: `ENEMY_ENCOUNTER` **21**, `ENEMY_INVASION` 0, `CREATURE_ATTACK` 0, anything else
logged, 0.

`CalculateAutoResolveInfo` (`:2070-2128`):
- Not a creature attack: `GetNumberOfEnemiesInSector` → admins, troops, elites = stationary + mobile groups (+ roadblock quirk,
  `Queen_Command.cc:179-228`, docs/17); `ubEnemies = min(sum, 32)`.
- Creature attack: if `gfTransferTacticalOppositionToAutoResolve`, `DetermineCreatureTownCompositionBasedOnTacticalInformation`
  (`Creature_Spreading.cc:758-790`: counts live in-sector creature-team soldiers by body; zeroes the sector's `ubNumCreatures`
  and `ubCreaturesInBattle`), else `DetermineCreatureTownComposition(gubNumCreaturesAttackingTown)` (`:744-756`: each creature
  independently from the `MINE_EXIT` weights, young male 10, young female 65, adult male 5, adult female 20 of 100,
  `std::discrete_distribution` on the main engine, `:707-741`; ja2-node: one weighted `main(100)` per creature, D5);
  `ubEnemies = min(sum, 32)`. The transfer flag is cleared.
- `ubCivs = CountAllMilitiaInSector(sector)`.
- Merc cells: for each group in group-list order with `PlayerGroupInvolvedInThisCombat`, each member in group order with
  `PlayerMercInvolvedInThisCombat`, appended (array of 20; more would overflow, D10). An EPC sets
  `fCaptureNotPermittedDueToEPCs`; the robot becomes `pRobotCell` and gets `UpdateRobotControllerGivenRobot`.

`CalculateSoldierCells` (`:616-733`), logic part:
- Alive counts start equal to the counts; each merc cell with life 0 decrements `ubAliveMercs`.
- Time modifier (Play speed only): `maxTeam = max(mercs + civs, enemies)`; `pct = maxTeam > 12 ? u8(118 − maxTeam·1.5) : 100`
  (double, truncated); `uiTimeSlice = 1000·pct/100`.
- Classes: merc cells `MERC` (+`ROBOT` for the robot, +`EPC` for other EPCs); militia cells `MILITIA`; enemy cell *i*: `i <
  elites` → `ELITE`, `i < elites + troops` → `TROOP`, else `ADMIN`; creature cell *i*: `< AF` → `AF`, `< AF + AM` → `AM`,
  `< AF + AM + YF` → `YF`, else `YM`. Elites/troops/admins here are the uncapped counts. The rows-and-columns layout
  (`CalculateRowsAndColumns`, `:2132-2283`) only permutes screen positions.

### 2.4 Soldiers for militia, enemies and creatures (`CreateAutoResolveInterface`, `:1461-1610`)

```
(load panel images, buttons, merc faces: UI)
elite, reg, green = MilitiaInSectorOfRank(sector, ELITE / REGULAR / GREEN)
while elite + reg + green < civs: switch pre(3) { 0: elite++; 1: reg++; 2: green++ }     // only when the counts disagree
for i in 0 .. civs−1:
   ResetMortarsOnTeamCount()                                                             // docs/12 equipment limits
   cls = i < elite ? ELITE_MILITIA : i < elite + reg ? REG_MILITIA : GREEN_MILITIA
   militia[i].soldier = TacticalCreateMilitia(cls); sector = AR sector; name "Militia"
if not a creature attack:
   ubElites × TacticalCreateEnemySoldier(ELITE), then ubTroops × (ARMY), then ubAdmins × (ADMINISTRATOR)    // uncapped: D3
   AssociateEnemiesWithStrategicGroups()
else:
   AF × TacticalCreateCreature(ADULTFEMALEMONSTER), AM × (AM_MONSTER), YF × (YAF_MONSTER), YM × (YAM_MONSTER)
if sector == gWorldSector and z == 0: CheckAndHandleUnloadingOfCurrentWorld()                 // §3.3
else: locator off
(build the panel, buttons; Retreat disabled when ubMercs == 0)
```

Soldier creation (`Tactical/Soldier_Create.cc`), with `guiCurrentScreen == AUTORESOLVE_SCREEN` and `IsAutoResolveActive()`:
- **`TacticalCreateMilitia(cls)`** (`:1799-1816`): `RandomizeRelativeLevel` for attributes, then for equipment; team
  `MILITIA`, orders `STATIONARY`, attitude `main(MAXATTITUDES)`, body random; `CreateDetailedPlacementGivenBasicPlacementInfo`;
  `TacticalCreateSoldier`, whose AR branch allocates a free-standing soldier with id 255 (`:142-147`), skips the enemy
  camouflage roll (`:321`) and returns before `CreateSoldierCommon`/`AddManToTeam` (`:436-440`).
- **`TacticalCreateEnemySoldier(cls)`** (`:1754-1797`): if the PBI is non-persistent, `ReserveTacticalSoldierForAutoresolve(cls)`
  (`:1721-1751`): the first in-sector live tactical soldier of that class (team order) whose gridNo is not `NOWHERE` is marked
  (gridNo := `NOWHERE`) and copied with its exact life, stats and inventory; no draws. Otherwise `RandomizeRelativeLevel` ×2,
  orders `SEEKENEMY`, attitude `main(MAXATTITUDES)`, body random, placement; for elites
  `OkayToUpgradeEliteToSpecialProfiledEnemy` (Mike/Iggy, only when the code is neither `ENEMY_ENCOUNTER` nor
  `ENEMY_INVASION`, `:2068-2085`); create; then `sNoiseGridno = 13202 + (main(61) − 30) + (main(61) − 30)·160` (ja2-node draws
  the x term first).
- **`TacticalCreateCreature(body)`** (`:1818-1835`): non-persistent → reserved copy; else `RandomizeRelativeLevel` ×2,
  `SEEKENEMY`, `AGGRESSIVE`, the given body.
- **`RandomizeRelativeLevel(&lvl, cls)`** (`:1842-1925`): `loc = GetLocationModifier()` (`:2100-2134`: palace distance 4 in Orta
  and Tixa, 10 in Alma, else `min(round(hypot(x − 3, y − 16)), 20)` from P3; `loc = (20 − dist)·30/20`); `roll = main(10) +
  loc/3 − 5`; militia: clamp 1..8, then **+1 under AR**; others: clamp 0..9, then **−1 under AR** if > 0; level = 0 for 0,
  1 for 1–2, 2 for 3–6, 3 for 7–8, 4 for 9.
- The rest is the normal creation path (stats, experience level with `ReduceHighExpLevels`, equipment via
  `GenerateRandomEquipment`, palettes, battle sound `main(3)`, …; docs/06, docs/12) with `GetCurrentBattleSectorXYZ` = the AR
  sector.

ja2-node: `src/sim/tactical/creation-basic.ts` (`tacticalCreateMilitiaForAutoresolve`, `tacticalCreateEnemySoldierForAutoresolve`,
`tacticalCreateCreatureForAutoresolve`, id `AUTORESOLVE_SOLDIER_ID` 255, `reserveTacticalSoldierForAutoresolve`,
`resetMortarsOnTeamCount`) builds the basic placement and runs the shared `createFromPlacementParts` with the AR population
flag; `randomizeRelativeLevel` is in `src/sim/tactical/init-list.ts`, `locationModifier` in `src/sim/strategic/ai/difficulty.ts`.
When the reserved copies of a class run out, the missing cells are created fresh (D9).

`AssociateEnemiesWithStrategicGroups` (`:524-607`, not for creatures): first the stationary garrison: for enemy cells in index
order, a cell whose class still has a stationary counter left takes one (`ELITE` → `ubNumElites`, …), group 0, `ASSIGNED`. Then
for each enemy group in the sector (group-list order), for every unassigned cell in index order: if both the remaining
mobile elites and the group's elites are non-zero, take an elite slot; else a troop slot; else an admin slot; else skip; the
cell gets the group's id. The second phase **does not look at the cell's class** (Q16): a troop cell can fill a group's elite
slot. The group id decides which strategic record loses the soldier when he dies (§2.18, docs/17).

### 2.5 Ratings

`DetermineTeamLeader` (`:2414-2455`): `ubPlayerLeadership` = the highest raw `bLeadership` over all merc cells (dead ones, EPCs and
the robot included) and then all militia cells; `ubEnemyLeadership` = the highest over the enemy cells. The `TEAMLEADER` flag is
debug output.

`CalculateAttackValues` (`:2469-2643`) uses raw soldier fields, not the `Effective*` functions:
```
for i in 0 .. mercs−1, skipping cells with life == 0 (no rating, no timer, no draw):
   att = str + dex + wis + mrk + morale
   if att < 1000: att = att + (1000 − att)/4                     // "500 → 625"
   att = att · (100 − (100 − breathMax)/3) / 100
   def = agi + wis + breathMax + med + morale
   bonus = 100 + playerLeadership/10 + playerDefenceAdvantage
   att = att·bonus/100; def = def·bonus/100
   if EPC (not the robot): att = 0; def = 1000
   att = min(att, 1000); def = min(def, 1000)
   playerAttack += att; playerDefence += def
   resetNextAttackCounter(cell)
   if i > 8: next += (i − 8)·2000
for i in 0 .. civs−1:
   att = (str + dex + wis + mrk + morale) · breath / 100           // current breath, no merc boost
   def = agi + wis + breathMax + med + morale
   bonus = 100 + playerLeadership/10 + playerDefenceAdvantage; scale; cap at 1000; add to the player sums
   resetNextAttackCounter(cell)
   if i > 6: next += (i − 4)·2000                                  // sic: i − 4 (Q6)
for i in 0 .. enemies−1:
   same as militia, with enemyLeadership and enemyDefenceAdvantage (0)
   if i > 4 and not a creature: next += (i − 4)·1000
best = min(next over every rated cell); best = best·60/100
every cell (unrated dead merc cells too, whose 0 wraps): next = u16(next − best)
```
`resetNextAttackCounter(c)` (`:2458-2466`):
```
n = min(1000 − c.att, 800)
c.next = u16(1000 + 5·n + pre(2000 − c.att))                       // 1000 .. 6999
if creature(c): c.next = c.next·8/10
```
Example: a merc with str, dex, wis, mrk 80, morale 50, breathMax 100, agi 80, med 30, team-best leadership 80, under
`ENEMY_ENCOUNTER`: att 370 → 527 → 527 → ×129/100 = 679; def 340 → 438. A militiaman with the same five attack stats and
breath 50: att 185 → 238.

### 2.6 The battle loop

#### 2.6.1 The original (`ProcessBattleFrame`, `:3522-3723`)

Called once per screen frame. The first call only records `GetJA2Clock()`. Afterwards
`iTimeSlice = (now − prev)·uiTimeSlice/1000` wall ms × speed, where `uiTimeSlice` is `1000·pct/100` for Play (the default),
4000 for Fast, and `0xffffffff` for Finish, which makes `iTimeSlice = 0x7fffffff` (`:3565-3572`). The frame processes slices
of `min(iTimeSlice, 1000)` battle ms; Play and Fast subtract 1000 per slice, Finish never does (`:3718-3721`), so Finish runs
1000 ms slices until the battle ends. A frame stops early, keeping its loop variables in statics, when more than 17 wall ms
have passed (not in Finish) or when more than `(mercs + civs + enemies)/4` attacks were made this frame (`fInstantFinish` is
never set), and resumes inside the same slice at the next frame (`goto CONTINUE_BATTLE`, which also skips the pause check).
Finish also clears `fSound` for good (`:1883-1892`).

In Play and Fast the slice length is the frame time (≈25 ms at Stracciatella's default `target_fps` 40) times the speed, so
the outcome depends on the frame rate, and retreat clicks land between frames, at wall-clock moments. Finish is
deterministic: every slice is exactly 1000 ms and the early stops resume in the same slice.

#### 2.6.2 ja2-node's schedule (= Finish)

```
runAutoresolve(ar):                                 // until the battle ends, a surrender offer opens or the slice budget ends
  while ar.status == IN_PROGRESS and !ar.pendingSurrender:
     apply queued retreat orders (§2.11)             // between slices only
     slice(ar)

slice(ar):
  ar.elapsedMs += 1000                               // added at the start of every slice while IN_PROGRESS
  total = mercs + civs + enemies; mLeft = mercs; cLeft = civs; eLeft = enemies
  clear PROCESSED on every cell
  for k = total down to 1:                           // `while (--iTotal)` from total + 1
     if isBattleOver(ar): return                      // §2.12
     if code != CREATURE_ATTACK and attemptPlayerCapture(ar): return     // §2.13; abandons the rest of the slice
     r = pre(k)
     if mercs > 0 and r < mLeft:               mLeft−−; c = pick(merc cells)
     else if civs > 0 and r < mLeft + cLeft:   cLeft−−; c = pick(militia cells)
     else if enemies > 0 and eLeft > 0:        eLeft−−; c = pick(enemy cells)
     process(c, 1000)                                 // §2.6.3

pick(cells): repeat { c = cells[pre(cells.length)] } until !c.PROCESSED; c.PROCESSED = TRUE; return c
```
Every cell, dead or alive, is picked exactly once per slice; dead cells still cost draws. The rejection loop draws a variable
number of `pre` values. A capture check that returns `TRUE` without ending the battle (failed roll) abandons the slice: the
next slice starts with a fresh +1000 ms, exactly like the original's next frame in Finish mode.

#### 2.6.3 Processing a picked cell (`:3653-3716`)

```
process(c, slice):
  if !c.RETREATED:
     for j in 0..2:
        if c.nextHit[j] != 0:
           t = c.nextHit[j] − slice
           if t >= 0: c.nextHit[j] = t
           else: targetHit(c, j); c.nextHit[j] = 0                      // §2.9
  if (c.life < OKLIFE or c.RETREATED) and (!creature(c) or c.life == 0): return    // live creatures act at any life
  t = c.nextAttack − slice
  if t > 0: c.nextAttack = t; return
  if c.RETREATING:                                                      // the retreat completes
     if c is the robot cell and the robot has no controller:
        clear RETREATING; c.nextAttack = 0xffff; return
     playerDefence −= c.def; c.def = 0; c.RETREATED = TRUE; return
  if c.att == 0: return                                                 // EPCs, cells ordered to retreat; timer not stored
  target = chooseTarget(c)                                              // §2.7
  if creature(c) and pre(100) < 7: smell sound (no attack)              // creatures skip 7 % of their turns
  else: attackTarget(c, target)                                         // §2.8
  resetNextAttackCounter(c)
  c.nextAttack = u16(c.nextAttack + u16(t))                             // t ≤ 0: carry the overshoot
```
- A retreated cell's pending bullets never land. Unconscious non-creature cells still receive bullets.
- With 1000 ms slices a pending bullet (50–449 ms) lands at the target's next pick: in the same slice if the target is picked
  later, otherwise in the next one.
- A creature whose reset value is below 1000 (attack rating above ≈960) can end up with `nextAttack + t < 0`, which wraps to
  ≈65 000 ms (inferred edge, never seen with real creature stats).

### 2.7 `ChooseTarget` (`:2697-2761`)

```
enemy or creature attacker: candidates = merc cells, then militia cells (index order); pool = playerDefence
player-side attacker:       candidates = enemy cells;                              pool = enemyDefence
saved = pool
for each candidate:
   skip if life == 0, or (player-side candidate) RETREATED
   r = pre(pool); pool = u16(pool − cand.def)
   if r < cand.def: pool = saved; return cand
none found: the original logs an assertion and returns NULL (only with inconsistent sums; D8)
```
The pick is proportional to defence along the order: high-defence cells draw fire. EPCs (defence 1000) and unconscious mercs
(their defence stays in the sum) are attractive targets; `RETREATING` cells are valid targets.

### 2.8 `AttackTarget` (`:2848-3082`)

```
attackTarget(a, t):
  atk = a.att < 950 ? a.att + pre(1000 − a.att) : 950 + pre(50)                 // :2864-2867
  if t.RETREATING and !femaleCreature(a): atk = atk·7/10
  def = t.def < 950 ? t.def + pre(1000 − t.def) : 950 + pre(50)                 // :2873-2876
  if femaleCreature(a): a.weaponSlot = HANDPOS; melee = claw = TRUE
  else if !fireAShot(a):                                                         // §2.8.1
     melee = TRUE; a.weaponSlot = FindObjClass(a, IC_BLADE); knife = a.weaponSlot != NO_SLOT
     if targetHasLoadedGun(t) and !creature(a): atk = atk·(knife ? 6 : 4)/10    // §2.8.2
  if !melee:                                                                     // reserve a bullet slot on the target
     j = first j with t.nextHit[j] == 0, else −1
     if j != −1: t.nextHit[j] = 50 + pre(400); t.attacker[j] = a; t.hitDamage[j] = 0     // :2915-2918
  if atk < def:
     if t.life >= OKLIFE or pre(5) == 0:                                          // pre(5) only for targets below OKLIFE
        miss: melee sound draws (§4.3); if melee and merc(t) and t.life >= OKLIFE: StatChange(t, AGILAMT, 5, FROM_SUCCESS)
        return                                                                   // a gun miss lands later as damage 0
     // else a forced hit on an unconscious target (4 in 5)
  if !melee:                                                                     // gun, or male-creature spit
     impact = weaponModel(a.inv[a.weaponSlot]).ubImpact
     r = pre(100); loc = r < 15 ? HEAD : r < 30 ? LEGS : TORSO
     acc = calcHitAccuracy(atk, def, t)                                          // §2.8.3
     dmg = bulletImpact(a, t, loc, impact, acc, special = NULL)                  // §2.8.4
     if j == −1: t.hitDamage[2] += dmg else t.hitDamage[j] = dmg                 // applied when the bullet lands, §2.9
  else:
     impact sound draw (§4.3)
     if t.life == 0: return
     acc = calcHitAccuracy(atk, def, t)
     a.usAttackingWeapon = a.weaponSlot != −1 and isWeapon(a.inv[a.weaponSlot]) ? that item : 0
     dmg = hthImpact(a, t, acc, blade = knife or claw)                            // §2.8.4
     newLife = t.life − dmg
     if merc(a): profile(a).usShotsHit++; StatChange(a, MARKAMT, 6, FROM_SUCCESS)
     if merc(t): profile(t).usTimesWounded++; StatChange(t, EXPERAMT, 5·(dmg/10), FROM_SUCCESS)
     battle sound if fSound and (t.life >= CONSCIOUSNESS or creature(t))
     if !creature(t) and newLife < OKLIFE and t.life >= OKLIFE: fall sound; clear t.RETREATING
     if newLife <= 0:
        if merc(a): profile(a).usKills++; gStrategicStatus.usPlayerKills++        // no XP, morale or assists for melee kills
        else if militia(a): a.ubMilitiaKills += 2
        death sounds if merc(t) and fSound
     t.life = max(newLife, 0); if merc(t) and a robot cell exists: UpdateRobotControllerGivenRobot
     if knife or claw:
        t.bleeding = t.lifeMax − t.bleeding − dmg >= t.life ? t.bleeding + dmg : t.lifeMax − t.life
     if t.life == 0: removeFromTotals(t)                                          // §2.10
```
The `StatChange` calls draw `pre` (docs/11 §10): they are part of the RNG order.

#### 2.8.1 `FireAShot` (`:2765-2810`)
```
if maleCreature(a): a.weaponSlot = SECONDHANDPOS; return TRUE                    // spit: no ammo
for slot in 0 .. NUM_INV_SLOTS−1:
   o = a.inv[slot]; if itemClass(o) != IC_GUN: continue
   a.weaponSlot = slot
   if o.ubGunShotsLeft == 0: AutoReload(a)                                       // reloads HANDPOS only (Tactical/Items.cc:1418-1463)
   if o.ubGunShotsLeft > 0:
      if merc(a): profile(a).usShotsFired++; StatChange(a, MARKAMT, 3, FROM_SUCCESS)
      o.ubGunShotsLeft−−; return TRUE
a.weaponSlot = −1; return FALSE
```
- The first gun in slot order fires, pockets included, but only the gun in `HANDPOS` is ever reloaded: a pocket gun stops at
  its last shot (Q9).
- No AP cost, no jams, no condition loss, no bursts, one bullet per attack. `IC_LAUNCHER` items (grenade launchers, mortars)
  are not guns and never fire. The LAW is an `IC_GUN` whose reload always fails (`ReloadGun`, `Items.cc:1093`); it fires while
  its counter is above 0 (inferred).
- `AutoReload` → `ReloadGun` with `INCOMBAT` clear (no AP check, top-off rules of real time, `Items.cc:1082-…`): magazines are
  consumed from the inventory (docs/12). The second-gun reload inside `AutoReload` checks `EnoughPoints` against the soldier's
  leftover APs (inferred). ja2-node: `autoReload` and `findAmmoToReload` in `src/sim/tactical/combat/reload.ts`.

#### 2.8.2 `TargetHasLoadedGun` (`:2821-2836`)
Any inventory slot of the target holds an `IC_GUN` with shots left.

#### 2.8.3 `CalcHitAccuracy` (`:2841-2845`)
`margin = atk − def + pre(max(def − t.def, 0)); acc = u8(max(margin, 0)/10)`, where `def` is the rolled defence and `t.def` the
target's rating. Strac fixes V, which let negative margins wrap and could pass a negative range (`V AutoResolve.c:3393`).

#### 2.8.4 `BulletImpact` and `HTHImpact` under AR
`BulletImpact(a, t, loc, impact, acc, NULL)` (`Tactical/Weapons.cc:2743-3116`, docs/11 §4.2) behaves like this in AR:
- Ammo type = `a.inv[a.ubAttackingHand].ubGunAmmoType`: the attacking hand, not the slot that fired (`HANDPOS` for created
  soldiers, the last tactical value for mercs); the throwing-knife test reads `a.usAttackingWeapon` (0 for created soldiers;
  whatever a merc last used, or the last AR melee weapon). Q10.
- `pre(51) − 25` fluke, `+acc/2 %`; armour via `TotalArmourProtection` with one `pre(100)` per piece consulted; armour wear
  and destruction persist (docs/11 §4.3).
- The head and torso instant kills need `PythSpacesAway(a.gridNo, t.gridNo) ≤ 7`. Every AR soldier is off the map: created
  soldiers start at `NOWHERE`, reserved tactical enemies are set to `NOWHERE` before the copy, and mercs leave the grid when the
  world unloads (`RemoveSoldierFromGridNo`, `Tactical/Soldier_Control.cc:1771-1792`). Both at 25601 → distance 0 → always
  "close": head `crit > 55 && crit < life`, torso `dmg > 55 && dmg < life`, or torso `dmg + sDamage > 85` → `life + main(10)`.
  `sDamage` is 0 for created soldiers and leftover for mercs and copies (inferred, §8).
- `pubSpecial == NULL` skips the head-explosion and leg-fall branches with their `pre` draws, and the chest-explosion flag.
- The stealth-knife kill and the critical stat loss sit under `!IsAutoResolveActive()`: never in AR.

`HTHImpact(a, t, acc, blade)` (`Weapons.cc:3119-3167`, docs/11 §6.5): `EffectiveExpLevel/2`, then blade: `+EffectiveStrength/20
+ weapon impact` (robot target /4); punch: `+EffectiveStrength/5`, `+ weapon impact` with a non-martial weapon (robot /2), else
`+5` (robot 0); `·(100 + pre(51) − 25 + acc/2)/100`; martial-arts and hand-to-hand multipliers. In AR the result is life
damage, not breath (tactical punches hit breath).

ja2-node: `bulletImpact`, `hthImpact`, `totalArmourProtection` and `statChange` take a `CombatContext`
(`src/sim/tactical/combat/context.ts`: content, `pre`, `rng`, optional cosmetic `fx`, profiles, combat flag, attack-busy
count, stat events), which `TacticalState` satisfies structurally and AR builds per call (`combatContext` in `state.ts`).
`bulletImpact` takes an `ImpactMode`: `TACTICAL_IMPACT`, or `AUTORESOLVE_IMPACT` = `{specials: false, criticals: false,
close: true}` (no specials, no criticals or stealth-knife kill, "close" passed explicitly because ja2-node's `NOWHERE` is
−1, D6).

### 2.9 `TargetHitCallback`: a bullet lands (`:3085-3264`)

```
targetHit(t, j):
  if t.life == 0: return
  a = t.attacker[j]
  by t.body: YAF/YAM hitDamage[j] = (d + 2)/4; AF/AM (d + 3)/6; QUEENMONSTER (d + 4)/8; larvae and infants unchanged
  d = t.hitDamage[j]; newLife = t.life − d
  if d == 0:                                           // a miss, or a hit absorbed to 0 (HP ammo, creature reduction)
     if merc(t) and t.life >= OKLIFE: StatChange(t, AGILAMT, 5, FROM_SUCCESS)
     miss sound draw; return
  if merc(a): profile(a).usShotsHit++; StatChange(a, MARKAMT, 6, FROM_SUCCESS)
  if merc(t): profile(t).usTimesWounded++; StatChange(t, EXPERAMT, 5·(d/10), FROM_SUCCESS)
  impact sound draw; battle sound if fSound and t.life >= CONSCIOUSNESS
  if newLife < OKLIFE and t.life >= OKLIFE: fall sound; clear t.RETREATING
  if newLife <= 0:
     if a is player-side:
        k = a; as1 = t.attacker[(j + 1) % 3]; as2 = t.attacker[(j + 2) % 3]
        if as1 == k: as1 = null;  if as2 == k: as2 = null;  if as1 == as2: as2 = null
        merc(k):    profile(k).usKills++; usPlayerKills++; StatChange(k, EXPERAMT, 10·t.bLevel, FROM_SUCCESS);
                    HandleMoraleEvent(k, MORALE_KILLED_ENEMY, sector)
        militia(k): k.ubMilitiaKills += 2
        the first non-null of as1, as2: merc → usAssists++, StatChange(EXPERAMT, 5·t.bLevel); militia → ubMilitiaKills += 1
     death sounds; if newLife < −60 and !creature(t) and fSound: pre(3) picks the splat sound    // Q5, §4.3
  t.life = max(newLife, 0); robot controller refresh if merc(t) and a robot cell exists
  t.bleeding = t.lifeMax − t.bleeding − d >= t.life ? t.bleeding + d : t.lifeMax − t.life        // with the new life
  if t.life == 0: removeFromTotals(t)
```
- `t.bLevel` is the map level (0 ground, 1 roof), not the experience level (`bExpLevel`, which tactical uses,
  `Tactical/Overhead.cc:2501`, `:2512`): kill and assist XP is 0 chances for created soldiers (V too, Q3).
- Assist slots are stale pointers: whoever last used those slots, possibly long resolved. Only one assist is credited.
- A fourth bullet while all three slots are pending adds its damage to slot 2 and is credited to slot 2's attacker, even if
  slot 2 was a miss (Q8). Strac resets `hitDamage[j]` when a slot is reused (`:2917-2918`; V let a miss land with a stale
  damage value).

### 2.10 Deaths and the team totals

`removeFromTotals(c)` (`:3051-3080`, `:3233-3261`): merc or militia: `playerAttack −= att`, `playerDefence −= def`, alive count
−1; enemy or creature: the enemy sums, `ubAliveEnemies −= 1`; `att = def = 0`. Only at life 0: an unconscious cell keeps its
defence in the sums and stays a target. AR changes no breath and no morale (except `MORALE_KILLED_ENEMY`), and bleeding
does not drain life during the battle.

### 2.11 Retreat orders

Retreat all (`RetreatButtonCallback`, `:1895-1927`; enabled only when `ubMercs > 0`):
```
for each merc cell not RETREATING or RETREATED:                // dead and unconscious cells included
   RETREATING; c.next = u16((1000 + 2·c.next + pre(2000 − c.att))·2); playerAttack −= c.att; c.att = 0
if a robot cell exists:
   no controller: clear robot RETREATING; robot.next = 0xffff
   else: robot.next = the controller cell's next
```
One merc (`MercCellMouseClickCallback`, `:2016-2062`; not while a surrender offer is pending; not for the robot):
```
if RETREATING or RETREATED: ignore
RETREATING; c.next = u16((1000 + 5·c.next + pre(2000 − c.att))·2); playerAttack −= c.att; c.att = 0     // 5·, not 2·
if a robot cell exists: no controller → robot not retreating, next 0xffff;
                        this merc is the controller → robot RETREATING, same next, robot attack removed
```
- `c.next` is the current remaining timer; the products overflow and wrap (a late-entry cell with a large timer can get a
  short one, Q7).
- A cell ordered to retreat stops attacking at once; it is still a target, at 70 % attack against it (§2.8), until its timer
  expires and it becomes `RETREATED` (§2.6.3).
- A cell that falls unconscious loses `RETREATING` (§2.8, §2.9) but keeps attack 0. A dead or unconscious cell ordered to
  retreat never completes it (it is skipped before the timer), yet attacks against it suffer the 70 % factor (Q11).
- ja2-node: orders are queued (`orderRetreat`, `end.ts`) and applied between slices (D1); the command is `04` §6.

### 2.12 `IsBattleOver` (`:3267-3352`)

```
if status != IN_PROGRESS: return TRUE
retreated = involved = 0; onlyEPCs = TRUE
for each merc cell: if RETREATED: retreated++
                    else if life != 0 and !EPC: onlyEPCs = FALSE; involved++        // unconscious mercs count
if robot cell and robot has no controller:
   playerAttack −= robot.att; robot.att = 0
   if involved == 1 and aliveCivs == 0:                                             // "the robot is the last one"
      robot death sound (main, not gated by fSound); robot.life = 0; aliveMercs−−; involved = 0; onlyEPCs = TRUE
if aliveCivs == 0 and involved == 0 and retreated > 0:
   status = RETREAT; WakeUpAllMercsInSectorUnderAttack(); RetreatAllInvolvedPlayerGroups()       // §3.5, at once
else if aliveCivs == 0 and involved == 0:
   if onlyEPCs: each live EPC cell: death sound (main); life = 0;  aliveMercs = 0
   first live enemy: laugh (main) or creature eat sound
   status = DEFEAT
else if aliveEnemies == 0: status = VICTORY
else: return FALSE
SetupDoneInterface(); return TRUE                                                   // UI: Done/Bandage buttons
```
- Victory needs every enemy cell at life 0; unconscious enemies keep the battle going (they do not attack unless creatures).
- Defeat and retreat need every non-retreated, non-EPC merc dead: unconscious mercs keep the battle going and keep being shot
  at (80 % forced hits, §2.8) unless a capture ends it (§2.13). If any merc retreated, the end is `RETREAT`, never `DEFEAT`.
- The robot branch also fires when the robot is already dead and the lone remaining merc is its unconscious controller: the
  dead robot is "killed" again, `aliveMercs` drops twice and the battle ends while that merc is alive (inferred edge, Q21).
- Militia keep the battle going while any is alive (`aliveCivs` counts unconscious militia).
- There is no time limit, no morale check and no enemy retreat in AR: only the player side can retreat, and the battle runs
  until one of the endings above (or a capture) happens. A battle where nobody can act (only unconscious mercs against only
  unconscious human enemies) never ends; ja2-node's `runAutoresolve` stops at the caller's slice budget (`'budget'`), and
  the campaign has no rule for it (deviations.md "Autoresolve stalemate").

### 2.13 Capture and surrender (`AttemptPlayerCapture`, `:3359-3433`)

Called before every pick (after `isBattleOver`), except in creature attacks:
```
if worldDay < 4 and !fAllowCapture: return FALSE                       // STARTDAY_ALLOW_PLAYER_CAPTURE_FOR_RESCUE 4: capture from day 4
if fPlayerRejectedSurrenderOffer: return FALSE
if gStrategicStatus.uiFlags & STRATEGIC_PLAYER_CAPTURED_FOR_RESCUE: return FALSE        // once per game (EndCaptureSequence)
if fCaptureNotPermittedDueToEPCs: return FALSE
if aliveCivs > 0 or aliveMercs < 2 or aliveMercs > 3: return FALSE      // aliveMercs includes unconscious and retreated cells
if aliveEnemies < 2·aliveMercs: return FALSE
if (enemy cells with life >= OKLIFE) < 2·aliveMercs: return FALSE
conscious = FALSE
for each merc cell (dead and retreated included):
   if ROBOT: return FALSE
   if life·100 > lifeMax·60: return FALSE
   if life >= OKLIFE: conscious = TRUE
if conscious: if pre(100) < 2: open the surrender offer (fPendingSurrender)
else if pre(100) < 25: BeginCaptureSquence(); status = CAPTURED
return TRUE                                                             // also when the roll failed: the slice is abandoned
```
While the offer is pending the loop does not run (`:494-498`). Accept (`:3499-3509`): `BeginCaptureSquence`, status
`SURRENDERED`. Reject (`:3512-3519`): `fPlayerRejectedSurrenderOffer = TRUE`, no further capture checks this battle.
Each failed roll costs a fresh 1000 ms slice under Finish semantics (§2.6.2), so a stalled capture check adds battle time
(2 % per slice with a conscious merc: about 50 s of battle time, ×3 at the end).

### 2.14 Experience, stats and profile counters

| When | Who | Effect |
|---|---|---|
| Gun shot fired | merc attacker | `usShotsFired++`, `StatChange(MARKAMT, 3)` (§2.8.1) |
| Bullet lands with damage > 0 | merc attacker (slot owner) | `usShotsHit++`, `StatChange(MARKAMT, 6)` |
| Melee hit | merc attacker | `usShotsHit++`, `StatChange(MARKAMT, 6)` |
| Wounded (gun on landing, melee at once) | merc target | `usTimesWounded++`, `StatChange(EXPERAMT, 5·(dmg/10))` |
| Bullet lands with damage 0, or a melee miss | merc target with life ≥ `OKLIFE` | `StatChange(AGILAMT, 5)` |
| Gun kill | merc killer | `usKills++`, `usPlayerKills++`, `StatChange(EXPERAMT, 10·bLevel)` (0), `MORALE_KILLED_ENEMY` |
| Gun kill | militia killer | `ubMilitiaKills += 2` |
| Gun kill assist | merc / militia | `usAssists++` and `StatChange(EXPERAMT, 5·bLevel)` (0) / `ubMilitiaKills += 1` |
| Melee kill | merc / militia | `usKills++`, `usPlayerKills++` / `ubMilitiaKills += 2` (no XP, morale, assist) |
| Bandaging | the bandager | `StatChange(MEDICALAMT, actual/2)`, `StatChange(DEXTAMT, actual/4)` (§2.17) |
| AR closes | every merc cell | `usBattlesFought++` (§2.18) |

`StatChange` (`Tactical/Campaign.cc:48-75`) ignores non-OUR soldiers, profile-less ones, vehicles, the robot, POWs and soldiers
below `CONSCIOUSNESS`, and applies `ProcessUpdateStats` at once (docs/11 §10). Every chance draws `pre(100)`. `ChangeStat`
draws `Random(100)` for the stat-change quote whenever a stat other than health or experience level changes (cosmetic: `fx`
in ja2-node, D2), and a M.E.R.C. merc's level gain draws `main(60)` for the email delay (docs/22).

### 2.15 Items

- Mercs: magazines consumed by `AutoReload`, one round per shot, armour status reduced and armour below 10 % destroyed by
  `TotalArmourProtection`, medical kit points used by bandaging (§2.17). Nothing is dropped by survivors; dead mercs drop
  everything (§2.18). Knives and claws are not dulled (no `UseBlade`).
- Militia and enemy soldiers are temporary: their consumption only matters for what the dead drop (§2.18).
- No item is picked up.

### 2.16 The battle ends: elapsed time, morale, loyalty, control (`RenderAutoResolve`, `:1271-1347`)

Runs once (`fMoraleEventsHandled`) at the first render after the status left `IN_PROGRESS`, i.e. immediately after the slice
that ended the battle, before the player can bandage or press Done. `s` = the AR sector with z forced to 0.
```
elapsedMs *= 3
if !FACT_FIRST_BATTLE_FOUGHT: set it; VICTORY → FACT_FIRST_BATTLE_WON; SetTheFirstBattleSector(s);
                              HandleFirstBattleEndingWhileInTown(s, TRUE)            // meanwhile (docs/26)
switch status:
 VICTORY:      HandleMoraleEvent(NULL, MORALE_BATTLE_WON, s); HandleGlobalLoyaltyEvent(GLOBAL_LOYALTY_BATTLE_WON, s)
               SetThisSectorAsPlayerControlled(s, TRUE)        // usually "too premature": the dead enemies are still counted (Q14)
               LogBattleResults(LOG_VICTORY)                   // history
 SURRENDERED, CAPTURED:
               each live, non-mechanical, involved OUR soldier: HandleMoraleEvent(soldier, MORALE_MERC_CAPTURED, s)   // affects everyone
               HandleMoraleEvent(NULL, MORALE_HEARD_BATTLE_LOST, s); loyalty GLOBAL_LOYALTY_BATTLE_LOST
               gsEnemyGainedControlOfSectorID = s              // no history entry
 DEFEAT:       MORALE_HEARD_BATTLE_LOST; loyalty GLOBAL_LOYALTY_BATTLE_LOST; gsEnemyGainedControlOfSectorID = s
               creature attack: gsCiviliansEatenByMonsters = aliveEnemies
               LogBattleResults(LOG_DEFEAT)
 RETREAT:      elapsedMs += 300000                              // +5 min, after the ×3
               HandleLoyaltyImplicationsOfMercRetreat(RETREAT_AUTORESOLVE, s)
               not creature: gsEnemyGainedControlOfSectorID = s
               creature with aliveEnemies > 0: gsEnemyGainedControlOfSectorID = s; gsCiviliansEatenByMonsters = aliveEnemies
```
Morale events (`Tactical/Morale.cc:27-64`, `:438-527`, docs/11 §9): `KILLED_ENEMY` +4 to the killer; `BATTLE_WON` +4 to
OUR soldiers in the sector (not between sectors), `HEARD_BATTLE_WON` +2 to the others; `HEARD_BATTLE_LOST` −2 everyone; `MERC_CAPTURED` −5 everyone, once per captured merc here
and again in `EnemyCapturesPlayerSoldier` (Q13); `RAN_AWAY` −5 for those in the sector or just retreated from it (doubled for
aggressive mercs, none for cowards), `HEARD_BATTLE_LOST` for everyone else (`:453-484`). Reputation changes ride on the same
events (`:626-…`, docs/22). Loyalty values and their distance fan-out: docs/18 (`Strategic_Town_Loyalty.cc:850-…`:
`BATTLE_WON` 500, `BATTLE_LOST` −750, `ENEMY_KILLED` 50, `NATIVE_KILLED` −50, `ABANDON_MILITIA` −750, in hundredths). The end
block also picks a music track with `Random` (cosmetic; not drawn in ja2-node, D2).

ja2-node: `endOfBattle` (`outcome.ts`) applies the ×3 and the +5 min and returns the consequences as data
(`AutoresolveOutcome`: morale, loyalty, captured mercs, control, civilians eaten, retreat implications, the battle log); the
battle flow applies them.

### 2.17 Bandaging after a victory (`AutoBandageMercs`, `:1076-1149`; `VirtualSoldierDressWound`, `:910-1057`)

Available after a victory with live mercs (`SetupDoneInterface`, `:3437-3463`) when someone bleeds (`bleeding != 0`, life
!= 0), someone can bandage (life ≥ `OKLIFE`, not collapsed, `bMedical > 0`) and some merc carries an `IC_MEDKIT`
(`DetermineBandageButtonState`, `:1942-1966`, checked in that order).
```
kit = null; best = merc cell 0's soldier
for each merc cell s (self-bandage phase):
   skip unless s.life >= OKLIFE and !s.collapsed and s.bMedical > 0
   if best.bMedical < s.bMedical: best = s
   slot = FindObjClass(s, IC_MEDKIT); if none: continue
   n = 0
   while s.bleeding:
      kit = s.inv[slot]; pts = TotalPoints(kit)
      if pts == 0: slot = FindObjClass(s, IC_MEDKIT); if none: break; continue
      used = dressWound(s, s, kit, pts, pts); UseKitPoints(kit, used, s)
      if ++n > 50: break
   if !kit: break                                       // the first qualified kit owner who is not bleeding ends this phase (Q17)
used total = 0; complete = TRUE
for each merc cell s:
   while s.bleeding and s.life != 0:
      if !kit: kit = first IC_MEDKIT of any merc cell in order; if none: complete = FALSE; break
      pts = TotalPoints(kit); if pts == 0: kit = null; continue
      used = dressWound(best, s, kit, pts, pts); UseKitPoints(kit, used, s); total += used
message box (UI); elapsedMs += total·200                // after the ×3; self-bandaging adds no time
```
`dressWound(medic, victim, kit, kitPts, status)` (`:910-1057`):
```
if victim.bleeding < 1 or victim.life == 0: return 0
skill = (3·EffectiveMedical(medic) + 2·status + 10·EffectiveExpLevel(medic) + EffectiveDexterity(medic))/7    // status = total kit points
aps = INCOMBAT ? medic.bActionPoints : 12                // never in combat under AR → 12
possible = aps·skill/50; if possible == 0: return 0
if medic.inv[0].usItem == MEDICKIT: possible += possible/2          // slot 0 is the helmet: never true (Q17)
actual = possible
below = victim.life >= OKLIFE ? 0 : OKLIFE − victim.life
need = 2·below + max(victim.bleeding − below, 0); actual = min(actual, need)
if kit is MEDICKIT: cost = max(actual/2, actual > 0 ? 1 : 0); if cost > kitPts: cost = kitPts; actual = 2·cost
else: cost = actual; if cost > kitPts: cost = actual = kitPts
left = i8(actual)
if left and victim.life < OKLIFE:
   if left >= 2·below: victim.life = OKLIFE; victim.bleeding −= below; left −= 2·below
   else: victim.life += left/2; victim.bleeding −= left/2; left %= 2
   bleeding = max(bleeding, 0); quote flags
if left and victim.bleeding: take min(left, bleeding) off the bleeding
actual −= left
if actual/2: StatChange(medic, MEDICALAMT, actual/2, FROM_SUCCESS)
if actual/4: StatChange(medic, DEXTAMT, actual/4, FROM_SUCCESS)
return cost
```
A medic whose `possible` is 0 makes the second loop spin forever in the original (`dressWound` returns 0 and the bleeding
never drops); ja2-node stops a pass that makes no progress and reports the bandaging incomplete (D7).

### 2.18 Closing AR (`RemoveAutoResolveInterface`, `:1634-1840`)

```
if any merc cell bleeds and is alive: AddStrategicEvent(EVENT_BANDAGE_BLEEDING_MERCS, now + 1 min)     // docs/18 doctoring
gfReEvaluateEveryonesNothingToDo = TRUE                     // assignment display (UI)
robot cell: UpdateRobotControllerGivenRobot
for each merc cell s, index order:
   if s.life == 0: StrategicHandlePlayerTeamMercDeath(s)    // §3.7
                   AddDeadSoldierToUnLoadedSector(sector, s, RandomGridNo(), TO_SWEETSPOT)   // corpse and all items
   else if status ∈ {SURRENDERED, CAPTURED}: EnemyCapturesPlayerSoldier(s)                     // retreated cells too
   else if status == VICTORY: s.ubStrategicInsertionCode = INSERTION_CODE_CENTER
   profile(s).usBattlesFought++
if VICTORY: for merc cells with life >= OKLIFE in cell order, whenever the group id differs from the previous such cell's:
   PlayerGroupArrivedSafelyInSector(group, checkNPCs = first call only)        // continue or stop the route (docs/16)
if SURRENDERED or CAPTURED: EndCaptureSequence()
(delete merc faces: UI)
reset gbGreenToElitePromotions, gbGreenToRegPromotions, gbRegToElitePromotions, gbMilitiaPromotions
for each of the 20 militia slots with a soldier:
   rank = rank of its soldier class
   if life < OKLIFE/2 (< 7):  AddDeadSoldierToUnLoadedSector(sector, s, RandomGridNo(), TO_SWEETSPOT)
                              StrategicRemoveMilitiaFromSector(sector, rank, 1); HandleGlobalLoyaltyEvent(NATIVE_KILLED, s)
   else: promotions = CheckOneMilitiaForPromotion(sector, rank, s.ubMilitiaKills)     // Town_Militia.cc:253-285, chance() draws
         count them for the message (1: green→regular or regular→elite; 2: green→elite)
   delete the soldier
for each of the 32 enemy slots with a soldier and life < OKLIFE:          // unconscious enemies die too
   TrackEnemiesKilled(ENEMY_KILLED_IN_AUTO_RESOLVE, class); HandleGlobalLoyaltyEvent(ENEMY_KILLED, s)
   ProcessQueenCmdImplicationsOfDeath(s)                                    // strategic counts by group id (docs/17)
   AddDeadSoldierToUnLoadedSector(sector, s, RandomGridNo(), TO_SWEETSPOT)
if VICTORY: if NumEnemiesInSector(sector) > 0: EliminateAllEnemies(sector)    // the enemies beyond 32 cells (§2.19)
else: ResetMovementForEnemyGroupsInLocation()                                // §3.6
delete enemy soldiers; buttons (UI)
WarpGameTime(elapsedMs/1000, WARPTIME_NO_PROCESSING_OF_EVENTS)               // docs/15: overdue events run on the next update
free AR; gTacticalStatus.ubCurrentTeam = OUR_TEAM; gpBattleGroup = NULL
creature attack: gubNumCreaturesAttackingTown = 0; gubSectorIDOfCreatureAttack = 0
```
`AddDeadSoldierToUnLoadedSector` (`Tactical/Tactical_Save.cc:834-912`): unless the robot, every non-empty slot: for a non-OUR
soldier `main(100) < 75` → marked undroppable and skipped, already-undroppable items skipped, ammo stacks reduced to
`1 + main(count)` (`Rotting_Corpses.cc:1273-1281`); the item goes to the sector's item list (visible, reachable, placed at a sweet
spot near the grid when loaded); keys from the key ring; a corpse with `main(4)` death animation and the time of death.
`RandomGridNo` (`TileEngine/Isometric_Utils.cc:667-677`) draws `main(160)`, `main(160)` until the tile is on the visible world
diamond. The enemy and militia drops are where AR loot comes from; dead mercs' gear lands in the sector and, after a lost
battle, can be stolen when the enemy takes the sector (§3.1).

`HandlePostAutoresolveMessages` (`MapScreen.cc:7594-7630`), on map frames after AR: civilians eaten (≥ 1) →
`AdjustLoyaltyForCivsEatenByMonsters(sector, n)` (docs/18) and both globals reset on the next frame (no control change);
else `gsEnemyGainedControlOfSectorID ≥ 0` → `SetThisSectorAsEnemyControlled(sector)` (§3.1), reset on the next frame; else
promotions → message box (UI). ja2-node runs them at `done` (deviations.md "Autoresolve session").

### 2.19 `EliminateAllEnemies` (`:292-359`)

Called with AR closed (the PBI cheat) or while closing a victory (excess enemies):
```
if AR not open (cheat): for every stationary and mobile enemy of the sector by rank: GLOBAL_LOYALTY_ENEMY_KILLED,
                         TrackEnemiesKilled(ENEMY_KILLED_IN_AUTO_RESOLVE); then GLOBAL_LOYALTY_BATTLE_WON
if AR not open or status != IN_PROGRESS:
   sector stationary troops, elites, admins, creatures = 0
   every enemy group in the sector: RemoveGroupFromStrategicAILists; RemoveGroup
   if gpBattleGroup: CalculateNextMoveIntention(gpBattleGroup)
   SetThisSectorAsPlayerControlled(sector, TRUE); RecalculateSectorWeight(sector)
if AR open: every enemy cell life = 0; aliveEnemies = 0
gpBattleGroup = NULL
```
The excess enemies of a won AR vanish without kill credit or loyalty (the `!gpAR` block is skipped).

### 2.20 RNG calls in order

Setup:
1. Creature attacks without a tactical transfer: one weighted pick per creature on the main engine (§2.3).
2. Militia rank fill `pre(3)` per missing rank (normally none).
3. Per militia cell, in index order: the creation draws (`RandomizeRelativeLevel` `main(10)` ×2, attitude, placement and
   equipment draws, battle sound, …).
4. Per enemy cell (elites, troops, admins) or creature cell (AF, AM, YF, YM): the creation draws, then for enemies `main(61)`
   ×2 for the noise grid; none for reserved tactical copies.
5. Unloading the loaded battle sector (§3.3): `pre(2)` per preserved soldier (current or original position,
   `Tactical/Enemy_Soldier_Save.cc:518`; ja2-node too) and the pathfinder's `main(4)` draws (none in ja2-node, deviations.md
   "Pathfinder RNG"); nothing else that matters (inferred).
6. `CalculateAttackValues`: `pre(2000 − att)` per live merc cell, per militia cell, per enemy cell, in that order.

Per slice (§2.6.2), per pick:
7. Capture check: `pre(100)` when its conditions hold.
8. `pre(k)` for the side, then `pre(count)` until an unprocessed cell is found.
9. Landing bullets of the picked cell, slot 0..2: `StatChange` draws (agility on a miss; marksmanship of the attacker,
   experience of the target on a hit); the miss/impact sound picks (`main`, cosmetic); death sounds (cosmetic `main` battle
   sounds if `fSound`; `pre(3)` splat choice if `fSound`, never under Finish).
10. If the cell attacks: `ChooseTarget` `pre(pool)` per candidate until one is chosen; creatures `pre(100) < 7`; then
    `AttackTarget`: `pre` attack roll, `pre` defence roll, `FireAShot` (`StatChange(MARK, 3)` for mercs), the bullet slot
    `pre(400)` (gun, free slot), `pre(5)` (miss vs a target below `OKLIFE`), then on a miss the melee sound picks (`main`
    `Chance(50)` for claws or a 6-way pick for punches, cosmetic) and `StatChange(AGIL, 5)`; on a hit: gun `pre(100)` location,
    `pre(def − t.def)` accuracy (only if > 0), `BulletImpact` (`pre(51)`, `pre(100)` per armour piece, `main(10)` for an instant
    kill); melee: impact sound pick (`main`, cosmetic), accuracy `pre`, `HTHImpact` `pre(51)`, `StatChange(MARK, 6)`,
    `StatChange(EXPER, …)`, cosmetic battle sounds if `fSound`.
11. `resetNextAttackCounter` `pre(2000 − att)`.

Battle end and close:
12. `IsBattleOver` cosmetic `main` battle sounds for the robot, EPC deaths and the enemy laugh (not gated by `fSound`); the
    end block's music pick.
13. Morale, loyalty and control (§2.16): no draws (`Morale.cc`, `Strategic_Town_Loyalty.cc` have no draws on these paths).
14. Bandaging: `StatChange` draws.
15. Closing: per dead merc `RandomGridNo` pairs and the corpse `main(4)`; per militia slot, dead → `RandomGridNo`, drop
    draws, corpse; alive → `chance(25·kills)` (green with ≥ 2 kill points), `chance(10·kills)` (regular, ≥ 5); per dead enemy
    → `RandomGridNo`, drop draws, corpse. `EnemyCapturesPlayerSoldier` draws `main(21)` for a life adjustment
    when half the maximum life is at least 45 (`Queen_Command.cc:1260-1270`).
16. Later, `SetThisSectorAsEnemyControlled` → `RemoveRandomItemsInSector` `main(100)` per visible reachable item
    (`Strategic_Town_Loyalty.cc:616-660`).

In ja2-node the sound picks and the stat-change quote come from `fx`; battle sounds (item 12's included), the splat and
the music pick are not drawn (§4.1, D2).

### 2.21 What is UI-only

| UI-only (client) | Logic (simulation) |
|---|---|
| Panel layout, rows and columns, faces, health/breath/morale bars, condition texts, flashes, "retreating" blink, sounds, music, the 1 s zoom, the Pause/Play/Fast/Finish buttons (playback speed in ja2-node) | Cells, ratings, timers, slices, picks, attacks, bullets, damage, deaths, retreats, capture and surrender, the ×3 time, bookkeeping |
| `ubTimeModifierPercentage` (Play speed) | `fSound`-gated `pre(3)`: removed (§4.3) |
| Messages: battle result text, promotions, bandage result | Retreat (all / per merc), surrender accept/reject, bandage, done: commands and prompts (`04` §6) |

Militia and enemy cells show only a health category, `bHealthStrRanges` by absolute life (`Tactical/Soldier_Control.cc:160-169`:
< 15 dying, < 30 critical, < 45 wounded, < 60 poor, < 75 fair, < 90 good, else excellent); a soldier at full life shows at least
fair (`Auto_Resolve.cc:2311-2365`). ja2-node: `healthCategory` and the PBI's `soldierCondition` (§1.4) in
`src/sim/tactical/health.ts`.

---

## 3. After a battle

### 3.1 Sector control (`Strategic/Player_Command.cc`)

**`SetThisSectorAsPlayerControlled(s, contested)`** (`:56-218`), the only way control passes to the player:
```
if in a Meanwhile scene: return FALSE
if s.z == 0:
   if NumHostilesInSector(s) > 0: return FALSE                     // "too premature": stationary + creatures + mobile groups
   if s is the primary shipping destination (Drassen airport): Bobby Ray's opens (+ email once)
   wasEnemy = StrategicMap[s].fEnemyControlled; fEnemyControlled = FALSE
   town sector: StartTownLoyaltyIfFirstTime(town)                                                          // docs/18
   if wasEnemy and contested:
      town sector, not Omerta on day 1, not J9 or K4: MORALE_TOWN_LIBERATED; GLOBAL_LOYALTY_GAIN_TOWN_SECTOR;
                                                       CheckIfEntireTownHasBeenLiberated(town, s)          // docs/18
      mine with ore left: MORALE_MINE_LIBERATED; GLOBAL_LOYALTY_GAIN_MINE
      SAM site: HandleMeanWhileEventPostingForSAMLiberation (every time); MORALE_SAM_SITE_LIBERATED; GLOBAL_LOYALTY_GAIN_SAM;
                Skyrider's quote once; first player control of the surface → grace period: last day of player activity
                = today + 2 on hard, + 1 otherwise (docs/17)
      refuel site: UpdateRefuelSiteAvailability()
      M2–M6 or N6: HandleOutskirtsOfMedunaMeanwhileScene()                                                // docs/26
   if contested: StrategicHandleQueenLosingControlOfSector(s)                                              // docs/17
else if s is P3 level 1: gfUseAlternateQueenPosition = TRUE
if s.z == 0: SectorInfo[s].fSurfaceWasEverPlayerControlled = TRUE
UpdateAirspaceControl()                                                                                    // docs/16
return wasEnemy
```
Callers: tactical victory (`Tactical/Overhead.cc:4681`, contested), AR victory (`Auto_Resolve.cc:1296`, contested, usually
premature), `EliminateAllEnemies` (contested), a player group arriving without a battle (`Strategic_Movement.cc:1397`,
`HandleNonCombatGroupArrival`, not contested), the end game (`Tactical/End_Game.cc:274`).

**`SetThisSectorAsEnemyControlled(s)`** (`:221-324`):
```
if gfAutomaticallyStartAutoResolve: return FALSE                    // mercs left a militia battle: AR will decide
if s.z == 0:
   wasPlayer = !fEnemyControlled; fEnemyControlled = TRUE           // set before the next check (Q29)
   if wasPlayer:
      if PlayerMercsInSector(s) > 0: return FALSE                   // "too premature" (control already flipped)
      town sector, not J9/K4: MORALE_TOWN_LOST; GLOBAL_LOYALTY_LOSE_TOWN_SECTOR; CheckIfEntireTownHasBeenLost
      mine with ore left: QueenHasRegainedMineSector(mine); MORALE_MINE_LOST; GLOBAL_LOYALTY_LOSE_MINE
      SAM site: MORALE_SAM_SITE_LOST; GLOBAL_LOYALTY_LOSE_SAM
      refuel site: UpdateRefuelSiteAvailability()
      NotifyPlayerWhenEnemyTakesControlOfImportantSector(s)         // message (UI)
   if SF_ALREADY_VISITED: RemoveRandomItemsInSector(s, min(5·NumEnemiesInAnySector(s), 90))      // main(100) per item
UpdateAirspaceControl()
return wasPlayer
```
Callers: tactical defeat while non-creature enemies remain (`Overhead.cc:4490-4493`), the map screen after a lost or retreated
AR (`MapScreen.cc:7616-7620`), the strategic AI when a group reaches the Queen's sector (`Strategic_AI.cc:1045`, docs/17). The
theft runs outside the `wasPlayer` branch on purpose (later reinforcements steal again). Retreating from a sector does not by
itself flip control (inferred; enemy groups take empty sectors through the strategic AI, docs/17).

ja2-node: `setThisSectorAsPlayerControlled` / `setThisSectorAsEnemyControlled` in `src/sim/strategic/map/control.ts`; the
town, mine, SAM, meanwhile and theft effects go through the context's `world` hooks (`sectorLiberated`, `sectorTakenByEnemy`)
and the Queen's through `ctx.ai`. The `gfAutomaticallyStartAutoResolve` guard reads `state.battle.autoStart`.

### 3.2 A tactical battle ends (`CheckForEndOfBattle`, `Tactical/Overhead.cc:4392-4705`, docs/10 §8.2)

Strategic consequences, in the order of the code:
- **Lost** (`:4453-4503`): `EndAllAITurns`; `fEnemyInSector = FALSE`; exit combat; `MORALE_HEARD_BATTLE_LOST`;
  `GLOBAL_LOYALTY_BATTLE_LOST`; defeat music and a 10 s timer (`DeathNoMessageTimerCallback`; ja2-node: 10 s of tactical game
  time, `battle.lostBattleUnloadAtMs`, then the unload of §3.3); the first-battle facts and
  `HandleFirstBattleEndingWhileInTown(s, FALSE)`; if non-creature enemies remain, `SetThisSectorAsEnemyControlled(gWorldSector)`;
  `LogBattleResults(LOG_DEFEAT)`; locator off. `CheckForLosingEndOfBattle` (`:4937-5081`) first decides between the militia
  hand-off (§3.3), a capture (2–3 unconscious real mercs, an active enemy team, Alma or interrogation quest state;
  `BeginCaptureSquence`, `EnemyCapturesPlayerSoldier`, `EndCaptureSequence`) and killing the unconscious mercs, EPCs and the
  robot (`HandleSoldierDeath`).
- **Won** (`:4506-4700`): `fLastBattleWon`; `KillIncompacitatedEnemyInSector` (dying enemies finish dying first); exit combat; if
  anyone fought (`bNumFoughtInBattle` of enemies, creatures, civilians > 0): `usBattlesFought++` for OUR soldiers in the sector,
  stand-up and stealth-off for the conscious, `MORALE_BATTLE_WON`, `GLOBAL_LOYALTY_BATTLE_WON`, auto-bandage prompt
  (`ShouldBeginAutoBandage`, docs/18), quotes; militia back to green, stationary orders, bleeding cleared for those ≥ `OKLIFE`;
  civilians back to green; `LogBattleResults(LOG_VICTORY)`; `SetThisSectorAsPlayerControlled(gWorldSector, TRUE)`;
  `HandleVictoryInNPCSector` (docs/25); first-battle facts and `TriggerNPCRecord(PACOS, 18)`; a 3 s notice timer.
- Each death during the battle already updated the strategic layer: enemies and creatures through
  `ProcessQueenCmdImplicationsOfDeath` (docs/17, called from the death path, docs/11 §5.10), `TrackEnemiesKilled`,
  `GLOBAL_LOYALTY_ENEMY_KILLED`; militia deaths through the militia status hand-off when the map unloads (docs/18); OUR deaths
  through `StrategicHandlePlayerTeamMercDeath` (`Strategic/Strategic_Merc_Handler.cc:52-130`, §3.7). An enemy that walks off the
  map is treated as dead strategically (`TacticalAI/AIMain.cc:2012-2043`).
- Militia kills in tactical feed `HandleMilitiaPromotions` (`Tactical/Militia_Control.cc:60-105`, docs/18).
- Reinforcements: a won battle is not won while `gfPendingEnemies` (`:4438-4447`, docs/16/17).

ja2-node: the tactical layer reports these moments through `SectorHooks` (`src/sim/tactical/state.ts`: `mercDied`,
`pendingEnemies`, `militiaFinishBattle`, `battleLost`, `battleEnded`), which `BattleFlow` implements.

### 3.3 Leaving the battle sector, and AR of a battle already loaded in tactical

`CheckAndHandleUnloadingOfCurrentWorld` (`StrategicMap.cc:3003-3134`) runs when the loaded world may be trashed:
```
if no world, or the game just started in the start sector: return FALSE
if the AR screen is up and the AR sector is the loaded one:
   every live, non-mechanical, non-EPC OUR soldier in the sector: RemoveSoldierFromGridNo; InitSoldierOppList
else:
   if a live, non-mechanical, non-EPC OUR soldier is still in the sector: return FALSE
   if HandlePotentialBringUpAutoresolveToFinishBattle(): return FALSE                  // militia vs enemies left: AR
CheckForEndOfCombatMode(FALSE)
EndTacticalBattleForEnemy()                // Queen_Command.cc:241-289: clears the "in battle" counters of the sector and its
                                           // groups, ubNumCreatures = 0 (surface); militia and enemies (or creatures) still
                                           // OK in the sector → GLOBAL_LOYALTY_ABANDON_MILITIA
delete ambients (UI)
from tactical: go to the map, or return FALSE if a tactical traversal will trash the world
HandleDefiniteUnloadingOfWorld(ABOUT_TO_TRASH_WORLD): save the sector's items and corpses (sector diff), NPC insertion data,
   militia status hand-off (docs/18)
TrashWorld()                                // under AR: with the screen id switched to MAP so tactical soldiers are freed
fEnemyInSector = FALSE; INCOMBAT cleared; world sector invalid
```
`HandlePotentialBringUpAutoresolveToFinishBattle` (`:2956-3000`): a live in-sector enemy or creature and a live friendly
in-sector militiaman → map screen, non-persistent PBI with auto-start, `gubPBSector = gWorldSector`, locator on,
`gfTransferTacticalOppositionToAutoResolve = TRUE`, code `ENEMY_INVASION` unless `CREATURE_ATTACK`.

An AR of a loaded battle (this hand-off, or the non-persistent PBI's Autoresolve button) differs from a fresh one:
- Enemy and creature cells are **copies of the tactical soldiers** (`ReserveTacticalSoldierForAutoresolve`, §2.4) with their
  life, wounds, ammo and armour; their number per class still comes from the strategic counts. If a class has more strategic
  soldiers than live tactical ones (pending reinforcements, `gfPendingEnemies`), the original dereferences `NULL` (crash);
  ja2-node creates the missing ones fresh (D9). Creature counts come from the tactical soldiers when the transfer flag is set.
- Militia cells are always created fresh from the strategic counts (no copy).
- Merc cells are the real soldiers in their current state (unconscious ones included).
- `EndTacticalBattleForEnemy` during the unload applies `GLOBAL_LOYALTY_ABANDON_MILITIA` whenever militia and enemies are still
  up in the sector, i.e. typically in exactly this hand-off (Q22).

ja2-node: the sector flow (`src/sim/campaign/sector-flow.ts`) unloads a loaded battle sector before its AR, running
`endTacticalBattleForEnemy` (militia and enemies counted at `OKLIFE`), and starts the militia hand-off; it also preloads the
battle sector's map (`mapsNeededSoon`).

### 3.4 Retreating from tactical combat to an adjacent sector

The squad walks off a map edge (or into an exit grid) and the player confirms the move (`JumpIntoAdjacentSector`,
`StrategicMap.cc:1379-1573`; edge rule `SoldierOKForSectorExit` `:1945-2032`, allowed in combat; docs/16 owns the flow).
Battle-specific consequences when the last mercs leave (`AllMercsHaveWalkedOffSector`, `:1751-1847`):
```
if NumEnemiesInAnySector(world) > 0:
   HandleLoyaltyImplicationsOfMercRetreat(RETREAT_TACTICAL_TRAVERSAL, world)   // militia present → ABANDON_MILITIA;
                                                                                // MORALE_RAN_AWAY if enemies present and PlayerStrength·2 ≥ EnemyStrength
   clear the AI exposed-tile map
the group travels to the adjacent sector (waypoint; traverse time ≤ 5 min → immediate load, docs/16)
if no other mercs stay and enemies were present:
   ResetMovementForEnemyGroupsInLocation()                                      // §3.6
   if traverse time > 5: WarpGameTime(300, NO_PROCESSING_OF_EVENTS)              // +5 min
the world unloads (§3.3): militia left with enemies → AR hand-off
```
Exit grids (`AllMercsWalkedToExitGrid`, `:1618-1690`) additionally set `GROUPFLAG_HIGH_POTENTIAL_FOR_AMBUSH` on the group when
combat never started though enemies were present (`:3207-3222`), and call the retreat implications with the destination
sector (sic, Q23).

### 3.5 Retreat travel (`Strategic/Strategic_Movement.cc`)

`RetreatGroupToPreviousSector(g)` (`:2765-2829`, docs/16), used by the PBI retreat and the AR retreat:
```
if g.ubPrev == (16, 16): CalculateGroupRetreatSector(g)          // ubPrevSectorID 255 maps to P16 (sentinel, Q24)
g.ubNext = g.ubPrev; direction = N/E/S/W from the delta (else throw)
g.uiTraverseTime = GetSectorMvtTimeForGroup(g.ubSector, direction, g)       // docs/16; 0 → 5 minutes
arrival = now + traverse time; g.fBetweenSectors = TRUE; g.uiFlags |= GROUPFLAG_JUST_RETREATED_FROM_BATTLE
vehicle: the vehicle is between sectors too
EVENT_GROUP_ARRIVAL at the arrival minute; player group: EVENT_GROUP_ABOUT_TO_ARRIVE (arrival − ABOUT_TO_ARRIVE_DELAY) if
still in the future; each member fBetweenSectors = TRUE and RemoveSoldierFromTacticalSector
```
`CalculateGroupRetreatSector(g)` (`:2720-2761`): `ubPrev = ubSector`, then the first of north, east, west, south whose
traversability is neither `GROUNDBARRIER` nor `EDGEOFWORLD`; members' `ubPrevSectorID` updated. If the group is intercepted
on the way (`GROUPFLAG_JUST_RETREATED_FROM_BATTLE`), its next PBI cannot retreat (§1.2).

The arrival time is computed before the PBI's 300 s warp or AR's battle-time warp, so those minutes of the trip are already
spent when the clock resumes; the group may arrive at the very next clock update (Q26).

### 3.6 Enemy and player groups after a battle

- **Enemy groups** after an AR defeat or retreat, a PBI retreat or a tactical retreat:
  `ResetMovementForEnemyGroupsInLocation` (`Strategic_Movement.cc:2915-2971`): for each enemy group in the battle sector, a
  group between sectors gets its arrival re-posted at now + its traverse time (traverse > 400 min shortened to 90), a group
  not moving is re-polled by the strategic AI (`RepollSAIGroup`, docs/17). After an AR victory `EliminateAllEnemies` removes
  what AR could not seat (§2.19); the dead go through `ProcessQueenCmdImplicationsOfDeath` by the cell's group id (0 =
  garrison, §2.4, §2.18).
- **Player groups** after an AR victory: `PlayerGroupArrivedSafelyInSector` per group of the live conscious mercs: NPC-of-note
  prompt for the first group (wilderness sectors with unmet profiled NPCs), then stop (someone cannot move on) or rebuild
  the waypoints and continue (`Strategic_Movement.cc:3458-3497`, docs/16).
- **Militia**: AR deaths and promotions §2.18; in tactical the militia soldiers' state is handed back to the sector counts
  when the map unloads, promotions by `HandleMilitiaPromotions` (docs/18).

### 3.7 Mercs killed or captured

- **Killed** (AR at close, tactical at death): `StrategicHandlePlayerTeamMercDeath` (`Strategic_Merc_Handler.cc:52-130`): history
  entry, `ubMercDeaths++` (not EPCs or the robot), `SOLDIER_DEAD`, breath 0, awake, profile `MERC_IS_DEAD`, life insurance
  payout and the suspicious-death rules (docs/22), `MORALE_TEAMMATE_DIED` fan-out (docs/11 §9), M.E.R.C. contract bookkeeping,
  then `HandleStrategicDeath` (`Strategic/Strategic.cc:18-41`): out of the vehicle, out of the squad, `ASSIGNMENT_DEAD`;
  the corpse in the sector (AR adds it itself, §2.18).
- **Captured**: `EnemyCapturesPlayerSoldier` (`Queen_Command.cc:1165-1276`): skipped once both capture flags are set or after 4
  captives; EPCs die instead; out of the vehicle; first capture with no enemies in Alma (I13) starts and ends the Alma quest at
  once; `MORALE_MERC_CAPTURED`; assignment `ASSIGNMENT_POW`; neutral while the Alma quest is not started; out of the squad;
  moved to I13 (first capture) or N7 (after the Alma quest) at fixed grids with all items dropped at a fixed grid; bleeding 0;
  awake; life = max(lifeMax/2, 35), and if lifeMax/2 ≥ 45 then `+10 − main(21)`; breath and breath max 50.
  `BeginCaptureSquence`/`EndCaptureSequence` (`:1101-1143`) set the capture flags and start the quests (docs/26).

ja2-node: `src/sim/campaign/merc-fate.ts` (`strategicHandlePlayerTeamMercDeath` with the history, insurance and M.E.R.C.
parts behind the `DeathBookkeeping` port, `handleStrategicDeath`, `enemyCapturesPlayerSoldier` with the I13/N7 teleports and
the captive life draw, `beginCaptureSequence`, `endCaptureSequence`).

---

## 4. Determinism

### 4.1 Which generator

| Draw | Stream |
|---|---|
| Ambush roll in the PBI; AR: militia rank fill, all ratings and timers, side and cell picks, target picks, attack and defence rolls, bullet delay, the unconscious-target miss, hit location, accuracy, `BulletImpact` fluke and armour, `HTHImpact` fluke, creature 7 % skip, capture and surrender rolls, retreat timers, every `StatChange` chance | `pre` |
| PBI speaker, `chance(90)` high-potential ambush, bloodcat cat count (docs/16); AR: soldier creation (relative levels, attitude, stats, equipment, noise grid), creature town composition, instant-kill `main(10)`, `RandomGridNo`, item drops, corpse animation, militia promotion `chance()`, captive life `main(21)`, the M.E.R.C. level email, theft after a lost sector | `main` |
| AR sound picks (`SoundRange` miss/impact/swoosh/smell, `Chance(50)` claw sound), the stat-change quote, battle sounds (`DoMercBattleSound` draws `Random`, `Tactical/Soldier_Control.cc:5866-6115`), the end block's music pick | `main` in the original; in ja2-node the sound picks and the quote on **`fx`**, battle sounds and music **not drawn** (D2) |
| Splat sound `PreRandom(3)` (only when `fSound`) | `pre` in the original; **not drawn** in ja2-node (D2) |

ja2-node does not draw the PBI speaker either (deviations.md "Cosmetic draws in strategic movement"). V used `PreRandom`
for most AR sound picks (`V AutoResolve.c:3375`, `:3407`, `:3453`, `:3549`, `:3569`, `:4052`); Strac moved them to
`SoundRange` on `Random`, which is why Strac's `pre` sequence differs from V's.

Native mechanics: `Random` and `PreRandom` use `std::uniform_int_distribution` over `mt19937` (`sgp/Random.cc:63-84`), so a call
may consume more than one engine value; `std::discrete_distribution` (creature composition) draws doubles from the engine
(`generate_canonical`). ja2-node replaces it by one weighted `main(100)` pick per creature (D5; same distribution, different
number stream).

### 4.2 Wall-clock dependencies and their replacements

| Original | Where | ja2-node |
|---|---|---|
| Slice length = wall time between frames × speed (Play `1000·pct/100`, Fast 4000) | `ProcessBattleFrame` `:3550-3572` | Always 1000 ms slices (Finish), D1 |
| 17 ms frame budget and the attacks-per-frame cap, resuming mid-slice | `:3591-3602` | None: they never change the logic under Finish |
| Player orders (retreat) arrive between frames | button callbacks | Commands between slices |
| First frame only records the clock | `:3550-3559` | None |
| PBI and AR zoom transitions (1 s), header blink, cell flash 150 ms, "retreating" text blink 900 ms | `:530-622`, `:364-411`, `:806-813`, `:2384-2392` | Client playback only |
| Quote before the PBI waits for speech | `Dialogue_Control.cc:412-417` | No quote time: the PBI opens at the end of the step (D4); the clock is paused anyway |
| World clock: AR battle time applied by `WarpGameTime(ms/1000, NO_PROCESSING)` | `:1819` | Same jump in world seconds; overdue events run on the next clock update (docs/15) |

### 4.3 `fSound`

`fSound` starts `TRUE` and Finish clears it for the rest of the battle. It gates `DoMercBattleSound` calls in `AttackTarget` and
`TargetHitCallback` (cosmetic `main` draws) and the `PreRandom(3)` splat choice (`:3206-3215`). In the original the `pre` sequence
therefore depends on whether, and when, the player pressed Finish. ja2-node runs as if Finish were pressed before the first
slice: no battle sounds, no splat draw (the client picks the splat sound from `arDied.splat`), sound picks on `fx`. This
matches the native Finish run exactly as far as `pre` is concerned (§6.4).

### 4.4 Canonical schedule and commands

AR in ja2-node is a pure function of (AR state, `pre`/`main`/`fx` streams, the ordered list of player commands with their slice
numbers). The client's Pause/Play/Fast/Finish only choose how fast the slice log is played back. Two sessions with the same
seed and command log produce the same AR log (docs/04 §5.6).

---

## 5. Data

PBI and AR read only externalized JSON already in the content model (`data/externalized/`); nothing is transcribed:

| File | Used for |
|---|---|
| `weapons.json` | `ubImpact` for AR shots and spit, magazine size for reloads, gun class (`IC_GUN`) |
| `items.json`, `magazines.json`, `ammo-types.json` | item classes `IC_GUN`, `IC_BLADE`, `IC_MEDKIT`, `IC_AMMO`; `AutoReload`; ammo types for armour |
| `armours.json` | `TotalArmourProtection` in AR (docs/11 §4.3) |
| `army-garrison-groups.json`, `army-compositions.json` | stationary counts; the **order** of the garrison list is the garrison id (`Strategic_AI.cc:408-413`) and the composition list order is the enum (`ROADBLOCK = 25`), which Q12 depends on |
| `strategic-map-towns.json`, `strategic-map-sam-sites.json`, `strategic-mines.json`, `shipping-destinations.json` | invasion vs encounter code, control effects (town, SAM, mine, Bobby Ray's) |
| `strategic-map-traversibility-ratings.json`, `strategic-map-movement-costs.json` | retreat sector choice and retreat time (docs/16) |
| `game.json` | no AR or PBI keys; `start_sector` for the "game just started" guard |

Code tables from Stracciatella sources: `MORALE_EVENTS` (the 36 `gbMoraleEvent` entries, `Tactical/Morale.cc:27-64`) in
`src/sim/campaign/morale.ts`; `CREATURE_WEIGHTS_BY_HABITAT` (`Strategic/Creature_Spreading.cc:707-724`; AR uses the
`MINE_EXIT` row) in `src/sim/strategic/creatures/creatures.ts`; `bHealthStrRanges` (`Tactical/Soldier_Control.cc:160-169`) in
`src/sim/tactical/health.ts`. Every other number of §1–§3 is a named constant in the module that uses it. Strings
(`gpStrategicString`, `gzNonPersistantPBIText`, `gzLateLocalizedString`) come from the language files and are client-only, as
are the panel media and layouts (`28`). AR needs no media, so it runs headless on the stub pack.

---

## 6. Implementation in ja2-node

### 6.1 State

The PBI globals are `StrategicState.encounter` and `StrategicState.battle` (§1.1). `battle.autoresolve` is the AR session
(`AutoresolveSession`: the `AutoresolveState` of §2.2, its sector, the replay streams of an oracle run or `null`, a tick
counter, `ended`), and `state.flow` is `'autoresolve'` while it runs. The cosmetic stream is `state.cosmetic.autoresolve`,
seeded once from the session seed. Saving is refused while a battle prompt is open or AR runs (`promptOpen` in
`src/server/save-rules.ts`, `27`), as in the original.

### 6.2 Modules

Functions keep the original names in camelCase. Every AR function takes an `AutoresolveEnv` (content, profiles, `ArRng
{pre, main, fx}`, the world day and capture flag, decision hooks), so tests and the oracle inject scripted streams. AR
modules are in `src/sim/strategic/forces/autoresolve/` (`…/`).

| Module | Contents |
|---|---|
| `src/sim/strategic/forces/autoresolve/state.ts` | `AutoresolveState`, `ArCell`, flags, statuses, `ArEvent`, `AutoresolveEnv`, `cosmeticOnMain`; `createAutoresolveState` throws above 20 mercs, 20 militia or 32 enemies (D3, D10) |
| `…/setup.ts`, `ratings.ts` | §2.4 rank fill and `associateEnemiesWithStrategicGroups`, `enterAutoresolve`; §2.5 |
| `…/loop.ts` | §2.6: `runAutoresolve(env, ar, budget)` → `'over'`, `'surrender'` or `'budget'`; `runSlice`, `processCell` |
| `…/attack.ts`, `landing.ts`, `end.ts` | §2.7–§2.8 (sound picks on `fx`); §2.9–§2.10; §2.11–§2.13 (`orderRetreat` queues, `applyRetreatOrders` runs between slices) |
| `…/outcome.ts`, `bandage.ts`, `close.ts` | §2.16 `endOfBattle`; §2.17 with `bandageRefusal`; §2.18 `closeAutoresolve` against an `AutoresolveClosePort`, corpse and drop records, the warp seconds |
| `…/replay-rng.ts` | `ReplayStream` (replays traced draws, asserting each range) and `ScriptedStream` |
| `src/sim/tactical/creation-basic.ts`; `tactical/combat/context.ts`, `impact.ts`, `reload.ts` | §2.4 creation and tactical copies; `CombatContext`, `ImpactMode`, `bulletImpact`, `autoReload` (§2.8) |
| `src/sim/strategic/forces/pre-battle.ts`, `battle-state.ts`, `flow-state.ts` | §1: `initPreBattleInterface`, `determineEncounterCode`, the options, involvement, squads and retreat; the state of §1.1 |
| `src/sim/campaign/autoresolve-strategic.ts` | §2.3–§2.4 from the strategic state (`buildAutoresolveInput`: merc cells of the involved groups, militia, at most 32 enemy cells elites → troops → admins, tactical copies (D9), creature cells), `associateWithStrategicGroups`, `eliminateAllEnemies` (§2.19), `strategicClosePort` (militia, loyalty, `trackEnemiesKilled`, `processQueenCmdImplicationsOfDeath`) |
| `src/sim/campaign/battle-flow.ts`, `pre-battle-panel.ts` | `BattleFlow` (§6.3); the panel data of §1.4 |
| `src/sim/campaign/merc-fate.ts`, `morale.ts`, `sector-loot.ts` | §3.7; the `gbMoraleEvent` table and `RefreshSoldierMorale`; corpses and items into unloaded sectors, theft |
| `src/sim/tactical/item-placement.ts`, `health.ts` | `sweetSpotForUnloadedDrop` (radius 5, then 15) for the sector diff's sweet-spot items and corpses; §1.4 condition, §2.21 health category |
| `src/sim/strategic/map/control.ts` | §3.1 |
| `src/server/battle-view.ts` | the prompt and AR projection of `04` §6, without ratings, timers, pending bullets or the enemies' exact life |

### 6.3 Wiring

`BattleFlow` (owned by `CampaignSim`) settles after each step (`afterStep` → `settle`): it opens the prompts in order
(simultaneous arrival, NPC of note, the non-persistent auto-start of the militia hand-off (`enterPreBattlePending`), the
PBI hand-off of docs/16, the militia prompts of docs/18), auto-starts AR for the delayed start, the militia hand-off and
militia-only creature attacks (`openCreatureAttack`, called by `creature-flow.ts`), answers the prompts (§1.5), and runs AR
as a flow: `stepAutoresolve` runs one 1000 ms slice every `TICKS_PER_AUTORESOLVE_SLICE` (200) ticks, converts the AR events, opens the `surrender` prompt and, at the
end, applies §2.16 and opens `autoresolveDone`; `bandage` runs §2.17, `done` runs §2.18 (corpses and drops into the sector
diff, `EVENT_BANDAGE_BLEEDING_MERCS`, insertion `CENTER`, the warp without event processing, the post-AR messages) and
returns to the `strategic` flow, with a loaded sector still loaded. Nothing steps while a prompt is open; during AR the
real-time clock stands still (clock screen `other`). The tactical aftermath of §3.2–§3.4 arrives through the `SectorHooks`
of §3.2: merc deaths, the militia hand-off, a lost battle (2–3 unconscious mercs captured, otherwise killed), victory and
defeat, and the unload 10 s after a defeat (`#unloadAfterLostBattle`). `SectorFlow.unloadForAutoresolve` empties a loaded
battle sector before its AR (§3.3). The agent API (prompts, `autoresolveRetreat`, `autoresolveBattle`, `showBattle`, the
events and `observe.autoresolve`) is `04` §6; the PBI panel and the AR screen are `src/ui/screens/battle/` (`28`).

### 6.4 Verification

Oracle (patches `0002-autoresolve-oracle.patch`, `0005-pre-battle-oracle.patch`; probes `autoresolve-d13.txt`,
`autoresolve-capture.txt`, `battle.txt`, `creature-battles.txt`): level 1 "core replay" (`autoresolve-compare.ts`: native
Finish-mode battles replayed draw by draw through ratings, loop, end, bandage and close, with `cosmeticOnMain` routing the
cosmetic draws to `main`), level 2 "setup" (`autoresolve-creation.ts`: every created militia, enemy and creature soldier),
level 3 "aftermath" (`autoresolve-aftermath.ts`: the close through the battle flow on the imported save, plus
`enemycounts`), and `pbi` (`pre-battle-compare.ts`: the encounter code and its draws). Details: `tools/oracle/README.md`
("Autoresolve"). The random-ambush branch is not reachable on the available saves; unit tests cover its arithmetic.

---

## 7. Quirks and deviations

### 7.1 Quirks to keep (Stracciatella behaviour)

| # | Quirk | Where |
|---|---|---|
| Q1 | The ambush chance uses `bestExpLevel`, which stays 0 (minimum computed instead of maximum) | `PreBattle_Interface.cc:325`, `:387` |
| Q2 | The random-ambush branch needs `KNOWS_NOTHING`, which a conscious awake merc in the sector prevents (inferred) | `:379`, `Map_Screen_Interface_Map.cc:3565-3600` |
| Q3 | AR kill and assist XP use `bLevel` (map level) instead of `bExpLevel`: 0 chances (V too) | `Auto_Resolve.cc:3172`, `:3184`, `:3195` |
| Q4 | Melee kills in AR give no XP, morale or assists; melee damage is life, not breath | `:3022-3036` |
| Q5 | The splat-sound `PreRandom(3)` is drawn only while `fSound` (before Finish); not drawn in ja2-node (D2) | `:3206-3215` |
| Q6 | Militia late-entry delay `(i − 4)·2000` for `i > 6` | `:2572-2575` |
| Q7 | Retreat timers: `×5` for one merc, `×2` for all, u16 wrap | `:1904`, `:2039` |
| Q8 | A fourth simultaneous bullet adds to slot 2 and is credited to slot 2's attacker; assist slots are stale | `:2903-2919`, `:2963-2971`, `:3154-3165` |
| Q9 | Only `HANDPOS` is reloaded; pocket guns fire until empty | `:2779-2796`, `Items.cc:1418-1463` |
| Q10 | `BulletImpact` reads the ammo type from the attacking hand and the knife test from the last attacking weapon | `Weapons.cc:2751-2760` |
| Q11 | Dead or unconscious cells can be ordered to retreat: never completes, but attacks on them get ×7/10 | `:1899-1907`, `:2034-2041`, `:2868-2872` |
| Q12 | `GetNumberOfMobileEnemiesInSector` and `NumMobileEnemiesInSector` compare the garrison **id** with the composition `ROADBLOCK` (25): the garrison at index 25 of `army-garrison-groups.json` (H1, West Grumm) is counted as stationary and mobile by `GetNumberOfEnemiesInSector` (AR counts, the PBI cheat's loyalty credit, `Tactical/Enemy_Soldier_Save.cc:175`) and by the PBI's ambush test. Rarely visible: a garrison attack cannot be autoresolved, a held H1 has no stationary enemies, the PBI shows `NumEnemiesInSector`; the main reach is the enemy reload of a visited H1 (docs/16/17) | `Queen_Command.cc:170`, `:197` |
| Q13 | `MORALE_MERC_CAPTURED` applies twice per merc captured in AR (`RenderAutoResolve` and `EnemyCapturesPlayerSoldier`) | `:1302-1313`, `Queen_Command.cc:1217` |
| Q14 | An AR victory calls `SetThisSectorAsPlayerControlled` while the dead enemies are still counted: no effect unless the excess-enemy elimination runs; an enemy-controlled sector stays so until a later non-combat arrival | `:1296`, `Player_Command.cc:82-85` |
| Q15 | After a victory, mercs who retreated one by one stay in the sector; only a `RETREAT` ending moves the involved groups | `:3302-3311`, `:1693-1708` |
| Q16 | The group pass of `AssociateEnemiesWithStrategicGroups` ignores the cell's class | `:574-605` |
| Q17 | Bandaging: the MEDICKIT bonus tests helmet slot 0; the kit "status" is the stack's total points; the self-bandage phase ends at the first qualified kit owner who is not bleeding; the "best doctor" starts as merc cell 0, qualified or not | `:910-1057`, `:1076-1149` |
| Q18 | EPC cells: attack 0, defence 1000 — they draw fire and are hard to hit | `:2523-2527`, `:2697-2761` |
| Q19 | Capture counts unconscious and retreated mercs and captures retreated ones too | `:3359-3433`, `:1677-1681` |
| Q20 | At close, enemies below `OKLIFE` die even if the enemy won; militia die only below 7 | `:1741`, `:1778` |
| Q21 | The robot "last one standing" branch can fire for a dead robot and end the battle while its unconscious controller lives (inferred) | `:3286-3302` |
| Q22 | Autoresolving a loaded battle runs `EndTacticalBattleForEnemy`, which costs `ABANDON_MILITIA` loyalty when militia and enemies are still up | `StrategicMap.cc:3065`, `Queen_Command.cc:283-288` |
| Q23 | `GROUPFLAG_HIGH_POTENTIAL_FOR_AMBUSH` comes only from exit-grid departures; that path passes the destination sector to the retreat implications | `StrategicMap.cc:1622`, `:1680-1683` |
| Q24 | `ubPrevSectorID == 255` (no previous sector) maps to P16, so a group really coming from P16 is treated as having none | `Strategic_Movement.cc:170`, `:2769` |
| Q25 | Creatures skip 7 % of their attacks (target already chosen, draws spent) | `:3708-3711` |
| Q26 | Retreat trips are partly consumed by the 300 s warp and by AR's warp | `PreBattle_Interface.cc:1067`, `Auto_Resolve.cc:1819` |
| Q27 | Battle time ×3 first, then +5 min for a retreat, bandage time unmultiplied | `:1276`, `:1337`, `:1148` |
| Q28 | The non-persistent PBI checks underground battles against the surface sector record | `PreBattle_Interface.cc:242-252` |
| Q29 | `SetThisSectorAsEnemyControlled` flips `fEnemyControlled` before its "mercs still here" early return | `Player_Command.cc:240-250` |

The oracle confirms Q12, Q14, Q16 and Q22 (§6.4).

### 7.2 Deviations

Full entries in `deviations.md`; the ids are cited by the sections above and by the code.

| # | ja2-node | `deviations.md` entry |
|---|---|---|
| D1 | Always 1000 ms slices (Finish); Pause/Play/Fast/Finish pace the playback; retreat orders between slices | "Autoresolve slices" |
| D2 | Sound picks and the stat-change quote on `fx`; no battle sounds, splat or music draws | "Autoresolve cosmetic draws" |
| D3 | At most 32 enemy cells (elites, troops, admins by index), so the excess soldiers' creation draws are not spent; the excess is eliminated on victory as in the original | "Autoresolve cell counts" |
| D4 | The clock is frozen under every `preBattle` prompt; the PBI opens without quote time | "Pre-battle interface" |
| D5 | One weighted `main(100)` per creature instead of `std::discrete_distribution` | "Creature bodies for town attacks" |
| D6 | Instant kills get `close = true` explicitly | "Autoresolve instant kills" |
| D7 | A bandage pass without progress stops the loop | "Autoresolve bandage loops" |
| D8 | `chooseTarget` without a target throws | "Autoresolve target without candidates" |
| D9 | Missing tactical copies are created fresh | "Autoresolve copies of tactical enemies" |
| D10 | More than 20 merc cells throws | "Autoresolve cell counts" |

---

## 8. Unverified

Not traced end to end and not reached by the oracle probes:
- That every AR soldier sits at `NOWHERE`, so instant kills always use the "close" rules (§2.8.4): mercs that never entered a
  map since loading a save could carry another gridNo (save import keeps gridNos); a merc's leftover `sDamage`.
- Q2: the random-ambush branch is effectively unreachable (§1.3).
- Q21: the robot edge of §2.12.
- The LAW in AR, the second-gun reload's AP check (§2.8.1), the creature timer wrap (§2.6.3).
- That the original's clock can tick at 1× under a PBI opened without the quote path (§1.7, D4).
- That retreating from a sector does not flip control by itself (§3.1).
- That unloading the loaded battle sector before AR draws nothing else that matters (§2.20).

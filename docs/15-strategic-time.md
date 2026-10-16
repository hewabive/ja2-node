<!-- Strategic time: the world clock, time compression, the strategic event queue, periodic updates and new-game
initialisation. An implementable spec for M4. 2026-10-15.
Source: reference/stracciatella/src (ae6bf01, same snapshot as docs 01–14) and reference/stracciatella/assets/externalized,
cross-checked against vanilla (reference/vanilla/ja2/Build) where marked. Read-only research: nothing was built or run. -->

# 15 — Strategic time: the game clock, the event queue and new-game initialisation

**Conventions.** Paths are relative to `reference/stracciatella/src/game/` unless they start with `sgp/` (then relative to
`reference/stracciatella/src/`) or `assets/` (relative to `reference/stracciatella/`); `V:` is vanilla `Build/`.
"(inferred)" marks conclusions not traced end to end; everything else was read in the code. C integer semantics apply:
`/` truncates toward zero, `UINT32` arithmetic wraps. `Random` and `Chance` are the `main` stream, `PreRandom` the `pre`
stream (`01` §3.6); `Random(0)` returns 0 **without** drawing (`sgp/Random.cc:63-69`), `Chance(x)` is `Random(100) < x`.
"World seconds" are `guiGameClock` units (the strategic clock). "Real ms" are `guiBaseJA2Clock` units: the original's
wall-clock-driven millisecond counter (`Utils/Timer_Control.h:49-51`, advanced in `sgp/SGP.cc:125-126`), which ja2-node
replaces with a virtual counter advanced 5 ms per tick (D3). "Policy" values are Stracciatella defaults from
`assets/externalized/game.json` and `strategic-ai-policy.json` (copied unchanged into `data/externalized/`). Difficulty
values: `DIF_LEVEL_EASY 1, MEDIUM 2, HARD 3` (`GameSettings.h:78-81`).

**Companions** (written in parallel; referenced by file name, not duplicated): `16-strategic-map-movement.md` (sectors,
groups, routes, travel, `GroupArrivedAtSector`, encounters, sector transitions and persistence), `17-strategic-ai.md`
(Queen, garrisons, patrols, `InitStrategicAI` details, `EvaluateQueenSituation`, creatures), `18-militia-loyalty-mines-
assignments.md` (hourly assignment work, militia, loyalty, mines), `19-autoresolve-pbi.md` (pre-battle interface,
autoresolve). Earlier docs: `04` (drivers, `advance`), `08` §2 (the real-time turn), `10` §8.4 (time in combat), `14`
(savegame sections).

---

## 0. State this spec adds

**World clock** (`Strategic/Game_Clock.cc:64-87`, all saved unless marked transient):
`worldSeconds` (`guiGameClock`, u32), `previousWorldSeconds` (`guiPreviousGameClock`, monotonic guard), `compressionMode`
(`giTimeCompressMode`, i32, 0..4), `secondsPerRealSecond` (`guiGameSecondsPerRealSecond`, u32), `resolution`
(`gubClockResolution`, u8, updates per real second, 0..60), `compressionOn` (`gfTimeCompressionOn`), `paused`
(`gfGamePaused`), `pauseLocked` + `pauseLockReason` (`gfLockPauseState`, `guiLockPauseStateLastReasonId`),
`timeInterrupt` (`gfTimeInterrupt`), `timeInterruptPause` (`gfTimeInterruptPause`, transient), `playerPause`
(`gfPauseDueToPlayerGamePause`), `lastEventQuerySeconds` (`guiTimeOfLastEventQuery`), `resetPlayerKnowsEnemies`
(`gfResetAllPlayerKnowsEnemiesFlags`), `compressedSinceMapEntry` (`fTimeCompressHasOccured`, transient). The derived
`day`, `hour`, `minute` (`guiDay`, `guiHour`, `guiMin`) are recomputed after every change (`UpdateGameClockGlobals`,
`:923-931`).

**Clock driver statics** (function statics of `UpdateClock`, `:587-589`, and `guiTimesThisSecondProcessed :73`; not
saved): `lastSecondMs`, `lastProcessed`, `lastResolution` (initially 1), `timesThisSecond`.

**Real-time counter**: `realMs` (`guiBaseJA2Clock`, saved in general info, `SaveLoadGame.cc:1865`), plus the strategic
turn statics `lastTacticalTurnMs` (`guiLastTacticalRealTime`, `Strategic/Strategic_Turns.cc:14`, not saved) and the
`STRATEGIC_OVERHEAD` counter deadline (20 ms, `Utils/Timer_Control.cc:28`).

**Environment** (`TileEngine/Environment.cc:113-119`): `envLightValue` (`gubEnvLightValue`, saved in the clock section),
`desertTemperature`, `globalTemperature` (`gubDesertTemperature`, `gubGlobalTemperature`, saved in general info,
`SaveLoadGame.cc:1922-1923`), `doLighting` (`gfDoLighting`, transient).

**Event queue** (`Strategic/Game_Events.cc:9-15`): an ordered list of `{stamp, kind, frequency, param, offset, flags}`
plus the processing guard `executingStamp` (`guiTimeStampOfCurrentlyExecutingEvent`) and `processing`
(`gfProcessingGameEvents`), both transient.

**Campaign start flags**: `didGameJustStart` (`gTacticalStatus.fDidGameJustStart`, set by `InitOverhead`,
`Tactical/Overhead.cc:348`; cleared after the first helicopter warp, `GameScreen.cc:696`), `gameStarted`
(`fHasAGameBeenStarted`), `screenCount` (`gubScreenCount`, the new-game state machine, `Strategic/Game_Init.cc:70`),
`atLeastOneMercHired` (`gfAtLeastOneMercWasHired`). ja2-node also needs the flow (`01` §3.2 `FlowState`): `strategic`
(the original's `MAP_SCREEN`) or `tactical` (`GAME_SCREEN`); every other screen stops the clock (§1.5).

---

## 1. The world clock

### 1.1 Units and helpers (`Strategic/Game_Clock.h:9-15, 100-101, 150-161`; `Game_Clock.cc:108-153, 893-901`)

| Name | Value / formula |
|---|---|
| `NUM_SEC_IN_DAY`, `_HOUR`, `_MIN` | 86400, 3600, 60 |
| `NUM_MIN_IN_DAY`, `_HOUR` | 1440, 60 |
| `STARTING_TIME` | `1·3600 + 0 + 86400` = **90000 s = Day 1, 01:00** |
| `FIRST_ARRIVAL_DELAY` | `6·3600` = 21600 s (the first mercs land at Day 1, 07:00) |
| `day`, `hour`, `minute` | `clock / 86400`, `(clock − day·86400) / 3600`, `(clock − day·86400 − hour·3600) / 60` |
| `GetWorldTotalMin()` | `clock / 60` |
| `GetWorldTotalSeconds()` | `clock` |
| `GetWorldMinutesInDay()` | `hour·60 + minute` |
| `GetWorldDayInSeconds()` / `InMinutes()` | `day·86400` / `day·1440` (midnight of today) |
| `GetFutureDayInMinutes(d)` | `d·1440` |
| `GetMidnightOfFutureDayInMinutes(d)` | `GetWorldTotalMin() + d·1440 − GetWorldMinutesInDay()` |
| `DayTime()` / `NightTime()` | `7 <= hour < 21` / its negation |

Day numbering starts at 0 (`clock < 86400`), but a campaign starts on Day 1. The clock string is
`"<Day> <day>, HH:MM"` (`:930`). `GotoNextTimeOfDay` is declared but not defined (dead).

### 1.2 Compression modes, speed and resolution

```
enum { NOT_USING_TIME_COMPRESSION = -1, TIME_COMPRESS_X0, X1, 5MINS, 30MINS, 60MINS, TIME_SUPER_COMPRESS }   // Game_Clock.h:83-93
giTimeCompressSpeeds = { 0, 1, 5*60, 30*60, 60*60 }      // world s per real s; index 5 is 0 (5 initialisers, 6 slots)  // :79
SECONDS_PER_COMPRESSION = 1                               // the comment "1/2 minute" is stale                         // :53
```

`SetClockResolutionToCompressMode(m)` (`:433-462`): `secondsPerRealSecond = speeds[m] · 1`; `resolution = 0` if that is
0, else `max(1, secondsPerRealSecond / 60)` clamped to 0..60 (`:565-569`); `compressionOn = m > X1`; for any mode above X1
it also calls `HandleTimeCompressWithTeamJackedInAndGearedToGo()` (the first-arrival hook, §4.5).

| Mode | World s per real s | Resolution (slices per real s) | World s per slice | Real ms per slice |
|---|---|---|---|---|
| X0 | 0 | 0 | — | clock stopped |
| X1 (tactical) | 1 | 1 | 1 | 1000 |
| 5MINS | 300 | 5 | 60 | 200 |
| 30MINS | 1800 | 30 | 60 | 33.3 |
| 60MINS | 3600 | 60 | 60 | 16.7 |

So under compression the clock always moves in **60-second slices**; in tactical real time in 1-second steps.
`TIME_SUPER_COMPRESS`, `fSuperCompression`, `SetGameHoursPerSecond` and `SetGameMinutesPerSecond` (`:466-485`) are never
used (dead; `fSuperCompression` is still saved). `NOT_USING_TIME_COMPRESSION` is set only by those dead functions; the
fallback in `HandleStrategicTurn` (`Strategic_Turns.cc:47-50`) is therefore dead too.

**Mode changes** (all refuse with `TellPlayerWhyHeCantCompressTime()` when `AllowedToTimeCompress()` fails, §1.6):

- `SetGameTimeCompressionLevel(m)` (`:393-427`): in `GAME_SCREEN` any request becomes X1; in `MAP_SCREEN` X1 becomes X0;
  modes ≥ 5MINS need `AllowedToTimeCompress()`; then `mode = m` and the resolution is set.
- `IncreaseGameTimeCompressionRate()` (`:340-364`): below 60MINS, `mode++`, skipping X1 in `MAP_SCREEN`.
  `DecreaseGameTimeCompressionRate()` (`:367-390`): above X0, `mode--`, skipping X1 in `MAP_SCREEN`.
- `StartTimeCompression()` (`:276-320`): if not on: unpause (give up if the pause is locked); require
  `AllowedToTimeCompress()`; if `mode <= X1` increase it (→ 5MINS on the map); set the resolution; on the first
  compression since entering the map screen (`compressedSinceMapEntry`, reset at `MapScreen.cc:1722`) call
  `ClearTacticalStuffDueToTimeCompression()` (`:904-920`: if in map mode, clear the tactical event queue and message
  queue and, if a world is loaded, `CencelAllActionsForTimeCompression` = `EVENT_StopMerc` + `CancelAIAction` for every
  soldier in the sector, `Tactical/Overhead.cc:5867-5879`).
- `StopTimeCompression()` (`:266-273`): if on, set the resolution of X0 **but keep `mode`** (remembered for the next
  start). `compressionOn` becomes false.
- `IsTimeBeingCompressed()` (`:324-330`) = `compressionOn && mode != X0 && !paused`. Note: false in tactical (X1 has
  `compressionOn = false`).
- Map buttons (`Strategic/Map_Screen_Interface.cc:3929-3990`): toggle = start/stop; "+" when stopped jumps to 5MINS
  (`SetGameTimeCompressionLevel(5MINS)`, "ARM change"), when running increases; "−" when running decreases, when stopped
  does nothing but the permission check.
- Entering the map screen (`MapScreen.cc:1420-1430`): a mode in 5MINS..60MINS is kept but stopped, anything else becomes
  X0. Leaving it (`MapScreen.cc:3238-3256`): to tactical → `SetGameTimeCompressionLevel(X1)`; to any other screen →
  `StopTimeCompression()`; then `UnLockPauseState()`, the auto-pause update, and `UnPauseGame()` when going to tactical
  without a player pause.

### 1.3 `UpdateClock`: how the clock advances (`Game_Clock.cc:581-692`)

Called once per pass of the game loop, **after** the screen handler (`GameLoop.cc:204, 216, 220`). The original loop runs
at up to 144 Hz (`sgp/SGP.cc:190-198`); the real-ms counter is the wall clock, frozen only by `PauseTime(TRUE)`
(`Utils/Timer_Control.cc:63-71, 88-98`).

```
UpdateClock(realMs):
  CreateDestroyScreenMaskForPauseGame()                                   // UI only
  if screen ∉ {GAME, MAP}:  lastSecondMs = realMs; timeInterruptPause = false; return              // :602-607
  if paused || timeInterruptPause || resolution == 0 || secondsPerRealSecond == 0 || fading:
      lastSecondMs = realMs; timeInterruptPause = false; return                                     // :609-614
  if inCombat: return                                  // lastSecondMs is NOT refreshed               // :616-617
  lastSecondMs = max(realMs − 1000, lastSecondMs)      // never more than one real second per pass    // :634 (u32)
  elapsed = realMs − lastSecondMs
  if elapsed >= 1000 && resolution == 1:                                                            // :639-644
      lastSecondMs = realMs; timesThisSecond = lastProcessed = 0
      AdvanceClock(WARPTIME_PROCESS_EVENTS_NORMALLY)   // + secondsPerRealSecond (1 in tactical)
  else if resolution > 1:                                                                           // :645-691
      if resolution != lastResolution:
          timesThisSecond = timesThisSecond · resolution / lastResolution
          lastProcessed   = lastProcessed   · resolution / lastResolution
          lastResolution  = resolution
      slice = 1000000 / resolution                     // 200000 / 33333 / 16666
      if elapsed >= slice · (timesThisSecond + 1) / 1000:
          timesThisSecond = elapsed · 1000 / slice
          newProcessed = max(secondsPerRealSecond · timesThisSecond / resolution, lastProcessed)
          WarpGameTime(newProcessed − lastProcessed, WARPTIME_PROCESS_EVENTS_NORMALLY)
          if newProcessed < secondsPerRealSecond: lastProcessed = newProcessed
          else:                                        // a real second is complete
              lastProcessed = newProcessed % secondsPerRealSecond
              timesThisSecond = resolution > 0 ? timesThisSecond % resolution : 0   // 0: an event stopped compression
              lastSecondMs = realMs
```

On an ideal 5 ms loop (ja2-node) this gives, per real second measured from `lastSecondMs`:

- X1: one 1-second advance when `elapsed` reaches 1000, i.e. every 200 ticks.
- 5MINS: a 60 s slice at elapsed 200, 400, 600, 800, 1000 ms.
- 30MINS: slices at 35, 70, 100, 135, 170, 200, … ms (the first 5 ms tick past each 33⅓ ms boundary), 30 per second.
  The truncated thresholds (33, 66, 99, 133, …) never fall on a multiple of 5, so no pass warps 0 s.
- 60MINS: slices at 20, 35, 50, 70, 85, 100, … ms, 60 per second; no 5 ms tick ever crosses two boundaries.

Two clock drifts are part of the behaviour: `lastSecondMs` is reset to the pass time (not advanced by 1000), and every
pause, fade or screen change re-phases it.

### 1.4 `AdvanceClock` and `WarpGameTime` (`Game_Clock.cc:160-219`)

```
WarpGameTime(adjust, code):                      // :160-167
  saved = secondsPerRealSecond; secondsPerRealSecond = adjust; AdvanceClock(code); secondsPerRealSecond = saved

AdvanceClock(code):                              // :170-219
  if code != WARPTIME_NO_PROCESSING_OF_EVENTS:
      lastEventQuerySeconds = clock
      if GameEventsPending(secondsPerRealSecond): ProcessPendingGameEvents(secondsPerRealSecond, code)   // §2.5
      else clock += secondsPerRealSecond
  else clock += secondsPerRealSecond
  if clock < previousWorldSeconds: clock = previousWorldSeconds          // "time flowing backwards" guard
  previousWorldSeconds = clock
  UpdateGameClockGlobals()
  if resetPlayerKnowsEnemies && !fEnemyInSector:                         // set after a PBI, PreBattle_Interface.cc:440
      clear SF_PLAYER_KNOWS_ENEMIES_ARE_HERE in all 256 SectorInfo; resetPlayerKnowsEnemies = false
  ForecastDayEvents()                                                    // TileEngine/Environment.cc:318-367
```

`ForecastDayEvents` only acts when `day != guiEnvDay`: it stores the day and calls `BuildDayAmbientSounds()` (ranged
`EVENT_AMBIENT` events, §2.7); the light rebuild and the rain forecast are commented out.

**Warp codes** (`Game_Clock.h:110-115`) and every caller:

| Code | Meaning | Callers |
|---|---|---|
| `WARPTIME_PROCESS_EVENTS_NORMALLY` | events inside the window run in order, the clock steps to each stamp | `UpdateClock` (every slice); the first helicopter arrival, 21600 s (`GameScreen.cc:691`); quest debug |
| `WARPTIME_NO_PROCESSING_OF_EVENTS` | the clock jumps; skipped events stay queued in the past and run at the next normal advance | autoresolve battle time (`Strategic/Auto_Resolve.cc:1819`), PBI retreat 300 s (`Strategic/PreBattle_Interface.cc:1067`), last group retreating from a hostile sector 300 s (`Strategic/StrategicMap.cc:1810`), auto-bandage duration (`Tactical/Auto_Bandage.cc:356`), brothel 5–24 min with `Random(20)` (`JAScreens.cc:483`) |
| `WARPTIME_PROCESS_TARGET_TIME_FIRST` | only the **last** event stamped exactly at the target second runs; earlier ones are skipped and stay queued | adjacent-sector traversal: to the start of minute `now + 5` above ground, `now + 1` underground (`StrategicMap.cc:1817-1827`); see `16` |

### 1.5 Pausing, locks and what freezes the clock

There are five independent stoppers; each has different reach:

| Stopper | Set by | World clock | Real-ms counter (tactical animation, strategic turn) |
|---|---|---|---|
| `inCombat` (turn-based) | `EnterCombatMode` | frozen (`:616-617`) | runs |
| `paused` (`PauseGame`, `:512-520`) | many, below | frozen | runs; but `HandleStrategicTurn` returns while paused (`Strategic_Turns.cc:39-44`), so no real-time turns either |
| resolution 0 / speed 0 | X0 on the map, `StopTimeCompression` | frozen | runs |
| screen not GAME/MAP, or a fade | laptop, options, save/load, autoresolve screen, help, fades | frozen (`lastSecondMs` re-phased) | runs |
| `PauseTime(TRUE)` | message boxes (`MessageBoxScreen.cc:270-274`), the player's pause (`Game_Clock.cc:822-826`) | frozen (no real ms elapse) | frozen; `COUNTERDONE` never fires (`Timer_Control.cc:152`) |

`timeInterruptPause` (`PauseTimeForInterupt`, `:553-556`) skips exactly one `UpdateClock` pass; the map screen sets it
together with `InterruptTime` while the assignment or contract menu is open (`MapScreen.cc:6057-6070`).

**Pause locks.** `LockPauseState(reason)` (`:490-497`) only forbids *unpausing* and compressing; it is a single flag, not
a counter: any `UnLockPauseState()` (`:500-503`) clears it whatever the reason, and `UnPauseGame()` while locked is
ignored with a warning (`:523-538`). `PauseGame` always works. Reasons (`Game_Clock.h:27-47`) and their sites:
`MSGBOX 1` (message box), `CREATURE_ATTACK 2` (`Creature_Spreading.cc:603-605`), `DISPLAY_SOLDIER_UPDATE 4`
(assignment-update box, `Map_Screen_Interface.cc:3214-3216`), `CREATE_SOLDIER_UPDATE 5` (`:3453-3454`), `MEANWHILE 6`
(`Meanwhile.cc:212-214`), `CONTRACT_RENEWAL 7` / `CONTRACT_ENDING 8` (`Merc_Contract.cc:105-107, 562-564`),
`PREBATTLE_CURRENT_SQUAD 11` / `PREBATTLE 12` (`Strategic_Movement.cc:660-662, 681-683`), `SIMULTANEOUS_ARRIVAL 13`
(`:1579-1581`), `ENGAGED_IN_CONV 14` (`Tactical/Dialogue_Control.cc:289-290`), `MERC_TALKING 15` (a quote on the map
screen, `Dialogue_Control.cc:639-643`), `LOCKUI_MODE 16` / `LOCKOURTURN_UI_MODE 17` (`Tactical/Handle_UI.cc:4026-4027,
4478-4479`), `ITEM_PICKUP 18` (`Interface_Items.cc:4288-4290`), `DOOR_OPEN 19` (`Interface.cc:1272-1274`), `START_HELI 20`
(`Merc_Entering.cc:412-414`), `SECTOR_EXIT 21` (`Strategic_Exit_GUI.cc:373-375`). Plain `PauseGame` without a lock: the
laptop (`Laptop/Laptop.cc:462`), shop keeper, options, help, boxing, auto-bandage, save, `EnterSector` (sector load,
`StrategicMap.cc:839-841`, also `InterruptTime`), `MercsContractIsFinished` (`Strategic_Merc_Handler.cc:396-410`, also
`InterruptTime`).

The player's pause (`HandlePlayerPauseUnPauseOfGame`, `:793-828`): ignored while `ENGAGED_IN_CONV`; toggles
`PauseGame`/`PauseTime` together with `playerPause`; unpausing in `GAME_SCREEN` with mode X0 first sets X1.

### 1.6 `AllowedToTimeCompress` and the automatic pause (`Strategic/Map_Screen_Interface_Bottom.cc:732-836`)

False when any holds, in this order: leaving the map screen or an exit is pending; the pause is locked; a meanwhile is
trying to start; the dialogue queue is not empty; a destination is being plotted (`bSelectedDestChar != −1`, heli plot,
move confirmation, movement list); an assignment/training/attribute/squad/contract menu is open; the update box, town
info or militia popup is shown; a contract renewal sequence runs; the map is disabled by a battle (`fDisableMapInterface-
DueToBattle`, `fDisableDueToBattleRoster`); an inventory item is held; the sector inventory is shown; **no merc was ever
hired**; **no usable merc** (alive, not mechanical, not POW, not dead, not EPC; in-transit counts,
`:934-949`); a timed bomb is active; `inCombat` or `fEnemyInSector`; a player group is in a creature-infested mine; a
bloodcat ambush with hostile bloodcats present.

`TellPlayerWhyHeCantCompressTime` (`MapScreen.cc:6250-6316`) explains the first matching reason; its last branch has a
side effect: with `inCombat` or `fEnemyInSector` it opens the non-persistent PBI (`InitPreBattleInterface(0, false)`) unless
only hostile civilians are present.

Every map-screen frame `UpdatePausedStatesDueToTimeCompression()` (`MapScreen.cc:5413-5440`, called at `:1908`) pauses
the game when time is being compressed but no longer allowed, and unpauses it when compression is wanted
(`compressionOn`), there is no player pause, and it is allowed again. This is how a quote on the map (non-empty dialogue
queue) or the update box stops time **without** stopping compression: the clock resumes on its own afterwards.

### 1.7 Tactical: real time, turn-based combat and the strategic turn

**Real time.** In `GAME_SCREEN` the mode is always X1, so **one world second passes per 1000 real ms**: 200 ja2-node
ticks. Strategic events (enemy groups arriving, Queen decisions, mine income) keep firing while the player is in
tactical. Nothing in tactical can raise the compression.

**Turn-based combat.** The world clock is frozen for the whole battle (`Game_Clock.cc:616-617`; vanilla also freezes it,
`V:Strategic/GameClock.c:600-601`; its "10 s per real s in combat" local in `AdvanceClock` was dead code,
`V:GameClock.c:147-155`). Because `lastSecondMs` is not refreshed in combat, the first pass after combat ends advances one
world second at once (the clamp caps `elapsed` at 1000). `UpdateClock` is also called from `StartPlayerTeamTurn`
(`Tactical/TeamTurns.cc:138`), a no-op in combat.

**The strategic turn** (`HandleStrategicTurn`, `Strategic/Strategic_Turns.cc:30-88`) is the real-time "turn" of `08` §2
and `10` §8.4. It is called every pass from the game screen (`GameScreen.cc:346`, inside `if (!ARE_IN_FADE_IN())`) and
from the map screen (`MapScreen.cc:1618`) and auto-bandage (`Tactical/Auto_Bandage.cc:225`):

```
HandleStrategicTurn():
  if !COUNTERDONE(STRATEGIC_OVERHEAD): return                 // 20 ms × game_durations_multiplier (1.0), auto-reset
  if paused || (screen == MAP && !IsTimeBeingCompressed()): return
  t = realMs
  if inCombat: lastTacticalTurnMs = t; return
  check = IsTimeBeingCompressed() ? 5000 / (speeds[mode] · RT_COMPRESSION_TACTICAL_TURN_MODIFIER 10) : 5000
  if t − lastTacticalTurnMs > check: HandleTacticalEndTurn(); lastTacticalTurnMs = t
```

`NUM_REAL_SEC_PER_TACTICAL_TURN 5000` and the modifier 10 are in `Tactical/RT_Time_Defines.h:14-16`. `check` is 5000 in
tactical, `5000/3000 = 1` at 5MINS and `0` at 30/60MINS. `SyncStrategicTurnTimes` (`lastTacticalTurnMs = realMs`) runs at
new game (`StrategicTurnsNewGame`), every `SetCurrentWorldSector` (`StrategicMap.cc:435`), `CommonEnterCombatModeCode`
(`Overhead.cc:3971`), combat exit (`HandleStrategicTurnImplicationsOfExitingCombatMode`, which also runs
`HandleTacticalEndTurn` at once, `Strategic_Turns.cc:91-95`) and the first heli drop (`Merc_Entering.cc:782`).

Consequences, on an ideal 5 ms loop:

- In tactical the counter fires every 20 ms, so the turn falls on the first fire with more than 5000 ms elapsed: **every
  5020 ms**, not 5005 (`08` §6.3 inferred 5005; the existing `handleRealtimeTurns` checks every tick).
- On the map while compressing, `check` ≤ 1 makes every counter fire a turn: **one `HandleTacticalEndTurn` per 20 real ms**,
  which is 10 turns per world minute at 5MINS, 1⅔ at 30MINS and ⅚ at 60MINS. The original's real rate depends on its frame
  rate (at 144 Hz a 20 ms counter polled every 6.94 ms fires every ~20.8 ms). The intent of the formula
  (`5000/(C·10)` real ms = one turn per 0.5 world s) is defeated by integer truncation and the counter.
- `HandleTacticalEndTurn` (`Tactical/Tactical_Turns.cc:80-157`) runs `EVENT_BeginMercTurn` for **every** living,
  non-mechanical merc on the player's team, in any sector, and for the loaded sector's other soldiers: bleeding (`10`
  §2.7, `nextBleed −= 0.5`), breath, shock, drug decay, first aid (`HandlePlayerServices`, which only acts on a merc
  playing the `GIVING_AID` animation, `Overhead.cc:3830-3833`), plus smoke/light/blood decays of the loaded sector by
  world seconds, pending enemies, and the public opplist decay. So **how fast a wounded merc bleeds per world minute
  on the map depends on the compression level** (12× slower at 60MINS than at 5MINS). This is gameplay-relevant and must
  be reproduced deterministically (§1.8).
- No real-time turn runs while the game is paused (conversation, heli drop, item pickup menu, …).

### 1.8 Ticks and world seconds in ja2-node; what the drivers do

**Normative model.** The session owns one virtual real-ms counter `realMs` (the original's `guiBaseJA2Clock`). Every
tick adds 5 ms in every flow; nothing steps while a decision prompt is open (D15), which matches `PauseTime(TRUE)` under
message boxes. Per tick, in the original's loop order:

```
tick():
  realMs += 5
  if flow == tactical:
      apply a pending light change (EnvironmentController, GameScreen.cc:333)          // §1.10
      tactical pass (doc 10 order), in which handleStrategicTurn runs when the 20 ms counter fires (GameScreen.cc:346)
  else if flow == strategic:
      handleStrategicTurn on the 20 ms counter (MapScreen.cc:1618)
      speech/dialogue queue progress (MapScreen.cc:1901), auto-pause update (§1.6, :1908), meanwhile and PBI hooks
  updateClock(realMs)                                                                  // §1.3, events §2.5
```

Port `UpdateClock` and `HandleStrategicTurn` literally with their statics as state; the slice cadences of §1.3 and the
strategic-turn rate of §1.7 then follow without special cases. Tactical soldiers are not stepped while the flow is
`strategic` (the original never calls `ExecuteOverhead` from the map); their absolute deadlines are simply in the past on
return, like an expired `TIMECOUNTER`.

| Situation | World seconds per tick | Ticks per world minute |
|---|---|---|
| Tactical real time | 1 per 200 ticks | 12,000 |
| Turn-based combat | 0 | ∞ (tactical ticks still run) |
| Map, X0 / stopped / paused | 0 | ∞ (speech still plays out) |
| Map, 5MINS | 60 per 40 ticks | 40 |
| Map, 30MINS | 60 per 6–7 ticks (30 per 200) | 6.67 |
| Map, 60MINS | 60 per 3–4 ticks (60 per 200) | 3.33 |

A world day costs 57,600 ticks at 5MINS and 4,800 at 60MINS; each map tick is an `updateClock` call plus, every fourth
tick, a strategic turn. Event jumping (`04` §2, level 1b) can skip to the next slice or counter deadline later; it is
not needed for M4.

**Drivers** (`04` §4.3), on the strategic map:

- *Real time ×k*: as today, `realMs` advances `k·5` ms of virtual time per 5 wall ms; at k = 1 a human sees the original's
  pacing (5 min of world time per second at 5MINS). Compression itself is sim state changed only by commands (D15).
- *Instant*: after an accepted command, run to `idle`. On the map `idle` means "time is not flowing and nothing is
  pending": `!IsTimeBeingCompressed()`, empty speech queue, no auto-unpause due. So `startTimeCompression` under the
  instant driver compresses until compression stops (arrival, battle, message box, …).
- *Manual*: `advance` with world-time or event stop conditions (§6). `DEFAULT_ADVANCE_BUDGET_TICKS` (200,000 ticks =
  1000 virtual s) covers 3.5 world days at 5MINS and 41 at 60MINS; strategic `advance` should take a world-seconds budget.

### 1.9 Compression-dependent rules

Beyond the strategic-turn rate (§1.7), these read the compression state and are outcome-relevant:

- Natural healing: the activity divisor is LOW ("basically resting") when `IsTimeBeingCompressed()` and the merc's group is
  not moving, else HIGH (`Strategic/Assignments.cc:2886-2897`), evaluated inside the hourly update (`18`). An hour that ticks
  over in tactical, or on the map while not compressing, heals less.
- `RandomMercInGroupSaysQuote` returns early during tactical traversal or underground unless compressing
  (`Map_Screen_Interface.cc:1403-1406`), which changes whether a `Random(n)` draw happens.
- Tactical screen messages are suppressed while compressing (`Utils/Message.cc:304`); cosmetic.

### 1.10 Time of day: light and temperature (`TileEngine/Environment.cc`, `.h`)

Constants: `DAWN_START 6:47`, `DAY_START 7:05`, `DUSK_START 20:57`, `NIGHT_START 21:15` (`:26-29`; the older 5:00–22:00
set at `:18-25` is commented out); `NORMAL_LIGHTLEVEL_NIGHT 12`, `NORMAL_LIGHTLEVEL_DAY 3` (`Environment.h:21-22`);
`HOT_DAY_LIGHTLEVEL 2` (`:110`); light sprite hours `NIGHT_TIME 21–7`, `PRIME_TIME 21–24` (`Environment.h:8-11`).

`BuildDayLightLevels()` (`:229-287`, posted once at new game, §4.3) creates 30 **everyday** events: nine
`EVENT_CHANGELIGHTVAL` at 6:47, 6:49, …, 7:03 with values 11 down to 3; eight `EVENT_TEMPERATURE_UPDATE` (desert: 8:00
warm, 9:00 hot, 17:00 warm, 19:00 cool; global: 9:00 warm, 12:00 hot, 14:00 warm, 17:00 cool, `:251-259`); nine
`EVENT_CHANGELIGHTVAL` at 20:57, …, 21:13 with values 4 up to 12; then `TURN_ON_NIGHT_LIGHTS` 21:00, `TURN_OFF_NIGHT_LIGHTS`
7:00, `TURN_ON_PRIME_LIGHTS` 21:00, `TURN_OFF_PRIME_LIGHTS` 0:00 (24 → 0, `:279-286`).

- `EVENT_CHANGELIGHTVAL`: `envLightValue = param`; `doLighting = true` unless in a basement or cave.
- `EVENT_TEMPERATURE_UPDATE`: sets the desert or global temperature to 0/1/2 and `doLighting = true` (`:465-489`).
- `GetTimeOfDayAmbientLightLevel()` (`:369-379`) = 2 when `SectorTemperature(loaded sector) == HOT`, else `envLightValue`;
  `SectorTemperature` (`:491-506`) is 0 underground, the desert temperature where `IsSectorDesert` (traversability
  `THROUGH == SAND`, `StrategicMap.cc:2896-2899`), else the global one. So desert sectors are brighter (2) from 9:00 to
  17:00 and every surface sector from 12:00 to 14:00.
- The tactical base light follows in `EnvironmentController(TRUE)` (`:122-227`), called every game-screen pass before
  the tactical overhead (`GameScreen.cc:333`): if `doLighting`, `LightSetBaseLevel(GetTimeOfDayAmbientLightLevel())`,
  merc lights refresh, `doLighting = false`. `AllTeamsLookForAll` is commented out (`:218`): a light change does not trigger
  sight checks by itself. A sector load sets the level directly (`TileEngine/WorldDef.cc:2346`), a savegame load too
  (`SaveLoadGame.cc:1042-1043`).
- `envLightValue` starts at **0** in a fresh process (`:115`) and is reset by nothing but the event; `InitNewGameClock`
  does not touch it. At 07:00 on Day 1, when the first squad lands, the 6:59 event has set it to 5; it reaches 3 at 7:03.

---

## 2. The strategic event queue

### 2.1 Event record (`Strategic/Game_Events.h:7-29`)

```
STRATEGICEVENT { next; uiTimeStamp (u32 world s); uiParam (u32); uiTimeOffset (u32 s); ubEventType (frequency);
                 ubCallbackID (kind); ubFlags (SEF_DELETION_PENDING 0x02) }
StrategicEventFrequency { ONETIME_EVENT 0, RANGED_EVENT 1, ENDRANGED_EVENT 2, EVERYDAY_EVENT 3, PERIODIC_EVENT 4,
                          QUEUED_EVENT 5 (never used) }
```

Saved as `u32 n` then n × 28 bytes in list order: 4 skipped, stamp, param, offset, type, kind, flags, 9 skipped
(`Game_Events.cc:325-351`); loading rebuilds the list in file order (`:354-384`). The reader already decodes it
(`src/content/formats/savegame.ts` `readStrategicEvents`).

### 2.2 Ordering and tie-breaking

`AddAdvancedStrategicEvent` (`:171-197`) inserts the new node **after every node with stamp ≤ its own** (the scan stops at
the first strictly greater stamp, `:191`). The list is therefore sorted by stamp and FIFO among equal stamps. Equivalent
implementation: a priority queue keyed by `(stamp, seq)`, `seq` a global counter incremented at every insertion
(reposts included); on load `seq` = file index. Deleting never reorders.

### 2.3 Posting API (`Game_Events.cc:159-264`, declared in `Game_Event_Hook.h:76-116`)

| Function | Frequency | Stamp (world s) | Offset |
|---|---|---|---|
| `AddStrategicEvent(k, minute, p)` | ONETIME | `minute·60` (absolute minute) | 0 |
| `AddStrategicEventUsingSeconds(k, s, p)` | ONETIME | `s` | 0 |
| `AddSameDayStrategicEvent(k, minOfDay, p)` | ONETIME | `(minOfDay + day·1440)·60` (`minOfDay` may exceed 1440) | 0 |
| `AddFutureDayStrategicEvent(k, minOfDay, p, n)` | ONETIME | `(minOfDay + (day + n)·1440)·60` | 0 |
| `AddSameDayRangedStrategicEvent(k, startMin, lenMin, p)` | RANGED | `(startMin + day·1440)·60` | `lenMin·60` |
| `AddEveryDayStrategicEvent(k, minOfDay, p)` | EVERYDAY | `day·86400 + minOfDay·60` (today, may be past) | 0 |
| `AddPeriodStrategicEvent(k, every, p)` | PERIODIC | `day·86400 + every·60` (**from midnight, not from now**) | `every·60` |
| `AddPeriodStrategicEventWithOffset(k, every, off, p)` | PERIODIC | `day·86400 + off·60` | `every·60` |

**Posting guard** (`:173-178`): while `processing` is set (inside `ProcessPendingGameEvents`), a stamp **≤ `executingStamp`**
(the stamp of the event whose callback is running) is rejected: the node is not created and the call returns NULL/FALSE,
silently. A callback can never schedule anything at or before its own time; e.g. `AddEveryDayStrategicEvent` from a
callback is dropped when its stamp (today at that time of day) is not later than the executing event's stamp. Outside
processing, past stamps are accepted and run at the next advance.

`AddPeriodStrategicEvent` anchoring at midnight means a periodic event posted mid-day starts with catch-up firings: the
creature spread event (450 min on medium) posted at 15:00 has a first stamp of 07:30 (past), then 15:00 (= now, still in
the window), then 22:30 (inferred from the code, `Creature_Spreading.cc:249-257`).

### 2.4 Deletion (`Game_Events.cc:25-43, 266-321`)

- `DeleteStrategicEvent(k, param)`: the first node with that kind and param that is not already pending deletion.
- `DeleteAllStrategicEventsOfType(k)`: every such node.
- `DeleteAllStrategicEvents()`: the whole list (new game, restart, load).
- During a callback (`gfPreventDeletionOfAnyEvent`, set by `ExecuteStrategicEvent`, `Game_Event_Hook.cc:62-63`) deletion
  only flags the node (`SEF_DELETION_PENDING`); flagged nodes are skipped by the processing loop (`ExecuteStrategicEvent`
  returns FALSE for them, `:68-72`) and unlinked at the end of `ProcessPendingGameEvents` (`Game_Events.cc:152`).
  ja2-node can remove immediately: no reader observes a flagged node in between (inferred). The executing event itself is
  already out of the queue; deleting its own kind from its callback does **not** prevent its repost (the repost decision
  depends only on the return value, which is TRUE because the flag check precedes the callback).

### 2.5 `ProcessPendingGameEvents(adjust, code)` (`Game_Events.cc:59-156`)

`GameEventsPending(adjust)` (`:18-22`) is "head exists and `head.stamp <= clock + adjust`".

```
ProcessPendingGameEvents(adjust, code):
  timeInterrupt = false; processing = true
  while !timeInterrupt && head-to-tail walk not exhausted && e.stamp <= clock + adjust:
      if code != TARGET_TIME_FIRST:
          if e.stamp > clock: adjust −= e.stamp − clock; clock = e.stamp; UpdateGameClockGlobals()   // AdjustClockToEventStamp :46-56
          ok = ExecuteStrategicEvent(e)        // past events (stamp < clock) run WITHOUT moving the clock back
      else if e.stamp == clock + adjust && (e is the last node with this stamp):
          adjust clock to e.stamp; ok = ExecuteStrategicEvent(e)
      else: skip e (stays queued); continue
      if ok:
          RANGED   → post ENDRANGED (same kind, param) at e.stamp + e.offset   // offset NOT copied: the END node has 0
          PERIODIC → post PERIODIC at e.stamp + e.offset, offset copied
          EVERYDAY → post EVERYDAY at e.stamp + 86400
          unlink e (walk restarts at the head when e was the head)
  processing = false
  unlink nodes pending deletion
  if adjust != 0 && !timeInterrupt: clock += adjust                      // the rest of the window
```

Properties to keep:

- Reposts are based on the event's own stamp, not on the current time: events left in the past by a `NO_PROCESSING` warp
  catch up one by one, each period firing.
- A repost (or any event a callback posts) that lands inside the current window runs in the same pass, in order.
- `InterruptTime()` (`Game_Clock.cc:548-551`, "only applicable inside event callbacks") stops the loop **after** the
  current event (its repost still happens) and discards the rest of the window: the clock stays at that event's stamp.
  Events with the same stamp after it run at the next advance. `timeInterrupt` stays set (and is saved) until the next
  `ProcessPendingGameEvents`.
- Callbacks for past events see `GetWorldTotalSeconds()` = the window start (the clock has not moved yet).
- `TARGET_TIME_FIRST` executes the target event **before** all earlier-due events (they run at the next normal advance):
  a tactical traversal processes the traversing group's arrival first.

### 2.6 `ExecuteStrategicEvent` (`Strategic/Game_Event_Hook.cc:58-319`)

```
ExecuteStrategicEvent(e):
  save prevent flag; preventDeletion = true; executingStamp = e.stamp
  if e is pending deletion: restore; return FALSE
  OnStrategicEvent(e, &handled); if handled: restore; return TRUE        // Lua observer; no listener ships
  switch e.kind: …                                                        // table below
  restore; return TRUE                                                    // unknown kinds fall through: TRUE
```

`DelayEventIfBattleInProgress(e)` (`:45-56`, used only by `EVENT_MEANWHILE`): if `fEnemyInSector`, repost a copy (same
frequency, kind, param, offset) at `e.stamp + 180 + Random(121)` seconds and return TRUE (the callback does nothing else).

### 2.7 Dispatch table: every event kind (`Game_Event_Hook.h:6-70`)

Milestone: **M4** = needed by M4 (strategy); **M4h** = M4 hook with no visible effect yet; **M5** campaign/laptop;
**M6** narrative; **—** never posted / no effect. "Poster" names who schedules it.

| Id | Kind | Frequency, poster | Handler (file) and effect | MS |
|---|---|---|---|---|
| 1 | `CHANGELIGHTVAL` | everyday ×18, `BuildDayLightLevels` | `envLightValue = param`, `doLighting` (§1.10) | M4 |
| 4 | `CHECKFORQUESTS` | everyday 08:00, `SetupNewStrategicGame` | `CheckForQuests(day)` (`Quests.cc:1182`): starts DELIVER_LETTER once, history entry | M6 |
| 5 | `AMBIENT` | ranged, `BuildDayAmbientSounds` (`Environment.cc:289-316`), rebuilt on sector load (`Ambient_Control.cc:41-60`) | start (`param` overwritten by the sound handle) / stop a random ambient sound | — (client) |
| 6 | `AIM_RESET_MERC_ANNOYANCE` | one-shot, `AIMMembers.cc:2234` | `ResetMercAnnoyanceAtPlayer` | M5 |
| 7 | `BOBBYRAY_PURCHASE` | one-shot day+N at 08:00, 09:00, 10:00 or 11:00 (`(8 + Random(4))·60`), `BobbyRMailOrder.cc:1843` | `BobbyRayPurchaseEventCallback` (`Strategic_Event_Handler.cc:54-343`): delivery, loss/theft `Random`, facts, email, `StopTimeCompression` | M5 |
| 8 | `DAILY_UPDATE_BOBBY_RAY_INVENTORY` | everyday 09:00 | Bobby Ray new/used and arms dealers' daily stock (`BobbyR.cc:514, 565`; `Arms_Dealer_Init.cc:239`) | M5 |
| 9 | `UPDATE_BOBBY_RAY_INVENTORY` | one-shot, `BobbyR.cc:659` | `AddFreshBobbyRayInventory(item)` | M5 |
| 10 | `DAILY_UPDATE_OF_MERC_SITE` | everyday 00:00 | `DailyUpdateOfMercSite` (`Laptop/Mercs.cc:513`) | M5 |
| 11 | `DAY3_ADD_EMAIL_FROM_SPECK` | one-shot Day 1+N 07:00, `Game_Init.cc:263` | M.E.R.C. intro email | M5 |
| 12 | `DELAYED_HIRING_OF_MERC` | one-shot, `Merc_Hiring.cc:158` | `MercArrivesCallback(soldier)` (`:224-…`): squad, insertion, contract end, `StopTimeCompression` | M4 (initial squad), M5 |
| 13 | `HANDLE_INSURED_MERCS` | everyday 00:00 | `DailyUpdateOfInsuredMercs` (`Insurance_Contract.cc:675`) | M5 |
| 14 | `PAY_LIFE_INSURANCE_FOR_DEAD_MERC` | one-shot, `Insurance_Contract.cc:908` | payout | M5 |
| 15 | `MERC_DAILY_UPDATE` | everyday 00:00 | `MercDailyUpdate` (`Strategic_Merc_Handler.cc:135-370`), §3.4 | M4 core, M5 rest |
| 18 | `GROUP_ARRIVAL` | one-shot, `Strategic_Movement.cc:280, 1138, 1507, 1538, 1636, 1779, 2809, 2963` | `GroupArrivedAtSector(group, TRUE, FALSE)` (`:1077`), see `16` | M4 |
| 19 | `DAY2_ADD_EMAIL_FROM_IMP` | one-shot, `IMP_Confirm.cc:206` | IMP results email if the policy sends it | M5 |
| 20 | `MERC_COMPLAIN_EQUIPMENT` | one-shot, `Strategic_Merc_Handler.cc:200`, `Merc_Hiring.cc:334` | quote | M5 |
| 21 | `HOURLY_UPDATE` | periodic 60 min, `StrategicMap.cc:2256` | `HandleHourlyUpdate` (`Hourly_Update.cc:35-73`), §3.2 | M4 |
| 22 | `HANDLE_MINE_INCOME` | one-shot 09/12/15/18:00, `Strategic_Mines.cc:522` | `HandleIncomeFromMines` (`:527-540`), see `18` | M4 |
| 23 | `SETUP_MINE_INCOME` | everyday 00:00 | `PostEventsForMineProduction` (`:516-524`): posts the four income events | M4 |
| 27 | `SET_BY_NPC_SYSTEM` | one-shot, `Interface_Dialogue.cc` (14 sites), `Strategic_Event_Handler.cc:322-665` | `HandleNPCSystemEvent` (`:549-691`): facts or NPC actions (`param ≥ 10000`) | M6 |
| 28 | `SECOND_AIRPORT_ATTENDANT_ARRIVED` | one-shot, `Overhead.cc:2318` | Sal placed at the airport | M6 |
| 29, 30 | `HELICOPTER_HOVER_TOO_LONG`, `_WAY_TOO_LONG` | one-shot +10/+20 min, `Map_Screen_Helicopter.cc:444, 453` | Skyrider complains / returns to base | M6 (`16`) |
| 32, 33 | `MERC_LEAVE_EQUIP_IN_OMERTA`, `_DRASSEN` | one-shot +6 h, `Map_Screen_Interface.cc:1032` | dismissed merc's gear appears (`:1086-1097`) | M5 |
| 34 | `DAILY_EARLY_MORNING_EVENTS` | everyday 04:00 | `HandleEarlyMorningEvents` (`Strategic_Event_Handler.cc:693-865`), §3.4 | M6 |
| 35 | `GROUP_ABOUT_TO_ARRIVE` | one-shot arrival − 5 min, player groups only (`Strategic_Movement.cc:55, 281-288`) | `HandleGroupAboutToArrive` (`Map_Screen_Interface.cc:1226-1235`): redraw + Dead-is-Dead autosave | M4 |
| 36 | `PROCESS_TACTICAL_SCHEDULE` | one-shot, `Scheduling.cc:826-1031` | `ProcessTacticalSchedule` | M6 |
| 37, 38, 75 | `BEGINRAINSTORM`, `ENDRAINSTORM`, `RAINSTORM` | never posted (`Environment.cc:338-363` commented out) | empty | — |
| 41 | `MAKE_CIV_GROUP_HOSTILE_ON_NEXT_SECTOR_ENTRANCE` | one-shot +300 min, `Overhead.cc:2767` | rebel loyalty hit, group "will become hostile" (`Strategic_Event_Handler.cc:867-876`) | M6 |
| 42 | `BEGIN_AIR_RAID` | never | no case | — |
| 44 | `MEANWHILE` | one-shot, `Meanwhile.cc:197` | delayed if `fEnemyInSector` (§2.6), else `BeginMeanwhile` + `InterruptTime` | M6 |
| 46 | `CREATURE_SPREAD` | periodic 510/450/390 min, `Creature_Spreading.cc:249-257` | `SpreadCreatures` | `17` (M4 or M6) |
| 48 | `CREATURE_NIGHT_PLANNING` | everyday 22:00, `:264` | `CreatureNightPlanning` (`:884`): may post `CREATURE_ATTACK` at `now + 1 + PreRandom(429)` min | `17` |
| 49 | `CREATURE_ATTACK` | one-shot, `:518, 892` | `CreatureAttackTown`: PBI or tactical add, `InterruptTime` + pause + lock | `17` |
| 50 | `EVALUATE_QUEEN_SITUATION` | one-shot, self-reposting (`Strategic_AI.cc:342, 1948, 1953`) | `EvaluateQueenSituation` (`:1930`), see `17` | M4 |
| 51 | `CHECK_ENEMY_CONTROLLED_SECTOR` | periodic per garrison (`Strategic_AI.cc:515`) | `CheckEnemyControlledSector(sector)` (`:1308`), see `17` | M4 |
| 52–55 | `TURN_ON/OFF_NIGHT_LIGHTS`, `TURN_ON/OFF_PRIME_LIGHTS` | everyday 21:00 / 07:00 / 21:00 / 00:00 | power map light sprites with the NIGHTTIME/PRIMETIME flag (`Environment.cc:412-463`) | M4h (lighting) |
| 56 | `MERC_ABOUT_TO_LEAVE` | one-shot 05:30/11:30/17:30, posted daily | `FindOutIfAnyMercAboutToLeaveIsGonnaRenew` (`Merc_Contract.cc:863`) | M5 |
| 58 | `ENRICO_MAIL` | everyday 07:00 | `HandleEnricoEmail` (`Strategic_Status.cc:246`): progress emails | M5 |
| 59, 60 | `INSURANCE_INVESTIGATION_STARTED`, `_OVER` | one-shot, `Insurance_Contract.cc:903, 944` | investigation | M5 |
| 61 | `MINUTE_UPDATE` | never | empty | — |
| 62 | `TEMPERATURE_UPDATE` | everyday ×8 | `UpdateTemperature(code)` (§1.10) | M4 |
| 63 | `KEITH_GOING_OUT_OF_BUSINESS` | one-shot +6 days, `Interface_Dialogue.cc:3194` | fact | M6 |
| 64 | `MERC_SITE_BACK_ONLINE` | one-shot, `Mercs.cc:586` | | M5 |
| 66 | `CHECK_IF_MINE_CLEARED` | one-shot +15 s, `Queen_Command.cc:887` | `HourlyMinesUpdate` (restart a cleared mine), see `18` | M4 |
| 67 | `REMOVE_ASSASSIN` | one-shot +3..5 h, `Soldier_Profile.cc:410` | assassin leaves, life restored | M6 |
| 68 | `BANDAGE_BLEEDING_MERCS` | one-shot +1 min, `Assignments.cc:322, 6526`, `Auto_Resolve.cc:1649` | `BandageBleedingDyingPatientsBeingTreated` (`Assignments.cc:6461`), see `18`/`19` | M4 |
| 72 | `BEGIN_CONTRACT_RENEWAL_SEQUENCE` | one-shot 07:30/13:30/19:30, posted daily | `BeginContractRenewalSequence` (`Merc_Contract.cc:88`) | M5 |
| 73 | `RPC_WHINE_ABOUT_PAY` | one-shot 07:30 | quote | M5 |
| 74 | `HAVENT_MADE_IMP_CHARACTER_EMAIL` | one-shot Day 2 8–11 h, `Laptop.cc:1447` | email | M5 |
| 76 | `QUARTER_HOUR_UPDATE` | periodic 15 min, `StrategicMap.cc:2257` | `HandleQuarterHourUpdate` (`Hourly_Update.cc:85-92`), §3.3 | M4 |
| 77 | `MERC_MERC_WENT_UP_LEVEL_EMAIL_DELAY` | one-shot, `Campaign.cc:703` | email | M5 |
| 78 | `MERC_SITE_NEW_MERC_AVAILABLE` | one-shot, `Mercs.cc:1591` | | M5 |

**Rule for M4**: every kind exists in the queue with its original id, frequency and reposting, so the queue matches the
original in content and order; kinds whose subsystem is missing get a no-op handler (returns TRUE, so periodic and
everyday ones keep reposting). The single exception is `AMBIENT` (deviation, §9).

### 2.8 Processing order within one time step

Inside one tick (§1.8) the order is: screen work (tactical pass or map handlers, including the strategic turn), then
`UpdateClock`. Inside `UpdateClock`, at most one `AdvanceClock`/`WarpGameTime` (one 1 s step or one 60 s slice, or two
slices worth after a re-phase); inside it, events in `(stamp, seq)` order, each with the clock set to its stamp, reposts
interleaved by stamp; then the rest of the window, `UpdateGameClockGlobals`, the enemy-knowledge reset, and
`ForecastDayEvents`. State changes made by events (a stopped compression, a pause, a PBI, a new light value, enemies added
to the loaded sector) are seen by the screen work of the **next** tick.

### 2.9 Interaction with compression: three ways an event stops time

| Call in a callback | Effect on the current slice | Effect afterwards |
|---|---|---|
| `StopTimeCompression()` | none: later events in the slice still run and the clock reaches the slice end (≤ 60 s overshoot) | resolution 0; `WarpGameTime` then restores the old `secondsPerRealSecond` (stale but harmless while the resolution is 0); `compressionOn` false; the mode is remembered |
| `InterruptTime()` | the loop stops after this event; the clock stays at its stamp | compression continues next pass unless also stopped or paused |
| `PauseGame()` (+ lock) | none by itself | `UpdateClock` returns until unpaused; with a lock, compression cannot be restarted |

Typical combinations: battle at arrival = `InterruptTime` + `PauseGame` + lock (`Strategic_Movement.cc:660-683`); message
box = all four including `PauseTime`; merc arrival, group at final destination, assignment done, head miner quote = only
`StopTimeCompression`. Every `StopTimeCompression` caller in M4 scope: group at final destination
(`Strategic_Movement.cc:1411`), halted group (`:3489, 3601`), PBI opened (`PreBattle_Interface.cc:421, 968, 1003, 1075`;
`Strategic_Movement.cc:907`), merc arrived (`Merc_Hiring.cc:244`), merc died on the map (`Strategic.cc:41`), merc left
(`Merc_Contract.cc:705`), repair done / assignment aborted / old assignment resumed (`Assignments.cc:1974, 2740, 7039,
7130`), head miner quote (`Strategic_Mines.cc:794`), hated-merc complaint (`Strategic_Merc_Handler.cc:588, 657`),
militia training unpaid (`Town_Militia.cc:568, 574`), leaving the map screen (`Map_Screen_Interface_Bottom.cc:1121`),
helicopter events (`Map_Screen_Helicopter.cc:230, 276, 286, 459, 1096, 1442`), Bobby Ray delivery
(`Strategic_Event_Handler.cc:329`).

---

## 3. Hourly, daily and other periodic updates

### 3.1 The standing schedule

Everything periodic is an event; the only non-event periodic work is the strategic turn (§1.7) and `ForecastDayEvents`
(§1.4). A steady-state day (Day ≥ 2) with the base set of events, in execution order (ties by the FIFO rule of §2.2,
which here follows from when each instance was (re)posted: the init-posted everyday events were reposted at their
previous firing, one-shots posted at 00:00 come next, `HOURLY` reposted an hour earlier and `QUARTER` reposted 15 min
earlier come last):

| Time | Events (in order) |
|---|---|
| 00:00 | `TURN_OFF_PRIME_LIGHTS`, `DAILY_UPDATE_OF_MERC_SITE`, `HANDLE_INSURED_MERCS`, `MERC_DAILY_UPDATE`, `SETUP_MINE_INCOME`, `HOURLY_UPDATE`, `QUARTER_HOUR_UPDATE` |
| every :15/:30/:45 | `QUARTER_HOUR_UPDATE` |
| every hh:00 | (time-specific events, below) then `HOURLY_UPDATE`, `QUARTER_HOUR_UPDATE` |
| 04:00 | `DAILY_EARLY_MORNING_EVENTS` |
| 05:30, 11:30, 17:30 | `MERC_ABOUT_TO_LEAVE` (posted by `MercDailyUpdate`) |
| 06:47 … 06:59 | `CHANGELIGHTVAL` 11, 10, 9, 8, 7, 6, 5 (every 2 min) |
| 07:00 | `TURN_OFF_NIGHT_LIGHTS`, `ENRICO_MAIL` |
| 07:01, 07:03 | `CHANGELIGHTVAL` 4, 3 |
| 07:30, 13:30, 19:30 | `BEGIN_CONTRACT_RENEWAL_SEQUENCE` (posted daily); 07:30 also `RPC_WHINE_ABOUT_PAY` |
| 08:00 | `TEMPERATURE_UPDATE` (desert warm), `CHECKFORQUESTS` |
| 09:00 | `TEMPERATURE_UPDATE` (desert hot), `TEMPERATURE_UPDATE` (global warm), `DAILY_UPDATE_BOBBY_RAY_INVENTORY`, `HANDLE_MINE_INCOME` |
| 12:00 | `TEMPERATURE_UPDATE` (global hot), `HANDLE_MINE_INCOME` |
| 14:00 | `TEMPERATURE_UPDATE` (global warm) |
| 15:00, 18:00 | `HANDLE_MINE_INCOME` |
| 17:00 | `TEMPERATURE_UPDATE` (desert warm), `TEMPERATURE_UPDATE` (global cool) |
| 19:00 | `TEMPERATURE_UPDATE` (desert cool) |
| 20:57, 20:59 | `CHANGELIGHTVAL` 4, 5 |
| 21:00 | `TURN_ON_NIGHT_LIGHTS`, `TURN_ON_PRIME_LIGHTS` |
| 21:01 … 21:13 | `CHANGELIGHTVAL` 6 … 12 |
| 22:00 | `CREATURE_NIGHT_PLANNING` (once the creature quest is active) |
| floating | `EVALUATE_QUEEN_SITUATION` (self-reposted), `CHECK_ENEMY_CONTROLLED_SECTOR` (one per garrison, ~100 min on medium), `CREATURE_SPREAD`, group arrivals, one-shots |

So the daily merc update runs before the hourly update at midnight, and mine income runs before the hourly update at
09/12/15/18:00 (mine income one-shots are posted at 00:00, the hourly instance an hour before its stamp). A loaded
savegame keeps whatever order it carries.

### 3.2 `HandleHourlyUpdate` (`Strategic/Hourly_Update.cc:35-73`)

Returns at once while `didGameJustStart` (until the first squad lands, §4.5). Then, in order:

| # | Call | File | Draws | Owner |
|---|---|---|---|---|
| 1 | `UpdateAssignments()` | `Assignments.cc:954-1029` | `PreRandom` via `StatChange` → `ProcessStatChange` (training, doctoring, repair skill gain, `Campaign.cc:261, 336`); `Random(100)` toolkit wear per repairman (`:1991`) | `18` |
| 2 | `UpdateBuddyAndHatedCounters()` | `Strategic_Merc_Handler.cc:526-730` | none; quotes, `StopTimeCompression` | M5 |
| 3 | `HourlyMoraleUpdate()` | `Tactical/Morale.cc:664` | none | M4 |
| 4 | `HourlyCamouflageUpdate()` | `Strategic_Merc_Handler.cc:733-759` | none (camo −2, monster smell −1) | M4 |
| 5 | `HourlyMinesUpdate()` | `Strategic_Mines.cc:162-234` | none | `18` |
| 6 | `HourlyProgressUpdate()` | `Tactical/Campaign.cc:1289-1325` | none; first crossings of 35/50/70 % trigger the Madlab meanwhile, Mike, Iggy (policy `progress.event_*_min`) | M4 (record), M6 (effects) |
| 7 | `HourlyQuestUpdate()` | `Hourly_Update.cc:95-152` | none; brothel/club/museum facts by hour, boxers' rest | M6 |
| 8 | `HourlyLarryUpdate()` | `:170-305` | `Random(temptation)`, `Random(2)` | M6 |
| 9 | `HourlyCheckIfSlayAloneSoHeCanLeave()` | `:308-328` | `Chance(15)` | M6 |
| 10 | `PayOffSkyriderDebtIfAny()` | `Map_Screen_Helicopter.cc:1387-1415` | none | M6 |
| 11 | every 6th hour (`hour % 6 == 0`): `UpdateRegenCounters()` | `:76-82` | none | M5 |

`UpdateAssignments` itself (owned by `18`; order matters for draws): build the sectors-with-soldiers list, record who
slept through the past hour, natural healing, hospital patients, trainers/trainees without partners, clear the
militia-completed list, rest/fatigue/sleep, then for `x` 0..15 (outer), `y` 0..15, `z` 0..3 with soldiers present:
doctors, repairmen, training; then patients done healing, the update box, continued town training, "nothing to do"
re-evaluation. The sector loop is column-major (x outer).

### 3.3 `HandleQuarterHourUpdate` (`Hourly_Update.cc:85-92`)

Returns while `didGameJustStart`; else `DecayTacticalMoraleModifiers()` (`Tactical/Morale.cc:138-…`, no draws). M4.

### 3.4 Daily updates

- **00:00 `MERC_DAILY_UPDATE`** (`Strategic_Merc_Handler.cc:135-370`). Skipped on Day 1. Low death rate (< 5) → team
  morale event; posts `MERC_ABOUT_TO_LEAVE` at slot − 2 h and `BEGIN_CONTRACT_RENEWAL_SEQUENCE` at each slot (7:30,
  13:30, 19:30, `Tactical/Merc_Hiring.h:14-16`). Per merc on the team: POW → contract end +1440 min; otherwise (not in
  transit) reset once-a-day quote flags, corpse tolerance −1, personality flag reset, worse-equipment check → complaint at
  `360 + Random(1080)` min, days served +1, RPC pay, `DailyMoraleUpdate`, `CheckIfMercGetsAnotherContract` (`Chance`);
  man-days +1 for non-dead, non-transit. Then MERC account check; then for every profile 0..NUM_PROFILES−1 not dead:
  precedent quote reset; skip team members; AIM/MERC mercs: `HandleUnhiredMercImprovement` (`Random`) and, if working
  elsewhere, `HandleUnhiredMercDeaths` (`PreRandom(1000)`, `Campaign.cc:1157`); availability countdown, or
  `Random(100) < chance` → busy for `1 + Random(6 + exp/2)` days; morale hangover −1. Then `HandleSlayDailyEvent`.
  M4 needs days served, man-days, daily morale and the death-rate bonus; the rest is M5.
- **00:00 `SETUP_MINE_INCOME`**: four `HANDLE_MINE_INCOME` one-shots at 09:00 + k·3 h (`Strategic_Mines.cc:34-36`).
- **04:00 `DAILY_EARLY_MORNING_EVENTS`** (`Strategic_Event_Handler.cc:693-865`), M6, but it runs during the very first warp
  (§4.5): NPC default-response flags; Walker `bNPCData = Random(4)`; `Random(2)` → Walker swaps C13/D13 unless loaded;
  Tony (`Random(4)`, only once spoken to); Devin moves when `bNPCData > 3` (`pickPlacementSector`, `Random(n)`); Hamous
  moves (`Random(n)`); Rat leaves; money resets (Vince, Steve, Jenny, Darren 15000); Carmen placement (`Random(n)`) or head
  reward; **`PreRandom(3)` → Dave has gas**; hospital supplies check if loaded.
- **Other daily kinds** (09:00 Bobby Ray, 00:00 MERC site and insurance, 07:00 Enrico, 08:00 quests) are M5/M6 (§2.7).

### 3.5 RNG summary of the periodic layer

`main` stream: Queen evaluation (`17`), creature spreading (`17`), meanwhile delay, early-morning NPC moves, merc daily
update (complaints, AIM availability, unhired improvement), hourly toolkit wear, Larry, Slay, Bobby Ray. `pre`
stream: `StatChange` from assignments (hourly), unhired merc deaths (daily), Dave's gas (04:00), creature attack time
(22:00). Nothing in the clock or queue mechanics draws.

---

## 4. New game initialisation

### 4.1 Flow (original)

Main menu → game options screen (`GameInitOptionsScreen.cc:709-730` sets gun nut, sci-fi, difficulty, save mode) →
intro → `INIT_SCREEN` → `InitNewGame()` (`JAScreens.cc:181-185`, state 4) → laptop (paused, hire mercs) → the laptop
exits to the map screen (`LeaveLapTopScreen` overrides the `INIT_SCREEN` exit, `Laptop/Laptop.cc:1345-1349`; the
`screenCount == 1` branch of `InitNewGame` is not reached in this flow, inferred) at Day 1 01:00, compression X0 → the
player starts compression → the 6-hour warp and the helicopter drop (§4.5). Restarting from the main menu runs `ReStartingGame()`
(`Game_Init.cc:291-354`: delete all events, re-init overhead (`didGameJustStart = true`), profiles, laptop, world).

### 4.2 `InitNewGame()` (`Strategic/Game_Init.cc:200-277`), first call (`screenCount == 0`)

1. `uiMeanWhileFlags = 0`; `SetSelectedMan(0)`; reset cheat level.
2. `LoadMercProfiles()` (`Tactical/Soldier_Profile.cc:221-238`): profiles from content; `DecideActiveTerrorists()`
   (`:246-301`); `StartSomeMercsOnAssignment()` (`:485-514`).
3. `InitAllArmsDealers()` (`Tactical/Arms_Dealer_Init.cc:51-70`), `InitBobbyRayInventory()` (`Laptop/BobbyR.cc:422`). M5.
4. Clear the tactical and map-screen message queues; `ResetGameStates()`; `InitScriptingEngine()` (only `enums.lua` ships).
5. `InitLaptopAndLaptopScreens()` (finances, history).
6. **`InitStrategicLayer()`** (§4.3).
7. `SetLaptopNewGameFlag()`; `ResetHeliSeats()`; four pre-read emails (Enrico ×3, RIS) and the IMP intro (if another IMP
   can be created) stamped `GetWorldTotalMin()` = 1500.
8. Starting cash: `AddTransactionToPlayersBook(ANONYMOUS_DEPOSIT, 0, 1500, starting_cash_<difficulty>)` — policy 45000 /
   35000 / 30000 (`game.json:58-60`).
9. M.E.R.C. online day: `d = Random(max − min + 1) + min` with policy `merc_online_min_days 1`, `_max_days 2`
   (`game.json:229-230`); `d == 0` → Speck's email now, else `AddFutureDayStrategicEvent(DAY3_ADD_EMAIL_FROM_SPECK, 420, 0,
   d)` = Day 1+d, 07:00.
10. Laptop exit screen `INIT_SCREEN` (later overridden by the map screen); pending screen `LAPTOP`; `screenCount = 1`;
    `gameStarted = true`.

### 4.3 `InitStrategicLayer()` (`Game_Init.cc:140-188`)

1. `SetupNewStrategicGame()` (`Strategic/StrategicMap.cc:2225-2266`):
   1. every `StrategicMap[]` element `fEnemyControlled = TRUE` (the map table itself is built at program start by
      `InitStrategicEngine`, `:261`; see `16`);
   2. `InitNewGameClock()` (`Game_Clock.cc:98-106`): clock = previous = 90000, globals, `guiTimeCurrentSectorWasLastLoaded
      = 0`, speed 0, resolution 1;
   3. `DeleteAllStrategicEvents()`;
   4. `BuildDayLightLevels()` (30 everyday events, §1.10);
   5. everyday: `CHECKFORQUESTS` 08:00, `DAILY_EARLY_MORNING_EVENTS` 04:00, `DAILY_UPDATE_BOBBY_RAY_INVENTORY` 09:00,
      `DAILY_UPDATE_OF_MERC_SITE` 00:00, `HANDLE_INSURED_MERCS` 00:00, `MERC_DAILY_UPDATE` 00:00, `SETUP_MINE_INCOME`
      00:00, `ENRICO_MAIL` 07:00 (times `StrategicMap.cc:122-126`); all stamped on Day 1, so the 00:00 ones are in the past;
   6. periodic: `HOURLY_UPDATE` every 60 min (first stamp 90000 = now), `QUARTER_HOUR_UPDATE` every 15 min (first 87300,
      past);
   7. no battle locator; `StrategicTurnsNewGame()` (sync); `g_merc_arrive_sector = start_sector`.
2. `InitQuestEngine()` (quests and facts reset).
3. `InitNewCampaign()` (`Strategic/Campaign_Init.cc:98-122`):
   1. `SectorInfo[0..255]` zeroed;
   2. `InitStrategicMovementCosts()` (`Strategic_Movement_Costs.cc:9-31`): travel rating and five traversabilities per
      sector from `strategic-map-movement-costs.json`;
   3. `RemoveAllGroups()`;
   4. `InitKnowFacilitiesFlags()` (`:33-66`): hospital G8 F8 G9 F9; airport B13 C13 D13 and N3 N4 N5 O3 O4;
   5. `BuildUndergroundSectorInfoList()` (`:85-93`): one node per entry of `strategic-map-underground-sectors.json`, in
      file order, troops/elites/creatures = base + `Random(variance)` each (three calls; zero variance draws nothing);
   6. start sector `SF_ALREADY_VISITED` if `campaign.start_sector_revealed` (`game.json:269`: true; the code default when
      absent is false, `externalized/policy/DefaultGamePolicy.cc:105`);
   7. **`InitStrategicAI()`** (`Strategic_AI.cc:316-561`, details in `17`): pools and alertness from policy; the first
      `EVALUATE_QUEEN_SITUATION` at absolute minute `475 + time_evaluate_in_minutes + Random(time_evaluate_variance)`
      (`:338-342`; medium 835..1014 = Day 0, 13:55–16:54, **before** the start time); garrisons in table order: roadblock
      `Chance(20)`, size `·(100 + Random(51) − 25)/100` unless it is `MAX_STRATEGIC_TEAM_SIZE` (20,
      `StrategicMap.h:11`) or the sector is P3, per soldier `Random(100)` when the composition has no admin percentage,
      then a `CHECK_ENEMY_CONTROLLED_SECTOR` periodic event every `140 − 20·difficulty + Random(4)`
      min from Day 1 `7:55 + i` min (`:515`); patrols: `Random(3)` size, group creation, `RandomizePatrolGroupLocation`
      (`Random(waypoints)`); weapon cache sector `Random(5)` (`strategic-map-cache-sectors.json`) with
      `numTroops + Random(variance 0)`;
   8. `InitStrategicStatus()` (zeroed, army gun "already dropped" flags).
4. `InitSquads()`, `InitVehicles()`, `InitTownLoyalty()` (`18`).
5. `InitializeMines()` (`Strategic_Mines.cc:61-159`, `18`): base rates; 25 (easy, medium) or 20 (hard) increments, each
   `Random(#mines)` repeated until a producing mine; the depleting mine `Random(#mines)` repeated until producing and not
   `noDepletion`; its ore = 10 or 20 (`delayDepletion`) days of full production.
6. `InitMapScreenFlags()`.
7. `InitNPCs()` (`Game_Init.cc:73-116`): for every NPC placement in profile-id order (`std::map`), skipping sci-fi-only
   ones without sci-fi: `pickPlacementSector()` = `Random(#sectors)` (`externalized/strategic/NpcPlacementModel.cc:32-40`);
   alternate map flag; place if `placedAtStart`. Then Tixa B1 alternate map without sci-fi; hospital values 0; Devin
   `bNPCData = 3`. (Placements are M6, but the draws and alternate-map flags happen here.)
8. `InitializeHelicopter()`, `ClearOutVehicleList()`.
9. `InitBloodCatSectors()` (`:118-137`): `bBloodCats = −1` for sectors 0..**254**; placements and spawns by difficulty
   from JSON (no draws).
10. `InitializeSAMSites()`, `InitMapSecrets()`, leave lists.
11. `SetGameTimeCompressionLevel(X0)`: the screen is `INIT_SCREEN`, so no remapping: mode X0, resolution 0, speed 0.
12. `ChangeSelectedMapSector(start_sector)`; clear the battle-disable flags.

### 4.4 Strategic state after initialisation

| State | Value after new game |
|---|---|
| Clock | 90000 s, Day 1 01:00, X0, not compressing; `paused` is still TRUE (its program-start value, `Game_Clock.cc:66`; `ReStartingGame` also sets it) until the laptop exit unpauses (`Laptop/Laptop.cc:628`) |
| Light, temperatures | `envLightValue` 0 (fresh process), temperatures 0 |
| `StrategicMap[]` | all enemy-controlled |
| `SectorInfo[]` | zero except traversability and travel rating, facilities, start sector visited, garrison id (255 = none, else garrison index) and enemy counts, `SF_ENEMY_AMBUSH_LOCATION` on roadblocks, `SF_USE_ALTERNATE_MAP` (cache sector, NPC placements), bloodcat fields |
| Underground | list in JSON order with randomised enemies |
| Groups | patrol groups (`17`), no player groups |
| Event queue | 38 everyday + 2 periodic + 1 Queen evaluation + 1 periodic per garrison + Speck's email (if d > 0) |
| Campaign | balance = starting cash; `didGameJustStart` true; `atLeastOneMercHired` false (no compression possible) |

### 4.5 Start date, the first squad and the first advance

Hiring at game start (`Tactical/Merc_Hiring.cc:101-160`): insertion code CHOPPER, item LETTER for soldier id 0, arrival
minute `(STARTING_TIME + FIRST_ARRIVAL_DELAY) / 60` = 1860 (Day 1 07:00) as a `DELAYED_HIRING_OF_MERC` event posted at
hire time (so after all init-posted events with the same stamp). The clock does not move in the laptop (paused) nor on
the map at X0.

The first compression the player starts (any mode above X1) reaches `SetClockResolutionToCompressMode`, which calls
`HandleTimeCompressWithTeamJackedInAndGearedToGo()` (`Map_Screen_Interface.cc:3621-3669`): only if mercs are hired and
`didGameJustStart`: select and load the start sector (`SetCurrentWorldSector`, at 01:00, with the strategic enemies then
present; enemies in it set the PBI variables for the first battle), then `InitHelicopterEntranceByMercs()`
(`GameScreen.cc:686-698`): **`WarpGameTime(21600, PROCESS_EVENTS_NORMALLY)`**, then `didGameJustStart = false` and the
heli run is armed; fade into tactical; Enrico's congratulation email. On the game screen the heli run sets X1
(`GameScreen.cc:349-361`).

The warp processes, in `(stamp, seq)` order: the Queen's first evaluation (Day 0, past: draws `Random(offset·4)` and
`Random(variance)`, reposts from 01:00, does nothing else while asleep); the 00:00 dailies (Day 1: `MercDailyUpdate`
returns on Day 1); `QUARTER_HOUR_UPDATE` 00:15 … with catch-up reposts; `HOURLY_UPDATE` 01:00 …; 04:00 early-morning
events (draws, including `PreRandom(3)`); the dawn light ramp; at 07:00 `TURN_OFF_NIGHT_LIGHTS`, `ENRICO_MAIL`, the
mercs' arrivals (`MercArrivesCallback` with `didGameJustStart` still true, `StopTimeCompression`), then `HOURLY_UPDATE`
and `QUARTER_HOUR_UPDATE`. **All hourly and quarter-hour updates during the warp return early** (`didGameJustStart`), but
the 04:00 event, the light and temperature events and the Queen evaluation run. The `CHECK_ENEMY_CONTROLLED_SECTOR`
events (from 07:55) are after the window.

### 4.6 RNG draw order of a new game

All draws during initialisation are on the `main` stream; none is a `PreRandom`. Order:

1. `DecideActiveTerrorists`: 2 × `Chance(70|50|30)`; then sweeps over the terrorist list: per unplaced candidate
   `Random(100)` (< 40 places), then `Random(#sectors)` repeated until an unused sector.
2. `StartSomeMercsOnAssignment`: per AIM/MERC profile in content order `Random(100)`, and `Random(6 + exp/2)` when busy.
3. Arms dealers, then Bobby Ray new and used inventories (M5; their draw counts depend on item tables).
4. `BuildUndergroundSectorInfoList`: per entry up to three `Random(variance)`.
5. `InitStrategicAI`: evaluation variance; per garrison (roadblock `Chance(20)`; `Random(51)`; per-soldier `Random(100)`;
   `Random(4)` for the check period); per patrol (`Random(3)`, then the location draw); cache `Random(5)`.
6. `InitializeMines`: rejection-sampled increments and the depleting mine.
7. `InitNPCs`: one `Random(#sectors)` per eligible placement.
8. `Random(merc_online_max − min + 1)`.

No initialisation expression evaluates two draws as unsequenced function arguments (checked on this path), so the order
is fully defined. Then, at the first warp, the periodic draws of §4.5. ja2-node does not reproduce `mt19937` streams
(`01` §3.6), so this order matters for ja2-node's own determinism ("same seed, same campaign") and for oracle checks with
a replayed draw log (§8.4). Adding M5 subsystems (dealers, Bobby Ray) later shifts every draw after them: pin values in
tests with a scripted RNG, not with a seed.

### 4.7 Policy values used by time and initialisation

`game.json`: `starting_cash_easy/medium/hard` 45000/35000/30000 (`:58-60`), `merc_online_min_days` 1 / `_max_days` 2
(`:229-230`), `campaign.start_sector` "A9" (`:265`), `campaign.start_sector_revealed` true (`:269`),
`game_durations_multiplier` 1.0 (`:50`; scales every `TIMECOUNTER` interval, including the 20 ms `STRATEGIC_OVERHEAD`,
`Timer_Control.cc:159-163`), `progress.event_madlab_min/mike/iggy` 35/50/70 (`:247-249`).
`strategic-ai-policy.json`: `time_evaluate_in_minutes_*` 480/360/180 and `time_evaluate_variance_*` 240/180/120
(`:56-66`), used for the first evaluation here and by `17` afterwards.

---

## 5. State owned by the time layer and savegames

Mapping to the save sections of `14` §4 (decoded = the reader already exposes it):

| Section | Field | ja2-node state | Notes |
|---|---|---|---|
| 1 Tactical status | `fDidGameJustStart`, `fHasAGameBeenStarted` | `campaign.didGameJustStart`, `.gameStarted` | not yet decoded |
| 1 | `uiFlags & INCOMBAT`, `fEnemyInSector` | tactical | decoded / derived |
| 1 | `uiTimeSinceLastInTactical` (min) | `campaign.lastInTacticalMinute` | `GameScreen.cc:260`, `StrategicMap.cc:499` |
| 2 Game clock | `giTimeCompressMode` | `clock.compressionMode` | decoded (`GameClock`) |
| 2 | `gubClockResolution`, `guiGameSecondsPerRealSecond` | `clock.resolution`, `.secondsPerRealSecond` | keep as saved (may be stale, §2.9) |
| 2 | `gfGamePaused` | `clock.paused` | the value **before** the save paused the game (`SaveLoadGame.cc:273-274`) |
| 2 | `gfTimeInterrupt` | `clock.timeInterrupt` | |
| 2 | `fSuperCompression` | — | dead |
| 2 | `guiGameClock`, `guiPreviousGameClock` | `clock.worldSeconds`, `.previousWorldSeconds` | |
| 2 | `ubAmbientLightLevel` | tactical base light | already imported (`14` §10) |
| 2 | `guiEnvTime`, `guiEnvDay` | — | ambient bookkeeping (deviation, §9) |
| 2 | `gubEnvLightValue` | `environment.lightValue` | |
| 2 | `guiTimeOfLastEventQuery` | `clock.lastEventQuerySeconds` | read by schedules (`Scheduling.cc:217`, M6) |
| 2 | `gfLockPauseState`, `guiLockPauseStateLastReasonId` | `clock.pauseLocked`, `.pauseLockReason` | saved value is the pre-save lock |
| 2 | `gfPauseDueToPlayerGamePause` | driver | import: start with the manual driver (deviation "Real-time pause") |
| 2 | `gfResetAllPlayerKnowsEnemiesFlags`, `gfTimeCompressionOn` | `strategic.resetPlayerKnowsEnemies`, `clock.compressionOn` | |
| 3 Strategic events | all | `strategic.events` with `seq` = file index | decoded; drop `EVENT_AMBIENT` (§9) |
| 11 Strategic info | `SectorInfo.uiTimeCurrentSectorWasLastLoaded`, `uiTimeLastPlayerLiberated` | `16`, `17` | |
| 22 PreRandom | ring and index | `rng.pre` | decoded |
| 24 General info | `guiBaseJA2Clock` | `clock.realMs` | decoded (`baseJA2Clock`) |
| 24 | `gubScreenCount`, `gfAtLeastOneMercWasHired` | `campaign.screenCount`, `.atLeastOneMercHired` | the hire flag is decoded, the screen count not yet |
| 24 | `gubDesertTemperature`, `gubGlobalTemperature` | `environment.*Temperature` | not yet decoded (`SaveLoadGame.cc:1922-1923`) |
| 24 | `guiEnvWeather` | — | rain is disabled in the original |
| 24 | `uiMeanWhileFlags`, `gfPersistantPBI`, `gubEnemyEncounterCode`, `gubPBSector`, `g_merc_arrive_sector` | M6, `19`, `16` | |
| Header | day, hour, minute | derived | |

Not saved, rebuilt as defaults on load: the `UpdateClock` statics (a fresh process has `lastSecondMs = 0`, so the first
tactical pass after a load advances one second at once, inferred), `lastTacticalTurnMs`, the counter deadline,
`executingStamp`, `doLighting` (`LoadGameClock` sets it for surface sectors, `Game_Clock.cc:745-746`).

ja2-node's own save stores the whole `GameState` (D7), including `seq` and the statics, so a reload continues
bit-identically; native import maps the table above.

---

## 6. Agent API (D14, D15, D16)

**Commands** (refusals carry the `TellPlayerWhyHeCantCompressTime` reason; on the strategic flow):

| Command | Original | Effect |
|---|---|---|
| `setTimeCompression {mode: '5min' \| '30min' \| '60min'}` | `SetGameTimeCompressionLevel` / "+"/"−" | sets the mode (starts compressing, like the "+" button from stopped) |
| `startTimeCompression` | `RequestToggleTimeCompression` (stopped) | resumes the remembered mode (X0/X1 → 5MINS); may open the PBI when enemies are in the loaded sector (§1.6) |
| `stopTimeCompression` | toggle (running) | `StopTimeCompression` between ticks, like a player click between frames |

The player's pause is not a command: the manual driver is the pause (existing deviation "Real-time pause").

**`advance` on the strategic map**: `advance {until: {compressionStopped?: true (default), worldTime?: {day, hour,
minute} | seconds, events?: [...], worldSeconds?: n}, mode?}`. If time is not being compressed it first runs
`startTimeCompression` (with `mode` if given), then steps ticks until:

1. a decision prompt opens (PBI, message box, simultaneous arrival, update box, contract renewal, meanwhile) → `decision`;
2. compression stopped (any `StopTimeCompression`, §2.9) → `event` with `compressionStopped {reason}`; a temporary
   automatic pause (quote, update box) does **not** stop `advance`: the instant driver plays it out in virtual time;
3. `worldTime` reached: at the first tick boundary where `worldSeconds ≥ target`, `advance` issues `stopTimeCompression`
   itself (equivalent to a player click on that frame; the clock lands on a slice end, ≤ 59 s past the target);
4. a watched event (`groupArrived` at an intermediate sector, `mercArrived`, `mineIncome`, `dayStarted`, …);
5. the budget (in world seconds).

In tactical real time the existing `advance` keeps working; `worldTime` is also accepted there (1 world s = 200 ticks).

**Events** to add (`04` §4.4 list): `compressionStarted {mode}`, `compressionStopped {reason}` with reasons
`arrived | halted | battle | mercArrived | mercDied | mercLeft | assignmentDone | mineEvent | complaint | requested |
mapExit | helicopter | shipment`, `worldTimeReached`, `dayStarted {day}`. Every stop report carries the world time.

**Status and view** (D16): `status` shows `Day d, HH:MM`, compression `{mode, on}`, `paused` and the lock reason
(player-visible: the clock, the compression buttons, the reason message). The view must **not** expose the event queue:
Queen evaluations, enemy group arrivals, creature attacks, NPC-system timers and meanwhiles are hidden. Player-visible
derived times only: own groups' ETAs, mercs' arrival times (`uiTimeSoldierWillArrive`), contract ends, the four fixed
mine-income times.

**Prompts** owned elsewhere (`16`, `18`, `19`) all stop `advance` with `decision`; while open nothing steps, as with
`PauseTime` under a message box.

**Status (2026-10-16).** Implemented in `sim/advance.ts` against `Steppable.worldClock` (`CampaignSim.worldClock`,
forwarded by the server sessions); `protocol/messages.ts` reuses `StopCondition`, so the WebSocket `advance` message
takes the new fields as they are (the MCP tool schema still has to list them):
- `StopCondition` gains `worldTime` (absolute seconds or `{day, hour?, minute?}`), `worldSeconds` (relative),
  `compressionStopped` and `mode`. `mode` sits inside `until`, not beside it. Any of the four makes the advance strategic:
  budget 2,000,000 ticks and 7 world days; on the map with time not compressed it first starts compression (refusal →
  reason `refused` with `refusal: <text>`). `compressionStopped: false` restarts compression after every stop instead of
  returning (until a decision, the target, a watched event, a refusal or the budget).
- Stop reasons: `decision` (checked again right after each step, before watched events), `event`, `worldTime`
  (`advance` stops compression with reason `worldTime`, then appends `worldTimeReached {seconds}`), `idle` (on the map
  and no longer compressing), `budget`, `refused`; in tactical `worldTime`/`worldSeconds` run real time. Every report
  carries `worldTime {day, hour, minute, seconds}` when a campaign is attached.
- Events: `compressionStarted {mode}`, `compressionStopped {reason}` with the reasons listed above plus
  `militiaTraining`, `worldTime` and `paused` (the map's automatic pause when compression stops being allowed),
  `dayStarted {day}`.

---

## 7. Data tables and stubs

**Transcribe** (`tools/transcribe/strategic-time.ts` → `data/tables/strategic-time.json`, with `c-source.ts`):

| Content | Source | Helper |
|---|---|---|
| `StrategicEventKind` ids and names, `NPC_SYSTEM_EVENT_ACTION_PARAM_BONUS` | `Strategic/Game_Event_Hook.h:6-74` | `sequentialEnum` (explicit values are supported) |
| `StrategicEventFrequency`, `SEF_DELETION_PENDING` | `Strategic/Game_Events.h:7, 21-29` | `sequentialEnum` |
| Compression enum, `LockPauseReason`, warp codes | `Strategic/Game_Clock.h:27-47, 83-93, 110-115` | `sequentialEnum` |
| `giTimeCompressSpeeds` | `Strategic/Game_Clock.cc:79` | `arrayItems` + `evaluateIntExpression`, which must learn `*` (it handles `+ − ( )` only) |

The ids matter for savegame import and for the dispatch table. Scalar `#define`s stay as named constants in code under
the SFI-SCLA header (`src/sim/strategic/time/constants.ts`): `STARTING_TIME`, `FIRST_ARRIVAL_DELAY`, the daily times
(`StrategicMap.cc:122-126`), light and temperature times and levels (`Environment.cc:26-34, 100-110`, `Environment.h:8-22`),
mine production times (`Strategic_Mines.cc:34-36`), merc arrival slots (`Merc_Hiring.h:14-16`), `ABOUT_TO_ARRIVE_DELAY 5`,
`STRATEGIC_OVERHEAD 20` ms, `NUM_REAL_SEC_PER_TACTICAL_TURN 5000`, `RT_COMPRESSION_TACTICAL_TURN_MODIFIER 10`, the hospital
and airport facility sectors (`Campaign_Init.cc:33-66`).

**Already distributable** (`data/externalized/`, SFI-SCLA, in CI): `game.json`, `strategic-ai-policy.json`,
`strategic-map-*.json` (movement costs, traversability, underground sectors, NPC placements, cache sectors, towns, SAM
sites, secrets, creature lairs), `strategic-mines.json`, `army-*.json`, `strategic-bloodcat-*.json`. The time layer and
the whole strategic initialisation run on these alone; nothing in this spec reads original game files.

**Stubs needed** to run the strategic layer without original data:

- The starting squad's merc profiles (the stub pack has 3–5; `prof.dat` is original data).
- Missing NPC profiles: handlers that touch NPC profiles (04:00 events, Larry, Slay, Skyrider, Carmen, …) are M6; until then
  they are no-ops, and later they must skip absent profiles on stubs.
- Sector maps for tactical entry: a sector → stub map mapping (owned by `16`); autoresolve and the map itself need none.
- No ambient `.bad` files (ambient is not simulated), no strings beyond `data/externalized/strings/`.

---

## 8. Minimal M4 implementation (time and events)

Goal: a campaign session that starts a new game exactly as `InitStrategicLayer` does, lands the first squad at Day 1
07:00 after the 6-hour warp, runs the world clock in tactical (1 s per 200 ticks) and on the map (60 s slices), fires the
strategic events in the original order with their reposting, freezes time in turn-based combat, and lets an agent
compress time until something happens.

### 8.1 Modules (`src/sim/strategic/time/`, all with the SFI-SCLA header)

| Module | Contents |
|---|---|
| `constants.ts` | §7 scalars; transcribed enums loaded from `data/tables/strategic-time.json` |
| `world-clock.ts` | `WorldClock` state (§0), helpers (§1.1), `setClockResolutionToCompressMode`, `startTimeCompression`, `stopTimeCompression`, `setGameTimeCompressionLevel`, increase/decrease, `pauseGame`/`unPauseGame`/locks, `interruptTime`, `updateClock`, `advanceClock`, `warpGameTime` |
| `event-queue.ts` | `StrategicEvent {stamp, kind, frequency, param, offset, seq}`, the `(stamp, seq)` queue, all `add*` variants with the posting guard, deletes, `processPendingGameEvents` with the three warp codes |
| `dispatch.ts` | `executeStrategicEvent` + a handler registry `Map<kind, (state, event) => void>`; subsystems register their handlers (breaks the original's include cycles, `01` §3.7); unregistered kinds are no-ops returning TRUE; `delayEventIfBattleInProgress` |
| `environment.ts` | light/temperature handlers, `timeOfDayAmbientLightLevel`, `sectorTemperature`, the pending-light application for tactical |
| `periodic.ts` | `handleHourlyUpdate`, `handleQuarterHourUpdate`, `mercDailyUpdate` (M4 parts), registering into `dispatch` and calling `18`/`17` modules |
| `strategic-turn.ts` | `handleStrategicTurn` with the 20 ms counter, `syncStrategicTurnTimes`, the map-side `handleTacticalEndTurn` call |
| `new-game.ts` | `initNewGame`/`initStrategicLayer` orchestration (§4.2–4.3) calling the init functions of `16`, `17`, `18`; the start-squad hire and `handleTimeCompressWithTeamJackedInAndGearedToGo` |
| `src/sim/campaign-sim.ts` | the session's top-level sim: `realMs`, flow, the loaded `TacticalSim`, the per-tick order of §1.8, `isIdle`/`hasPendingDecision`, commands of §6 |

### 8.2 Order of work

1. Transcription script and table; constants.
2. `world-clock.ts` + `event-queue.ts` + `dispatch.ts` with unit tests (§8.3 items 1–9); no subsystem yet.
3. `CampaignSim` skeleton with the tick order, flows `strategic`/`tactical`, drivers and `advance` stop conditions, the
   `status` fields; X0/X1/compression commands.
4. Tactical integration: the world clock replaces `explosives.worldMs` (remove the deviation row "World clock for smoke and
   light"); `handleRealtimeTurns` gated by the 20 ms counter and by `paused` (5020 ms period); world clock frozen in
   combat; ambient light from `environment.ts` instead of the sandbox constant; the sandbox keeps a clock at a fixed day,
   running at X1 with an empty queue.
5. `environment.ts` and the light/temperature events; `strategic-turn.ts` on the map.
6. `new-game.ts` with the init functions available from `16`/`17`/`18` (stubs for M5/M6 pieces); the start-squad
   shortcut (`newGame {difficulty, gunNut, sciFi, saveMode, seed, squad: [profileIds], contractDays}`) mirroring the
   game-start `HireMerc` path, then the first-compression warp.
7. `periodic.ts` wiring as `17`/`18` land; `MercDailyUpdate` M4 parts.
8. Own save format (clock, queue with `seq`, statics); native import of the §5 fields (decode temperatures, start flags).
9. Oracle probes and `compare.ts` handlers (§8.4).

### 8.3 Tests

1. Helpers: `worldTimeOf` for 0, 86399, 90000; `GetMidnightOfFutureDayInMinutes`; `DayTime` boundaries 06:59/07:00/21:00.
2. `updateClock` cadence on 5 ms ticks: X1 → +1 s every 200 ticks; 5MINS → +60 at ticks 40, 80, …; 30MINS → slices at
   elapsed 35, 70, 100, 135, 170, 200 ms; 60MINS → 20, 35, 50, 70, 85, 100 ms; exactly 300/1800/3600 world s per 200 ticks;
   resolution change mid-second (5MINS → 60MINS) rescales `timesThisSecond`/`lastProcessed`; a pause re-phases;
   combat freezes and the first pass after combat adds 1 s.
3. Queue order: equal stamps FIFO; a repost lands after existing equal-stamp events; save/load preserves order.
4. Frequencies: periodic repost at `stamp + offset` (catch-up after a `NO_PROCESSING` warp fires every missed period);
   everyday `+86400`; ranged → ENDRANGED with offset 0 → deleted.
5. Posting guard: a callback posting at `≤ executingStamp` is rejected (returns false, no node); outside processing a past
   stamp is accepted and runs at the next advance without moving the clock back.
6. `interruptTime` stops after the current event, keeps the clock at its stamp, leaves same-stamp successors queued;
   `stopTimeCompression` inside an event finishes the slice.
7. `TARGET_TIME_FIRST`: only the last event at the target second runs; earlier ones run at the next advance.
8. Deletion during a callback; deleting the executing kind does not stop its periodic repost.
9. `AddPeriodStrategicEvent` anchored at midnight (posted at 15:00 with 450 min fires twice in the next window).
10. New game: the event list after `initStrategicLayer` (kinds, frequencies, stamps of the non-random events, order); the
    Queen evaluation stamp in `[835, 1014]·60` on medium; two sessions with the same seed are identical; a scripted RNG
    sees exactly the draw ranges of §4.6.
11. First warp: hourly/quarter updates suppressed, the 04:00 event and Queen evaluation run, the squad arrives at 07:00
    after `TURN_OFF_NIGHT_LIGHTS` and `ENRICO_MAIL`, light 5 at 07:00 and 3 at 07:03, `didGameJustStart` false after.
12. Daily tie order at 00:00 and 09:00 as in §3.1 (dailies before hourly; mine income before hourly).
13. Strategic turn: tactical period 5020 ms; on the map 10/1⅔/⅚ turns per world minute at 5/30/60MINS over a 30-minute run;
    none while paused.
14. `advance` on the map: stops on `compressionStopped` (group at final destination), on a PBI prompt, at a `worldTime`
    target (lands on the next slice end), does not stop on a quote auto-pause; identical results under instant and manual
    drivers.
15. Native import: `worldSeconds` equals the oracle `save` probe value for the six saves; the event lists round-trip.

### 8.4 Oracle probes (`tools/oracle/`)

New commands in `src/Oracle.cc` (and hooks in `patches/` where noted):

| Probe | Does | Hook |
|---|---|---|
| `clock` | dumps every §0 clock field, day/hour/minute, environment light and temperatures | none (globals; `gubClockResolution` and `guiGameSecondsPerRealSecond` are `static`: add getters to `Game_Clock.cc`) |
| `events` | dumps `gpEventList` in order: stamp, kind, frequency, param, offset, flags | none |
| `newgame difficulty= gunnut= scifi= seed=` | seeds `gRandomEngine`, refills the `PreRandom` table, sets `gGameOptions`, runs `InitNewGame()`, then `clock`, `events` and a strategic summary (garrisons, underground list, mines, NPC sectors, terrorists, balance) | none expected (inferred: `InitNewGame` is headless-safe after `InitializeJA2`) |
| `warp seconds= code=normal\|noevents\|target` | `WarpGameTime` and a log of executed events `{stamp, kind, frequency, param, clockAtExecution}` | listener on `OnStrategicEvent` (`Game_Event_Hook.cc:43, 75`), which leaves `handled` false |
| `ticks ms=5 count= screen=map\|game mode=` | sets `guiCurrentScreen`, the compression mode, then repeats `guiBaseJA2Clock += ms; UpdateClock()` and logs every clock change and executed event | an exported wrapper around the static `SetClockResolutionToCompressMode` |
| `rnglog on\|off` | every `Random`/`PreRandom` call emits `{fn, range, value}` in the output of the following probes | hook in `sgp/Random.cc` |

`compare.ts` replays: `newgame` in ja2-node with a scripted RNG fed from the native draw log (fails on any range or order
mismatch, then compares the state dumps); `warp` and `ticks` against ja2-node's executed-event log and clock trace;
`save` + `events`/`clock` against the native import. This verifies draw order and handler logic despite different RNG
engines.

---

## 9. Quirks and deviations

**Quirks to keep:**

- The first `EVALUATE_QUEEN_SITUATION` is stamped on Day 0 (base minute 475, also in vanilla,
  `V:Strategic/StrategicAI.c:1736-1760`), so it fires at the first clock advance and reposts from 01:00.
- Events in the past run in order without moving the clock; reposts use the event's own stamp (catch-up).
- `AddPeriodStrategicEvent` anchors at today's midnight, not at now (catch-up firings); its header comment is wrong.
- The posting guard silently rejects stamps `≤` the executing event's stamp.
- FIFO among equal stamps; daily updates before the hourly update at midnight, mine income before it at 09/12/15/18.
- Compression moves the clock in 60 s slices; `StopTimeCompression` finishes the slice, `InterruptTime` stops at the event.
- `UpdateClock` drift: `lastSecondMs` reset to the pass time; at most one real second per pass; +1 s after combat.
- The 5020 ms real-time turn (20 ms counter) and the compression-dependent strategic-turn rate on the map.
- Natural healing reads `IsTimeBeingCompressed()` at the hourly event.
- Hourly and quarter-hour updates are suppressed until the first squad lands; the 04:00 event, Queen evaluation and light
  events are not; `MercDailyUpdate` skips Day 1.
- `envLightValue` starts at 0 in a fresh process; 5 at the 07:00 landing.
- `TARGET_TIME_FIRST` runs the traversal arrival before earlier-due events.
- `NO_PROCESSING` warps (autoresolve, retreat, auto-bandage, brothel) leave events to fire later with the clock already past.
- A single pause lock: any unlock clears it whatever the reason.
- `WarpGameTime` restores `secondsPerRealSecond` after an in-event `StopTimeCompression` (stale, harmless).
- The END copy of a ranged event has offset 0; deleting the executing kind does not stop its periodic repost.
- A light change does not trigger sight checks (`AllTeamsLookForAll` commented out).
- `HandleTacticalEndTurn` rots corpses on every turn: `uiTimeSinceLastStrategicUpdate − now > 1200` is a wrapped u32
  comparison that is true whenever `now` differs from the last value (`Tactical_Turns.cc:86-90`).
- `InitBloodCatSectors` leaves `SectorInfo[255].bBloodCats = 0` (loop to 254).
- `UpdateAssignments` walks sectors x-outer, y-inner.
- `MercArrivesCallback`'s equipment complaint uses `540 + Random(660)` (comment says 9–10 am).

**Deviations to log in `docs/deviations.md`:**

| Area | Original | ja2-node | Why |
|---|---|---|---|
| Strategic map pacing | Slices and strategic turns follow the wall clock and the frame rate (144 Hz loop, 20 ms counter) | A virtual 5 ms tick drives `UpdateClock` and the 20 ms counter exactly ("ideal machine"); turns per world minute are 10, 1⅔, ⅚ at 5/30/60 min compression | Determinism (`04` §3) |
| Ambient sounds | `EVENT_AMBIENT` ranged events in the strategic queue, rebuilt on sector load and each new day, parameter overwritten by a sound handle | Not queued; the client derives ambience from the clock and the sector; native imports drop these events | Cosmetic and non-deterministic |
| Fades | The clock does not run during screen fades | Fades are presentation; transitions take no time | No presentation in the sim |
| Prompt time | Some locks pause only the world clock while tactical animation runs underneath (conversation, item pickup, heli entry) | Every decision prompt stops the whole simulation | D15 (already in `01` §3.3) |
| Script hooks | `OnStrategicEvent`, `OnCheckQuests` Lua observers | Not ported | No mods (`02` "Policy objects") |
| Dead code | `TIME_SUPER_COMPRESS`, `SetGameHours/MinutesPerSecond`, rain events, `MINUTE_UPDATE`, `BEGIN_AIR_RAID` | Not ported (kinds kept as no-ops for import) | Same behaviour |
| Real-time turn period | 5020 ms (the turn check runs on the 20 ms counter) | Implemented: `handleRealtimeTurns` runs on the same 20 ms counter | Fixed |
| World clock for smoke and light | (existing row) | Remove when the world clock lands | |

---

## 10. Verified vs inferred

**Verified** by reading Stracciatella (vanilla where marked): every function quoted with a line range — the clock fields,
helpers, compression functions and table, `UpdateClock` with its slice arithmetic, `AdvanceClock`, `WarpGameTime` and
all its callers, pause and lock functions with every lock site, `AllowedToTimeCompress`, the automatic pause,
`HandleStrategicTurn` and its constants, `HandleTacticalEndTurn`, the event record, insertion order, posting variants
and guard, deletion, `ProcessPendingGameEvents` and the repost rules, `ExecuteStrategicEvent` and the whole dispatch
table with every poster, the hourly/quarter/daily handlers and their draws, the environment schedule, `InitNewGame`,
`InitStrategicLayer`, `SetupNewStrategicGame`, `InitNewCampaign`, the draw sites of the initialisation path, the
first-arrival warp, the save layout of the clock and events, the general-info clock and temperature fields, the 144 Hz
loop and the 20 ms counter.

**Inferred**: the exact slice tick positions on a 5 ms loop (computed from the integer formulas, not run); the
strategic-turn rates per world minute (derived from the counter and `check`); the steady-state tie order of §3.1 (derived
from the FIFO rule and posting times); that immediate deletion is equivalent to the deferred flag; the catch-up example
for `AddPeriodStrategicEvent`; that `InitNewGame` runs headless in the oracle; that a fresh process loading a save
advances one world second on the first tactical pass; the original's frame-rate-dependent strategic-turn rate (~20.8 ms).

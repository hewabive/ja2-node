# 15 — Strategic time: the game clock, the event queue and new-game initialisation

**Conventions.** Paths are relative to `reference/stracciatella/src/game/`, except `sgp/…` (relative to
`reference/stracciatella/src/`) and `assets/…` (relative to `reference/stracciatella/`); `V:` is vanilla `Build/`;
ja2-node paths start with `src/`, `data/` or `tools/`. "(inferred)" marks conclusions not traced end to end; the rest was
read in the code. C integer semantics: `/` truncates toward zero, `UINT32` arithmetic wraps. `Random` and `Chance` are
the `main` stream, `PreRandom` the `pre` stream (`01` §3.6); `Random(0)` returns 0 **without** drawing
(`sgp/Random.cc:63-69`); `Chance(x)` = `Random(100) < x`. "World seconds" = `guiGameClock` units (the strategic clock).
"Real ms" = `guiBaseJA2Clock` units: the original's wall-clock millisecond counter (`Utils/Timer_Control.h:49-51`,
advanced in `sgp/SGP.cc:125-126`); ja2-node replaces it with a virtual counter advanced 5 ms per tick (D3). "Policy"
values = Stracciatella defaults from `assets/externalized/game.json` and `strategic-ai-policy.json` (copied unchanged
into `data/externalized/`). Difficulty: `DIF_LEVEL_EASY 1, MEDIUM 2, HARD 3` (`GameSettings.h:78-81`).

**Related:** `16` (sectors, groups, routes, travel, `GroupArrivedAtSector`, encounters, sector transitions), `17` (Queen,
garrisons, patrols, `InitStrategicAI`, `EvaluateQueenSituation`, creatures), `18` (hourly assignment work, militia,
loyalty, mines), `19` (pre-battle interface, autoresolve); `04` §4.3 (drivers), `04` §4.2, `29` (`advance`, the agent
API), `08` §2 (the real-time turn), `10` §8.4 (time in combat), `14` (savegame sections).

---

## 0. State

The original's globals → `StrategicState` (`src/sim/strategic/state.ts`).

**World clock** (`Strategic/Game_Clock.cc:64-87`, saved unless marked transient) → `clock`
(`src/sim/strategic/time/world-clock.ts`): `guiGameClock` (u32) → `seconds`; `guiPreviousGameClock` (monotonic guard) →
`previousSeconds`; `giTimeCompressMode` (i32, 0..4) → `mode`; `guiGameSecondsPerRealSecond` (u32) →
`secondsPerRealSecond`; `gubClockResolution` (u8, updates per real second, 0..60) → `resolution`; `gfTimeCompressionOn` →
`compressionOn`; `gfGamePaused` → `paused`; `gfLockPauseState`, `guiLockPauseStateLastReasonId` → `pauseLocked`,
`pauseLockReason`; `gfTimeInterrupt` → `timeInterrupt`; `gfTimeInterruptPause` (transient) → `timeInterruptPause`;
`gfPauseDueToPlayerGamePause` → `playerPause`; `guiTimeOfLastEventQuery` → `lastEventQuerySeconds`;
`fTimeCompressHasOccured` (transient) → `compressedSinceMapEntry`; `gfResetAllPlayerKnowsEnemiesFlags` →
`battle.resetAllPlayerKnowsEnemiesFlags` (`src/sim/strategic/forces/battle-state.ts`). `guiDay`, `guiHour`, `guiMin`:
the original recomputes them after every change (`UpdateGameClockGlobals`, `:923-931`), ja2-node derives them on
demand. `clock.stopReason` (ja2-node only): the reason of the last compression stop (§2.9).

**Clock driver statics** (function statics of `UpdateClock`, `:587-589`, and `guiTimesThisSecondProcessed :73`; not saved
in the original) → `clock.driver`: `lastSecondMs`, `lastProcessed`, `lastResolution` (initially 1), `timesThisSecond`;
saved by ja2-node.

**Real-time counter**: `guiBaseJA2Clock` (saved in general info, `SaveLoadGame.cc:1865`) → `realMs`; in the tactical flow
it follows the loaded sector's `TacticalState.clockMs`. The strategic turn statics `guiLastTacticalRealTime`
(`Strategic/Strategic_Turns.cc:14`, not saved) and the `STRATEGIC_OVERHEAD` counter deadline (20 ms,
`Utils/Timer_Control.cc:28`) → `RealtimeClock.lastTurnMs`, `.lastOverheadMs` (`src/sim/tactical/state.ts`), shared
across sector loads through `SectorFlowState.realtimeClock`; the same object keeps the opplist decay stamp
(`gTacticalStatus.uiTimeSinceLastOpplistDecay`, saved; world seconds, `08` §2.6) as `.lastOpplistDecaySeconds`.

**Environment** (`TileEngine/Environment.cc:113-119`) → `env` (`src/sim/strategic/time/environment.ts`):
`gubEnvLightValue` (saved in the clock section) → `lightValue`; `gubDesertTemperature`, `gubGlobalTemperature` (saved in
general info, `SaveLoadGame.cc:1922-1923`) → `desertTemperature`, `globalTemperature`; `gfDoLighting` (transient) →
`doLighting`.

**Event queue** (`Strategic/Game_Events.cc:9-15`): an ordered list of `{stamp, kind, frequency, param, offset, flags}`
plus the transient processing guard `guiTimeStampOfCurrentlyExecutingEvent`, `gfProcessingGameEvents` → `queue`
(`src/sim/strategic/time/event-queue.ts`): `events` (`{stamp, kind, frequency, param, offset, seq}`), `nextSeq`,
`processing`, `executingStamp`. No flags: deletion is immediate (§2.4).

**Campaign start flags**: `gTacticalStatus.fDidGameJustStart` (set by `InitOverhead`, `Tactical/Overhead.cc:348`;
cleared after the first helicopter warp, `GameScreen.cc:696`) → `didGameJustStart`; `gfAtLeastOneMercWasHired` →
`atLeastOneMercHired`. `fHasAGameBeenStarted` and `gubScreenCount` (the new-game state machine,
`Strategic/Game_Init.cc:70`): no counterpart; `initNewGame` and the laptop flow replace the state machine (§4). `flow` is
the screen: `strategic` (`MAP_SCREEN`), `tactical` (`GAME_SCREEN`), `autoresolve`, `laptop` (the last two stop the clock,
§1.3).

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

Days count from 0 (`clock < 86400`); a campaign starts on Day 1. Clock string: `"<Day> <day>, HH:MM"` (`:930`).
`GotoNextTimeOfDay` is declared, never defined (dead). ja2-node: constants in `src/sim/strategic/time/constants.ts`,
helpers in `world-clock.ts` (`worldDay`, …, `midnightOfFutureDayInMinutes`, `isDayTime`).

### 1.2 Compression modes, speed and resolution

```
enum { NOT_USING_TIME_COMPRESSION = -1, TIME_COMPRESS_X0, X1, 5MINS, 30MINS, 60MINS, TIME_SUPER_COMPRESS }   // Game_Clock.h:83-93
giTimeCompressSpeeds = { 0, 1, 5*60, 30*60, 60*60 }      // world s per real s; index 5 is 0 (5 initialisers, 6 slots)  // :79
SECONDS_PER_COMPRESSION = 1                               // the comment "1/2 minute" is stale                         // :53
```

`SetClockResolutionToCompressMode(m)` (`:433-462`): `secondsPerRealSecond = speeds[m] · 1`; `resolution` = 0 if that is
0, else `max(1, secondsPerRealSecond / 60)` clamped to 0..60 (`:565-569`); `compressionOn = m > X1`; for m > X1 also
`HandleTimeCompressWithTeamJackedInAndGearedToGo()` (the first-arrival hook, §4.5).

| Mode | World s per real s | Resolution (slices per real s) | World s per slice | Real ms per slice |
|---|---|---|---|---|
| X0 | 0 | 0 | — | clock stopped |
| X1 (tactical) | 1 | 1 | 1 | 1000 |
| 5MINS | 300 | 5 | 60 | 200 |
| 30MINS | 1800 | 30 | 60 | 33.3 |
| 60MINS | 3600 | 60 | 60 | 16.7 |

Dead: `TIME_SUPER_COMPRESS`, `fSuperCompression` (still saved), `SetGameHoursPerSecond`, `SetGameMinutesPerSecond`
(`:466-485`). `NOT_USING_TIME_COMPRESSION` is set only by those, so the fallback in `HandleStrategicTurn`
(`Strategic_Turns.cc:47-50`) is dead too.

**Mode changes** (each refuses with `TellPlayerWhyHeCantCompressTime()` when `AllowedToTimeCompress()` fails, §1.6):

- `SetGameTimeCompressionLevel(m)` (`:393-427`): in `GAME_SCREEN` any m → X1; in `MAP_SCREEN` X1 → X0; m ≥ 5MINS needs
  `AllowedToTimeCompress()`; then `mode = m`, resolution set.
- `IncreaseGameTimeCompressionRate()` (`:340-364`): below 60MINS, `mode++`. `DecreaseGameTimeCompressionRate()`
  (`:367-390`): above X0, `mode--`. Both skip X1 in `MAP_SCREEN`.
- `StartTimeCompression()` (`:276-320`), if not on: unpause (give up if the pause is locked); require
  `AllowedToTimeCompress()`; `mode <= X1` → increase it (→ 5MINS on the map); set the resolution; on the first
  compression since entering the map screen (`compressedSinceMapEntry`, reset at `MapScreen.cc:1722`),
  `ClearTacticalStuffDueToTimeCompression()` (`:904-920`): in map mode, clear the tactical event and message queues and,
  with a world loaded, `CencelAllActionsForTimeCompression` (`EVENT_StopMerc` + `CancelAIAction` for every soldier in the
  sector, `Tactical/Overhead.cc:5867-5879`).
- `StopTimeCompression()` (`:266-273`): if on, set the resolution of X0 **but keep `mode`** (remembered for the next
  start); `compressionOn = false`.
- `IsTimeBeingCompressed()` (`:324-330`) = `compressionOn && mode != X0 && !paused`; false in tactical (X1 has
  `compressionOn = false`).
- Map buttons (`Strategic/Map_Screen_Interface.cc:3929-3990`): toggle = start/stop; "+": stopped →
  `SetGameTimeCompressionLevel(5MINS)` ("ARM change"), running → increase; "−": running → decrease, stopped → only the
  permission check.
- Entering the map screen (`MapScreen.cc:1420-1430`): 5MINS..60MINS kept but stopped, anything else → X0. Leaving it
  (`MapScreen.cc:3238-3256`): to tactical → `SetGameTimeCompressionLevel(X1)`, elsewhere → `StopTimeCompression()`; then
  `UnLockPauseState()`, the auto-pause update, and `UnPauseGame()` when going to tactical without a player pause.

ja2-node: `world-clock.ts` (`CompressMode` `{X0, X1, MIN5, MIN30, MIN60}`, no dead modes) returns the refusal text; the
first-arrival hook is the `ClockContext` hook `compressionModeSet` (§4.5). `ClearTacticalStuffDueToTimeCompression` is not
ported (hook `firstCompressionSinceMapEntry` empty, `compressedSinceMapEntry` never reset): soldiers of a loaded sector
keep their actions across a compression (limitation). The map buttons are the commands `compressTime {mode?}` (a mode:
`setGameTimeCompressionLevel`, then `startTimeCompression`) and `stopTime` (`29`); `src/sim/campaign/screens.ts`
applies the entry and exit rules.

### 1.3 `UpdateClock`: how the clock advances (`Game_Clock.cc:581-692`)

Called once per game-loop pass, **after** the screen handler (`GameLoop.cc:204, 216, 220`). The original loop runs at up
to 144 Hz (`sgp/SGP.cc:190-198`); the real-ms counter is the wall clock, frozen only by `PauseTime(TRUE)`
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

On ja2-node's 5 ms tick, per real second measured from `lastSecondMs`:

- X1: one 1 s advance when `elapsed` reaches 1000: every 200 ticks, 12,000 ticks per world minute.
- 5MINS: a 60 s slice at elapsed 200, 400, 600, 800, 1000 ms: every 40 ticks, 40 per world minute.
- 30MINS: slices at 35, 70, 100, 135, 170, 200, … ms (the first 5 ms tick past each 33⅓ ms boundary), 30 per second:
  every 6–7 ticks, 6.67 per world minute. The truncated thresholds (33, 66, 99, 133, …) never fall on a multiple of 5,
  so no pass warps 0 s.
- 60MINS: slices at 20, 35, 50, 70, 85, 100, … ms, 60 per second: every 3–4 ticks, 3.33 per world minute; no 5 ms tick
  crosses two boundaries.
- Turn-based combat: no world time, tactical ticks still run. Map at X0, stopped or paused: no world time, speech still
  plays out.

A world day costs 57,600 ticks at 5MINS, 4,800 at 60MINS.

Two drifts belong to the behaviour: `lastSecondMs` is reset to the pass time (not advanced by 1000), and every pause,
fade or screen change re-phases it.

ja2-node: `updateClock`; `ctx.screen()` is `other` for the `autoresolve` and `laptop` flows (§0); no fades.

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

`ForecastDayEvents` acts only when `day != guiEnvDay`: it stores the day and calls `BuildDayAmbientSounds()` (ranged
`EVENT_AMBIENT` events, §2.7); the light rebuild and the rain forecast are commented out. ja2-node does not port it
(only ambient sounds; deviation "Ambient sound events"); the `afterAdvance` hook does the enemy-knowledge reset
(`CampaignSim.#clearFlashingEnemyCounts`).

**Warp codes** (`Game_Clock.h:110-115`; ja2-node `Warp.NORMAL`, `NO_PROCESSING`, `TARGET_TIME_FIRST`) and every caller:

| Code | Meaning | Callers (original) | ja2-node |
|---|---|---|---|
| `WARPTIME_PROCESS_EVENTS_NORMALLY` | events inside the window run in order, the clock steps to each stamp | `UpdateClock` (every slice); the first helicopter arrival, 21600 s (`GameScreen.cc:691`); quest debug | `updateClock`; `teamJackedInAndGearedToGo` |
| `WARPTIME_NO_PROCESSING_OF_EVENTS` | the clock jumps; skipped events stay queued in the past and run at the next normal advance | autoresolve battle time (`Strategic/Auto_Resolve.cc:1819`), PBI retreat 300 s (`Strategic/PreBattle_Interface.cc:1067`), last group retreating from a hostile sector 300 s (`Strategic/StrategicMap.cc:1810`), auto-bandage duration (`Tactical/Auto_Bandage.cc:356`), brothel 5–24 min with `Random(20)` (`JAScreens.cc:483`) | `BattleFlow` (autoresolve, PBI retreat), `src/sim/campaign/sector-exits.ts` (retreat), the brothel (`TalkFlow`, the NPC action port; deviation "Brothel time warp"); no auto-bandage (gap "Auto-bandage") |
| `WARPTIME_PROCESS_TARGET_TIME_FIRST` | only the **last** event stamped exactly at the target second runs; earlier ones are skipped and stay queued | adjacent-sector traversal: to the start of minute `now + 5` above ground, `now + 1` underground (`StrategicMap.cc:1817-1827`); see `16` | `sector-exits.ts` |

### 1.5 Pausing, locks and what freezes the clock

Five independent stoppers, each with a different reach:

| Stopper | Set by | World clock | Real-ms counter (tactical animation, strategic turn) |
|---|---|---|---|
| `inCombat` (turn-based) | `EnterCombatMode` | frozen (`:616-617`) | runs |
| `paused` (`PauseGame`, `:512-520`) | many, below | frozen | runs, but no real-time turns: `HandleStrategicTurn` returns while paused (`Strategic_Turns.cc:39-44`) |
| resolution 0 / speed 0 | X0 on the map, `StopTimeCompression` | frozen | runs |
| screen not GAME/MAP, or a fade | laptop, options, save/load, autoresolve screen, help, fades | frozen (`lastSecondMs` re-phased) | runs |
| `PauseTime(TRUE)` | message boxes (`MessageBoxScreen.cc:270-274`), the player's pause (`Game_Clock.cc:822-826`) | frozen (no real ms elapse) | frozen; `COUNTERDONE` never fires (`Timer_Control.cc:152`) |

`timeInterruptPause` (`PauseTimeForInterupt`, `:553-556`) skips one `UpdateClock` pass; the map screen sets it with
`InterruptTime` while the assignment or contract menu is open (`MapScreen.cc:6057-6070`).

**Pause locks.** `LockPauseState(reason)` (`:490-497`) forbids only *unpausing* and compressing. It is a single flag, not
a counter: any `UnLockPauseState()` (`:500-503`) clears it whatever the reason; `UnPauseGame()` while locked is ignored
with a warning (`:523-538`); `PauseGame` always works. Reasons (`Game_Clock.h:27-47`) and their sites: `MSGBOX 1`
(message box), `CREATURE_ATTACK 2` (`Creature_Spreading.cc:603-605`), `DISPLAY_SOLDIER_UPDATE 4` (assignment-update box,
`Map_Screen_Interface.cc:3214-3216`), `CREATE_SOLDIER_UPDATE 5` (`:3453-3454`), `MEANWHILE 6` (`Meanwhile.cc:212-214`),
`CONTRACT_RENEWAL 7` / `CONTRACT_ENDING 8` (`Merc_Contract.cc:105-107, 562-564`), `PREBATTLE_CURRENT_SQUAD 11` /
`PREBATTLE 12` (`Strategic_Movement.cc:660-662, 681-683`), `SIMULTANEOUS_ARRIVAL 13` (`:1579-1581`), `ENGAGED_IN_CONV 14`
(`Tactical/Dialogue_Control.cc:289-290`), `MERC_TALKING 15` (a quote on the map screen, `Dialogue_Control.cc:639-643`),
`LOCKUI_MODE 16` / `LOCKOURTURN_UI_MODE 17` (`Tactical/Handle_UI.cc:4026-4027, 4478-4479`), `ITEM_PICKUP 18`
(`Interface_Items.cc:4288-4290`), `DOOR_OPEN 19` (`Interface.cc:1272-1274`), `START_HELI 20`
(`Merc_Entering.cc:412-414`), `SECTOR_EXIT 21` (`Strategic_Exit_GUI.cc:373-375`). Plain `PauseGame` without a lock: the
laptop (`Laptop/Laptop.cc:462`), shop keeper, options, help, boxing, auto-bandage, save, `EnterSector` (sector load,
`StrategicMap.cc:839-841`, also `InterruptTime`), `MercsContractIsFinished` (`Strategic_Merc_Handler.cc:396-410`, also
`InterruptTime`).

The player's pause (`HandlePlayerPauseUnPauseOfGame`, `:793-828`): ignored while `ENGAGED_IN_CONV`; toggles
`PauseGame`/`PauseTime` together with `playerPause`; unpausing in `GAME_SCREEN` with mode X0 first sets X1.

ja2-node: ported subsystems lock with the original reasons (`PauseLock` 11–13 in
`src/sim/strategic/forces/constants.ts`; meanwhile 6, contracts 7 and 8, conversations 14 in their modules).
`PauseTime(TRUE)`: no counterpart, an open decision prompt stops the whole simulation (§1.8). The player's pause is the
manual driver (deviation "Real-time pause"); `playerPause` only feeds the automatic pause (§1.6).

### 1.6 `AllowedToTimeCompress` and the automatic pause (`Strategic/Map_Screen_Interface_Bottom.cc:732-836`)

False when any holds, in this order: leaving the map screen or an exit is pending; the pause is locked; a meanwhile is
trying to start; the dialogue queue is not empty; a destination is being plotted (`bSelectedDestChar != −1`, heli plot,
move confirmation, movement list); an assignment/training/attribute/squad/contract menu is open; the update box, town
info or militia popup is shown; a contract renewal sequence runs; the map is disabled by a battle (`fDisableMapInterface-
DueToBattle`, `fDisableDueToBattleRoster`); an inventory item is held; the sector inventory is shown; **no merc was ever
hired**; **no usable merc** (alive, not mechanical, not POW, not dead, not EPC; in-transit counts, `:934-949`); a timed
bomb is active; `inCombat` or `fEnemyInSector`; a player group is in a creature-infested mine; a bloodcat ambush with
hostile bloodcats present.

`TellPlayerWhyHeCantCompressTime` (`MapScreen.cc:6250-6316`) explains the first matching reason. Side effect of its
last branch: with `inCombat` or `fEnemyInSector` it opens the non-persistent PBI (`InitPreBattleInterface(0, false)`)
unless only hostile civilians are present.

Every map-screen frame, `UpdatePausedStatesDueToTimeCompression()` (`MapScreen.cc:5413-5440`, called at `:1908`) pauses
the game when time is being compressed but no longer allowed, and unpauses it when compression is wanted
(`compressionOn`), allowed again and there is no player pause. So a quote on the map (non-empty dialogue queue) or the
update box stops time **without** stopping compression: the clock resumes by itself.

ja2-node: the `compressionRefusal` hook (a campaign hook, else the default) checks, in order: no merc ever hired, a
meanwhile about to start, no usable merc (alive, not a vehicle, robot or EPC, not POW or dead), `inCombat`,
`fEnemyInSector`, a player group in a creature-infested mine, a bloodcat ambush with hostile bloodcats, the contract
renewal sequence; tokens and texts in `src/sim/campaign/compression-refusals.ts`. Not checked: UI states, the dialogue
queue, the timed bomb; no PBI opens (deviation "Time compression checks"). The automatic pause runs on every strategic
step after the dialogue step, and after `compressTime`.

### 1.7 Tactical: real time, turn-based combat and the strategic turn

**Real time.** In `GAME_SCREEN` the mode is always X1 (one world second per 1000 real ms, §1.3) and nothing can raise
it. Strategic events (enemy groups arriving, Queen decisions, mine income) keep firing in tactical.

**Turn-based combat.** The world clock is frozen for the whole battle (`Game_Clock.cc:616-617`; vanilla too,
`V:Strategic/GameClock.c:600-601`; its "10 s per real s in combat" local in `AdvanceClock` was dead code,
`V:GameClock.c:147-155`). Since `lastSecondMs` is not refreshed in combat, the first pass after combat advances one world
second at once (the clamp caps `elapsed` at 1000). `StartPlayerTeamTurn` also calls `UpdateClock`
(`Tactical/TeamTurns.cc:138`), a no-op in combat.

**The strategic turn** (`HandleStrategicTurn`, `Strategic/Strategic_Turns.cc:30-88`), the real-time "turn" of `08` §2
and `10` §8.4, runs every pass of the game screen (`GameScreen.cc:346`, inside `if (!ARE_IN_FADE_IN())`), the map screen
(`MapScreen.cc:1618`) and auto-bandage (`Tactical/Auto_Bandage.cc:225`):

```
HandleStrategicTurn():
  if !COUNTERDONE(STRATEGIC_OVERHEAD): return                 // 20 ms × game_durations_multiplier (1.0), auto-reset
  if paused || (screen == MAP && !IsTimeBeingCompressed()): return
  t = realMs
  if inCombat: lastTacticalTurnMs = t; return
  check = IsTimeBeingCompressed() ? 5000 / (speeds[mode] · RT_COMPRESSION_TACTICAL_TURN_MODIFIER 10) : 5000
  if t − lastTacticalTurnMs > check: HandleTacticalEndTurn(); lastTacticalTurnMs = t
```

`NUM_REAL_SEC_PER_TACTICAL_TURN 5000` and the modifier 10: `Tactical/RT_Time_Defines.h:14-16`. `check` = 5000 in
tactical, `5000/3000 = 1` at 5MINS, `0` at 30/60MINS. `SyncStrategicTurnTimes` (`lastTacticalTurnMs = realMs`) runs at
new game (`StrategicTurnsNewGame`), every `SetCurrentWorldSector` (`StrategicMap.cc:435`), `CommonEnterCombatModeCode`
(`Overhead.cc:3971`), combat exit (`HandleStrategicTurnImplicationsOfExitingCombatMode`, which also runs
`HandleTacticalEndTurn` at once, `Strategic_Turns.cc:91-95`) and the first heli drop (`Merc_Entering.cc:782`).

Consequences on an ideal 5 ms loop:

- Tactical: the counter fires every 20 ms, so the turn falls on the first fire past 5000 ms: **every 5020 ms**, not 5005.
- Map while compressing: `check` ≤ 1, so every counter fire runs a turn: **one `HandleTacticalEndTurn` per 20 real ms**
  = 10 turns per world minute at 5MINS, 1⅔ at 30MINS, ⅚ at 60MINS. The formula meant `5000/(C·10)` real ms = one turn
  per 0.5 world s; truncation and the counter defeat it. The original's real rate depends on its frame rate (at 144 Hz a
  20 ms counter polled every 6.94 ms fires every ~20.8 ms).
- `HandleTacticalEndTurn` (`Tactical/Tactical_Turns.cc:80-157`) runs `EVENT_BeginMercTurn` for **every** living,
  non-mechanical merc of the player's team, in any sector, and for the loaded sector's other soldiers: bleeding
  (`33`, `nextBleed −= 0.5`), breath, shock, drug decay, first aid (`HandlePlayerServices`, which acts only on a
  merc playing the `GIVING_AID` animation, `Overhead.cc:3830-3833`); plus the loaded sector's smoke/light/blood decays by
  world seconds, pending enemies, and the public opplist decay. So **a wounded merc's bleeding per world minute on the
  map depends on the compression level** (12× slower at 60MINS than at 5MINS).

ja2-node: `handleRealtimeTurns` (`src/sim/tactical/turns/turns.ts`, from the overhead pass), on the 20 ms counter with
`RT_TURN_MS` 5000 and a strict `>` (5020 ms); it returns while a conversation is engaged (the original's pause) and
re-syncs `lastTurnMs` in combat; the turn after combat: deviation "Real-time turn after combat". `handleTacticalEndTurn`
runs `beginMercTurn` only for soldiers placed in the loaded sector, and the strategic flow runs no strategic turn, so
mercs outside the loaded sector never bleed, recover breath or get first aid between hourly updates, on the map at any
compression or in tactical (limitation, §7; gap "Absent mercs between hourly updates").

### 1.8 Ticks and world seconds in ja2-node

`CampaignSim.step()` (`src/sim/campaign/campaign-sim.ts`) steps the one virtual real-ms counter, `StrategicState.realMs`
(`guiBaseJA2Clock`). A step does nothing while a battle-flow prompt (`19`, `22`), a conversation decision, a shop or the
laptop is open (D15, `01` §3.8), which covers `PauseTime(TRUE)` under message boxes. Otherwise, per tick, in the
original's loop order (screen work, then `UpdateClock`):

```
step():
  session.tick++
  flow tactical:    apply a pending light change (EnvironmentController, GameScreen.cc:333)            // §1.10
                    tactical.step(): one pass of the loaded sector (doc 10 order), including
                                     handleRealtimeTurns on the 20 ms counter (GameScreen.cc:346)
                    realMs = tactical.clockMs (+5 per tactical tick); dialogue step
  flow autoresolve: one autoresolve step; realMs stands still (another screen, §1.5)
  flow strategic:   realMs += 5; dialogue step (MapScreen.cc:1901); automatic pause (§1.6, :1908)
  updateClock(realMs)                                                                                   // §1.3, events §2.5
  meanwhile and endgame hand-offs, helicopter (map only), battle hand-offs (PBI), contract settlement,
  then the clock events (compressionStarted/Stopped, dayStarted)
```

The loaded sector is not stepped in the `strategic` flow (the original never calls `ExecuteOverhead` from the map): its
`clockMs` stands still and its deadlines are in the past on return, like an expired `TIMECOUNTER`. A sector load starts
the tactical clock at `realMs` (`src/sim/campaign/sector-flow.ts`). World seconds per tick: §1.3.

**Drivers** (`04` §4.3) on the map: compression is sim state, changed only by commands (D15); real time ×1 gives the
original's pacing (5 world minutes per second at 5MINS). `isIdle()` on the map = not compressing
(`!isTimeBeingCompressed`, so an automatic pause counts) and no meanwhile or endgame in progress, so `compressTime` under
the instant driver compresses until something stops or pauses it. A strategic `advance` (`29`) stops compression
itself at the first tick boundary where the clock reaches a `worldTime` target: the clock lands on a slice end at most
59 s past it. Its budget, 2,000,000 ticks or 7 world days (`src/sim/advance.ts`), binds on the days at every compression
level (7 days cost 403,200 ticks at 5MINS).

### 1.9 Compression-dependent rules

Besides the strategic-turn rate (§1.7), these outcome-relevant rules read the compression state:

- Natural healing: the activity divisor is LOW ("basically resting") when `IsTimeBeingCompressed()` and the merc's group
  is not moving, else HIGH (`Strategic/Assignments.cc:2886-2897`), evaluated inside the hourly update (`18`). An hour that
  ticks over in tactical, or on the map without compression, heals less. ja2-node tests the strategic flow instead
  (deviation "Time compression for healing").
- `RandomMercInGroupSaysQuote` returns early during tactical traversal or underground unless compressing
  (`Map_Screen_Interface.cc:1403-1406`), which decides whether a `Random(n)` draw happens; ja2-node does not draw it
  (deviation "Cosmetic draws in strategic movement").
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
- `GetTimeOfDayAmbientLightLevel()` (`:369-379`) = 2 when `SectorTemperature(loaded sector) == HOT`, else
  `envLightValue`; `SectorTemperature` (`:491-506`) is 0 underground, the desert temperature where `IsSectorDesert`
  (traversability `THROUGH == SAND`, `StrategicMap.cc:2896-2899`), else the global one. So desert sectors are brighter (2)
  from 9:00 to 17:00, every surface sector from 12:00 to 14:00.
- `EnvironmentController(TRUE)` (`:122-227`, every game-screen pass before the tactical overhead, `GameScreen.cc:333`):
  if `doLighting`, `LightSetBaseLevel(GetTimeOfDayAmbientLightLevel())`, merc lights refresh, `doLighting = false`.
  `AllTeamsLookForAll` is commented out (`:218`): a light change triggers no sight checks by itself. A sector load
  (`TileEngine/WorldDef.cc:2346`) and a savegame load (`SaveLoadGame.cc:1042-1043`) set the level directly.
- `envLightValue` starts at **0** in a fresh process (`:115`) and only the event changes it; `InitNewGameClock` does not
  touch it. At 07:00 on Day 1, when the first squad lands, the 6:59 event has set it to 5; it reaches 3 at 7:03.

ja2-node: `src/sim/strategic/time/environment.ts` (light 0 at creation); `CampaignSim` registers the light, temperature
and light-sprite events (`TacticalSim.powerNightLights`, `powerPrimeLights`) and applies `doLighting` before each
tactical step (`TacticalSim.setAmbientLight`). Imported saves and the sandbox: deviation "Ambient light and light
schedule".

---

## 2. The strategic event queue

### 2.1 Event record (`Strategic/Game_Events.h:7-29`)

```
STRATEGICEVENT { next; uiTimeStamp (u32 world s); uiParam (u32); uiTimeOffset (u32 s); ubEventType (frequency);
                 ubCallbackID (kind); ubFlags (SEF_DELETION_PENDING 0x02) }
StrategicEventFrequency { ONETIME_EVENT 0, RANGED_EVENT 1, ENDRANGED_EVENT 2, EVERYDAY_EVENT 3, PERIODIC_EVENT 4,
                          QUEUED_EVENT 5 (never used) }
```

Saved as `u32 n`, then n × 28 bytes in list order: 4 skipped, stamp, param, offset, type, kind, flags, 9 skipped
(`Game_Events.cc:325-351`); loading rebuilds the list in file order (`:354-384`). Reader:
`src/content/formats/savegame.ts` `readStrategicEvents`; ja2-node's `StrategicEvent` drops `flags` and adds `seq`.

### 2.2 Ordering and tie-breaking

`AddAdvancedStrategicEvent` (`:171-197`) inserts the new node **after every node with stamp ≤ its own** (the scan stops at
the first strictly greater stamp, `:191`): the list is sorted by stamp, FIFO among equal stamps. ja2-node keeps
`queue.events` sorted by `(stamp, seq)`, `seq` = `queue.nextSeq++` at every insertion (reposts included); an import
assigns `seq` in file order. Deleting never reorders.

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

**Posting guard** (`:173-178`): while `processing` (inside `ProcessPendingGameEvents`), a stamp **≤ `executingStamp`**
(the stamp of the event whose callback runs) is silently rejected: no node, the call returns NULL/FALSE. So a callback
can never schedule anything at or before its own time; e.g. `AddEveryDayStrategicEvent` from a callback is dropped when
its stamp (today at that time of day) is not later than the executing event's. Outside processing, past stamps are
accepted and run at the next advance.

Because `AddPeriodStrategicEvent` anchors at midnight (its header comment is wrong), a periodic event posted mid-day
starts with catch-up firings: the creature spread event (450 min on medium) posted at 15:00 is stamped 07:30 first
(past), then 15:00 (= now, still in the window), then 22:30 (inferred from the code, `Creature_Spreading.cc:249-257`).

### 2.4 Deletion (`Game_Events.cc:25-43, 266-321`)

- `DeleteStrategicEvent(k, param)`: the first node with that kind and param not already pending deletion.
- `DeleteAllStrategicEventsOfType(k)`: every such node.
- `DeleteAllStrategicEvents()`: the whole list (new game, restart, load).
- During a callback (`gfPreventDeletionOfAnyEvent`, set by `ExecuteStrategicEvent`, `Game_Event_Hook.cc:62-63`) deletion
  only flags the node (`SEF_DELETION_PENDING`); the processing loop skips flagged nodes (`ExecuteStrategicEvent` returns
  FALSE for them, `:68-72`), and the end of `ProcessPendingGameEvents` unlinks them (`Game_Events.cc:152`). The executing
  event is already out of the queue: deleting its own kind from its callback does **not** prevent its repost (the repost
  depends only on the return value, TRUE because the flag check precedes the callback).

ja2-node deletes immediately and unlinks the executing event before its callback; no reader observes a flagged node in
between (inferred). The import drops nodes saved with `SEF_DELETION_PENDING`.

### 2.5 `ProcessPendingGameEvents(adjust, code)` (`Game_Events.cc:59-156`)

`GameEventsPending(adjust)` (`:18-22`) = head exists and `head.stamp <= clock + adjust`.

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

Properties:

- Reposts use the event's own stamp, not the current time: events left in the past by a `NO_PROCESSING` warp catch up,
  firing once per period.
- A repost (or any event a callback posts) landing inside the current window runs in the same pass, in order.
- `InterruptTime()` (`Game_Clock.cc:548-551`, "only applicable inside event callbacks") stops the loop **after** the
  current event (its repost still happens) and discards the rest of the window: the clock stays at that event's stamp;
  events with the same stamp after it run at the next advance. `timeInterrupt` stays set (and is saved) until the next
  `ProcessPendingGameEvents`.
- Callbacks for past events see `GetWorldTotalSeconds()` = the window start (the clock has not moved yet).
- `TARGET_TIME_FIRST` runs the target event **before** all earlier-due events (they wait for the next normal advance):
  a tactical traversal processes the traversing group's arrival first.

ja2-node walks with a `(stamp, seq)` cursor instead of restarting at the head; since the guard puts every post after the
executing stamp, it visits the events in the original's order.

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

ja2-node: `EventDispatch` holds one handler per kind (a later `register` replaces an earlier one) and always returns
true; no `OnStrategicEvent`; `DelayEventIfBattleInProgress` is part of the meanwhile handler
(`src/sim/strategic/ai/meanwhile.ts`).

### 2.7 Dispatch table: every event kind (`Game_Event_Hook.h:6-70`)

"Poster" = who schedules it. The ja2-node column names the module under `src/sim/` that registers the handler: `sim`
`campaign/campaign-sim.ts`, `laptop` `campaign/laptop/laptop-flow.ts`, `contracts` `campaign/contracts/contract-flow.ts`,
`narrative` `campaign/narrative/narrative-flow.ts`, `npc-port` `campaign/narrative-port.ts`, `creatures`
`campaign/creature-flow.ts`, `heli` `campaign/helicopter-flow.ts`, `economy` `strategic/economy/update.ts`, `queen`
`strategic/ai/strategic-ai.ts`; — none.

| Id | Kind | Frequency, poster | Handler (file) and effect | ja2-node |
|---|---|---|---|---|
| 1 | `CHANGELIGHTVAL` | everyday ×18, `BuildDayLightLevels` | `envLightValue = param`, `doLighting` (§1.10) | `sim` |
| 4 | `CHECKFORQUESTS` | everyday 08:00, `SetupNewStrategicGame` | `CheckForQuests(day)` (`Quests.cc:1182`): starts DELIVER_LETTER once, history entry | `narrative` |
| 5 | `AMBIENT` | ranged, `BuildDayAmbientSounds` (`Environment.cc:289-316`), rebuilt on sector load (`Ambient_Control.cc:41-60`) | start (`param` overwritten by the sound handle) / stop a random ambient sound | — (dropped on import) |
| 6 | `AIM_RESET_MERC_ANNOYANCE` | one-shot, `AIMMembers.cc:2234` | `ResetMercAnnoyanceAtPlayer` | `laptop` |
| 7 | `BOBBYRAY_PURCHASE` | one-shot day+N at 08:00, 09:00, 10:00 or 11:00 (`(8 + Random(4))·60`), `BobbyRMailOrder.cc:1843` | `BobbyRayPurchaseEventCallback` (`Strategic_Event_Handler.cc:54-343`): delivery, loss/theft `Random`, facts, email, `StopTimeCompression` | `laptop` |
| 8 | `DAILY_UPDATE_BOBBY_RAY_INVENTORY` | everyday 09:00 | Bobby Ray new/used and arms dealers' daily stock (`BobbyR.cc:514, 565`; `Arms_Dealer_Init.cc:239`) | `sim` |
| 9 | `UPDATE_BOBBY_RAY_INVENTORY` | one-shot, `BobbyR.cc:659` | `AddFreshBobbyRayInventory(item)` | `laptop` |
| 10 | `DAILY_UPDATE_OF_MERC_SITE` | everyday 00:00 | `DailyUpdateOfMercSite` (`Laptop/Mercs.cc:513`) | `contracts` |
| 11 | `DAY3_ADD_EMAIL_FROM_SPECK` | one-shot Day 1+N 07:00, `Game_Init.cc:263` | M.E.R.C. intro email | `laptop` |
| 12 | `DELAYED_HIRING_OF_MERC` | one-shot, `Merc_Hiring.cc:158` | `MercArrivesCallback(soldier)` (`:224-…`): squad, insertion, contract end, `StopTimeCompression` | `laptop` (`sim` without a laptop) |
| 13 | `HANDLE_INSURED_MERCS` | everyday 00:00 | `DailyUpdateOfInsuredMercs` (`Insurance_Contract.cc:675`) | `laptop` |
| 14 | `PAY_LIFE_INSURANCE_FOR_DEAD_MERC` | one-shot, `Insurance_Contract.cc:908` | payout | `laptop` |
| 15 | `MERC_DAILY_UPDATE` | everyday 00:00 | `MercDailyUpdate` (`Strategic_Merc_Handler.cc:135-370`), §3.4 | `contracts` |
| 18 | `GROUP_ARRIVAL` | one-shot, `Strategic_Movement.cc:280, 1138, 1507, 1538, 1636, 1779, 2809, 2963` | `GroupArrivedAtSector(group, TRUE, FALSE)` (`:1077`), see `16` | `sim` |
| 19 | `DAY2_ADD_EMAIL_FROM_IMP` | one-shot, `IMP_Confirm.cc:206` | IMP results email if the policy sends it | `laptop` |
| 20 | `MERC_COMPLAIN_EQUIPMENT` | one-shot, `Strategic_Merc_Handler.cc:200`, `Merc_Hiring.cc:334` | quote | `contracts` |
| 21 | `HOURLY_UPDATE` | periodic 60 min, `StrategicMap.cc:2256` | `HandleHourlyUpdate` (`Hourly_Update.cc:35-73`), §3.2 | `economy` |
| 22 | `HANDLE_MINE_INCOME` | one-shot 09/12/15/18:00, `Strategic_Mines.cc:522` | `HandleIncomeFromMines` (`:527-540`), see `18` | `economy` |
| 23 | `SETUP_MINE_INCOME` | everyday 00:00 | `PostEventsForMineProduction` (`:516-524`): posts the four income events | `economy` |
| 27 | `SET_BY_NPC_SYSTEM` | one-shot, `Interface_Dialogue.cc` (14 sites), `Strategic_Event_Handler.cc:322-665` | `HandleNPCSystemEvent` (`:549-691`): facts or NPC actions (`param ≥ 10000`) | `narrative` |
| 28 | `SECOND_AIRPORT_ATTENDANT_ARRIVED` | one-shot, `Overhead.cc:2318` | Sal placed at the airport | `narrative` |
| 29, 30 | `HELICOPTER_HOVER_TOO_LONG`, `_WAY_TOO_LONG` | one-shot +10/+20 min, `Map_Screen_Helicopter.cc:444, 453` | Skyrider complains / returns to base (`16`) | `heli` |
| 32, 33 | `MERC_LEAVE_EQUIP_IN_OMERTA`, `_DRASSEN` | one-shot +6 h, `Map_Screen_Interface.cc:1032` | dismissed merc's gear appears (`:1086-1097`) | `contracts` |
| 34 | `DAILY_EARLY_MORNING_EVENTS` | everyday 04:00 | `HandleEarlyMorningEvents` (`Strategic_Event_Handler.cc:693-865`), §3.4 | `narrative` |
| 35 | `GROUP_ABOUT_TO_ARRIVE` | one-shot arrival − 5 min, player groups only (`Strategic_Movement.cc:55, 281-288`) | `HandleGroupAboutToArrive` (`Map_Screen_Interface.cc:1226-1235`): redraw + Dead-is-Dead autosave | `sim` |
| 36 | `PROCESS_TACTICAL_SCHEDULE` | one-shot, `Scheduling.cc:826-1031` | `ProcessTacticalSchedule` | `npc-port` |
| 37, 38, 75 | `BEGINRAINSTORM`, `ENDRAINSTORM`, `RAINSTORM` | never posted (`Environment.cc:338-363` commented out) | empty | — |
| 41 | `MAKE_CIV_GROUP_HOSTILE_ON_NEXT_SECTOR_ENTRANCE` | one-shot +300 min, `Overhead.cc:2767` | rebel loyalty hit, group "will become hostile" (`Strategic_Event_Handler.cc:867-876`) | `npc-port` |
| 42 | `BEGIN_AIR_RAID` | never | no case | — |
| 44 | `MEANWHILE` | one-shot, `Meanwhile.cc:197` | delayed if `fEnemyInSector` (§2.6), else `BeginMeanwhile` + `InterruptTime` | `queen` |
| 46 | `CREATURE_SPREAD` | periodic 510/450/390 min, `Creature_Spreading.cc:249-257` | `SpreadCreatures` (`17`) | `creatures` |
| 48 | `CREATURE_NIGHT_PLANNING` | everyday 22:00, `:264` | `CreatureNightPlanning` (`:884`): may post `CREATURE_ATTACK` at `now + 1 + PreRandom(429)` min | `creatures` |
| 49 | `CREATURE_ATTACK` | one-shot, `:518, 892` | `CreatureAttackTown`: PBI or tactical add, `InterruptTime` + pause + lock | `creatures` |
| 50 | `EVALUATE_QUEEN_SITUATION` | one-shot, self-reposting (`Strategic_AI.cc:342, 1948, 1953`) | `EvaluateQueenSituation` (`:1930`), see `17` | `queen` |
| 51 | `CHECK_ENEMY_CONTROLLED_SECTOR` | periodic per garrison (`Strategic_AI.cc:515`) | `CheckEnemyControlledSector(sector)` (`:1308`), see `17` | `queen` |
| 52–55 | `TURN_ON/OFF_NIGHT_LIGHTS`, `TURN_ON/OFF_PRIME_LIGHTS` | everyday 21:00 / 07:00 / 21:00 / 00:00 | power map light sprites with the NIGHTTIME/PRIMETIME flag (`Environment.cc:412-463`) | `sim` |
| 56 | `MERC_ABOUT_TO_LEAVE` | one-shot 05:30/11:30/17:30, posted daily | `FindOutIfAnyMercAboutToLeaveIsGonnaRenew` (`Merc_Contract.cc:863`) | `contracts` |
| 58 | `ENRICO_MAIL` | everyday 07:00 | `HandleEnricoEmail` (`Strategic_Status.cc:246`): progress emails | `laptop` (`economy` without a laptop) |
| 59, 60 | `INSURANCE_INVESTIGATION_STARTED`, `_OVER` | one-shot, `Insurance_Contract.cc:903, 944` | investigation | `laptop` |
| 61 | `MINUTE_UPDATE` | never | empty | — |
| 62 | `TEMPERATURE_UPDATE` | everyday ×8 | `UpdateTemperature(code)` (§1.10) | `sim` |
| 63 | `KEITH_GOING_OUT_OF_BUSINESS` | one-shot +6 days, `Interface_Dialogue.cc:3194` | fact | `narrative` |
| 64 | `MERC_SITE_BACK_ONLINE` | one-shot, `Mercs.cc:586` | | `laptop` |
| 66 | `CHECK_IF_MINE_CLEARED` | one-shot +15 s, `Queen_Command.cc:887` | `HourlyMinesUpdate` (restart a cleared mine), see `18` | `economy` |
| 67 | `REMOVE_ASSASSIN` | one-shot +3..5 h, `Soldier_Profile.cc:410` | assassin leaves, life restored | `narrative` |
| 68 | `BANDAGE_BLEEDING_MERCS` | one-shot +1 min, `Assignments.cc:322, 6526`, `Auto_Resolve.cc:1649` | `BandageBleedingDyingPatientsBeingTreated` (`Assignments.cc:6461`), see `18`/`19` | `economy` |
| 72 | `BEGIN_CONTRACT_RENEWAL_SEQUENCE` | one-shot 07:30/13:30/19:30, posted daily | `BeginContractRenewalSequence` (`Merc_Contract.cc:88`) | `contracts` |
| 73 | `RPC_WHINE_ABOUT_PAY` | one-shot 07:30 | quote | `contracts` |
| 74 | `HAVENT_MADE_IMP_CHARACTER_EMAIL` | one-shot Day 2 8–11 h, `Laptop.cc:1447` | email | `laptop` |
| 76 | `QUARTER_HOUR_UPDATE` | periodic 15 min, `StrategicMap.cc:2257` | `HandleQuarterHourUpdate` (`Hourly_Update.cc:85-92`), §3.3 | `economy` |
| 77 | `MERC_MERC_WENT_UP_LEVEL_EMAIL_DELAY` | one-shot, `Campaign.cc:703` | email | `contracts` |
| 78 | `MERC_SITE_NEW_MERC_AVAILABLE` | one-shot, `Mercs.cc:1591` | | `laptop` |

Every kind keeps its original id, frequency and reposting, so the queue matches the original in content and order; a
kind without a handler returns TRUE and, if everyday or periodic, keeps reposting. `EventKind`
(`src/sim/strategic/time/constants.ts`) lists the posted kinds; the never-posted ones (37, 38, 42, 61, 75) have no name
and would stay no-ops in an import. `AMBIENT` is never queued (deviation "Ambient sound events").

The player view never shows the queue (D16; `STATE_FIELDS` in `src/sim/knowledge/strategic-state.ts` leaves it out),
only derived times the original shows the player (own groups' ETAs, merc arrivals, contract ends, the fixed mine-income
times).

### 2.8 Processing order within one time step

One tick (§1.8): screen work (tactical pass or map handlers, including the strategic turn), then `UpdateClock`: at most
one `AdvanceClock`/`WarpGameTime` (one 1 s step or one 60 s slice, or two slices' worth after a re-phase); inside it,
events in `(stamp, seq)` order, each with the clock at its stamp, reposts interleaved by stamp; then the rest of the
window, `UpdateGameClockGlobals`, the enemy-knowledge reset, `ForecastDayEvents`. State changes made by events (a stopped
compression, a pause, a PBI, a new light value, enemies added to the loaded sector) reach the screen work of the
**next** tick. ja2-node runs the hand-offs the original's screens make on the next frame (meanwhile start, the PBI,
contract settlement) at the end of the same tick, after `updateClock` (§1.8).

### 2.9 Interaction with compression: three ways an event stops time

| Call in a callback | Effect on the current slice | Effect afterwards |
|---|---|---|
| `StopTimeCompression()` | none: later events in the slice still run and the clock reaches the slice end (≤ 60 s overshoot) | resolution 0; `WarpGameTime` then restores the old `secondsPerRealSecond` (stale but harmless while the resolution is 0); `compressionOn` false; the mode is remembered |
| `InterruptTime()` | the loop stops after this event; the clock stays at its stamp | compression continues next pass unless also stopped or paused |
| `PauseGame()` (+ lock) | none by itself | `UpdateClock` returns until unpaused; with a lock, compression cannot be restarted |

Typical combinations: battle at arrival = `InterruptTime` + `PauseGame` + lock (`Strategic_Movement.cc:660-683`); message
box = all four including `PauseTime`; merc arrival, group at final destination, assignment done, head miner quote = only
`StopTimeCompression`. Every `StopTimeCompression` caller: group at final destination (`Strategic_Movement.cc:1411`),
halted group (`:3489, 3601`), PBI opened (`PreBattle_Interface.cc:421, 968, 1003, 1075`; `Strategic_Movement.cc:907`),
merc arrived (`Merc_Hiring.cc:244`), merc died on the map (`Strategic.cc:41`), merc left (`Merc_Contract.cc:705`), repair
done / assignment aborted / old assignment resumed (`Assignments.cc:1974, 2740, 7039, 7130`), head miner quote
(`Strategic_Mines.cc:794`), hated-merc complaint (`Strategic_Merc_Handler.cc:588, 657`), militia training unpaid
(`Town_Militia.cc:568, 574`), leaving the map screen (`Map_Screen_Interface_Bottom.cc:1121`), helicopter events
(`Map_Screen_Helicopter.cc:230, 276, 286, 459, 1096, 1442`), Bobby Ray delivery (`Strategic_Event_Handler.cc:329`).

ja2-node passes a reason with each `stopTimeCompression` call (`CompressionStop`, `world-clock.ts`), kept in
`clock.stopReason` and reported with `compressionStopped` (`29`).

---

## 3. Hourly, daily and other periodic updates

### 3.1 The standing schedule

Everything periodic is an event, except the strategic turn (§1.7) and `ForecastDayEvents` (§1.4). A steady-state day
(Day ≥ 2) with the base set of events, in execution order; ties follow the FIFO rule of §2.2, i.e. when each instance was
(re)posted: init-posted everyday events (reposted at their previous firing) first, then one-shots posted at 00:00, then
`HOURLY` (reposted an hour earlier) and `QUARTER` (15 min earlier).

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

So the daily merc update runs before the hourly update at midnight, and mine income (posted at 00:00) before it at
09/12/15/18:00. A loaded savegame keeps whatever order it carries.

### 3.2 `HandleHourlyUpdate` (`Strategic/Hourly_Update.cc:35-73`)

Returns at once while `didGameJustStart` (until the first squad lands, §4.5). Then, in order:

| # | Call | File | Draws | ja2-node |
|---|---|---|---|---|
| 1 | `UpdateAssignments()` | `Assignments.cc:954-1029` | `PreRandom` via `StatChange` → `ProcessStatChange` (training, doctoring, repair skill gain, `Campaign.cc:261, 336`); `Random(100)` toolkit wear per repairman (`:1991`) | `updateAssignments` (`18`) |
| 2 | `UpdateBuddyAndHatedCounters()` | `Strategic_Merc_Handler.cc:526-730` | none; quotes, `StopTimeCompression` | `BattleFlow.updateBuddyAndHatedCounters` (`22`) |
| 3 | `HourlyMoraleUpdate()` | `Tactical/Morale.cc:664` | none | `BattleFlow.hourlyMoraleUpdate` |
| 4 | `HourlyCamouflageUpdate()` | `Strategic_Merc_Handler.cc:733-759` | none (camo −2, monster smell −1) | not wired (camouflage is not simulated) |
| 5 | `HourlyMinesUpdate()` | `Strategic_Mines.cc:162-234` | none | `hourlyMinesUpdate` (`18`) |
| 6 | `HourlyProgressUpdate()` | `Tactical/Campaign.cc:1289-1325` | none; first crossings of 35/50/70 % trigger the Madlab meanwhile, Mike, Iggy (policy `progress.event_*_min`) | `hourlyProgressUpdate` (`src/sim/strategic/ai/difficulty.ts`) and the narrative milestones |
| 7 | `HourlyQuestUpdate()` | `Hourly_Update.cc:95-152` | none; brothel/club/museum facts by hour, boxers' rest | `src/sim/strategic/narrative/hourly.ts` |
| 8 | `HourlyLarryUpdate()` | `:170-305` | `Random(temptation)`, `Random(2)` | `src/sim/strategic/narrative/larry.ts` |
| 9 | `HourlyCheckIfSlayAloneSoHeCanLeave()` | `:308-328` | `Chance(15)` | `narrative/hourly.ts` |
| 10 | `PayOffSkyriderDebtIfAny()` | `Map_Screen_Helicopter.cc:1387-1415` | none | `HelicopterFlow.payOffSkyriderDebtIfAny` |
| 11 | every 6th hour (`hour % 6 == 0`): `UpdateRegenCounters()` | `:76-82` | none | not wired (drugs are not simulated) |

ja2-node: `handleHourlyUpdate` (`src/sim/strategic/economy/update.ts`) calls the steps in this order, the non-economy ones
through `EconomyContext.slots` filled by `CampaignSim`.

`UpdateAssignments`' own order (the sector loop is column-major: `x` outer, then `y`, `z`): `18` §5.3; its draws:
`18` §5.15.

### 3.3 `HandleQuarterHourUpdate` (`Hourly_Update.cc:85-92`)

Returns while `didGameJustStart`; else `DecayTacticalMoraleModifiers()` (`Tactical/Morale.cc:138-…`, no draws).
ja2-node: `handleQuarterHourUpdate` (`economy/update.ts`).

### 3.4 Daily updates

- **00:00 `MERC_DAILY_UPDATE`** (`Strategic_Merc_Handler.cc:135-370`; steps and draws in `22` §2.1): skipped on Day 1;
  posts `MERC_ABOUT_TO_LEAVE` at slot − 2 h and `BEGIN_CONTRACT_RENEWAL_SEQUENCE` at each slot (7:30, 13:30, 19:30,
  `Tactical/Merc_Hiring.h:14-16`); draws on `main` (equipment complaint time, `CheckIfMercGetsAnotherContract`, unhired
  improvement, availability) and `pre` (unhired deaths, `PreRandom(1000)`, `Campaign.cc:1157`). ja2-node: `ContractFlow`.
- **00:00 `SETUP_MINE_INCOME`**: four `HANDLE_MINE_INCOME` one-shots at 09:00 + k·3 h (`Strategic_Mines.cc:34-36`).
- **04:00 `DAILY_EARLY_MORNING_EVENTS`** (`Strategic_Event_Handler.cc:693-865`, steps in `35` §2.3), also in the very
  first warp (§4.5): NPC resets and moves with `Random` draws (Walker, Tony, Devin, Hamous, Carmen) and
  **`PreRandom(3)` → Dave has gas**. ja2-node: `src/sim/strategic/narrative/early-morning.ts`.
- **Other daily kinds** (09:00 Bobby Ray, 00:00 MERC site and insurance, 07:00 Enrico, 08:00 quests): handlers in §2.7.

### 3.5 RNG summary of the periodic layer

`main`: Queen evaluation (`17`), creature spreading (`17`), meanwhile delay, early-morning NPC moves, merc daily update
(complaints, AIM availability, unhired improvement), hourly toolkit wear, Larry, Slay, Bobby Ray. `pre`: `StatChange`
from assignments (hourly), unhired merc deaths (daily), Dave's gas (04:00), creature attack time (22:00). The clock and
queue mechanics draw nothing.

---

## 4. New game initialisation

### 4.1 Flow

Main menu → game options screen (`GameInitOptionsScreen.cc:709-730` sets gun nut, sci-fi, difficulty, save mode) →
intro → `INIT_SCREEN` → `InitNewGame()` (`JAScreens.cc:181-185`, state 4) → laptop (paused, hire mercs) → map screen
(`LeaveLapTopScreen` overrides the `INIT_SCREEN` exit, `Laptop/Laptop.cc:1345-1349`; the `screenCount == 1` branch of
`InitNewGame` is not reached in this flow, inferred) at Day 1 01:00, compression X0 → the player starts compression → the
6-hour warp and the helicopter drop (§4.5). Restarting from the main menu runs `ReStartingGame()` (`Game_Init.cc:291-354`:
delete all events, re-init overhead (`didGameJustStart = true`), profiles, laptop, world).

ja2-node: `createCampaignSession` (`src/server/campaign-factory.ts`) runs `initNewGame`, hires through the laptop and,
unless `land: false`, dispatches the first `compressTime` (`29` §6); no restart (a won campaign ends the session,
deviation "Endgame timing").

### 4.2 `InitNewGame()` (`Strategic/Game_Init.cc:200-277`), first call (`screenCount == 0`)

1. `uiMeanWhileFlags = 0`; `SetSelectedMan(0)`; reset cheat level.
2. `LoadMercProfiles()` (`Tactical/Soldier_Profile.cc:221-238`): profiles from content; `DecideActiveTerrorists()`
   (`:246-301`); `StartSomeMercsOnAssignment()` (`:485-514`).
3. `InitAllArmsDealers()` (`Tactical/Arms_Dealer_Init.cc:51-70`), `InitBobbyRayInventory()` (`Laptop/BobbyR.cc:422`).
4. Clear the tactical and map-screen message queues; `ResetGameStates()`; `InitScriptingEngine()` (only `enums.lua` ships).
5. `InitLaptopAndLaptopScreens()` (finances, history).
6. **`InitStrategicLayer()`** (§4.3).
7. `SetLaptopNewGameFlag()`; `ResetHeliSeats()`; four pre-read emails (Enrico ×3, RIS) and the IMP intro (if another IMP
   can be created) stamped `GetWorldTotalMin()` = 1500.
8. Starting cash: `AddTransactionToPlayersBook(ANONYMOUS_DEPOSIT, 0, 1500, starting_cash_<difficulty>)`: policy 45000 /
   35000 / 30000 (`game.json:58-60`).
9. M.E.R.C. online day: `d = Random(max − min + 1) + min` with policy `merc_online_min_days 1`, `_max_days 2`
   (`game.json:229-230`); `d == 0` → Speck's email now, else `AddFutureDayStrategicEvent(DAY3_ADD_EMAIL_FROM_SPECK, 420, 0,
   d)` = Day 1+d, 07:00.
10. Laptop exit screen `INIT_SCREEN` (later overridden by the map screen); pending screen `LAPTOP`; `screenCount = 1`;
    `gameStarted = true`.

ja2-node: `initNewGame` (`src/sim/campaign/new-game.ts`) runs steps 2, 3 and 5–9 in order (profiles:
`ContractFlow.loadMercProfiles`, `LaptopFlow.initNewGameProfiles` = `decideActiveTerrorists`,
`startSomeMercsOnAssignment`; `initAllArmsDealers`, Bobby Ray; step 6: `setupNewStrategicGame`, `initQuestEngine`,
`initStrategicLayerMap`, mode X0, §4.3; `addStartingCash`), then sets `didGameJustStart = true` and opens the laptop.
Steps 1, 4 and 10 have no counterpart (a session starts from a fresh `StrategicState`; no scripting engine, no screen
state machine).

### 4.3 `InitStrategicLayer()` (`Game_Init.cc:140-188`)

1. `SetupNewStrategicGame()` (`Strategic/StrategicMap.cc:2225-2266`):
   1. every `StrategicMap[]` element `fEnemyControlled = TRUE` (`InitStrategicEngine` builds the map table itself at
      program start, `:261`; see `16`);
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
   7. **`InitStrategicAI()`** (`Strategic_AI.cc:316-561`, step by step in `17` §3.3 and `17` §3.4): the first
      `EVALUATE_QUEEN_SITUATION` at absolute minute `475 + time_evaluate_in_minutes + Random(time_evaluate_variance)`
      (`:338-342`; medium 835..1014 = Day 0, 13:55–16:54, **before** the start time, also in vanilla,
      `V:Strategic/StrategicAI.c:1736-1760`; it fires at the first clock advance, §4.5); garrisons in table order, each
      with a `CHECK_ENEMY_CONTROLLED_SECTOR` periodic event every `140 − 20·difficulty + Random(4)` min from Day 1
      `7:55 + i` min (`:515`); patrols; the weapon cache sector (draws in §4.6);
   8. `InitStrategicStatus()` (zeroed, army gun "already dropped" flags).
4. `InitSquads()`, `InitVehicles()`, `InitTownLoyalty()` (`18`).
5. `InitializeMines()` (`Strategic_Mines.cc:61-159`, `18` §3.2): base rates, rejection-sampled production increments,
   the depleting mine.
6. `InitMapScreenFlags()`.
7. `InitNPCs()` (`Game_Init.cc:73-116`, `35` §2.2): per NPC placement in profile-id order (sci-fi-only ones skipped
   without sci-fi) `pickPlacementSector()` = `Random(#sectors)` (`externalized/strategic/NpcPlacementModel.cc:32-40`), the
   alternate-map flag, the placement if `placedAtStart`; Tixa's alternate map without sci-fi; Devin `bNPCData = 3`.
8. `InitializeHelicopter()`, `ClearOutVehicleList()`.
9. `InitBloodCatSectors()` (`:118-137`): `bBloodCats = −1` for sectors 0..**254** (`SectorInfo[255].bBloodCats` stays 0);
   placements and spawns by difficulty from JSON (no draws).
10. `InitializeSAMSites()`, `InitMapSecrets()`, leave lists.
11. `SetGameTimeCompressionLevel(X0)`: the screen is `INIT_SCREEN`, so no remapping: mode X0, resolution 0, speed 0.
12. `ChangeSelectedMapSector(start_sector)`; clear the battle-disable flags.

ja2-node: step 1 is `setupNewStrategicGame` (`new-game.ts`: clock, events) plus `setupNewStrategicMap` (enemy control);
steps 3–10 and 12 are `initStrategicLayerMap` (`src/sim/strategic/map/init.ts`: `initNewCampaignMap` with
`initStrategicAiForNewCampaign` (`17`), squads, vehicles, `initEconomyStrategicLayer` = town loyalty and mines (`18`), NPC
placements, helicopter, bloodcats, SAM sites, secrets, the selected sector); the facility sectors of step 3.4 come from
`data/tables/sector-facilities.json`. Step 11 is the mode reset in `initNewGame`.

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

ja2-node's clock starts unpaused (`createWorldClock`); the laptop flow stops it instead (§1.5).

### 4.5 Start date, the first squad and the first advance

Hiring at game start (`Tactical/Merc_Hiring.cc:101-160`): insertion code CHOPPER, item LETTER for soldier id 0, arrival
minute `(STARTING_TIME + FIRST_ARRIVAL_DELAY) / 60` = 1860 (Day 1 07:00), a `DELAYED_HIRING_OF_MERC` event posted at hire
time (so after all init-posted events with that stamp). The clock stands still in the laptop (paused) and on the map at
X0.

The first compression the player starts (any mode above X1) reaches `SetClockResolutionToCompressMode`, which calls
`HandleTimeCompressWithTeamJackedInAndGearedToGo()` (`Map_Screen_Interface.cc:3621-3669`), active only with mercs hired
and `didGameJustStart`: select and load the start sector (`SetCurrentWorldSector`, at 01:00, with the strategic enemies
then present; enemies in it set the PBI variables for the first battle), then `InitHelicopterEntranceByMercs()`
(`GameScreen.cc:686-698`): **`WarpGameTime(21600, PROCESS_EVENTS_NORMALLY)`**, `didGameJustStart = false`, the heli run
armed; fade into tactical; Enrico's congratulation email. On the game screen the heli run sets X1
(`GameScreen.cc:349-361`).

The warp processes, in `(stamp, seq)` order: the Queen's first evaluation (Day 0, past: draws `Random(offset·4)` and
`Random(variance)`, reposts from 01:00, does nothing else while asleep); the 00:00 dailies (`MercDailyUpdate` returns
on Day 1); `QUARTER_HOUR_UPDATE` 00:15 … with catch-up reposts; `HOURLY_UPDATE` 01:00 …; the 04:00 early-morning
events (draws, including `PreRandom(3)`); the dawn light ramp; at 07:00 `TURN_OFF_NIGHT_LIGHTS`, `ENRICO_MAIL`, the
mercs' arrivals (`MercArrivesCallback` with `didGameJustStart` still true, `StopTimeCompression`), then `HOURLY_UPDATE`
and `QUARTER_HOUR_UPDATE`. **All hourly and quarter-hour updates during the warp return early** (`didGameJustStart`), but
the 04:00 event, the light and temperature events and the Queen evaluation run. The `CHECK_ENEMY_CONTROLLED_SECTOR`
events (from 07:55) fall after the window.

ja2-node (`src/sim/campaign/hiring.ts`): `hireMerc` posts the arrival at `FIRST_ARRIVAL_MINUTE` (or the contract's
arrival, `21`) with CHOPPER insertion and the letter for soldier 0; `compressionModeSet` calls
`teamJackedInAndGearedToGo`: load the start sector (`loadStartSector`, `src/sim/campaign/sector-flow.ts`),
`warpGameTime(21600, NORMAL)`, the laptop's `firstLanding` (Enrico's email), `didGameJustStart = false`, and X1 when the
flow is tactical.

### 4.6 RNG draw order of a new game

All initialisation draws are `main`; none is a `PreRandom`. Order:

1. `DecideActiveTerrorists` (`35` §2.2): 2 × `Chance(70|50|30)`; then sweeps over the terrorist list: per unplaced
   candidate `Random(100)` (< 40 places), then `Random(#sectors)` repeated until an unused sector.
2. `StartSomeMercsOnAssignment` (`21` §2.2): per AIM/MERC profile in content order `Random(100)`, and `Random(6 + exp/2)`
   when busy.
3. Arms dealers, then Bobby Ray new and used inventories (their draw counts depend on the item tables).
4. `BuildUndergroundSectorInfoList`: per entry up to three `Random(variance)`.
5. `InitStrategicAI`: evaluation variance; per garrison (roadblock `Chance(20)`; size `Random(51)` unless
   `MAX_STRATEGIC_TEAM_SIZE` or P3; per-soldier `Random(100)` without an admin percentage; `Random(4)` for the check
   period); per patrol (`Random(3)` size, then `Random(waypoints)`); cache sector `Random(5)`.
6. `InitializeMines`: 25 (easy, medium) or 20 (hard) increments, each `Random(#mines)` repeated until a producing mine;
   the depleting mine `Random(#mines)` repeated until producing and not `noDepletion`.
7. `InitNPCs`: one `Random(#sectors)` per eligible placement.
8. `Random(merc_online_max − min + 1)`.

No initialisation expression evaluates two draws as unsequenced function arguments (checked on this path): the order
is fully defined. The first warp then adds the periodic draws of §4.5. ja2-node does not reproduce `mt19937` streams
(`01` §3.6), so this order matters for "same seed, same campaign" and for the oracle comparers that replay native draw
logs (`newgame`, `newgamefull`; `tools/oracle/README.md`).

### 4.7 Policy values used by time and initialisation

`game.json`, besides `starting_cash_*` (§4.2 step 8), `merc_online_*_days` (step 9) and
`campaign.start_sector_revealed` (§4.3 step 3.6): `campaign.start_sector` "A9" (`:265`), `game_durations_multiplier` 1.0
(`:50`; scales every `TIMECOUNTER` interval, including the 20 ms `STRATEGIC_OVERHEAD`, `Timer_Control.cc:159-163`),
`progress.event_madlab_min/mike/iggy` 35/50/70 (`:247-249`).
`strategic-ai-policy.json`: `time_evaluate_in_minutes_*` 480/360/180 and `time_evaluate_variance_*` 240/180/120
(`:56-66`), used for the first evaluation here and by `17` afterwards.

---

## 5. State owned by the time layer and savegames

Mapping to the save sections of `14` §4. Native import: `importStrategicTime` (`src/sim/strategic/time/save-import.ts`),
called by `src/server/save-session.ts`.

| Section | Field | ja2-node state | Native import |
|---|---|---|---|
| 1 Tactical status | `fDidGameJustStart`, `fHasAGameBeenStarted` | `didGameJustStart`; no `gameStarted` | decoded, not imported (stays false) |
| 1 | `uiFlags & INCOMBAT`, `fEnemyInSector` | tactical | with the tactical status (`14`) |
| 1 | `uiTimeSinceLastInTactical` (min, `GameScreen.cc:260`, `StrategicMap.cc:499`) | — | decoded, not used |
| 2 Game clock | `giTimeCompressMode` | `clock.mode` | imported |
| 2 | `gubClockResolution`, `guiGameSecondsPerRealSecond` | `clock.resolution`, `.secondsPerRealSecond` | as saved (may be stale, §2.9) |
| 2 | `gfGamePaused` | `clock.paused` | the saved value is the one **before** the save paused the game (`SaveLoadGame.cc:273-274`); the session import clears it |
| 2 | `gfTimeInterrupt` | `clock.timeInterrupt` | imported |
| 2 | `fSuperCompression` | — | dead |
| 2 | `guiGameClock`, `guiPreviousGameClock` | `clock.seconds`, `.previousSeconds` | imported |
| 2 | `ubAmbientLightLevel` | tactical base light | by the tactical import (`14` §10) |
| 2 | `guiEnvTime`, `guiEnvDay` | — | ambient bookkeeping, not ported |
| 2 | `gubEnvLightValue` | `env.lightValue` | imported |
| 2 | `guiTimeOfLastEventQuery` | `clock.lastEventQuerySeconds` | imported; read by schedules (`Scheduling.cc:217`) |
| 2 | `gfLockPauseState`, `guiLockPauseStateLastReasonId` | `clock.pauseLocked`, `.pauseLockReason` | the saved lock is the pre-save one; the reason is imported, the lock cleared |
| 2 | `gfPauseDueToPlayerGamePause` | `clock.playerPause` | imported; the pause itself is the driver (deviation "Real-time pause") |
| 2 | `gfResetAllPlayerKnowsEnemiesFlags` | `battle.resetAllPlayerKnowsEnemiesFlags` | decoded, not imported |
| 2 | `gfTimeCompressionOn` | `clock.compressionOn` | imported |
| 3 Strategic events | all | `queue.events` with `seq` = file index | imported without `EVENT_AMBIENT` and nodes pending deletion |
| 11 Strategic info | `SectorInfo.uiTimeCurrentSectorWasLastLoaded`, `uiTimeLastPlayerLiberated` | `16`, `17` | |
| 22 PreRandom | ring and index | `rng.pre` | imported |
| 24 General info | `guiBaseJA2Clock` | `realMs` | the imported tactical clock (`clockMs` = `guiBaseJA2Clock`); `driver.lastSecondMs = realMs` |
| 24 | `gubScreenCount`, `gfAtLeastOneMercWasHired` | —, `atLeastOneMercHired` | the hire flag is imported, the screen count decoded only |
| 24 | `gubDesertTemperature`, `gubGlobalTemperature` | `env.*Temperature` | decoded, not imported (cool until the next temperature event) |
| 24 | `guiEnvWeather` | — | rain is disabled in the original |
| 24 | `uiMeanWhileFlags`, `gfPersistantPBI`, `gubEnemyEncounterCode`, `gubPBSector`, `g_merc_arrive_sector` | `26`, `19`, `16` | |
| Header | day, hour, minute | derived | |

Not saved in the original (defaults after a load): the `UpdateClock` statics (a fresh process has `lastSecondMs = 0`, so
the first tactical pass after a load advances one second at once, inferred; the ja2-node import sets
`lastSecondMs = realMs`, so it does not), `lastTacticalTurnMs`, the counter deadline, `executingStamp`, `doLighting`
(`LoadGameClock` sets it for surface sectors, `Game_Clock.cc:745-746`).

ja2-node's own save stores the whole state (D7), including `seq` and `clock.driver`, so a reload continues
bit-identically.

---

## 6. Data tables and stubs

- **Ids.** Event kinds, frequencies, compression modes and warp codes are constants with the original values in
  `src/sim/strategic/time/constants.ts` (from `Strategic/Game_Event_Hook.h:6-74`, `Game_Events.h:7, 21-29`,
  `Game_Clock.h:83-93, 110-115`; `giTimeCompressSpeeds` `Game_Clock.cc:79`); the save import and the dispatch table depend
  on them. Lock reasons (`Game_Clock.h:27-47`) are constants in the modules that lock (§1.5).
- **Scalar times** stay with their users (under `src/sim/`): the daily event times (`StrategicMap.cc:122-126`) in
  `campaign/new-game.ts`; light and temperature times and levels (`Environment.cc:26-34, 100-110`, `Environment.h:8-22`)
  in `strategic/time/environment.ts`; `FIRST_ARRIVAL_MINUTE` in `campaign/hiring.ts`; `STRATEGIC_OVERHEAD_MS` and
  `RT_TURN_MS` in `tactical/turns/turns.ts`; the mine production times in `strategic/economy/mines.ts`;
  `MERC_ARRIVE_TIME_SLOTS` in `campaign/contracts/contract-times.ts`.
- **Tables.** The facility sectors of `InitKnowFacilitiesFlags` (`Campaign_Init.cc:33-66`):
  `data/tables/sector-facilities.json`, generated by `tools/transcribe/sector-facilities.ts`.
- **Distributable data** (`data/externalized/`, SFI-SCLA, in CI): `game.json`, `strategic-ai-policy.json`,
  `strategic-map-*.json` (movement costs, traversability, underground sectors, NPC placements, cache sectors, towns, SAM
  sites, secrets, creature lairs), `strategic-mines.json`, `army-*.json`, `strategic-bloodcat-*.json`. The time layer and
  the strategic initialisation read nothing else; merc profiles and sector maps come from the stub pack without the
  original data (`32` §1). Ambient `.bad` files are client-only.

---

## 7. Implementation in ja2-node

| Module | Responsibility |
|---|---|
| `src/sim/strategic/time/constants.ts` | units, `STARTING_TIME`, `FIRST_ARRIVAL_DELAY`, `CompressMode`, `COMPRESS_SPEEDS`, `Warp`, `Frequency`, `EventKind` |
| `src/sim/strategic/time/world-clock.ts` | `WorldClock` state, helpers, compression, pause, lock and interrupt functions, `updateClock`, `advanceClock`, `warpGameTime`; the `ClockContext` hooks are how the clock reaches the campaign |
| `src/sim/strategic/time/event-queue.ts` | `StrategicEvent`, `EventQueue`, the `add*` variants with the guard, deletes, `processPendingGameEvents` with the three warp codes |
| `src/sim/strategic/time/dispatch.ts` | `EventDispatch`: subsystems register handlers per kind, which breaks the original's include cycles (`01` §3.7) |
| `src/sim/strategic/time/environment.ts` | light and temperature schedule, handlers, `timeOfDayAmbientLightLevel` |
| `src/sim/strategic/time/save-import.ts` | `importStrategicTime` (§5) |
| `src/sim/campaign/campaign-sim.ts` | `CampaignSim`: `StrategicState`, the loaded `TacticalSim`, the `ClockContext`, the tick order (§1.8), environment and movement handlers, the default refusal and the automatic pause, `compressTime`/`stopTime` |
| `src/sim/campaign/new-game.ts` | `initNewGame`, `setupNewStrategicGame` (§4.2, §4.3) |
| `src/sim/campaign/hiring.ts` | game-start hiring, `mercArrives`, `teamJackedInAndGearedToGo` (§4.5) |
| `src/sim/campaign/screens.ts` | the map/tactical switch with its compression rules (§1.2) |
| `src/sim/strategic/economy/update.ts` | hourly and quarter-hour updates, mine income and the other economy events (§3) |
| `src/sim/advance.ts` | `advance` with world-time stop conditions (`29`) |

**Verification.** Unit tests beside the modules (`world-clock.test.ts`, `event-queue.test.ts`, `save-import.test.ts`,
`new-game.test.ts`, `strategic-advance.test.ts`); the oracle's `warp` probe (`WarpGameTime` with every event, economy
handlers compared) and the `newgame`/`newgamefull` draw-log replays (`tools/oracle/README.md`).

**Limitations:**

- No strategic turn on the map, and real-time turns only for soldiers placed in the loaded sector (§1.7).
- `ClearTacticalStuffDueToTimeCompression` is not ported (§1.2).
- `HourlyCamouflageUpdate` and `UpdateRegenCounters` are not wired (§3.2).
- The native import leaves `didGameJustStart`, the temperatures and the enemy-knowledge reset at their defaults (§5).

---

## 8. Quirks and deviations

**Quirks to keep**, stated in their sections: the Day-0 first Queen evaluation (§4.3); past events run without moving
the clock, reposts from the event's own stamp (catch-up, §2.5); `AddPeriodStrategicEvent` anchored at midnight (§2.3);
the silent posting guard (§2.3); FIFO ties and the resulting daily order (§3.1); 60 s compression slices, the slice
`StopTimeCompression` finishes and the event `InterruptTime` stops at (§1.3, §2.9); the `UpdateClock` drift and the +1 s
after combat (§1.3, §1.7); the 5020 ms real-time turn and the compression-dependent map turn rate (not implemented,
§1.7); healing reads `IsTimeBeingCompressed()` (§1.9); hourly and quarter-hour updates suppressed until the first
landing, `MercDailyUpdate` skipping Day 1 (§4.5); `envLightValue` 0 in a fresh process, 5 at the landing (§1.10);
`TARGET_TIME_FIRST` order (§2.5); `NO_PROCESSING` warps leaving events in the past (§1.4); the single pause lock (§1.5);
the stale `secondsPerRealSecond` (§2.9); the END node's offset 0 and the repost despite deletion (§2.4, §2.5); no sight
checks on a light change (§1.10); `InitBloodCatSectors` stopping at 254 (§4.3); `UpdateAssignments` x-outer (§3.2).
Only here:

- `HandleTacticalEndTurn` rots corpses on every turn: `uiTimeSinceLastStrategicUpdate − now > 1200` is a wrapped u32
  comparison, true whenever `now` differs from the last value (`Tactical_Turns.cc:86-90`); corpse rotting is not ported
  (gap "Corpses").
- `MercArrivesCallback`'s equipment complaint uses `540 + Random(660)` (comment says 9–10 am).

**Deviations** in `deviations.md`: "Ambient sound events", "Real-time pause", "Time compression checks", "Time
compression for healing", "Ambient light and light schedule", "World clock for smoke and light", "Real-time turn after
combat", "Brothel time warp". **Gaps** in `gaps.md`: "Auto-bandage", "Corpses", "Absent mercs between hourly updates".
Deviations not listed there yet:

| Area | Original | ja2-node | Why |
|---|---|---|---|
| Strategic map pacing | Slices follow the wall clock and the frame rate (144 Hz loop) | A virtual 5 ms tick drives `updateClock` exactly ("ideal machine", §1.3) | Determinism (`04` §3) |
| Fades | The clock does not run during screen fades | No fades in the simulation; transitions take no time | No presentation in the sim |
| Prompt time | Some locks pause only the world clock while tactical animation runs underneath (conversation, item pickup, heli entry) | Every decision prompt stops the whole simulation | D15 (`01` §3.8) |
| Script hooks | `OnStrategicEvent`, `OnCheckQuests` Lua observers | Not ported | No mods |
| Dead code | `TIME_SUPER_COMPRESS`, `SetGameHours/MinutesPerSecond`, rain events, `MINUTE_UPDATE`, `BEGIN_AIR_RAID` | Not ported; imported events of those kinds are no-ops | Same behaviour |

---

## 9. Unverified

- The slice tick positions on a 5 ms loop (§1.3): computed from the integer formulas and unit-tested on the port, not run
  on the native build (no clock-trace probe).
- The map strategic-turn rates per world minute (§1.7): derived from the counter and `check`; the original's real rate is
  frame-rate dependent (~20.8 ms at 144 Hz).
- The steady-state tie order of §3.1: derived from the FIFO rule and the posting times.
- That immediate deletion is equivalent to the deferred flag (§2.4), and the catch-up example of §2.3.
- That a fresh process loading a save advances one world second on the first tactical pass (§5).
- ja2-node, from reading the code (not run): `tacticalScreen` back into the loaded sector sets `realMs` to the frozen
  `TacticalState.clockMs`, which is behind the map's `clock.driver.lastSecondMs`; `updateClock` then advances no world
  second until the tactical clock passes it, so the world clock may stand still in tactical for as long as the map ran.

# 15 — Strategic time: the clock, the event queue and a new game

The world clock from a 5 ms tick to world seconds: real time and compression, pauses and locks, the strategic event
queue and the order it runs in, the standing hourly and daily events, light and temperature by time of day, a new
campaign up to the first landing, and the clock in a native save. Siblings: `04` the tick model, drivers and `advance`;
`16` travel and the traversal warp; `17` the Queen's evaluation and garrison checks; `18` the hourly update's work;
`21` and `22` hiring, contracts and the daily merc update; `26` meanwhiles; `10` turn-based combat; `14` and `27`
savegames; `29` `compressTime`, `stopTime` and the clock events. Each module's `@src` header names the Stracciatella
functions it ports; read those for the formulas.

## 1. Where things live

Paths are under `src/sim/`; `time/` is `strategic/time/`.

```
CampaignSim.step: one 5 ms tick                           campaign/campaign-sim.ts
  tactical flow: light change, the loaded sector's pass;  tactical/tactical-sim.ts, tactical/turns/turns.ts
    realMs = the sector's clockMs
  strategic flow: realMs += 5, dialogue, automatic pause
  updateClock(realMs)                                     time/world-clock.ts
    └ advanceClock → processPendingGameEvents             time/event-queue.ts
       └ EventDispatch.execute → the kind's handler       time/dispatch.ts
  hand-offs: meanwhile, endgame, helicopter, PBI,
  contracts; then the compression and day events
compressTime, stopTime                                    campaign-sim.ts → time/world-clock.ts
mapScreen, tacticalScreen, back to the loaded sector      campaign/screens.ts
new game                                                  campaign/new-game.ts
first compression → the six-hour warp to the landing      campaign/hiring.ts
native save                                               time/save-import.ts, src/server/save-session.ts
```

| Module | Holds |
|---|---|
| `time/constants.ts` | Units, the start time, compression modes and speeds, warp codes, frequencies, the event kinds with their original ids |
| `time/world-clock.ts` | `WorldClock`, the day and hour helpers, compression, pause, lock and interrupt, `updateClock`, `advanceClock`, `warpGameTime`; `ClockContext` is how the clock reaches the campaign |
| `time/event-queue.ts` | `StrategicEvent`, `EventQueue`, the `add*` variants, deletion, `processPendingGameEvents` |
| `time/dispatch.ts`, `time/environment.ts` | `EventDispatch`, one handler per kind; the light and temperature schedule |
| `campaign/campaign-sim.ts` | The tick order, the `ClockContext`, the default compression refusal and the automatic pause, the light, temperature, light-sprite and movement handlers |
| `campaign/new-game.ts`, `campaign/hiring.ts` | New-game initialisation; hiring at game start and the first landing |
| `strategic/economy/update.ts` | The hourly and quarter-hour updates in the original's order; `PeriodicSlots` take the steps other systems own |

The subsystem that owns a kind registers its handler (search `register(EventKind.`): the campaign (light, temperature,
light sprites, group arrivals, Bobby Ray's and the dealers' daily stock), the economy, the Queen (evaluation, garrison
checks, meanwhiles), creatures, contracts, the laptop, the narrative, the NPC port and the helicopter. A later
`register` replaces an earlier one: with a laptop, the laptop flow handles merc arrivals and Enrico's mail.
Registration by kind breaks the original's include cycles (`01` §3.7).

## 2. Design

**Two clocks.** World seconds (`clock.seconds`, the original's `guiGameClock`) carry every strategic time.
`StrategicState.realMs` stands for the original's wall-clock milliseconds (`guiBaseJA2Clock`) as a counter a tick
advances by 5 ms (D3): in tactical it is the loaded sector's `clockMs`, on the map the campaign advances it, and the
`autoresolve` and `laptop` flows leave it standing like the original's other screens. The map never steps the loaded
sector (the original runs no `ExecuteOverhead` there), so the sector's clock waits. A sector load starts that clock at
`realMs`; going back to a sector still loaded hands `realMs` to its clock and re-phases the clock's second, as the
original's screen change does (`returnToLoadedSector`).

**`UpdateClock` on an ideal machine.** `updateClock` is the original's function fed with `realMs`, so the pace follows
the tick, not the frame rate (deviation "Strategic map pacing"): a world second per 200 ticks in tactical; while
compressing, 60-second slices, 5, 30 or 60 per real second (every 40, 6–7 or 3–4 ticks). A world day costs 57,600 ticks
at 5 minutes per second and 4,800 at 60. A pause or another screen re-phases the second; turn-based combat does not, so
the first pass after combat adds a second at once.

**What stops the clock.** Turn-based combat (world time stands, ticks run), a pause, X0 or stopped compression, and the
`autoresolve` and `laptop` flows. A pause lock forbids unpausing and compressing, not pausing, and it is one flag: any
unlock lifts it, whoever locked. Subsystems lock with the original's reason ids, which a native save carries. The
original's `PauseTime` under message boxes has no counterpart: an open decision prompt stops the whole simulation (D15,
deviation "Prompt time").

**Compression is state that commands change.** `compressTime {mode?}` and `stopTime` are the map's buttons; `mapScreen`
and `tacticalScreen` apply the original's rules (entering the map keeps a 5–60 minute mode but stops it, anything else
becomes X0; tactical is always X1). Every stop carries a reason (`CompressionStop`) that the `compressionStopped` event
reports. The automatic pause pauses a compression that is no longer allowed and resumes it once it is, so a refusal that
comes and goes stops time without stopping compression. The refusal checks game states only (deviation "Time
compression checks"). Under the instant driver `compressTime` compresses until something stops or pauses it; an
`advance` to a world time stops compression at the first slice end at or past the target, at most 59 seconds over.

**The queue keeps the original's order.** The original's linked list is an array sorted by stamp, ties in posting order
(`seq`, assigned at every insertion, reposts included; a native import assigns it in file order). Every kind keeps its
original id, frequency and reposting, so the queue equals a native save's in content and order, and a kind without a
handler still reposts. A repost is stamped from the event's own stamp, not from now, so events left in the past catch up
once per period. Deletion is immediate where the original flags the node and unlinks it after the pass; the executing
event leaves the queue before its callback. The pass walks with a `(stamp, seq)` cursor instead of restarting at the
head; since no callback can post at or before its own stamp, it visits the events in the same order.

**Three warps.** `Warp.NORMAL` runs every event in the window at its stamp (`updateClock`, the first landing).
`NO_PROCESSING` jumps and leaves the skipped events in the past for the next advance (autoresolve's battle time, the PBI
retreat, the last group leaving a hostile sector, the brothel). `TARGET_TIME_FIRST` runs only the last event stamped
exactly at the target, ahead of everything already due (the adjacent-sector traversal, `16`).

**Order inside a tick.** The screen work comes first (the tactical pass, or the map's dialogue and automatic pause),
then `updateClock`: at most one advance, its events in queue order, each with the clock at its stamp. What an event
changes (a stopped compression, a pause, a PBI, a light value) reaches the screen work of the next tick; the hand-offs
the original's screens make on the next frame (a meanwhile start, the PBI, contract settlement) run at the end of the
same tick.

**Order across modules.** Ties at the standing times follow the posting order: the dailies posted at new game come
first (each reposted at its previous firing), then one-shots posted at 00:00, then the hourly update (reposted an hour
earlier), then the quarter-hour one. So at midnight the merc daily update, insurance, the M.E.R.C. site and the mine
setup run before the hourly update, and the mine income, posted at 00:00, runs before it at 09, 12, 15 and 18:00. A
native save keeps the order it carries. `handleHourlyUpdate` calls its steps in the original's order, those other
systems own through `PeriodicSlots` (`18`).

**Time of day.** Light and temperature are everyday events posted at new game (`buildDayLightLevels`): the dawn and dusk
ramps, the desert and global temperatures, the night and prime-time light sprites. A hot surface sector (desert 09–17,
the others 12–14) gets ambient light 2 instead of the ramp's value. A change reaches the loaded sector before its next
pass, as `EnvironmentController` does, and makes nobody look: the original's `AllTeamsLookForAll` there is commented
out.

**Compression in other rules.** Natural healing asks whether time is compressed; ja2-node asks whether the flow is
strategic (deviation "Time compression for healing"). The original's map runs a real-time turn every 20 ms while
compressing, so bleeding per world minute depends on the compression level; ja2-node runs real-time turns only in the
loaded sector (gap "Absent mercs between hourly updates").

**A new game.** `initNewGame` follows `InitNewGame` and `InitStrategicLayer` in order, without the screen state machine,
the scripting engine and the message queues. Every draw is on `main` and the call order is the draw order: the same seed
gives the same campaign, and the oracle's `newgame` and `newgamefull` replays compare it with native draw logs. The
clock starts on Day 1 at 01:00 at X0; mercs hired at the start arrive at 07:00. The first compression loads the start
sector at 01:00 and warps six hours with events (`teamJackedInAndGearedToGo`): the Queen's first evaluation, stamped on
Day 0, the 00:00 dailies (the merc daily update returns on Day 1), the 04:00 early-morning events with their draws, the
dawn ramp and the arrivals all run in it, while the hourly and quarter-hour updates return: the warp clears
`didGameJustStart` only at its end.

**Native saves.** `importStrategicTime` takes the clock, the light value, the hire flag and the queue, without ambient
events and nodes pending deletion. The session import clears the pause and its lock, which the save records as they
were before saving paused the game, and re-phases the second at the imported `realMs`. Not imported: `didGameJustStart`,
the temperatures (cool until the next temperature event) and the enemy-knowledge reset. ja2-node's own snapshot keeps
everything, `seq` and the clock driver included, so a reload continues exactly (D7).

**The player view never shows the queue** (D16), only times the original shows: the own groups' arrivals, merc
arrivals, contract ends and the mine-income hours.

**Randomness.** The clock and the queue draw nothing; handlers draw in queue order, so the queue's order is the draw
order (`01` §3.6).

## 3. Quirks of the original the code keeps

Each looks like a bug and is the original's behaviour. Pinned by tests:

| Quirk | Test |
|---|---|
| Events with equal stamps run in posting order, and a repost goes after them | `time/event-queue.test.ts` |
| A periodic event is anchored at midnight, not at the time it is posted: posted mid-day, it first catches up | `time/event-queue.test.ts` |
| An event left in the past runs without moving the clock back, and its reposts fire once per missed period | `time/event-queue.test.ts` |
| A callback's post at or before its own stamp is dropped without a word | `time/event-queue.test.ts` |
| A callback that deletes its own kind still gets its repost | `time/event-queue.test.ts` |
| `InterruptTime` ends the pass after the current event: the clock stays at its stamp and equal-stamp successors wait | `time/event-queue.test.ts` |
| The target-first warp runs only the last event at the target second, ahead of everything already due | `time/event-queue.test.ts` |
| An event that stops compression still lets its 60-second slice run to the end | `time/world-clock.test.ts` |
| The clock stands in turn-based combat and adds a second at once after it | `time/world-clock.test.ts` |
| One pause lock for every reason: any unlock lifts it | `time/world-clock.test.ts` |
| The Queen's first evaluation is stamped on Day 0, before the campaign starts | `strategic/ai/init.test.ts` |
| No hourly or quarter-hour update does anything in the warp to the first landing | `campaign/new-game.test.ts` |
| The real-time turn comes every 5020 ms, on the 20 ms counter | `tactical/turns/realtime-turns.test.ts` |
| `InitBloodCatSectors` stops at sector 254 | `strategic/map/init.test.ts` |

Not pinned yet:
- `WarpGameTime` restores the old `secondsPerRealSecond` after a callback stopped compression: a stopped clock keeps its
  speed at resolution 0, and a native save shows it.
- `MercArrivesCallback` posts the equipment complaint `540 + Random(660)` minutes after midnight, though its comment
  says 9–10 am (`contracts/hire-contract.ts`).
- `HandleTacticalEndTurn` rots corpses at every real-time turn: its unsigned comparison of the last update is true
  whenever the time changed (`Tactical/Tactical_Turns.cc:86-90`); rotting is not ported (gap "Corpses").

## 4. Not checked against the native build

The oracle's `warp` probe runs `WarpGameTime` over every event and compares the economy handlers; `newgame` and
`newgamefull` replay the native draw logs of a new game (`tools/oracle/README.md`). Inferred from reading the source:
- The slice positions on a 5 ms loop: computed from the integer formulas and unit-tested, not traced natively.
- The tie order of the standing schedule: derived from the posting order.
- That immediate deletion matches the deferred flag, and the catch-up of a periodic event posted mid-day.

Not ported: gaps "Compression cleanup", "Absent mercs between hourly updates", "Camouflage decay", "Regeneration
counters", "Auto-bandage", "Corpses". Other deviations of this domain: "Ambient sound events", "Ambient light and light
schedule", "Real-time pause", "Time compression checks", "Time compression for healing", "World clock for smoke and
light", "Real-time turn after combat", "Brothel time warp", "Strategic map pacing", "Clock during fades", "Prompt time".

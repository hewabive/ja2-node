# Deliberate deviations from the original

Every place where ja2-node knowingly behaves differently from JA2 Stracciatella (the behaviour
reference, see `01-architecture.md` D1). Add an entry whenever a port departs from the source.

| Area | Original | ja2-node | Why |
|---|---|---|---|
| Random numbers | `mt19937` + `uniform_int_distribution`; `Random` and `PreRandom` share one engine with cosmetic code | xoshiro128**, multiply-shift range mapping, separate `pre`, `main` and cosmetic streams | Determinism and save/replay; outcomes keep the original semantics (`01` §3.6) |
| Timing | Wall-clock timers that never catch up; frame-rate dependent bullets, burst cadence and real-time AI slice | Fixed 5 ms ticks; bullets advance N tiles per tick; a fixed number of real-time AI soldiers per pass | Outcomes independent of FPS and CPU (`04` §3) |
| Speech | Quote duration is the audio length (speech on) or 60 ms per character | Always 60 ms per character in the simulation | The simulation must not depend on audio (`04` §3) |
| Watchdogs | 15 s AI deadlock breaker, 25 s UI busy breaker | Not ported | A hang is a bug and must fail tests |
| Real-time pause | Pause masks the screen; no orders while paused | Orders may be issued while paused (manual driver) | Agent API (`04` §4.3) |
| Map files | 178 of 261 maps carry trailing bytes after the last section | Ignored and reported as `trailingBytes` | Same as the original loader, which stops reading after the schedules |
| Pathfinder RNG | `FindBestPath` draws `Random(4)` for every skip-list node it inserts | No draws; the open list is a heap with the same pop order | Path choice never depended on the draws (`07` §3.2) |
| Frame timers | `TIMECOUNTERDONE` against the wall clock, polled every 5 ms | Absolute game-ms deadlines checked on 5 ms ticks, same reset points | Same frame cadence without wall-clock jitter (`03` §7) |
| Sandbox population | Garrison size and stats from strategic state, `CalcDifficultyModifier`, `SortSoldierInitList` order, `GenerateRandomEquipment` | Fixed garrison of 4 ARMY troops, difficulty modifier 30, placement groups in map order, no equipment | Temporary for the M2 sandbox; replaced when the strategic layer exists (M4) |
| Breath regeneration | Real-time breath recovers every 5 s turn (`HandleTacticalEndTurn`) | Breath is spent per step but does not recover yet | Temporary, M2; ported with the real-time turn |
| Doors | `DOOR_BUSY` blocks a door while its tile animation plays; the player's perceived door state may lag; door shadows animate | No busy window; the perceived state equals the real one; door shadow tiles keep their map graphic | Temporary; the door opening, passing and closing behind follow the original |
| Waiting sweet spot | `FindGridNoFromSweetSpotThroughPeople` ranks by cell-coordinate distance after a reachability flood | Plain Pythagorean ranking over occupied-or-free tiles without the flood | Temporary; only used when a blocked final destination must be replaced |
| Soldier frame on turning | `usAniFrame` keeps the old direction block until the next frame code | The client derives the sprite from (script frame, current direction), so a new facing shows at once | At most one frame of visual difference (`06` §1.3) |
| Enemy glow | Enemies pulse red every 3 s and jump to the top z at the peak; unseen ones are drawn grey | Not drawn yet; soldiers use the normal shade | Cosmetic; later with the UI |

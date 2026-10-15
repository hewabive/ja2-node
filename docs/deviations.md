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

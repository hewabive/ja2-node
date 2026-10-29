# Test stability

Tests that fail without a code change, and how to deal with them. A test that passes alone must never fail on load or
in another order: such a failure is a bug, in the test or in the product, and gets an entry below. Limits, the shared
stub pack, goldens and gates: `32` §2.6.

## 1. Rules

- **Record every unexplained failure** in §2 when it happens, before rerunning past it: the test, the error text, the
  date, the run (gate, local or CI, workers, what else ran on the machine) and the commit.
- **Reproduce before fixing.** Run the test alone and on the merge base; then under load: more Playwright workers
  (`--workers=6`, locally 3 by default), several unit runs at once, `--repeat-each`. A failure that only shows under
  load is still a race.
- **Fix the cause, not the symptom.** No retries, no per-test limits (one limit per runner, `32` §2.6), no sleeps. Find
  what the test waits for and make the product or the test say when it is ready.
- **Close an entry** with the commit that removes the cause; drop it from §2. An entry seen once and not reproduced
  stays until a later run shows it again or the suspected cause is ruled out.

## 2. Open cases

| Test | Symptom | Seen | Suspected cause | Next step |
|---|---|---|---|---|
| `tests/e2e/give.spec.ts` "an MCP agent gives the stub NPC a magazine he keeps and a pistol he hands back" | `no session sandbox-6` from the first call after `newSession` | 2026-10-29, `pnpm gates` e2e (3 workers) at `ecaecf7`; passed on the rerun | Session ids are reused: `newSession` names a session `sandbox-<open sessions + pending>` (`src/server/session-registry.ts`), so after a close a new session can take an id another client still holds; the laptop specs close their page's session by id (`DELETE /api/sessions/:id`) in `afterEach` | Give ids that are never reused; check whether a laptop page can hold the id of a session that already closed |
| `tests/e2e/story.spec.ts`, the meanwhile box golden | The map screen's Tactical button drawn hatched | 2026-10-28 under parallel load; again 2026-10-29 at `5dc1a65` (`pnpm gates` e2e while three agents ran), ten pixels of row 20 off by 39 | The message box freezes the map frame at its opening; in that frame the `canEnterSector` hint said not allowed while the laptop button was enabled; four frames later the hint answers allowed with nothing pending | Not removed by `3100a94` (strategic hints answered locally at once): it recurred after it. Reproduce under load and compare the frame the box freezes with the hint state at that frame |
| `tests/e2e/talk-panel.spec.ts` "recruits the stub R.P.C. with Recruit and the hire box, then withdraws money through the money region" | `page.waitForFunction` for the widget `talkDone` until the 15-minute test limit | 2026-10-29, `pnpm gates` e2e (3 workers) at `165b832` while two agents ran `pnpm check`; e2e took 29 minutes instead of 4 | The test reads `talk.open` and then waits for the Done button; a panel that closes on its own between the two (the recruit's lines end) leaves it waiting for a widget that never comes back | Wait for either the Done button or the panel closing, then click Done only if it is there |
| `tests/e2e/video.spec.ts` "the stub splash plays in the browser, Escape ends it, missing videos are skipped and the credits scroll" | `framesDecoded` 29, expected 30 (`STUB_SPLASH_FRAMES`) | Same run as above | Unknown: under load the player may end the video by its clock before the last frame is decoded | Reproduce with a throttled CPU; decide whether the last frame must always be decoded |
| `src/server/session-host-contract.test.ts` (whole file) | V8 `Fatal error … Check failed: jit_page.has_value()`, then `Worker exited unexpectedly with signal SIGTRAP during started state`; every test of the run passed | 2026-10-29, local `pnpm check` at `ee224cd` (default workers) on the machine shared with two other agents; the file passed alone right after | A native V8 crash of the worker (JIT page allocation), likely under memory pressure, not an assertion | Run the file under parallel load (several unit runs at once) and look for a native crash or an out-of-memory kill |

| `src/app/world/world-effects.test.ts` "draws the static smoke graphic, opaque, when smoke is not animated" | `expected [] to deeply equal [ 'staticSmoke' ]` | 2026-10-29, local `pnpm check` at `d6fe428` (default workers) on the machine shared with two other agents; the file passed alone right after | The test waits for the smoke picture with a 50 ms `setTimeout` (`settle`) instead of the load; under load the read takes longer, so the second `build` still finds no picture | Await `effects.loaded()`, which settles the picture caches, instead of the timer |

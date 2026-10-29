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
| `tests/e2e/story.spec.ts`, the meanwhile box golden | The map screen's Tactical button drawn hatched | 2026-10-28, under parallel load | The message box freezes the map frame at its opening; in that frame the `canEnterSector` hint said not allowed while the laptop button was enabled; four frames later the hint answers allowed with nothing pending | Likely removed by `3100a94` (strategic hints answered locally at once); drop the entry if the golden stays stable |

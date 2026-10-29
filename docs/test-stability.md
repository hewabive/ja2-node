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
| `src/server/session-host-contract.test.ts` (whole file) | V8 `Fatal error … Check failed: jit_page.has_value()`, then `Worker exited unexpectedly with signal SIGTRAP during started state`; every test of the run passed | 2026-10-29, local `pnpm check` at `ee224cd` (default workers) on the machine shared with two other agents; the file passed alone right after | A native V8 assertion in its JIT page bookkeeping (Node v24.22.0, V8 13.6.233.17), not a test assertion; seen only during a whole `pnpm check` on a loaded machine. Four parallel runs of the file alone on 2026-10-29 did not reproduce it | If it recurs, keep the vitest output, run with `NODE_OPTIONS=--abort-on-uncaught-exception` to get a core dump, and report it to Node with the V8 version; nothing in ja2-node's code can trip this check |
| `tests/e2e-data/main-flow.spec.ts` (the main flow on the original data) | `flow.win()` returned `stuck` instead of `won` after the aimed shot (1.5 min into the test); the page was left on our turn with the UI locked (`LOCKOURTURN_UI_MODE`, top message `playerInterrupt`); the bot's stuck reason is not printed, the flow's `Player` gets a no-op log | 2026-10-29, `pnpm gates` e2e:data (1 worker) at `bb828a6`, after the other gates of the same run, on the machine shared with other agents; the gate passed on the rerun with no change | The landing battle on seed 1414 played by the bot depends on timing between the browser's turn lock and the API (an interrupt in our favour while the page still locks the turn?); unverified. The commits under test change only melee orders and the rocket rifle, which the bot does not use | If it recurs, give the flow's `Player` a log the test prints on failure, to get the stuck reason, and rerun on the merge base |

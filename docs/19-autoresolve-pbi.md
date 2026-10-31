# 19 — Before and after a battle: pre-battle interface, autoresolve, sector control

From an encounter to the end of its strategic consequences: the pre-battle interface (PBI) and its encounter code,
autoresolve (AR), retreat, sector control, and what a battle does to mercs, militia and the enemy's strategic records.
Siblings: `16` when an arrival becomes an encounter, the retreat trip and sector loading; `17` enemy counts, garrisons
and the Queen's reaction to deaths; `18` militia, loyalty and doctoring; `10` the tactical end of a battle; `33` and
`11` the damage rules AR reuses; `26` the capture quests; `29` the agent API (prompts, `autoresolveRetreat`, the AR
events); `30` the PBI panel and the AR screen. Each module's `@src` header names the Stracciatella functions it ports;
read those for the formulas.

## 1. The path of a battle

Paths are under `src/sim/`.

```
encounter, creature attack, militia hand-off       forces/encounters.ts, campaign/creature-flow.ts, sector-flow.ts
  └ BattleFlow.settle opens the preBattle prompt    campaign/battle-flow.ts
     initPreBattleInterface: code, options          forces/pre-battle.ts
     ├ enterSector → setCurrentWorldSector          campaign/sector-flow.ts
     ├ retreat → retreatAllInvolvedPlayerGroups, +5 min; militia left → autoresolve without mercs
     └ autoresolve
        buildAutoresolveInput, associateWithStrategicGroups  campaign/autoresolve-strategic.ts
        createAutoresolveState, enterAutoresolve: ratings    autoresolve/state.ts, setup.ts, ratings.ts
        stepAutoresolve: a 1000 ms slice per 200 ticks       autoresolve/loop.ts → attack.ts, landing.ts, end.ts
        battle over: time, morale, loyalty, control          autoresolve/outcome.ts, BattleFlow #endBattle
        bandage (optional)                                   autoresolve/bandage.ts
        done: deaths, captures, militia, enemies, warp       autoresolve/close.ts, campaign/merc-fate.ts, sector-loot.ts
tactical battle ends → SectorHooks → BattleFlow     tactical/state.ts, campaign/battle-flow.ts
every change of sector control                      strategic/map/control.ts
```

`forces/` is `strategic/forces/`, `autoresolve/` is `strategic/forces/autoresolve/`.

| Module | Holds |
|---|---|
| `forces/pre-battle.ts` | Who is involved, the encounter code and the random ambush, the options and their disabled reasons, squads and retreat of the involved groups |
| `forces/battle-state.ts`, `flow-state.ts` | The saved PBI and AR globals: `StrategicState.battle` (prompt, AR session, locator, post-AR globals) and `.encounter` (codes, ambush and retreat flags, the hand-off from `16`) |
| `autoresolve/state.ts` | `AutoresolveState`, cells, flags, statuses, `ArEvent`, `AutoresolveEnv`, `combatContext`, the robot controller |
| `autoresolve/setup.ts`, `ratings.ts` | Militia rank fill, the enemy cells' strategic groups; leadership, ratings and first timers |
| `autoresolve/loop.ts`, `attack.ts`, `landing.ts` | Slices and picks; target choice, shots and melee; bullets landing, kills and assists |
| `autoresolve/end.ts` | Retreat orders, the end of the battle, capture and surrender |
| `autoresolve/outcome.ts`, `bandage.ts`, `close.ts` | Battle time, bandaging after a victory, the close against an `AutoresolveClosePort` |
| `autoresolve/replay-rng.ts` | `ReplayStream` and `ScriptedStream` for tests and the oracle |
| `campaign/autoresolve-strategic.ts` | The cells from the strategic state (soldier creation through `tactical/creation-basic.ts`, tactical copies), `eliminateAllEnemies`, `strategicClosePort` |
| `campaign/battle-flow.ts` | `BattleFlow`: the prompts and their answers, AR as a flow, the strategic side of a tactical battle's end |
| `campaign/merc-fate.ts` | Merc death (`strategicHandlePlayerTeamMercDeath`) and capture (`enemyCapturesPlayerSoldier`, the capture sequence) |
| `campaign/pre-battle-panel.ts`, `tactical/health.ts` | The panel data; merc condition and the health category of other cells |
| `server/battle-view.ts` | The prompt and AR projection of `29`, without ratings, timers, pending bullets or the enemies' exact life |

## 2. Design

**AR is a function of state, streams and commands.** The original sizes its slices from the wall clock and the speed
button, so Play and Fast depend on the frame rate and on when a click lands. ja2-node always runs the 1000 ms slices of
Finish, its only deterministic mode; Pause, Play, Fast and Finish only pace the playback, retreat orders queue and apply
between slices, and a surrender offer stops the battle until answered (deviations "Autoresolve slices", "Autoresolve
pace"). The same seed and commands give the same AR log.

**Finish without sound.** Finish clears `fSound`, which gates the battle sounds and the splat `PreRandom(3)`, so the
original's `pre` sequence depends on when the player pressed it. ja2-node runs as if Finish were pressed before the
first slice: no battle sound or splat draw, the sound picks and the stat-change quote on the cosmetic stream
(`cosmeticOnMain` routes them to `main` for the oracle replay). For `pre` this is exactly a native Finish run
(deviation "Autoresolve cosmetic draws").

**No world time inside.** The clock stands still under every battle prompt and while AR runs (deviations "Pre-battle
interface", "Autoresolve session"). AR's own clock becomes world time when it closes, in one warp without event
processing: the battle time ×3, then +5 min for a retreat and 200 ms per kit point bandaged (Q27). A retreating group's
arrival is set before that warp and before the PBI retreat's 300 s warp, so part of the trip is already spent (Q26).

**One set of damage rules.** AR calls the tactical `bulletImpact`, `hthImpact` and `statChange` through `CombatContext`
(`combatContext` builds one per call) and reloads with the tactical `autoReload`. `AUTORESOLVE_IMPACT` drops criticals
and specials and sets `close: true`: every AR soldier is off the map, where the original's two `NOWHERE` (25601) put
attacker and target at distance 0, and ja2-node's `NOWHERE` is −1 (deviation "Autoresolve instant kills").

**Cells and soldiers.** `AutoresolveState` is plain data; cells refer to each other as `CellRef {side, index}`. Merc
cells hold the roster's soldiers, which AR changes in place (life, bleeding, ammo, armour, profile counters). Militia,
enemy and creature soldiers are created for the battle (id 255, on no team) and live in their cells. An AR of a battle
already loaded in tactical (the militia hand-off, the summary panel's Autoresolve) copies the live tactical enemies per
class and unloads the sector; copies that run out are created fresh where the original crashes (deviation
"Autoresolve copies of tactical enemies"). At most 20 mercs, 20 militia and 32 enemies; a victory eliminates the enemies
beyond 32 (deviation "Autoresolve cell counts").

**Injected environment.** Every AR function takes an `AutoresolveEnv`: content, profiles, `ArRng {pre, main, fx}`, the
world day and capture flag, and hooks for surrender, capture, kills, the robot and the retreat. Tests and the oracle
feed scripted or replayed streams through it.

**When the strategic layer learns.** Morale, loyalty and control run when the battle ends (`BattleFlow` `#endBattle`;
`endOfBattle` only applies the time factors). Deaths, captures, militia losses and promotions, enemy deaths, corpses and
drops run when the player closes AR (`closeAutoresolve` against `strategicClosePort`). Each enemy cell's strategic group
(Q16) decides which record loses a dead soldier. Every change of control goes through `setThisSectorAsPlayerControlled`
or `setThisSectorAsEnemyControlled`; their town, mine, SAM, meanwhile and theft effects go through the context's `world`
hooks, the Queen's through `ctx.ai`. A lost or abandoned AR hands the sector to the enemy at `done`, where the original
waits for the next map frame; the hand-over is refused while an automatic AR is pending (`battle.autoStart`).

**The PBI is a prompt.** It opens at the end of the step that made the hand-off, without the speaking merc's quote time,
and carries the encounter, the options with their disabled reasons and the panel. The persistent PBI comes before a
battle; the non-persistent one summarises a running tactical battle (`showBattle`, `autoresolveBattle`). There is no
placement screen: entering keeps the automatic edgepoints (deviation "Tactical placement").

**Tactical battles report through hooks.** Merc deaths, pending enemies, the militia hand-off, a lost battle (2–3 downed
mercs captured, otherwise killed) and the end of a battle reach `BattleFlow` through `SectorHooks`. After a defeat the
sector unloads 10 s of tactical time later, where the original runs a timer.

**Saving** is refused while a battle prompt is open or AR runs, as in the original (`promptOpen`,
`src/server/save-rules.ts`).

## 3. Quirks of the original the code keeps

Each looks like a bug and is the original's behaviour. Ids stay stable; `tools/oracle/README.md` cites them.

| Id | Quirk | Test |
|---|---|---|
| Q1 | The random-ambush chance subtracts a "best" experience level that the original computes as a minimum from 0, so it stays 0 (`PreBattle_Interface.cc:325`) | `forces/pre-battle.test.ts` |
| Q2 | The random ambush needs the player to know nothing about the sector, which a conscious merc there prevents, so it is all but unreachable | `forces/pre-battle.test.ts` |
| Q3 | Kill and assist experience read the target's map level instead of his experience level: 0 chances on the ground | `autoresolve/landing.test.ts` |
| Q4 | A melee kill gives no experience, morale or assist; melee damage takes life, not breath | `autoresolve/attack.test.ts` |
| Q6 | Militia enter late by (i − 4)·2000 ms from the eighth on, not (i − 6) | `autoresolve/ratings.test.ts` |
| Q7 | Retreat timers: one merc ×5, everybody ×2 of the remaining timer, wrapping at 16 bits | `autoresolve/end.test.ts` |
| Q8 | A fourth bullet in flight adds its damage to slot 2 and is credited to slot 2's attacker; assist slots are stale | `autoresolve/attack.test.ts` |
| Q9 | Only the gun in the hand is reloaded; a pocket gun fires until empty | `autoresolve/attack.test.ts` |
| Q11 | The dead and the unconscious can be ordered to retreat: it never completes, but attacks on them take the 70 % factor | `autoresolve/end.test.ts` |
| Q12 | The H1 garrison (index 25) counts as stationary and mobile because the original compares the garrison id with the `ROADBLOCK` composition | `strategic/ai/counts.test.ts`, oracle |
| Q15 | A merc who retreated alone stays in the sector after a victory; only a `RETREAT` ending moves the groups | `autoresolve/close.test.ts` |
| Q16 | The group pass of the enemy association hands out slots in cell order whatever the cell's class | `autoresolve/setup.test.ts`, oracle |
| Q17 | Bandaging: the medic bonus looks for a medical kit in the helmet slot; the best-medic search stops at the first kit owner who is not bleeding | `autoresolve/close.test.ts` |
| Q18 | EPC cells have attack 0 and defence 1000, so they draw fire | `autoresolve/ratings.test.ts` |
| Q19 | Capture counts unconscious and retreated mercs and captures the retreated ones too | `autoresolve/close.test.ts` |
| Q20 | At close every enemy below `OKLIFE` dies, even after a defeat; militia die only below 7 | `autoresolve/close.test.ts` |
| Q21 | A dead robot without controller is "killed" again when its unconscious controller is the last one up, and the battle is lost while he lives | `autoresolve/end.test.ts` |
| Q25 | A creature picks its target, spending the draws, before it skips 7 % of its attacks | `autoresolve/loop.test.ts` |
| Q27 | Battle time ×3 first, then +5 min for a retreat; bandage time is not multiplied | `autoresolve/close.test.ts` |
| Q28 | The summary panel of an underground battle reads the surface sector's record (`PreBattle_Interface.cc:242`) | `forces/pre-battle.test.ts` |
| Q29 | Losing a sector flips control before the "our mercs are still here" early return | `strategic/map/control.test.ts` |
| Q30 | The dead of a battle lie on random tiles of the visible area of the map loaded last, a basement loaded elsewhere or already unloaded included (`TileEngine/Isometric_Utils.cc:667`) | `src/sim/campaign/battle-scenario.test.ts`, `autoresolve/close.test.ts` |

Not pinned yet:
- Q10: `bulletImpact` reads the ammo type from the attacking hand, not the slot that fired, and the throwing-knife test
  from the last attacking weapon (`Weapons.cc:2751-2760`).
- Q13: a merc captured in AR takes `MORALE_MERC_CAPTURED` twice, from the end block and from
  `enemyCapturesPlayerSoldier`.
- Q14: an AR victory asks for player control while the dead enemies still count, so the sector stays enemy-controlled
  unless the excess enemies are eliminated at close (oracle `battle.txt`).
- Q17, the rest: the kit "status" is the stack's total points; the best medic starts as merc cell 0, qualified or not.
- Q22: autoresolving a loaded battle unloads the sector through `EndTacticalBattleForEnemy`, which costs
  `ABANDON_MILITIA` loyalty while militia and enemies are still up (oracle `battle.txt`).
- Q23: `GROUPFLAG_HIGH_POTENTIAL_FOR_AMBUSH` comes only from exit-grid departures, which pass the destination sector
  to the retreat implications (`StrategicMap.cc:3215`, `:1680-1683`).
- Q24: a group with no previous sector is recognised by P16, so one really coming from P16 picks a retreat side anew.
- Q26: retreat trips are partly spent by the PBI's 300 s warp and by AR's warp.

## 4. Not checked against the native build

The oracle (`tools/oracle/README.md`, "Autoresolve") replays native Finish-mode battles draw by draw through ratings,
loop, end, bandage and close, compares every created militia, enemy and creature soldier, runs the close through the
battle flow on imported saves, and compares the encounter code. Inferred from reading the source:
- That every AR soldier sits at `NOWHERE`, so instant kills always use the close rules: a merc who never entered a map
  since a save was loaded could keep another gridNo; a merc's leftover `sDamage` feeds the torso kill.
- The random-ambush branch (Q2): the saves are on easy at 2–4 % progress, so only unit tests cover its arithmetic.
- Q21 and the creature timer wrap: a creature rated above about 960 can wrap its next attack to about 65 s.
- The LAW in AR (an `IC_GUN` whose reload always fails, fired while its counter lasts) and the AP check of
  `AutoReload`'s second-gun reload.
- That the original's clock can tick at 1× under a PBI opened without the quote path.
- That retreating from a sector does not flip control by itself.
- That unloading the loaded battle sector before AR draws nothing beyond the preserved soldiers' `PreRandom(2)`.
- Q30: the oracle's battles run with a surface map loaded last; no probe places the dead after a basement.

Not ported: gaps "Autoresolve stalemate", "Pre-battle retreat preview", "Battle notice boxes", "Auto-bandage". Kept
difference: deviation "Visible area of the map loaded last".

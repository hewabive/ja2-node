# 17 — Strategic AI: the Queen, difficulty and progress, creatures

The enemy's strategic side, from a new game's garrisons and patrols to the end of a tactical battle: the army data,
garrison and patrol weights, the Queen's periodic evaluation and garrison checks, reinforcements and their routes,
detection and opportunistic attacks, the reactions to lost sectors and meanwhile scenes, enemies entering, joining and
dying in a tactical battle, the difficulty modifier and the player's progress, and the strategic creature quest.
Siblings: `15` the event queue and the new-game order; `16` sectors, groups, movement, arrivals, sector control and the
defence placement; `18` militia, loyalty, mines and town liberation; `19` the pre-battle interface and autoresolve;
`26` meanwhile scenes, the Queen's death and captures (`EnemyCapturesPlayerSoldier` is `campaign/merc-fate.ts`); `13`
the tactical creature AI; `14` the savegame reader. Each module's `@src` header names the Stracciatella functions it
ports; read those for the formulas and the order of draws.

## 1. Where things live

Paths are under `src/sim/`; `ai/` is `strategic/ai/`.

```
new game → initStrategicAI: compositions by difficulty,         ai/init.ts (from campaign/new-game.ts)
  garrisons, patrols, weapon cache, evaluation and check events
EVALUATE_QUEEN_SITUATION → evaluateQueenSituation                ai/evaluate.ts
  reschedule, priority phase, admin upgrades, weighted pick
  └ sendReinforcementsFor{Garrison,Patrol}: pool or garrison     ai/reinforce.ts, ai/weights.ts, ai/composition.ts
     └ moveSAIGroupToSector: STAGE, EVASIVE or DIRECT             ai/orders.ts → strategic/forces/movement.ts
CHECK_ENEMY_CONTROLLED_SECTOR → checkEnemyControlledSector       ai/detection.ts
  a staged group tops up and attacks; the garrison eyes its neighbours
group arrival (16) → StrategicAiPort.lookForAdjacentGroups       ai/strategic-ai.ts → ai/detection.ts
  ├ at its destination: evaluateGroupSituation                   ai/orders.ts (merge, become a patrol, reassign)
  └ notice rolls on the neighbours: pursue, attack militia, retake a town sector
sector won (16, 19) → queenLostControlOfSector                   ai/reactions.ts (wake count, grace, redirection)
meanwhile, Kingpin, Queen's death → executeStrategicAIAction     ai/meanwhile.ts, ai/reactions.ts
sector load → prepareEnemyForSectorBattle → SectorBattlePlan     ai/queen-command.ts, campaign/sector-flow.ts
  defence placements, then group ids in team order               ai/defence-placement.ts, tactical/init-list.ts
end of a tactical turn → addPossiblePendingEnemiesToBattle       ai/queen-command.ts, placed by sector-flow.ts
death, map-edge escape, autoresolve → processQueenCmdImplicationsOfDeath
sector unload → endTacticalBattleForEnemy
soldier creation → difficultyModifierAt; hourly → progress       ai/difficulty.ts, ai/economy-link.ts
creature quest: start, spread, night planning, town attacks     strategic/creatures/, campaign/creature-flow.ts
native save → importStrategicAi, then the load hooks             ai/save-import.ts
```

| Module | Holds |
|---|---|
| `src/content/strategic/army.ts` | `ArmyContent`: compositions, garrisons, patrols, the policy per difficulty, the progress weights |
| `ai/queen-state.ts`, `ai/constants.ts` | `QueenState` (the original's globals and its mutable composition, garrison and patrol records), `StrategicStatus`, `MeanwhileState`; compositions, special sectors, action codes |
| `ai/context.ts`, `ai/strategic-ai.ts` | `QueenContext`; `StrategicAi`, the `StrategicAiPort` that `16`'s movement and control code calls, the event handlers |
| `ai/counts.ts`, `ai/weights.ts`, `ai/composition.ts` | Enemy counts; garrison and patrol weights, request and supply predicates; class splits |
| `ai/init.ts`, `ai/evaluate.ts`, `ai/reinforce.ts` | New-game setup; evaluation, priority phase, admin upgrades; reinforcements, the source choice, mass fortification |
| `ai/orders.ts`, `ai/detection.ts`, `ai/reactions.ts` | Group orders, arrivals, reassignment; attack permissions, notice rolls and their handlers; waking, lost sectors, AI actions, mines that run out |
| `ai/queen-command.ts`, `ai/defence-placement.ts` | Battle plan, pending enemies, deaths, the end of a battle; the class mix over the init list |
| `ai/difficulty.ts`, `ai/status.ts` | `CalcDifficultyModifier`, palace distance, progress and its milestones; kill tracking |
| `ai/meanwhile.ts`, `ai/economy-link.ts`, `ai/save-import.ts` | Meanwhile scheduling and implications (`26`); the bridge to `18`; native-save import (the sections are read by `src/content/formats/savegame-strategic-ai.ts`) |
| `strategic/creatures/`, `campaign/creature-flow.ts` | `CreatureState`, the quest, spreading, night planning, town attacks; their events, battles and loyalty effects |

## 2. Design

**Plain state behind a port.** `StrategicState.queen` holds the original's globals and its composition, garrison and
patrol arrays as plain data; sector counts live on `16`'s sector records, the `ENEMYGROUP` fields on its groups. Every
function takes a `QueenContext`: the strategic context of `16` plus the army data, the mine income of `18` and a few
hooks (SAM repaired, creature quest ended). Movement, arrivals and sector control reach the Queen only through
`StrategicAiPort`, whose default does nothing, so `16` runs and is tested without her. `CampaignSim` binds the port and
registers the evaluation, garrison-check and meanwhile events.

**The army is data.** The compositions, garrisons, patrols and the AI policy ship unchanged in `data/externalized`, with
`game.json`'s progress weights; there is no transcribed table and the stub pack plays on the same data. Indices are
positions in those files, and the code tests some of them: the admin patrols 3 and 4, the four Alma garrisons from the
first `ALMA_DEFENCE`, garrison 25 (H1) in the roadblock quirk. Reordering a file changes behaviour.

**Surface garrisons and patrols only.** Underground enemies, rolled from the underground table at a new game, and the
weapon cache's troops have no garrison: the Queen never reinforces them, weighs them or draws on them.

**Weights are running totals.** `requestPoints` and `reinforcementPoints` are never summed: each recalculation removes
the record's previous weight first. The selection loops recalculate a record just before reading it, so a draw made on
the old totals meets fresh weights; the order of records and of recalculations is behaviour.

**Randomness.** Every Queen draw is `Random` on `main`; creature night planning uses `PreRandom`. `rollInt` and
`rollChance` (`ai/context.ts`) pass their argument through `u32` like the original's `UINT32` parameter: `Random(0)`
draws nothing, `Chance` always draws and a negative chance always succeeds. A new game draws in the original's order.

**Time.** `EVALUATE_QUEEN_SITUATION` reschedules itself at every run, asleep or not; each garrison has its own
periodic `CHECK_ENEMY_CONTROLLED_SECTOR`. Both run whenever world time runs, real-time tactical play included;
turn-based combat stops the clock (`15`). A new game initialises at 01:00 on day 1, night for enemy movement.

**The tactical side is a plan and a list.** `prepareEnemyForSectorBattle` updates the in-battle counters and returns a
`SectorBattlePlan`; the sector flow places the soldiers through the init list, then `assignEnemyGroupIds` hands group
ids out in team-slot order, which only decides which record a death decrements. `addPossiblePendingEnemiesToBattle`
returns `PendingArrival`s (group, entry side, classes) for the sector flow to create at the map edge. Enemies join a
running battle only beyond the 32 team slots or when a group's move ends in the loaded sector, so only while world time
runs; nothing pulls reinforcements from adjacent garrisons (a 1.13 feature).

**Difficulty takes its sector.** `difficultyModifierAt(q, class, battleSector)` takes the battle sector where the
original reads its current-battle globals; the sector flow asks it at soldier creation and keeps the ARMY value of the
sector load for the whole battle (deviation "Difficulty and progress in tactical"). The palace distance is rounded with
integers (`roundedSquareRoot`). The highest progress drives the modifier, admin upgrades and the SAM squad; the current
progress drives the Queen's priority phase.

**Saves.** A ja2-node save restores `QueenState` as it was. A native save is imported (sections 34 and 35 and the
meanwhile flags) and then runs the original's load-time recomputation once (deviation "Strategic AI load hooks").

**Dead code stays dead.** No caller passes the send-soldiers actions, so they are not ported and the Queen sends no
squad to the first battle (deviation "Unreachable Queen actions"); `ADD_MORE_ELITES` and `GIVE_KNOWLEDGE_OF_ALL_MERCS`
are ported but unreachable, so the extra-elites path and the aware battles never run.

**The player sees none of it.** Garrison ids, compositions, routes, the pool and the alertness stay out of the views
and the agent API; what the player knows about enemies follows `16`'s knowledge rules.

**Creatures** exist in sci-fi games only; the strategic quest runs whole, its scripting is a gap. The pending attack,
process globals in the original (`gsCreatureInsertionCode`, …), is campaign state in `CreatureState.attack`. A town
attack in the loaded sector adds the creatures without a pause (deviation "Creature attacks in tactical"); their
bodies: deviation "Creature bodies for town attacks". Bloodcats are counted with the map and ambush on arrival (`16`);
`tactical/init-list.ts` places them, and a death decrements their sector here.

## 3. Quirks of the original the code keeps

Each looks like a bug and is the original's behaviour. Pinned by tests in `ai/` unless a path is given:

| Quirk | Test |
|---|---|
| The first evaluation is stamped on day 0, before the start clock, so it runs at the first event processing (the original's comment says 7:55 on day 1) | `init.test.ts` |
| A new game runs at 01:00, so every patrol rolls the night sleep twice: on its first waypoint and on its random placement | `init.test.ts` |
| A new garrison is weighed by its rolled start size, not by the soldiers it got: Cambria counts its troops only, Drassen's admin floor is ignored | `init.test.ts` |
| The evaluation reschedules itself with two draws while the Queen sleeps | `evaluate.test.ts` |
| Mass fortification overdraws the pool, and recruiting waits for a pool of exactly 0 | `evaluate.test.ts` |
| The palace sends patrol reinforcements even after it fell, and a garrison with nothing to spare can send a patrol an empty group | `evaluate.test.ts` |
| Every priority phase rebuilds the town compositions from the unscaled data: it undoes the difficulty scaling and the quartered priority of a mine that ran out, and San Mona gets a desired 6 while its priority stays 0 | `evaluate.test.ts` |
| A garrison's denial counter wraps at 256 | `evaluate.test.ts` |
| Patrol demand is capped at 2 with `min` where the garrison weight takes `max`, so patrols barely ask for reinforcements | `weights.test.ts` |
| A patrol's grace period is stored mod 100 and expires at once across a multiple of 100 days | `weights.test.ts` |
| The palace's extra reinforcements wrap: `20 − requested` is negative for its 32 elites | `weights.test.ts` |
| The palace guard fills to 20, not 32, and credits the pool with `20 − elites` instead of the real overflow | `orders.test.ts` |
| H1's garrison counts as stationary and as mobile: the original compares the garrison index, 25, with `ROADBLOCK` | `counts.test.ts` |
| An enemy group's size leaves its admins out | `counts.test.ts` |
| F10 closes once the hillbillies are dead, against the code's own comment | `detection.test.ts` |
| H2 closes when H2 itself and G1 or G2 are defended | `detection.test.ts` |
| A garrison splits towards an undefended town sector even while its own sector is loaded | `detection.test.ts` |
| An oversized garrison's elites are capped at `32 − admins + troops` | `queen-command.test.ts` |
| An underground battle places the total counts while marking only the new ones in battle | `queen-command.test.ts` |
| A creature attack is dated on the mine's sector, not on the attacked one | `strategic/creatures/creatures.test.ts` |

The defence placement's quirks are in `16`.

Not pinned yet:
- Mercs weigh 5 in `PlayerForceTooStrong` and 4 in `ReinforcementsApproved` (`DEFENCE_MERC_TOO_STRONG`,
  `DEFENCE_MERC_APPROVAL`).
- The weighted picks start at the drawn record and then take the first that qualifies; `ReassignAIGroup`'s patrol loop
  sets its restart index at the first patrol with a positive weight, hit or not.
- The last step of the source choice can pick a garrison with nothing to give, such as Meduna's; the send then gives
  up without a denial.
- A destroyed patrol is never refilled (`refill_defeated_patrol_groups` is false) but keeps a weight of 2: phantom
  request points that keep `requestPoints` positive.
- Palace and staging groups can exceed 20, up to three times the garrison's desired size; a staged group tops up from
  nothing before it attacks.
- An enemy who walks off the map is dead to the strategic layer and joins no group (`#soldierLeftMap`,
  `campaign/sector-flow.ts`).

## 4. Not checked against the native build

The oracle replays every draw and compares the whole AI state after it for new games on all difficulties and the six
native saves: initialisation, evaluations, garrison checks, the Queen waking, 40–60 group arrivals with their look
around, the load-time recomputation and the difficulty modifier. It also covers the creature quest, the init list and
the defence placement (`tools/oracle/README.md`, "Strategic AI", "Creatures" and "Sector transitions"). Inferred from
reading the source:
- Groups sent to the palace without a pending slot stay there as mobile groups.
- A garrison's attack on a stopped player group is pending nowhere and stays where its battle was.
- Every contested surface win counts towards waking the Queen, re-wins of owned sectors included (the call sites are
  `16`'s and `19`'s).
- A stationary Mike or Iggy is decremented twice, by profile and by class.
- What an empty patrol reinforcement group does later.
- The garrison notice of `CheckEnemyControlledSector`: no probed situation had an important undefended neighbour.
- `PrepareEnemyForSectorBattle` as a whole (group ids by team order, the elite cap): there is no `prepare` probe; the
  placement decisions are covered by `defence`.
- The order of the two `Random` calls of `TacticalCreateEnemySoldier`'s noise target, which the compiler decides.

Not ported: gaps "Creature quest scripting", "Lost sector notices without a battle". Other deviations of this domain:
"Strategic AI undefined behaviour", "Strategic AI PD placement pass", "Strategic AI debug toggles", "Meanwhile scenes",
"Sandbox population", "Fourth captive".

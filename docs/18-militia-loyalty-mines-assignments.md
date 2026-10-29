# 18 — Towns and mercs between battles: militia, loyalty, mines, SAM sites, assignments

The strategic economy: town loyalty and what changes it, militia training, promotion and redistribution, mines and
their income, SAM condition and air control, the finance ledger, and the mercs' assignments with the hourly update
(doctoring, repair, training, rest, fatigue, sleep, natural healing). Siblings: `15` the clock, the event queue and the
order of the hourly and daily handlers; `16` when sector control changes, groups and `findStratPath`; `17` the Queen,
her mines and progress; `19` militia and loyalty in battles and autoresolve; `22` contracts, salaries and team morale;
`25` and `35` the quests and NPC actions that change loyalty and run the head miners and the hospital; `33` stat
changes and kill points; `29` the agent API (`assign`, `sleep`, `wake`, `moveMilitia`, `distributeMilitia`, the militia
prompts, the economy events). Each module's `@src` header names the Stracciatella functions it ports; read those for
the formulas.

## 1. The path through the economy

Paths are under `src/sim/`; `economy/` is `strategic/economy/`.

```
new game: town loyalty and mines (draws), starting cash       economy/init.ts, campaign/new-game.ts
HOURLY_UPDATE → handleHourlyUpdate                              economy/update.ts
  └ updateAssignments
     note who slept through the past hour; natural healing,     rest.ts, doctor.ts, training.ts
     hospital, partnerless trainers; rest, fatigue, sleep
     each sector with mercs, x outer, then y, z: doctors,       doctor.ts, repair.ts, training.ts → militia.ts
     repairmen, students, militia trainers
     healed patients, continue-training prompts, nothing to do  doctor.ts, militia.ts, assignment-done.ts
  then team morale, hourlyMinesUpdate and the other slots in the original's order (doc 15)
00:00 SETUP_MINE_INCOME → HANDLE_MINE_INCOME at 9, 12, 15, 18   mines.ts
07:00 ENRICO_MAIL → handleEnricoEmail, the mail                 inactivity.ts, campaign/laptop/laptop-flow.ts
BANDAGE_BLEEDING_MERCS, a minute after a doctor, patient or     doctor.ts
hospital stay is set and again while someone bleeds
assign, sleep, wake, moveMilitia, distributeMilitia             campaign/commands.ts → set-assignment.ts, militia-moves.ts
control change → world port → loyalty, morale, notice, theft    strategic/map/control.ts → economy/context.ts → loyalty.ts
tactical militia from the counts; promotions on unload          campaign/sector-flow.ts, tactical/init-list.ts
```

| Module (`economy/` unless a path says otherwise) | Holds |
|---|---|
| `state.ts`, `constants.ts`, `events.ts` | `EconomyState` (town loyalty, mines, promotion counters, pending prompts), the original's enums and constants, the `EconomyEvent`s of `29` |
| `ports.ts`, `context.ts` | `CrewPort` (the active team in id order, vehicles and the robot included), `EconomyHooks` (what other systems own: morale, theft, monsters, head miners, vehicles, history), `EconomyDecisions` (the militia prompts), `PeriodicSlots`; `createEconomyContext`, `economyWorldPort` |
| `towns.ts` | The town sector list, town size and control, `sectorOursAndPeaceful` |
| `loyalty.ts`, `inactivity.ts`, `campaign/civilian-murder.ts` | The loyalty accumulator, distance-adjusted events, whole towns, control-change effects; Enrico's inactivity check; the murder of a civilian |
| `militia-rules.ts`, `militia.ts`, `militia-moves.ts` | Eligibility and capacity; training sessions, payment and continue prompts, promotions; the militia panel's moves and AUTO |
| `mine-status.ts`, `mines.ts` | Mine records; init, income, workforce, depletion, monsters, head miners and their quotes |
| `conditions.ts`, `points.ts`, `kits.ts`, `repair-rules.ts`, `vehicle-assignment.ts` | Every `CanCharacter…` check; doctor, repair and training points; kit points; what is left to repair; the vehicle assignment |
| `rest.ts`, `doctor.ts`, `repair.ts`, `training.ts` | The hourly work |
| `set-assignment.ts`, `assignment-done.ts`, `update.ts` | Setting assignments, sleep and wake; done, aborted, nothing to do; the hourly update and the economy events |
| `save-import.ts`, `sector-loss.ts` | Imported mines, loyalty, ledger and assignment fields; the notice for a lost important sector |
| `strategic/map/control.ts`, `map/sam.ts` | Sector control changes, air control, SAM damage and repair |
| `campaign/finances.ts`, `finance-summary.ts` | The ledger (`addTransaction`) and the laptop's daily figures |
| `src/content/strategic/economy-content.ts` | Mines, starting cash, stat healing and merc types from `data/externalized/`; loyalty and head miner tables from `data/tables/` (`tools/transcribe/town-loyalty.ts`, `head-miners.ts`) |

Imports from a save: `src/content/formats/savegame-economy.ts` (mines, loyalty, ledger, the soldiers' assignment fields);
the sectors' militia and training fields come with the strategic map (`16`), the inactivity counters and Enrico's flags
with the Queen (`17`).

## 2. Design

**One context, ports for the rest.** An `EconomyContext` is a `StrategicContext` whose `mercs` is the crew port, plus
the content, hooks, decisions, periodic slots and an event list. Everything the economy does not own goes through a
hook, so the module runs alone in tests (`tests/support/economy.ts`, `FakeCrew`). The campaign fills the
`PeriodicSlots` in the original's hourly order (`15`); camouflage wears off in `campaign/camouflage.ts`, regeneration
stays empty (gaps).

**Prompts and boxes.** The militia payment and continue boxes are decision prompts answered yes, no or later; a
deferred one waits in `economy.prompts` with compression stopped (deviation "Militia payment and continue prompts").
Refusals are `militiaTrainingRejected` events; "assignment done", sleep, wake and tiredness are events the client turns
into quotes, boxes and animations (deviations "Assignment presentation", "Update box timing").

**Commands instead of screens.** `assignSoldiers` runs the original's list assignment soldier by soldier in the order
given and re-evaluates the nothing-to-do flags at once, where the original waits for a map screen frame (deviation
"Nothing-to-do re-evaluation"). The militia panel's cursor lives in the client: the server only takes whole moves and
AUTO (deviation "Militia redistribution").

**Work is paid for the hour that ended.** The hourly update notes who slept through the past hour before the rest step
puts mercs to bed or wakes them, and every payout reads that note; nothing pays in the first 45 minutes of an
assignment. In turn-based combat the clock stands still, so assignments make no progress (`10`).

**Strategic flow stands for compression.** Squad mercs heal at the resting rate while time is compressed; the map
screen always compresses and tactical never does, so ja2-node asks whether the flow is strategic (deviation "Time
compression for healing").

**Militia counts are strategic.** Tactical militia are created from the sector's counts on the map's enemy placements
when it loads, and re-created when training or redistribution changed the loaded sector; a death removes one at once.
Promotions are rolled when the world unloads, not when the battle goes straight to autoresolve (`19` rolls its own).

**Loyalty distances** come from `findStratPath` with a throw-away foot group, never with SHIFT held (deviation
"Loyalty distance path"). The amounts of every named event are in `data/tables/town-loyalty.json`. Where loyalty
changes come from:

| Change | Raised in |
|---|---|
| Battle won or lost, militia abandoned on retreat | `campaign/battle-flow.ts`, `campaign/sector-flow.ts`, `campaign/autoresolve-strategic.ts` |
| Enemy or militia killed, militia left fighting on unload | `campaign/sector-flow.ts`, `campaign/autoresolve-strategic.ts` |
| Town, mine and SAM sectors gained or lost, whole town liberated | `loyalty.ts` through the world port |
| Civilian murdered | `campaign/civilian-murder.ts` from the death hook |
| Militia session completed | `militia.ts` |
| Inactivity | `inactivity.ts` |
| Creatures eating civilians, NPC recruited in his town, rebels betrayed, quests and NPC actions, the creature queen and Deidranna | `campaign/creature-flow.ts`, `narrative/recruit-flow.ts`, `narrative-port.ts`, `narrative/npc-action-flow.ts`, `sector-flow.ts`, `endgame-flow.ts` (`25`, `35`) |

**Money is the ledger.** `addTransaction` changes the balance and appends a record; it never refuses, callers check the
balance. Every transaction is a `moneyChanged` event (deviation "Finance ledger").

**SAM sites** lose condition only to explosions on one of their two tiles (`SectorHooks.structureDamaged` →
`sector-flow.ts` → `damageSamIfFound`) and get it back only from the Queen's reinforcements (`ai/orders.ts`). Air
control is recomputed on every control change, SAM hit and repair; the helicopter's use of it is `16`.

**Randomness.** Draws keep the original's order on `main` and `pre` (`01` §3.6). Stat changes from doctoring, repair,
training and militia training draw `pre` (`33`); on `main` come the mine setup and head miner placement loops, the
toolkit wear of each repairman, militia promotions and placement, the false accusal of a murder and the theft per item.
Rest, fatigue, healing, training progress, income and loyalty draw nothing.

## 3. Quirks of the original the code keeps

Each looks like a bug and is the original's behaviour. Tests are in `economy/` unless a path says otherwise.

| Quirk | Test |
|---|---|
| A militia session advances whether or not the sector is paid | `militia.test.ts` |
| A full sector overflows into its town column by column: the town sector list is built x outer | `militia.test.ts` |
| A session never creates elites, and gives no loyalty unless it placed at least one militia | `militia.test.ts` |
| The trainer who completes a session ends the hour's training: no carry-over, no leadership chance for the rest | `militia.test.ts`, `training.test.ts` |
| A promotion falls back to a higher rank when the soldier's own is gone; a green can reach elite at once | `militia.test.ts` |
| AUTO deals out the militia of a town sector with enemies in it while they also stay there | `militia.test.ts` |
| Militia the player attacks stay on our side and never defect: Stracciatella's `MakeCivHostile` sets no side outside Conrad and the General (`Overhead.cc:2591`), and the unload asks the militia team (`Town_Militia.cc:610`) | `campaign/sector-flow.test.ts` |
| A negative loyalty remainder keeps its sign; reaching the cap zeroes the remainder | `loyalty.test.ts` |
| Betraying the rebels starts every loyalty town, so one not taken yet starts at 0 | `loyalty.test.ts` |
| An enemy takeover steals in a visited sector every time, also when the enemy held it already (reinforcements) | `loyalty.test.ts` |
| An enemy sector taken without a fight brings no town, mine or SAM effects, so a town completed that way is never liberated | `strategic/map/control.test.ts` |
| A creature that is no monster (a bloodcat) costs a murder's full price as a loss, even in an enemy sector; so do militia when the rebels hate the player | `campaign/civilian-murder.test.ts` |
| A day with a progress or setback mail is not inactive; a day with a creature or progress mail keeps all its new sectors | `inactivity.test.ts` |
| The Queen depletes a mine only once it produced for the player; an emptied mine shrinks the income share of progress | `mines.test.ts` |
| Doctors heal other doctors and themselves | `assignments.test.ts` |
| Below OKLIFE an odd healing point is spent without effect; kits are used from the last object of a stack | `assignments.test.ts` |
| Bandaging uses the doctor's first kit of either kind, though only a medical kit makes him a doctor | `training.test.ts` |
| A teammate repairs the robot's gear: the check for machines and EPCs looks at the repairer | `assignments.test.ts` |
| Damage costing less than a point is repaired with no points left | `assignments.test.ts` |
| A rested squad merc swings around 95 breath; a dying squad merc cannot sleep, so he is worn out | `assignments.test.ts` |
| The need for sleep wraps below 0 to the maximum | `assignments.test.ts` |
| A dead merc's camouflage wears off too, with its screen message: the hourly loop walks the whole team | `campaign/camouflage.test.ts` |

Not pinned yet:
- The class-matched pass of militia placement rolls no attitude and keeps detailed placements (`tactical/init-list.ts`
  `enlistMilitia`).
- Kill points earned in a tactical battle that goes straight to autoresolve are lost: the unload skips promotions and
  autoresolve creates its militia afresh.
- A loyalty gain in Omerta while the rebels are not neutral sets the rating to 10, even from above.
- The theft chance wraps above 51 enemies (`theftChance`).
- A town with no path to the event counts as distance 0, the full +75 %.
- A trainer whose sector became full or disloyal is flagged nothing-to-do but keeps training; the session is wasted.
- Stat healing (off by default) caps the stat points at the hour's points left, then spends three times as many and can
  wrap the points left.
- Teammates' jammed guns are unjammed again in every pass of the repair.
- Fred is placed at random too when the first mine entered has its own head miner (Alma).
- A mine counts as invaded before (`prevInvadedByMonsters`) only if the player held it when the creatures came.

## 4. Not checked against the native build

The oracle (`tools/oracle/README.md`, "Economy" and "Team morale") compares the strategic dumps, the assignment
estimates, nine loyalty events and warps of 2 to 8 hours on six saves in Drassen; after a warp the stat-derived
estimates are not compared. Inferred from reading the source:
- That `findStratPath` distances stay within 30 and no town is unreachable for a foot group.
- That glibc `qsort` keeps id order for trainers with equal points (deviation "Militia trainer ties").
- That a walking merc counts in his departure sector for the hourly sector list.
- That attacking militia turns none of them (the quirk above; vanilla set the side, `Overhead.c:3075`), and that
  `HandleMilitiaDefections` is therefore unreachable.
- That Deidranna's death never maximises loyalty: `MaximizeLoyaltyForDeidrannaKilled` sits in the enemy branch while
  she is a civilian (`Overhead.cc:2477`), so `maximizeLoyaltyForDeidrannaKilled` has no caller.

Not ported: gaps "Implications of an attack" (the head miner attack), "Strategic economy stand-ins" (vehicle repair),
"Regeneration counters", "Absent mercs between hourly updates".

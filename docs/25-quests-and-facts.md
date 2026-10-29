# 25 — Quests, facts and campaign rules

The fact store and `CheckFact`, quests and their rewards, the San Mona boxing club, escorts and the robot, Skyrider's
helicopter, and the quest rules the original spreads over tactical and strategic code: sightings, deaths, escorts
arriving, quest action items, Pablo's goods, Kingpin's money, the Cambria hospital, terrorists and assassins. Siblings:
`24` the records that test and set facts and start and end quests, the talk context, recruiting and escorting; `35` what
each NPC action does, NPC presence, the 04:00 and hourly handlers, civilian groups, doors; `26` meanwhiles, the Queen
and the endgame; `21` Bobby Ray's delivery, Pablo's thefts and the history log; `22` contracts (Slay, Iggy); `23`
dealers; `18` loyalty, mines, the hospital assignment and civilian murders; `19` battles and capture; `16` vehicle and
helicopter movement; `33` damage and stat changes; `29` the agent API (`unescort`, `heliRoute`, the quest log). Each
module's `@src` header names the Stracciatella functions it ports; read those for the rules and their order. Data: fact,
quest, profile and action ids in `data/tables/narrative.json` (`tools/transcribe/narrative.ts`), history codes in
`data/tables/merc-contracts.json`; the NPC records and `prof.dat` (start sectors, towns, `npcData`) are the user's data
or the stub pack's (`stubs/profiles.json`, `stubs/npc/records.json`).

## 1. Where things live

Paths are under `src/sim/`.

```
facts and quests: the store, start, end, history  strategic/narrative/facts.ts, quests.ts
  CheckFact: recompute, write back, return        strategic/narrative/check-fact.ts
    its inputs: world, towns, mines, talk         campaign/narrative/fact-world.ts, strategic/narrative/economy-facts.ts
  callers: records (24), actions (35), tactical   NarrativeFlow.checkFact, TacticalState.narrative.fact
  rewards: squad experience, loyalty per NPC      strategic/narrative/rewards.ts
tactical quest rules, through the port            tactical/narrative/port.ts, campaign/narrative-port.ts
  a new sighting of our merc                      tactical/narrative/sight-rules.ts
  a step: escorts, assassins, boxing              tactical/narrative/escort-arrival.ts, assassin-approach.ts, boxing.ts
  a pressure item or switch underfoot             tactical/narrative/quest-items.ts
  a hit and a death                               tactical/combat/hit.ts, death.ts → tactical/narrative/death-rules.ts
strategic checks: goods, money, hospital          strategic/narrative/npc-events.ts, kingpin.ts, hospital.ts
  over the campaign, sector loaded or not         campaign/narrative/quest-world.ts
helicopter: flights, SAMs, hovering, the bill     strategic/forces/helicopter.ts, campaign/helicopter-flow.ts
robot control                                     campaign/robot-control.ts, tactical/narrative/robot.ts
the quest log of the player view                  src/server/quest-view.ts
```

| Module | Holds |
|---|---|
| `strategic/narrative/facts.ts` | `NarrativeState` (`StrategicState.narrative`): the fact and quest arrays, the boxing record, the hospital account, the Joey and Mike sighting flags, the guide countdown; their native import |
| `strategic/narrative/fact-ids.ts`, `npc-ids.ts`, `history-codes.ts` | Ids, checked against `data/tables/narrative.json` and `merc-contracts.json` |
| `strategic/narrative/check-fact.ts`, `economy-facts.ts`; `campaign/narrative/fact-world.ts` | `CheckFact` over `FactContext`; its strategic and tactical inputs |
| `strategic/narrative/quests.ts`, `rewards.ts` | Start and end, `InitQuestEngine`, `CheckForQuests`; experience to the active squad, loyalty per NPC |
| `strategic/narrative/npc-events.ts`, `kingpin.ts`, `hospital.ts` | Pablo's returned goods and the damaged package, Kingpin's money, hospital prices, refunds and supplies (the NPC system events as a whole are `35`'s) |
| `strategic/narrative/presence.ts`, `profiled-enemies.ts` | The terrorists' and assassins' toughening and the assassin pick; Mike and Iggy as the army's elites |
| `campaign/narrative/narrative-flow.ts`, `quest-world.ts` | `NarrativeFlow`: the campaign's facts and quests, its `FactContext`, the profile deaths with campaign effects (Dynamo, Kingpin, Doreen); the world side of the strategic checks |
| `tactical/narrative/sight-rules.ts`, `escort-arrival.ts`, `assassin-approach.ts`, `death-rules.ts`, `quest-items.ts` | The quest rules of a sighting, a step, a death and the quest action items |
| `tactical/narrative/boxing.ts`, `boxing-state.ts`, `boxing-events.ts`; `tactical/ai/decide-boxing.ts` | The match, the state tests the original spreads over tactical code, the boxers' AI |
| `strategic/forces/helicopter.ts`, `helicopter-state.ts`, `helicopter-events.ts`, `vehicles.ts`; `campaign/helicopter-flow.ts` | Skyrider's helicopter; `HelicopterFlow`: the hover events, the hourly debt, the monologues, the KILL_CHOPPER meanwhile, the commands |
| `campaign/robot-control.ts`, `tactical/narrative/robot.ts` | `ControllingRobot` and the remote holder; an uncontrolled robot's orders and the controller's interrupt points |
| `strategic/economy/vehicle-assignment.ts` | Boarding a vehicle and who must drive it |
| `src/server/quest-view.ts` | The quest log of the player view |

## 2. Design

**Facts are the original's bytes.** `NarrativeState.facts` holds 500 bytes and is saved whole. `checkFact` recomputes
about 120 ids from the world, stores the result in the byte and returns it, so the store holds what the last evaluation
saw: code that reads the byte directly and saves get that value. Computed facts read the loaded sector only; with no
sector loaded the soldier facts are false. The two army facts hold 2 once their elite is used (`profiled-enemies.ts`).

**Facts are evaluated over ports.** `checkFact(ctx, id, profile)` reads a `FactContext` (world, towns, mines, boxing,
repairs, dialogue, items, the talk context), so its rules are tested with plain objects; `NarrativeFlow.factContext()`
builds the real one. Dialogue calls `NarrativeFlow.checkFact`, tactical rules `TacticalState.narrative.fact`: the same
function behind the `NarrativePort`. Outside a campaign that port is off: every fact false, every quest not started, no
records (deviation "Narrative port"). The talk context several facts read is `24`'s.

**Quests carry no rewards, and the player sees them as history.** A start or an end changes the status and adds a
history line when it moves the quest on from not started or from in progress, unless the caller turns history off;
experience, loyalty and money come from the actions and code paths that end a quest (`rewards.ts`, `35`). The original
has no quest screen, so the player view derives its quest log from the history, not from the status array
(`quest-view.ts`, `29`): a quest changed without history stays invisible, as in the original.

**Quest rules sit where the original calls them.** The rules of a sighting, a step, an attack and a death are small
modules under `tactical/narrative/`, called from the perception, movement and combat code, and reach the campaign only
through `TacticalState.narrative`. The strategic checks (Kingpin's money, Pablo's goods, the hospital supplies) are
plain functions over a context that `quest-world.ts` builds from the campaign, reading the loaded sector's world items
or an unloaded sector's diff (`sector-diff.ts`). A profile death marks the profile and writes the history line
(`combat/death.ts`), runs the civilian profile cases (`death-rules.ts`) and the murder of a civilian (`18`), then the
stat changes; cases with campaign effects go to `NarrativeFlow.profileDied`.

**Boxing shares one record.** The same `BoxingRecord` is `StrategicState.narrative.boxing` and the loaded sector's
`TacticalState.boxing`, so the saved globals, the state and the boxer ids need no copying at loads. Steps drive the
match (`boxingMovementCheck` on each step in states 1–3). The state tests the original spreads over the overhead, turn,
point, sight and AI code are named predicates in `boxing-state.ts` (`boxingHalvesPoints`, `boxingIdlesNonBoxers`, …);
their callers are the boxing hooks. The stub pack's club (`stubs/maps/d5.map.txt`) has the ring and the boxers on the
original's tiles. Deviations "Boxing UI lock", "Abandoning a fight".

**Escorts and the robot.** Becoming and releasing an escort is `24`'s. The robot joins through `RecruitEPC`, so it is an
escort wherever a rule does not test for the robot first. The escort rules live with what they gate: strategic moves
(`strategic/forces/move-permission.ts`), sector exits (`16`), the door menu (`35`), capture (`19`).

**The helicopter is a vehicle with a group.** `HelicopterState` (`StrategicState.forces.helicopter`) keeps the
original's globals; the vehicle sits in the vehicle list and flies its group's path (`16`). The agent's `heliRoute` and
`heliCancel` replace plotting and confirming on the map (deviation "Helicopter interface"); destruction happens at once
rather than at the end of the crash sound, and the monologues are checked once per strategic step rather than at each
map redraw (deviations "Helicopter destruction", "Skyrider monologues"); passengers cannot leave in flight (deviation
"Leaving the helicopter in flight"). As in the original there is no fuel.

**Quest action items.** Our soldiers stepping on a tile set off its armed pressure action items and switches, a switch
the remote action items on its frequency; the queue runs at the next overhead pass with sight disallowed and keeps the
AI busy, and a changed door makes all teams look at its end. Only the door closer, the Kingpin and museum alarms and the
brothel room scene act; the others and switches worked by hand are inert (gap "Map items").

**The hospital.** Each merc's price modifier lives on `RosterMerc.hospitalPriceModifier` (imported from native saves);
leaving the hospital assignment refunds what he did not use (`setTimeOfAssignmentChange`).

**Randomness.** Gameplay draws keep the original's statement order on `main` and `pre`. The helicopter's "enemies
spotted" quote pick is cosmetic (deviation "Cosmetic draws of the helicopter").

**Saving.** ja2-node saves `NarrativeState`, the helicopter state and the boxing record whole. A native import fills the
facts, quests, profiles and general-info globals (`strategic/narrative/save-import.ts`) and the boxing state and boxer
flags.

## 3. Quirks of the original the code keeps

Each looks like a bug and is the original's behaviour. Pinned by tests in `src/sim/strategic/narrative/` unless a path
says otherwise:

| Quirk | Test |
|---|---|
| A computed fact writes its result into the store, so a direct read sees the last evaluation | `check-fact.test.ts` |
| `PABLO_BRIBED` is the negation of `PABLOS_BRIBED`; `FACT_245` stays true once Miguel has joined | `check-fact.test.ts` |
| The unpropositioned-female fact takes the source talker first and gives up if she was asked, without trying the other | `check-fact.test.ts` |
| The wounded-merc facts count mercs within 9 tiles inclusive; the close and near facts count strictly under 3 and 5 | `check-fact.test.ts` |
| Starting a done quest restarts it and ending one never started finishes it, both without history; Alma's prison quest can pass without any | `quests.test.ts` |
| Ending the Maria quest clears Madame's counters, also when it never ran | `quests.test.ts` |
| Merely wounding Pacos sets "Pacos killed" | `src/sim/tactical/combat/combat.test.ts` |
| Kingpin's second money check counts the money of whatever sector is loaded | `kingpin.test.ts` |
| A damaged package in an unloaded Drassen moves only the items at gridno 1, so the lost goods at gridno 2 stay there | `npc-events.test.ts` |
| The hospital counts a tile's supplies once per doctors' ownership marker on it; the first theft fact stays when the supplies come back without the second | `hospital.test.ts` |
| Brass knuckles are legal in the ring, though the comment says they disqualify | `src/sim/tactical/narrative/boxing.test.ts` |
| The boxers are read from the ring tiles only while the first slot is empty, so ids from an earlier map still count until D5 is entered again | `src/sim/tactical/narrative/boxing.test.ts` |
| The Kingpin alarm rings again at the next step: its "zap" clears the disabled flag it means to set | `src/sim/tactical/narrative/quest-items.test.ts` |
| The museum alarm calls Eldin while sight is off, so he never sees the spot and always runs to it | `src/sim/tactical/narrative/quest-items.test.ts` |
| A crash that kills everyone aboard stops at the first passenger already dead; those seated behind him survive | `src/sim/strategic/forces/vehicles.test.ts` |

Not pinned yet:
- `ENOUGH_LOYALTY_TO_TRAIN_MILITIA` reads the town of the sector above when underground, and `WALKER_AT_BAR` ignores
  Father's level (`check-fact.ts`, `economy-facts.ts`).
- Confirming a helicopter route that adds no sector still takes off: the helicopter stays airborne where it stood,
  without hovering (`confirmHelicopterRoute`).
- A sex action item on a tile outside the three listed rooms only stops the merc (`sexActionItem`).

## 4. Not checked against the native build

The oracle compares facts, quests and `CheckFact` for all 500 ids with the talk context set, the boxing club, the
helicopter, the robot's control, the NPC system events with Kingpin's money and the hospital, and the quest action items
(`tools/oracle/README.md`, "Facts and NPC presence", "Boxing", "Helicopter", "Recruiting", "NPC actions", "Give").
Inferred from reading the source:
- The quest rules of a new sighting other than the hostile-quote list, the escorts' arrivals, the neutral assassins'
  approach and the profile deaths other than the Queen's: unit tests on stub soldiers only.
- The terrorists' and assassins' toughening item ladder.
- The profile flag and Pacos' fact set when our team hurts an NPC, and the creature queen's death beginning only with
  a killer.
- That checking Skyrider's monologues once per strategic step matches the map panel's redraws.

Not ported: gaps "Corpses" (heads from decapitation), "Strategic move refusals" (the museum chalice), "Map items",
"Ground vehicles", "Helicopter on the map", "Profile sectors of Skyrider and the helicopter", "Helicopter entrance",
"Guard room run", "Implications of an attack", "Creature quest scripting", "Vehicles as characters".

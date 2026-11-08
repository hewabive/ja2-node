# 25 — Quests, facts and campaign rules

The fact store and `CheckFact`, quests and their rewards, the San Mona boxing club, escorts and the robot, Skyrider's
helicopter and the vehicle list, and the quest rules the original spreads over tactical and strategic code: sightings, deaths, escorts
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
  seeing and losing sight of our merc             tactical/narrative/sight-rules.ts
  a step: escorts, assassins, boxing              tactical/narrative/escort-arrival.ts, assassin-approach.ts, boxing.ts
  a quest action item the bomb queue runs         tactical/bombs/item-action.ts → tactical/narrative/quest-items.ts
  a hit and a death                               tactical/combat/hit.ts, death.ts → tactical/narrative/death-rules.ts
strategic checks: goods, money, hospital          strategic/narrative/npc-events.ts, kingpin.ts, hospital.ts
  over the campaign, sector loaded or not         campaign/narrative/quest-world.ts
helicopter: flights, SAMs, hovering, the bill     strategic/forces/helicopter.ts, campaign/helicopter-flow.ts
  the mercs' drop on the loaded start sector      tactical/helicopter-drop.ts, helicopter-drop-state.ts, helicopter-landing.ts
    its start, its seats and its end                campaign/helicopter-drop-flow.ts, sector-flow.ts
vehicles: the list, a vehicle soldier's slot      vehicles/vehicle-list.ts, tactical/vehicle-soldiers.ts
  boarding and leaving on the loaded map          tactical/vehicle-boarding.ts, campaign/vehicle-boarding.ts
  repair and refuel with a toolkit or gas can     tactical/tile-tools.ts, vehicles/vehicle-fuel.ts
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
| `tactical/narrative/sight-rules.ts`, `escort-arrival.ts`, `assassin-approach.ts`, `death-rules.ts`, `quest-items.ts` | The quest rules of a sighting and its loss, a step, a death and the quest action items |
| `tactical/narrative/boxing.ts`, `boxing-state.ts`, `boxing-events.ts`; `tactical/ai/decide-boxing.ts` | The match, the state tests the original spreads over tactical code, the boxers' AI |
| `strategic/forces/helicopter.ts`, `helicopter-state.ts`, `helicopter-events.ts`, `vehicles.ts`; `campaign/helicopter-flow.ts` | Skyrider's helicopter; `HelicopterFlow`: the hover events, the hourly debt, the monologues, the KILL_CHOPPER meanwhile, the commands |
| `tactical/helicopter-drop.ts`, `helicopter-drop-state.ts`, `helicopter-landing.ts` | The mercs' drop from the helicopter (`TacticalState.helicopterDrop`): the seats, the script and its rounds, the fades, the shadow, the Esc skip (`skipHelicopterDrop`) and code 467 at the end of `HELIDROP` |
| `campaign/helicopter-drop-flow.ts` | The campaign's side of the drop: the first landing's and a later arrival's run (`gfTacticalDoHeliRun`, started once the step or command that set it is done), the Esc skip with the lock's end (`skipHelicopterDropOf`), `HandleFirstHeliDropOfGame` and the drop cut short by a world unload |
| `tactical/landed-helicopter.ts` | The helicopter standing in the loaded map (`TacticalState.landedHelicopter`): its pieces, their structures, the bump and their tile changes |
| `campaign/robot-control.ts`, `tactical/narrative/robot.ts` | `ControllingRobot` and the remote holder; an uncontrolled robot's orders and the controller's interrupt points |
| `strategic/economy/vehicle-assignment.ts` | Boarding a vehicle (`AddSoldierToVehicle`, the takeover of a vehicle not ours included) and who must drive it |
| `tactical/vehicle-boarding.ts`, `campaign/vehicle-boarding.ts` | The click on a vehicle with its walk and the boarding on arrival, the way out of a vehicle (`ExitVehicle`'s tile, opplist entry and sight), `VehicleHooks.boarding` and the loaded sector's part of boarding and leaving (`TacticalWorldPort.loadedVehicles`) |
| `tactical/tile-tools.ts`, `vehicles/vehicle-fuel.ts` | The toolkit and the gas can on a vehicle (`HandleItem`'s branches among the tile tools of `12` §7): the walk, the repair assignment on arrival, the fuel poured at code 769 |
| `vehicles/vehicle-list.ts`, `tactical/vehicle-soldiers.ts` | The vehicle list both layers share, its slots and records; a vehicle soldier registering his vehicle at creation and his vehicle leaving the list with him |
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
"Leaving the helicopter in flight"). Skyrider talks through the dialogue queue as an external face (`24`): his lines
pause the map screen, and a monologue's SAM reveals and the time of the last monologue are queued special events
(`HelicopterPort.skyriderMonologueEvent`, `handleSkyriderMonologueEvent`), so the Drassen SAM site is found when the
queue reaches the event after his first line. As in the original there is no fuel. On the ground at the loaded refuel site (at
Drassen until Skyrider is met) it stands on the map: `handleHelicopterOnGround` asks the campaign (`helicopterOnMap`)
to append its six pieces to the structure layer, with their structures, and to bump the soldiers around them, at a
sector load, a landing and a takeoff. The pieces are no map changes: the sector's temp state never holds them, the next
load adds them again, and the view sends them as `append` tile changes after the map changes (`29` §7). A native import
adds them before it applies the sector's saved map changes, as the original's load reads the temp files last, so a piece
destroyed before the save stays off the map (the map changes replay over the structure layer the pieces are appended
to), and before the saved soldiers enter the map, so its bump moves nobody (`14`).

**The drop from the helicopter.** `HelicopterDrop` holds the file statics of `Tactical/Merc_Entering.cc`, and like them
it outlives a run and a sector load: the sector flow shares one record with every loaded sector (deviation "Helicopter
drop statics"). Its seats are soldier ids. `handleHeliDrop` runs in the tactical step before `executeOverhead`, as
`HandleHeliDrop` runs before `ExecuteOverhead` (`GameScreen.cc:407`), and only in a non-modal tactical frame; its 100 ms
are `TacticalState.clockMs`, which stands still under a tactical prompt where the original's JA2 clock runs on, so the
first step after one comes up to 100 ms later. The fades ramp as with a sample playing (`31`). While it runs
`playerInterfaceLocked` holds, which refuses orders (`uiLocked`) and pauses the world under lock 16
(`campaign/interface-lock-pause.ts`); `StartHelicopterRun`'s own lock 20 gives way to 16 within its first frame, when
the UI handler takes `LU_BEGINUILOCK` (`Tactical/Handle_UI.cc:4003`). The lock's full-screen `gDisableRegion`
(`Tactical/Handle_UI.cc:4015`) takes every click and `GetKeyboardInput` drops every key but Esc, pause and load at its
gate for a locked UI (`Tactical/Turn_Based_Input.cc:2330`), so for a run under way, stalled or not, the campaign refuses
every command with `helicopterDrop` but `skipHelicopterDrop` (the Esc key, the only way on from a stall), `answer`,
`skipLine`, `setOption` and the queries (the map screen and sector exits included), and the server refuses the player's
saves (`helicopterDrop`, `27`); snapshots stay exact. With the world clock paused no strategic event runs during a run,
so no arrival can join one. The campaign's part goes through `sectorHooks`, wired by the sector flow: a seat's soldier
(`helicopterSeat`, the roster merc), his placement with the north code (`placeHelicopterSeat`, as `UpdateMercInSector`
places him, with no sector check), the arrival quotes (`mercArrivesQuotes`, at 467 and at the skip, over the whole team,
`22`) and the end of a run (`helicopterRunEnded`: `HandleFirstHeliDropOfGame`, the turn times, the enemies called to the
sweet spot and the enemy-presence line on the first run only, and the AI's unpause queued as a dialogue event every
run); a bare tactical sim places a seat at the north entry itself. The end of a run is also the event
`helicopterDropEnded {first}`, on which the session plays the enemy-present music after the first run; its start is
`helicopterDropStarted {gridNo}`, the north entry point the game screen centres on, and each merc it lands is
`mercDropped {soldier}`, the original's "has arrived" line, which the arrival of a merc with the chopper code leaves to it
(`Tactical/Merc_Hiring.cc:289`). The start and the skip report their events with the step or command itself, not at
the next tactical step as other tactical events do, so the view that first shows a run comes with its start and a map
screen opened after the skip holds back none of its lines. The view's `helicopterDrop`
carries the run, its engine volume and its shadows (`29` §7), from which the client locks its input, draws the shadow
and plays the engine (`30`, `31`).

A run starts as the original's `gfTacticalDoHeliRun` does (`campaign/helicopter-drop-flow.ts`): the first landing
(`InitHelicopterEntranceByMercs`, which also marks the first run) and an arrival in the loaded start sector without the
chopper code (`MercArrivesCallback`, `Tactical/Merc_Hiring.cc:257`, which opens tactical from the map screen) flag it,
and the run starts once the step or command that flagged it is done, on the tactical screen only: the seats the arrivals
added (`AddMercToHeli` from `UpdateMercInSector`'s chopper branch), the north entry as the sweet spot, `InterruptTime`,
compression at 1x and the lock's pause at once (deviation "Helicopter run start"). A world unload ends a run flagged or
under way, the seats still in the helicopter taking the north code (deviation "Helicopter drop cut short"); only a run
flagged on the map screen meets one, when the way to tactical is refused and a route takes the seat away, since the lock
of a run under way refuses every way out and a battle lost or a surrender leaves the seats in the sector. A native save
made in mid-drop holds its seats with no run: the import lands them as the Esc skip does (deviation "Helicopter drop in
a native save", `14`), and a merc it saved in `HELIDROP` steps away at code 467 as his animation runs on. The session
factory runs the first drop to its end, or skips it with `land: "skip"` (`29`); the test helpers take the Esc path
unless a test watches the drop (`tests/support/campaign.ts`).

**One vehicle list, shared.** `VehicleRecord` and the slot functions live in `vehicles/vehicle-list.ts`, which both
layers import: `strategic/forces/vehicles.ts` imports tactical code, so tactical code reaches the list only there. In a
campaign `TacticalState.vehicles` is `StrategicState.forces.vehicles` itself, shared by reference as the profiles are;
the snapshot graph keeps the two one array, and the native import refills the list in place. One list keeps the
original's ids, which the saves, the strategic code and the views use, and lets the sandbox have vehicles too, in a list
of its own. Every soldier of a vehicle body registers his vehicle at creation, whatever his team, through
`TacticalState.vehicleHooks`: the campaign's adds the vehicle with its movement group (`addVehicleToList`), the
sandbox's only fills a slot. The soldier holds the vehicle's id (`Soldier.vehicleId`, `bVehicleID`, -1 for anyone else)
and the record its soldier (`VehicleRecord.soldierId`, standing for `FindSoldierType`); a team change keeps both. A
vehicle not on our team leaves the list with its corpse and when its sector unloads, and registers again, maybe under
another id, at the next load; ours stays. The type's name (`zVehicleName`) is UI text and stays out of the simulation
(`31`): a vehicle soldier keeps the name his creation gave him, and the client names him by his body's type (`30`). A snapshot older than the list links only the vehicles
its records named, which were ours from native imports; any other vehicle soldier it holds has no slot (-1) until his
sector loads again.

**Passengers in the loaded sector.** A merc seated in a ground vehicle stays in the sector (`placed`, his merc slot) at
the vehicle's tile, with his seat on the soldier (`Soldier.vehicleSeat`, the original's `SOLDIER_DRIVER` and
`SOLDIER_PASSENGER`; the roster reads it there) and no occupant entry or structure (`placeOccupant`, `addMercStructure`).
`placed` keeps its in-sector meaning for him, as `bInSector` does in the original, so every loop includes him unless it
skips the seat; the grid lookups never find him, as `WhoIsThere2` never does. `setSoldierGridNo` skips what the original
skips for a seated soldier and every placement of the vehicle carries its passengers (`movement.ts`, `07`). At a sector
entry the mercs, in their slots before the vehicle's 18 or 19, wait in the sector with no tile until the vehicle takes
them to its own; a group arriving puts the vehicle in first, and its passengers take its tile at once
(`tactical/vehicle-passengers.ts`). Boarding on the map screen seats a merc on the loaded map at the vehicle; a wreck,
like the helicopter shot down, kills every passenger through `SoldierTakeDamage` on his world: the loaded sector's, or
with none loaded the unloaded one (`CampaignSim.turnWorld()`, `33`).

Helicopter passengers over the loaded sector keep a merc slot with no tile, as in the original: boarding takes only the
tile (`RemoveSoldierFromGridNo`, `Tactical/Vehicles.cc:261`), and a sector load gives the slot and stops before any tile
(`Tactical/Soldier_Add.cc:701-709`). ja2-node holds them as it holds a ground vehicle's passengers waiting at a sector
entry: registered, `placed` false and `offMap` true (`inSector(s)`, the original's `bInSector`), at `NOWHERE`
(`seatWithNoVehicleOnTheMap`, `seatInTheHelicopterOnSectorEntry`, `tactical/vehicle-passengers.ts`). The roster reads
that through `inTacticalSector`, and a native import seats them the same way (`14`). A loop gated on `placed` passes them
by, as the original's loops on `IsSoldierValidForSightings` or `NOWHERE` do; a loop over the merc slots that takes
`offMap` soldiers sees them, as the original's `FOR_EACH_MERC` does. Where the original tests `bInSector` for our team,
the passenger counts here too: those branches test `inSector(s)` (`teamInSector`, `mercsInSector`, `tactical/state.ts`),
and where they measure from his tile they take the original's `NOWHERE`, one row past the map, 25601 against ja2-node's
−1 (`withOriginalNowhere`, `tactical/soldier.ts`). The tests: `tactical/vehicle-passengers.test.ts`,
`tactical/turns/personality.test.ts`, `campaign/team-morale.test.ts`, `campaign/helicopter-flow.test.ts` and
`campaign/death-in-the-map-screen.test.ts`; the helicopter-drop comparer's passenger blocks check them against the
native build (`tools/oracle/README.md`, "Helicopter drop").

| The original | Counts him | ja2-node | Same |
|---|---|---|---|
| Boarding: the tile goes, the slot and his opplist stay (`Tactical/Vehicles.cc:261`) | yes | `seatWithNoVehicleOnTheMap` | yes |
| A sector load: the slot, with no AP count and no stop (`Tactical/Soldier_Add.cc:701-709`) | yes | `seatInTheHelicopterOnSectorEntry`, from `SectorFlow.#placeMerc`, in id order | yes |
| Leaving over the loaded sector: `UpdateMercInSector` pushes a second slot, `AddMercSlot` checking nothing (`Tactical/Vehicles.cc:345`, `Tactical/Overhead.cc:244`) | twice | `addSoldierToSector` keeps the one slot (deviation "Helicopter exit over the loaded sector") | no |
| `ExecuteOverhead`'s slot loop: damage counter, fade, frames, the look for items (`Tactical/Overhead.cc:518`) | yes | `executeOverhead` (`inSector`) | yes |
| `NotifySoldiersToLookforItems` (`Tactical/Handle_Items.cc:1927`), whose look returns at `NOWHERE` (`Tactical/FOV.cc:222`) | flagged | `notifySoldiersToLookForItems`, `revealRoofsAndItems` | yes |
| `ResetAllMercSpeeds` (`Tactical/Overhead.cc:5829`), `ChangeSoldierTeam`'s target relink (`Tactical/Soldier_Profile.cc:654`) | yes | `resetAllMercSpeeds` (`inSector`), `narrative/team-change.ts` | yes |
| `NextAIToHandle` (`Tactical/Overhead.cc:403`) | skipped, ours | `nextAIToHandle` | yes |
| `IsSoldierValidForSightings` and the loops on it or on `NOWHERE` (`Tactical/OppList.cc:629`, `:736`, `:1189`, `:1237`, `:4298`, `:4363`, `:4434`) | no | `validForSightings` (`placed`) | yes |
| The real-time decay of every opplist and of the public ones (`Tactical/OppList.cc:4540`, `:4494`) | yes: his entries age, though he never looks again | `nonCombatDecayPublicOpplist`, `decayPublicOpplist` (`mercsInSector`) | yes |
| The end-of-combat check's merc-slot loops on our opplists (`Tactical/Overhead.cc:4162`, `:4190`, `:4273`) | yes | `checkForEndOfCombatMode`, `weSawSomeoneThisTurn` (`mercsInSector`) | yes |
| The other merc-slot loops of `Tactical/OppList.cc`, `TacticalAI/AIUtils.cc`, `TacticalAI/Attacks.cc` and `TacticalAI/Knowledge.cc`, which go by opplist entries | only through an entry, which no opponent holds: he is never seen, and boarding is refused with enemies in the loaded sector | `placed` | yes |
| `SayQuoteFromAnyBodyInSector` (`Tactical/Dialogue_Control.cc:1342`) and an NPC starting a talk, which want a squad | no | `okControllableMerc`, `assignedBelowDuty` | yes |
| `EVENT_BeginMercTurn`'s blood, breath collapse, getting up, opplist decay in combat, x-ray and personality (`Tactical/Soldier_Control.cc:4019-4100`); a nervous merc's friend in the sector at his turn start and in the hourly morale (`TacticalAI/AIUtils.cc:1491`, `Tactical/Morale.cc:173`) | yes; two passengers stand no tile apart | `beginMercTurn`, `distanceToClosestFriend` (`turns/personality.ts`, `campaign/team-morale.ts`) | yes |
| `IsTeamActive` (`bMenInSector`, `Tactical/Overhead.h:178`), which for our team counts every soldier made for it (`Tactical/Soldier_Create.cc:453`), wherever he is | yes | `isTeamActive`: our whole team, the soldiers in the sector of the others | yes |
| `CheckForLosingEndOfBattle`, its capture and its kill loop, which leaves `SOLDIER_DEAD` to the strategic death (`Tactical/Overhead.cc:4959`, `:5041`, `Tactical/Soldier_Ani.cc:2885`); the surrender's capture (`Tactical/Civ_Quotes.cc:161`) | yes | `checkForLosingEndOfBattle`, `BattleFlow.battleLost`, `BattleFlow.#captureSurrenderedMercs` | yes |
| `HandlePlayerTeamMemberDeath`'s next selection, which `SelectSoldier` then refuses, keeping the dead selected; its death rules and buddy lines (`Tactical/Overhead.cc:2192`, `:2210`) | yes | `deathSuccessor`, `playerTeamDeathRules`, `inSectorBuddyKilledQuotes` | yes |
| `SoldierTakeDamage`'s branch for a soldier in the sector (`Tactical/Soldier_Control.cc:5366`, `:5401`): bleeding to death is a tactical death with no body at `NOWHERE` (`Tactical/Rotting_Corpses.cc:611`), and a gunshot with no hit animation leaves him at life 0 for good | yes | `handleTakeDamageDeath` | yes |
| `CommonEnterCombatModeCode`, `ExitCombatMode`, `CencelAllActionsForTimeCompression` (`Tactical/Overhead.cc:3913`, `:4057`, `:5871`) | yes | `commonEnterCombatModeCode`, `exitCombatMode`, `cancelAllActionsForTimeCompression` | yes |
| `CheckForEndOfBattle`'s count of the battles fought (`Tactical/Overhead.cc:4557`) | yes | `ourMercsFinishFoughtBattle` | yes |
| `CivilianGroupMemberChangesSides` (`Tactical/Overhead.cc:2723`) | yes | `civilianGroupMemberChangesSides` (`placed`; deviation "Rebel aboard the helicopter") | no |

**Boarding and leaving.** `AddSoldierToVehicle` and `ExitVehicle` keep their original order in the strategic code
(`strategic/economy/vehicle-assignment.ts`, `strategic/forces/vehicles.ts`), which reaches the loaded map through
`TacticalWorldPort.loadedVehicles`: the takeover of a vehicle not ours (`ChangeSoldierTeam` and a roster merc of kind
`VEHICLE` with the original's zeroed squad and group, `RecruitFlow.takeOverVehicle`), the selections the original makes
on the game screen only, and the exit tile with its sight. The tactical click (`enterVehicle`) and the team panel's
button (`exitVehicle`) go through `TacticalState.vehicleHooks.boarding`, which the sandbox lacks, so it refuses both
(`notInCampaign`): boarding changes squads, groups and assignments. The map screen's `boardVehicle` and `leaveVehicle`
reach the same code, so a civilian vehicle of the loaded sector is taken over from either screen, and a merc leaving
on the loaded map stands where `ExitVehicle` puts him (`29` §8.8).

**Leaving the sector.** The exit check and the exit dialog's choices are the original's, which count the vehicle alone
(`campaign/sector-exits.ts`, `16`). The vehicle then drives off as its own movement group with everybody aboard, so its
record, its passengers and its soldier travel together as on the map screen, and a sector load brings them in as a
vehicle group's arrival does (deviation "Vehicle sector exit").

**Repair and refuel.** The toolkit and the gas can are tile tools (`tactical/tile-tools.ts`, `12` §7) aimed at the free
tile closest to the vehicle, as boarding is; the walk-up search then takes that tile as its target, so the merc may stop
beside it, and the pending action holds the vehicle's own tile for the arrival. The toolkit's arrival sets the `REPAIR`
assignment through `VehicleHooks.boarding.setAssignmentRepair` (`setSoldierAssignmentRepair`), which keeps the
original's id (deviation "Toolkit repair in tactical"); the gas can pours at code 769 (`addFuelToVehicle`,
`vehicles/vehicle-fuel.ts`) into the soldier on the tile its `pendingActionData2` holds, as the original reads
`sPendingActionData2`. The sandbox has no `boarding` port, so it refuses both (`notInCampaign`), as it refuses boarding.

**Where the mercs aboard count.** The original keeps them in by default and skips the seat where it says so; ja2-node
reads the seat at the same places (`tactical/vehicle-presence.ts`). They look, hear and radio, and enemies see them at
the vehicle's tile (`08`); a vehicle of ours never looks. The cursor never finds them (`findSoldierAtGridNo`, the
client's `findSoldier`), they take no orders (`crewRefusal` in `actRefusal`, `inVehicle`) and are no member of a
multi-selection. A vehicle of ours is ours to command only with somebody aboard (`IsOwnedMerc`, `noDriver`), and a
vehicle with nobody aboard, an enemy tank or a civilian car, gets no locator at its AI turn. The view lists them with
their seat at the vehicle's tile and the vehicle with its passengers, whom its squad's team panel shows in its place;
the driver shows the vehicle's APs (`29` §8.8). Auto-bandage counts them as neither medic nor patient, yet its patient
search keeps a merc aboard as a candidate and drops him for want of a free tile beside the vehicle (`12` §8); a merc's light in a vehicle is the client's (deviation "Merc light in a vehicle").

**Quest action items.** The Kingpin and museum alarms and the brothel room scene are action items the bomb queue runs
like any other (`12` §6): our soldiers set them off by stepping on their pressure plates or on a switch of their
frequency, and the queue runs them with sight disallowed and the AI held. `bombs/item-action.ts` hands them to
`narrative/quest-items.ts`; the scene's door closer is the queue's own door action.

**The hospital.** Each merc's price modifier lives on `RosterMerc.hospitalPriceModifier` (imported from native saves);
leaving the hospital assignment refunds what he did not use (`setTimeOfAssignmentChange`).

**Randomness.** Gameplay draws keep the original's statement order on `main` and `pre`. The helicopter's "enemies
spotted" quote pick is cosmetic (deviation "Cosmetic draws of the helicopter").

**Saving.** ja2-node saves `NarrativeState`, the helicopter state, the drop and the boxing record whole. A native import
fills the facts, quests, profiles and general-info globals (`strategic/narrative/save-import.ts`) and the boxing state
and boxer flags.

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
| The end of a match, which ends combat as a won battle, leaves the militia and the civilians alert, with their noises, orders and awareness: the won battle's peaceful loops sit inside its `NOT_BOXING` block (`Tactical/Overhead.cc:4641-4672`) | `src/sim/tactical/narrative/boxing.test.ts` "leaves the militia and the civilians alert …" |
| The Kingpin alarm rings again at the next step: its "zap" clears the disabled flag it means to set | `src/sim/tactical/narrative/quest-items.test.ts` |
| The museum alarm calls Eldin while sight is off, so he never sees the spot and always runs to it | `src/sim/tactical/narrative/quest-items.test.ts` |
| A crash or a wreck that kills everyone aboard stops at the first passenger already dead; those seated behind him survive | `src/sim/strategic/forces/vehicles.test.ts`, `src/sim/campaign/vehicle-destruction.test.ts`, `src/sim/campaign/vehicle-passengers.test.ts` "are spared behind a merc already dead …" |
| A passenger killed with his vehicle loses 100 life and 100 breath to bleeding on its tile and, sitting, dies at once with no fall to play | `src/sim/campaign/vehicle-passengers.test.ts` "each take 100 life …" |
| A passenger breathes the gas of his vehicle's tile without a mask, and is tested again at every placement of the vehicle, its own tile included | `src/sim/tactical/vehicle-passengers.test.ts` "is gassed on the vehicle's tile …", "tests his tile's gas again …" |
| The mercs aboard stay in the sector at the vehicle's tile: they look and are seen, yet the cursor and every order that names a soldier pass them by, though their merc slots come before the vehicle's | `src/sim/tactical/vehicle-presence.test.ts` "lets the mercs aboard look …", "are never found on the vehicle's tile …", "are no target of an order …" |
| A vehicle of ours with nobody aboard is not ours: it cannot be selected or ordered, though it stays on our team and squad | `src/sim/tactical/vehicle-presence.test.ts` "is not ours to select or order …", `src/sim/campaign/vehicle-presence.test.ts` "is no longer ours to select …" |
| The passengers enter a sector before their vehicle, in the slots below its 18 or 19, and come to its tile only when it is placed | `src/sim/tactical/insertion.test.ts` "is registered in his merc slot without a tile …", `src/sim/campaign/vehicle-passengers.test.ts` "come in with it …" |
| A helicopter passenger over the loaded sector keeps a merc slot with no tile: boarding takes his tile and leaves the slot, and a sector load or a native import gives him one in id order, his APs and his walk left as they were | `src/sim/campaign/helicopter-flow.test.ts` "keep their merc slot when they board …", "enter their merc slots with no tile …", `src/sim/tactical/vehicle-passengers.test.ts` "takes his merc slot at a sector entry …", `src/sim/tactical/save-import.test.ts` "puts the helicopter's passenger in his merc slot …" |
| The overhead pass handles a helicopter passenger like any merc slot, his frames running with no tile, while every loop gated on a tile or a sighting passes him by | `src/sim/tactical/vehicle-passengers.test.ts` "leaves his tile at boarding …", "is handled by the overhead pass …" |
| A vehicle entering a sector takes the closest tile its structure fits on in the insertion direction, else in the first of the eight that fits, and keeps that direction as its insertion direction | `src/sim/tactical/insertion.test.ts` "turns to the first of the eight directions …" |
| A vehicle joining our team takes soldier id 18, else 19, else it cannot join and is gone from the map: two ground vehicles at most (a boarding checks the slot first, deviation "Third vehicle of ours"); a tank of ours would search from id 0 | `src/sim/tactical/narrative/team-change.test.ts`, `src/sim/campaign/vehicle-registration.test.ts`, `src/sim/campaign/vehicle-boarding.test.ts` "takes a second vehicle over as soldier 19 …" |
| A merc never boards from where he stands: his own tile is never free to him (`NewOKDestination` finds him there), so beside a vehicle he walks round it to the next free tile first; on arrival he gets into whatever enterable vehicle stands on the tile, allowed or not by then | `src/sim/tactical/vehicle-boarding.test.ts` "never boards from where the merc stands …", "walks to the free tile closest to the vehicle …" |
| Leaving a vehicle takes the free tile closest by rows and columns within 5 tiles, else within 20, whatever the merc's body needs there; ties go to the first tile of the square, the north-west first | `src/sim/tactical/vehicle-boarding.test.ts` "takes the free tile closest by rows and columns …" |
| A vehicle squad's sector exit counts the vehicle alone, never the squad (its passengers are on no squad), and the vehicle drives toward the edge, the one move a vehicle makes on the tactical map, only as far as its path goes straight ahead: a vehicle other than a tank never turns and its move waits for the turn, so it stops for good where a step needs another facing and the walk-off timer takes it out; its passengers then leave with it (deviation "Vehicle sector exit") | `src/sim/campaign/vehicle-boarding.test.ts` "counts the vehicle alone at the exit …", "never moves a vehicle facing away …" |
| A toolkit or a gas can works on any vehicle at ground level, an enemy tank and a civilian car the squad may not board yet included; its cursor turns good over any tile of it | `src/sim/tactical/tile-tools-vehicles.test.ts` "pour fuel into a neutral truck and walk to an enemy tank alike", `src/server/hints-strategic-stub.test.ts` "turn good over any tile of the Hummer …" |
| The walk of a toolkit or gas can goes to whichever of the free tile closest to the vehicle and its four neighbours is the shortest walk, so he may stop a tile short, not beside the vehicle, and works on it from there | `src/sim/tactical/tile-tools-vehicles.test.ts` "walks one tile short of the sweet spot …" |
| A merc who already stands where the walk would end repairs or refuels nothing: the begin looks for the vehicle on the free tile instead of the vehicle's | `src/sim/tactical/tile-tools-vehicles.test.ts` "does nothing from the tile it would walk to …", "pours nothing from the tile it would walk to …" |
| The repair and refuel cursors take the door rules of the walk-up search and the order not: when the free tile closest to a vehicle is a door's, the cursor shows a step onto it from the tile beside, where the order does nothing | `src/sim/tactical/tile-tools.test.ts` "shows a step onto the door tile …" |
| The toolkit puts the merc on `REPAIR` under the vehicle soldier's id, an INT8, where a vehicle id is meant (deviation "Toolkit repair in tactical"), off his squad; with nothing around to repair it changes nothing | `src/sim/tactical/tile-tools-vehicles.test.ts` "hands the strategic side the car soldier id as an INT8 …", `src/sim/campaign/vehicle-tools.test.ts` |
| Repair and refuel ask for the crouch plus 5 or 10 APs but take only the walk and the crouch | `src/sim/tactical/tile-tools-vehicles.test.ts` "walks one tile short …", "walks up, pours the can …" |
| The gas can pours 50 fuel per point of status and loses a point per whole 50 poured, so 180 fuel costs it 3 points and 49 none; a full tank takes nothing | `src/sim/vehicles/vehicle-fuel.test.ts` |
| A tank's soldier carries profile `NPC164`, the unused jeep's, and a full tank | `src/sim/tactical/vehicle-soldiers.test.ts` |
| A civilian or enemy vehicle leaves the list at every unload of its sector and registers again at the next load, maybe under another id; a destroyed vehicle elsewhere leaves it only at the next registration | `src/sim/campaign/vehicle-registration.test.ts`, `src/sim/vehicles/vehicle-list.test.ts` |
| Skyrider's profile follows his helicopter only while a refuel site is the loaded sector, and leaving it clears x and y but not z; a landing there brings him back only at the next load | `src/sim/strategic/forces/helicopter.test.ts`, `src/server/sector-kinds-stub.test.ts` |
| A landing or takeoff at the loaded refuel site changes the helicopter's structures but not the movement costs: the path over its tiles stays open after a landing and blocked after a takeoff until the next sector load | `src/sim/tactical/landed-helicopter.test.ts`, `src/server/sector-kinds-stub.test.ts` |
| Adding the helicopter bumps every soldier of the ten-tile square around the landing site off his own tile, under the helicopter or not, the square ending a tile short south and east; one bumped onto a tile the sweep has still to visit is bumped again | `src/sim/tactical/landed-helicopter.test.ts` |
| A later round of the drop starts one step into APPROACH and rests 29 steps, not 30: GOTO_EXIT sets the script to 0 before the step's increment (`Tactical/Merc_Entering.cc:738`, `:770`) | `src/sim/tactical/helicopter-drop.test.ts` "starts a later round one step into APPROACH …" |
| The Esc skip leaves the fade flags as they were, so after a skip in the fade-out the next run fades in and straight out and ends in MOVETO before its seat drops, forgetting the seat and leaving its shadow on the map (`Tactical/Merc_Entering.cc:462-504`, `:542`) | `src/sim/tactical/helicopter-drop.test.ts` "leaves the fade flags set …" |
| A merc taken out of `HELIDROP` before code 467 (a hit, a collapse) leaves the drop engaged: it hovers in DROP until the skip, and every later run hovers before its first merc, as only code 467 clears `gfIngagedInDrop` (`Tactical/Soldier_Ani.cc:980`) | `src/sim/tactical/helicopter-drop.test.ts` "stalls in DROP …", "stays engaged after a stall …" |
| MOVEAWAY flies once, with no repeat: `REPEAT_HELI_MOVEAWAY` is the 640x480 screen's offset over 7, which is 0 (`Tactical/Merc_Entering.cc:37`, `UILayout.cc:68`) | `src/sim/tactical/helicopter-drop.test.ts` "flies MOVEAWAY once …" |
| Only the first run syncs the strategic turn times, so a later run's end leaves the real-time turn due and the first poll after it runs one at once (`Tactical/Merc_Entering.cc:780`) | `src/sim/campaign/helicopter-drop-flow.test.ts` "flies a later arrival in the loaded start sector …" |
| A helicopter piece destroyed in the sector stays off the map after a load, but comes back at the next sector entry: the entry adds the helicopter a second time after the map changes took the piece away (`Strategic/StrategicMap.cc:520` after `:880`) | `src/sim/campaign/sector-flow.test.ts` "brings a helicopter piece destroyed …", "keeps a helicopter piece destroyed before the save …" |

Not pinned yet:
- `ENOUGH_LOYALTY_TO_TRAIN_MILITIA` reads the town of the sector above when underground, and `WALKER_AT_BAR` ignores
  Father's level (`check-fact.ts`, `economy-facts.ts`).
- Confirming a helicopter route that adds no sector still takes off: the helicopter stays airborne where it stood,
  without hovering (`confirmHelicopterRoute`).
- A sex action item on a tile outside the three listed rooms only stops the merc (`sexActionItem`).

## 4. Not checked against the native build

The oracle compares facts, quests and `CheckFact` for all 500 ids with the talk context set, the boxing club, the
helicopter, the robot's control, the NPC system events with Kingpin's money and the hospital, the quest action items,
and ground vehicles: creation, the boarding click and its walk, the takeover, leaving, damage, destruction with the mercs
aboard, repair, the toolkit's and gas can's walks, the fuel, and the line of sight to the mercs aboard
(`tools/oracle/README.md`, "Facts and NPC presence", "Boxing", "Helicopter", "Recruiting", "NPC actions", "Give",
"Vehicles").
Inferred from reading the source:
- The quest rules of a new sighting other than the hostile-quote list, the escorts' arrivals, the neutral assassins'
  approach and the profile deaths other than the Queen's: unit tests on stub soldiers only.
- The terrorists' and assassins' toughening item ladder.
- The profile flag and Pacos' fact set when our team hurts an NPC, and the creature queen's death beginning only with
  a killer.
- That checking Skyrider's monologues once per strategic step matches the map panel's redraws.
- The toolkit's repair assignment at the end of its walk (the probe stops the walk), and a vehicle's battle sound
  spoken by a passenger.
- Skyrider's and the vehicles' profile sectors: the helicopter probe's dump records neither, though its saves load B13.
- The drop: `tools/oracle/helidrop-compare.ts` replays the oracle's new games and compares our mercs and the drop frame
  by frame (`tools/oracle/README.md`, "Helicopter drop"), up to the frame where the A9 garrison's AI begins combat,
  which the dump cannot replay. A native save in mid-drop was imported by hand only, as its import lands the seats
  (deviation "Helicopter drop in a native save"), and the frames after the native `SaveGame` are not compared.
- The helicopter's passengers over the loaded sector: `tools/oracle/heli-passengers-compare.ts` imports `SaveGame01`
  and compares boarding in tactical, the turn starts in and out of combat, the nervous ones, quotes from anybody, damage
  and a death, the losing check with its capture and its kill, the frames after them and a native save with a passenger
  and its load. Not probed: a death's buddy lines and selection, combat start and end and the compression stop, the
  battles fought, the shoot-down over the loaded sector.
- The helicopter on the map: no probe dumps the structures or the soldiers' tiles after a load of the airport with the
  helicopter on the ground; the stub helicopter (`stubs/helicopter.ts`) has its own shapes, so stub tests pin the pieces'
  order and the bump, the original's structure data only through a native save made at the airport
  (`src/server/save-session.test.ts`).

Not ported: gaps "Strategic move refusals" (the museum check with no map loaded), "Helicopter entrance" (the lock's two
steps), "Helicopter passengers elsewhere" (the tests of `bInSector` outside the turn and battle hooks). Deviations of
this domain: "Helicopter on load", "Toolkit repair in tactical", "Helicopter drop statics", "Helicopter run start",
"Helicopter drop cut short", "Helicopter drop in a native save", "Helicopter exit over the loaded sector", "Rebel
aboard the helicopter".
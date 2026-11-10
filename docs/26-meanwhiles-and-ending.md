# 26 — Meanwhile scenes, the Queen and the end of the campaign

Meanwhile scenes from their posting to their implications, played in P3_m or N7, captures and prisoners,
the narrative effects of the first battle, the progress milestones, the palace (the Queen's escape, the O3 statue), the
deaths of the two queens and the end of the campaign. Siblings: `15` the event queue, pause locks, compression; `16`
sector loads and temp files; `17` the Queen's AI (waking, SAM squads, `QUEEN_DEAD`, progress, the creature quest); `18`
town liberation and loss, SAM control; `19` battle ends, surrender, autoresolve captures; `24` the records, dialogue
queue and talk session the scenes run on; `25` facts and quests; `35` the NPC action catalog and placement; `13` the
Queen's escape hook; `29` events, flows and refusals; `30`, `31` the story screens, ending videos and credits. Each
module's `@src` header names the Stracciatella functions it ports; read those for the rules and their order. Data:
scene flags, sectors, NPCs, camera gridnos and the queens' witness sets in `data/tables/narrative-scenes.json`
(`tools/transcribe/narrative-scenes.ts`); the Queen's and Elliot's per-scene record files in
`data/externalized/script-records-control.json`; the milestones in `game.json` `progress`. The records of the Queen,
Joe, Elliot, Derek and Oliver and the maps P3, P3 b1, P3_m, N7, O3, I13 are the user's data or the stub pack's
(`stubs/npc/records.json` with every scene's record files, `stubs/maps/n7.map.txt`, `p3.map.txt`, `p3_b1.map.txt`,
`p3_m.map.txt`; none for O3 or I13; `32` §1.6).

## 1. Where things live

Paths are under `src/sim/`.

```
posting: towns, SAMs, outskirts, flowers, chopper,     strategic/ai/meanwhile.ts (scheduleMeanwhileEvent, the posters)
  creatures, scientist, first battle, interrogation      callers: economy hooks (18), map/control.ts, laptop/florist.ts,
                                                         helicopter-flow.ts, creature-flow.ts, the hourly milestones,
                                                         battle-flow.ts, merc-fate.ts
EVENT_MEANWHILE: repost while enemies are loaded,       strategic/ai/meanwhile.ts (handleMeanwhileEvent, beginMeanwhile)
  else pause, lock, trying
  gates: no battle decision, dialogue idle              campaign/meanwhile-flow.ts (MeanwhileFlow.afterStep)
    the box: OK and Skip for a scene seen before        MeanwhileFlow.answer, the seen flags via campaign/installation.ts
    a palace scene → P3_m loads, the Queen's record 0   MeanwhileFlow.goToThePalace → campaign/sector-flow.ts
    the interrogation → N7 loads, the Queen's record 0  MeanwhileFlow → campaign/sector-flow.ts
      rules while a scene runs                          tactical/narrative/meanwhile-rules.ts, queen-slap.ts
      its actions, the lie prompt                       tactical/narrative/npc-actions/meanwhile.ts, requestors.ts
      END_MEANWHILE, Esc (endMeanwhile) → endMeanwhile  campaign/narrative/meanwhile-actions.ts, MeanwhileFlow
      the way back from P3_m after the step             MeanwhileFlow.settle → returnFromThePalace
capture: begin, each captive, end                       campaign/merc-fate.ts
  POWs placed by a sector load; the I13 path checks     campaign/pow.ts, tactical/narrative/pow-rules.ts
the first battle's facts and scene                     campaign/battle-flow.ts
the 35/50/70 % milestones                               strategic/ai/difficulty.ts → strategic/narrative/hourly.ts
the palace: the Queen's escape, the O3 statue           tactical/ai/queen-escape.ts, tactical/narrative/statue.ts
a queen dies                                            tactical/combat/death.ts, tactical/narrative/death-rules.ts
  └ timers, quotes, the squad upstairs, Derek, the end  campaign/endgame-flow.ts
```

| Module | Holds |
|---|---|
| `strategic/ai/meanwhile.ts` | Scheduling, the posting functions, the event, `areInMeanwhile`, the implications, scene names |
| `strategic/ai/queen-state.ts` | `MeanwhileState`: flags, definitions, the current scene, `trying`, `inScene`, the NPC saves, the return trip, the skip of the scene map's save, the scene log |
| `campaign/meanwhile-flow.ts` | `MeanwhileFlow`: the gates, the box and Skip, a scene's start and end, the round trip to P3_m, Esc, the scene NPCs' moves, the record selectors' queries, the log |
| `campaign/installation.ts`; `src/server/installation-store.ts` | The installation's seen flags as the simulation reads and sets them (`InstallationSettings`); the server's file of them |
| `tactical/narrative/meanwhile-rules.ts`, `queen-slap.ts` | The tactical rules while a scene runs (hits, punches, Elliot, the slap check, the kept attacker); the slap's opcodes |
| `tactical/narrative/npc-actions/meanwhile.ts`, `requestors.ts`; `campaign/narrative/meanwhile-actions.ts` | The scene and endgame NPC actions (`35`'s catalog dispatches them); the lie prompt and the liar; the campaign side: slaps, punches, Elliot's shot, the endgame states |
| `campaign/merc-fate.ts` | The capture sequence and each captive (`19` calls it) |
| `campaign/pow.ts`, `tactical/narrative/pow-rules.ts` | `PowFlow`: POWs placed by a sector load, the Alma quest's end; the I13 path checks after a door or an explosion |
| `tactical/ai/queen-escape.ts`, `tactical/narrative/statue.ts` | The Queen and Joe running for the basement stairs; the O3 statue |
| `campaign/endgame-flow.ts`, `ending-state.ts` | `EndgameFlow`, the phases from a queen's death to the victory; `EndingState`, `campaignStatus` |
| `campaign/story-refusals.ts`, `story-import.ts`, `narrative/story-events.ts` | The story refusals and the reported flow; the native import; the story events |
| `src/content/narrative/scenes.ts` | Loader of `narrative-scenes.json`; the simulation reads the witness sets and the camera tiles |

`CampaignSim` runs `meanwhile.afterStep()` and `endgame.afterStep()` after every tick, answers the strategic world's
`inMeanwhile()` with `areInMeanwhile`, and is not idle while a scene tries to start or runs or the endgame is active.
The tactical narrative port (`campaign/narrative-port.ts`) routes the queens' deaths and the POW path checks.
`SectorFlow.mapsNeededSoon` prepares N7 while the interrogation may come, P3_m from the posting of a palace scene until
it has played or been skipped, P3 and P3 b1 in P3, O3 b1 in O3. Inside a meanwhile `SectorFlow.mapPathOf` names `P3_m` for P3, as
`GetMapFileName` does with `AreInMeanwhile`.

## 2. Design

**The box.** Once the gates pass, the box comes up as `BringupMeanwhileBox` shows it. For the interrogation or a scene
not seen yet it offers OK alone, and that OK is taken as given (the box is a client modal, deviation "Meanwhile box
timing"): it lifts the pause lock and the pause as the original's box does on its way out, and the scene starts. A
scene seen before opens the `meanwhile` decision prompt (D15, `ok` and `skip`) instead, under the pause and the lock
`BeginMeanwhile` set, and waits for its answer. `skip` runs the original's skip branch alone: the implications, the
pause lock and the pause lifted, a log entry marked skipped and `meanwhileSkipped`; nothing moves, nothing loads, the
dialogue queue is kept and on the map compression goes on. `ok` starts the scene as an unseen one starts.

**The seen flags belong to the server, as `Ja2.set` belongs to the installation.** The simulation reads a scene's flag
through `InstallationSettings` when its box comes up (never for the interrogation) and sets it in `endMeanwhile`, as
`EndMeanwhile` calls `SetMeanwhileSceneSeen` (Esc included; a skipped scene is not set). The server keeps them in
`installation.json` beside its saves (`InstallationStore`, read and written at each use, so every session and worker
shares them), and the browser hands over the flags an older page kept (`/api/installation`, merged by OR). The read is
not state: the prompt it opened is, so a reload with the box up reads nothing again, and the session logs each read
in its input log, from which a replay answers the box (`27` §1.7).

**Every scene that starts is played.** Its NPCs move, the scene's sector loads through the sector flow, the
conversation is engaged with one reference, and the Queen's record 0 plays on `24`'s record engine and `11`'s combat;
the conversation locks the pause again at its next dialogue pass, so world time stands while the scene runs. Tactical
ticks run; the freeze an idle conversation puts on ticks does not apply inside a scene, as the original keeps animating.
Commands other than queries, `answer`, `skipLine` and `endMeanwhile` are refused (`inMeanwhile`), and the scene is
reported as the `meanwhile` flow with `meanwhileStarted` and `meanwhileEnded` (`29`). `meanwhileStarted` carries the
tile the view goes to after the load, the camera table's entry for `currentId`, the meanwhile scheduled last (§3), and
`mapScreen` for a scene started on the map screen, the only one whose entry into the game screen comes after its load
and so locates the Queen; the client moves the camera (`30`). A scene whose map cannot load, or whose Queen's or
Elliot's record file is missing, ends at once (deviation "Meanwhile scene without its files").

**Palace scenes and the round trip.** `goToThePalace` records where to come back to (`MeanwhileState.returnTrip`: the
loaded sector or none, the selected sector, the screen), moves the scene NPCs and loads P3_m, so the player's sector is
saved and left with its exit quest code, and the hall's load adds no enemies, skips the palace's civilian setup and sets
no `ALREADY_VISITED`; a load from no world trashes nothing, as the original's `TrashWorld` returns at once. While the
scene runs the player view shows every soldier of the hall (`SHOW_ALL_MERCS`, the tactical state's
`pathEnv.showAllMercs`), for the UI and agents alike (D16). `END_MEANWHILE`, a selector's end or Esc (`endMeanwhile`,
the original's check before the UI lock and the menus) run `EndMeanwhile` at once: the queue emptied, the implications,
the log entry, the conversation and the pause released. The way back is the fade's callback, so it waits until the step
or the command is done (`MeanwhileFlow.settle`): a line still talking is cut as the load starts, the hall is left
unsaved (`skipSectorSave`, the original's `gfWasInMeanwhile`), the old sector loads again or the hall is trashed when
none was loaded, the selected sector comes back, the NPCs are restored after the reload, and a scene started on the map
enters the map again, whose entry selects the loaded sector. The hall's load from the map sets X1, so the map's entry on
the way back finds X1 and sets X0; the interrogation's load of N7 from the map sets X1 too (deviation "Speed on a sector
load from the map": Stracciatella keeps the map's mode, stopped, through the scene and back). Mercs come back on their
tiles because every step sets their insertion to the tile, as the original's does; the insertion code lives on the
soldier for that. With P3 itself the loaded sector, `SetCurrentWorldSector` loads nothing either way: the scene plays on
the palace map with whoever stands there, and the way back cuts no line, as the original stops speech only in its load
branch.

**The waiting window is kept.** `trying` spans the event to the gates, as `gfMeanwhileTryingToStart` does: while it
is set, compression and saves are refused and the campaign is not idle, so a scene still waits for a battle decision,
a busy dialogue queue or somebody talking. A meanwhile due in the current second delays group arrivals by a minute and
refuses sector control changes (`16`, `18`), except during a tactical traversal.

**The interrogation** changes the captives' life and experience, sets facts, asks the lie question and leaves the
player in N7. N7 loads with only its item diff, its garrison and the captives; while the scene runs the Queen and Elliot
read their interrogation record sets. The lie is an `npcRequest` prompt (`request: 'lie'`); Esc does not end it. The
scene ends with the captives free on one squad in N7 among the garrison; the previous world is not restored.

**Captures.** The tactical loss, the tactical surrender and autoresolve share the capture sequence (`19`): the first
capture sends the captives to Alma I13 (`HELD_IN_ALMA`), the next to N7 with the interrogation posted at the absolute
world minute 10, which the next event pass finds long overdue. A fourth captive gets the first one's tile (deviation
"Fourth captive"). A sector load puts captives held outside I13 on one new squad; in I13 they stay prisoners
(`powsFound`) until a door opens or an explosion gives them a path out (`powFreed`). Either way the load ends the Alma
quest with the rescue experience for the current squad.

**The palace.** The Queen and Joe flee to the basement stairs from the red and black AI decisions (`13`); the army's
first red alert radio in P3 puts both on red. Once the player has taken P3 b1 she stands at an alternate spot upstairs
and no longer flees. The O3 statue opens from the remote trigger in its room or from an explosion next to it; the
structure swap and the exit grid go into the sector's map changes, so the sector diff keeps them.

**The endgame is a phase machine on ticks.** `EndingState.phase` follows the original's timers and fades from a
queen's death to the victory. The 2 s and 3 s wall-clock timers become 400 and 600 ticks, which also pass in
turn-based combat; fades take no time; dialogue-queue callbacks mark the end of the quotes. After the squad moves up
to P3, a missing Derek runs `ENDGAME_STATE_1` at once instead of locking the UI for good (deviation "Endgame without
Derek"). The flow reported to agents is derived (`storyFlow`): `endgame` while an endgame flag is set, `ended` once
the victory is recorded; commands are refused with `endgameInProgress`, then `campaignOver`. There is no restart: the
session ends with `campaignWon` and `observe.ended`, whose `ending {miguelAlive, skyriderAlive}` picks the ending
videos (deviation "Endgame timing"; the videos and credits are presentation, `30`, `31`).

**Winning and losing.** The campaign is won when Deidranna is dead and either the creature quest was not in progress
at `ENDGAME_STATE_1` or somebody later killed the creature queen. The original has no game over: with no usable mercs
left, battles end through the lost-battle path and compression is refused; ja2-node does the same (`noUsableMercs`).

**Randomness.** Gameplay draws keep the original's order on `main` and `pre`: the flower and chopper delays (only while
their flag is clear), the `Random(121)` of each repost while enemies are loaded, a captive's life, the lie's
`PreRandom`, and a scene's sector loads, there and back, its walks, punches and shot through their systems. The lie's
silent curse draw is not made (deviation "Cosmetic draws in attacks"). The original's race between the capture box and
the interrogation's box is defined: the lost battle unloads first (deviation "Meanwhile wall-clock races").

**Saving.** ja2-node saves the meanwhile state and the ending whole and refuses a save while a scene tries to start or
runs. A native import refuses a save made in a scene or the endgame and restores `trying` with the clock paused and
locked again. The last scheduled id, an unsaved static of the original that only its scene camera reads, is saved
with the meanwhile state (deviation "Last scheduled meanwhile").

## 3. Quirks of the original the code keeps

Each looks like a bug and is the original's behaviour. Pinned by tests in `src/sim/` under these paths:

| Quirk | Test |
|---|---|
| Elliot's beating counter counts each scene when it is posted, skipped or not, stops at 17 and wraps as `INT8` below it | `strategic/ai/meanwhile.test.ts` |
| Elliot's beaten face skips 16: no variant matches it | `narrative/face-variant.test.ts` |
| A scene's camera goes to the tile of the meanwhile scheduled last, not of the scene that plays: a palace scene playing after the interrogation was posted looks at the interrogation's tile (`Strategic/Meanwhile.cc:179`, `:367`) | `src/server/meduna-scene-stub.test.ts` |
| The interrogation is posted at absolute minute 10, and a repost while enemies are loaded counts from that stamp, so it fires again at every event pass | `strategic/ai/meanwhile.test.ts` |
| A meanwhile due in the current second takes precedence, except during a tactical traversal | `strategic/ai/meanwhile.test.ts`, `campaign/helicopter-flow.test.ts` |
| A first battle won or lost in a town in tactical waits for the next world trash, which any map load brings | `strategic/ai/meanwhile.test.ts` |
| An autoresolved first battle leaves the "being fought" fact set: only the tactical ends clear it | `campaign/battle-scenario.test.ts` |
| The creature scene is posted before the quest looks for an infestible mine, so Rat arrives even when the quest does not start | `strategic/creatures/creatures.test.ts` |
| The scientist scene puts Madlab and the robot in sector (0, 0) when no alternate map was chosen | `strategic/ai/meanwhile.test.ts` |
| A scene after the Queen's death wakes her AI again: nothing checks that she is dead | `strategic/ai/meanwhile.test.ts` |
| A played scene clears the scene NPCs' profile insertion and truncates their profile gridno to `INT8`; on the map it stops compression for good, its mode kept for the player to start again | `src/server/meduna-scene-stub.test.ts`, `campaign/meanwhile-flow.test.ts`; the oracle ("Meanwhile scenes") |
| The way back from a scene started on the map restores the selected sector, and the map screen's entry right after selects the loaded sector instead (`Strategic/Meanwhile.cc:591`, `Strategic/MapScreen.cc:1462`) | `src/server/palace-trip-stub.test.ts` "from the map with a world loaded …", `campaign/screens.test.ts` "selects the loaded sector …"; the oracle |
| A palace scene while P3 itself is the loaded sector loads neither P3_m nor anything on the way back (`Strategic/StrategicMap.cc:438`): it plays on the palace map, where a Queen fled to the basement says nothing and the scene stands until Esc | `src/server/palace-trip-stub.test.ts` "with P3 itself loaded …"; the oracle |
| The box's OK lifts the meanwhile pause lock; the scene's conversation locks the pause again at its next dialogue pass | `src/server/meduna-scene-stub.test.ts` |
| Skip changes the outcome: it runs the implications alone, so the scene NPCs keep their profile insertion, gridno and records, on the map compression runs on, and the scene is not marked seen; Esc in a played scene marks it | `src/server/meduna-scene-stub.test.ts` |
| A palace scene stalls when the player holds all four missile sites: the site count picks no record, and only Esc goes on. The outskirts shot cannot miss into a stall: a meanwhile shot's chance is 100 whatever the marksmanship | `src/server/meduna-scene-stub.test.ts` |
| With no world loaded the interrogation's load of N7 leaves a pending first-battle scene waiting for the next trash: `TrashWorld` returns at once | `campaign/meanwhile-flow.test.ts` |
| The hall's load uses up the guide's description of P3: it sets the sector's guide flag and draws the countdown | `src/server/palace-trip-stub.test.ts` |
| With no world loaded the way back trashes the hall without its exit quest code, and the skip of the hall's save lasts until the next load | `src/server/palace-trip-stub.test.ts` |
| A load of P3 in the second a palace scene is due loads P3_m without enemies but with the palace's civilian setup: the enemies read `AreInMeanwhile`, the setup only a scene under way | `src/server/palace-trip-stub.test.ts` |
| With Alma holding no enemies the first capture skips Alma silently and goes straight to the interrogation | `campaign/battle-scenario.test.ts` |
| The liar is chosen by wisdom alone: the comparison adds the candidate's leadership on both sides | `tactical/narrative/npc-actions/requestors.test.ts` |
| The creature queen's death begins only when somebody killed her, so a killer-less death after Deidranna's never ends the campaign | `tactical/combat/death.test.ts` |
| The I13 path checks of an opening door run before it opens, so that door frees a POW only at the next door or explosion | `tactical/doors/door-status.test.ts` |

Not pinned yet:
- Before reloading P3 the endgame sets the loaded sector's level to 1, which saves the loaded world under P3 b1: right
  when Deidranna dies in the basement, but a death upstairs writes the surface's items, corpses and doors over the
  basement's diff and reloads the surface from its older one (`#doneFadeOutKilledQueen`).
- Only the current squad's conscious mercs get the upstairs insertion gridno, but their whole groups move; P3's
  garrison counts are zeroed while its groups stay; Elliot leaves P3 by his profile's column becoming 1.
- The end comments come from every merc on the team wherever he is; the kill quotes only from witnesses in the
  queens' tables who see the tile.
- `INTERROGATION` never ends, so the capture tests that require it not started never pass again.
- The original shows the I13 box once per POW per load; `powsFound` lists them in one event.

## 4. Not checked against the native build

The oracle compares the posting functions with their draws, the event with and without enemies, a played scene's NPC
moves, the first-battle rules and the trash hook, the hourly milestones, captures with their history, `QUEEN_DEAD` and
the O3 statue (`tools/oracle/README.md`, "Meanwhile"), and the lie's answer through the actions probes ("NPC actions").
That probe compares the triggered record and the draws, which a check with the wrong chance can still match, so the
lie's chance is pinned by `requestors.test.ts`. Palace scenes are played natively frame by frame ("Meanwhile scenes"):
the outskirts scene from the game screen, a town scene from the map with compression on, a SAM scene from the map with
no world, Skip on a scene seen before and a scene with P3 itself loaded ended by Esc; the comparer replays both loads of
each trip draw for draw and compares the box, the hall, the camera tile, the lines said, the records, the NPC moves and
the reloaded sector. Not probed: the box's own pause lock (deviation "Meanwhile box timing"), OK on a scene seen before,
the interrogation sequence, the same-second precedence in a running campaign and the endgame; the stub scenarios cover
them (`src/server/interrogation-stub.test.ts`, `src/server/meduna-scene-stub.test.ts`, `src/server/endgame-stub.test.ts`).
Inferred from reading the source:
- The tactical AI keeps running under the conversation lock during the 2 s and 3 s endgame timers.
- The softlock without Derek and the surface-death overwrite.
- A surrender of five or more leaves the mercs past the fourth uncaptured.
- A native save is never made in a scene or the endgame.

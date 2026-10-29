# 26 — Meanwhile scenes, the Queen and the end of the campaign

Meanwhile scenes from their posting to their implications, the interrogation played in N7, captures and prisoners,
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
Joe, Elliot, Derek and Oliver and the maps P3, P3 b1, N7, O3, I13 are the user's data or the stub pack's
(`stubs/npc/records.json`, `stubs/maps/n7.map.txt`, `p3.map.txt`, `p3_b1.map.txt`; none for O3 or I13).

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
    a Meduna scene → resolved at once and logged        MeanwhileFlow → processImplicationsOfMeanwhile
    the interrogation → N7 loads, the Queen's record 0  MeanwhileFlow → campaign/sector-flow.ts
      rules while it runs                               tactical/narrative/meanwhile-rules.ts
      its actions, the lie prompt                       tactical/narrative/npc-actions/meanwhile.ts, requestors.ts
      REMOVE_ELLIOT_END_MEANWHILE → endMeanwhile        campaign/narrative/meanwhile-actions.ts
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
| `strategic/ai/queen-state.ts` | `MeanwhileState`: flags, definitions, the current scene, `trying`, `inScene`, the NPC saves, the scene log |
| `campaign/meanwhile-flow.ts` | `MeanwhileFlow`: the gates, a Meduna scene's resolution, the interrogation's start and end, the scene NPCs' moves, the record selectors' queries, the log |
| `tactical/narrative/meanwhile-rules.ts` | The tactical rules while a scene runs (hits, punches, Elliot, the slap check, the kept attacker) |
| `tactical/narrative/npc-actions/meanwhile.ts`, `requestors.ts`; `campaign/narrative/meanwhile-actions.ts` | The scene and endgame NPC actions (`35`'s catalog dispatches them); the lie prompt and the liar; the campaign side: slaps, punches, Elliot's shot, the endgame states |
| `campaign/merc-fate.ts` | The capture sequence and each captive (`19` calls it) |
| `campaign/pow.ts`, `tactical/narrative/pow-rules.ts` | `PowFlow`: POWs placed by a sector load, the Alma quest's end; the I13 path checks after a door or an explosion |
| `tactical/ai/queen-escape.ts`, `tactical/narrative/statue.ts` | The Queen and Joe running for the basement stairs; the O3 statue |
| `campaign/endgame-flow.ts`, `ending-state.ts` | `EndgameFlow`, the phases from a queen's death to the victory; `EndingState`, `campaignStatus` |
| `campaign/story-refusals.ts`, `story-import.ts`, `narrative/story-events.ts` | The story refusals and the reported flow; the native import; the story events |
| `src/content/narrative/scenes.ts` | Loader of `narrative-scenes.json`; the simulation reads only the witness sets |

`CampaignSim` runs `meanwhile.afterStep()` and `endgame.afterStep()` after every tick, answers the strategic world's
`inMeanwhile()` with `areInMeanwhile`, and is not idle while a scene tries to start or runs or the endgame is active.
The tactical narrative port (`campaign/narrative-port.ts`) routes the queens' deaths and the POW path checks.
`SectorFlow.mapsNeededSoon` prepares N7 while the interrogation may come, P3 and P3 b1 in P3, O3 b1 in O3.

## 2. Design

**Meduna scenes resolve instead of playing.** In the original OK plays the scene on `P3_m` and Skip runs only the
implications. ja2-node has no cutscene for the sixteen Meduna scenes: once the gates pass, a scene resolves at once
with a played scene's state effects (the scene NPCs' profile moves, Elliot shot in the outskirts scene, compression
stopped on the map, the implications), never the skipped variant's: the first viewing cannot be skipped and the seen
flags are an installation setting, so "played" is what a campaign gets. The player's sector is not unloaded and
reloaded; only the first-battle trash hook runs, even with no world loaded, because loading `P3_m` trashes one. A
resolution makes no draws (deviations "Meanwhile scenes", "Meanwhile without sector reload").

**The waiting window is kept.** `trying` spans the event to the gates, as `gfMeanwhileTryingToStart` does: while it
is set, compression and saves are refused and the campaign is not idle, so a scene still waits for a battle decision,
a busy dialogue queue or somebody talking. A meanwhile due in the current second delays group arrivals by a minute and
refuses sector control changes (`16`, `18`), except during a tactical traversal.

**A Meduna scene is information, not a decision.** Nothing the box offers changes the campaign once the reload is
gone, so it is no prompt (D15): it surfaces as the `meanwhile` event and the scene log (`observe.strategic.meanwhiles`,
`29`); on the map its compression stop ends a default strategic `advance`. Each log entry freezes what the scene's
record selectors would read (`MeanwhileContext`) for a server-side playback on `P3_m`; that sandbox is not built, so
the client shows only the box (gap "Meanwhile scene playback").

**The interrogation is played.** It changes the captives' life and experience, sets facts, asks the lie question and
leaves the player in N7, so it runs for real on `24`'s record engine and `11`'s melee. N7 loads through the sector flow
with only its item diff, its garrison and the captives; the Queen's record 0 starts the scene, and while it runs the
Queen and Elliot read their interrogation record sets. Tactical ticks run with the world clock paused; the freeze an
idle conversation puts on ticks does not apply inside a scene, as the original keeps animating. Commands other than
queries, `answer` and `skipLine` are refused (`inMeanwhile`); the lie is an `npcRequest` prompt (`request: 'lie'`).
The scene ends with the captives free on one squad in N7 among the garrison; the previous world is not restored. If
N7 cannot load, the scene ends at once.

**Captures.** The tactical loss, the tactical surrender and autoresolve share the capture sequence (`19`): the first
capture sends the captives to Alma I13 (`HELD_IN_ALMA`), the next to N7 with the interrogation posted at the absolute
world minute 10, which the next event pass finds long overdue. A fourth captive gets the first one's tile (deviation
"Fourth captive"). A sector load puts captives held outside I13 on one new squad; in I13 they stay prisoners
(`powsFound`) until a door opens or an explosion gives them a path out (`powFreed`). Either way the load ends the Alma
quest with the rescue experience for the current squad.

**The palace.** The Queen and Joe flee to the basement stairs from the red and black AI decisions (`13`); once the
player has taken P3 b1 she stands at an alternate spot upstairs and no longer flees. The O3 statue opens from the
remote trigger in its room or from an explosion next to it; the structure swap and the exit grid go into the sector's
map changes, so the sector diff keeps them.

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

**Randomness.** Gameplay draws keep the original's order on `main` and `pre`: the flower and chopper delays (only
while their flag is clear), the `Random(121)` of each repost while enemies are loaded, a captive's life, the lie's
`PreRandom`, and the interrogation's sector load and punches through their systems. The lie's silent curse draw is not
made (deviation "Cosmetic draws in attacks"). The original's race between the capture box and the interrogation's box
is defined: the lost battle unloads first (deviation "Meanwhile wall-clock races").

**Saving.** ja2-node saves the meanwhile state and the ending whole and refuses a save while a scene tries to start or
runs. A native import refuses a save made in a scene or the endgame and restores `trying` with the clock paused and
locked again. The last scheduled id is an unsaved static of the original that only its scene camera reads.

## 3. Quirks of the original the code keeps

Each looks like a bug and is the original's behaviour. Pinned by tests in `src/sim/` under these paths:

| Quirk | Test |
|---|---|
| Elliot's beating counter counts each scene when it is posted, skipped or not, stops at 17 and wraps as `INT8` below it | `strategic/ai/meanwhile.test.ts` |
| Elliot's beaten face skips 16: no variant matches it | `narrative/face-variant.test.ts` |
| The interrogation is posted at absolute minute 10, and a repost while enemies are loaded counts from that stamp, so it fires again at every event pass | `strategic/ai/meanwhile.test.ts` |
| A meanwhile due in the current second takes precedence, except during a tactical traversal | `strategic/ai/meanwhile.test.ts`, `campaign/helicopter-flow.test.ts` |
| A first battle won or lost in a town in tactical waits for the next world trash, which any map load brings | `strategic/ai/meanwhile.test.ts` |
| An autoresolved first battle leaves the "being fought" fact set: only the tactical ends clear it | `campaign/battle-scenario.test.ts` |
| The creature scene is posted before the quest looks for an infestible mine, so Rat arrives even when the quest does not start | `strategic/creatures/creatures.test.ts` |
| The scientist scene puts Madlab and the robot in sector (0, 0) when no alternate map was chosen | `strategic/ai/meanwhile.test.ts` |
| A scene after the Queen's death wakes her AI again: nothing checks that she is dead | `strategic/ai/meanwhile.test.ts` |
| A played scene clears the scene NPCs' profile insertion and truncates their profile gridno to `INT8`; on the map it stops compression and loses the mode | `campaign/meanwhile-flow.test.ts` |
| With Alma holding no enemies the first capture skips Alma silently and goes straight to the interrogation | `campaign/battle-scenario.test.ts` |
| The liar is chosen by wisdom alone: the comparison adds the candidate's leadership on both sides | `tactical/narrative/npc-actions/requestors.test.ts` |
| The creature queen's death begins only when somebody killed her, so a killer-less death after Deidranna's never ends the campaign | `tactical/combat/death.test.ts` |

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
the O3 statue (`tools/oracle/README.md`, "Meanwhile"), and the lie's answer through the actions probes ("NPC
actions"). That probe compares the triggered record and the draws, which a check with the wrong chance can still
match, so the lie's chance is pinned by `requestors.test.ts`. Not probed: a scene running in tactical, the
interrogation sequence, the same-second precedence in a running campaign and the endgame; the stub scenarios cover
them (`src/server/interrogation-stub.test.ts`, `src/server/endgame-stub.test.ts`). Inferred from reading the source:
- The implications and the scene loads read nothing of the player's world, and the scene soldiers write nothing back
  to profiles: the basis of "Meanwhile without sector reload".
- The tactical AI keeps running under the conversation lock during the 2 s and 3 s endgame timers.
- The softlock without Derek and the surface-death overwrite.
- A surrender of five or more leaves the mercs past the fourth uncaptured.
- A native save is never made in a scene or the endgame.

Not ported: gap "Meanwhile scene playback".

# 24 — NPCs and dialogue

NPC script records and how conversations choose and play them: record arrays, the talk session, giving items and money
to NPCs, triggers and scripted walks, the dialogue queue and its timing, civilian quotes and hints, recruiting R.P.C.s
and escorting E.P.C.s. Siblings: `25` the facts and quests records test and set, escorts, boxing, the hospital; `35`
what each NPC action does, NPC presence, schedules, civilian groups; `26` meanwhiles (which swap the Queen's and
Elliot's records) and the ending; `23` the shop; `22` R.P.C. pay and dismissal; `09` the named-NPC decision; `12` the
give animation; `14` save sections; `15` pause locks; `29` the agent API; `30` the talk panel on screen; `31` speech.
Each module's `@src` header names the Stracciatella functions it ports; read those for the rules and their order. The
scripts (records, quote numbers) live in the user's `npcdata/*.npc`, `data/tables/npc-script-records.json` and the stub
pack.

## 1. Where things live

Paths are under `src/sim/`.

```
talk: range, line of sight, walk-up, AP_TALK          tactical/narrative/talk-reach.ts, talk-arrival.ts
  civilian → a line or a hint, no panel               narrative/civ-quotes.ts, narrative/talkable.ts
  NPC → initiateConversationFull, pending while the queue is busy
    converseFull chooses a record                     narrative/converse.ts, narrative/select.ts
      record arrays: lazy copies, the R.P.C. swap     narrative/records.ts
      facts, quests, the taken item: at once
      lines, actions, gifts, walks, triggers: queued
handleDialogue: one queue event per tick              narrative/dialogue-queue.ts
  action → handleNpcDoAction                          campaign/narrative/npc-action-flow.ts, tactical/narrative/npc-actions/ (35)
  walk → the AI walks → npcReachedDestination → the record on that tile
  trigger → 500 ms wait → a panel with the talker or the closest merc
give: walk, opcode 486                                tactical/give.ts → campaign/give-flow.ts → narrative/give.ts
recruit, escort, release                              campaign/narrative/recruit-flow.ts, tactical/narrative/team-change.ts
the session: commands, tick hooks, view               campaign/talk-flow.ts (TalkFlow)
```

| Module | Holds |
|---|---|
| `src/content/formats/npc.ts`, `edt.ts`, `prof.ts`, `savegame-npc.ts` | Record and text-row layouts (also written for the stub build), profile fields, save sections 19 and 39 |
| `src/content/narrative/npc-records.ts`, `npc-constants.ts` | Loading records in Stracciatella's order (meanwhile files, the PC template `000.npc`, script overrides, binary files), civilian hint files; ids and constants |
| `src/content/narrative/dialogue-text.ts`, `speech-path.ts`, `src/content/audio/speech-lengths.ts` | A line's EDT file, row and length; speech paths and voice lengths |
| `narrative/records.ts` | Runtime record arrays: lazy copies, a recruited R.P.C.'s backup, resets, script rewrites |
| `narrative/select.ts` | Desire to talk, record conditions, receiving items and money |
| `narrative/converse.ts` | A conversation step, default answers, triggers, scripted walks, the panel, NPC-initiated talk |
| `narrative/dialogue-queue.ts`, `talk-state.ts` | The queue, its events and line lengths; the session state |
| `narrative/give.ts`, `campaign/give-flow.ts`, `tactical/give.ts` | The NPC's profile inventory and the dealer branch; the object the UI hands over; the give action and opcode 486 |
| `narrative/civ-quotes.ts`, `narrative/talkable.ts` | Civilian quotes and hints; who can be talked to |
| `narrative/host.ts`, `campaign/talk-flow.ts` | The port the mechanics run on; `TalkFlow`, which builds it, runs the commands and tick hooks and serves the view |
| `campaign/narrative/recruit-flow.ts`, `tactical/narrative/team-change.ts` | Recruiting, escorting and releasing; `ChangeSoldierTeam` |
| `tactical/narrative/civ-hostility.ts`, `sight-rules.ts`, `tactical/ai/decide-named-npc.ts`, `tactical/ai/pause.ts` | The hostile-or-say-quote list, first-sighting triggers, named NPCs walking up and turning to talk, the AI pause |
| `narrative/save-import.ts`, `campaign/narrative/guide-description.ts` | The native import of records; a recruited guide describing a sector |

## 2. Design

**Text stays out of the simulation.** A line is a `TextKey {file, row, width}` and a length in characters; no text
enters state, saves, the input log or events. The server's `TextService` (`src/server/text-service.ts`) resolves keys
through the VFS, the user's EDT files or the stub pack's (deviation "Dialogue text"). With original data `observe` and
the MCP responses carry the resolved text by default, since agents need it to follow quests.

**Where records come from.** Stracciatella replaces ten profiles' scripts by corrected JSON; ja2-node ships them as
`data/tables/npc-script-records.json` (`tools/transcribe/npc-script-records.ts`) without their comments, which quote
dialogue. As in Stracciatella, a binary file on more than one VFS layer overrides the JSON: in the usual install the
loose `Data/NpcData/097.npc` and `118.npc` sit beside `Npcdata.slf`, so Skyrider and John use their binary records.
Other profiles read the user's files. The stub pack authors its own records and lines (`stubs/npc/records.json`,
`text.json`), compiled by `pnpm stubs` into real `.npc` and `.edt` files for the same loaders; a stub NPC must be
NPC-type and not one of the ten override profiles, whose JSON in `data/` sits above the stubs.

**Record arrays are state.** A profile's records are copied from content at their first touch and then rewritten by
play: said flags, tiles rewritten when a scripted walk stops close enough, Darrel's destination. So the campaign saves
whole arrays, not flags; a missing array means "not touched yet", which is what the native save's per-profile present
byte records. A recruited R.P.C. talks from a private copy of the PC template and parks his own array as a backup until
he leaves the team.

**Choosing a record changes state; playing it is queued.** Choosing sets the record's fact, ends and starts its quests,
takes the given item and handles money, all before any line is heard; a dealer's dry run (`npcWillingToAcceptItem`) has
the same side effects. Lines, actions, gifts, walks, triggers and panel closes run when the queue reaches them. A line's
text and voice are presentation, but its duration is state: it holds the queue.

**Conversations in game time.** The original stops the world clock during a conversation (`ENGAGED_IN_CONV`, pause
lock 14) and keeps running tactical frames: the queue starts one event per frame and waits for a talking face.
ja2-node runs `handleDialogue` once per tick after the tactical step and, on the map screen, after each strategic step
and command (deviations "Dialogue queue cadence", "Map screen dialogue"). A line holds the queue for the longer of its
voice and its text (12 ticks per character + 1), then 60 ticks with the mouth closed: speech is a viewer's option and
one simulation serves every viewer (deviation "Speech"). Voice lengths come from the rule pack's
`@rules/speech/lengths.json` and stay out of its hash, so saves and logs match across installs. The 500 ms trigger wait,
the 1500 ms AI pause and the minute a named NPC idles after talking run on the tactical clock. A viewer cuts a line with
the `skipLine` input (logged and replayed): a click or Backspace ends it at once, the end of a viewer's voice or text
keeps the closing 300 ms, and every cut emits `lineCut` so all viewers end it. Agents can set `speech: skip`.

**Commands return at once; a waiting panel freezes the campaign.** `talk`, `approach`, `answer`, `give`, `openShop`
and `unescort` run their step and the queue runs in the following ticks. A panel waiting for the player (no talking
face, empty queue, no trigger wait or pending conversation, outside a meanwhile scene) or an open NPC request stops
`CampaignSim.step`, where the original keeps running frames (deviation "Talk session time"). `ENGAGED_IN_CONV` without
a panel is a scripted sequence: ticks run and player commands are refused (`29`). On the map screen `unescort` runs the
queue to the end inside the command, since nothing ticks there without compression.

**The talk context outlives the panel.** The last conversation's soldiers (`talk.soldiers {src, dest, srcProfile}`,
the original's `gpSrcSoldier`, `gpDestSoldier`, `gubSrcSoldierProfile`) feed computed facts (`25`) and NPC request
answers after the panel closed; ja2-node saves them (deviations "Talk context in saves", "Talk context after a load").
A team change replaces the soldier by one with another id, so every reference follows the profile.

**Mechanics over a port.** `src/sim/narrative/` works on `NarrativeHost` (facts, quests, actions, gives, merc lines,
the tactical state, tick, day, the main stream), so it is tested without a campaign; `TalkFlow` builds the real host.
Tactical rules reach the dialogue only through `TacticalState.narrative` (deviation "Narrative port").

**Merc lines.** Lines that interleave with NPC events (close calls, beatings, sightings through
`TacticalPort.sayQuote`) go through the queue; contract, morale and other strategic merc lines are plain `mercQuote`
events outside it.

**Prompts instead of boxes.** NPC requestors open an `npcRequest` prompt (deviation "NPC requestors"); a civilian line
is a `civQuote` event, and an enemy's surrender offer opens its `surrender` prompt at once (deviations "Civilian quote
boxes", "Surrender in tactical combat"). `openShop` is talk plus Buy/Sell in one command (deviation "Talking to
dealers"). Giving: deviations "Give command", "Giving to a dealer", "Returned items", "NPC gives an item".

**Quest values 100 and 200.** A record's quest test reads past the quest array for these two values; ja2-node reads 0,
as the oracle build does (deviation "Quest 100 and 200 in records").

**Randomness.** Draws whose result is stored keep the original order on `main`: the friendly default line (Repeat says
it again), the civilian hint drop, the hostile-quote speaker, the guide's countdown, a team change's creation draws
(deviations "Soldier creation draws", "Cosmetic face and frame draws", "Pathfinder RNG"). Choices that are only
presentation (a civilian's line, the merc who answers Miguel, an own merc's bark, the guide who speaks) use the
session's cosmetic stream `TalkState.fx` (deviation "Cosmetic draws in dialogue").

**Saving.** ja2-node refuses a save while a conversation is open or the queue is busy (`29`) and keeps the whole talk
state in its saves. A native save is believed never to be made in a conversation, so its import starts the session
empty.

## 3. Quirks of the original the code keeps

Each looks like a bug and is the original's behaviour. Pinned by tests in `src/sim/narrative/` unless a path says
otherwise:

| Quirk | Test |
|---|---|
| Threatening halves leadership + strength + deadliness (the comment says thirds), unarmed counts −30, and the desire wraps as `UINT8` | `select.test.ts` |
| The first friendly, direct or threaten use rescales all four approach values after its own desire; recruit never rescales; Pablo's not-safe approach rescales only once he was threatened | `select.test.ts` |
| A record without a required approach answers only friendly, direct and triggers; only records requiring the giving approach take items | `select.test.ts` |
| NPC-initiated talk returns the last scanned record and a quote number where an index is expected | `select.test.ts` |
| The money facts are never reset, so small and large can both hold; Vince's and Steve's plain cash keeps record index 0; the hospital refund's clamp is unsigned and never bites | `select.test.ts` |
| A record's fact and quests apply before its lines are heard, the quest end before the start | `converse.test.ts` |
| Greeting an NPC again the same day says nothing | `converse.test.ts` |
| Once-per-conversation records come back when the player closes the panel, not when a script does | `converse.test.ts` |
| A trigger whose first quote is 0 waits like a line but leaves another NPC's panel open, and the panel's NPC speaks the other's quote numbers | `converse.test.ts` |
| Our merc keeps `AI_HANDLE_EVERY_FRAME` at the end of a scripted walk: `&=` keeps the flag it means to clear and clears the others | `converse.test.ts` |
| Face-the-player stores its record, not record + 1, so from record 0 the NPC never turns | `tactical/narrative/npc-actions/catalog.test.ts`, `tactical/ai/named-npc.test.ts` |
| A walk cut by unloading the sector stores the action id as the record, so the next load runs record 0's arrival | `tactical/narrative/placement.test.ts` |
| An item taken into an NPC's profile never goes to the last small pocket and becomes a fresh object: attachments, ammo and stack members are lost | `give.test.ts` |
| A give checks 1 AP and charges 3; a merc given one item loses the whole source pocket; money given to a team member pays no debt; a target gone from its tile leaves a copy at the giver | `tactical/give.test.ts` |
| A dealer stays engaged in action after a give, out of the AI until his next panel closes | `tactical/give.test.ts`, `converse.test.ts` |
| A civilian hint starts its quest on every ask while unsaid, also when a kid is asked | `civ-quotes.test.ts` |
| L12's civilians read the miners' hint records: the sector table's L12 entry is the miners' index | `civ-quotes.test.ts` |
| An escorted E.P.C. counts as recruited: every team change to our team sets the flag | `tactical/narrative/team-change.test.ts` |
| NPC requests run only for the panel's NPC (the lie and marriage boxes aside), the lie goes to the wisest merc, Willis's free care zeroes Vince's balance | `tactical/narrative/npc-actions/requestors.test.ts` |

Not pinned yet:
- The day spoken to is a `UINT8`: from day 256 every new-day record passes, and an NPC spoken to on day 256 counts as
  never spoken to (`converseFull`).
- `FACT_PC_NEAR` is false again before a delayed tile record is handled, so such a record with lines aborts after its
  500 ms wait (`pcsNearNpc`).
- An NPC who walks up to talk (approach-7 records) starts nothing on arrival: those records only bring him to the merc
  (`npcConsiderInitiatingConv`).
- A civilian keeps his entry base when his quote type changes; an entry past the new type's rows has no text and shows
  nothing (`startCivQuote`).
- An NPC handing over a gift keeps it in his profile inventory, so a later required-item test still sees it
  (`handleNpcItemGiven`).
- One item of a stack goes back to the end of the pocket before the give, so the NPC gets the first item's status and
  the merc keeps a copy of it (`putFirstBackAtTheEnd`, `give-flow.ts`); money split off a pocket is lost when a dealer
  plays a Buy/Sell record instead (`dealerTakesGive`).
- A departed R.P.C. keeps `RECRUITED`: profile placement skips him and his own records never come back.
- `CivilianGroupMemberChangesSides` draws `Random(2)` for a first profile nothing reads (`civ-hostility.ts`).

## 4. Not checked against the native build

The oracle matches the record arrays, desire, record choice and whole conversation steps, receiving items and money,
gives and NPC gifts, civilian quotes, the named-NPC decision, the hostile-quote list and its AI pause, the surrender
offer, recruiting, escorting and releasing (`tools/oracle/README.md`, "Talk", "Give", "Civilians", "Recruiting").
Inferred from reading the source:
- What the shipped `.npc` data uses: approach-7 records, quest values 100 and 200, tile records with lines needing
  `FACT_PC_NEAR`, PC scripts in `000.npc`.
- That the original cannot save during a conversation (the Dead-Is-Dead autosave guard skips those states and the
  panel's screen region blocks the buttons), and that the hostile-quote list and the say-later profiles are not saved.
- The special UI-off reference count is a function static: a load inside such a sequence restarts it at 0.
- The two `SOLDIER_ENGAGEDINACTION` releases and the AI flags cleared at the end of a scripted walk (ported from the
  source, not probed).
- A native save's soldiers outside the loaded sector hold their ids; the import does not create them, so only
  `recruit-compare.ts` reserves those ids for a team change (`RecruitFlow.reservedSoldierSlot`).

Not ported: gaps "Dialogue queue conditions", "Say-later merc lines", "Own-merc bark", "Relationship quotes", "NPC
draws first and minor offenses", "Talk walk-up and teleport spots", "Team changes", "Close enough after a failed
scripted path". Other deviations of this domain: "Lines and debug text in the talk panel", "Opinions of high profile
ids", "Releasing an escort", "Key-advance speech".
